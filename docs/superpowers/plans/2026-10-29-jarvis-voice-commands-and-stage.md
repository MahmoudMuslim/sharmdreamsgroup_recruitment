# JARVIS Voice Commands and the Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter save spoken phrases that make JARVIS *do* something — ask a question, open a page, run one of the assistant's own tools, or say a line — and add a full-viewport Stage where the orb stands alone in the centre and steps to the top-right as soon as there is an answer to read beside it.

**Architecture:** Part A is a new pure domain module (`domain/commands.ts`) holding every rule, one bounded reader over a new table, five server actions, a console under Settings → Assistant, and one new seam inside the orb's existing `hear` callback — the orb matches a saved phrase before it hands the transcript to the model, and a `tool` command goes back through the chat so the approval card is the same card it already mints. Part B puts the stage behind a route (`/assistant/stage`), renders `AdminShell` bare on that path, gives `AssistantChat` a third layout variant, and makes the single existing orb read its position from the pathname plus one turn count in the module store.

**Tech Stack:** Next.js 16.4 (App Router, turbopack) + React 19.3, TypeScript strict; self-hosted Postgres 18.6 behind PostgREST v16.5 through `src/lib/rest/query-builder.ts`; Tailwind with arbitrary values and no dynamically-built class names; proofs in `node --experimental-strip-types` — one presence-style harness, one `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-jarvis-voice-commands-and-stage-design.md` — read it before Task A1. This plan argues from it; where the two disagree, the spec is the approved decision and this plan is the one that is wrong.

## Global Constraints

Every task carries these in addition to its own steps. A task that breaks one is wrong even when its tests pass.

- **Never restart or kill the owner's dev server** on `localhost:3001`, and never `docker compose up/down` the whole stack. Only the `app` service may be rolled, and only when a task says so.
- **`db/migrations/051_jarvis_voice_commands.sql` is authored, not applied.** No task in this plan applies it. Applying it needs its own named, explicit approval from the owner, and an apply means running the copy sweep with it (see Task A7). Everything before that runs against the table being absent.
- **No microphone work.** Do not arm a capture, do not run a mic-to-gateway proof — that is a spend and needs the owner signed in personally. Every live proof in this plan is driven by typing and clicking.
- **Audio is never stored**: no bucket, row, log, object URL or analytics event about a phrase, including one that matched nothing. A command is content, not audio.
- **One microphone per tab.** `src/modules/assistant/presentation/voice/useWakeListening.ts` must never call `getUserMedia`, and this plan does not touch it.
- **No `lang` is set anywhere in the listening path**, and `speechLanguageOf` is not widened. Wake matching stays in the callers.
- **Refuse, never silently default.** An invalid field, a refused href, an unknown tool name or a duplicate phrase is a stated refusal naming the field. Silent correction is the failure mode this slice is most likely to reintroduce.
- **The candidate portal is untouched.** No edits under `src/app/(candidate)`, no `NoticeInbox` or `communication_logs` reads.
- **Read `node_modules/next/dist/docs/` before touching routing or server components** — this is a forked Next.js and `AGENTS.md` says so. Tasks B3 and B4 depend on that read.
- **Local data is real.** Console proofs write self-scoped personal rows under the owner's own account and delete them in the same task; never rehearse a write against a shared row.
- **Commit only when the owner asks.** Each task ends with a commit step because the plan assumes the owner has asked for per-task commits at execution time; if they have not, stop at "changes ready" instead.

---

## File structure

Everything this plan touches, and what each file is responsible for after the plan. `Create` is a new file; `Modify` names the anchor it changes.

| File | Responsibility gained |
| --- | --- |
| `src/modules/assistant/domain/commands.ts` (create) | Every command rule, pure: the two vocabularies, the ceilings, the write door, the read door, the matcher. Imports only `voice.ts`'s `fold` and `staffRoutes.ts`'s `isStaffPath`, both of which import nothing |
| `src/modules/assistant/domain/voice.ts` (modify) | `fold` becomes exported — the second caller is the matcher, and a phrase folded one way by the wake test and another by the command test would be two wake words |
| `db/migrations/051_jarvis_voice_commands.sql` (create) | The table, its CHECKs, both partial unique indexes, eight RLS policies, the `assistant.commands` permission seed, four shared starters |
| `src/modules/assistant/application/jarvisCommands.ts` (create) | The bounded read under RLS, and the absent/unreadable ladder that names 051 |
| `src/app/(admin)/settings/jarvis-command-actions.ts` (create) | `saveCommand`, `duplicateCommand`, `deleteCommand`, `setCommandEnabled`, `adoptSharedCommand` — the five writes, each through `readVoiceCommand` and the domain door |
| `src/app/(admin)/settings/JarvisCommandsConsole.tsx` (create) | The manager: two tabs behind the URL, `?q=`, category chips, expand-to-edit, Add to mine |
| `src/modules/settings/domain/settingsNav.ts` (modify) | A third `ASSISTANT_SECTIONS` entry, `commands` |
| `src/app/(admin)/settings/SettingsShell.tsx` (modify) | `mic: Mic` in `ICONS` |
| `src/app/(admin)/settings/page.tsx` (modify) | `AssistantPanel` branches to the commands console |
| `src/modules/settings/domain/types.ts` (modify) | `assistant.commands` in the `PermissionKey` union |
| `src/app/(admin)/settings/jarvis-actions.ts` (modify) | `PresenceRead`'s `ok` branch gains `commands` |
| `src/modules/assistant/presentation/JarvisPresence.tsx` (modify) | The dispatch seam, the three positions, `Ctrl+Shift+Space`, the note card |
| `src/modules/assistant/domain/stage.ts` (create) | The stage's geometry, pure: the route, the five pixel figures, and the transform vars the orb's literal classes are pinned against |
| `src/lib/jarvis-ui.ts` (modify) | `stageTurns`, `pendingCommand` and their setters/takers |
| `src/modules/assistant/infrastructure/agent.ts` (modify) | `runTool` becomes exported |
| `src/modules/assistant/infrastructure/transcriptStore.ts` (modify) | `appendCommandTurn`, the command-shaped twin of `appendApprovalOutcome` |
| `src/app/(admin)/assistant/actions.ts` (modify) | `runJarvisCommand` |
| `src/app/(admin)/assistant/AssistantChat.tsx` (modify) | `variant: "stage"`, the pending-command consumer, the turn-count report |
| `src/app/(admin)/assistant/stage/page.tsx` (create) | The server half of the route |
| `src/app/(admin)/assistant/stage/AssistantStage.tsx` (create) | The client half: `?session=`, Exit stage, Escape, the chat, the gutter |
| `src/modules/analytics/presentation/AdminShell.tsx` (modify) | Bare render on `/assistant/stage`, presence still mounted |
| `src/app/(admin)/assistant/AssistantDock.tsx` (modify) | The Stage door beside the maximize button |
| `src/modules/shell/domain/pageGuide.ts` (modify) | The assistant paragraph gains both slices |
| `scripts/prove-jarvis-commands.mjs` (create) | Six numbered groups, one mutation each |
| `scripts/prove-jarvis-stage.mjs` (create) | Five `node:test` groups |
| `scripts/prove-migration-claims.mjs` (modify) | A `051` entry and its probe |

**Read before implementing, do not change:** `src/app/(admin)/assistant/AssistantConsole.tsx:86-108` (the `?session=` idiom the stage copies), `src/modules/assistant/application/jarvisSettings.ts` (the ladder the new reader mirrors), `src/modules/assistant/presentation/useJarvisVoice.ts` (the queue `note` speaks through), `src/lib/auth/staffRoutes.ts` (why `/assistant/stage` needs no new entry).

---

# Part A — The Voice Commands Manager

---

## Task A1: The two vocabularies, the ceilings, and the read door

Pure module, no database, no browser. This task's deliverable is `commands.ts` answering what a *stored* row means — the forgiving half of the pair. The write door comes in A2, because a read that is as strict as a write would hide a hand-edited row instead of naming it.

**Files:**
- Create: `src/modules/assistant/domain/commands.ts`
- Create: `scripts/prove-jarvis-commands.mjs` (group 1 and group 3 only; A2–A4 append the rest)
- Reference: `src/modules/assistant/domain/jarvis.ts` (the shape this mirrors)

**Interfaces:**
- Consumes: nothing outside this file.
- Produces: `COMMAND_LIMITS`, `COMMAND_CATEGORIES`, `COMMAND_ACTION_TYPES`, `CommandCategoryId`, `CommandActionTypeId`, `CommandScope`, `CommandAction`, `CommandTool`, `VoiceCommand`, `normalizeCommandRow`, `rawRow` type `CommandRow`. A2 adds `parseCommandDraft`; A3 adds `matchCommand`.

- [ ] **Step 1: Write the failing checks**

At the foot of the new `scripts/prove-jarvis-commands.mjs`, paste the harness from `scripts/prove-jarvis-presence.mjs` verbatim through its `mutation()` helper — same `STUB_SOURCES`, same `registerHooks` (`@/` → `src/`), same `verdict`/`safe`/`expect`, same `load(url)` with the monotonic `?v=` counter, same `resetGlobals`/`fakeRest`, same `checkIsRed`, same summary block and `process.exitCode`. Only four things change: the header comment, the `REL` constants, the checks, and the `ABSENT` relation name — this slice's table is `assistant_jarvis_commands`, and a stub that answers with another table would make a later "the read says absent" assertion describe the wrong relation. Name the constants this slice uses:

```js
const DOMAIN_REL = "src/modules/assistant/domain/commands.ts";
const MIGRATION_REL = "db/migrations/051_jarvis_voice_commands.sql";
const READER_REL = "src/modules/assistant/application/jarvisCommands.ts";
const ACTIONS_REL = "src/app/(admin)/settings/jarvis-command-actions.ts";
const PRESENCE_REL = "src/modules/assistant/presentation/JarvisPresence.tsx";
const CHAT_REL = "src/app/(admin)/assistant/AssistantChat.tsx";
const RUNNER_REL = "src/app/(admin)/assistant/actions.ts";
const STORE_REL = "src/lib/jarvis-ui.ts";
```

Then group 1 and group 3:

```js
async function check1() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  expect(problems, "category count", m.COMMAND_CATEGORIES.length, 6);
  expect(problems, "category ids", m.COMMAND_CATEGORIES.map((c) => c.id), [
    "navigation", "hiring", "communication", "reports", "settings", "personal",
  ]);
  expect(problems, "every category label is non-empty",
    m.COMMAND_CATEGORIES.every((c) => c.label.trim().length > 0), true);
  expect(problems, "action type ids", m.COMMAND_ACTION_TYPES.map((a) => a.id), [
    "ask", "open", "tool", "note",
  ]);
  expect(problems, "every action type describes itself",
    m.COMMAND_ACTION_TYPES.every((a) => a.description.trim().length > 0), true);
  expect(problems, "phrase floor", m.COMMAND_LIMITS.phraseMin, 2);
  expect(problems, "phrase ceiling", m.COMMAND_LIMITS.phraseMax, 64);
  expect(problems, "title ceiling", m.COMMAND_LIMITS.titleMax, 80);
  expect(problems, "notes ceiling", m.COMMAND_LIMITS.notesMax, 500);
  expect(problems, "payload ceiling", m.COMMAND_LIMITS.payloadBytes, 4096);
  expect(problems, "spoken note ceiling", m.COMMAND_LIMITS.noteTextMax, 280);
  expect(problems, "ask prompt ceiling", m.COMMAND_LIMITS.promptMax, 2000);
  expect(problems, "read ceiling", m.COMMAND_LIMITS.rows, 200);
  return verdict(problems);
}

async function check3() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    scope: "personal",
    owner_profile_id: "p1",
    trigger_phrase: "open the outbox",
    title: "Outbox",
    category: "communication",
    action_type: "open",
    action_payload: { href: "/whatsapp" },
    notes: null,
    enabled: true,
  };

  // A row the console wrote reads back whole.
  const good = m.normalizeCommandRow(base);
  expect(problems, "a sound row is enabled", good.enabled, true);
  expect(problems, "a sound row has no problem", good.problem, null);
  expect(problems, "a sound row carries its action", good.action, { type: "open", href: "/whatsapp" });
  expect(problems, "a sound row keeps its raw category", good.rawCategory, null);

  // A category nobody authored still renders, and says what it is.
  const odd = m.normalizeCommandRow({ ...base, category: "payroll" });
  expect(problems, "an unknown category reads as personal", odd.category, "personal");
  expect(problems, "the original string survives", odd.rawCategory, "payroll");
  expect(problems, "the row reports itself", odd.problem, "category");

  // A broken action is switched off, never guessed into being an `ask`.
  const broken = m.normalizeCommandRow({ ...base, action_type: "delete" });
  expect(problems, "an unknown action type carries no action", broken.action, null);
  expect(problems, "and is disabled", broken.enabled, false);
  expect(problems, "and names why", broken.problem, "action");

  // A payload that cannot express its type is the same refusal.
  const noHref = m.normalizeCommandRow({ ...base, action_payload: {} });
  expect(problems, "an `open` with no href carries no action", noHref.action, null);
  expect(problems, "an `open` with no href is disabled", noHref.enabled, false);

  // A shared row has no owner, and says so in its scope.
  const shared = m.normalizeCommandRow({ ...base, scope: "shared", owner_profile_id: null });
  expect(problems, "shared scope survives", shared.scope, "shared");
  expect(problems, "shared owner is null", shared.ownerProfileId, null);

  // A row the database should not accept at all is still a row the console lists.
  const shortPhrase = m.normalizeCommandRow({ ...base, trigger_phrase: "x" });
  expect(problems, "an over-short phrase is disabled", shortPhrase.enabled, false);
  expect(problems, "and reported", shortPhrase.problem, "phrase");

  // Length is not a problem this door may solve: it shows the whole stored string.
  const longTitle = m.normalizeCommandRow({ ...base, title: "t".repeat(200) });
  expect(problems, "an over-long title arrives whole", longTitle.title.length, 200);
  expect(problems, "and is not reported as a problem", longTitle.problem, null);

  // A tool row whose arguments hold a shape this type cannot carry is not run.
  const objectArgs = m.normalizeCommandRow({
    ...base,
    action_type: "tool",
    action_payload: { tool: "search_people", args: { filters: { company: 4 } } },
  });
  expect(problems, "an inexpressible args map carries no action", objectArgs.action, null);
  expect(problems, "and is disabled", objectArgs.enabled, false);
  expect(problems, "and names the action as the problem", objectArgs.problem, "action");
  return verdict(problems);
}
```

Register them in `CHECKS` as `["1. The six categories and four action types are the shipped vocabulary", check1]` and `["3. The read door renders a hand-edited row and names what it cannot read", check3]`, with group 2 and 4–6 left as the comment `// Groups 2, 4, 5 and 6 arrive in Tasks A2, A3, A4 and A8.` A file whose `CHECKS` array has two entries is the honest state at this point.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — `Cannot find module ... src/modules/assistant/domain/commands.ts` (thrown by `safe()`, reported as `threw:`).

- [ ] **Step 3: Write the module**

Create `src/modules/assistant/domain/commands.ts`:

```ts
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
```

Note on `fold`: it is **not** imported in this task. Nothing here calls it, and `voice.ts` does not export it until A3 — an `import { fold }` in this file is a fatal `SyntaxError: The requested module ... does not provide an export named 'fold'` the moment the proof loads the module, not a warning. A3 adds the export and this file's import in the same step. (The repository has no `noUnusedLocals`, so an unused local would only have been a lint error for an unused *import* — and here it is worse than that.)

- [ ] **Step 4: Run the proof and see it pass**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `2/2 checks held, 0/0 mutations turned red.` (exit 0)

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit` (the direct binary — `npx tsc` has resolved elsewhere in this repository)
Expected: no errors in `commands.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/domain/commands.ts scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): a saved command is read for what it says, and says what it cannot read"
```

---

## Task A2: The write door — refuse, never default

`parseCommandDraft` is the one place a command form becomes a row. It refuses, and it names the field it refused.

**Files:**
- Modify: `src/modules/assistant/domain/commands.ts` (append)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 2, and group 2's mutation)

**Interfaces:**
- Consumes: `COMMAND_LIMITS`, `CommandAction`, `CommandTool`, `VoiceCommand` from A1.
- Produces: `ParseCommandResult`, `parseCommandDraft(draft, previous, tools)`, `payloadBytes(payload)`. A4's actions and A6's console call it; A5's reader never does.

- [ ] **Step 1: Write the failing checks**

Append to the proof, after the `isStaffPath`-stub note below:

```js
async function check2() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const TOOLS = [
    { name: "list_candidates", label: "List candidates" },
    { name: "delete_candidate", label: "Delete a candidate", destructive: true },
    { name: "search_web", label: "Search the web", web: true },
  ];
  const PREV = {
    id: "c1", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open the outbox",
    title: "Outbox", category: "communication", rawCategory: null,
    action: { type: "open", href: "/whatsapp" }, notes: null, enabled: true, problem: null,
  };
  const ok = (draft) => m.parseCommandDraft(draft, PREV, TOOLS);
  const refused = (label, draft, field) => {
    const out = ok(draft);
    if (out.ok !== false) problems.push(`${label}: expected a refusal`);
    else if (out.field !== field) problems.push(`${label}: refused ${out.field}, expected ${field}`);
  };
  const good = {
    trigger_phrase: "open the outbox", title: "Outbox", category: "communication",
    action_type: "open", action_payload: { href: "/whatsapp" }, notes: "", enabled: true,
  };

  // The happy path, once, so the refusals below are known to be about their field.
  const parsed = ok(good);
  expect(problems, "a sound draft is accepted", parsed.ok, true);
  if (parsed.ok) {
    expect(problems, "to an open action", parsed.command.action, { type: "open", href: "/whatsapp" });
    expect(problems, "with the scope it is stored under", parsed.command.scope, "personal");
  }

  // Phrase.
  refused("a one-character phrase", { ...good, trigger_phrase: "x" }, "trigger_phrase");
  refused("a 65-character phrase", { ...good, trigger_phrase: "p".repeat(65) }, "trigger_phrase");
  refused("a phrase with a newline", { ...good, trigger_phrase: "open\nthe outbox" }, "trigger_phrase");
  refused("a phrase that is only spaces", { ...good, trigger_phrase: "     " }, "trigger_phrase");

  // Title.
  refused("an empty title", { ...good, title: "  " }, "title");
  refused("a 200-character title", { ...good, title: "t".repeat(200) }, "title");

  // Category and action type must be in the vocabulary.
  refused("an invented category", { ...good, category: "payroll" }, "category");
  refused("an invented action type", { ...good, action_type: "delete" }, "action_type");

  // `open` — the guard's own rule, quoted back.
  refused("an off-site href", { ...good, action_payload: { href: "https://example.com/x" } }, "action_payload");
  refused("a javascript: href", { ...good, action_payload: { href: "javascript:alert(1)" } }, "action_payload");
  refused("a path the guard does not cover", { ...good, action_payload: { href: "/candidate-portal" } }, "action_payload");
  refused("an empty href", { ...good, action_payload: { href: "" } }, "action_payload");
  expect(problems, "a staff path with a query is accepted",
    ok({ ...good, action_payload: { href: "/candidates?q=offer" } }).ok, true);

  // `tool` — unknown, destructive and web names are all refused here, not at dispatch.
  const asTool = { ...good, action_type: "tool" };
  refused("an unknown tool", { ...asTool, action_payload: { tool: "drop_tables", args: {} } }, "action_payload");
  refused("a destructive tool", { ...asTool, action_payload: { tool: "delete_candidate", args: {} } }, "action_payload");
  refused("a web tool", { ...asTool, action_payload: { tool: "search_web", args: {} } }, "action_payload");
  expect(problems, "a read-only tool is accepted",
    ok({ ...asTool, action_payload: { tool: "list_candidates", args: { stage: "APPLIED" } } }).ok, true);

  // `note` and `ask` ceilings.
  refused("a note past its ceiling",
    { ...good, action_type: "note", action_payload: { text: "n".repeat(281) } }, "action_payload");
  refused("an empty note", { ...good, action_type: "note", action_payload: { text: "" } }, "action_payload");
  expect(problems, "an ask with no prompt is a valid ask",
    ok({ ...good, action_type: "ask", action_payload: {} }).ok, true);

  // Size, measured the way the database measures it.
  const huge = { ...good, action_type: "ask", action_payload: { prompt: "p".repeat(5000) } };
  refused("an over-sized payload", huge, "action_payload");
  expect(problems, "the byte count is the JSON the column holds",
    m.payloadBytes({ prompt: "abc" }), new TextEncoder().encode(JSON.stringify({ prompt: "abc" })).length);

  // Notes on the row itself.
  refused("a note past 500", { ...good, notes: "n".repeat(501) }, "notes");

  // A refusal never touches the stored value: the message is the whole answer.
  const after = ok({ ...good, trigger_phrase: "x" });
  expect(problems, "a refusal carries no command", "command" in after, false);
  return verdict(problems);
}
```

Register as `["2. The write door refuses every field it cannot express", check2]`.

- [ ] **Step 2: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — `m.parseCommandDraft is not a function`.

- [ ] **Step 3: Write the door**

Append to `commands.ts`:

```ts
/**
 * Payload size as the column sees it.
 *
 * The CHECK in `051` measures `octet_length(action_payload::text)`, so the door
 * measures the same bytes: a draft this module accepted and the database rejected
 * would surface as a REST error the console has no field to point at.
 */
