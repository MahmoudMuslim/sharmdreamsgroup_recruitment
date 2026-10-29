/**
 * What a spoken JARVIS command is, and what it may do.
 *
 * Pure, like `jarvis.ts`: every rule here is proved without a database, a browser,
 * a microphone or a model. In this task it imports one thing, and that thing
 * imports nothing — `isStaffPath`, because the only safe definition of "a page this
 * person may be sent to" is the guard's own. Task A3 adds the second import,
 * `fold`, because a phrase the wake test folds one way and the command test folds
 * another is two wake words pretending to be one. (`voice.ts` keeps `fold` to itself
 * until then, so importing it here today would be a module that cannot load.)
 *
 * Two doors read a row, and they are deliberately not equally strict. The write
 * door (`parseCommandDraft`) refuses anything it cannot express, because a person
 * standing in front of a form learns faster than a row does. The read door
 * (`normalizeCommandRow`) renders what it is given and says what is wrong with it,
 * because a row edited somewhere other than this console is still somebody's data
 * and hiding it would look like a lost command.
 *
 * So the read door never rewrites a length. `COMMAND_LIMITS` binds the write door,
 * which refuses an over-long field by name; a read door that sliced would be a
 * second, silent writer, and a console showing eighty of a stored hundred characters
 * would tell the person the row says something it does not say. The one length this
 * door does report is the phrase, because a phrase outside the ceiling cannot be
 * matched at all — `phraseProblem` switches the row off and names it.
 */
import { isStaffPath } from "@/lib/auth/staffRoutes";

/** Every ceiling in one place, so the migration, the console and the door quote one source. */
export const COMMAND_LIMITS = {
  phraseMin: 2,
  phraseMax: 64,
  titleMax: 80,
  notesMax: 500,
  payloadBytes: 4096,
  noteTextMax: 280,
  promptMax: 2000,
  rows: 200,
} as const;

export type CommandCategoryId =
  | "navigation"
  | "hiring"
  | "communication"
  | "reports"
  | "settings"
  | "personal";

export interface CommandCategory {
  id: CommandCategoryId;
  label: string;
  /** A `lucide-react` name the console looks up; nothing here renders it. */
  icon: string;
}

/**
 * A fixed vocabulary, not a table.
 *
 * A category that could change at runtime would change what a saved row means, and
 * a row that means something different than it did is a command nobody wrote.
 */
export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
  { id: "navigation", label: "Navigation", icon: "route" },
  { id: "hiring", label: "Hiring", icon: "briefcase" },
  { id: "communication", label: "Communication", icon: "message" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "settings", label: "Settings", icon: "sliders" },
  { id: "personal", label: "Personal", icon: "user" },
];

export type CommandActionTypeId = "ask" | "open" | "tool" | "note";

export interface CommandActionType {
  id: CommandActionTypeId;
  label: string;
  /** One line the picker shows, in the person's terms rather than the payload's. */
  description: string;
}

export const COMMAND_ACTION_TYPES: readonly CommandActionType[] = [
  { id: "ask", label: "Ask the assistant", description: "Send a question to the conversation and get an answer." },
  { id: "open", label: "Open a page", description: "Navigate to a staff page already in the rail." },
  { id: "tool", label: "Run an assistant tool", description: "Run one of the assistant's own reads or changes; a change still waits for your click." },
  { id: "note", label: "Say a line", description: "Speak one sentence and show it on the orb. Nothing is asked and nothing is written." },
];

export type CommandScope = "personal" | "shared";

export type CommandAction =
  | { type: "ask"; prompt?: string }
  | { type: "open"; href: string }
  | { type: "tool"; tool: string; args: Record<string, string> }
  | { type: "note"; text: string };

/**
 * The catalogue as the domain sees it: enough to refuse a tool the registry does
 * not hold, or one the panel's switches keep off, without this module importing the
 * registry. `destructive` and `web` are optional on `AssistantTool`, so a check has
 * to compare against `true` rather than test truthiness of `undefined`.
 */
export interface CommandTool {
  name: string;
  label: string;
  destructive?: boolean;
  web?: boolean;
}

/** What the row looks like on the wire from REST. */
export interface CommandRow {
  id: string;
  scope: string;
  owner_profile_id: string | null;
  trigger_phrase: string;
  title: string;
  category: string;
  action_type: string;
  action_payload: unknown;
  notes: string | null;
  enabled: boolean;
}

