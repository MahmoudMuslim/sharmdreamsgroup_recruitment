/**
 * What a spoken JARVIS command is, and what it may do.
 *
 * Pure, like `jarvis.ts`: every rule here is proved without a database, a browser,
 * a microphone or a model. It imports two things, and each one is a rule this module
 * must not own: `isStaffPath`, because the only safe definition of "a page this
 * person may be sent to" is the guard's own, and `fold`, because a phrase the wake
 * test folds one way and the command test folds another is two wake words pretending
 * to be one — the matcher below reads through the wake phrase's function rather than
 * writing its own, which is what makes that claim checkable.
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
import { fold } from "./voice";

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
 * A JSON object, as opposed to an array or a string wearing one's clothes.
 *
 * Both doors ask this of an action payload and of a tool's argument map: a value
 * that is not a plain object names no fields, and `Object.entries(["APPLIED"])`
 * would hand a tool `{0: "APPLIED"}` — arguments nobody typed.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a path says "up", which the guard's prefix test cannot see.
 *
 * `isStaffPath` matches the front of a path, so `/candidates/../login` passes it and
 * the browser resolves the link somewhere the guard never named. The percent form is
 * folded to a dot first, because a router decodes a segment before it decides which
 * page that segment reaches.
 */
function hasDotSegment(pathname: string): boolean {
  return pathname
    .split("/")
    .some((segment) => {
      const dotted = segment.replace(/%2e/gi, ".");
      return dotted === "." || dotted === "..";
    });
}

/**
 * The one shape a tool's arguments may take, asked identically by both doors.
 *
 * Absent or null is an argument-less run, which is storable. A plain object of single
 * values is the map. Anything else returns `null`: the write door refuses it by name,
 * the read door switches the row off. One predicate, so a draft the save accepts is
 * always a row the read runs, and never a row the read runs that no save could write.
 */
function toolArgs(container: unknown): Record<string, string> | null {
  if (container === undefined || container === null) return {};
  if (!isPlainObject(container)) return null;
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(container)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return null;
    }
    args[key] = String(value);
  }
  return args;
}

/**
 * One action, accepted only in the shape its type can carry.
 *
 * Nothing here guesses. An `open` row whose payload has no href is not a command
 * that ought to ask a question instead, and inventing a prompt for it would put
 * words behind a person's saved phrase that they never wrote.
 */