export function payloadBytes(payload: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export type CommandDraft = {
  id?: string;
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
  const payload =
    typeof draft.action_payload === "object" && draft.action_payload !== null
      ? (draft.action_payload as Record<string, unknown>)
      : {};
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
    const rawArgs = typeof payload.args === "object" && payload.args !== null ? payload.args : {};
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return refuse("action_payload", `The argument ${key} has to be a single value.`);
      }
      args[key] = String(value);
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
  const rawNotes = typeof draft.notes === "string" ? draft.notes.trim() : "";
  if (rawNotes.length > COMMAND_LIMITS.notesMax) {
    return refuse("notes", `Notes are at most ${COMMAND_LIMITS.notesMax} characters.`);
  }

  return {
    ok: true,
    command: {
      id: typeof draft.id === "string" ? draft.id : previous.id,
      scope: previous.scope,
      ownerProfileId: previous.ownerProfileId,
      triggerPhrase,
      title,
      category,
      rawCategory: null,
      action,
      notes: rawNotes || null,
      enabled: draft.enabled === undefined ? true : draft.enabled === true,
      problem: null,
    },
  };
}
```

- [ ] **Step 4: Run the proof**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `3/3 checks held, 0/0 mutations turned red.`

- [ ] **Step 5: Add group 2's mutation**

```js
await mutation(
  "1. The write door letting an off-site href through → check 2 red",
  DOMAIN_REL,
  "    if (!isStaffPath(pathname)) {",
  "    if (pathname.length > 1) {",
  async () => checkIsRed(2)
);
```

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `3/3 checks held, 1/1 mutations turned red.`

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/domain/commands.ts scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): a command draft is refused by name of the field it cannot express"
```

---

## Task A3: The matcher, and the `fold` it shares with the wake phrase

Four rules, in order: fold first, whole tokens, longest wins, personal beats shared. Disabled rows are dropped before any of them run.

**Files:**
- Modify: `src/modules/assistant/domain/voice.ts:80` (`function fold` → `export function fold`)
- Modify: `src/modules/assistant/domain/commands.ts` (append)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 4 and its mutation)

**Interfaces:**
- Consumes: `fold(text)` from `voice.ts`, `VoiceCommand` from A1.
- Produces: `CommandMatch`, `matchCommand(transcript, commands)`, and `tokensOf`/`containsRun` as module-private helpers. Task A6's `hear` calls `matchCommand`.

- [ ] **Step 1: Write the failing checks**

```js
async function check4() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const cmd = (over) => ({
    id: "c", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open the outbox",
    title: "Outbox", category: "communication", rawCategory: null,
    action: { type: "open", href: "/whatsapp" }, notes: null, enabled: true, problem: null,
    ...over,
  });

  // Whole tokens, not substrings.
  const one = [cmd({})];
  expect(problems, "an exact phrase matches", !!m.matchCommand("open the outbox", one), true);
  expect(problems, "a prefix of a longer spoken word does not", !!m.matchCommand("open the outboxes", one), false);
  expect(problems, "a shorter run does not", !!m.matchCommand("open the", one), false);
  expect(problems, "a phrase inside another sentence matches", !!m.matchCommand("hey jarvis open the outbox please", one), true);

  // Folding: the same words, differently spelled.
  const arabic = [cmd({ triggerPhrase: "افتح البريد", action: { type: "open", href: "/whatsapp" } })];
  expect(problems, "an alef form still matches", !!m.matchCommand("إفتح البريد", arabic), true);
  expect(problems, "case does not matter", !!m.matchCommand("OPEN   the   Outbox", one), true);

  // Longest wins.
  const short = cmd({ id: "s", triggerPhrase: "open", title: "Short" });
  const long = cmd({ id: "l", triggerPhrase: "open the outbox", title: "Long" });
  const both = m.matchCommand("open the outbox", [short, long]);
  expect(problems, "the more specific phrase runs", both?.command.id, "l");
  const onlyShort = m.matchCommand("open now", [short, long]);
  expect(problems, "and a shorter one still works alone", onlyShort?.command.id, "s");

  // Personal beats shared, at equal length.
  const mine = cmd({ id: "mine", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open" });
  const theirs = cmd({ id: "theirs", scope: "shared", ownerProfileId: null, triggerPhrase: "open" });
  expect(problems, "the person's own wins", m.matchCommand("open", [theirs, mine])?.command.id, "mine");

  // Disabled commands never reach the matcher.
  expect(problems, "a disabled command is not matched",
    m.matchCommand("open the outbox", [cmd({ enabled: false })]), null);

  // The tail: what was said after the phrase, in the person's own casing.
  const ask = [cmd({ triggerPhrase: "ask about", action: { type: "ask" } })];
  const hit = m.matchCommand("ask about Ahmed Hassan", ask);
  expect(problems, "the tail is handed back", hit?.tail, "Ahmed Hassan");
  const noTail = m.matchCommand("ask about", ask);
  expect(problems, "and is empty when nothing followed", noTail?.tail, "");
  return verdict(problems);
}
```

Register as `["4. The matcher reads whole folded phrases, longest first, own scope first", check4]`.

- [ ] **Step 2: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — `m.matchCommand is not a function`.

- [ ] **Step 3: Export `fold`, then write the matcher**

In `src/modules/assistant/domain/voice.ts`, change line 80 from `function fold(text: string): string {` to `export function fold(text: string): string {` and add one line to its doc comment:

```
 * The wake phrase and the command matcher both read through this, and must: a
 * phrase the wake test folds one way and the command test folds another is two
 * wake words, and the person only ever set one.
```

Append to `commands.ts`:

```ts
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
   * reason, and this is its second instance rather than a third copy of it.
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
  const spoken = fold(transcript);
  if (!spoken) return null;
  const spokenTokens = tokensOf(spoken);
  if (spokenTokens.length === 0) return null;
  const rawWords = transcript.trim().split(/\s+/).filter(Boolean);

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
  return { command: best.command, tail: rawWords.slice(best.at + best.length).join(" ") };
}
```

- [ ] **Step 4: Run the proof**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `4/4 checks held, 0/0 mutations turned red.`

- [ ] **Step 5: Add group 4's mutation**

```js
await mutation(
  "2. The matcher accepting a substring instead of a run of tokens → check 4 red",
  DOMAIN_REL,
  "    if (haystack[at + index] !== needle[index]) return false;",
  "    if (!haystack[at + index]?.startsWith(needle[index])) return false;",
  async () => checkIsRed(4)
);
```

Run the proof. Expected: `4/4 checks held, 1/2 mutations turned red.` — A2's mutation now passes too, so the count is out of two.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/domain/voice.ts src/modules/assistant/domain/commands.ts scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): a spoken phrase is matched to a command on whole folded words, longest first"
```

---

## Task A4: Author migration 051 — and do not apply it

The table, its shape CHECKs, the two partial unique indexes, eight policies, the permission seed, four starters. `047` supplies the own-row policy shape; `049`/`050` supply the bare transaction idiom.

**Files:**
- Create: `db/migrations/051_jarvis_voice_commands.sql`
- Modify: `scripts/prove-jarvis-commands.mjs` (group 5 and its mutation)
- Read first: `db/migrations/047_assistant_jarvis_prefs.sql`, `db/migrations/050_jarvis_wake_phrase.sql`

**Interfaces:**
- Consumes: `current_user_profile_id()`, `is_staff()`, `has_permission(text)` — all already in the local schema (`047` and `001_settings_rbac.sql:216`).
- Produces: the table `public.assistant_jarvis_commands` and the permission key `assistant.commands`, both read by A5 and A7.

- [ ] **Step 1: Write the failing checks**

```js
async function check5() {
  const problems = [];
  const sql = read(MIGRATION_REL);
  const has = (label, needle) => {
    if (!sql.includes(needle)) problems.push(`${label}: missing ${JSON.stringify(needle)}`);
  };

  has("the table", "create table if not exists public.assistant_jarvis_commands");
  has("scope CHECK", "constraint assistant_jarvis_commands_scope_owner check");
  has("a personal row has an owner", "(scope = 'personal' and owner_profile_id is not null)");
  has("a shared row has none", "(scope = 'shared' and owner_profile_id is null)");
  has("phrase ceiling", "char_length(btrim(trigger_phrase)) between 2 and 64");
  has("no control characters", "trigger_phrase !~ '[\\u0000-\\u001F]'");
  has("title ceiling", "char_length(btrim(title)) between 1 and 80");
  has("notes ceiling", "char_length(notes) <= 500");
  has("payload size", "octet_length(action_payload::text) <= 4096");
  has("the six categories", "category in ('navigation','hiring','communication','reports','settings','personal')");
  has("the four action types", "action_type in ('ask','open','tool','note')");

  // Two indexes, not one coalesce: the same phrase may exist once per person and
  // once for the portal, which is what makes "Add to mine" possible at all.
  has("the personal phrase index",
    "create unique index if not exists assistant_jarvis_commands_personal_phrase");
  has("  on owner and folded phrase", "on public.assistant_jarvis_commands (owner_profile_id, lower(btrim(trigger_phrase)))");
  has("  scoped to personal", "where scope = 'personal'");
  has("the shared phrase index", "create unique index if not exists assistant_jarvis_commands_shared_phrase");
  has("  scoped to shared", "where scope = 'shared'");

  // RLS: four policies on the person's own rows, four on the portal's.
  has("row security is on", "alter table public.assistant_jarvis_commands enable row level security");
  const personal = [
    "assistant_jarvis_commands_personal_select",
    "assistant_jarvis_commands_personal_insert",
    "assistant_jarvis_commands_personal_update",
    "assistant_jarvis_commands_personal_delete",
  ];
  for (const name of personal) has(`policy ${name}`, `create policy ${name}`);
  const shared = [
    "assistant_jarvis_commands_shared_select",
    "assistant_jarvis_commands_shared_insert",
    "assistant_jarvis_commands_shared_update",
    "assistant_jarvis_commands_shared_delete",
  ];
  for (const name of shared) has(`policy ${name}`, `create policy ${name}`);
  has("own rows by profile id", "(select current_user_profile_id()) = owner_profile_id");
  has("and only by staff", "and is_staff()");
  has("shared writes behind the permission", "has_permission('assistant.commands')");

  // The permission and its grants.
  has("the permission row", "insert into public.permissions (key, label, group_name, description)");
  has("  named", "('assistant.commands', 'Publish shared JARVIS commands', 'Assistant',");
  has("  idempotent", "on conflict (key) do nothing");
  has("SUPER_ADMIN granted", "('SUPER_ADMIN', 'assistant.commands', true)");
  has("HIRING_MANAGER granted", "('HIRING_MANAGER', 'assistant.commands', true)");
  // No SUBSIDIARY_HR_MANAGER row: `user_role` cannot hold that value, so a grant
  // for it would be a matrix entry nobody can ever hold.
  if (sql.includes("'SUBSIDIARY_HR_MANAGER', 'assistant.commands'")) {
    problems.push("the migration grants a role the enum cannot hold");
  }

  // Four starters, navigation and saved-prompt only.
  has("the starters", "insert into public.assistant_jarvis_commands (scope, trigger_phrase, title, category, action_type, action_payload, notes)");
  has("  open candidates", "'open candidates', 'Open candidates', 'navigation', 'open', '{\"href\":\"/candidates\"}'::jsonb");
  has("  open the pipeline", "'open the pipeline', 'Open the pipeline', 'navigation', 'open', '{\"href\":\"/jobs\"}'::jsonb");
  has("  today's interviews", "'today''s interviews', 'Today''s interviews', 'hiring', 'ask',");
  has("  open the outbox", "'open the outbox', 'Open the outbox', 'communication', 'open', '{\"href\":\"/whatsapp\"}'::jsonb");
  if (sql.includes("'tool'")) problems.push("a seeded starter runs a tool; none may");

  has("grants to authenticated", "grant select, insert, update, delete on public.assistant_jarvis_commands to authenticated");
  has("service role", "grant all on public.assistant_jarvis_commands to service_role");
  has("anon kept out", "revoke all on public.assistant_jarvis_commands from anon");
  has("the updated_at trigger", "execute set_updated_at()");
  has("PostgREST reloads", "notify pgrst, 'reload schema'");
  return verdict(problems);
}
```

Register as `["5. 051 stores a command, scopes it, and gates the shared half", check5]`.

- [ ] **Step 2: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — group 5 reports the file missing (`read()` throws, reported as `threw:`).

- [ ] **Step 3: Write the migration**

Create `db/migrations/051_jarvis_voice_commands.sql`. The header comment follows the file's own convention **and** states the applied truth as it is *at authoring time*; the project rule is that an apply rewrites this header (see `migration-applied-state` in project memory), so it must say:

```sql
-- 051_jarvis_voice_commands.sql
-- JARVIS voice commands: phrases a person saves, and the action each one runs.
--
-- NOT APPLIED as of 2026-10-29. Applying this file needs its own named approval;
-- until it is applied the console and the presence say so and list nothing, which
-- is what scripts/prove-migration-claims.mjs checks the copy against.
--
-- A row is one person's (`scope = 'personal'`, an owner) or everybody's
-- (`scope = 'shared'`, no owner) — a CHECK says so, so a row cannot claim both and
-- a policy cannot be written against the wrong half. The same phrase may exist
-- once per person and once for the portal, which is what lets somebody add a
-- shared command to their own list and have theirs win.

begin;

create table if not exists public.assistant_jarvis_commands (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('personal', 'shared')),
  owner_profile_id uuid references public.user_profiles (id) on delete cascade,
  trigger_phrase text not null
    constraint assistant_jarvis_commands_phrase_shape check (
      char_length(btrim(trigger_phrase)) between 2 and 64
      and trigger_phrase !~ '[\u0000-\u001F]'
    ),
  title text not null
    constraint assistant_jarvis_commands_title_shape check (
      char_length(btrim(title)) between 1 and 80
    ),
  category text not null
    constraint assistant_jarvis_commands_category_shape check (
      category in ('navigation','hiring','communication','reports','settings','personal')
    ),
  action_type text not null
    constraint assistant_jarvis_commands_type_shape check (
      action_type in ('ask','open','tool','note')
    ),
  action_payload jsonb not null default '{}'::jsonb
    constraint assistant_jarvis_commands_payload_size check (
      octet_length(action_payload::text) <= 4096
    ),
  notes text
    constraint assistant_jarvis_commands_notes_shape check (
      notes is null or char_length(notes) <= 500
    ),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row is one person's, or everybody's, never both.
  constraint assistant_jarvis_commands_scope_owner check (
    (scope = 'personal' and owner_profile_id is not null)
    or (scope = 'shared' and owner_profile_id is null)
  )
);

-- Two partial indexes rather than one expression over a coalesced owner, so a
-- person's phrase and the portal's phrase are separate namespaces.
create unique index if not exists assistant_jarvis_commands_personal_phrase
  on public.assistant_jarvis_commands (owner_profile_id, lower(btrim(trigger_phrase)))
  where scope = 'personal';

create unique index if not exists assistant_jarvis_commands_shared_phrase
  on public.assistant_jarvis_commands (lower(btrim(trigger_phrase)))
  where scope = 'shared';

create index if not exists assistant_jarvis_commands_owner_scope
  on public.assistant_jarvis_commands (scope, owner_profile_id);

alter table public.assistant_jarvis_commands enable row level security;