/**
 * What a command is after this module has read it.
 *
 * `problem` is what the console says out loud; `action` being null and `enabled`
 * being false are what stop the matcher from ever reaching it. A row can carry both
 * — an unreadable action in an odd category is two facts, and the one that costs the
 * person their command is the one reported first.
 */
export interface VoiceCommand {
  id: string;
  scope: CommandScope;
  ownerProfileId: string | null;
  triggerPhrase: string;
  title: string;
  category: CommandCategoryId;
  /** The stored string whenever it was not one of the six, so the console can quote it. */
  rawCategory: string | null;
  action: CommandAction | null;
  notes: string | null;
  enabled: boolean;
  problem: "phrase" | "category" | "action" | null;
}

const CATEGORY_IDS = new Set<string>(COMMAND_CATEGORIES.map((entry) => entry.id));

function isCategory(value: unknown): value is CommandCategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

/**
 * One action, accepted only in the shape its type can carry.
 *
 * Nothing here guesses. An `open` row whose payload has no href is not a command
 * that ought to ask a question instead, and inventing a prompt for it would put
 * words behind a person's saved phrase that they never wrote.
 */
function readAction(actionType: unknown, payload: unknown): CommandAction | null {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

  switch (actionType) {
    case "ask": {
      const prompt = typeof record.prompt === "string" && record.prompt.trim()
        ? record.prompt.trim()
        : undefined;
      return { type: "ask", ...(prompt ? { prompt } : {}) };
    }
    case "open": {
      const href = typeof record.href === "string" ? record.href.trim() : "";
      // Read again rather than trusted from the save: a row edited after it was
      // written is the case this door exists for.
      if (!isStaffPath(href.split("?")[0] ?? "")) return null;
      return { type: "open", href };
    }
    case "tool": {
      const tool = typeof record.tool === "string" ? record.tool.trim() : "";
      if (!tool) return null;
      const raw = typeof record.args === "object" && record.args !== null ? record.args : {};
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        // The same refusal the write door makes for this shape, made here as a
        // switch-off: a run that got fewer arguments than the row holds is a
        // command nobody wrote, so an argument this type cannot carry is not run.
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          return null;
        }
        args[key] = String(value);
      }
      return { type: "tool", tool, args };
    }
    case "note": {
      const text = typeof record.text === "string" ? record.text.trim() : "";
      return text ? { type: "note", text } : null;
    }
    default:
      return null;
  }
}

/** Whether a stored phrase is one the matcher may be handed at all. */
function phraseProblem(phrase: unknown): string | null {
  if (typeof phrase !== "string") return "a phrase must be text";
  const trimmed = phrase.trim();
  if (trimmed.length < COMMAND_LIMITS.phraseMin || trimmed.length > COMMAND_LIMITS.phraseMax) {
    return `a phrase is between ${COMMAND_LIMITS.phraseMin} and ${COMMAND_LIMITS.phraseMax} characters`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F]/.test(phrase)) return "a phrase cannot carry a control character";
  return null;
}

/**
 * The read door.
 *
 * Every field falls back to the shape the console can render, and `problem` keeps
 * the reason so the row says what it is instead of being quietly corrected. An
 * unknown action type disables the row: a command whose action nobody can read is
 * one that would do something unpredictable, and "unpredictable" is the one thing a
 * wake-gated microphone cannot be.
 */
export function normalizeCommandRow(row: CommandRow): VoiceCommand {
  const category = isCategory(row.category) ? row.category : "personal";
  const rawCategory = isCategory(row.category) ? null : String(row.category ?? "");
  const action = readAction(row.action_type, row.action_payload);
  const phrase = typeof row.trigger_phrase === "string" ? row.trigger_phrase.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";

  const problem: VoiceCommand["problem"] = phraseProblem(phrase)
    ? "phrase"
    : action === null
      ? "action"
      : !isCategory(row.category)
        ? "category"
        : null;

  return {
    id: row.id,
    scope: row.scope === "shared" ? "shared" : "personal",
    ownerProfileId: row.scope === "shared" ? null : (row.owner_profile_id ?? null),
    triggerPhrase: phrase,
    title: title || "(untitled)",
    category,
    rawCategory,
    action,
    notes: typeof row.notes === "string" ? row.notes : null,
    // A row that cannot be read is switched off whatever its column says.
    enabled: row.enabled === true && problem !== "phrase" && problem !== "action",
    problem,
  };
}
