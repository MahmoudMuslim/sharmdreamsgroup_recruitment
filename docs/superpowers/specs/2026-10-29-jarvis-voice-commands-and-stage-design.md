# JARVIS: spoken commands, and the stage

**Date:** 2026-10-29
**Status:** Design approved in conversation on 2026-10-29 (both sections). Nothing built yet; migration `051` is authored by this plan and applied only under its own named approval.
**Scope:** two slices of one feature — (A) a **Voice Commands Manager**, where a person saves phrases that make the assistant *do* something, and (B) a **Stage**, a full-viewport surface showing only the orb, which steps aside to the top-right once an answer arrives so the answer opens beside it.

Neither slice adds a capability the portal does not already have. A command can only ask a question, open a page the rail already lists, run one of the assistant's own tools, or say a line — and every tool still waits for a click. The Stage is a second way to look at the same conversation, not a second conversation.

---

## Why

**Commands.** Today there is exactly one thing a wake phrase may do: hand the transcript to the model (`JarvisPresence.tsx:185-205`). Every phrase costs a full turn, every phrase is interpreted afresh, and there is no way for a recruiter to say *"open the outbox"* and have the portal open the outbox — the model decides, may pick a different tool, and may answer with prose instead. A team that says the same five things all day pays for five interpretations a day and gets five slightly different results. There is no command, macro or snippet concept anywhere in the tree.