-- The person's own rows, and only theirs. A delete policy exists here and not on
-- `assistant_jarvis_prefs` because a command is content its author may take back,
-- while a prefs row is the record that a choice was made.
create policy assistant_jarvis_commands_personal_select on public.assistant_jarvis_commands
  for select to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_insert on public.assistant_jarvis_commands
  for insert to authenticated with check (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_update on public.assistant_jarvis_commands
  for update to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  ) with check (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_delete on public.assistant_jarvis_commands
  for delete to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

-- Shared rows: everybody's to speak, and somebody's to write. Reading is open to
-- every staff member because a phrase a teammate published is a phrase the team
-- says; writing is behind a permission, because adding words the whole portal will
-- act on is a decision and not a default.
create policy assistant_jarvis_commands_shared_select on public.assistant_jarvis_commands
  for select to authenticated using (scope = 'shared' and is_staff());

create policy assistant_jarvis_commands_shared_insert on public.assistant_jarvis_commands
  for insert to authenticated with check (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

create policy assistant_jarvis_commands_shared_update on public.assistant_jarvis_commands
  for update to authenticated using (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  ) with check (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

create policy assistant_jarvis_commands_shared_delete on public.assistant_jarvis_commands
  for delete to authenticated using (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

grant select, insert, update, delete on public.assistant_jarvis_commands to authenticated;
grant all on public.assistant_jarvis_commands to service_role;
revoke all on public.assistant_jarvis_commands from anon;

insert into public.permissions (key, label, group_name, description)
values ('assistant.commands', 'Publish shared JARVIS commands', 'Assistant',
        'Add, edit and remove voice commands every recruiter can use')
on conflict (key) do nothing;

-- No SUBSIDIARY_HR_MANAGER row: `user_role` (db/schema.sql:99) does not hold that
-- value, so a grant for it would be a matrix entry nobody can ever hold. RECRUITER
-- is left to the matrix on purpose — see the spec's Privacy and authority.
insert into public.role_permissions (role_key, permission_key, granted)
values ('SUPER_ADMIN', 'assistant.commands', true),
       ('HIRING_MANAGER', 'assistant.commands', true)
on conflict (role_key, permission_key) do nothing;

-- Four starters, and not one of them a tool: a seeded write that a person did not
-- write is exactly the kind of thing that should wait for a click.
insert into public.assistant_jarvis_commands (scope, trigger_phrase, title, category, action_type, action_payload, notes)
values
  ('shared', 'open candidates', 'Open candidates', 'navigation', 'open', '{"href":"/candidates"}'::jsonb,
   'The candidate list, exactly as the rail opens it.'),
  ('shared', 'open the pipeline', 'Open the pipeline', 'navigation', 'open', '{"href":"/jobs"}'::jsonb,
   'The openings grid with its demand columns.'),
  ('shared', 'today''s interviews', 'Today''s interviews', 'hiring', 'ask',
   '{"prompt":"What interviews are scheduled today?"}'::jsonb,
   'Asks the assistant rather than opening a page, because the answer is a count.'),
  ('shared', 'open the outbox', 'Open the outbox', 'communication', 'open', '{"href":"/whatsapp"}'::jsonb,
   'The messaging queue with its rails.')
on conflict (lower(btrim(trigger_phrase))) where scope = 'shared' do nothing;

create trigger assistant_jarvis_commands_set_updated_at
  before update on public.assistant_jarvis_commands
  for each row execute set_updated_at();

select pg_cron_unschedule_if_exists… -- (not here: no schedule in this slice)

notify pgrst, 'reload schema';

commit;
```

**Two things in that draft are deliberately wrong and must be fixed while writing it** — this is the plan telling you what it could not settle in advance, not a placeholder:

1. `on conflict (lower(btrim(trigger_phrase))) where scope = 'shared' do nothing` is not valid `ON CONFLICT` syntax — an inference clause cannot carry a `WHERE` over a partial index that way. Use the form the starters actually need: `on conflict do nothing` is *also* insufficient, because there is no unique constraint on the whole table. The correct statement is `insert … select … where not exists (select 1 from public.assistant_jarvis_commands e where e.scope = 'shared' and lower(btrim(e.trigger_phrase)) = lower(btrim(<new phrase>)))` — or, simplest and consistent with `047`'s seed idiom, add `on conflict (id) do nothing` is *not* it either. **Decide between the `where not exists` guard and a `do nothing` on a newly-declared exclusion constraint, verify the file runs inside a rolled-back transaction on the local database (`docker compose exec -T postgres psql` with `begin; … rollback;`), and keep whichever answers check 5 with the starters inserted twice without a unique violation.** A migration nobody has executed once is a guess.
2. `select pg_cron_unschedule_if_exists…` is a stray line from a different migration. Delete it.

Group 5's check for the starters is written against the `insert into … values` form, so if the chosen shape becomes an `insert … select`, update that check's needle to the statement actually on disk — the check follows the file, not the other way round.

- [ ] **Step 4: Run the proof**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `5/5 checks held, 2/2 mutations turned red.`

- [ ] **Step 5: Add group 5's mutation**

```js
await mutation(
  "3. A shared row writable by any staff member → check 5 red",
  MIGRATION_REL,
  "    scope = 'shared' and is_staff() and has_permission('assistant.commands')\n  );\n\ncreate policy assistant_jarvis_commands_shared_update",
  "    scope = 'shared' and is_staff()\n  );\n\ncreate policy assistant_jarvis_commands_shared_update",
  async () => checkIsRed(5)
);
```

Run the proof. Expected: `5/5 checks held, 3/3 mutations turned red.`

- [ ] **Step 6: Prove it runs, without applying it**

The local database is the owner's real data, so the rehearsal is a transaction that cannot land:

```bash
docker compose exec -T postgres psql -U postgres -d sharm_dreams -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i /dev/stdin
rollback;
SQL
```

Paste the file's body between `begin` and `rollback` (or copy it into a temp file outside the repo and `\i` that). Expected: every statement succeeds, then `ROLLBACK`. Confirm afterwards that the table is **not** there:

```bash
docker compose exec -T postgres psql -U postgres -d sharm_dreams -tAc \
  "select to_regclass('public.assistant_jarvis_commands') is not null"
```

Expected: `f`. **If it returns `t`, the rollback did not happen and 051 was applied without approval — say so immediately and stop; do not attempt to undo it yourself.**

- [ ] **Step 7: Commit**

```bash
git add db/migrations/051_jarvis_voice_commands.sql scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): migration 051 authored for voice commands, unapplied by design"
```

---

## Task A5: The bounded reader, the sentence that names 051, and the claims proof

One read, under RLS, that answers three different questions — *the table is not there*, *the table could not be reached*, *there is nothing here yet* — and never confuses them.

**Files:**
- Create: `src/modules/assistant/application/jarvisCommands.ts`
- Modify: `scripts/prove-migration-claims.mjs` (the `051` entry)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 5's reader half rides inside checks 5 and 6; the reader's own behaviour is proved in group 2's harness style as checks 5a/5b inside group 5 — see Step 1)
- Read first: `src/modules/assistant/application/jarvisSettings.ts` (the ladder this mirrors)

**Interfaces:**
- Consumes: `createServerRestClient`, `normalizeCommandRow`, `CommandRow`, `VoiceCommand`.
- Produces: `VoiceCommandsRead`, `readVoiceCommands()`, `readVoiceCommand(id)`. A6's actions use `readVoiceCommand`; A7's console and A8's `PresenceRead` use `readVoiceCommands`.

- [ ] **Step 1: Write the failing checks**

Add these two to `scripts/prove-jarvis-commands.mjs` and register them **inside group 5's numbering** as `5.` continuation entries with their own numbers in the `CHECKS` array (`"5b. …"`, `"5c. …"` are acceptable spellings — the spec's six groups are six *topics*, and this file keeps the runner's flat numbering):

```js
async function check5b() {
  const problems = [];
  const m = await load(READER_URL);

  // Absent table: the error PostgREST gives a table nobody created.
  resetGlobals({ __jarvisRest: fakeRest({
    read: { data: null, error: { code: "42P01", message: 'relation "assistant_jarvis_commands" does not exist' } },
  })});
  const absent = await m.readVoiceCommands();
  expect(problems, "an absent table is a problem", absent.problem, "absent");
  expect(problems, "with no commands", absent.commands.length, 0);
  expect(problems, "and the file named", /051_jarvis_voice_commands\.sql is authored but not applied/.test(absent.message ?? ""), true);

  // Unreadable: an outage is not an unapplied file, and saying it was would send
  // the person to a migration they cannot run.
  resetGlobals({ __jarvisRest: fakeRest({
    read: { data: null, error: { code: "PGRST116", message: "connection timeout" } },
  })});
  const broken = await m.readVoiceCommands();
  expect(problems, "an outage is a different problem", broken.problem, "unreadable");
  expect(problems, "and does not name the migration", /051/.test(broken.message ?? ""), false);

  // Present and empty.
  resetGlobals({ __jarvisRest: fakeRest({ read: { data: [], error: null } })});
  const empty = await m.readVoiceCommands();
  expect(problems, "an empty list is not a problem", empty.problem, null);
  expect(problems, "and says so", empty.commands.length, 0);

  // Present with rows, personal and shared, merged in one read because RLS decides
  // what the person may see and the shim cannot filter both halves in one query.
  resetGlobals({ __jarvisRest: fakeRest({
    read: { data: [
      { id: "1", scope: "personal", owner_profile_id: "p1", trigger_phrase: "open mine", title: "Mine",
        category: "personal", action_type: "note", action_payload: { text: "hi" }, notes: null, enabled: true },
      { id: "2", scope: "shared", owner_profile_id: null, trigger_phrase: "open the outbox", title: "Outbox",
        category: "communication", action_type: "open", action_payload: { href: "/whatsapp" }, notes: null, enabled: true },
    ], error: null },
  })});
  const filled = await m.readVoiceCommands();
  expect(problems, "both halves arrive", filled.commands.map((c) => c.scope), ["personal", "shared"]);
  const calls = globalThis.__jarvisRest.__calls ?? [];
  expect(problems, "one table read, not one per scope",
    calls.filter((call) => call.table === "assistant_jarvis_commands").length, 1);

  // The cap, disclosed rather than silently applied.
  const many = Array.from({ length: 201 }, (_, index) => ({
    id: `m${index}`, scope: "personal", owner_profile_id: "p1", trigger_phrase: `phrase ${index}`,
    title: `T${index}`, category: "personal", action_type: "note",
    action_payload: { text: "x" }, notes: null, enabled: true,
  }));
  resetGlobals({ __jarvisRest: fakeRest({ read: { data: many, error: null } })});
  const capped = await m.readVoiceCommands();
  expect(problems, "the read is bounded", capped.commands.length, 200);
  expect(problems, "and says it was", capped.capped, true);
  return verdict(problems);
}

async function check5c() {
  const problems = [];
  const sql = read("scripts/prove-migration-claims.mjs");
  if (!sql.includes("051_jarvis_voice_commands.sql")) {
    problems.push("prove-migration-claims does not ask about 051");
  }
  if (!sql.includes("assistant_jarvis_commands")) {
    problems.push("the 051 probe does not name the table");
  }
  return verdict(problems);
}
```

The reader must be loadable by the harness, so `READER_URL` is `pathToFileURL(path.join(root, READER_REL)).href`, and `fakeRest()` must record `table` on every call: extend the copied `fakeRest` so its `from(table)` pushes `{ table, verb }` into the returned client's `__calls` array (the presence harness already records calls; add the table name to what it records if it does not).

- [ ] **Step 2: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — `Cannot find module ... application/jarvisCommands.ts`.

- [ ] **Step 3: Write the reader**

Create `src/modules/assistant/application/jarvisCommands.ts`:

```ts
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
const MIGRATION_MISSING = /42P01|PGRST205|PGRST204|does not exist|schema cache/i;
const TABLE = "assistant_jarvis_commands";
const ABSENT_MESSAGE =
  "db/migrations/051_jarvis_voice_commands.sql is authored but not applied, so no voice command is stored yet.";

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
 * one that a change to a policy would not reach.
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
    console.error("readVoiceCommands failed:", error.message);
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
```

Note on `profileId`: neither reader takes one, and that is the decision rather than an oversight. The list is the person's own rows plus the portal's shared rows, so a `.eq("owner_profile_id", …)` filter would delete the shared half of the feature, and RLS is what makes the read scoped (`src/app/(admin)/settings/jarvis-actions.ts`'s `getJarvisPresence` calls `requireStaff` before it, which is where the identity is actually established). A parameter nobody filters with would read as a second, weaker guard — so there is none.

- [ ] **Step 4: Add the `051` entry to the migration-claims proof**

In `scripts/prove-migration-claims.mjs`, append to `MIGRATIONS`:

```js
  {
    file: "051_jarvis_voice_commands.sql",
    asks: "select to_regclass('public.assistant_jarvis_commands') is not null as present",
  },
```

Match the exact object shape the neighbouring entries use (read the array first; if they carry more keys — a `title`, a `needle` — copy those from `050`'s entry).

This proof has a check that **the copy names every migration it asks about**, so adding the entry requires a sentence in `src/` that mentions `db/migrations/051_jarvis_voice_commands.sql`. `ABSENT_MESSAGE` above is that sentence, and `prove-migration-claims.mjs` scans `src/` only, reading the polarity within 200 characters of the path — which is why the two land in this task and not separately.

- [ ] **Step 5: Run both proofs**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `7/7 checks held, 3/3 mutations turned red.`

Run: `node --experimental-strip-types scripts/prove-migration-claims.mjs`
Expected: PASS. The 051 row reports the table absent and the copy says "authored but not applied" — the polarity the proof expects while 051 is unapplied.

- [ ] **Step 6: Typecheck and commit**

```bash
node_modules/.bin/tsc --noEmit
git add src/modules/assistant/application/jarvisCommands.ts scripts/prove-migration-claims.mjs scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): the command list is read once, under the policies that decide who sees it"
```

---

## Task A6: Five actions, and the permission that makes a shared row possible

The only place a command row is written. Scope and owner come from the session, never from the body.

**Files:**
- Create: `src/app/(admin)/settings/jarvis-command-actions.ts`
- Modify: `src/modules/settings/domain/types.ts:20` (the `PermissionKey` union)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 2's action half as check 2b, and group 6's permission half)
- Read first: `src/app/(admin)/settings/jarvis-actions.ts` (the guard and trail idiom), `src/modules/assistant/application/jarvisSettings.ts` (`saveJarvisPrefs`'s upsert and `recordActivity` shape)

**Interfaces:**
- Consumes: `requireStaff`, `hasPermissionForUser`, `recordActivity`, `createServerRestClient`, `parseCommandDraft`, `readVoiceCommands`, `readVoiceCommand`, `ASSISTANT_TOOLS`.
- Produces: `CommandWriteResult`, `saveCommand(draft, scope)`, `duplicateCommand(id)`, `deleteCommand(id)`, `setCommandEnabled(id, enabled)`, `adoptSharedCommand(id)`. Task A7's console calls all five; Task A8's `runJarvisCommand` calls none of them.

- [ ] **Step 1: Add the key to the union, and say what it grants**

In `src/modules/settings/domain/types.ts`, add `| "assistant.commands"` to `PermissionKey` beside the other `assistant.*` entries (read the union first and put it where its neighbours are, not at the end). Then run the repository's permission-description check if one exists (`grep -rn "permissions (key" scripts/` and `npm run` in [package.json](file:///D:/Nextjs%20Projects/sharm_dreams_group/package.json)) — this portal has a standing rule that **every permission the role matrix offers must decide something and carry a description**; the description is seeded in 051 and the matrix reads it from the table, so nothing else to write unless a check names a literal.

- [ ] **Step 2: Write the failing checks**

```js
async function check2b() {
  const problems = [];
  const actions = await load(ACTIONS_URL);
  const domain = await load(DOMAIN_URL);
  const row = {
    id: "c1", scope: "personal", owner_profile_id: "p1", trigger_phrase: "open mine",
    title: "Mine", category: "personal", action_type: "note",
    action_payload: { text: "hello" }, notes: null, enabled: true,
  };

  const user = { profileId: "p1", role: "SUPER_ADMIN" };
  const withRest = (rest, trail = []) =>
    resetGlobals({ __jarvisUser: user, __jarvisRest: rest, __jarvisTrail: trail });

  // A save writes the columns the table has, and no others.
  const rest = fakeRest({ read: { data: [row], error: null }, write: { error: null } });
  withRest(rest);
  const saved = await actions.saveCommand(
    { trigger_phrase: "open mine", title: "Mine", category: "personal",
      action_type: "note", action_payload: { text: "hello" }, notes: "", enabled: true },
    "personal"
  );
  expect(problems, "a good save succeeds", saved.ok, true);
  const insert = rest.__calls.find((call) => call.verb === "insert" || call.verb === "update");
  expect(problems, "the write went to the command table", insert?.table, "assistant_jarvis_commands");
  const body = insert?.body ?? {};
  // The two fields a body must never carry.
  expect(problems, "scope came from the argument", body.scope, "personal");
  expect(problems, "and the owner from the session", body.owner_profile_id, "p1");
  expect(problems, "every column the row shape has", Object.keys(body).sort(), [
    "action_payload", "action_type", "category", "enabled", "notes", "owner_profile_id",
    "scope", "title", "trigger_phrase",
  ]);

  // A shared save by an account without the permission is refused before the write.
  withRest(fakeRest({ read: { data: [row], error: null }, write: { error: null } }));
  globalThis.__jarvisPermission = false;
  const refused = await actions.saveCommand(
    { trigger_phrase: "open theirs", title: "Theirs", category: "personal",
      action_type: "note", action_payload: { text: "hi" }, notes: "", enabled: true },
    "shared"
  );
  expect(problems, "a shared save without the permission is refused", refused.ok, false);
  expect(problems, "in words about the permission", /permission/.test(refused.error ?? ""), true);
  globalThis.__jarvisPermission = true;

  // A duplicate phrase in the same scope is refused with the phrase quoted.
  const clash = fakeRest({
    read: { data: [row], error: null },
    write: { error: { code: "23505", message: "duplicate key value violates unique constraint" } },
  });
  withRest(clash);
  const dupe = await actions.saveCommand(
    { trigger_phrase: "open mine", title: "Other", category: "personal",
      action_type: "note", action_payload: { text: "hi" }, notes: "", enabled: true },
    "personal"
  );
  expect(problems, "a clash is refused", dupe.ok, false);
  expect(problems, "and names the field", dupe.field, "trigger_phrase");
  expect(problems, "quoting the phrase", /open mine/.test(dupe.error ?? ""), true);

  // An unapplied table is said as an unapplied table, not as a save failure.
  withRest(fakeRest({
    read: { data: null, error: { code: "42P01", message: "relation does not exist" } },
  }));
  const absent = await actions.saveCommand(
    { trigger_phrase: "new one", title: "New", category: "personal",
      action_type: "note", action_payload: { text: "hi" }, notes: "", enabled: true },
    "personal"
  );
  expect(problems, "an absent table refuses", absent.ok, false);
  expect(problems, "and names the file", /051_jarvis_voice_commands\.sql/.test(absent.error ?? ""), true);

  // Every write leaves a trail row.
  const trail = [];
  withRest(fakeRest({ read: { data: [row], error: null }, write: { error: null } }), trail);
  await actions.setCommandEnabled("c1", false);
  expect(problems, "a switch flip is trailed", trail.length >= 1, true);
  expect(problems, "as a settings change", trail[0]?.area, "settings");

  // Delete removes exactly one row, by id, and nothing else.
  const del = fakeRest({ read: { data: [row], error: null }, write: { error: null } });
  withRest(del);
  await actions.deleteCommand("c1");
  const deleted = del.__calls.filter((call) => call.verb === "delete");
  expect(problems, "one delete", deleted.length, 1);
  expect(problems, "scoped by id", JSON.stringify(deleted[0]?.filters ?? ""), /"eq"/.test(JSON.stringify(deleted[0]?.filters ?? "")) ? deleted[0].filters.some((f) => f[0] === "id") : true);

  // Adopt copies a shared row as the person's own, phrase and all.
  const adopt = fakeRest({
    read: { data: [{ ...row, scope: "shared", owner_profile_id: null, id: "s1" }], error: null },
    write: { error: null },
  });
  withRest(adopt);
  const taken = await actions.adoptSharedCommand("s1");
  expect(problems, "adopting succeeds", taken.ok, true);
  const copied = adopt.__calls.find((call) => call.verb === "insert");
  expect(problems, "as a personal row", copied?.body?.scope, "personal");
  expect(problems, "owned by the person", copied?.body?.owner_profile_id, "p1");
  expect(problems, "with the shared phrase", copied?.body?.trigger_phrase, "open mine");

  // Nothing in this file lets a body choose its scope.
  const source = read(ACTIONS_REL);
  expect(problems, "scope is never read from the draft", /draft\.scope|input\.scope/.test(source), false);
  expect(problems, "nor the owner", /draft\.owner_profile_id|input\.owner_profile_id/.test(source), false);
  return verdict(problems);
}
```

Two harness additions this check needs, both inside the copied stubs so nothing else changes:

```js
  "@/modules/settings/infrastructure/permissions": `
    export const hasPermissionForUser = async () => globalThis.__jarvisPermission !== false;
  `,
  "@/modules/assistant/domain/tools": `
    export const ASSISTANT_TOOLS = [
      { name: "list_candidates", label: "List candidates", args: {}, run: async () => "{}" },
      { name: "delete_candidate", label: "Delete a candidate", args: {}, destructive: true, run: async () => "{}" },
      { name: "search_web", label: "Search the web", args: {}, web: true, run: async () => "{}" },
    ];
  `,
```

and add `"__jarvisPermission"` to `GLOBAL_KEYS`, defaulting to `true` in `resetGlobals`'s patch. `fakeRest` must record `verb` and `body`/`filters` per call; extend the copied builder so each chainable method pushes what it was given (`{ table, verb: "select" | "insert" | "update" | "delete" | "upsert", body, filters: [] }` with `.eq()` appending `["eq", column, value]`).

Register as `["2b. The five actions write the columns the table has, and never a scope the body named", check2b]`.

- [ ] **Step 3: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — `Cannot find module ... settings/jarvis-command-actions.ts`.

- [ ] **Step 4: Write the actions**

Create `src/app/(admin)/settings/jarvis-command-actions.ts`:

```ts
"use server";

import { requireStaff } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import { ASSISTANT_TOOLS } from "@/modules/assistant/domain/tools";
import {
  parseCommandDraft,
  type CommandDraft,
  type VoiceCommand,
} from "@/modules/assistant/domain/commands";
import { readVoiceCommand, readVoiceCommands } from "@/modules/assistant/application/jarvisCommands";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

/**
 * Writing a spoken command.
 *
 * Five operations and one rule between them: `scope` and `owner_profile_id` are
 * decided here from the session and the argument, and are never taken from the
 * body. A draft that claimed `scope: "shared"` would otherwise be one `fetch` away
 * from somebody publishing a phrase the whole portal acts on.
 *
 * The guard path is the console's own address, `requireStaff`-checked the way
 * `jarvis-actions.ts` checks its two — a staff page the rail does not list is still
 * covered by `/settings`'s prefix, and `scripts/check-staff-routes.mjs` keeps it so.
 */
const GUARD = "/settings?area=assistant&section=commands";
const TABLE = "assistant_jarvis_commands";

export type CommandWriteResult =
  | { ok: true; command: VoiceCommand | null }
  | { ok: false; error: string; field?: keyof CommandDraft };

/** The columns, in the shape the table holds them. */
function toRow(command: VoiceCommand): Record<string, unknown> {
  return {
    scope: command.scope,
    owner_profile_id: command.ownerProfileId,
    trigger_phrase: command.triggerPhrase,
    title: command.title,
    category: command.category,
    action_type: command.action?.type ?? "",
    action_payload: command.action
      ? command.action.type === "ask"
        ? { ...(command.action.prompt ? { prompt: command.action.prompt } : {}) }
        : command.action.type === "open"
          ? { href: command.action.href }
          : command.action.type === "tool"
            ? { tool: command.action.tool, args: command.action.args }
            : { text: command.action.text }
      : {},
    notes: command.notes,
    enabled: command.enabled,
  };
}
```

`action_type` is the *type string*, not the action object — the table's CHECK accepts one of `ask`/`open`/`tool`/`note` there, and the object goes to `action_payload`. The `?? ""` is unreachable: a command with no action is never saved, because `parseCommandDraft` refuses one before `toRow` runs. Check 2b's column list is the proof that the key exists on every write.

Continue:

```ts
/** A REST error, in the two voices the person can act on. */
function refusal(error: { code?: string | null; message?: string | null }, draft: CommandDraft): string {
  const code = error.code ?? "";
  if (/42P01|PGRST205|PGRST204|does not exist|schema cache/i.test(`${code} ${error.message ?? ""}`)) {
    return "db/migrations/051_jarvis_voice_commands.sql is authored but not applied, so no command can be saved yet.";
  }
  if (code === "23505") {
    const phrase = typeof draft.trigger_phrase === "string" ? draft.trigger_phrase.trim() : "";
    return `Something already answers to “${phrase}” in this list. A phrase is one command, and the existing one keeps it.`;
  }
  return error.message ?? "The command could not be saved.";
}

async function trail(
  staff: { fullName: string; role: string },
  action: string,
  summary: string,
  detail: Record<string, unknown>
): Promise<void> {
  await recordActivity({
    area: "settings",
    actor: { kind: "human", profileId: staff.profileId ?? undefined, label: staff.fullName },
    action,
    summary,
    detail,
  } as never);
}

/**
 * Save one command.
 *
 * `scope` is a parameter and not a field: `personal` writes the session's own
 * profile id, and `shared` is open only to an account holding `assistant.commands`.
 * A shared row is written with no owner whatever the draft says, because the CHECK
 * in the table would refuse it anyway and refusing it at the door is the difference
 * between an error message and a database constraint.
 */
export async function saveCommand(draft: CommandDraft, scope: "personal" | "shared"): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const restClient = await createServerRestClient();
  const ownerProfileId = scope === "shared" ? null : staff.profileId;

  if (scope === "shared" && !(await hasPermissionForUser("assistant.commands"))) {
    return {
      ok: false,
      error: "Publishing a command every recruiter can use needs the assistant.commands permission, which this account does not have.",
    };
  }

  // The stored row, for the fields a draft is allowed to leave alone. A new command
  // has no previous, so its own defaults come from the door rather than from here.
  const { command: previous, read } = await readVoiceCommand(String(draft.id ?? ""));
  if (read.problem === "absent") return { ok: false, error: read.message ?? "" };

  const base: VoiceCommand = previous ?? {
    id: String(draft.id ?? crypto.randomUUID()),
    scope,
    ownerProfileId,
    triggerPhrase: "",
    title: "",
    category: "personal",
    rawCategory: null,
    action: null,
    notes: null,
    enabled: true,
    problem: null,
  };
  // A new row is written under the scope the argument named, whatever the previous
  // row's was — `previous` is only a source of stored values, never of authority.
  const scoped = { ...base, scope, ownerProfileId };

  const parsed = parseCommandDraft(draft, scoped, ASSISTANT_TOOLS);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field };

  const row = toRow(parsed.command);
  const isNew = previous === null;
  const { error } = isNew
    ? await restClient.from(TABLE).insert(row)
    : await restClient.from(TABLE).update(row).eq("id", parsed.command.id);

  if (error) return { ok: false, error: refusal(error, draft) };

  await trail(staff, isNew ? "command created" : "command updated",
    `${isNew ? "Created" : "Updated"} the voice command “${parsed.command.title}”`,
    { from: previous, to: parsed.command });

  // The list, so the console shows what the database holds rather than what the
  // form held — the two differ the first time a CHECK trims something.
  const after = await readVoiceCommands();
  return { ok: true, command: after.commands.find((entry) => entry.id === parsed.command.id) ?? parsed.command };
}
```

Then the other four, each with the same three properties: guarded, scoped by the session, trailed.

```ts
/** A copy under a new phrase, because a duplicate that clashes is not useful. */
export async function duplicateCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const restClient = await createServerRestClient();
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? "" };
  if (!command) return { ok: false, error: "That command is not in your list." };

  const phrase = `${command.triggerPhrase} copy`.slice(0, 64);
  const row = { ...toRow(command), trigger_phrase: phrase, title: `${command.title} (copy)`.slice(0, 80) };
  const { error } = await restClient.from(TABLE).insert(row);
  if (error) return { ok: false, error: refusal(error, { ...row, trigger_phrase: phrase }), field: "trigger_phrase" };

  await trail(staff, "command duplicated",
    `Duplicated the voice command “${command.title}”`, { from: command, to: phrase });
  return { ok: true, command: null };
}

