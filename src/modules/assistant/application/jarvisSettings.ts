import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import {
  COLUMN_BY_DRAFT_KEY,
  DEFAULT_JARVIS_PREFS,
  jarvisRowToSave,
  normalizeJarvisPrefs,
  summarizeJarvisChange,
  type JarvisPrefs,
} from "@/modules/assistant/domain/jarvis";

/**
 * What the assistant may say out loud and when, per person.
 *
 * These four functions are the only way in or out of `assistant_jarvis_prefs`.
 * Everything that decides whether the microphone may be armed, whether the orb is
 * watching the queues, and whether a briefing is due is in
 * `domain/jarvis.ts`; this file is transport: read the row, merge the draft,
 * append the trail.
 *
 * Three properties the panels depend on:
 *
 * - **The write is always the caller's own row.** `profile_id` comes from the
 *   session and nothing else, so the screen that turns the wake word on cannot
 *   turn it on for a colleague, however its draft is forged.
 * - **Every write is trailed**, as `jarvis_prefs_changed`, with the state it came
 *   from and the state it went to. Ambient listening is the one switch in the
 *   portal that changes what the app can hear, so the record has to outlive the
 *   click.
 * - **An unapplied 047 is a named state, not an error.** The reader answers
 *   everything-off plus `problem: "absent"` and the writer refuses with the
 *   filename, which is what lets the panel say "this switch is not live yet"
 *   instead of offering a switch that silently does nothing.
 */

const TABLE = "assistant_jarvis_prefs";

/** The two failures a REST read answers with, kept distinct as `voiceSettings.ts` does. */
const MIGRATION_MISSING = /42P01|PGRST205|PGRST204|does not exist|schema cache/i;

function absent(error: { code?: string | null; message?: string | null }): boolean {
  return MIGRATION_MISSING.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

/**
 * The file each field's storage lives in.
 *
 * 047 creates the table; 050 adds the phrase column to it. A refused write is
 * reported with the file the draft actually needed, because a person told to apply
 * 047 when their database already has it will apply it again and still not have a
 * place for their phrase.
 */
const MIGRATION_BY_COLUMN: Record<string, string> = {
  wake_phrase: "db/migrations/050_jarvis_wake_phrase.sql",
};

const TABLE_SENTENCE =
  "db/migrations/047_assistant_jarvis_prefs.sql is authored but not applied, so the presence cannot remember a choice yet.";

function migrationSentence(draft: Record<string, unknown>): string {
  const named = new Set<string>();
  for (const key of Object.keys(draft)) {
    const column = COLUMN_BY_DRAFT_KEY[key];
    if (column && MIGRATION_BY_COLUMN[column]) named.add(MIGRATION_BY_COLUMN[column]);
  }
  if (named.size === 0) return TABLE_SENTENCE;
  const files = [...named].sort();
  const object = files.length === 1 ? `${files[0]} is` : `${files.join(" and ")} are`;
  return `${object} authored but not applied, so this database has nowhere to keep that choice. Everything else on this panel still saves.`;
}

/** Why the assistant cannot speak to this person. */
export interface JarvisUnarmed {
  reason: "no-session" | "absent-table" | "unreadable";
  message: string;
}

/**
 * What the table says about one person.
 *
 * `problem` keeps the two failures apart: an unapplied 047 is expected and the
 * console names it, an outage is not and says nothing about migrations.
 */
export interface JarvisPrefsState {
  prefs: JarvisPrefs;
  /** True when a row was read — the person has chosen. */
  stored: boolean;
  problem: "absent" | "unreadable" | null;
}

export type SavedJarvisPrefs = { ok: true; prefs: JarvisPrefs } | { ok: false; error: string };

export async function readJarvisPrefs(profileId: string): Promise<JarvisPrefsState> {
  const restClient = await createServerRestClient();

  try {
    const { data, error } = await restClient.from(TABLE).select("*").eq("profile_id", profileId).maybeSingle();

    // An absent table is expected until 047 is applied; an unreadable one is an
    // outage. Both answer everything-off, and only the first may be reported to
    // the person as "this file has not been applied".
    if (error) {
      if (absent(error)) {
        return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: "absent" };
      }
      console.error("[jarvis-prefs] read failed:", error.message ?? "unknown");
      return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: "unreadable" };
    }
    // No row is not a problem and not a choice: every switch is off, and the
    // console still offers all of them.
    if (!data) return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: null };

    return { prefs: normalizeJarvisPrefs(data as Record<string, unknown>), stored: true, problem: null };
  } catch (cause) {
    // The orb renders whatever this answers, because a settings read is not worth
    // a blank admin screen. It renders silent.
    console.error("[jarvis-prefs] read threw:", cause instanceof Error ? cause.name : "unknown");
    return { prefs: DEFAULT_JARVIS_PREFS, stored: false, problem: "unreadable" };
  }
}

