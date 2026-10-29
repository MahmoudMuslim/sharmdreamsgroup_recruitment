import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import {
  COMMAND_LIMITS,
  normalizeCommandRow,
  type CommandRow,
  type VoiceCommand,
} from "@/modules/assistant/domain/commands";

/**
 * What a person's command list is, as far as this portal can tell.
 *
 * `absent` and `unreadable` stay separate because the person's next action differs:
 * one is "a migration has not been run, and running it is somebody's decision", the
 * other is "the database is not answering right now". A read that failed and was
 * reported as absent would send a recruiter to a file that would not help them.
 */
const TABLE = "assistant_jarvis_commands";
const MIGRATION_MISSING = /42P01|PGRST205|PGRST204|does not exist|schema cache/i;
const ABSENT_MESSAGE =
  "The voice commands could not be read, because this database holds no such table. " +
  "db/migrations/051_jarvis_voice_commands.sql is the file that creates it, and running it is somebody's decision.";

export interface VoiceCommandsRead {
  commands: VoiceCommand[];
  /** Which of the two failures this is, or null when the read answered. */
  problem: "absent" | "unreadable" | null;
  message: string | null;
  /** Whether the list is a prefix of what is stored, said out loud in the console. */
  capped: boolean;
}

function isMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  return MIGRATION_MISSING.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

/**
 * Every command this person may use, in one read.
 *
 * One `select("*")` and not two scoped queries: the RLS policies are what decide
 * that a staff member sees their own rows plus the portal's shared rows, and a query
 * that filtered the scopes itself would be a second, weaker copy of that decision —
 * one that a change to a policy would not reach. Neither reader takes a profile id
 * for the same reason: `.eq("owner_profile_id", …)` would delete the shared half of
 * the feature, and the identity is established by `requireStaff` on the page, which
 * is what mints the session the REST door forwards.
 *
 * The read is capped at `COMMAND_LIMITS.rows` and asks for one row more than it
 * keeps, so `capped` is a fact and not a guess; the console says it out loud.
 */
export async function readVoiceCommands(): Promise<VoiceCommandsRead> {
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from(TABLE)
    .select("*")
    .limit(COMMAND_LIMITS.rows + 1);

  if (error) {
    if (isMissing(error)) {
      return { commands: [], problem: "absent", message: ABSENT_MESSAGE, capped: false };
    }
    console.error("[jarvis-commands] read failed:", error.message);
    return {
      commands: [],
      problem: "unreadable",
      message: "The voice commands could not be read right now, so nothing spoken will run.",
      capped: false,
    };
  }

  const rows = (data ?? []) as CommandRow[];
  const capped = rows.length > COMMAND_LIMITS.rows;
  const kept = capped ? rows.slice(0, COMMAND_LIMITS.rows) : rows;
  return {
    // Sorted here rather than in SQL so the console's "own first" reading order is
    // the same order the matcher prefers — see `matchCommand`'s tie rule.
    commands: kept
      .map(normalizeCommandRow)
      .sort((a, b) => (a.scope === b.scope ? a.title.localeCompare(b.title) : a.scope === "personal" ? -1 : 1)),
    problem: null,
    message: capped
      ? `Only the first ${COMMAND_LIMITS.rows} commands are in play; the portal holds more than that.`
      : null,
    capped,
  };
}

/** One row, by id, through the same policies the list used. */
export async function readVoiceCommand(id: string): Promise<{ command: VoiceCommand | null; read: VoiceCommandsRead }> {
  const read = await readVoiceCommands();
  return { command: read.commands.find((entry) => entry.id === id) ?? null, read };
}