/** Delete the person's own, or a shared one with the permission. RLS enforces both. */
export async function deleteCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const restClient = await createServerRestClient();
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? "" };
  if (!command) return { ok: false, error: "That command is not one this account can see." };
  if (command.scope === "shared" && !(await hasPermissionForUser("assistant.commands"))) {
    return { ok: false, error: "Removing a command every recruiter uses needs the assistant.commands permission." };
  }

  const { error } = await restClient.from(TABLE).delete().eq("id", command.id);
  if (error) return { ok: false, error: refusal(error, { id: command.id }) };

  await trail(staff, "command deleted", `Deleted the voice command “${command.title}”`,
    { from: command, to: null });
  return { ok: true, command: null };
}

/** Off means it still lists and still edits; the matcher simply never sees it. */
export async function setCommandEnabled(id: string, enabled: boolean): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const restClient = await createServerRestClient();
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? "" };
  if (!command) return { ok: false, error: "That command is not in your list." };

  const { error } = await restClient
    .from(TABLE)
    .update({ enabled: enabled === true })
    .eq("id", command.id);
  if (error) return { ok: false, error: refusal(error, { id: command.id }) };

  await trail(staff, "command switched",
    `${enabled === true ? "Enabled" : "Disabled"} the voice command “${command.title}”`,
    { from: { enabled: command.enabled }, to: { enabled: enabled === true } });
  return { ok: true, command: null };
}

/**
 * Take a shared command as your own.
 *
 * The phrase is kept, because that is the whole point: a personal row with the same
 * phrase wins the matcher's tie, which is how one person overrides one shared
 * command without changing it for anyone else. The write is a plain personal insert,
 * so the person's own unique index is what refuses it if they already have it.
 */
export async function adoptSharedCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const restClient = await createServerRestClient();
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? "" };
  if (!command) return { ok: false, error: "That command is not one this account can see." };
  if (command.scope !== "shared") return { ok: false, error: "That one is already yours." };

  const row = { ...toRow(command), scope: "personal", owner_profile_id: staff.profileId };
  const { error } = await restClient.from(TABLE).insert(row);
  if (error) return { ok: false, error: refusal(error, { trigger_phrase: command.triggerPhrase }), field: "trigger_phrase" };

  await trail(staff, "command adopted",
    `Added the shared voice command “${command.title}” to your own list`,
    { from: command, to: { scope: "personal" } });
  return { ok: true, command: null };
}
```

- [ ] **Step 5: Run the proof, then the typecheck**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `8/8 checks held, 3/3 mutations turned red.`

Run: `node_modules/.bin/tsc --noEmit`
Expected: no errors. `recordActivity`'s exact argument shape is the one `saveJarvisPrefs` uses — if the types disagree, copy the shape from `jarvisSettings.ts` rather than casting; the `as never` above is a marker that the real call must match the real signature, not a decision to keep a cast.

- [ ] **Step 6: Add group 6's permission mutation**

```js
await mutation(
  "4. A shared save that skips the permission → check 2b red",
  ACTIONS_REL,
  '  if (scope === "shared" && !(await hasPermissionForUser("assistant.commands"))) {',
  '  if (scope === "shared" && false) {',
  async () => checkIsRed(2) === false && (await check2b()).length > 0
);
```

If `checkIsRed` cannot express "a second check must now fail", call both checks inside the verify function as written and keep the `mutation()` signature the harness already has. Run the proof. Expected: `8/8 checks held, 4/4 mutations turned red.`

- [ ] **Step 7: Commit**

```bash
git add src/app/(admin)/settings/jarvis-command-actions.ts src/modules/settings/domain/types.ts scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): five actions write a voice command, and never a scope the body named"
```

---

## Task A7: The manager — Settings → Assistant → Voice commands

The console, the nav entry, the icon, and the orb's read gaining the list it matches on.

**Files:**
- Create: `src/app/(admin)/settings/JarvisCommandsConsole.tsx`
- Modify: `src/modules/settings/domain/settingsNav.ts:132-145` (third `ASSISTANT_SECTIONS` entry)
- Modify: `src/app/(admin)/settings/SettingsShell.tsx:31-49` (`mic: Mic` in `ICONS`)
- Modify: `src/app/(admin)/settings/page.tsx` (`AssistantPanel` branches; the `section === "commands"` server read)
- Modify: `src/app/(admin)/settings/jarvis-actions.ts:35-44` (`PresenceRead` gains `commands`)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 6's console half as check 6a)

**Interfaces:**
- Consumes: `readVoiceCommands`, the five actions from A6, `COMMAND_CATEGORIES`, `COMMAND_ACTION_TYPES`, `COMMAND_LIMITS`, `VoiceCommand`.
- Produces: `JarvisCommandsConsole` (client), `PresenceRead["commands"]` consumed by A8's `hear`.

- [ ] **Step 1: Register the section and the icon**

`settingsNav.ts` — append to `ASSISTANT_SECTIONS` (after `appearance`), leaving `DEFAULT_SECTION.assistant` on `presence`:

```ts
  {
    id: "commands",
    label: "Voice commands",
    hint: "Phrases you save so the orb does something instead of answering — open a page, run a tool, say a line.",
    icon: "mic",
  },
```

`SettingsShell.tsx` — add `Mic` to the `lucide-react` import and `mic: Mic,` to `ICONS`.

- [ ] **Step 2: Give the page and the presence read what the console needs**

`src/app/(admin)/settings/page.tsx` — in the assistant branch, read the list server-side beside the prefs so the console ships with its rows rather than waiting on a client round trip. Mirror how `PresenceConsole`/`AppearanceConsole` are fed (read the file first; the existing two take a server read as a prop):

```tsx
if (section === "commands") {
  const read = await readVoiceCommands();
  return <JarvisCommandsConsole initial={read} />;
}
```

No session read here: the page is already behind the staff layout's gate, the reader is RLS-scoped, and every write re-resolves the person in its own action — a `const staff` in this branch would be a binding nothing uses.

Use the same non-null-avoiding shape the neighbouring branches use — if they resolve the session through one shared helper, call that helper rather than `getSessionUser()` and a `!`.

`jarvis-actions.ts` — `PresenceRead`'s `ok` branch gains the list, and `getJarvisPresence` reads both in parallel so a command costs the orb no second fetch:

```ts
export type PresenceRead =
  | { ok: true; profileId: string; prefs: JarvisPrefs; commands: VoiceCommand[] }
  | { ok: false; profileId?: string; reason: JarvisUnarmed["reason"]; message: string };

export async function getJarvisPresence(): Promise<PresenceRead> {
  const user = await requireStaff("/assistant");
  const [seen, commands] = await Promise.all([
    jarvisPresenceForViewer(),
    readVoiceCommands(),
  ]);
  if ("reason" in seen) return { ok: false, profileId: user.profileId, ...seen };
  return { ok: true, profileId: user.profileId, prefs: seen, commands: commands.commands };
}
```

- [ ] **Step 3: Write the console**

`src/app/(admin)/settings/JarvisCommandsConsole.tsx` — `"use client"`, and these are the behaviours, each of which the page's own URL state carries:

```tsx
/**
 * The command manager.
 *
 * Two tabs behind `?tab=` because a shared command is a different thing to look at
 * from your own — one you may not be able to edit — and `?q=` because every other
 * console in this portal narrows its list through the address, so a chat link can
 * land on one phrase. The category chips are not in the URL: they are a glance, not
 * a destination, and a chip that became an address would be a fourth thing to keep
 * in step with the page.
 *
 * There is no live channel. `assistant_jarvis_commands` is not in the watch table
 * and the copy says the list reloads when you visit, because adding a poll for a
 * table almost nobody writes would put a request in front of every admin screen for
 * a change that happens once a quarter.
 */
export function JarvisCommandsConsole({ initial }: { initial: VoiceCommandsRead }) { … }
```

Required content, in this order:

1. **Header line** naming whose list it is, and the read's problem said out loud when there is one: `problem === "absent"` renders `initial.message` verbatim (it already names 051); `problem === "unreadable"` renders the outage sentence; `capped` renders "the list is showing the first 200". An empty list with no problem renders "No commands yet — add one and say its phrase after the wake word."
2. **Tabs** `Mine` / `Shared`, `?tab=mine` default, driven by `useSearchParams` + `useRouter().replace` the way the templates and AI-models consoles do (copy their exact query-merging helper if one exists — `grep -rn "tab=" src/app/\(admin\)/settings/`).
3. **Search** `?q=`, matched against phrase and title, folded with the domain's own `fold` (import it — it is exported now) so a search behaves like the matcher, not like `String.includes`.
4. **Category chips**, from `COMMAND_CATEGORIES`, local state only.
5. **Rows**: phrase in typographic quotes, title, category badge, action-type badge (`COMMAND_ACTION_TYPES` label), enable switch calling `setCommandEnabled`, and an expand control that reveals the editor. A row with `problem` renders the reason inline: `"category"` → `Uncategorised — this row names “${rawCategory}”, which this portal does not offer.`; `"action"` → `Switched off — this row's action cannot be read, so saying its phrase does nothing.`; `"phrase"` → `Switched off — the stored phrase is not one this portal can match.`
6. **Editor** for the five named fields plus the payload field for the chosen type: `open` a text input pre-filled with a staff path and a `list` of the rail's pages (import `NAV` from `src/modules/analytics/presentation/nav.ts` — read-only, and it is the same table the rail renders, so a command can only point at a page that exists); `tool` a select over `ASSISTANT_TOOLS` **minus** `destructive === true` and `web === true`, so the console cannot author a row dispatch would refuse; `ask` a textarea with the placeholder "Leave empty to ask whatever you say after the phrase."; `note` a single-line input with the 280-character counter. Notes textarea at the bottom with its 500 counter. Save / Duplicate / Delete with the delete confirmed inline (the portal's existing confirm pattern — do not use `window.confirm`).
7. **Refusals land where the person is**: the returned `field` names the input it refused (`setErrorField`), and the message is shown above the form, not in a toast that disappears.
8. **Add to mine** on every shared row; the shared rows are read-only, with one sentence saying so, when `!canPublish` — pass `canPublish` in as a prop from the page, resolved server-side with `hasPermissionForUser("assistant.commands")`, because the browser must not be the one deciding what it may edit.
9. **No audio, anywhere in this file.** Nothing here records, buffers or names a clip; a command is text.

- [ ] **Step 4: Prove the console statically**

```js
async function check6a() {
  const problems = [];
  const source = read("src/app/(admin)/settings/JarvisCommandsConsole.tsx");
  const nav = read("src/modules/settings/domain/settingsNav.ts");
  const actions = read("src/app/(admin)/settings/jarvis-actions.ts");

  expect(problems, "the section is registered", /id: "commands"/.test(nav), true);
  expect(problems, "and the default is still presence", /assistant: "presence"/.test(nav), true);
  expect(problems, "the console reads through the domain's fold", /from "@\/modules\/assistant\/domain\/commands"/.test(source) || /domain\/voice/.test(source), true);
  expect(problems, "no recorder in the manager", /MediaRecorder|getUserMedia/.test(source), false);
  expect(problems, "the shared tab refuses without a server answer", /canPublish/.test(source), true);
  expect(problems, "the presence read carries the commands", /commands: VoiceCommand\[\]/.test(actions), true);
  expect(problems, "in one parallel read", /Promise\.all\(\[/.test(actions), true);
  expect(problems, "and it names the guard it sits behind", /requireStaff\("\/assistant"\)/.test(actions), true);
  if (/assistant_jarvis_commands/.test(read("src/modules/live/domain/watchTables.ts") ?? "")) {
    problems.push("the command table joined the live watch; the spec says it must not");
  }
  return verdict(problems);
}
```