/**
 * The same read for a server component that only wants to know whether the
 * microphone may arm — and, when it may not, the sentence to show instead.
 */
export async function jarvisPresenceForViewer(): Promise<JarvisPrefs | JarvisUnarmed> {
  const user = await getSessionUser();
  if (!user) return { reason: "no-session", message: "Sign in to use the assistant presence." };
  const state = await readJarvisPrefs(user.profileId);
  if (state.problem === "absent") return { reason: "absent-table", message: TABLE_SENTENCE };
  if (state.problem === "unreadable") {
    return { reason: "unreadable", message: "The presence settings could not be read right now." };
  }
  return state.prefs;
}

/**
 * Save one person's presence.
 *
 * `consentGiven` is the browser's claim that the audio explanation was played
 * before the microphone switch was flipped. It is never trusted on its own: the
 * server stamps the moment, and `jarvisRowToSave` refuses to arm the wake word
 * without one. A claim without the stamp is stored as off, not refused outright,
 * so a person who changed three other switches is not blocked by one.
 */
export async function saveJarvisPrefs(
  draft: Record<string, unknown>,
  consent: { consentGiven: boolean } = { consentGiven: false }
): Promise<SavedJarvisPrefs> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again to change this setting." };

  // The state is read before the write so the trail can name both sides. It is
  // never read as permission: a person's own switch is the only door, and the
  // merge in `domain/jarvis.ts` is what refuses a microphone without a stamp.
  let previous = DEFAULT_JARVIS_PREFS;
  try {
    previous = (await readJarvisPrefs(user.profileId)).prefs;
  } catch (cause) {
    console.error(
      "[jarvis-prefs] save could not read the previous state:",
      cause instanceof Error ? cause.name : "unknown"
    );
  }

  const row = jarvisRowToSave(draft, previous, {
    given: consent.consentGiven === true,
    stamp: new Date().toISOString(),
  });

  const payload: Record<string, unknown> = { ...row, profile_id: user.profileId, updated_at: new Date().toISOString() };
  // The row describes the whole preference set, so it names `wake_phrase` even for
  // a draft that never touched it. On a database with 047 and without 050 that one
  // unknown column makes PostgREST refuse the entire body, and `absent()` reads the
  // refusal as the table being missing — so a person moving their briefing hour
  // would be blocked by a field they never spoke to. Send the column only when this
  // draft named it; then the phrase is the only write that can need 050.
  if (!("wakePhrase" in draft)) delete payload.wake_phrase;

  const restClient = await createServerRestClient();
  const { error } = await restClient
    .from(TABLE)
    .upsert(payload, {
      onConflict: "profile_id",
    });

  if (error) {
    // The text is never logged and never echoed: it can carry a row key, and the
    // person's draft can carry what they said out loud.
    if (absent(error)) return { ok: false, error: migrationSentence(draft) };
    console.error("[jarvis-prefs] save failed:", error.code ?? "unknown");
    return { ok: false, error: `That setting could not be saved: ${error.message ?? "the database refused it"}` };
  }

  const prefs = normalizeJarvisPrefs(row);
  await recordActivity({
    area: "settings",
    action: "jarvis_prefs_changed",
    entity: "setting",
    entityId: "jarvis_presence",
    summary: summarizeJarvisChange(previous, prefs),
    detail: { from: previous, to: prefs },
    actorId: user.profileId,
  });

  return { ok: true, prefs };
}