**The stage.** The orb is a 104 px object in a corner, and the conversation is a panel with a header, a rail and a composer. A person who wants to *talk* to the assistant — dictating a brief, running a sequence of commands, watching it think — has no surface for that: the panel is a form, and the orb is decoration beside it. What is missing is a view where the assistant is the whole screen until there is something to read.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Who may own a command | **both scopes** — personal and shared | Personal is the useful default (one person's habits); shared is what makes a team say the same thing. Reusing only one of them would make the other impossible to add without a migration |
| Action types | **all four**: `ask`, `open`, `tool`, `note` | The four cover question, navigation, action and utterance; anything else is one of these with a different payload |
| Where the manager lives | Settings → Assistant → **Voice commands** | The two existing Assistant sections already own this person's row; commands are the same kind of choice and belong beside them, not on a page of its own |
| The wake phrase before a command | **still required** | The microphone is armed on every admin screen, so an ungated command would let the office navigate somebody's portal by saying "open positions". The gate is the thing that makes an always-on microphone defensible |
| `tool` commands and the approval card | **unchanged** | `runTool` already mints an approval before any write (`agent.ts:378-437`); a command reuses it rather than getting a second door. A saved command can never enable deletions or web lookups |
| What the Stage is | **a route**, not a store flag | `Ctrl+Shift+Space` navigates to `/assistant/stage`; a reload returns to the stage, the back button leaves it, and the orb reads its own position from the URL instead of a value that could drift from what is on screen |
| Full viewport | **`fixed inset-0`, no Fullscreen API** | The browser's own fullscreen needs a user gesture, hides the address bar and fights Escape; a fixed surface has none of those problems |
| One orb, one owner | **kept** | The shell already mounts the single orb; the stage does not mount a second one, it changes where the existing one stands |

---

# Part A — Voice Commands Manager

## What a command is

Six things a person fills in, and two the server owns.

| Field | Column | Rule |
| --- | --- | --- |
| Voice Trigger Phrase — *what you speak* | `trigger_phrase` | 2–64 characters after trim, no control characters. Unique per owner, compared case- and whitespace-insensitively |
| Command Label / Title | `title` | 1–80 characters after trim |
| Category | `category` | One of six, below. Groups and filters the console; decides nothing about dispatch |
| Action Type | `action_type` | `ask`, `open`, `tool`, `note` |
| Action payload | `action_payload` | `jsonb`, at most 4 KB, shaped by the action type below. The field the console shows changes with the type |
| Description / Notes | `notes` | ≤ 500 characters, optional. Shown in the console and nowhere else — never spoken, never sent to a model |
| *Enabled* | `enabled` | Off means it still lists and still edits, and the matcher ignores it |
| *Scope + owner* | `scope`, `owner_profile_id` | `personal` with an owner, or `shared` with none. Enforced by a CHECK, so a row cannot claim to be both |

**The six categories.** `navigation`, `hiring`, `communication`, `reports`, `settings`, `personal`. They are a fixed vocabulary in the domain module (not a table), because a category that changed at runtime would change what a saved row means. Each carries a label and an icon id for the console's chips.

**The four action types.**

| Type | Payload | What dispatch does |
| --- | --- | --- |
| `ask` | `{ prompt?: string }` | Sends the prompt to the conversation as a turn. With no prompt, sends whatever was said after the trigger phrase — so *"Hey Jarvis, open candidates"* opens a page and *"Hey Jarvis, how many candidates this week"* asks, without either becoming the other |
| `open` | `{ href: string }` | Navigates. `href` must satisfy `isStaffPath` (`src/lib/auth/staffRoutes.ts:79`): an internal staff page, optionally with a query. An external URL, a `javascript:` scheme or a path the guard does not cover is **refused at save time** and again at dispatch |
| `tool` | `{ tool: string, args: Record<string,string> }` | Runs one of the assistant's own tools by name with fixed arguments. Unknown, destructive and web tool names are refused at save time. At dispatch it goes through `runTool` with `allowDestructive: false` and `allowWeb: false` — a command cannot widen what the panel's switches allow |
| `note` | `{ text: string }` | Speaks one line through the existing voice queue and shows it on the orb's note card. ≤ 280 characters. Not written anywhere |

## The domain module — `src/modules/assistant/domain/commands.ts`

Pure, imports nothing but `staffRoutes`' type-free `isStaffPath` and the tool registry's read-only lookups. It mirrors `jarvis.ts`'s shape, for the same reason that file gives: a rule that can be proved without a database, a microphone or a model.

- `COMMAND_CATEGORIES` — the six, each `{ id, label }`.
- `COMMAND_ACTION_TYPES` — the four, each with a one-line description for the console's picker.
- `parseCommandDraft(draft, previous)` — the write door. Every field is validated and **refused, not defaulted**: a phrase of one character, a title of none, an `open` whose href is not a staff path, a `tool` naming something the registry does not hold, a `note` past its ceiling. This is `draftValue`'s rule from `jarvis.ts:523-575` applied to a whole form rather than to one field.
- `normalizeCommandRow(row)` — the read door, and deliberately more forgiving than the write door because a hand-edited row must still render: an unknown category reads as `personal` with the original string kept in `rawCategory` so the console can say *"Uncategorised — this row names a category the portal does not have"*; an unknown action type reads as **disabled with a stated reason**, never as `ask`, because guessing would turn a broken row into a live one.
- `matchCommand(transcript, commands)` — the matcher, below.

### Matching, in four rules

1. **Fold first.** Case, diacritics and repeated whitespace are folded with the same `fold` the wake phrase uses (`domain/voice.ts:80`, exported for this second caller), so a phrase typed with a different vowel form still matches what was said.
2. **Whole words, not substrings.** The phrase must appear as a run of whole tokens in the transcript: `open candidate` does not match *"open candidates"*, and `stop` inside `stopwatch` is not a match — the same rule `isStopCommand` already applies to barge-in (`jarvis.ts:246-262`).
3. **Longest wins.** *"open the outbox"* beats *"open"* when both exist, because the more specific phrase is the more precise intent.
4. **Personal beats shared.** When a personal and a shared command carry the same phrase, the person's own runs. Shared phrases are unique among themselves and personal phrases are unique among themselves, so this rule is the only ambiguity left and it resolves deterministically.

Disabled commands are dropped before matching, not after.

## The table — `db/migrations/051_jarvis_voice_commands.sql`

Authored in `049`/`050`'s bare idiom (`begin; … commit;`, `create table if not exists`, `notify pgrst, 'reload schema'`), with `047`'s own-row policy shape for the personal half.

```sql
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
```

Two partial unique indexes rather than one `coalesce` expression, so the same phrase may exist once per person *and* once for the portal:

```sql
create unique index if not exists assistant_jarvis_commands_personal_phrase
  on public.assistant_jarvis_commands (owner_profile_id, lower(btrim(trigger_phrase)))
  where scope = 'personal';

create unique index if not exists assistant_jarvis_commands_shared_phrase
  on public.assistant_jarvis_commands (lower(btrim(trigger_phrase)))
  where scope = 'shared';
```

**RLS.** Personal rows are the person's own, read, written and deleted only by them — the `(select current_user_profile_id()) = owner_profile_id and is_staff()` shape of `047`, with a delete policy because a command is content its author may take back (unlike `assistant_jarvis_prefs`, which is a record that a choice was made). Shared rows are readable by every staff member and writable only by `is_staff() and has_permission('assistant.commands')`, which is the idiom RLS already uses for gated writes.

**A new permission.** `assistant.commands` joins the `PermissionKey` union (`src/modules/settings/domain/types.ts:20`) and is seeded in the same migration, the way `time.track` is seeded in `025`:

```sql
insert into public.permissions (key, label, group_name, description)
values ('assistant.commands', 'Publish shared JARVIS commands', 'Assistant',
        'Add, edit and remove voice commands every recruiter can use')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key, granted)
values ('SUPER_ADMIN', 'assistant.commands', true),
       ('HIRING_MANAGER', 'assistant.commands', true)
on conflict (role_key, permission_key) do nothing;
```

`SUBSIDIARY_HR_MANAGER` gets no row: `user_role` (`db/schema.sql:99`) does not hold that value, so a grant for it would be a matrix entry nobody can ever hold. `RECRUITER` is left to the matrix deliberately — publishing the vocabulary the whole team speaks is a decision, not a default.

**Seeded shared starters.** Four rows, `on conflict do nothing`, navigation and saved-prompt only — no starter runs a tool, because a seeded write that a person did not write is exactly the kind of thing that should wait for a click:

| Phrase | Type | Target | Category |
| --- | --- | --- | --- |
| `open candidates` | `open` | `/candidates` | navigation |
| `open the pipeline` | `open` | `/jobs` | navigation |
| `today's interviews` | `ask` | *"What interviews are scheduled today?"* | hiring |
| `open the outbox` | `open` | `/whatsapp` | communication |

## Reading and writing

- `src/modules/assistant/application/jarvisCommands.ts` — `readVoiceCommands(profileId)` returns `{ ok, commands, problem }`, reading the person's own rows and the shared rows and merging them under the matcher's precedence. Bounded at 200 rows with the cap stated in the console, and a read from an unapplied `051` returns `problem: "absent"` naming the file, with an empty list — no command, no crash, and the presence keeps working.
- `src/app/(admin)/settings/jarvis-command-actions.ts` — `saveCommand`, `duplicateCommand`, `deleteCommand`, `setCommandEnabled`, `adoptSharedCommand` (`Add to mine`). Each calls `requireStaff`, writes through `parseCommandDraft`, scopes every write by session — `owner_profile_id` and `scope` are never taken from the draft — and writes a trail row the way `jarvis-actions.ts` does. A refused write returns which field it refused and why, never a silent no-op.

## The console — Settings → Assistant → Voice commands

`src/app/(admin)/settings/JarvisCommandsConsole.tsx`, mounted from `AssistantPanel` in `src/app/(admin)/settings/page.tsx:318-324`. Registered as a third `ASSISTANT_SECTIONS` entry (`settingsNav.ts:132-145`, id `commands`), with a `mic` icon added to `ICONS` in `SettingsShell.tsx:31-49`. `DEFAULT_SECTION.assistant` stays `presence`.

- **Two tabs behind the URL** — `?tab=mine` (default) and `?tab=shared` — plus `?q=` for the search box, matching every other console in this portal. Category chips filter the visible rows and are not in the URL: they are a glance, not a destination.
- **A row** shows the phrase in quotes, the title, a category badge, an action-type badge, and an enable switch. Expanding it opens the editor: the five named fields, the payload field for the chosen type (a route picker for `open`, a tool picker for `tool`, a text area for `ask` and `note`), and Save / Duplicate / Delete-with-confirm.
- **`tool` rows can only name a tool the registry holds**, and the picker offers exactly those minus destructive and web tools — so the console cannot author a command that dispatch would refuse.
- **Shared rows** are read-only for anyone without `assistant.commands` and editable with it. Every shared row offers **Add to mine**, which copies it as a personal command with the same phrase; a personal copy then wins the matcher, which is how a person overrides one shared command without touching anyone else's.
- **No live channel.** The console says it reloads on visit; a command list changes rarely and adding `assistant_jarvis_commands` to the live watch would poll a table almost nobody writes.

## Dispatch — the one new seam

The change to the orb is small and sits exactly where the current hand-off is. `JarvisPresence.tsx:193-202` becomes:

```tsx
const heard = matchWakePhrase(text, phrase);
if (!heard.matched && !ui.awaiting) return;
setStopped(false);
wakeAudio();
tone("heard");

const command = matchCommand(heard.matched ? heard.remainder : text, commands);
if (command) {
  runCommand(command);          // ask → handToJarvisChat · open → router.push
  return;                      // note → say + note card · tool → server action
}
setJarvisOpen(true);
handToJarvisChat(text);
```

`commands` arrives on the read the orb already makes for its prefs, so a command costs no second fetch and follows the same `prefsEpoch` refresh the console already bumps. That read is `getJarvisPresence` (`src/app/(admin)/settings/jarvis-actions.ts:39`), whose `ok` branch (`PresenceRead`, same file `:35-37`) gains `commands`; the manager console reads through `readVoiceCommands` above, and both are refreshed by the one epoch, so the list a person edits and the list the orb matches on cannot disagree for longer than one save. `open` uses `useRouter().push`; `note` uses the voice queue and the orb's own note card; `ask` uses `handToJarvisChat`, which is the existing hand-off and needs no change.

`tool` is the only one that needs the server: a new `runJarvisCommand` action in `src/app/(admin)/assistant/actions.ts`, beside `sendAssistantMessage`. It takes the command id and the open session, runs `runTool` with `allowDestructive: false, allowWeb: false`, and appends **a user turn naming the command and an assistant turn carrying the step** through the same store `sendAssistantMessage` uses — so an approval card, a table, a chart or a link renders through the code that already renders them, and the conversation records that a command ran, which command, and who held the click. `runTool` is exported from `agent.ts` for this one caller.

**What a spoken command never does.** It never runs a write without the approval card. It never sees typed text: the composer's turns go to `sendAssistantMessage` untouched, and a command is only ever matched against words the microphone delivered. It never runs while `enabled` is false, while its scope is not readable, or while `051` is absent. And nothing is logged about a phrase that matched nothing.

---

# Part B — The Stage

## The surface

`/assistant/stage` is a staff route guarded by `requireStaff("/assistant")`, covered by the `/assistant` prefix in `STAFF_ROUTES` and therefore by the edge guard, the idle sign-out and the candidate bounce — no new entry in that table, and `scripts/check-staff-routes.mjs` keeps passing because it only enumerates top-level pages with a `page.tsx`.

On that path the shell renders **bare**: `AdminShell` hides the app bar, the side rail, the mobile drawer and the content padding, and keeps `JarvisPresence` mounted (`AdminShell.tsx:395-409`). The stage covers the viewport with `fixed inset-0` — no Fullscreen API, no address-bar fight, and Escape is ours to handle.

## The orb moves

`JarvisPresence` reads `usePathname()` and `stageTurns` from `jarvis-ui.ts`. Three positions, one component:

| State | Where the orb is | Size |
| --- | --- | --- |
| Anywhere but the stage | the existing corner logic, unchanged | 104 px, 76 px beside the open panel |
| Stage, no turn yet | centred in the viewport | 200 px |
| Stage, at least one turn | top-right, inside the stage gutter | 200 px scaled to 0.48 |

The orb keeps its 200 px geometry in stage mode and the **wrapper** carries `transform: translate(...) scale(...)` with `transition-transform duration-500 ease-out`, so it glides and shrinks in one motion instead of jumping between two `fixed` corners; `prefers-reduced-motion` gets the end state with no transition. The orb's note card sits to the **left** of the orb in this state (the note container is row-reversed), which is the only view in the portal where it has room to.

`jarvis-ui.ts` gains one field and one setter:

```ts
stageTurns: number;                       // turns in the stage conversation
export function setJarvisStageTurns(n: number): void;   // no emit when unchanged
```

Nothing else joins the store. *Whether* the stage is on lives in the URL, so there is no flag to fall out of step with the page, and no second place to reset on a back button.

## The answers

`AssistantChat` gains a third variant — `variant: "stage"` beside `"docked"` and `"page"` (`AssistantChat.tsx:129`) — and **no second renderer**. The difference is layout only: the transcript column occupies everything left of the orb's gutter, top-aligned, so the first answer opens beside the orb rather than under it; the composer is a bottom-centred pill at every stage state, so a person can type before there is an answer and keep typing after.

- `src/app/(admin)/assistant/stage/page.tsx` — server component: `await connection()`, `requireStaff("/assistant")`, `?session=` off `searchParams`, an `instant = false` export, and `metadata`. It renders the client half.
- `src/app/(admin)/assistant/AssistantStage.tsx` — client: owns the `?session=` replace exactly as `AssistantConsole` does (`AssistantConsole.tsx:86-94`), renders an **Exit stage** control, and renders `<AssistantChat variant="stage" voiceMode="console" />`. `voiceMode="console"` is what gives the stage push-to-talk and the hands-free toggle; the chat's own listener still stands down while the ambient orb is armed, so the one-microphone-per-tab rule is untouched.
- The transcript reports its turn count to the store on every change and resets to 0 when the stage unmounts, which is what makes the orb return to the centre for a fresh stage and start top-right when a saved conversation is reopened.
- `src/lib/jarvis-ui.ts` also exports `STAGE_ORB_GUTTER_PX`. The stage's chat column reads it for its right padding and the presence reads it for its placement, so the space reserved for the orb and the orb cannot drift apart.

## The three doors

1. **Stage** button in the dock header, beside Maximize2/Minimize2 (`AssistantDock.tsx:209-223`) — a link to `/assistant/stage` that also closes the dock.
2. **`/assistant/stage`** itself — addressable, reloadable, shareable as a link, and the destination of the other two.
3. **`Ctrl+Shift+Space`** from anywhere — `router.push("/assistant/stage")`, bound in the same handler that already owns `Ctrl+Space` (`JarvisPresence.tsx:241-255`), with the same refusal to fire inside a textarea or contenteditable. `Ctrl+Space` keeps its current meaning; on the stage it does nothing, because the panel it would open is hidden on `/assistant/*`.

**Getting out.** Escape returns to `/assistant`, the same key that closes the docked panel today. The visible **Exit stage** control exists because Escape is not discoverable.

**Mobile.** Below `lg` the orb sits top-centre at the same 0.48 scale and the answers take the full width beneath it. An answer "to the left of the orb" needs width the phone does not have, and pretending otherwise would push every answer into a 40 %-wide column. The Guide says so in one sentence rather than leaving a person to wonder why the layout differs.

---

## Errors and fallbacks

| Situation | What the person sees |
| --- | --- |
| `051` not applied | The console names the file and lists nothing; the orb keeps listening and every other section still writes. Commands are simply not matched |
| A command's phrase already exists in that scope | Refused at save with the phrase quoted and the existing title named — never a silent overwrite |
| A draft's `open` target is not a staff page | Refused with the path quoted; an external or `javascript:` target is refused the same way |
| A `tool` command names a destructive or web tool | Refused at save; a row hand-edited to name one is refused at dispatch with the reason, and the turn says so |
| A shared command's permission was revoked while it was on screen | The save is refused by RLS and the console says it is read-only for this account now |
| A command matched while the assistant is speaking | The stop words still win: *"stop"* halts playback before any command is considered, exactly as today |
| Two phrases that both match | The longest wins; equal length and different scopes means the personal one runs |
| The stage is opened with no session | Centred orb, an empty transcript and the composer. The first turn names the conversation as it does in the panel |
| A gateway refusal on the stage | The same error card the panel shows, in the same words — the stage adds no error surface of its own |
| `prefers-reduced-motion` | The orb is in its end position immediately; nothing glides |

## Privacy and authority

Neither slice moves where anything goes. A command is content, not audio: the microphone path is unchanged, no audio is stored, and nothing is written about a phrase that matched nothing. The transcript of a turn a person sent is saved exactly as it is today, whether it arrived by typing, by talking or through an `ask` command. A `note` command is spoken and shown, never written. A `tool` command cannot enable deletions or web lookups, cannot reach a tool the registry does not hold, and cannot write without a click. A shared command cannot be authored by a role that has not been granted `assistant.commands`, and a personal command cannot be read or written by anyone but its owner.

## Proofs

**`scripts/prove-jarvis-commands.mjs`** — the presence-style harness, numbered checks ending in the project's standard sentence, with a mutation per group that must turn red:

1. The six categories and the four action types, and that every label is non-empty.
2. The write door refuses: a one-character phrase, a 65-character phrase, a control character, an empty title, an over-long note; an `open` naming an external host, a `javascript:` scheme and a path the guard does not cover; a `tool` naming an unknown, a destructive and a web tool; an over-sized payload.
3. The read door: an unknown category renders as personal with its raw string kept; an unknown action type renders disabled with a reason, never as `ask`.
4. The matcher: whole tokens only, longest wins, personal beats shared, disabled ignored, folding of case and diacritics, and the remainder handed to `ask`.
5. The migration text: the scope/owner CHECK, both partial unique indexes, the four personal policies and the four shared ones, the `assistant.commands` seed and its `on conflict do nothing`, the four starters, and `notify pgrst`.
6. The seam, statically: `hear` consults `matchCommand` before `handToJarvisChat`; `runJarvisCommand` calls `runTool` with both switches false; no path from a command to a write bypasses `mintApproval`.

**`scripts/prove-jarvis-stage.mjs`** — `node:test`:

1. The store: `setJarvisStageTurns` ignores an unchanged value, notifies on a change, and resets to 0.
2. `AssistantChat`'s variant union has exactly three members and the stage branch renders the shared `send`.
3. The route calls `requireStaff` and is not added to `STAFF_ROUTES` (the prefix already guards it), and `check-staff-routes.mjs` still finds every page guarded.
4. `AdminShell` renders bare on `/assistant/stage` and still mounts the presence.
5. The presence reads `pathname` and `stageTurns` and has three positions; the gutter constant is used by both the chat column and the orb.

**Copy and pins.** The Guide's assistant paragraph (`pageGuide.ts:525`) gains the command manager, the stage and the `Ctrl+Shift+Space` key, and the mobile sentence; `prove-guide-figures.mjs` is re-run because the key count in the quick-key panel changes if the new chord is listed there. `prove-migration-claims.mjs` gains `051` and its probe.

**Gates.** `tsc --noEmit` (the direct binary), eslint, every existing prove suite, the two new ones, `prove-migration-claims.mjs`, `prove-guide-figures.mjs`, an isolated production build (`docker compose build app`, stopping at *Built*), then a live pass at `localhost:3001` **driven by typing and clicking** — no microphone, no arming. Applying `051` is not part of that build and needs its own named approval.

## Out of scope

The candidate portal; the browser's Fullscreen API; AI that invents commands or fills the manager in; syncing commands across installations; a command that runs a sequence of actions; per-command models or autonomy levels; folding `051` into `db/schema.sql`; the eleven stale migration headers; the appearance console.