Adjust `read(...)` paths that do not exist verbatim (`grep -rn "LIVE_WATCH\|assistant_jarvis" src/modules/live/` to find the real watch table file) — the check is that the table name appears nowhere in the live channel, and a check against a path that does not exist would pass for the wrong reason.

Register as `["6a. The manager is registered, refuses without a server, and never touches a microphone", check6a]`. Run the proof: `9/9 checks held, 4/4 mutations turned red.`

- [ ] **Step 5: Lint, typecheck, and look at it**

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint "src/app/(admin)/settings/JarvisCommandsConsole.tsx" "src/app/(admin)/settings/jarvis-actions.ts" src/modules/settings/domain/settingsNav.ts
```

Then, with the owner's dev server already running on `localhost:3001` and **not restarted**: open Settings → Assistant → Voice commands and confirm the absent-table sentence is what renders (051 is unapplied, so an empty list with 051 named is the correct screen), that the tabs move `?tab=` and the box moves `?q=`, and that the page has no console errors. Do not attempt to save — saving against an unapplied table is the refusal path, and A6 already proves it offline.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(admin\)/settings/JarvisCommandsConsole.tsx "src/app/(admin)/settings/page.tsx" "src/app/(admin)/settings/jarvis-actions.ts" "src/app/(admin)/settings/SettingsShell.tsx" src/modules/settings/domain/settingsNav.ts scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): the voice command manager joins Settings → Assistant as its own section"
```

---

## Task A8: The seam — a phrase now does something

The orb matches a command before it hands the transcript to the model. Everything else in Part A exists to feed this one branch.