function readAction(actionType: unknown, payload: unknown): CommandAction | null {
  // A payload that is not a set of fields is not an empty set of fields. This door
  // renders what it is given, and a row holding `"open the outbox"` where the table
  // says object is not a command with no fields — it is one nobody wrote.
  if (payload !== undefined && payload !== null && !isPlainObject(payload)) return null;
  const record = isPlainObject(payload) ? payload : {};

  switch (actionType) {
    case "ask": {
      const prompt = typeof record.prompt === "string" && record.prompt.trim()
        ? record.prompt.trim()
        : undefined;
      return { type: "ask", ...(prompt ? { prompt } : {}) };
    }
    case "open": {
      const href = typeof record.href === "string" ? record.href.trim() : "";
      const pathname = href.split("?")[0] ?? "";
      // Read again rather than trusted from the save: a row edited after it was
      // written is the case this door exists for.
      if (hasDotSegment(pathname)) return null;
      if (!isStaffPath(pathname)) return null;
      return { type: "open", href };
    }
    case "tool": {
      const tool = typeof record.tool === "string" ? record.tool.trim() : "";
      if (!tool) return null;
      // The same predicate the write door refuses with: a run that got fewer
      // arguments than the row holds is a command nobody wrote, so an argument this
      // type cannot carry — or a map this shape cannot hold — is not run.
      const args = toolArgs(record.args);
      if (args === null) return null;
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

/**
 * Payload size, counted on the compact JSON.
 *
 * The CHECK in `051` measures `octet_length(action_payload::text)`, and a jsonb
 * value's canonical text is longer than `JSON.stringify` of the same object twice
 * over: a space after every comma and colon, and octets rather than characters — an
 * Arabic or Russian prompt costs two or three of them per character. The counts are
 * not equal and this door cannot quote the column's figure, so the ceilings are
 * deliberately unequal, ruled in Task A4 as R13: the CHECK is larger than the number
 * refused here, which is what keeps an accepted draft from dying in the database as
 * a REST error with no field for the console to point at.
 */
export function payloadBytes(payload: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export type CommandDraft = {
  /**
   * The row this draft belongs to, if it belongs to one. `unknown`, not `string`,
   * because a body field this door reasons about is a body field it does not
   * type-promise to believe.
   */
  id?: unknown;
  trigger_phrase?: unknown;
  title?: unknown;
  category?: unknown;
  action_type?: unknown;
  action_payload?: unknown;
  notes?: unknown;
  enabled?: unknown;
};

export type ParseCommandResult =
  | { ok: true; command: VoiceCommand }
  | { ok: false; field: keyof CommandDraft; message: string };

/**
 * The write door.
 *
 * `scope` and `owner_profile_id` are not in the draft and are not read from it:
 * they come from `previous`, which the action supplies from the session, so a body
 * claiming `shared` cannot make one person's click publish a command for the portal.
 * `tools` is passed in rather than imported, because the registry imports writers
 * that import the database, and a rule set that needs a connection to say whether a
 * name is a tool is a rule set that cannot be proved offline.
 */
export function parseCommandDraft(
  draft: CommandDraft,
  previous: VoiceCommand,
  tools: readonly CommandTool[]
): ParseCommandResult {
  const refuse = (field: keyof CommandDraft, message: string): ParseCommandResult => ({
    ok: false,
    field,
    message,
  });

  // 1. The phrase, trimmed and whole.
  const rawPhrase = typeof draft.trigger_phrase === "string" ? draft.trigger_phrase : "";
  const triggerPhrase = rawPhrase.trim();
  const phrase = phraseProblem(triggerPhrase);
  if (phrase) return refuse("trigger_phrase", `A voice trigger phrase is ${phrase}.`);

  // 2. The title. An empty one is a field nobody filled in and a long one is a field
  // that will not fit the column; both are refusals that name `title`, not a guess
  // this door makes on the person's behalf.
  const rawTitle = typeof draft.title === "string" ? draft.title.trim() : "";
  if (!rawTitle) return refuse("title", "Give the command a name you will recognise in the list.");
  if (rawTitle.length > COMMAND_LIMITS.titleMax) {
    return refuse("title", `A command name is at most ${COMMAND_LIMITS.titleMax} characters.`);
  }
  const title = rawTitle;

  // 3. The category, from the fixed six only.
  if (!isCategory(draft.category)) {
    return refuse("category", "That is not one of the categories this portal offers.");
  }
  const category = draft.category;

  // 4. The action type, and then the payload that type can actually carry.
  const actionType = draft.action_type;
  if (
    actionType !== "ask" &&
    actionType !== "open" &&
    actionType !== "tool" &&
    actionType !== "note"
  ) {
    return refuse("action_type", "Choose what the command does.");
  }
  // A payload that is not a set of named fields is not a set of named fields that
  // happens to be empty: `"open the outbox"` and `{}` are different statements, and
  // reading the first as the second is the silent default this door exists to avoid.
  if (
    draft.action_payload !== undefined &&
    draft.action_payload !== null &&
    !isPlainObject(draft.action_payload)
  ) {
    return refuse("action_payload", "An action is a set of named fields, not a list or a single value.");
  }
  const payload = isPlainObject(draft.action_payload) ? draft.action_payload : {};
  if (payloadBytes(payload) > COMMAND_LIMITS.payloadBytes) {
    return refuse("action_payload", "That action is larger than the 4 KB a command may carry.");
  }

  let action: CommandAction | null = null;
  if (actionType === "ask") {
    const rawPrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (rawPrompt.length > COMMAND_LIMITS.promptMax) {
      return refuse("action_payload", `A saved question is at most ${COMMAND_LIMITS.promptMax} characters.`);
    }
    action = rawPrompt ? { type: "ask", prompt: rawPrompt } : { type: "ask" };
  } else if (actionType === "open") {
    const href = typeof payload.href === "string" ? payload.href.trim() : "";
    if (!href) return refuse("action_payload", "Say which page to open.");
    // The guard's own predicate: whatever it does not cover, a command may not send
    // a person to — not an off-site host, not a scheme, not a path outside the staff
    // table. Checked on the path alone, because a query cannot change which page a
    // link reaches but it can change what a naive prefix test accepts.
    const pathname = href.split("?")[0] ?? "";
    // …and the guard's prefix is matched from the front, so a path that steps up is
    // refused on top of it: `/candidates/../login` passes `/candidates/` here and
    // lands somewhere the rail never listed.
    if (hasDotSegment(pathname)) {
      return refuse(
        "action_payload",
        `${href} walks up out of the page it names, so no command may open it.`
      );
    }
    if (!isStaffPath(pathname)) {
      return refuse(
        "action_payload",
        `${href} is not a staff page this portal guards, so no command may open it.`
      );
    }
    action = { type: "open", href };
  } else if (actionType === "tool") {
    const name = typeof payload.tool === "string" ? payload.tool.trim() : "";
    const known = tools.find((entry) => entry.name === name);
    if (!known) {
      return refuse("action_payload", "That is not a tool the assistant has.");
    }
    // `=== true`, because `AssistantTool` declares both optional and an absent flag
    // means "not dangerous", not "unknown".
    if (known.destructive === true) {
      return refuse("action_payload", `${known.label} deletes something, and a saved command may not.`);
    }
    if (known.web === true) {
      return refuse("action_payload", `${known.label} leaves the portal, and a saved command may not.`);
    }
    // The read door's predicate, the same one, so the two doors can never disagree
    // about which argument shapes exist.
    const args = toolArgs(payload.args);
    if (args === null) {
      return refuse("action_payload", "A tool's arguments have to be named single values.");
    }
    action = { type: "tool", tool: known.name, args };
  } else {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return refuse("action_payload", "Say the line to speak.");
    if (text.length > COMMAND_LIMITS.noteTextMax) {
      return refuse("action_payload", `A spoken note is at most ${COMMAND_LIMITS.noteTextMax} characters.`);
    }
    action = { type: "note", text };
  }

  // 5. The description, which reaches nobody but the person who wrote it.
  if (draft.notes !== undefined && draft.notes !== null && typeof draft.notes !== "string") {
    return refuse("notes", "Notes are text.");
  }
  const rawNotes = typeof draft.notes === "string" ? draft.notes.trim() : "";
  if (rawNotes.length > COMMAND_LIMITS.notesMax) {
    return refuse("notes", `Notes are at most ${COMMAND_LIMITS.notesMax} characters.`);
  }

  // 6. The two fields a person does not edit from the form.
  //
  // `id` and `enabled` arrive with the rest of the body, so they need the same
  // treatment every other body field gets. A draft carrying another row's id is a
  // request to move a saved command's identity, and the update A6 issues is keyed off
  // the id this door returns; a body that leaves `enabled` out is a partial update,
  // not a request to switch a switched-off command back on.
  if (draft.id !== undefined && draft.id !== null && draft.id !== previous.id) {
    return refuse("id", "A saved command keeps its own id; this draft names another row.");
  }
  if (draft.enabled !== undefined && draft.enabled !== null && typeof draft.enabled !== "boolean") {
    return refuse("enabled", "Enabled is a yes or a no.");
  }

  return {
    ok: true,
    command: {
      id: previous.id,
      scope: previous.scope,
      ownerProfileId: previous.ownerProfileId,
      triggerPhrase,
      title,
      category,
      rawCategory: null,
      action,
      notes: rawNotes || null,
      enabled: draft.enabled === undefined || draft.enabled === null ? previous.enabled : draft.enabled,
      problem: null,
    },
  };
}

/**
 * Spoken words, split the way `isStopCommand` splits them.
 *
 * The same rule for the same reason: `stop` inside `stopwatch` is not a word
 * anybody said, and a command matched on a substring would fire on a sentence that
 * merely contains it.
 */
const TOKEN_SPLIT = /[\s,.;:!?"'()]+/;

function tokensOf(folded: string): string[] {
  return folded.split(TOKEN_SPLIT).filter(Boolean);
}

/**
 * The utterance as folded tokens, with the raw word each token came from.
 *
 * `fold` can turn one written word into two spoken tokens — `follow-up` folds to
 * `follow up`, `O'Brien` to `o brien` — so an index into the folded list is not an
 * index into the words the person said. The tail comes from the words, so the
 * matcher carries both and `after` is the map between them: `after[i]` is the
 * number of raw words the first `i + 1` tokens were made from.
 */
function wordsOf(transcript: string): { tokens: string[]; after: number[]; raw: string[] } {
  const raw = transcript.trim().split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  const after: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const folded = tokensOf(fold(raw[index]));
    for (let n = 0; n < folded.length; n += 1) {
      tokens.push(folded[n]);
      after.push(index + 1);
    }
  }
  return { tokens, after, raw };
}

/** Whether `needle` appears in `haystack` as a run of whole tokens, from its start. */
function containsRun(haystack: string[], needle: string[], at: number): boolean {
  if (needle.length > haystack.length - at) return false;
  for (let index = 0; index < needle.length; index += 1) {
    if (haystack[at + index] !== needle[index]) return false;
  }
  return true;
}

export interface CommandMatch {
  command: VoiceCommand;
  /**
   * What the person said after the phrase, in their own casing and punctuation.
   *
   * The match is made on folded tokens but the tail is taken from the raw words,
   * because a tail becomes a saved question: lowercased and stripped, it would put
   * a name in the transcript that the person never typed that way. `wakeRemainder`
   * in `domain/voice.ts` does the same trick for the wake phrase for the same
   * reason, and this is its second instance rather than a third copy of it — with
   * one thing this one needs and a wake phrase does not, because a command can be
   * said in the middle of a sentence: the folded-to-raw map in `wordsOf`, so the
   * cut lands after a word rather than after a token.
   */
  tail: string;
}

/**
 * The one thing a wake phrase may do besides open a conversation.
 *
 * Disabled rows and rows this module could not read are dropped first, so a broken
 * row is not a command that does something unexpected — it is a command that does
 * nothing, which the console has already said out loud. Then the longest match wins,
 * because "open the outbox" is a more precise intent than "open"; a tie between a
 * personal and a shared row goes to the person's own, which is how somebody
 * overrides one shared command without touching anyone else's.
 */
export function matchCommand(transcript: string, commands: readonly VoiceCommand[]): CommandMatch | null {
  const { tokens: spokenTokens, after, raw } = wordsOf(transcript);
  if (spokenTokens.length === 0) return null;

  let best: { command: VoiceCommand; at: number; length: number } | null = null;
  for (const command of commands) {
    if (!command.enabled || command.action === null || command.problem === "phrase") continue;
    const wanted = tokensOf(fold(command.triggerPhrase));
    if (wanted.length === 0) continue;
    for (let at = 0; at <= spokenTokens.length - wanted.length; at += 1) {
      if (!containsRun(spokenTokens, wanted, at)) continue;
      const better =
        best === null ||
        wanted.length > best.length ||
        // Equal length, and the person's own phrase beats the portal's.
        (wanted.length === best.length && command.scope === "personal" && best.command.scope === "shared");
      if (better) best = { command, at, length: wanted.length };
      break;
    }
  }
  if (!best) return null;
  return { command: best.command, tail: raw.slice(after[best.at + best.length - 1]).join(" ") };
}