**Files:**
- Modify: `src/lib/jarvis-ui.ts` (`pendingCommand`, `requestJarvisCommand`, `takeJarvisCommandRequest`, `commandNote`)
- Modify: `src/modules/assistant/infrastructure/agent.ts:378` (`runTool` exported)
- Modify: `src/modules/assistant/infrastructure/transcriptStore.ts` (`appendCommandTurn`)
- Modify: `src/app/(admin)/assistant/actions.ts` (`runJarvisCommand`)
- Modify: `src/modules/assistant/presentation/JarvisPresence.tsx:185-205` (the `hear` branch only — the stage hotkey is Task B4's, not this task's)
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx` (the consumer)
- Modify: `scripts/prove-jarvis-commands.mjs` (group 6 and its mutation)

**Interfaces:**
- Consumes: `matchWakePhrase`, `matchCommand`, `VoiceCommand`, `runTool`, `readVoiceCommand`, `readVoiceAutonomy`, `appendCommandTurn`, `handToJarvisChat`. Of these the presence file already imports `matchWakePhrase` and `handToJarvisChat`; `matchCommand`, `runJarvisCommand` and the two store helpers are new imports there, and `readVoiceCommand`, `readVoiceAutonomy`, `runTool` and `appendCommandTurn` are new imports in `actions.ts` / `transcriptStore.ts`.
- Produces: `JarvisUiState.pendingCommand`, `JarvisUiState.commandNote`, `requestJarvisCommand(id, title)`, `takeJarvisCommandRequest()`, `setJarvisCommandNote(text | null)`, `runJarvisCommand({ commandId, sessionId })`, `CommandTurnResult`.

- [ ] **Step 1: Write the failing checks**

```js
async function check6() {
  const problems = [];
  const presence = read(PRESENCE_REL);
  const runner = read(RUNNER_REL);
  const store = read(STORE_REL);
  const agent = read("src/modules/assistant/infrastructure/agent.ts");
  const chat = read(CHAT_REL);

  // The order inside `hear` is the whole feature: a command is consulted before the
  // transcript is handed to the model, and never after.
  const hearStart = presence.indexOf("const hear = useCallback(");
  // Bounded by the callback's own closing, not by a guessed `],` that may or may not
  // appear in its body: everything inside these two markers is `hear`, nothing more.
  const hearEnd = presence.indexOf("\n  );", hearStart);
  const hearBody = presence.slice(hearStart, hearEnd);
  const matchAt = hearBody.indexOf("matchCommand(");
  const handoffAt = hearBody.indexOf("handToJarvisChat(");
  expect(problems, "hear is a callback the check can bound", hearStart > -1 && hearEnd > hearStart, true);
  expect(problems, "hear consults the matcher", matchAt > -1, true);
  expect(problems, "before the hand-off it replaces", matchAt < handoffAt, true);
  expect(problems, "and the wake phrase is matched once",
    (hearBody.match(/matchWakePhrase\(/g) ?? []).length, 1);

  // Stop words still win: the barge-in branch is above the command branch.
  expect(problems, "the stop test precedes the matcher",
    hearBody.indexOf("isStopCommand(") < matchAt, true);

  // Dispatch per type.
  expect(problems, "open navigates", /router\.push\(command\.href\)|router\.push\(action\.href\)/.test(presence), true);
  expect(problems, "ask uses the existing hand-off", /handToJarvisChat\(action\.prompt \?\? tail\)/.test(presence), true);
  expect(problems, "note speaks and shows", /setJarvisCommandNote\(/.test(presence), true);
  expect(problems, "tool asks the chat to run it", /requestJarvisCommand\(/.test(presence), true);
  expect(problems, "and the orb never calls the runner itself",
    /await runJarvisCommand/.test(presence), false);

  // The store's slot: one request, taken once.
  expect(problems, "the store has the slot", /pendingCommand:/.test(store), true);
  expect(problems, "a setter", /export function requestJarvisCommand/.test(store), true);
  expect(problems, "and a taker that clears it", /export function takeJarvisCommandRequest/.test(store), true);

  // The server half: both switches false, and the run recorded as a turn.
  expect(problems, "runTool is exported", /export async function runTool/.test(agent), true);
  expect(problems, "the command door calls it false/false",
    /runTool\([\s\S]{0,200}?false,\s*[\s\S]{0,80}?profileId,\s*[\s\S]{0,80}?false,/.test(runner), true);
  expect(problems, "and re-reads the row instead of trusting the browser",
    /readVoiceCommand\(/.test(runner), true);
  expect(problems, "a refusal is not a silent turn",
    /step\.ok|refused/.test(runner), true);
  expect(problems, "the turn is persisted through the store", /appendCommandTurn\(/.test(runner), true);
  expect(problems, "and the chat is what consumes the request", /takeJarvisCommandRequest\(\)/.test(chat), true);

  // No path from a command to a write skips the approval card: `runTool` is the only
  // door and it mints the card itself, so the seam must not reach past it.
  expect(problems, "nothing calls a writer directly from the command path",
    /runApprovedChange/.test(runner), false);
  expect(problems, "and nothing logs a phrase that matched nothing",
    /console\.(log|info)\(/.test(presence.slice(hearStart, presence.indexOf("],", hearStart))), false);
  return verdict(problems);
}
```

Register as `["6. A spoken phrase reaches a command before the model, and a tool still waits for a click", check6]`.

- [ ] **Step 2: Run and see it fail**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: FAIL — group 6 reports the matcher is not consulted (`hear consults the matcher: expected true, got false`).

- [ ] **Step 3: Give the store the one-slot request**

`src/lib/jarvis-ui.ts` — inside `JarvisUiState`, beside `pendingUtterance`:

```ts
  /**
   * A `tool` command the orb was asked to run, waiting for the conversation to pick
   * it up. One slot, taken once: the orb owns no session, so the surface that holds
   * the conversation is the surface that runs the tool and renders the card.
   */
  pendingCommand: { commandId: string; title: string; token: number } | null;
  /** A `note` command's line, shown on the orb's card until the next thing says more. */
  commandNote: string | null;
```

Add both to `IDLE` (`null`, `null`), and at the foot of the file:

```ts
let commandToken = 0;

/**
 * Ask the conversation to run a saved tool.
 *
 * The title travels because the card is shown before the row is read, and a turn
 * that says "a command ran" tells nobody anything. It is a label, not authority:
 * `runJarvisCommand` re-reads the row by id and nothing the browser sent about the
 * tool or its arguments is used.
 */
export function requestJarvisCommand(commandId: string, title: string): void {
  state = { ...state, pendingCommand: { commandId, title, token: (commandToken += 1) } };
  emit();
}

export function takeJarvisCommandRequest(): { commandId: string; title: string } | null {
  const pending = state.pendingCommand;
  if (!pending) return null;
  state = { ...state, pendingCommand: null };
  emit();
  return { commandId: pending.commandId, title: pending.title };
}

export function setJarvisCommandNote(text: string | null): void {
  if (state.commandNote === text) return;
  state = { ...state, commandNote: text };
  emit();
}
```

Follow the file's existing guard idiom exactly — if its setters compare before assigning through a helper rather than inline, use that helper; the checks above only require that an unchanged note does not emit.

- [ ] **Step 4: Export `runTool`**

`src/modules/assistant/infrastructure/agent.ts:378` — `async function runTool(` becomes `export async function runTool(`, and add to its doc comment the one sentence that explains a second caller:

```
 * Exported for `runJarvisCommand`, which is the only other place a tool runs by
 * name; both go through the same approval mint, so a saved command cannot be a
 * write that nobody clicked.
```

- [ ] **Step 5: Persist a command turn**

`src/modules/assistant/infrastructure/transcriptStore.ts` — `appendCommandTurn`, built from `appendApprovalOutcome` two functions above it, with the same "every row carries every column" rule:

```ts
/**
 * A turn a spoken command made.
 *
 * Two rows, not one: a user turn naming the command and an assistant turn carrying
 * the step. The pair is what makes the saved conversation say that a command ran,
 * which command it was, and what came of it — a single assistant row would read like
 * the assistant answered a question nobody asked. `engine` is the session's own
 * `auto`: a command is not an engine choice, and the CHECK on `assistant_sessions`
 * permits only the three the panel offers, which is why this could not reuse
 * `saveAssistantTurn` and its engine argument.
 */
export async function appendCommandTurn(input: {
  sessionId: string;
  title: string;
  reply: string;
  steps: AssistantStep[];
}): Promise<SaveTurnResult> {
  const ownerId = await currentProfileId();
  if (!ownerId) return { ok: false, error: "No staff profile is attached to this session." };

  const restClient = await createServerRestClient();
  const { data: existing } = await restClient
    .from("assistant_sessions")
    .select("id")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That conversation no longer exists." };

  // Both stamps are set here rather than left to `now()`, exactly as `saveAssistantTurn`
  // does at `:127-131` of this file: the read orders by `created_at` ascending (`:281`),
  // so a command and its answer inserted in the same millisecond would come back either
  // way, and "Run the voice command" would land after its own result.
  const askedAt = new Date();
  const answeredAt = new Date(askedAt.getTime() + 1);

  // Every row carries every column: in a bulk insert PostgREST takes the column list
  // from the first object, so a key only one row has would be dropped on the way in and
  // hit a not-null column (`:133-135` says the same thing about the turn a person typed).
  const rows = [
    {
      session_id: input.sessionId,
      owner_id: ownerId,
      role: "user",
      content: `Run the voice command “${input.title}”.`,
      steps: [],
      model: null,
      provider: null,
      note: null,
      attachment_name: null,
      attachment_text: null,
      created_at: askedAt.toISOString(),
    },
    {
      session_id: input.sessionId,
      owner_id: ownerId,
      role: "assistant",
      content: input.reply,
      steps: withoutStepFileBytes(input.steps ?? []),
      model: null,
      provider: null,
      note: null,
      attachment_name: null,
      attachment_text: null,
      created_at: answeredAt.toISOString(),
    },
  ];

  const { error } = await restClient.from("assistant_messages").insert(rows);
  if (error) return { ok: false, error: error.message };

  await restClient
    .from("assistant_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.sessionId);

  return { ok: true, sessionId: input.sessionId };
}
```

**Why two rows and staggered stamps, not one:** `appendApprovalOutcome` (`:191-230`)
inserts a single assistant row because the question is already on the record. A command
has no typed question — the words the microphone heard are never stored, by design — so
the turn the person sees needs a user row saying which command ran, and that row has to
land *before* its answer. Hence the 1 ms stagger rather than `now()` twice: the same
reason `saveAssistantTurn` gives at `:127-131`, in this file, on the same read
(`:281` orders ascending). `withoutStepFileBytes` is already imported here for the typed
turn (`:4`) and is used again for the same reason — a step may hold generated-file bytes
that must not go into the transcript.

- [ ] **Step 6: The command door**

`src/app/(admin)/assistant/actions.ts`, beside `sendAssistantMessage`:

```ts
export interface CommandTurnResult {
  ok: boolean;
  reply?: string;
  steps?: AssistantStep[];
  sessionId?: string;
  saveError?: string;
  error?: string;
}

/**
 * Run a saved `tool` command.
 *
 * Three things this refuses to be: a browser's description of the command (the row
 * is re-read by id, and only its tool name and arguments are used), a wider door
 * than the panel's switches (`allowDestructive` and `allowWeb` are hard-coded false
 * here, so a saved command cannot reach a tool the person has switched off, and
 * cannot reach one the manager would not have let them save), and a write that
 * nobody clicked (`runTool` mints the approval itself and returns the card's words).
 *
 * The turn is appended whether the step succeeded or refused, because a command that
 * did nothing is a fact about the conversation: leaving it out would make the saved
 * transcript read as though the phrase was never said.
 */
export async function runJarvisCommand(input: {
  commandId: string;
  sessionId?: string | null;
}): Promise<CommandTurnResult> {
  const staff = await requireStaff("/assistant");
  const id = typeof input?.commandId === "string" ? input.commandId.trim() : "";
  if (!id) return { ok: false, error: "No command was named." };

  const { command } = await readVoiceCommand(id);
  if (!command) return { ok: false, error: "That command is not one this account can use." };
  if (!command.enabled || command.action === null) {
    return { ok: false, error: `“${command.title}” is switched off, so nothing ran.` };
  }
  if (command.action.type !== "tool") {
    return { ok: false, error: `“${command.title}” is not a tool command, so nothing ran.` };
  }

  const autonomy = (await readVoiceAutonomy(staff.profileId)).level;
  // Only the step is taken. `runTool` also returns the JSON string a model would have
  // been handed, and a command has no model in the loop — the card's own words are the
  // whole answer, and the raw result does not belong in a saved transcript.
  const { step } = await runTool(
    command.action.tool,
    command.action.args as ToolArgs,
    false,
    staff.profileId,
    false,
    autonomy
  );

  const refused = step.ok === false;
  const reply = refused
    ? `**${command.title} — refused.**\n\n${step.detail}`
    : `**${command.title} ran.**\n\n${step.detail}`;

  const sessionId = typeof input.sessionId === "string" ? input.sessionId : null;
  const saved = sessionId ? await appendCommandTurn({ sessionId, title: command.title, reply, steps: [step] }) : null;

  return {
    ok: !refused,
    reply,
    steps: [step],
    sessionId: sessionId ?? undefined,
    saveError: saved && !saved.ok ? saved.error : undefined,
  };
}
```

**`runTool`'s `result` string is deliberately not returned.** The step already carries
what the person sees; the raw JSON is what the model would have been handed, and a command
has no model in the loop.

**Do not wrap this call in `withActivityContext`.** It looks like the right thing to copy
from `approveAssistantChange` (`actions.ts:479`, which wraps `runApprovedChange` with
`{ via }`), and it would be wrong here: `runTool` does not perform a write, it *mints the
approval* and returns the card's words (`agent.ts:418-422`). The write happens when the
person clicks, inside `approveAssistantChange`, which already takes `via` from its own
input — `AssistantChat`'s `approve()` passes `"assistant"` for a click and
`"assistant voice"` only for a code spoken into the strip (`AssistantChat.tsx:601-617`).
A command's card is clicked by a hand, so the trail must say `assistant`, which is what
it already says. Wrapping the mint would put a `via` on a turn that changed nothing.

- [ ] **Step 7: The seam itself**

`JarvisPresence.tsx` — add `useRouter` from `next/navigation` and `matchCommand` from the domain, plus `setJarvisCommandNote` / `requestJarvisCommand` from the store; `usePathname()` arrives in B4, not here. `matchWakePhrase` and `handToJarvisChat` are already imported (`:12`, `:22`) and `wakeRemainder` is not needed at all. Replace lines 185–205:

```tsx
  const commands = presence?.ok ? presence.commands : [];

  /**
   * What a matched command does, and the only place a saved phrase becomes an action.
   *
   * Three of the four need no server: a page opens with the router, a question goes
   * through the hand-off the orb already used, a note is spoken and shown. The
   * fourth is a tool, and the orb owns no conversation — so it asks the surface that
   * does to run it, which is what puts the approval card in front of the person
   * rather than leaving a write to a component that cannot render one.
   */
  const runCommand = useCallback(
    (command: VoiceCommand, tail: string) => {
      const action = command.action;
      if (!action) return;
      if (action.type === "open") {
        router.push(action.href);
        return;
      }
      if (action.type === "ask") {
        // The saved prompt if there is one, otherwise the person's own words after
        // the phrase — which is why an `ask` with no prompt is not a broken row.
        handToJarvisChat(action.prompt ?? tail);
        return;
      }
      if (action.type === "note") {
        setJarvisCommandNote(action.text);
        void say(action.text);
        return;
      }
      setJarvisOpen(true);
      requestJarvisCommand(command.id, command.title);
    },
    [router, say]
  );

  const hear = useCallback(
    (text: string) => {
      if (heardOwnVoice(text)) return;
      if (voice.speaking && isStopCommand(text)) {
        stop();
        setStopped(true);
        return;
      }
      const phrase = wakePhrase;
      const heard = matchWakePhrase(text, phrase);
      if (!heard.matched && !ui.awaiting) return;
      setStopped(false);
      // A click is what lets a tab make a sound at all, and a wake phrase said out
      // loud is not one — so the audio is unlocked here, at the moment the person
      // chose to speak to the assistant, rather than at the next briefing.
      wakeAudio();
      tone("heard");

      const matched = matchCommand(text, commands);
      if (matched) {
        // Matched on the whole utterance, not on `heard.remainder`: the matcher folds
        // for itself, and the tail it hands back is taken from the raw words. Give it
        // the folded remainder and the tail is folded too, so an `ask` would save a
        // question in the machine's casing instead of the speaker's.
        runCommand(matched.command, matched.tail);
        return;
      }
      setJarvisOpen(true);
      handToJarvisChat(text);
    },
    [heardOwnVoice, runCommand, stop, tone, ui.awaiting, voice.speaking, wakeAudio, wakePhrase, commands]
  );
```

**`heard` is only a gate now.** The existing line 194 is `if (!matchWakePhrase(text, phrase).matched && !ui.awaiting) return;` and the new branch does not need the folded `remainder`, so keep the local if you like it for the guard, but do not feed `heard.remainder` to `matchCommand` — see the comment above. `wakeRemainder` stays un-imported: this file never used it before this task and still does not, because the matcher's own tail takes the raw words.

**The tail is an alignment, not a parse.** `matchCommand` counts tokens in folded space and slices in whitespace-separated raw words, so a tail is only exact while every word before the boundary folds to one token (a comma or an apostrophe sits inside a word, and `"a,b"` folds to two). The portal already accepts that trade in `wakeRemainder` (`src/modules/assistant/domain/voice.ts:122-127`) and the matcher's group-4 mutation proves the run-of-tokens rule, which is the part that decides whether a command fires at all. Where a mis-tail would cost something — an `ask` that saves a slightly clipped question — the person sees the saved turn in the chat and can retype it, so this plan does not add a second matcher to make the slice exact.

- [ ] **Step 8: The chat consumes the request**

`AssistantChat.tsx` — beside the existing `useJarvisHandoff` call:

```tsx
  // A tool command the orb was asked to run. Taken once, on the token, so a
  // re-render cannot run the same change twice — which is the reason the store hands
  // out a request rather than holding one the chat watches.
  useEffect(() => {
    const token = jarvisUi.pendingCommand?.token;
    if (!token) return;
    const request = takeJarvisCommandRequest();
    if (!request) return;
    void runCommandTurn(request);
  }, [jarvisUi.pendingCommand?.token]);

  async function runCommandTurn(request: { commandId: string; title: string }) {
    if (inFlightRef.current) return;
    setPending(true);
    inFlightRef.current = true;
    try {
      const result = await runJarvisCommand({ commandId: request.commandId, sessionId });
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "user", text: `Run the voice command “${request.title}”.` },
        {
          id: nextId(),
          role: "assistant",
          text: result.reply ?? result.error ?? "The command could not run.",
          steps: result.steps,
        },
      ]);
      if (result.sessionId) onSessionChange(result.sessionId);
      setSaveError(result.saveError ?? null);
      if (!result.ok && result.error) setError(result.error);
    } catch {
      setError("The command could not be reached. Nothing has changed.");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }
```

Match the real `ChatMessage` field names (read the type before writing this — `steps`, `note`, `model`, `provider` are all optional on the assistant shape). The two messages are appended locally **and** persisted server-side by the action; that duplication is what `approveAssistantChange` already does with `appendApprovalOutcome`, and it is the reason the card stops being clickable after one click.

- [ ] **Step 9: The note card feeds on the store**

In `JarvisPresence.tsx`, `candidate` (line 289) becomes — with the command's line first, because a person who just spoke a phrase and got a refusal wants to see that, not last week's briefing:

```tsx
  const candidate = storeNote ?? notice ?? lines ?? watcher.error ?? wake.error ?? readProblem;
```

where `const storeNote = ui.commandNote;` and the dismiss button also calls `setJarvisCommandNote(null)` alongside its existing three calls. The `dismissedAnnouncement` latch already keeps a closed note closed, since it compares text.

- [ ] **Step 10: Run the proof and add group 6's mutation**

Run: `node --experimental-strip-types scripts/prove-jarvis-commands.mjs`
Expected: `10/10 checks held, 4/4 mutations turned red.`

```js
await mutation(
  "5. A command consulted after the hand-off → check 6 red",
  PRESENCE_REL,
  "      const matched = matchCommand(heard.matched ? heard.remainder : text, commands);",
  "      const matched = null; // hand off first",
  async () => checkIsRed(6)
);
```

Run again. Expected: `10/10 checks held, 5/5 mutations turned red.`

- [ ] **Step 11: Typecheck, lint, and prove the whole of Part A**

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src/modules/assistant src/app/\(admin\)/assistant src/app/\(admin\)/settings src/lib/jarvis-ui.ts
node --experimental-strip-types scripts/prove-jarvis-presence.mjs
node --experimental-strip-types scripts/prove-jarvis-corner.mjs
node --experimental-strip-types scripts/prove-jarvis-reactor.mjs
node --experimental-strip-types scripts/prove-jarvis-appearance.mjs
node --experimental-strip-types scripts/prove-jarvis-editor.mjs
```

All must pass — 051 is unapplied, so the orb's `commands` array is empty and every existing presence proof sees the behaviour it saw yesterday. `prove-jarvis-corner.mjs` is the one to watch: it pins the orb's corner classes, and this task must not have touched them (B4 does).

- [ ] **Step 12: Live pass, no microphone**

On `localhost:3001`, with the owner signed in: the orb still opens on `Ctrl+Space`, the dock still answers a typed question, and an approval card still appears for a write. Nothing about a phrase can be proved without a microphone, and 051 is unapplied, so **the command path cannot be reached live in this task** — say exactly that in the report rather than implying the seam was exercised.

- [ ] **Step 13: Commit**

```bash
git add src/lib/jarvis-ui.ts src/modules/assistant/infrastructure/agent.ts src/modules/assistant/infrastructure/transcriptStore.ts "src/app/(admin)/assistant/actions.ts" "src/app/(admin)/assistant/AssistantChat.tsx" src/modules/assistant/presentation/JarvisPresence.tsx scripts/prove-jarvis-commands.mjs
git commit -m "feat(assistant): a wake phrase can now run a saved command before it reaches the model"
```

---

# Part B — The Stage

The stage is a second way to look at the same conversation. It is a route, not a flag;
the shell goes bare on it; the orb already in the shell changes where it stands; and the
chat is the same `AssistantChat` with a third variant. No new conversation store, no new
session table, no second microphone.

**The one arithmetic the whole part depends on.** The orb's canvas is a square of
`STAGE_ORB_PX` (200) whose top-left is placed at the viewport centre by
`fixed left-1/2 top-1/2`, so its centre sits at `(50vw + 100, 50vh + 100)`. A
`transform: translate(T) scale(s)` moves a point by `T` and scales about the
transform origin — the translate is **not** multiplied by the scale, because the
functions compose right-to-left on the point. So placing the drawn centre at `P` needs
`T = P − C`, whatever `s` is.

| | derivation | value |
| --- | --- | --- |
| turned centre, from the edge | `STAGE_ORB_INSET_PX + STAGE_ORB_EDGE_PX / 2` | `24 + 48 = 72` |
| `--jv-x` on a wide screen | `(100vw − 72) − (50vw + 100)` | `calc(50vw - 172px)` |
| `--jv-x` below `lg` | the centred value kept: top-centre on a phone | `-50%` ( = −100px) |
| `--jv-y` | `72 − (50vh + 100)` | `calc(-50vh - 28px)` |
| the gutter the chat keeps clear | `STAGE_ORB_EDGE_PX + 2 * STAGE_ORB_INSET_PX` | `96 + 48 = 144` |

A centred orb at `translate(-50%, -50%) scale(1)` lands its centre exactly on
`(50vw, 50vh)`; a turned one adds the two figures above and lands 72 px in from the top
and, at `lg` and up, 72 px in from the right. Below `lg` the horizontal term stays
`-50%`, so the orb turns to **top-centre** rather than escaping the narrow screen.

---

## Task B1: The geometry is one number the orb and the chat both read

**Why a module for five integers:** the orb reserves nothing and the chat reserves room
for a rectangle it does not draw. Two figures that must agree cannot live in two files,
and a proof that recomputes them from names can catch a change to one.

**Files:**
- Create: `src/modules/assistant/domain/stage.ts`
- Modify: `src/lib/jarvis-ui.ts:20-47` (the state, its `IDLE`), and add one setter below `setJarvisAwaiting` (`:154-157`)
- Create: `scripts/prove-jarvis-stage.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `STAGE_ROUTE`, `STAGE_ORB_PX`, `STAGE_ORB_SCALE`, `STAGE_ORB_INSET_PX`,
  `STAGE_ORB_EDGE_PX`, `STAGE_ORB_GUTTER_PX`, `STAGE_ORB_CENTRE_PX`,
  `stageOrbTransformVars(turned: boolean): { x: string; y: string; s: string }` (B4 only —
  B1 defines it, B4 consumes it); `JarvisUiState.stageTurns: number`;
  `setJarvisStageTurns(turns: number): void`.

- [ ] **Step 1: Write the failing proof**

Create `scripts/prove-jarvis-stage.mjs`. This file is `node:test`, not a mutation harness —
the shape to copy is `scripts/prove-jarvis-reactor.mjs:1-28` (read the file, transpile it
with the `typescript` package, `new Function` with a `local(name)` stub resolver that maps
`@/` to `src/<name>.ts`, then `test(...)` blocks). Run it with
`node scripts/prove-jarvis-stage.mjs`; Node's own runner prints `ℹ pass N / ℹ fail 0`.

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function load(rel) {
  const file = path.join(root, rel);
  const sandbox = { exports: {} };
  const local = (name) => {
    if (name === "react") return { useState: (v) => [v, () => {}], useEffect() {}, useMemo: (fn) => fn() };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(local, sandbox, sandbox.exports);
  return sandbox.exports;
}

const stage = load("src/modules/assistant/domain/stage.ts");
const { setJarvisStageTurns, readJarvisUi, subscribeJarvisUi } = load("src/lib/jarvis-ui.ts");

test("group 1a — the geometry is self-consistent", () => {
  assert.equal(stage.STAGE_ROUTE, "/assistant/stage");
  // The drawn edge, the inset and the gutter are one derivation, not four guesses.
  assert.equal(stage.STAGE_ORB_EDGE_PX, Math.round(stage.STAGE_ORB_PX * stage.STAGE_ORB_SCALE));
  assert.equal(stage.STAGE_ORB_CENTRE_PX, stage.STAGE_ORB_INSET_PX + stage.STAGE_ORB_EDGE_PX / 2);
  assert.equal(stage.STAGE_ORB_GUTTER_PX, stage.STAGE_ORB_EDGE_PX + 2 * stage.STAGE_ORB_INSET_PX);
  assert.equal(stage.STAGE_ORB_PX, 200);
  assert.equal(stage.STAGE_ORB_SCALE, 0.48);
  assert.equal(stage.STAGE_ORB_INSET_PX, 24);
  // Groups 4 and 5 pin literal classes that spell this number; pin the number here so
  // they cannot quietly start agreeing with each other about something else.
  assert.equal(stage.STAGE_ORB_GUTTER_PX, 144);
});

test("group 1b — the translate is the target centre minus the placed centre", () => {
  // translate() is not multiplied by scale(): the delta is in unscaled pixels.
  const turned = stage.stageOrbTransformVars(true);
  const centred = stage.stageOrbTransformVars(false);
  assert.deepEqual(centred, { x: "-50%", y: "-50%", s: "1" });
  assert.equal(turned.s, "0.48");
  assert.equal(turned.x, "calc(50vw - 172px)");   // 50vw − (CENTRE + PX/2): the delta, not the target
  assert.equal(turned.y, "calc(-50vh - 28px)");   // CENTRE − (50vh + PX/2)
});

test("group 1c — the store carries turn counts without an emit for the same number", () => {
  let notifies = 0;
  const off = subscribeJarvisUi(() => {
    notifies += 1;
  });
  setJarvisStageTurns(3);
  assert.equal(readJarvisUi().stageTurns, 3);
  assert.equal(notifies, 1);
  setJarvisStageTurns(3);
  assert.equal(notifies, 1, "a re-report of the same count must not re-render the shell");
  setJarvisStageTurns(0);
  assert.equal(readJarvisUi().stageTurns, 0);
  off();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-jarvis-stage.mjs`
Expected: `Cannot find module ... src/modules/assistant/domain/stage.ts`.

- [ ] **Step 3: Write the domain module**

Create `src/modules/assistant/domain/stage.ts`.

```ts
/**
 * The stage's geometry, in one file.
 *
 * The presence draws the orb and the conversation keeps room for it; a figure that
 * exists twice can disagree, and the disagreement is a transcript under a floating
 * circle. Everything here is CSS pixels, and every class a surface builds from it is
 * a literal, because Tailwind purges a class it would have to assemble at runtime.
 */

export const STAGE_ROUTE = "/assistant/stage";

/** The orb's canvas on the stage — the same canvas, scaled by CSS, never re-initialised. */
export const STAGE_ORB_PX = 200;

/** How small the orb draws itself once there is something on screen to read. */
export const STAGE_ORB_SCALE = 0.48;

/** How far the turned orb sits from the viewport's top and right edges. */
export const STAGE_ORB_INSET_PX = 24;

export const STAGE_ORB_EDGE_PX = Math.round(STAGE_ORB_PX * STAGE_ORB_SCALE);

/** The turned orb's centre, measured in from the edge it is tucked against. */
export const STAGE_ORB_CENTRE_PX = STAGE_ORB_INSET_PX + STAGE_ORB_EDGE_PX / 2;

/** What the conversation keeps clear of the orb: its edge and an inset on each side. */
export const STAGE_ORB_GUTTER_PX = STAGE_ORB_EDGE_PX + 2 * STAGE_ORB_INSET_PX;

export interface StageOrbVars {
  x: string;
  y: string;
  s: string;
}

/**
 * The three custom properties the wrapper's inline `transform` reads.
 *
 * `translate()` is not multiplied by `scale()` — the two functions compose, so the
 * delta is in unscaled pixels and is simply the wanted centre minus the centre the
 * `fixed left-1/2 top-1/2` placement already produced. The wide-screen horizontal
 * term is a class; the value returned here is the figure that class must spell, so a
 * changed constant and an unchanged class fails a proof instead of moving the orb to
 * somewhere nobody looked.
 */
export function stageOrbTransformVars(turned: boolean): StageOrbVars {
  if (!turned) return { x: "-50%", y: "-50%", s: "1" };
  return {
    x: `calc(50vw - ${STAGE_ORB_CENTRE_PX + STAGE_ORB_PX / 2}px)`,
    y: `calc(-50vh - ${STAGE_ORB_PX / 2 - STAGE_ORB_CENTRE_PX}px)`,
    s: String(STAGE_ORB_SCALE),
  };
}
```

**Read the derivation before accepting the strings.** `fixed left-1/2 top-1/2` puts the
box's *left/top edge* at 50vw/50vh, so its centre sits at `(50vw + 100, 50vh + 100)` —
the wanted centre minus that placed centre is the delta, and because `scale()` composes
after `translate()` the delta is in unscaled pixels: `50vw − (72 + 100)` = `50vw − 172`,
and `72 − (50vh + 100)` = `−50vh − 28`. Group 1b asserts those two strings, and Task B4's
literal classes must spell the same two lengths with `_` for a space — group 5 compares
them against this function rather than against a second copy of the number.

**`stageOrbTransformVars` has no runtime caller, and that is deliberate.** The values
have to reach the element as Tailwind classes, and the `lg` breakpoint means one of them
cannot come from an inline style at all; so the orb's classes are literals and this
function is what the proof derives the literals from. Do not "fix" that by calling it
inside `className` — a class Tailwind has to assemble is a class that gets purged.

**Two places this plan leaves the spec's file map, for reasons worth stating:**
`STAGE_ORB_GUTTER_PX` lives here rather than in `src/lib/jarvis-ui.ts`, because that file
is the presence's client store and a CSS figure is not state; the spec's requirement —
that the chat column and the orb read one number so the reserved space cannot drift —
is met by the literal-class pinning in groups 1a, 4 and 5. And `AssistantStage.tsx` lives
beside its own `page.tsx` under `stage/` rather than one level up beside
`AssistantConsole.tsx`, because the route segment is the only thing that renders it.

- [ ] **Step 4: Add the store field and setter**

In `src/lib/jarvis-ui.ts`, add to `JarvisUiState` (after `prefsEpoch`, `:35`):

```ts
  /** Turns in the conversation the stage is showing; 0 means the orb keeps the middle. */
  stageTurns: number;
```

and to `IDLE` (`:38-47`): `stageTurns: 0,`. Then, beside the other setters:

```ts
/** The stage asks the orb to step aside once — not on every re-render. */
export function setJarvisStageTurns(turns: number): void {
  if (state.stageTurns === turns) return;
  emit({ ...state, stageTurns: turns });
}
```

- [ ] **Step 5: Run the proof, then the whole jarvis set**

```bash
node scripts/prove-jarvis-stage.mjs
node scripts/prove-jarvis-presence.mjs
node scripts/prove-jarvis-reactor.mjs
node scripts/prove-jarvis-corner.mjs
node scripts/prove-jarvis-appearance.mjs
node scripts/prove-jarvis-editor.mjs
```

Expected: the new file green; the six others green — `IDLE` gained one field and nothing
read a field that changed.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
node node_modules/typescript/bin/tsc --noEmit
npx eslint src/modules/assistant/domain/stage.ts src/lib/jarvis-ui.ts scripts/prove-jarvis-stage.mjs
git add src/modules/assistant/domain/stage.ts src/lib/jarvis-ui.ts scripts/prove-jarvis-stage.mjs
git commit -m "feat(assistant): the stage's geometry has one home the orb and the chat both read"
```

---

## Task B2: The conversation has a third look

`AssistantChat` is already shared by the dock and the page; the stage is the same body
with a different container. It also becomes the thing that tells the orb a turn has
landed, because it is the only surface that knows.

**Files:**
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx:129` (the variant union), `:641` (`wide`), `:907` (the scroller's classes), `:1077` (the footer's), and one new effect
- Test: `scripts/prove-jarvis-stage.mjs` (group 2 appended)

**Interfaces:**
- Consumes: `setJarvisStageTurns` (B1).
- Produces: `AssistantChatProps.variant: "docked" | "page" | "stage"`. The store's
  `stageTurns` is written by the stage's chat and reset to 0 when that chat unmounts.

- [ ] **Step 1: Append the failing group**

```js
test("group 2 — the stage variant reserves the gutter and reports its turns", () => {
  const source = readFileSync(path.join(root, "src/app/(admin)/assistant/AssistantChat.tsx"), "utf8");
  assert.match(source, /variant: "docked" \| "page" \| "stage"/);
  assert.match(source, /setJarvisStageTurns\(messages\.length\)/);
  assert.match(source, /setJarvisStageTurns\(0\)/);
  // `wide` is the max-w-3xl measure: a stage line of text at full width is unreadable.
  assert.match(source, /const wide = variant !== "docked"/);
  // Only the dock gets the sessions button; a stage is not a second copy of the rail.
  assert.match(source, /variant === "docked" && \(\n          <button/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-jarvis-stage.mjs` → group 2 red on the union.

- [ ] **Step 3: Make the four edits**

Widening `wide` is one line (`:641`); the scroller (`:907`) and footer (`:1077`) both
keep their `variant === "page"` ternaries — a stage is roomy, so replace each condition
with `variant !== "docked"`. The header (`:820`) needs no change; `px-4` for the page
only. Then:

```tsx
export interface AssistantChatProps {
  sessionId: string | null;
  onSessionChange: (sessionId: string) => void;
  onNewConversation: () => void;
  /** `stage` is the full-viewport surface: the same body, kept clear of the orb. */
  variant: "docked" | "page" | "stage";
  voiceMode?: "dictate" | "console";
}
```

```tsx
  const wide = variant !== "docked";
```

The gutter is padding on the *container* the stage page owns (B3), not on this
component's own elements — so the only thing added here is the report:

```tsx
  /**
   * The orb steps aside when this surface has something to read, and goes back to the
   * middle when it has nothing. Unmounting resets it: leaving the stage must not leave
   * a corner orb standing over the portal.
   */
  useEffect(() => {
    if (variant !== "stage") return;
    setJarvisStageTurns(messages.length);
    return () => setJarvisStageTurns(0);
  }, [variant, messages.length]);
```

Import `setJarvisStageTurns` beside `readJarvisUi` and `subscribeJarvisUi` (`:78-79`) and
nothing from `stage.ts`: the gutter is padding on the container B3 owns, so group 4 is
where that figure gets pinned, not here.

**The spec's "composer is a bottom-centred pill at every stage state" needs no new
markup, and saying so is part of this task.** `AssistantChat` returns a fragment whose
footer is already `shrink-0` (`:1077`) at the bottom of the column and already wraps its
contents in `mx-auto max-w-3xl` when `wide` (`:1078`), and `wide` becomes true for the
stage in Step 3. So the composer is bottom-centred and measure-limited at both stage
states — centred orb and turned orb — from classes that exist. Prove it in the browser
(B4 Step 10) by typing the first question while the orb is still in the middle; if the
composer is not reachable in that state, the bug is in B3's container, not here.

- [ ] **Step 4: Run the proofs**

```bash
node scripts/prove-jarvis-stage.mjs
node scripts/prove-jarvis-commands.mjs
node scripts/prove-jarvis-presence.mjs
```

Expected: green. The dock and the page render from the same code with the same classes
as before (`variant !== "docked"` is true for `"page"` exactly where `variant === "page"`
was), and no chat other than the stage's ever writes `stageTurns`.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
node node_modules/typescript/bin/tsc --noEmit
npx eslint "src/app/(admin)/assistant/AssistantChat.tsx"
git add "src/app/(admin)/assistant/AssistantChat.tsx" scripts/prove-jarvis-stage.mjs
git commit -m "feat(assistant): the conversation gains a stage look and tells the orb when a turn lands"
```

---

## Task B3: The route, and the shell that goes bare on it

**Files:**
- Create: `src/app/(admin)/assistant/stage/page.tsx`
- Create: `src/app/(admin)/assistant/stage/AssistantStage.tsx`
- Modify: `src/modules/analytics/presentation/AdminShell.tsx` — one early return after line 305
- Test: `scripts/prove-jarvis-stage.mjs` (groups 3 and 4 appended)

**Interfaces:**
- Consumes: `AssistantChat` with `variant="stage"` (B2); `STAGE_ROUTE` (B1). The gutter
  reaches this file as a literal class that group 4 pins against `STAGE_ORB_GUTTER_PX`.
- Produces: the route `/assistant/stage`; the shell's bare branch; no new export.

- [ ] **Step 1: Append the failing groups**

```js
test("group 3 — the route guards itself and reads the session, not the query", () => {
  const source = readFileSync(path.join(root, "src/app/(admin)/assistant/stage/page.tsx"), "utf8");
  assert.match(source, /await connection\(\)/);
  assert.match(source, /requireStaff\("\/assistant"\)/);
  assert.match(source, /export const instant = false/);
  // The stage reuses the conversation the page already saves to, and needs nothing else.
  assert.match(source, /<AssistantStage initialSessionId=\{session\} \/>/);
});

test("group 4 — the shell is bare and the stage keeps the orb's gutter", () => {
  const shell = readFileSync(path.join(root, "src/modules/analytics/presentation/AdminShell.tsx"), "utf8");
  assert.match(shell, /if \(pathname === STAGE_ROUTE\)/);
  // The one orb survives the bare branch; the dock and the live chrome do not.
  assert.match(shell, /<JarvisPresence user=\{user\} timeZone=\{timeZone\} \/>\n      \)/);
  assert.equal(shell.split("<JarvisPresence").length - 1, 2, "the shell renders the orb in exactly two branches");
  const stageView = readFileSync(path.join(root, "src/app/(admin)/assistant/stage/AssistantStage.tsx"), "utf8");
  // The gutter is a literal class spelled from the constant group 1a pins: `pt-` is the
  // narrow form (orb top-centre, answers below it), `lg:pr-` the wide one (answers to
  // the orb's left). Both must be the same number the orb reserves.
  const gutter = String(stage.STAGE_ORB_GUTTER_PX);
  assert.ok(stageView.includes(`pt-[${gutter}px]`), "the narrow gutter must be the constant");
  assert.ok(stageView.includes(`lg:pr-[${gutter}px]`), "the wide gutter must be the same constant");
  assert.match(stageView, /variant="stage"/);
  assert.match(stageView, /voiceMode="console"/);
  // Two ways out, because the spec says Escape on its own is not discoverable.
  assert.match(stageView, /event\.key !== "Escape"/);
  assert.match(stageView, /router\.push\("\/assistant"\)/);
  assert.match(stageView, /Exit stage/);
  assert.ok(!/AssistantDock|<LiveChrome/.test(stageView), "the stage page does not mount a second conversation or a second chrome");
});
```

Group 4's `split` count is the load-bearing one: a third `JarvisPresence` would give the
portal two microphones' worth of claims and two orbs.

- [ ] **Step 2: Run and watch them fail**

Run: `node scripts/prove-jarvis-stage.mjs` → groups 3 and 4 red on missing files.

- [ ] **Step 3: The server half**

Create `src/app/(admin)/assistant/stage/page.tsx`, following `../page.tsx` exactly — the
same `connection()`, the same `requireStaff` with the parent path as its return target,
the same `instant = false`, and `searchParams` read the way that file reads `session`:

```tsx
import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { AssistantStage } from "./AssistantStage";

/** Auth-gated: whether this page renders at all is session-dependent. */
export const instant = false;

/** The saved conversation to open, the same way the assistant page names one. */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata = {
  title: "JARVIS · Stage",
  description: "Talk to the assistant with the whole screen, and read the answer beside it",
};

export default async function AssistantStagePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  // The call is the guard. The stage shows nothing per-person beyond the conversation,
  // which `AssistantChat` reads for itself, so there is no `staff` to pass down.
  await requireStaff("/assistant");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;

  return <AssistantStage initialSessionId={session} />;
}
```

Verified against `../page.tsx` while writing this: that file calls
`await requireStaff("/assistant")` and reads `staff.profileId` only for the autonomy
panel this route has no business rendering, and it passes nothing to
`AssistantConsole` but `initialSessionId`. `AssistantStage` therefore takes one prop —
which is also why the shell's own `<JarvisPresence user={user} timeZone={timeZone} />`
(`AdminShell.tsx:408`) keeps its props: the orb needs the person's saved prefs, the page
around it does not.

- [ ] **Step 4: The client half**

Create `src/app/(admin)/assistant/stage/AssistantStage.tsx`. It owns the container the
gutter belongs to, and the `?session=` replace the console already does
(`AssistantConsole.tsx:87-94` — copy that `open()` idiom, including `scroll: false`; the
stage has no rail, so a first turn naming its own session must not add a second entry to
history that the back button then has to walk through).

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AssistantChat } from "../AssistantChat";
import { STAGE_ROUTE } from "@/modules/assistant/domain/stage";

/**
 * The stage: one conversation, full viewport, and a column that stays out of the
 * orb's way. The chrome is gone because a screen built for talking is not a screen
 * built for scanning — and because a second dock would be a second conversation
 * fighting this one for the utterance the orb hands over.
 */
export function AssistantStage({ initialSessionId }: { initialSessionId: string | null }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const reported = useRef<string | null>(initialSessionId);

  // Escape is ours here, not the browser's: the Fullscreen API is not in use, so there
  // is no native exit to fight. The visible button below exists because this is not.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      router.push("/assistant");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    // `pt-[144px]` is STAGE_ORB_GUTTER_PX and group 4 refuses to let it drift; below lg
    // the orb is top-centre so the transcript starts under that band. At lg and above
    // the orb is top-right, so the band collapses and the same figure moves to the
    // right — the answer column then ends where the orb's reserved space begins.
    <div className="fixed inset-0 z-30 flex min-h-0 flex-col bg-brand-ivory pt-[144px] lg:pt-6 lg:pr-[144px]">
      <Link
        href="/assistant"
        className="absolute left-4 top-2 z-10 inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Exit stage
      </Link>

      <AssistantChat
        sessionId={sessionId}
        onSessionChange={(id) => {
          if (reported.current === id) return;
          reported.current = id;
          setSessionId(id);
          router.replace(`${STAGE_ROUTE}?session=${encodeURIComponent(id)}`, { scroll: false });
        }}
        onNewConversation={() => {
          reported.current = null;
          setSessionId(null);
          router.replace(STAGE_ROUTE, { scroll: false });
        }}
        variant="stage"
        voiceMode="console"
      />
    </div>
  );
}
```

**Four things this file settles, and why each is settled rather than left:**

1. **No `user` and no `timeZone`.** `AssistantChat` takes neither, and the stage draws no
   clock the page header used to show. Accepting two props and ignoring them would be a
   lie about what the route needs; group 3 asserts the one-prop call.
2. **The gutter is two literal classes, not an inline style.** A `style` padding cannot be
   overridden by a `lg:` class, and the narrow and wide forms of the gutter are different
   properties (`pt-` against `lg:pr-`), so the value has to be spelled per breakpoint.
   `STAGE_ORB_GUTTER_PX` is 144 (Task B1, group 1a) and group 4 builds both class names
   from that constant, so changing the number without changing the classes fails.
3. **`bg-brand-ivory` matches the shell's own root** (`AdminShell.tsx:308`) — verified
   while writing this — or leaving the stage flashes a different white.
4. **`min-h-0` on the container is load-bearing,** because the chat's scroller is
   `flex-1 overflow-y-auto` (`AssistantChat.tsx:907`) inside this column: without it the
   transcript cannot scroll and the composer is pushed off the bottom. Prove that in the
   browser (Step 7), not from the class list.

- [ ] **Step 5: The shell's bare branch**

In `src/modules/analytics/presentation/AdminShell.tsx`, insert after `toggleRail()`
(`:302-305`) and before the `return (` at `:307`:

```tsx
  /**
   * The stage: the same shell, with nothing in it but the page and the orb. The rail,
   * the app bar, the drawer, the live chrome and the dock are all dropped here, and
   * `JarvisPresence` is kept mounted in this branch and nowhere else on the route, so
   * there is still exactly one microphone owner and exactly one thing that reacts.
   */
  if (pathname === STAGE_ROUTE) {
    return (
      <div className="min-h-screen bg-brand-ivory text-brand-ink">
        <NavigationPending collapsed={collapsed} />
        {children}
        <JarvisPresence user={user} timeZone={timeZone} />
      </div>
    );
  }
```

Import `STAGE_ROUTE` from `@/modules/assistant/domain/stage`. Decide, and say in the
commit message, whether `NavigationPending` belongs on a screen with no navigation: it
is the route-change progress bar, and the stage's own Escape handler navigates — so
keeping it is defensible and dropping it is too, but an accidental third option is
"the bar renders under a `fixed inset-0` surface and nobody sees it, so why is it
mounted". If you drop it, drop the line above, not the import used by the main branch.

Leave everything else alone: the `document.body.style.overflow` effect only acts while
the drawer is open, and the drawer cannot open on this branch. The early return sits
after every hook, so hook order is unchanged — `useActiveIntoView` (`:299-300`) and the
`viewTransitionName` rail are simply not rendered.

- [ ] **Step 6: Run the proofs, the route gate, and typecheck**

```bash
node scripts/prove-jarvis-stage.mjs
node scripts/check-staff-routes.mjs
node scripts/prove-jarvis-presence.mjs
node scripts/prove-jarvis-corner.mjs
node node_modules/typescript/bin/tsc --noEmit
npx eslint "src/app/(admin)/assistant/stage" src/modules/analytics/presentation/AdminShell.tsx
```

Expected: all green. `check-staff-routes.mjs` passes **because** `/assistant/stage` is
under the `/assistant` prefix in `STAFF_ROUTES` and the script only enumerates top-level
`page.tsx` files — if it *fails*, the reason is that `isStaffPath` does not treat a
nested page as covered, and that is a real finding to raise, not a table row to add.

- [ ] **Step 7: Live pass, no microphone**

On `localhost:3001` with the owner signed in, at `http://localhost:3001/assistant/stage`:

- the rail, app bar and dock are gone; the orb is in the middle;
- typing a question in the composer and sending it makes the orb glide to the top-right
  and the answer render beside it, in the same column the page uses;
- the transcript scrolls to its own bottom and the composer stays on screen — this is
  the `min-h-0` claim from Step 4, and it is only true if the flex column reaches the
  scroller;
- pressing Escape returns to `/assistant`, and the orb is back in the bottom-right corner;
- the **Exit stage** button in the top-left does the same thing, and is where a person who
  has never read the Guide will find the way out;
- the browser back button leaves the stage; reload on the stage comes back to the stage;
- the composer still offers the engine switch, the model settings, and a saved session
  opens from `?session=` on the URL.

Nothing here arms a microphone. Do not arm one.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(admin)/assistant/stage/page.tsx" "src/app/(admin)/assistant/stage/AssistantStage.tsx" src/modules/analytics/presentation/AdminShell.tsx scripts/prove-jarvis-stage.mjs
git commit -m "feat(assistant): /assistant/stage puts the conversation on the whole screen"
```

---

## Task B4: The orb moves — three positions, one owner

**Files:**
- Modify: `src/modules/assistant/presentation/JarvisReactor.tsx:67` (the surface is only a button when there is something to open)
- Modify: `src/modules/assistant/presentation/JarvisPresence.tsx` — `:242-254` (the hotkeys), `:257-266` (`state`), `:289-290` (`candidate`/`announcement`), `:302` (`canRest`), `:312-320` (the root's classes), `:338-352` (the note card), `:355-375` (the wrapper, the size, the click), plus the `hear` hand-off A8 already rewrote
- Modify: `src/app/(admin)/assistant/AssistantDock.tsx:209-232` (the Stage link between the resize button and the close button)
- Test: `scripts/prove-jarvis-stage.mjs` (group 5 appended), and the existing `scripts/prove-jarvis-corner.mjs` / `prove-jarvis-reactor.mjs`

**Interfaces:**
- Consumes: `STAGE_ROUTE` and (only under Step 1's route 1) `STAGE_ORB_PX` from B1, `ui.stageTurns` (B1, written by B2); `setJarvisOpen`, `wakeAudio`, `toggleJarvisOpen`. `stageOrbTransformVars` is consumed by this task's **proof**, not by the component.
- Produces: nothing new for later tasks but the Guide copy (B5), which describes the two hotkeys and the three positions.

- [ ] **Step 1: Settle the canvas question in the browser before writing the classes**

`JarvisReactor` passes `size` to a wrapper `<div style={{ width: size, height: size }}>` and hands the upstream orb a fixed `size="avatar"` prop (`JarvisReactor.tsx:85-99`), while `JarvisPresence`'s own comment claims "the canvas is a fixed 104 px square and CSS scales it, so shrinking never re-initialises the WebGL scene". Those two facts do not obviously agree, and which one is true decides the stage's route:

1. **Try `size={STAGE_ORB_PX}` (200).** Load `/assistant/stage`, and measure the drawn circle with the browser's own inspector on the `canvas` element.
2. **If the circle is 200 px**, keep this route and write Step 2 as given.
3. **If the circle stays ~104 px inside a 200 px box**, keep `size={104}` and make the scale do the growing instead: `stageOrbTransformVars` gains a third argument, the canvas it is scaling, and returns `s: STAGE_ORB_PX / canvas` turned-off and `STAGE_ORB_EDGE_PX / canvas` turned-on. **Then the centre maths in B1's table is unchanged** — it is written against the *drawn* edge, which is 200 and 96 either way — but B1's proof group 1b and this task's group 5 must both be updated to the new `s` values in the same commit, and the `--jv-s` class literals below are then wrong and must be replaced by the two ratios spelled as literals (`[--jv-s:1.9231]`, `[--jv-s:0.9231]`).
4. Record which route the measurement chose, in the commit message. A 200 px box around a 104 px canvas is a visible bug (the note card and the gutter would both be sized against empty air), so this step is not optional.

- [ ] **Step 2: Append the failing group**

```js
test("group 5 — one orb, three positions, and the shell's hotkeys", () => {
  const presence = readFileSync(path.join(root, "src/modules/assistant/presentation/JarvisPresence.tsx"), "utf8");
  // The route is read, not stored: a reload and the back button both agree with the screen.
  assert.match(presence, /usePathname\(\)/);
  assert.match(presence, /const onStage = pathname === STAGE_ROUTE/);
  assert.match(presence, /const turned = onStage && ui\.stageTurns > 0/);
  // The vars are literal classes (Tailwind purges what it must assemble) and the
  // transform list itself is inline, so scale and translate cannot be split.
  // Each literal is compared against the derivation, never against a second copy of
  // the number: change a STAGE_ORB_* constant and leave a class alone and this turns
  // red. `_` is how Tailwind spells a space inside an arbitrary value.
  const turned = stage.stageOrbTransformVars(true);
  const centred = stage.stageOrbTransformVars(false);
  const asClass = (value) => value.replace(/ /g, "_");
  assert.ok(presence.includes(`[--jv-x:${asClass(centred.x)}]`), "the centred horizontal term");
  assert.ok(presence.includes(`[--jv-y:${asClass(turned.y)}]`), "the turned vertical term");
  assert.ok(presence.includes(`[--jv-s:${asClass(turned.s)}]`), "the turned scale");
  assert.ok(presence.includes(`lg:[--jv-x:${asClass(turned.x)}]`), "the turned horizontal term, wide screens only");
  // The un-turned state is the inline fallback, so it must read as the centred vars.
  assert.ok(
    presence.includes(`translate(var(--jv-x, ${centred.x}), var(--jv-y, ${centred.y})) scale(var(--jv-s, ${centred.s}))`),
    "the transform list falls back to the centred position"
  );
  assert.match(presence, /duration-500/);
  // Off the stage the inline transform must be absent, or it beats the resting classes.
  assert.match(presence, /style=\{onStage \? stageTransform : undefined\}/);
  assert.match(presence, /onStage \? "origin-center" : "origin-bottom-right"/);
  assert.match(presence, /const canRest = !ui\.open && state === "idle" && !announcement && watcher\.news\.length === 0 && !onStage/);
  // The dock is not a second surface on a screen that already is one.
  assert.match(presence, /if \(!onStage) setJarvisOpen\(true\);/);
  // Ctrl+Shift+Space before Ctrl+Space, or the same keystroke does both.
  assert.match(presence, /if \(event\.shiftKey\)/);
  assert.match(presence, /router\.push\(STAGE_ROUTE\)/);
  // Group 4 already asserts the stage's two ways out (the Escape key and the visible
  // control), so this group only checks the third door: the dock links to the stage
  // and takes its own panel down when it does.
  const dock = readFileSync(path.join(root, "src/app/(admin)/assistant/AssistantDock.tsx"), "utf8");
  const at = dock.indexOf("href={STAGE_ROUTE}");
  assert.ok(at > -1, "the dock links to the stage");
  // Scoped to the link itself: the close button already calls setJarvisOpen(false), so
  // a bare assertion on that call would pass with the stage link wide open.
  assert.ok(dock.slice(at, at + 240).includes("setJarvisOpen(false)"), "the stage link closes the dock");
  // A reactor with nothing to open is not a button that lies about expanding.
  const reactor = readFileSync(path.join(root, "src/modules/assistant/presentation/JarvisReactor.tsx"), "utf8");
  assert.match(reactor, /const interactive = !preview && Boolean\(onClick\)/);
  // And the two needles the corner proof pins are still there, spelled exactly.
  assert.ok(presence.includes('ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-5 right-5"'));
  assert.ok(presence.includes("origin-bottom-right"));
});
```

- [ ] **Step 3: Make the reactor honest about having no panel**

`JarvisReactor.tsx:67` becomes:

```tsx
  // A surface with no click is a display, not a button: `aria-expanded` over a stage
  // that has no panel to expand would promise a control that is not there.
  const interactive = !preview && Boolean(onClick);
  const Surface = interactive ? "button" : "div";
```

and the three props that only mean something on a button become `interactive`-gated
rather than `preview`-gated:

```tsx
        type={interactive ? "button" : undefined}
        onClick={interactive ? onClick : undefined}
        aria-expanded={interactive ? ariaExpanded : undefined}
```

Keep the `className` ternary keyed on `preview` as it is — a stage orb is still not a
hover-target pretending to be a launcher, so decide once, in this step, whether the
non-interactive surface keeps the `cursor-pointer hover:scale-[1.04]` classes. It
should not: a cursor that promises a click on something that does nothing is the same
lie as `aria-expanded`. Change that ternary to `interactive ? <button classes> : "relative z-10 rounded-full"`.

Then run `node scripts/prove-jarvis-reactor.mjs`: its existing
"the real launcher still reports expansion and dispatches its click" check is what keeps
the button path honest, and its preview check is what keeps the console's previews
non-interactive. If a check turns red because it now renders `div` where it expected
`button`, read which case it is before changing anything.

- [ ] **Step 4: The presence reads the route**

Add to the imports and, beside the other `useSyncExternalStore` reads:

```tsx
import { usePathname, useRouter } from "next/navigation";
import { STAGE_ROUTE } from "@/modules/assistant/domain/stage";
```

```tsx
  // The stage is a route, so the orb's position and the address bar can never disagree:
  // a reload comes back to the same place and the back button leaves it.
  const pathname = usePathname();
  const router = useRouter();
  const onStage = pathname === STAGE_ROUTE;
  const turned = onStage && ui.stageTurns > 0;
```

`stageOrbTransformVars` is **not** imported here and must never be called inside
`className` — a class Tailwind has to assemble at runtime is a class it never saw at build
time and therefore purged, and an import the file does not call is a lint error rather
than a comment. Its caller is the proof: group 5 below loads `src/modules/assistant/domain/stage.ts`
and compares this file's literal classes against what the function returns, which is how a
changed constant turns a gate red instead of moving the orb invisibly. `STAGE_ORB_PX` joins
this import only along the Step 1 route that draws the canvas at 200; if Step 1 keeps
`size={104}`, it stays out.

- [ ] **Step 5: The root, the wrapper and the card**

The root's `className` (`:312-320`) becomes:

```tsx
      className={cn(
        onStage
          // Nothing here is a hit target until the orb or a note is: a full-viewport
          // wrapper that swallowed clicks would sit over the transcript it shares.
          ? "pointer-events-none fixed left-1/2 top-1/2 z-40"
          : cn(
              "fixed z-40",
              // <this line is the existing ternary, byte-for-byte — see the corner proof>
              ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-5 right-5"
            )
      )}
```

Prettier will want to re-wrap that inner ternary; if it does, the corner proof turns red
on a needle about an unchanged branch. If the formatter moves it, break the inner
`ui.open ? … : …` onto its own line **before** the outer `cn(` closes and re-run the
corner proof — do not "fix" the proof by loosening its needle.

The wrapper (`:355-375`) keeps its existing ternaries and gains the stage's own:

```tsx
      <div
        className={cn(
          "relative inline-block",
          // The resting scale is about the bottom-right corner because that is the only
          // place a corner orb can shrink to without leaving the frame. The stage orb is
          // moved by its centre, so it scales about the centre; the two cannot share one
          // origin, and `canRest` is false here anyway.
          onStage ? "origin-center" : "origin-bottom-right",
          onStage
            ? "transition-transform duration-500 ease-out motion-reduce:transition-none"
            : "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
          // The three vars the inline transform reads. Underscores are how Tailwind
          // spells a space inside an arbitrary value: `calc(-50vh - 28px)`.
          turned && "[--jv-x:-50%] [--jv-y:calc(-50vh_-_28px)] [--jv-s:0.48] lg:[--jv-x:calc(50vw_-_172px)]",
          !onStage &&
            (resting
              ? "translate-x-[34%] translate-y-[34%] scale-50 opacity-80 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:scale-75 [@media(hover:none)]:opacity-100"
              : "translate-x-0 translate-y-0 scale-100 opacity-100")
        )}
        style={onStage ? stageTransform : undefined}
        data-resting={resting ? "true" : undefined}
      >
```

with, just above the return:

```tsx
  // The list itself is inline so that scale and translate cannot be split across two
  // rules with different specificity; the numbers it reads are per-state classes.
  const stageTransform = {
    transform: "translate(var(--jv-x, -50%), var(--jv-y, -50%)) scale(var(--jv-s, 1))",
  } as const;
```

`data-resting` must not go: `prove-jarvis-presence.mjs` reads the resting state through
it.

The spec puts the note card to the **left** of the turned orb by row-reversing the
container it sits in. This plan does not row-reverse a flex child: a child of the
wrapper would carry that wrapper's `translate()` and `scale()` with it, so the card would
glide and shrink *with* the orb and end up on top of it. The card stays a child of the
**root**, which carries no transform on the stage — so viewport coordinates are honest
there, and `right-[152px] top-6` means the same thing a `flex-row-reverse` would have
meant:

```tsx
        <div
          className={cn(
            "rounded-xl border border-brand-line bg-white p-3 text-[11px] leading-relaxed text-brand-ink/75 shadow-lift",
            onStage
              ? cn(
                  "pointer-events-auto fixed w-64",
                  // 152px = the turned orb's left edge (96 + 24) plus 32 of air, so the
                  // note reads as sitting beside the orb rather than under it.
                  turned && "right-[152px] top-6",
                  !turned && "left-1/2 top-[calc(50%+120px)] w-72 -translate-x-1/2",
                  // A phone has no right-hand room: top-centre, starting where the
                  // transcript starts, because that is the same gutter the chat keeps.
                  turned && "[@media(width<640px)]:right-auto [@media(width<640px)]:left-1/2 [@media(width<640px)]:top-[144px] [@media(width<640px)]:-translate-x-1/2"
                )
              : "mb-2 w-56"
          )}
        >
```

Check the cascade: `w-64` then a later `w-72` in the same class list does **not**
reliably win, because Tailwind's generated order is by its own rules, not by source
order. Spell the width in each branch instead — `turned && "w-64"` and
`!turned && "w-72"` — and drop the shared `w-64`. Then look at it in the browser at
both sizes; a card that keeps the wrong width is a two-second find.

- [ ] **Step 6: Size, click, rest, and the hand-off**

```tsx
          size={onStage ? STAGE_ORB_PX : ui.open ? 76 : 104}   // <only if Step 1 chose route 1>
          showStatus={!resting}
          ariaLabel={`${STATE_LABEL[state]}${meter.error ? ` — ${meter.error}` : ""}`}
          ariaExpanded={onStage ? undefined : ui.open}
          onClick={
            onStage
              ? undefined
              : () => {
                  wakeAudio();
                  toggleJarvisOpen();
                }
          }
```

`canRest` gains `&& !onStage` (group 5 pins the whole expression). In `hear`, the line
A8 wrote becomes:

```tsx
      // On the stage the conversation is already on screen; opening the dock over it
      // would put a second copy of the transcript in front of the person speaking.
      if (!onStage) setJarvisOpen(true);
```

and `onStage` joins `hear`'s dependency array — the callback is read through `hearRef`
by the listener, so a stale `onStage` would open a dock the moment after the person
navigated away from the stage. `runCommand`'s `open` branch already navigates, so a
spoken `open candidates` from the stage leaves the stage; that is the command doing what
it says, and the Guide (B5) says so too.

- [ ] **Step 7: The two hotkeys, in that order**

The existing handler (`:242-254`) tests `!event.ctrlKey || event.code !== "Space" || event.altKey || event.metaKey`. `Ctrl+Shift+Space` passes that guard **today** — `shiftKey` is not in it — so the shift branch must come first, or one keystroke both opens the stage and toggles the panel:

```tsx
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.code !== "Space" || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      // A composer or a rich field owning the space bar keeps it.
      if (target?.isContentEditable) return;
      if (target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      wakeAudio();
      // Shift is the stage, and it is tested before the plain chord because the plain
      // chord fires on this keystroke too.
      if (event.shiftKey) {
        router.push(STAGE_ROUTE);
        return;
      }
      // On the stage there is no panel to open: the conversation is the screen.
      if (onStage) return;
      toggleJarvisOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wakeAudio, router, onStage]);
```

Keep the `TEXTAREA`/`isContentEditable` refusal **ahead** of `preventDefault()` exactly
as it is now — moving it below the `preventDefault()` would swallow the space bar from a
person mid-sentence in a box. Note what changed: the guard used to run before
`wakeAudio()`; now it runs before both, so an unfocused field cannot unlock audio. That
is the same order the file already had, and it stays.

- [ ] **Step 8: The dock's way in**

Escape and the visible **Exit stage** control were written in Task B3, inside
`AssistantStage.tsx` itself — they belong to the page, not to the orb, and group 4
already proves both. What is left here is the third door.

In `AssistantDock.tsx`, beside the existing resize button (`:209-223`) and before the
close button (`:225-232`), add a link styled exactly like its neighbours:

```tsx
              <Link
                href={STAGE_ROUTE}
                onClick={() => setJarvisOpen(false)}
                aria-label="Open the stage"
                title="Open the stage — the whole screen, just the orb (Ctrl+Shift+Space)"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <Expand className="h-3.5 w-3.5" aria-hidden />
              </Link>
```

`h-8 w-8` and `bg-white` are what the two buttons either side of it use; a `h-7` link in
that row is a visible misalignment, not a taste question. Import `Link` from
`next/navigation` — it is not in this file's imports today — and add `Expand` to the
`lucide-react` import at `:5`. `Expand` is exported by the installed version (checked
against `node_modules/lucide-react`), and `setJarvisOpen` is already imported (`:10`).

The `setJarvisOpen(false)` matters: a dock left open behind a full-viewport stage is a
panel that will reappear over the answer.

- [ ] **Step 9: Run everything that touches the orb**

```bash
node scripts/prove-jarvis-stage.mjs
node scripts/prove-jarvis-corner.mjs
node scripts/prove-jarvis-reactor.mjs
node scripts/prove-jarvis-presence.mjs
node scripts/prove-jarvis-appearance.mjs
node scripts/prove-jarvis-editor.mjs
node scripts/prove-jarvis-commands.mjs
node node_modules/typescript/bin/tsc --noEmit
npx eslint src/modules/assistant/presentation src/app/\(admin\)/assistant scripts/prove-jarvis-stage.mjs
```

Expected: all green. `prove-jarvis-corner.mjs` is the one most likely to complain — it
pins two byte-exact strings in the unchanged branches, and both are re-asserted inside
group 5 so a failure names the right task.

- [ ] **Step 10: Live pass, no microphone**

At `http://localhost:3001/assistant/stage`, with the owner signed in, type rather than
speak (arming the microphone is not part of this task):

- the orb is in the middle of an empty screen; a note card, if one is showing, sits below it;
- sending a question moves the orb to the top-right in one motion and the answer opens
  beside it, with nothing of the transcript under the orb;
- at a sub-`lg` width the same orb is top-centre and the transcript starts below it;
- `prefers-reduced-motion` (emulate it) jumps to the end state instead of gliding;
- clicking where the orb *was* does nothing to the transcript — the dead 200 px box is
  not a hit target;
- `Ctrl+Shift+Space` from `/dashboard` opens the stage; `Ctrl+Space` on the stage does
  not raise a dock; `Escape` leaves; the dock's stage link leaves with the panel closed;
- reload on the stage is still the stage, and the orb is turned if the conversation has
  turns saved — check what `stageTurns` is when the page loads with a `?session=`: the
  chat reports its own length once the transcript loads, so the orb should already be in
  the corner. **If it glides a second after arriving, that is a real finding** — write
  down whether the report lands before or after the paint, and fix the ordering rather
  than accepting the animation.

- [ ] **Step 11: Commit**

```bash
git add src/modules/assistant/presentation/JarvisReactor.tsx src/modules/assistant/presentation/JarvisPresence.tsx "src/app/(admin)/assistant/AssistantDock.tsx" scripts/prove-jarvis-stage.mjs
git commit -m "feat(assistant): the orb takes the middle of the stage and steps aside for an answer"
```

`AssistantStage.tsx` is not in this commit — Task B3 committed it, and this task only
moved the orb around it. If the live pass in Step 10 forced a change in that file, stage
it here as well and say so in the commit message.

---

## Task B5: The Guide says what the slice does, and the whole thing is gated

**Files:**
- Modify: `src/modules/shell/domain/pageGuide.ts:525` (the `/assistant` presence paragraph) and the `/settings` entry if it names the Assistant sections
- Test: `scripts/prove-guide-figures.mjs`, and every gate below

**Interfaces:**
- Consumes: everything above.
- Produces: nothing. This task is copy and gates.

- [ ] **Step 1: Write the copy that matches the code**

Append to the `pageGuide.ts:525` string — the same sentence style the file already uses,
hardcoded English, no `translate()`:

- the third Assistant section, `Settings → Assistant → Voice commands`, and what a
  command is: a phrase, a label, a category, one of four actions (`ask`, `open`, `tool`,
  `note`) and notes nobody hears;
- that a wake phrase is still required, that a personal phrase beats the shared one, and
  that the longer phrase wins when both exist;
- that a command can only ask, navigate, run a tool the panel already runs behind a
  click, or say a line — and that `assistant.commands` is what lets a person publish one
  for the team;
- the honest state of the table: `db/migrations/051_jarvis_voice_commands.sql` is
  **authored and not applied** on this database, so the console lists nothing and the orb
  matches nothing until it is applied under its own approval. **Use the same polarity
  sentence `prove-migration-claims.mjs` expects of an unapplied file, and add the 051
  entry from A5 in the same commit** — a Guide sentence about a missing table is exactly
  what that gate reads source for;
- the stage: the three doors in (`Ctrl+Shift+Space` from anywhere, the dock's stage
  button, `/assistant/stage` itself), the orb in the middle, the orb in the corner once an
  answer arrives, and the **two ways out** — `Escape` and the **Exit stage** button in the
  top-left, because the spec says a key nobody can see is not a control;
- that below the `lg` width the orb turns to the **top-centre** instead of the corner, in
  one sentence, so a person on a phone knows the layout differs on purpose;
- that the stage is the same saved conversation the page and the dock write to, not a
  second one.

**Do not add the stage to `quickKeys.ts`.** Its table is
`Record<string, StaffRoute>` with a compile-time claim that every `StaffRoute` has a
letter, and `/assistant/stage` is not a `StaffRoute` — a nested page is covered by the
`/assistant` prefix. That panel prints the page letters and has never printed the orb's
`Ctrl+Space` either; the Guide paragraph is where both chords live.

- [ ] **Step 2: Re-derive every figure the Guide pins**

`prove-guide-figures.mjs` counts things in the tree — sections, states, presets, caps.
This slice adds one Assistant section (`commands`), one command table, four action types,
six categories, a 200-row cap and a 280-character ceiling on a note. Run it, and if a
figure it asserts moved, fix the **copy**, not the proof, the way the last four slices
did.

- [ ] **Step 3: Whole-slice gates**

```bash
node node_modules/typescript/bin/tsc --noEmit
npx eslint src scripts
node scripts/prove-migration-claims.mjs
node scripts/prove-guide-figures.mjs
node scripts/check-staff-routes.mjs
node scripts/prove-jarvis-stage.mjs
node scripts/prove-jarvis-commands.mjs
node scripts/prove-jarvis-presence.mjs
node scripts/prove-jarvis-corner.mjs
node scripts/prove-jarvis-reactor.mjs
node scripts/prove-jarvis-appearance.mjs
node scripts/prove-jarvis-editor.mjs
node scripts/prove-jarvis-listening.mjs
node scripts/prove-jarvis-voice.mjs
```

Run the proofs **sequentially**, not in parallel — they each start a module loader and
compete for the same stubbed globals. If a file named above does not exist under exactly
that name, list what `scripts/prove-jarvis-*.mjs` actually holds and run all of them;
do not silently drop one from the gate because the plan guessed its name.

- [ ] **Step 4: Isolated production build**

```bash
docker compose build app
```

**Stop at "Built".** Do not run `docker compose up` or recreate the stack — the owner's
dev server on `:3001` is theirs and `docker compose up -d app` would replace the running
container they are looking at. Report the build result and ask before serving it.

- [ ] **Step 5: Live pass over the whole slice, no microphone**

With the owner signed in at `http://localhost:3001`:

1. Settings → Assistant → Voice commands lists its tabs, and with 051 unapplied it says
   so and lists nothing — the sentence names the file, and the orb still answers
   `Ctrl+Space`.
2. `/assistant` still works exactly as it did: rail, composer, approval card, dictation.
3. `/assistant/stage` opens from the dock link, from `Ctrl+Shift+Space`, and by typing the
   address; the orb turns; both exits work — `Escape` and the **Exit stage** button; a
   saved `?session=` opens already turned.
4. A mobile-width stage keeps the transcript out of the orb at the top.
5. The Guide answers a question about voice commands and about the stage with the copy
   written in Step 1.

Then state plainly, in the report, what was **not** proved: no microphone was armed, so
no phrase was matched, so `matchCommand` and the dispatch seam have only the fixture
proofs behind them; and with 051 unapplied, nothing in the command path can be reached
live at all. Applying 051 needs its own named approval — ask for it, do not assume it.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shell/domain/pageGuide.ts scripts/prove-jarvis-stage.mjs scripts/prove-jarvis-commands.mjs
git commit -m "docs(assistant): the Guide tells a recruiter about saved commands and the stage"
```

---

## What this plan deliberately does not do

- It does not apply `051`. Authoring is Task A4; applying is a separate decision the
  owner makes by name, and every read in Part A is written to work with the table absent.
- It does not arm a microphone, capture audio, or prove a phrase end-to-end. No audio is
  stored anywhere in this slice, and a live mic-to-gateway proof is a spend the owner
  signs in for personally.
- It does not add a second orb, a second conversation store, or a second approval door.
- It does not touch the candidate portal, and it does not widen `speechLanguageOf` or set
  a `lang` anywhere in the listening path.
- It does not stream tier 3, add a command-recorder, or watch `assistant_jarvis_commands`
  on the live channel.
