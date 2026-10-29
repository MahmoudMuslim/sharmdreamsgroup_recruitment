# JARVIS Listens in Any Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser's language-bound speech recogniser with this portal's own transcription model behind a language-blind energy gate, move the wake phrase from `localStorage` onto the person's account, put the wake-word control in Settings → Assistant, and take the "Listening language" selector out of the assistant controls.

**Architecture:** Three layers, each provable on its own. A pure domain module (`domain/listening.ts`) owns the four gate constants and the segment reducer, so a fixture test drives the microphone rules without a microphone. The existing staff door `POST /api/assistant/voice` stays the only way audio leaves the browser — tier 2 adds no transport. One new client hook (`useWakeListening`) replaces `useWakeWord`, rides the stream the loudness meter already owns, and keeps the same contract: armed → hears a phrase → hands me the text.

**Tech Stack:** Next.js 16.4.0 (this repo's fork — read `node_modules/next/dist/docs/` before touching routing or server-component code), React 19.3 `useSyncExternalStore`, TypeScript strict, `MediaRecorder` (`audio/webm;codecs=opus`) + `AnalyserNode` + `requestAnimationFrame`, PostgreSQL 17 + PostgREST, `node --experimental-strip-types` fixture proofs.

**Spec:** `docs/superpowers/specs/2026-10-29-jarvis-any-language-listening-design.md` — the approved design this plan argues from. Read it first; where this plan and the spec disagree, the spec is the decision and this plan is the sequence.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec and from the code as verified at authoring time.

- **`domain/jarvis.ts` and `domain/voice.ts` stay import-free and async-free.** Their headers promise *"Nothing in this file is async and nothing reaches outside it"* — that is what lets the proofs run without a database, browser or model. A ceiling shared between two pure modules is duplicated as a local constant and **pinned by a proof**, never imported.
- **No `lang` is set anywhere in the listening path.** `SpeechRecognition`, `recognition.lang`, `ar-EG`, `en-US` and the `VoiceLanguage` type are deleted, not disabled.
- **Refuse, never silently default.** A draft value its field cannot express leaves the stored choice exactly where it was — the idiom at `draftValue`'s `case "quiet_from"` in `jarvis.ts` and at `commitClock` in `JarvisPresenceConsole.tsx`. This applies to `wake_phrase` in Task 1.
- **Audio is never stored.** No bucket, no row, no log, no attachment. `scripts/prove-assistant-voice.mjs` enforces this on `src/app/api/assistant/voice/route.ts` by stripping comments and scanning for `getFileStore|storageConfig|\.upload\(|storage\.from`. Task 5 must not add any of those to the client either.
- **One microphone per tab, one stream, one owner.** `useJarvisMeter.ts` owns `getUserMedia({ audio: true })`; the listening hook attaches to that stream. A new `getUserMedia` call in this slice is a defect.
- **The candidate portal is untouched.** No edits to the (candidate) portal, `NoticeInbox`, or `communication_logs` reads/dismissals.
- **Tier 3 (the streaming session) is out of this plan.** So is widening `speechLanguageOf` past two scripts, and the appearance console.
- **Migrations are authored, never applied, by a task.** Applying `db/migrations/050_jarvis_wake_phrase.sql` needs the owner's named approval (Task 11). Until it is applied, every sentence in living copy that names `050` must say it is not applied — `scripts/prove-migration-claims.mjs` reads polarity within 200 characters of the migration path, so an accidental "is applied" is a red gate.
- **Tests are the repo's fixture proofs**, run with `node --experimental-strip-types scripts/<name>.mjs`; there is no jest/vitest harness. Every new rule gets a check **and** a mutation that must turn it red.
- **Gate commands** (Task 11 runs all of them): `node_modules/.bin/tsc --noEmit`, `npm run lint`, `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`, `… prove-assistant-voice.mjs`, `… prove-assistant-merge.mjs`, `… prove-jarvis-corner.mjs`, `… prove-person-spine.mjs`, `… prove-migration-claims.mjs`, `… prove-guide-figures.mjs`.
- **Never kill the dev server** at `localhost:3001`, never `docker compose up/down` the running `app` container, and commit only when the owner asks.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/modules/assistant/domain/jarvis.ts` | modify — `wakePhrase` joins the eight prefs places; the consent-cutoff rule | 1 |
| `src/modules/assistant/application/jarvisSettings.ts` | modify — the refused-write sentence names the column's own migration | 2 |
| `db/migrations/050_jarvis_wake_phrase.sql` | create — the `wake_phrase` column and its shape check | 2 |
| `scripts/prove-migration-claims.mjs` | modify — 050's probe | 2 |
| `scripts/prove-jarvis-presence.mjs` | modify — checks 14–17 and their mutations | 1, 3 |
| `src/modules/assistant/domain/listening.ts` | create — the four gate constants, `sampleGate`, the quota mirror | 3 |
| `src/modules/assistant/presentation/useJarvisMeter.ts` | modify — the stream it owns is handed out | 4 |
| `src/modules/assistant/presentation/voice/useWakeListening.ts` | create — the gate, the recorder, `useMicrophoneAvailable` | 4 |
| `src/modules/assistant/presentation/voice/useWakeWord.ts` | **delete** (in Task 5, when its last import goes) | 5 |
| `src/modules/assistant/presentation/JarvisPresence.tsx` | modify — the dependency flip, the account phrase, the new hook | 5 |
| `src/app/(admin)/assistant/AssistantChat.tsx` | modify — the new hook, the account phrase, no language | 5, 6 |
| `src/modules/assistant/presentation/voice/VoiceStrip.tsx` | modify — the selector and its props are gone; the listening line is true | 6 |
| `src/app/(admin)/assistant/AssistantPrefs.tsx` | modify — `VoiceLanguage`, its storage, and the stored wake phrase are gone | 6 |
| `src/app/(admin)/settings/JarvisPresenceConsole.tsx` | modify — the wake-phrase control, the re-consent ask, the rewritten disclosures | 7 |
| `src/modules/assistant/presentation/voice/useSpeech.ts` | modify — a script the machine cannot speak says so | 8 |
| `src/modules/shell/domain/pageGuide.ts` | modify — the four sentences this slice falsifies | 9 |
| `scripts/prove-assistant-voice.mjs`, `scripts/prove-assistant-merge.mjs`, `scripts/prove-jarvis-corner.mjs`, `scripts/prove-person-spine.mjs` | modify — the pinned needles this slice moves | 9 |

---

### Task 1: The wake phrase joins the preferences ladder

`wake_phrase` becomes one more field of the person's own row, travelling the eight paths `quiet_from` already walks, and a consent stamp taken under the old "Chrome sends this to Google" wording stops carrying over.

**Files:**
- Modify: `src/modules/assistant/domain/jarvis.ts`
- Modify: `scripts/prove-jarvis-presence.mjs` (append `check14`, `check15`, `check16`; register them; append mutations 34–38)

**Interfaces:**
- Consumes: nothing new — this task only widens `JarvisPrefs`.
- Produces: `JarvisPrefs.wakePhrase: string | null`; `DEFAULT_JARVIS_PREFS.wakePhrase: null`; `MAX_WAKE_PHRASE_LEN = 48`; `AMBIENT_CONSENT_V2_AT: string`; `consentCarriesOver(stamp: unknown): boolean`. Every later task and every surface reads the phrase through `prefs.wakePhrase`.

- [ ] **Step 1: Write the failing checks**

Append to `scripts/prove-jarvis-presence.mjs`, immediately above `const CHECKS = [`:

```js
// ---------------------------------------------------------------------------
// 14. The wake phrase is a field of the row, with the same ceiling as the code
// ---------------------------------------------------------------------------
async function check14() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];

  // A row that names no phrase is the default, not an empty match.
  expect(problems, "no column is the default", jarvis.DEFAULT_JARVIS_PREFS.wakePhrase, null);
  expect(problems, "a bare row reads null", jarvis.normalizeJarvisPrefs({}).wakePhrase, null);
  expect(problems, "a row's phrase survives", jarvis.normalizeJarvisPrefs({ wake_phrase: "يا Jarvis" }).wakePhrase, "يا Jarvis");
  // 48 is MAX_WAKE_PHRASE_CHARS written here as SQL-shaped refusal; over it is not a phrase.
  const long = "a".repeat(jarvis.MAX_WAKE_PHRASE_LEN + 1);
  expect(problems, "a row longer than the ceiling reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: long }).wakePhrase, null);
  expect(problems, "a blank row value reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: "   " }).wakePhrase, null);
  expect(problems, "a non-string row value reads null", jarvis.normalizeJarvisPrefs({ wake_phrase: 42 }).wakePhrase, null);

  // The column travels with the eight places every other field travels through.
  expect(problems, "the column list carries wake_phrase", jarvis.JARVIS_PREF_COLUMNS.includes("wake_phrase"), true);
  const draft = jarvis.normalizeJarvisPrefs(jarvis.jarvisRowToSave({ wakePhrase: "ابدأ" }, jarvis.DEFAULT_JARVIS_PREFS, { given: false, stamp: "" }));
  expect(problems, "a draft phrase is stored", draft.wakePhrase, "ابدأ");
  // Refused, not defaulted: an over-long draft leaves the stored phrase where it was.
  const refused = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ wakePhrase: long }, { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }, { given: false, stamp: "" })
  );
  expect(problems, "an over-long draft keeps the stored phrase", refused.wakePhrase, "يا Jarvis");
  // A cleared field is a real request: null, which *is* the default.
  const cleared = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ wakePhrase: "   " }, { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }, { given: false, stamp: "" })
  );
  expect(problems, "a cleared field falls back to the default", cleared.wakePhrase, null);
  // The row the writer sends carries the column and nothing wider.
  const row = jarvis.jarvisRowToSave({ wakePhrase: "يا Jarvis" }, jarvis.DEFAULT_JARVIS_PREFS, { given: false, stamp: "" });
  expect(problems, "the saved row's columns", Object.keys(row).sort(), [...jarvis.JARVIS_PREF_COLUMNS].sort());

  // The trail names the phrase it moved and never copies the row into a summary.
  const said = jarvis.summarizeJarvisChange(
    { ...jarvis.DEFAULT_JARVIS_PREFS },
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "يا Jarvis" }
  );
  problems.push(...(said.includes("wake phrase") ? [] : [`the trail never names the wake phrase: ${said}`]));
  problems.push(...(said.includes("يا Jarvis") ? [] : [`the trail names the phrase without quoting the row: ${said}`]));
  const untouched = jarvis.summarizeJarvisChange(
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "Hey Jarvis" },
    { ...jarvis.DEFAULT_JARVIS_PREFS, wakePhrase: "Hey Jarvis" }
  );
  problems.push(...(untouched.includes("wake phrase") ? ["the trail names a switch that did not move"] : []));
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 15. The ceiling in this module is the ceiling in voice.ts, in words
// ---------------------------------------------------------------------------
async function check15() {
  const jarvis = await load(DOMAIN_URL);
  const voice = await load(pathToFileURL(path.join(root, "src/modules/assistant/domain/voice.ts")).href);
  const problems = [];
  // jarvis.ts imports nothing, so the 48 is duplicated on purpose — and a proof is
  // the only thing that keeps the two copies from drifting apart.
  expect(problems, "the two ceilings agree", jarvis.MAX_WAKE_PHRASE_LEN, voice.MAX_WAKE_PHRASE_CHARS);
  expect(problems, "the default phrase matches", jarvis.DEFAULT_WAKE_PHRASE_TEXT, voice.DEFAULT_WAKE_PHRASE);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 16. A stamp taken under the browser-vendor wording does not carry over
// ---------------------------------------------------------------------------
async function check16() {
  const jarvis = await load(DOMAIN_URL);
  const problems = [];
  const old = new Date(Date.parse(jarvis.AMBIENT_CONSENT_V2_AT) - 86_400_000).toISOString();
  const fresh = new Date(Date.parse(jarvis.AMBIENT_CONSENT_V2_AT) + 86_400_000).toISOString();
  expect(problems, "an older stamp is refused", jarvis.consentCarriesOver(old), false);
  expect(problems, "a stamp at the cutoff carries", jarvis.consentCarriesOver(jarvis.AMBIENT_CONSENT_V2_AT), true);
  expect(problems, "a newer stamp carries", jarvis.consentCarriesOver(fresh), true);
  expect(problems, "no stamp carries nothing", jarvis.consentCarriesOver(null), false);
  expect(problems, "a garbled stamp carries nothing", jarvis.consentCarriesOver("last tuesday"), false);

  // The armed microphone obeys the cutoff, so an existing row goes quiet on its own.
  expect(
    problems,
    "an old stamp no longer arms",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: old }),
    false
  );
  expect(
    problems,
    "a fresh stamp still arms",
    jarvis.canArmAmbient({ ...jarvis.DEFAULT_JARVIS_PREFS, ambient: true, ambientConsentAt: fresh }),
    true
  );
  // A save that does not bring a new acknowledgement cannot revive a stale stamp.
  const revived = jarvis.normalizeJarvisPrefs(
    jarvis.jarvisRowToSave({ ambient: true }, { ...jarvis.DEFAULT_JARVIS_PREFS, ambient: false, ambientConsentAt: old }, { given: false, stamp: "" })
  );
  expect(problems, "a stale stamp is not re-armed by a switch flip", revived.ambient, false);
  return verdict(problems);
}
```

Register them by extending `const CHECKS` after the check-13 entry:

```js
  ["14. The wake phrase is a stored field that refuses what it cannot express", check14],
  ["15. The phrase ceiling in jarvis.ts is the ceiling in voice.ts", check15],
  ["16. A consent stamp taken under the browser-vendor wording does not carry over", check16],
```

- [ ] **Step 2: Run the proofs and read the three failures**

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: checks 14, 15 and 16 `FAIL` — `14. The wake phrase…: expected null, got undefined` and `threw`/`undefined` reads on `MAX_WAKE_PHRASE_LEN`, `DEFAULT_WAKE_PHRASE_TEXT` and `consentCarriesOver`. Checks 1–13 stay green.

- [ ] **Step 3: Implement the ladder in `domain/jarvis.ts`**

Seven edits, each anchored on the sentence it changes.

**(a)** Add the ceilings and the cutoff beside the other vocabulary, immediately after the `STOP_PHRASES` / `TOKEN_SPLIT` block and before the `BriefingDueInput` section:

```ts
// ---------------------------------------------------------------------------
// The wake phrase
// ---------------------------------------------------------------------------

/**
 * The longest phrase a person may be woken by, in characters.
 *
 * `domain/voice.ts` owns the same number and `jarvis.ts` imports nothing, so this
 * is a deliberate duplicate pinned by check 15 in `prove-jarvis-presence.mjs`
 * rather than a shared import that would break the pure-module rule. The SQL
 * ceiling in `db/migrations/050_jarvis_wake_phrase.sql` is the third copy.
 */
export const MAX_WAKE_PHRASE_LEN = 48;

/**
 * The phrase an account with none has, spelled here because the panel has to show
 * it before the person's own row has arrived.
 *
 * `domain/voice.ts` owns the same string; check 15 pins the two together.
 */
export const DEFAULT_WAKE_PHRASE_TEXT = "Hey Jarvis";

/**
 * The moment the microphone's destination changed from the browser vendor's speech
 * service to this portal's own gateway.
 *
 * A stamp taken before it was taken under an explanation that is no longer true, so
 * it no longer arms anything: the panel asks again, once, in the new words. The
 * date is this slice's, not a rolling one — a stamp written after it can only have
 * been earned by the explanation now on the screen.
 */
export const AMBIENT_CONSENT_V2_AT = "2026-10-29T00:00:00.000Z";
```

**(b)** Widen `JarvisPrefs` — the interface currently ends with `quietTo: string;`; add the phrase:

```ts
  quietFrom: string;
  quietTo: string;
  /** The words that wake the orb, or null for `Hey Jarvis`. Stored on the account. */
  wakePhrase: string | null;
}
```

**(c)** In `DEFAULT_JARVIS_PREFS`, add after `quietTo: "08:00",`:

```ts
  wakePhrase: null,
```

**(d)** Add the reader beside the other single-field readers, after `consentStamp`:

```ts
/**
 * A stored phrase, or null when the value is not one.
 *
 * A hand-edited row cannot name a phrase the ceiling refuses or carry a control
 * character, so an out-of-vocabulary value reads as "no choice made" rather than as
 * a phrase the orb would try to match.
 */
function wakePhraseValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > MAX_WAKE_PHRASE_LEN) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F]/.test(value)) return null;
  return clean;
}

/**
 * Whether a consent stamp was earned under the explanation now on the screen.
 *
 * Only the destination of the audio changed, so this is one comparison against a
 * fixed date rather than a new column: a stamp at exactly the cutoff counts, because
 * it could not have been taken under wording that had already been replaced.
 */
export function consentCarriesOver(stamp: unknown): boolean {
  const clean = consentStamp(stamp);
  if (clean === null) return false;
  return Date.parse(clean) >= Date.parse(AMBIENT_CONSENT_V2_AT);
}
```

**(e)** In `normalizeJarvisPrefs`'s returned object, after the `quietTo` line, add:

```ts
    wakePhrase: wakePhraseValue(row.wake_phrase),
```

**(f)** `canArmAmbient` — replace the whole function body's condition so the cutoff is enforced at the one place the microphone is decided:

```ts
/**
 * Whether the background wake word may run for this person.
 *
 * Three things have to be true: the switch is on, the audio explanation was
 * accepted with a stamp the server wrote, and that stamp was written under the
 * explanation now on the panel. The third is what makes the destination change
 * honest — a yes taken under "Chrome sends this to Google" is not a yes about this
 * portal's gateway, so `AMBIENT_CONSENT_V2_AT` retires it and the orb stays quiet
 * until the person answers the new question.
 */
export function canArmAmbient(prefs: JarvisPrefs): boolean {
  return prefs.ambient === true && consentCarriesOver(prefs.ambientConsentAt);
}
```

**(g)** `JARVIS_PREF_COLUMNS` — add `"wake_phrase",` after `"quiet_to",`. `COLUMN_BY_DRAFT_KEY` — add both spellings after the `quiet_to` entry:

```ts
  wakePhrase: "wake_phrase",
  wake_phrase: "wake_phrase",
```

`prefsToRow` — add after the `quiet_to` line:

```ts
    wake_phrase: prefs.wakePhrase,
```

`draftValue` — add a case above `default:` that refuses rather than defaults:

```ts
    // Refused, not reset: a phrase over the ceiling, blank, or carrying a control
    // character is a field that cannot express the choice, and quietly moving a
    // person back to "Hey Jarvis" would un-wake an orb they had just tuned. A
    // cleared field *is* a request — it reads as null, which is the default.
    case "wake_phrase":
      return value === null || (typeof value === "string" && value.trim() === "") ? null : wakePhraseValue(value) ?? previous.wakePhrase;
```

`jarvisRowToSave` — the ambient block currently reads `if (next.ambient) { if (earned) … }`; make a stale stamp earn nothing by folding the cutoff into the same decision:

```ts
  if (next.ambient) {
    if (earned) next.ambientConsentAt = heard;
    else if (!consentCarriesOver(next.ambientConsentAt)) {
      next.ambient = false;
      next.ambientConsentAt = null;
    }
  }
```

**(h)** `summarizeJarvisChange` — add the phrase to the trail. The `SWITCH_LABELS` record is typed `Record<"ambient" | "briefing" | "watching", string>`; leave it alone (a label beside a value that reads oddly in a sentence) and extend the function instead. The function assembles its sentence in `const parts: string[] = []` and joins it at the end; add after the last `parts.push(...)` for the switches:

```ts
  if (next.wakePhrase !== previous.wakePhrase) {
    parts.push(
      next.wakePhrase === null
        ? "wake phrase (back to the default)"
        : `wake phrase “${next.wakePhrase}”`
    );
  }
```

The proof requires the joined sentence to contain `wake phrase` *and the phrase itself* when the field moved, and neither when it did not — which is how every other field in this sentence already reads (`briefing from 09:00`, `quiet 22:00-08:00`). The trail names the words a person chose; it never copies the row.

- [ ] **Step 4: Run the proofs and confirm green**

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `16/16 checks held` (checks 1–13 still green; 14–16 now pass), and every existing mutation still turns its check red.

- [ ] **Step 5: Add the five mutations and prove they turn red**

Append after mutation 33, the last entry in the file:

```js
await mutation(
  "34. A wake phrase over the ceiling silently reset to the default → check 14 red",
  DOMAIN_REL,
  '      return value === null || (typeof value === "string" && value.trim() === "") ? null : wakePhraseValue(value) ?? previous.wakePhrase;',
  "      return wakePhraseValue(value);",
  async () => checkIsRed(14)
);

await mutation(
  "35. A trail sentence that quotes the row's phrase → check 14 red",
  DOMAIN_REL,
  '        : "wake phrase"',
  '        : `wake phrase “${next.wakePhrase}”`',
  async () => checkIsRed(14)
);

await mutation(
  "36. The two ceilings drifting apart → check 15 red",
  DOMAIN_REL,
  "export const MAX_WAKE_PHRASE_LEN = 48;",
  "export const MAX_WAKE_PHRASE_LEN = 47;",
  async () => checkIsRed(15)
);

await mutation(
  "37. A stamp taken under the old wording still arming → check 16 red",
  DOMAIN_REL,
  "  return prefs.ambient === true && consentCarriesOver(prefs.ambientConsentAt);",
  "  return prefs.ambient === true && typeof prefs.ambientConsentAt === \"string\" && prefs.ambientConsentAt.length > 0;",
  async () => checkIsRed(16)
);

await mutation(
  "38. A switch flip reviving a retired stamp → check 16 red",
  DOMAIN_REL,
  "    else if (!consentCarriesOver(next.ambientConsentAt)) {",
  "    else if (next.ambientConsentAt === null) {",
  async () => checkIsRed(16)
);
```

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `16/16 checks held, 38/38 mutations turned red.` A `needle not found in …` on any of the five means the sentence in Step 3 moved — fix the needle to match what was actually written, never loosen the check.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/domain/jarvis.ts scripts/prove-jarvis-presence.mjs
git commit -m "feat(assistant): the wake phrase is a stored field, and a stale consent stops arming"
```

---

### Task 2: Migration 050, its probe, and the sentence that names it

The column that stores the phrase, registered where the repo asks a database whether a migration is applied, plus the writer refusing to blame the wrong file when a column is missing.

**Files:**
- Create: `db/migrations/050_jarvis_wake_phrase.sql`
- Modify: `scripts/prove-migration-claims.mjs` (the `MIGRATIONS` array, after the `049_jarvis_appearance.sql` entry)
- Modify: `src/modules/assistant/application/jarvisSettings.ts` (the sentence, and Step 3b's payload prune)
- Modify: `scripts/prove-jarvis-presence.mjs` (append `check17`, register it, append mutations 39–40)

**Interfaces:**
- Consumes: `JarvisPrefs.wakePhrase` and `JARVIS_PREF_COLUMNS` from Task 1; `saveJarvisPrefs` already upserts whatever `jarvisRowToSave` returns.
- Produces: column `public.assistant_jarvis_prefs.wake_phrase`; `saveJarvisPrefs` returning `{ ok: false, error }` whose sentence names `050` when the draft asked for a phrase and `047` otherwise, and whose upsert payload carries `wake_phrase` **only** when the draft named it — so a database without 050 still saves every other switch.

- [ ] **Step 1: Author the migration in 049's exact idiom**

Create `db/migrations/050_jarvis_wake_phrase.sql`. `049_jarvis_appearance.sql` has no leading comment block and its statements are re-runnable; match that.

```sql
begin;

alter table public.assistant_jarvis_prefs
  add column if not exists wake_phrase text
  constraint assistant_jarvis_wake_phrase_shape check (
    wake_phrase is null
    or (
      char_length(btrim(wake_phrase)) between 1 and 48
      and wake_phrase !~ '[\u0000-\u001F]'
    )
  );

notify pgrst, 'reload schema';
commit;
```

Do **not** apply it — that is Task 11 and it needs the owner's named approval.

- [ ] **Step 2: Write the failing probe registration**

Add to the `MIGRATIONS` array in `scripts/prove-migration-claims.mjs`, after the `049_jarvis_appearance.sql` object:

```js
  {
    file: "050_jarvis_wake_phrase.sql",
    asks:
      "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='assistant_jarvis_prefs' and column_name='wake_phrase') as present",
  },
```

Run: `node --experimental-strip-types scripts/prove-migration-claims.mjs`
Expected: the file-existence and probe-coverage checks pass (050 exists now and is registered); the **live** half reports 050 as absent — that is correct and green until it is applied. A `FAIL` naming polarity means living copy already says something untrue about 050; read the named file and fix the copy, not the probe.

- [ ] **Step 3: Make the refused write name the right migration**

`jarvisSettings.ts` has one sentence for every refusal, `MIGRATION_SENTENCE`, naming 047. Once 050 exists, a missing `wake_phrase` column is refused with a filename that has nothing to do with it. Replace the constant block:

```ts
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
```

`MIGRATION_SENTENCE` has two uses in this file — the reader's `absent-table` answer and the writer's refusal. Point them at their own truth: `readJarvisPrefs` answers with `TABLE_SENTENCE` (a read of `*` cannot fail on a missing column, so only a missing table can mean absent here), and the writer answers with the draft it was given. In `saveJarvisPrefs`, replace:

```ts
    if (absent(error)) return { ok: false, error: MIGRATION_SENTENCE };
```

with:

```ts
    if (absent(error)) return { ok: false, error: migrationSentence(draft) };
```

and replace `message: MIGRATION_SENTENCE` in `jarvisPresenceForViewer` with `message: TABLE_SENTENCE`. Then import the map's source of names: add `COLUMN_BY_DRAFT_KEY` to the existing `import { … } from "@/modules/assistant/domain/jarvis"` statement — it is exported from Task 1's file already (`const COLUMN_BY_DRAFT_KEY` is module-private today, so **export it** in `jarvis.ts` as part of this step and add a note to the JSDoc that the writer reads it to name migrations).

- [ ] **Step 3b: Prune the phrase from a payload that never asked for it**

Since Step (g) of Task 1, `prefsToRow` puts `wake_phrase` into **every** row the writer builds, so on a database that holds `047` but not `050` PostgREST refuses the whole body for one unknown column (`PGRST204`), `absent()` matches it, and *no* switch on the panel saves — the very promise Task 9's Guide copy makes ("every other switch still saves") would be untrue until Task 11 applies the migration. `absent()` cannot tell a missing column from a missing table, so this is fixed by sending less, not by matching better.

In `saveJarvisPrefs`, the row is built at `const row = jarvisRowToSave(…)` and handed straight to `.upsert({ ...row, profile_id: …, updated_at: … })`. Split the wire payload away from the row the person reads back:

```ts
  const payload = { ...row, profile_id: user.profileId, updated_at: new Date().toISOString() };
  // The row describes the whole preference set, so it names `wake_phrase` even for
  // a draft that never touched it. On a database with 047 and without 050 that one
  // unknown column makes PostgREST refuse the entire body, and `absent()` reads the
  // refusal as the table being missing — so a person moving their briefing hour
  // would be blocked by a field they never spoke to. Send the column only when this
  // draft named it; then the phrase is the only write that can need 050.
  if (!("wakePhrase" in draft)) delete payload.wake_phrase;
```

and upsert `payload`. Leave `const prefs = normalizeJarvisPrefs(row)` reading the **row**, not the payload: an unrelated save must still return the phrase the person stored, not the default.

- [ ] **Step 4: Prove the sentence, and prove the phrase round-trips**

Append `check17` to `scripts/prove-jarvis-presence.mjs`, registered as
`["17. A refused write names the file the draft actually needs", check17]`:

```js
async function check17() {
  const settings = await load(SETTINGS_URL);
  const staff = { profileId: "p-1", role: "SUPER_ADMIN", name: "T" };
  const problems = [];

  // A phrase write against a database without 050 must name 050, not the table it
  // already has.
  const rejected = fakeRest({
    read: { data: { profile_id: "p-1" }, error: null },
    write: { error: { code: "PGRST204", message: 'column assistant_jarvis_prefs.wake_phrase of assistant_jarvis_prefs does not exist' } },
  });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: rejected.client });
  const phraseResult = await settings.saveJarvisPrefs({ wakePhrase: "يا Jarvis" });
  expect(problems, "a phrase write is refused", phraseResult.ok, false);
  problems.push(
    ...(!String(phraseResult.ok === false && phraseResult.error).includes("050_jarvis_wake_phrase")
      ? [`the refusal did not name 050: ${JSON.stringify(phraseResult)}`]
      : [])
  );
  problems.push(
    ...(String(phraseResult.ok === false && phraseResult.error).includes("047")
      ? ["the refusal blamed the table that is already there"]
      : [])
  );

  // A switch write against the same database still blames the table, because that
  // is the only file it needs.
  const switchRejected = fakeRest({
    read: { data: null, error: null },
    write: { error: { code: "42P01", message: 'relation "public.assistant_jarvis_prefs" does not exist' } },
  });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: switchRejected.client });
  const switchResult = await settings.saveJarvisPrefs({ briefing: true });
  expect(problems, "a switch write is refused", switchResult.ok, false);
  problems.push(
    ...(!String(switchResult.ok === false && switchResult.error).includes("047")
      ? [`the refusal did not name 047: ${JSON.stringify(switchResult)}`]
      : [])
  );

  // Step 3b: a draft that never mentions the phrase must not put its column on the
  // wire. `fakeRest` records each call, so the check reads the payload it was handed.
  const pruned = fakeRest({
    read: { data: { profile_id: "p-1", wake_phrase: "يا Jarvis" }, error: null },
    write: { error: null },
  });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: pruned.client });
  const switchSaved = await settings.saveJarvisPrefs({ briefing: false });
  expect(problems, "a switch write succeeds with the column absent", switchSaved.ok, true);
  expect(problems, "and still reports the phrase the row holds", switchSaved.ok === true && switchSaved.prefs.wakePhrase, "يا Jarvis");
  const prunedBody = pruned.calls.find((entry) => entry.op === "upsert");
  problems.push(
    ...(prunedBody && "wake_phrase" in prunedBody.payload
      ? ["a switch write sent the phrase column anyway"]
      : [])
  );

  // And a draft that DOES name the phrase sends it, so clearing the field is real.
  const named = fakeRest({
    read: { data: { profile_id: "p-1", wake_phrase: "يا Jarvis" }, error: null },
    write: { error: null },
  });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: named.client });
  await settings.saveJarvisPrefs({ wakePhrase: "   " });
  const namedBody = named.calls.find((entry) => entry.op === "upsert");
  problems.push(
    ...(!namedBody || namedBody.payload.wake_phrase !== null
      ? ["a cleared phrase did not reach the row as null"]
      : [])
  );

  // And a stored phrase arrives whole on the read.
  const withPhrase = fakeRest({ read: { data: { profile_id: "p-1", wake_phrase: "يا Jarvis" }, error: null } });
  resetGlobals({ __jarvisUser: staff, __jarvisRest: withPhrase.client });
  const read = await settings.readJarvisPrefs("p-1");
  expect(problems, "the reader hands the phrase over", read.prefs.wakePhrase, "يا Jarvis");
  expect(problems, "and says it was stored", read.stored, true);
  return verdict(problems);
}
```

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `17/17 checks held`. If `050` never appears, `COLUMN_BY_DRAFT_KEY` is not exported or `MIGRATION_BY_COLUMN` is keyed by the draft name instead of the column.

- [ ] **Step 5: Pin the SQL ceiling against the constant**

Append to `check14`'s end (before its `return verdict(problems);`) — reading the migration is what the file already does for 047 via `MIGRATION_REL`:

```js
  // 48 is written in three places: voice.ts, jarvis.ts, and this SQL. The first two
  // are pinned by check 15; this pins the third, because a ceiling only the database
  // knows about is a ceiling the panel will offer and the write will refuse.
  const migration = read("db/migrations/050_jarvis_wake_phrase.sql");
  expect(problems, "the column check caps the phrase at the same length", migration.includes(`between 1 and ${jarvis.MAX_WAKE_PHRASE_LEN}`), true);
  expect(problems, "the column is nullable so nobody is seeded a phrase", migration.includes("wake_phrase text"), true);
```

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `17/17 checks held`.

- [ ] **Step 5b: Two mutations, one for each rule this task adds**

The plan's rule is that every new rule gets a check *and* a mutation. Append after mutation 38 (Task 1's last entry), in the file's own idiom:

```js
await mutation(
  "39. A switch write carries the phrase column anyway → check 17 red",
  SETTINGS_REL,
  '  if (!("wakePhrase" in draft)) delete payload.wake_phrase;',
  "  // prune lifted",
  async () => checkIsRed(17)
);

await mutation(
  "40. Every refusal blames the table → check 17 red",
  SETTINGS_REL,
  "return { ok: false, error: migrationSentence(draft) };",
  "return { ok: false, error: TABLE_SENTENCE };",
  async () => checkIsRed(17)
);
```

If the first reports `needle not found`, the prune was written into `row` instead of `payload` — that is the Step 3b defect, not a bad needle.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/050_jarvis_wake_phrase.sql scripts/prove-migration-claims.mjs scripts/prove-jarvis-presence.mjs src/modules/assistant/application/jarvisSettings.ts src/modules/assistant/domain/jarvis.ts
git commit -m "feat(assistant): 050 stores the wake phrase on the account, and a refusal names the file it needs"
```

---

### Task 3: The energy gate, as four constants and one reducer

Tier 1 decides when a segment of room audio is worth a transcription call, knowing nothing about language. It lives in a pure module so a fixture drives it with numbers instead of a microphone.

**Files:**
- Create: `src/modules/assistant/domain/listening.ts`
- Modify: `scripts/prove-jarvis-presence.mjs` (append `check18`, `check19`; register them; append mutations 41–44)

**Interfaces:**
- Consumes: nothing.
- Produces: `GATE_LEVEL_THRESHOLD`, `GATE_HYSTERESIS`, `GATE_MIN_SEGMENT_MS`, `GATE_MAX_SEGMENT_MS`, `TRANSCRIPTION_WINDOW_MS`, `TRANSCRIPTION_MAX_SEGMENTS`, `type GateState`, `GATE_CLOSED`, `sampleGate(gate, level, nowMs): { gate, clip }`, `LISTENING_QUOTA_SENTENCE`. Task 4's hook is the only consumer, and Task 7's panel prints `LISTENING_QUOTA_SENTENCE`.

- [ ] **Step 1: Write the failing checks**

Append above `const CHECKS = [`:

```js
// ---------------------------------------------------------------------------
// 18. The gate opens on speech, closes on silence, and never runs away
// ---------------------------------------------------------------------------
async function check18() {
  const listening = await load(pathToFileURL(path.join(root, "src/modules/assistant/domain/listening.ts")).href);
  const jarvis = await load(DOMAIN_URL);
  const problems = [];

  // Four numbers decide the always-on tier, and they are the whole vocabulary.
  expect(problems, "the threshold is a loudness, not a percent", listening.GATE_LEVEL_THRESHOLD > 0 && listening.GATE_LEVEL_THRESHOLD < 1, true);
  expect(problems, "the hysteresis is smaller than the threshold", listening.GATE_HYSTERESIS < listening.GATE_LEVEL_THRESHOLD, true);
  expect(problems, "the floor is shorter than the cap", listening.GATE_MIN_SEGMENT_MS < listening.GATE_MAX_SEGMENT_MS, true);

  const hi = listening.GATE_LEVEL_THRESHOLD;
  const lo = listening.GATE_LEVEL_THRESHOLD - listening.GATE_HYSTERESIS - 0.01;

  // A closed gate hearing nothing stays closed and yields nothing.
  let outcome = listening.sampleGate(listening.GATE_CLOSED, 0, 0);
  expect(problems, "silence does not open a segment", outcome, { gate: { openFrom: null }, clip: null });

  // Speech opens it, and the opening sample is not itself a clip.
  outcome = listening.sampleGate(listening.GATE_CLOSED, hi, 1000);
  expect(problems, "the opening sample", outcome, { gate: { openFrom: 1000 }, clip: null });

  // A level inside the hysteresis band holds the segment open — a consonant tail
  // that dips is still the same sentence.
  const held = listening.sampleGate(outcome.gate, hi - listening.GATE_HYSTERESIS / 2, 1200);
  expect(problems, "a dip inside the hysteresis holds it open", held, { gate: { openFrom: 1000 }, clip: null });

  // Silence below the band closes it and yields the segment.
  const closed = listening.sampleGate(outcome.gate, lo, 1400);
  expect(problems, "silence closes the segment", closed, {
    gate: { openFrom: null },
    clip: { startMs: 1000, endMs: 1400 },
  });

  // A segment shorter than the floor is not speech worth a call: cough, click, breath.
  const tiny = listening.sampleGate({ openFrom: 1000 }, lo, 1000 + listening.GATE_MIN_SEGMENT_MS - 1);
  expect(problems, "a too-short segment is discarded", tiny.clip, null);
  expect(problems, "and the gate is closed again", tiny.gate, { openFrom: null });

  // A never-ending segment is capped, kept, and re-opened at the cap boundary while
  // the person is still talking — otherwise one long answer costs one call and the
  // rest of it is lost.
  const overrun = listening.sampleGate({ openFrom: 1000 }, hi, 1000 + listening.GATE_MAX_SEGMENT_MS + 50);
  expect(problems, "the cap cuts the clip at the ceiling", overrun.clip, {
    startMs: 1000,
    endMs: 1000 + listening.GATE_MAX_SEGMENT_MS,
  });
  expect(problems, "and a still-speaking gate re-opens", overrun.gate, { openFrom: 1000 + listening.GATE_MAX_SEGMENT_MS });

  // The same cap with nobody still talking does not invent a fresh segment.
  const overrunQuiet = listening.sampleGate({ openFrom: 1000 }, lo, 1000 + listening.GATE_MAX_SEGMENT_MS + 50);
  expect(problems, "a capped clip that has gone quiet does not re-open", overrunQuiet.gate, { openFrom: null });

  // The numbers a retune would change are not written anywhere else.
  const meter = read("src/modules/assistant/presentation/useJarvisMeter.ts");
  problems.push(...(meter.includes("sum / bytes.length / 128") ? [] : ["the meter no longer scales the way the threshold is worded"]));
  expect(problems, "the gate is not a jarvis.ts concept", typeof jarvis.sampleGate, "undefined");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 19. The cap the panel prints is the cap the door enforces
// ---------------------------------------------------------------------------
async function check19() {
  const listening = await load(pathToFileURL(path.join(root, "src/modules/assistant/domain/listening.ts")).href);
  const problems = [];
  const route = read("src/app/api/assistant/voice/route.ts");

  // The panel promises a ceiling; the route is the only thing that imposes it. Two
  // numbers written twice are only honest while a proof keeps them equal.
  problems.push(...(route.includes(`const WINDOW_MS = ${listening.TRANSCRIPTION_WINDOW_MS}`) || route.includes(`const WINDOW_MS = ${formatMs(listening.TRANSCRIPTION_WINDOW_MS)}`) ? [] : [`the door's window is not the panel's: ${route.match(/const WINDOW_MS = [^\n]*/)?.[0] ?? "absent"}`]));
  expect(problems, "the door's count is the panel's count", route.includes(`const MAX_UTTERANCES = ${listening.TRANSCRIPTION_MAX_SEGMENTS}`), true);
  // The sentence is what a person reads, so it must carry both numbers.
  problems.push(...(listening.LISTENING_QUOTA_SENTENCE.includes(String(listening.TRANSCRIPTION_MAX_SEGMENTS)) ? [] : ["the quota sentence does not name the count"]));
  problems.push(...(/five|300000|5 min/.test(listening.LISTENING_QUOTA_SENTENCE) ? [] : ["the quota sentence does not name the window"]));
  return verdict(problems);
}
```

`formatMs` does not exist yet — add it beside the other small helpers, next to `expect`:

```js
/** The route's own spelling of a window: `5 * 60_000` for five minutes. */
function formatMs(ms) {
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) && minutes >= 2 ? `${minutes} * 60_000` : String(ms);
}
```

Register:

```js
  ["18. The gate opens on speech, closes on silence, discards a breath, caps a river", check18],
  ["19. The ceiling the panel prints is the ceiling the voice door imposes", check19],
```

- [ ] **Step 2: Run the proofs and read the failure**

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: checks 18 and 19 `FAIL` with `threw: … Cannot find module … listening.ts`. Checks 1–17 stay green.

- [ ] **Step 3: Write the module**

Create `src/modules/assistant/domain/listening.ts`:

```ts
/**
 * When a room is worth a transcription call, as numbers that import nothing.
 *
 * The browser's recogniser could only be told one language at a time, so listening
 * meant choosing what a person was about to speak. This portal's own model removes
 * that choice, and what replaces it is louder and dumber: something is happening, so
 * capture a segment and ask. This module is the whole decision, kept away from the
 * microphone so every rule here can be driven by a fixture — see checks 18 and 19 in
 * `scripts/prove-jarvis-presence.mjs`.
 *
 * What it does *not* decide: whether the person armed the wake word (that is
 * `canArmAmbient` in `jarvis.ts`), whether quiet hours are running (that is
 * `withinQuietHours`), or what a transcript means (that is `matchWakePhrase`).
 */

/* ------------------------------ The gate --------------------------------- */

/**
 * Mean loudness, on the meter's own 0–1 scale, that counts as somebody talking.
 *
 * `useJarvisMeter.ts` divides a frequency-bin mean by 128, so a person speaking
 * normally in a quiet room sits well under full scale. This is the one number a
 * noisy office will need retuned, and retuning it touches nothing else.
 */
export const GATE_LEVEL_THRESHOLD = 0.08;

/**
 * How far below the threshold a level must fall before the segment is over.
 *
 * Speech is not a square wave: a sentence dips between words, and a gate that closed
 * at its own threshold would cut every answer into one-word clips, each of which
 * costs a call.
 */
export const GATE_HYSTERESIS = 0.03;

/**
 * The shortest segment worth a transcription call, in milliseconds.
 *
 * A chair, a cough, and a key are all real sounds under two thirds of a second. The
 * discard is silent and nothing is logged, because a near-miss is not a fact about
 * the person.
 */
export const GATE_MIN_SEGMENT_MS = 350;

/**
 * The longest segment one call will carry, in milliseconds.
 *
 * A cap, not a target: a person who talks without a pause gets their words cut at
 * the ceiling and a fresh clip opened, rather than an ever-growing upload that the
 * door refuses at 8 MB with no transcript to show for it.
 */
export const GATE_MAX_SEGMENT_MS = 5_000;

/** A segment is a span of wall time on the frame clock, in milliseconds. */
export interface Clip {
  startMs: number;
  endMs: number;
}

/**
 * The gate's whole state: when the open segment began, or null while closed.
 *
 * Nothing else is remembered, which is what makes it replayable from a list of
 * `(level, nowMs)` samples in a test and resettable by dropping the value.
 */
export interface GateState {
  openFrom: number | null;
}

/** Closed, with no segment in flight. The starting state of every armed orb. */
export const GATE_CLOSED: GateState = Object.freeze({ openFrom: null });

export interface GateSample {
  gate: GateState;
  /** The segment to transcribe, or null when this sample produced none. */
  clip: Clip | null;
}

/**
 * One loudness reading, and what it does to the segment.
 *
 * Three rules and their order both matter:
 *
 * - The cap is applied before the silence test, so a long speech burst that ends
 *   exactly at the ceiling yields one capped clip rather than a capped clip and a
 *   discarded sliver.
 * - A re-open after the cap needs the level still above the threshold on that same
 *   sample; a person who stopped speaking at the cap is not handed a silent second
 *   clip to transcribe.
 * - A close keeps its clip only at or above the floor.
 *
 * Time comes in as `nowMs` from the caller's `performance.now()`, never from a clock
 * this module reads, so a fixture controls every boundary.
 */
export function sampleGate(gate: GateState, level: number, nowMs: number): GateSample {
  if (gate.openFrom === null) {
    return level >= GATE_LEVEL_THRESHOLD ? { gate: { openFrom: nowMs }, clip: null } : { gate, clip: null };
  }

  if (nowMs - gate.openFrom >= GATE_MAX_SEGMENT_MS) {
    const endMs = gate.openFrom + GATE_MAX_SEGMENT_MS;
    return {
      gate: { openFrom: level >= GATE_LEVEL_THRESHOLD ? endMs : null },
      clip: { startMs: gate.openFrom, endMs },
    };
  }

  if (level < GATE_LEVEL_THRESHOLD - GATE_HYSTERESIS) {
    const kept = nowMs - gate.openFrom >= GATE_MIN_SEGMENT_MS;
    return {
      gate: { openFrom: null },
      clip: kept ? { startMs: gate.openFrom, endMs: nowMs } : null,
    };
  }

  return { gate, clip: null };
}

/* ------------------------------- The quota ------------------------------- */

/** The voice door's window, mirrored from `MAX_BYTES`-adjacent `WINDOW_MS`. */
export const TRANSCRIPTION_WINDOW_MS = 5 * 60_000;

/** The voice door's per-profile ceiling inside that window. */
export const TRANSCRIPTION_MAX_SEGMENTS = 20;

/**
 * The cap, in the words the panel prints.
 *
 * A person who is interrupted mid-sentence by a limit they were never told about has
 * been lied to by an interface, so the ceiling is stated where the switch is, and
 * check 19 keeps it equal to the number the route actually enforces.
 */
export const LISTENING_QUOTA_SENTENCE =
  "Heard segments are transcribed up to 20 times every five minutes for your account. The orb keeps its gate open when that ceiling is reached and says so; nothing is queued or retried behind your back.";
```

- [ ] **Step 4: Run the proofs and confirm green**

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `19/19 checks held`.

- [ ] **Step 5: Add the four mutations**

Task 2 appends mutations 39–40 to this file, so this task's four follow at 41–44. Append after mutation 40 (Task 2's last entry):

```js
const LISTENING_REL = "src/modules/assistant/domain/listening.ts";

await mutation(
  "41. A gate that closes at its own threshold cuts every sentence into words → check 18 red",
  LISTENING_REL,
  "  if (level < GATE_LEVEL_THRESHOLD - GATE_HYSTERESIS) {",
  "  if (level < GATE_LEVEL_THRESHOLD) {",
  async () => checkIsRed(18)
);

await mutation(
  "42. A too-short segment charged to the gateway anyway → check 18 red",
  LISTENING_REL,
  "    const kept = nowMs - gate.openFrom >= GATE_MIN_SEGMENT_MS;",
  "    const kept = true;",
  async () => checkIsRed(18)
);

await mutation(
  "43. A capped segment that never re-opens, losing the rest of an answer → check 18 red",
  LISTENING_REL,
  "      gate: { openFrom: level >= GATE_LEVEL_THRESHOLD ? endMs : null },",
  "      gate: { openFrom: null },",
  async () => checkIsRed(18)
);

await mutation(
  "44. The panel promising a ceiling the door does not impose → check 19 red",
  LISTENING_REL,
  "export const TRANSCRIPTION_MAX_SEGMENTS = 20;",
  "export const TRANSCRIPTION_MAX_SEGMENTS = 21;",
  async () => checkIsRed(19)
);
```

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `19/19 checks held, 42/42 mutations turned red.`

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/domain/listening.ts scripts/prove-jarvis-presence.mjs
git commit -m "feat(assistant): the energy gate that decides what is worth a transcription call"
```

---

### Task 4: The listening hook, and the meter that lends its stream

`useWakeWord` is deleted and replaced by one hook with the same contract. It takes no second microphone: the loudness meter already holds a capture, and the gate runs on the levels that meter is already reading.

**Files:**
- Create: `src/modules/assistant/presentation/voice/useWakeListening.ts`
- Modify: `src/modules/assistant/presentation/useJarvisMeter.ts`
- Delete: `src/modules/assistant/presentation/voice/useWakeWord.ts` — **not in this task.** Three files still import it until Task 5, so removing it here would break `tsc` mid-slice; this task only stops referring to it.
- Modify: `scripts/prove-assistant-voice.mjs` (the `WAKE_HOOK_REL` block and check 13's hook needles)

**Interfaces:**
- Consumes: `JarvisMeter` from `useJarvisMeter` (which this task widens with `stream`), `sampleGate` / `GATE_CLOSED` / `LISTENING_QUOTA_SENTENCE` from `domain/listening.ts`, `transcribeClip` from `./transcribe`.
- Produces: `useWakeListening({ enabled, meter, quiet, onUtterance }) → { listening: boolean; error: string | null; quotaHit: boolean }` and `useMicrophoneAvailable(): boolean`. `JarvisMeter` gains `stream(): MediaStream | null`. Task 5's two callers are the only consumers. The phrase is *not* a parameter: matching happens on the transcript in the caller that owns the conversation.

- [ ] **Step 1: Hand the meter's stream out**

In `useJarvisMeter.ts`, the `JarvisMeter` interface ends with `error: string | null;`. Add, with the reason:

```ts
export interface JarvisMeter {
  /** 0 when nothing is captured. Called from the paint loop, never during render. */
  read(): number;
  /** True only while a capture is actually open in this browser right now. */
  armed: boolean;
  /** Why there is no level, in words, or null. The orb animates without one. */
  error: string | null;
  /**
   * The capture this hook owns, or null while it holds none.
   *
   * Handed out because a second `getUserMedia` in the same tab is a second
   * microphone prompt and a second thing to release: the wake-word recorder cuts its
   * segments from *this* stream, so one tab has exactly one owner of the capture and
   * the meter stays it. Read after commit, never during render.
   */
  stream(): MediaStream | null;
}
```

The effect already assigns `stream = await navigator.mediaDevices.getUserMedia({ audio: true });` at `useJarvisMeter.ts:100` and clears it in `teardown`. Add a ref that mirrors it, so `read()` and `stream()` are both stable callbacks. Name the callback `readStream` — a `const stream` in the hook body would **shadow** the effect's `let stream` and the effect's assignments would then write a different variable than the ref mirrors:

```ts
  const level = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const read = useCallback(() => level.current, []);
  const readStream = useCallback(() => streamRef.current, []);
```

then, in the effect, mirror the ref exactly where the closure's own `stream` changes. The early-return branch that stops a dead hook's stream nulls the ref too, so a capture released before it was ever handed out is never reported as held:

```ts
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          streamRef.current = null;
          return;
        }
        streamRef.current = stream;
```

and in `teardown`, next to `stream = null;`, add `streamRef.current = null;`. The return value becomes `return { read, armed: enabled && armed, error: enabled ? error : null, stream: readStream };`.

While in this file, its header's second section is titled *"Why this exists beside the recogniser instead of inside it"* and its first line says the stream is *"a second microphone consumer in a tab that may already be holding one."* The recogniser is deleted by this slice and the meter becomes the tab's only owner, so retitle that section *"Why the capture lives here and is handed out"* and say plainly that the wake-word recorder cuts its segments from this stream — the same promise the new `stream()` JSDoc makes.

- [ ] **Step 2: Point the hook's proof at the file that will exist**

In `scripts/prove-assistant-voice.mjs`, the block that reads

```js
  const hook = read("src/modules/assistant/presentation/voice/useWakeWord.ts");
  if (!hook.includes('code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture"')) {
    problems.push("the recognizer does not treat a refusal as fatal");
  }
  if (!hook.includes("if (!active || suspended || stopped) return;")) {
    problems.push("the recognizer restarts after a fatal error");
  }
  if (!hook.includes("if (stopped) return;")) {
    problems.push("returning to the tab restarts a fatally stopped recognizer");
  }
```

describes an API being removed. Replace it with the three rules that survive the swap — a refusal is still fatal, a hidden tab still releases the capture, and no audio is ever kept:

```js
  const hook = read("src/modules/assistant/presentation/voice/useWakeListening.ts");
  if (!hook.includes('name === "NotAllowedError"')) {
    problems.push("a denied microphone is not treated as fatal by the listening hook");
  }
  if (!hook.includes('document.visibilityState === "hidden"')) {
    problems.push("a hidden tab keeps its segments running");
  }
  if (!hook.includes("transcribeClip(")) {
    problems.push("the listening hook does not send its segments to the voice door");
  }
  // The hook never reaches for a microphone of its own — Task 10's audit counts the
  // sites in the whole tree, and this is the one that must not appear in that list.
  if (hook.includes("getUserMedia")) {
    problems.push("the listening hook opens its own capture instead of the meter's");
  }
  // A quiet room is not a fault, so the literal this hook compares must stay the
  // literal the client writes. Two copies of a sentence, pinned together here.
  const client = read("src/modules/assistant/presentation/voice/transcribe.ts");
  const nothingHeard = hook.match(/const NOTHING_HEARD = "([^"]+)";/)?.[1];
  if (!nothingHeard || !client.includes(`{ error: "${nothingHeard}" }`)) {
    problems.push(`the silent-discard needle and the client's sentence disagree: ${nothingHeard ?? "no NOTHING_HEARD constant"}`);
  }
  // The one promise this slice moves without breaking: a segment is a request, not
  // a file. Comments are stripped so the hook's own header cannot be read as code.
  const hookCode = hook.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/getFileStore|storageConfig|\.upload\(|createObjectURL|localStorage/i.test(hookCode)) {
    problems.push("the listening hook appears to keep a recording");
  }
```

And the sentinel the mutations use: replace

```js
const WAKE_HOOK_REL = "src/modules/assistant/presentation/voice/useWakeWord.ts";
```

with

```js
const WAKE_HOOK_REL = "src/modules/assistant/presentation/voice/useWakeListening.ts";
```

Every mutation whose needle points inside `useWakeWord.ts` is rewritten in Task 9 alongside its check; leaving them here would make a mutation match nothing and so pass for free. Note each one as you go and carry it to Task 9's sweep.

- [ ] **Step 3: Write the hook**

Create `src/modules/assistant/presentation/voice/useWakeListening.ts`:

```ts
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GATE_CLOSED, sampleGate, type GateState } from "@/modules/assistant/domain/listening";
import type { JarvisMeter } from "../useJarvisMeter";
import { transcribeClip } from "./transcribe";

function subscribeToNothing() {
  return () => {};
}

const recorderInThisBrowser = () =>
  typeof window !== "undefined" && typeof window.MediaRecorder === "function";
const recorderOnServer = () => false;

/**
 * Whether this browser can capture and encode audio at all.
 *
 * It used to ask for a speech recogniser, which is a Chrome and Edge thing; the
 * gate and `MediaRecorder` are in Firefox too, so the answer and its reason both
 * change. The Settings console reads this to disable the switch with a sentence
 * rather than offer one that cannot work, and nothing else decides reach from it.
 *
 * An external store, not a mount effect: the server renders `false`, the first
 * client render matches it, and the real answer is applied after — a
 * `useEffect` calling `setAvailable` is the second render the React lint rules refuse.
 */
export function useMicrophoneAvailable(): boolean {
  return useSyncExternalStore(subscribeToNothing, recorderInThisBrowser, recorderOnServer);
}

/** The containers this portal's transcription door will read, in the order it prefers. */
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];

function segmentType(): string | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return null;
  return PREFERRED_TYPES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) ?? null;
}

function listeningMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser refused the microphone, so nothing is being heard. Allow it and arm the wake word again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone is available to this browser. Connect one and arm the wake word again.";
  }
  return "This browser cannot encode a recording the transcription model can read. Push to talk still works.";
}

/**
 * The door's own words for a segment nobody spoke into.
 *
 * `transcribe.ts` answers a `NO_SPEECH` (and an empty transcript) with this
 * sentence, and the design says silence is not a fault: nobody heard anything, so
 * nothing is shown and nothing is logged. Compared as a literal rather than by
 * pattern, and check 13 in `prove-assistant-voice.mjs` pins it to the client that
 * writes it — a reworded sentence there would otherwise turn every quiet room into
 * an error the person is blamed for.
 */
const NOTHING_HEARD = "Nothing was heard — try again.";

export interface WakeListeningState {
  /** True while a capture is open and segments are being cut from it. */
  listening: boolean;
  /** Why nothing is being heard, in words, or null. */
  error: string | null;
  /** True once the door answered 429 — the orb is still awake, the asking has stopped. */
  quotaHit: boolean;
}

/**
 * The wake word, heard through this portal's own model instead of the browser's.
 *
 * Four properties every caller depends on:
 *
 * - **No second microphone.** The levels come from the meter that already owns the
 *   capture, and the recorder is built on `meter.stream()`. A tab that opened a
 *   second `getUserMedia` would prompt again and release nothing on time.
 * - **Language-blind.** Nothing here names a language, because the gate cannot know
 *   one and the model decides. The phrase match happens on the transcript, in the
 *   caller that owns the conversation.
 * - **Nothing kept.** A segment is `stop()`-ed into a `Blob`, posted, and dropped. A
 *   transcript reaches the caller that owns the conversation, which discards one
 *   without the phrase in it silently; nothing is logged about a near-miss.
 * - **No capture of its own.** This file never calls `getUserMedia` — check 13 and
 *   Task 10's audit both hold that, because a second call is a second prompt and a
 *   second thing to release.
 *
 * Quiet hours are the caller's `quiet` flag: the gate keeps running so the orb stays
 * awake and animating, and segments are simply not sent. A hidden tab tears the whole
 * run down — the rule the recogniser, the recorder and the meter already follow.
 */
export function useWakeListening({
  enabled,
  meter,
  quiet,
  onUtterance,
}: {
  enabled: boolean;
  meter: JarvisMeter;
  quiet: boolean;
  onUtterance: (text: string) => void;
}): WakeListeningState {
  const [error, setError] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  // Set by the one condition no retry can heal: a refused microphone, a missing
  // device, or a gateway with no key. `listening` is derived from it rather than
  // written beside it, so the orb never claims to hear while the run has ended.
  const [runEnded, setRunEnded] = useState(false);

  // Kept current after commit rather than during render: the frame loop and the
  // recorder's `onstop` hold one handler for the whole run, and a re-arm to pass a
  // new closure would drop the utterance in flight.
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  });

  // A render may not answer by setting state before its first paint, but these async
  // paths may, so `quiet` is read through a ref rather than closing over a render.
  const quietRef = useRef(quiet);
  useEffect(() => {
    quietRef.current = quiet;
  });

  // The meter is a fresh object literal on every render of the component that owns
  // it, so `meter` cannot be an effect dependency: the microphone would be torn down
  // and re-opened by the very render that reports a level. A ref keeps the frame loop
  // pointed at whichever meter this is.
  const meterRef = useRef(meter);
  useEffect(() => {
    meterRef.current = meter;
  });

  useEffect(() => {
    if (!enabled) {
      // The run is over, and so is what it had to say: a disarmed orb shows no advice
      // for a capture it no longer holds, and arming again starts clean.
      setError(null);
      setQuotaHit(false);
      setRunEnded(false);
      return;
    }

    const type = segmentType();
    if (!type) {
      setError(listeningMessage(null));
      setRunEnded(true);
      return;
    }

    let alive = true;
    let frame: number | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let gate: GateState = GATE_CLOSED;
    // The door's refusal no retry can heal: a denied microphone, a missing device or
    // a gateway with no key ends the run and says why, rather than looping
    // start → error at frame speed.
    let stopped = false;

    const stopRecorder = () => {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already ending.
        }
      }
      recorder = null;
      chunks = [];
    };

    /** The run is over for good. Nothing here retries; arming again does. */
    const end = (message: string) => {
      stopped = true;
      alive = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stopRecorder();
      gate = GATE_CLOSED;
      setError(message);
      setRunEnded(true);
    };

    const send = async (clip: Blob) => {
      if (quietRef.current) return;
      const answer = await transcribeClip(clip);
      if (!alive) return;
      if ("error" in answer) {
        if (answer.error === NOTHING_HEARD) return;
        // The ceiling is a state, not a fault to hide: the words that carry the
        // wait are shown, the panel reports the ceiling it hit, and the orb keeps
        // its gate open — the asking stops, the listening does not.
        const quota = /again in|lot of dictation/i.test(answer.error);
        setQuotaHit(quota);
        setError(answer.error);
        // A gateway with no key refuses the next segment exactly as it refused this
        // one, so the room is not posted at it every time somebody speaks.
        if (answer.error.includes("Settings → API keys")) end(answer.error);
        return;
      }
      setQuotaHit(false);
      setError(null);
      if (answer.text) onUtteranceRef.current(answer.text);
    };

    const openSegment = () => {
      const stream = meterRef.current.stream();
      if (!stream || stopped) return;
      chunks = [];
      try {
        recorder = new MediaRecorder(stream, { mimeType: type });
      } catch {
        recorder = null;
        end(listeningMessage(null));
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      // `MediaRecorder` reports no reason worth naming, and a mid-run refusal does
      // not heal by starting again — so the run ends and says what stopped.
      recorder.onerror = () => end("Listening stopped — the browser refused the recording.");
      recorder.onstop = () => {
        const kept = chunks;
        chunks = [];
        recorder = null;
        if (!alive || stopped || kept.length === 0) return;
        void send(new Blob(kept, { type: type.split(";")[0] }));
      };
      try {
        recorder.start();
      } catch {
        stopRecorder();
      }
    };

    const tick = () => {
      if (!alive) return;
      const sample = sampleGate(gate, meterRef.current.read(), performance.now());
      const wasOpen = gate.openFrom !== null;
      gate = sample.gate;
      if (!wasOpen && gate.openFrom !== null) openSegment();
      if (sample.clip) stopRecorder();
      frame = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        alive = false;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        stopRecorder();
        gate = GATE_CLOSED;
        return;
      }
      // Returning to a tab does not overrule a fatal refusal: the condition that
      // ended the run is still there, so restarting would only loop again.
      if (stopped) return;
      alive = true;
      tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // The loop starts whether or not the meter has a capture yet: no stream means a
    // level of zero, which means a gate that stays closed. That is the honest idle
    // state, and it costs no prompt — `getUserMedia` is called in one place, the
    // meter, and this hook never reaches for a second one.
    tick();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      stopRecorder();
      gate = GATE_CLOSED;
    };
    // `meter` is deliberately absent: see the `meterRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Listening is not a fact this hook guesses after calling `start()` — it is the
  // meter's own report of a capture that is open, minus any run-ending refusal. The
  // app bar's indicator and the strip's sentence both follow that, so neither can
  // claim to hear a room the browser will not hand over.
  return { listening: enabled && meter.armed && !runEnded, error, quotaHit };
}
```

The `!enabled` branch above returns before the effect's cleanup is registered, so a disarmed orb keeps no recorder and no frame — and because the meter itself is disabled by the same `enabled` value at Task 5's call sites, the capture goes with it.

Delete `src/modules/assistant/presentation/voice/useWakeWord.ts` in Task 5, where its last imports go; this task creates the replacement and repoints the proof at it.

- [ ] **Step 4: Typecheck what is provable without a browser**

Run: `node_modules/.bin/tsc --noEmit`
Expected: **no new** errors naming `useWakeListening.ts` or `useJarvisMeter.ts`. Errors naming `JarvisPresence.tsx`, `AssistantChat.tsx` and `JarvisPresenceConsole.tsx` for `useWakeWord` are expected here and are closed by Task 5; record their exact text in the task report so Task 11 can prove it is gone.

- [ ] **Step 5: Prove the hook's rules hold**

Run: `node --experimental-strip-types scripts/prove-assistant-voice.mjs`
Expected: check 13 green against the new hook — Step 2 repointed it at a file that now exists. If it reports `the listening hook appears to keep a recording`, remove whatever `createObjectURL` or storage call crept in; if it reports the `NOTHING_HEARD` disagreement, the two sentences drifted. A mutation whose needle still points inside `useWakeWord.ts` now matches nothing and passes for free — Task 9's sweep retargets every one of them, and until then a green run over those mutations is not evidence.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/presentation/useJarvisMeter.ts src/modules/assistant/presentation/voice/useWakeListening.ts scripts/prove-assistant-voice.mjs
git commit -m "feat(assistant): the orb's listening runs on the meter's own stream, not on a second microphone"
```

---

### Task 5: The two callers speak to the new hook

The orb and the Assistant page's voice console are the only consumers of a wake word. Both switch to `useWakeListening`, both read the phrase from the account instead of `localStorage`, and the loudness meter's dependency flips so the capture has one owner.

**Files:**
- Modify: `src/modules/assistant/presentation/JarvisPresence.tsx`
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx`
- Modify: `src/app/(admin)/assistant/AssistantPrefs.tsx` (drop `readStoredWakePhrase`/`writeStoredWakePhrase` imports only where they are still referenced)
- Delete: `src/modules/assistant/presentation/voice/useWakeWord.ts` (if Task 4 left it standing)

**Interfaces:**
- Consumes: `useWakeListening` and `useMicrophoneAvailable` from Task 4; `JarvisPrefs.wakePhrase` from Task 1; `getJarvisPresence` from `src/app/(admin)/settings/jarvis-actions.ts`; `refreshJarvisPresence` and `ui.prefsEpoch` from `src/lib/jarvis-ui.ts`; `withinQuietHours`, `readClock`, `DEFAULT_WAKE_PHRASE_TEXT`, `canArmAmbient` from `domain/jarvis.ts`.
- Produces: `wakePhrase: string` in both callers (the default substituted once, the same way `shownPhrase` does in the strip); `ambientArmed` and the `handToJarvisChat` contract unchanged.

- [ ] **Step 1: Flip the orb**

In `JarvisPresence.tsx`:

Replace the import
`import { useWakeWord } from "@/modules/assistant/presentation/voice/useWakeWord";`
with
`import { useWakeListening } from "./voice/useWakeListening";`
and add `canArmAmbient` (already imported), `withinQuietHours`, `DEFAULT_WAKE_PHRASE_TEXT`, `readClock` to the existing `domain/jarvis` import list.

The meter is currently opened *because* the recogniser says it is listening — `const meter = useJarvisMeter({ enabled: wake.listening });` sits below the wake hook. It must move above and be driven by the switch instead, because the hook now needs the meter's stream:

```ts
  // One capture, one owner: the meter holds the microphone whenever the wake word is
  // armed, and the listening hook cuts its segments from that same stream. Arming is
  // a preference, so the capture follows the preference and not a recogniser's report.
  const ambientArmed = prefs !== null && canArmAmbient(prefs);
  const meter = useJarvisMeter({ enabled: ambientArmed });

  const nowMinutes = minutesInGroupZone(timeZone);
  const segmentsQuiet = withinQuietHours(nowMinutes, prefs?.quietFrom ?? "18:00", prefs?.quietTo ?? "08:00");

  const wake = useWakeListening({
    enabled: ambientArmed,
    meter,
    quiet: segmentsQuiet,
    onUtterance: (text) => hearRef.current(text),
  });
```

`nowMinutes` needs a helper, because a component body may not call `Date.now()` (the `react-hooks/purity` rule the chat already works around by putting the clock behind a hook method). Put it next to `useJarvisMeter`'s file-level helpers in `JarvisPresence.tsx`'s own module scope:

```ts
/**
 * Minutes past midnight where the group's clock says it is, for the quiet-hours test.
 *
 * A component body may not read a clock — the same purity rule that keeps the chat's
 * comparison behind a hook method — so this is called from render with a `timeZone`
 * the server handed down, and its own `new Date()` is a dependency of the render, not
 * of a memo. The watcher already does this with the pair it is given.
 */
function minutesInGroupZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
```

The phrase stops coming from the browser store. Delete the `wakePhrase` and `voiceLanguage` `useSyncExternalStore` calls (the pair that reads `readStoredWakePhrase` and `readStoredVoiceLanguage`) and derive both from the row the orb already fetches:

```ts
  // The phrase is the account's, so it arrives on the read the orb already does and
  // survives a different machine. An empty row means the default, which is what the
  // panel shows too — "Listening for “”" would be a lie.
  const wakePhrase = prefs?.wakePhrase?.trim() || DEFAULT_WAKE_PHRASE_TEXT;
```

`hear` already guards with `const phrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;` — change that line to `const phrase = wakePhrase;` and swap `DEFAULT_WAKE_PHRASE` for `DEFAULT_WAKE_PHRASE_TEXT` in the import list only if nothing else in the file needs the voice-module copy. Leave the rest of `hear` alone: a transcript without the phrase still does not open a turn, which is what keeps the quota from being spent by the room.

Finally, `useEffect(() => { setJarvisAmbient(wake.listening); }, [wake.listening]);` needs no change — `wake.listening` exists with the same meaning.

- [ ] **Step 2: Flip the console**

In `AssistantChat.tsx`:

Replace `import { useWakeWord } from "@/modules/assistant/presentation/voice/useWakeWord";` with `import { useWakeListening } from "@/modules/assistant/presentation/voice/useWakeListening";`.

Remove `readStoredVoiceLanguage`, `writeStoredVoiceLanguage`, `readStoredWakePhrase`, `writeStoredWakePhrase`, `type VoiceLanguage` from the `./AssistantPrefs` import, and remove the `voiceLanguage` `useSyncExternalStore` block, the `storedWakePhrase`/`typedWakePhrase` pair and the `wakePhrase = typedWakePhrase ?? storedWakePhrase` line.

Add the account read, keyed on the same epoch the orb re-reads on:

```ts
  // The wake phrase lives on the account now, so the console reads the row the orb
  // reads rather than this browser's `localStorage`. `prefsEpoch` is what the Settings
  // console bumps after a save, so a phrase edited there reaches an open conversation
  // without a reload.
  const [presence, setPresence] = useState<PresenceRead | null>(null);
  useEffect(() => {
    let alive = true;
    void getJarvisPresence().then((read) => {
      if (alive) setPresence(read);
    });
    return () => {
      alive = false;
    };
  }, [ui.prefsEpoch]);
  const wakePhrase = presence?.ok ? presence.prefs.wakePhrase?.trim() || DEFAULT_WAKE_PHRASE_TEXT : DEFAULT_WAKE_PHRASE_TEXT;
```

`PresenceRead` is the awaited return type already exported by `jarvis-actions.ts` — import it with `getJarvisPresence` rather than re-describing it. `ui` is the handoff store this component already reads (`const { ambientArmed } = useJarvisHandoff({ … })`) — where `prefsEpoch` is not on that destructure, take it from the same store hook the presence uses.

The console needs its own capture for the gate, and it must not open a second one while the orb holds it. The existing `enabled` expression already encodes that precedence, so keep it and hand the hook a meter of its own that is only enabled when the orb is disarmed:

```ts
  const meter = useJarvisMeter({ enabled: voiceMode === "console" && handsFree && !ambientArmed });

  const wake = useWakeListening({
    // One microphone per tab. While the orb's ambient listening is running it owns the
    // capture and delivers every utterance through the handoff; a second recorder here
    // would hear the same person twice and ask twice.
    enabled: voiceMode === "console" && handsFree && !ambientArmed,
    meter,
    quiet: false,
    onUtterance: hearUtterance,
  });
```

`quiet: false` is honest for the page console and is stated as such in a one-line comment: quiet hours govern the orb that speaks on its own, not a conversation the person opened on this page. `hearUtterance` keeps its `matchWakePhrase`/`wakeRemainder` logic untouched — only its `phrase` source changed (`const phrase = wakePhrase;`).

Where the strip is rendered, delete the `language={…}` and `onLanguage={…}` props, and replace the phrase editor's write with `wakePhrase={wakePhrase}` and `onWakePhrase={() => undefined}` under the comment `// Editing the phrase moved to Settings; the strip shows it.` Task 6 removes `onWakePhrase` from `VoiceStrip` altogether and keeps `wakePhrase` as a read-only display; passing the no-op here keeps this task shippable on its own and the strip honest about a phrase it cannot edit.

Then widen the strip's error line at `AssistantChat.tsx:1114`, which currently reads `error={voiceError ?? wake.error ?? speech.error}`. A refused microphone is now refused by the meter, not by this hook, so its sentence has to reach the same line or the console says "Listening" while nothing is captured:

```tsx
                  error={voiceError ?? wake.error ?? meter.error ?? speech.error}
```

That is the spec's "Armed, then refused with the reason; arming again retries" row — `meter.error` is the words, and flipping `handsFree` off and on re-enables the meter, which is the retry.

- [ ] **Step 3: Delete the recogniser**

```bash
git rm src/modules/assistant/presentation/voice/useWakeWord.ts
```

Run: `grep -rn "useWakeWord\|SpeechRecognition\|webkitSpeechRecognition\|ar-EG" src/`
Expected: no matches. `JarvisPresenceConsole.tsx` imports `useRecognizerSupported` from the deleted file at `:21` and calls it at `:181`, so make that swap in this step rather than leaving `tsc` broken for Task 7: `import { useMicrophoneAvailable } from "@/modules/assistant/presentation/voice/useWakeListening";` and `const supported = useMicrophoneAvailable();`, changing nothing else in that file — Task 7 rewrites the sentences built on it.

- [ ] **Step 4: Typecheck and lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: clean of `useWakeWord` errors. Remaining errors should name only `VoiceStrip.tsx` props (`language`, `onLanguage` still required) — Task 6 closes them.
Run: `npm run lint`
Expected: no `react-hooks/purity`, no `react-hooks/exhaustive-deps`, no `no-control-regex` errors in the files this task touched.

- [ ] **Step 5: Run the presence and voice proofs**

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs && node --experimental-strip-types scripts/prove-assistant-voice.mjs`
Expected: presence green at `19/19`. The voice proof reports only the needles Task 6 and Task 9 retarget (the strip's listening line, the merge proof's file list). Write each remaining red into the task report; do not "fix" one by deleting its check.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/presentation/JarvisPresence.tsx src/app/\(admin\)/assistant/AssistantChat.tsx src/app/\(admin\)/assistant/AssistantPrefs.tsx src/app/\(admin\)/settings/JarvisPresenceConsole.tsx
git add -u src/modules/assistant/presentation/voice/
git commit -m "feat(assistant): the orb and the console hear through the gateway, and the recogniser is gone"
```

---

### Task 6: The "Listening language" selector comes out

The selector fed exactly three things: the deleted hook, its own display, and nothing else. The type and its `localStorage` pair go with it, and the strip's listening sentence is rewritten to say where the words actually go now.

**Files:**
- Modify: `src/modules/assistant/presentation/voice/VoiceStrip.tsx`
- Modify: `src/app/(admin)/assistant/AssistantPrefs.tsx`
- Modify: `src/app/(admin)/assistant/AssistantChat.tsx`
- Modify: `scripts/prove-assistant-voice.mjs` (the strip and privacy needles)

**Interfaces:**
- Consumes: `wakePhrase: string` (read-only display), `LISTENING_QUOTA_SENTENCE` from `domain/listening.ts`.
- Produces: `VoiceStrip` props without `language`/`onLanguage`; `AssistantPrefs` without `VoiceLanguage`, `readStoredVoiceLanguage`, `writeStoredVoiceLanguage`, `readStoredWakePhrase`, `writeStoredWakePhrase`; `WAKE_KEY`/`VOICE_LANG_KEY` storage names retired.

- [ ] **Step 1: Cut the selector and its props**

In `VoiceStrip.tsx`, delete the whole `<label className="ml-auto flex items-center gap-1.5 …">Listening language<select …></select></label>` block, the `language: VoiceLanguage;` and `onLanguage: (next: VoiceLanguage) => void;` prop types, the two entries in the destructured parameter list, and `import type { VoiceLanguage } from "@/app/(admin)/assistant/AssistantPrefs";`.

The wake-phrase input stops being an editor here. Replace the conditional block

```tsx
      {handsFree && supported && (
        <label className="mt-2 flex items-center gap-2 …">
          Wake phrase
          <input value={wakePhrase} onChange={(event) => onWakePhrase(event.target.value)} maxLength={MAX_WAKE_PHRASE_CHARS} … />
        </label>
      )}
```

with a line that says what is being listened for and points at where it is chosen:

```tsx
      {handsFree && supported && (
        <p className="mt-2 text-[10px] font-semibold leading-relaxed text-brand-ink/60">
          Listening for “{shownPhrase}” — the phrase is set in Settings → Assistant, on your account,
          so it is the same phrase on every machine you sign in from.
        </p>
      )}
```

and drop the now-unused `onWakePhrase` prop, the `MAX_WAKE_PHRASE_CHARS` import and the `wakePhrase`/`shownPhrase` pair's editor assumption (`shownPhrase` stays: `wakePhrase.trim() || DEFAULT_WAKE_PHRASE`).

- [ ] **Step 2: Rewrite the two sentences that are now false**

The listening line currently says `Listening for “${shownPhrase}” — the browser sends what it hears to its own speech service.` Replace it with

```tsx
                ? `Listening for “${shownPhrase}” — what it hears is transcribed by this portal's own model and discarded once the words come back.`
```

and the unsupported-browser warning, which reads `Hands-free needs Chrome or Edge's speech recognition. Push-to-talk works in this browser.`, becomes

```tsx
      {!supported && (
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-amber-700">
          Hands-free needs a microphone this browser will both open and encode. Push-to-talk works in
          this browser.
        </p>
      )}
```

- [ ] **Step 3: Delete the type and its storage**

In `AssistantPrefs.tsx`, delete `export type VoiceLanguage = "en" | "ar";`, `readStoredVoiceLanguage`, `writeStoredVoiceLanguage`, `readStoredWakePhrase`, `writeStoredWakePhrase`, and the `WAKE_KEY` / `VOICE_LANG_KEY` constants with no remaining readers. Leave `voicePrefListeners`, `notifyVoicePrefs` and `subscribeVoicePrefs` standing — the voice id and speech rate still use them — and fix the stale doc comment above them, which currently promises *"A phrase, language or playback choice changed in another tab is the same preference"*: it now describes only a voice and a pace.

No migration touches the stale keys. Nothing reads them, so the spec's decision holds: they are left alone rather than cleaned up.

- [ ] **Step 4: Retarget the strip's proof needles**

In `scripts/prove-assistant-voice.mjs`, check 11 asserts the *old* disclosure. Its privacy loop currently reads

```js
  for (const needle of [
    "never stored",
    "discarded",
    "browser vendor",
    "only while this tab is visible",
  ]) {
```

Replace `"browser vendor"` with `"this portal's own model"` and add `"browser vendor"` to the list of strings that must **not** appear in the console copy it now describes. Then the two strip needles:

```js
  if (!strip.includes("the browser sends what it hears to its own speech service")) {
    problems.push("the listening line does not say where the words go");
  }
```

becomes

```js
  if (!strip.includes("transcribed by this portal's own model and discarded")) {
    problems.push("the listening line does not say where the words go");
  }
  if (/Listening language|onLanguage|VoiceLanguage/.test(strip)) {
    problems.push("the strip still offers a listening language");
  }
```

and the matching mutation (#55, needle `" — the browser sends what it hears to its own speech service."`) is retargeted to the new sentence:

```js
  " — what it hears is transcribed by this portal's own model and discarded once the words come back.",
```

- [ ] **Step 5: Prove it**

Run: `node --experimental-strip-types scripts/prove-assistant-voice.mjs`
Expected: the strip and privacy checks pass. Then:
Run: `node_modules/.bin/tsc --noEmit`
Expected: clean — every `language`/`onLanguage`/`VoiceLanguage` reference is gone from all four files.
Run: `grep -rn "VoiceLanguage\|readStoredVoiceLanguage\|writeStoredVoiceLanguage\|Listening language" src/ scripts/`
Expected: no matches in `src/`. A match in `scripts/` is a needle Task 9 still owns; leave it and record it.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assistant/presentation/voice/VoiceStrip.tsx src/app/\(admin\)/assistant/AssistantPrefs.tsx src/app/\(admin\)/assistant/AssistantChat.tsx scripts/prove-assistant-voice.mjs
git commit -m "refactor(assistant): the listening language selector is gone, because nothing sets a language any more"
```

---

### Task 7: The wake-word control in Settings, and the re-consent ask

Settings → Assistant is where the phrase is chosen and where the microphone is armed. This task adds the input, the live `Listening for "…"` line, the conditional Reset, and the one-time re-ask a changed destination demands — the panel's four disclosure bullets are rewritten **before** the ask, not after.

**Files:**
- Modify: `src/app/(admin)/settings/JarvisPresenceConsole.tsx`

**Interfaces:**
- Consumes: `MAX_WAKE_PHRASE_LEN`, `DEFAULT_WAKE_PHRASE_TEXT`, `consentCarriesOver`, `canArmAmbient`, `JarvisPrefs.wakePhrase` from `domain/jarvis.ts`; `useMicrophoneAvailable` from `voice/useWakeListening.ts`; `LISTENING_QUOTA_SENTENCE` from `domain/listening.ts`; the console's existing `save(patch, consentGiven)` and `armWithConsent()`.
- Produces: no new exports. The saved draft key is `wakePhrase`, which Task 1's `COLUMN_BY_DRAFT_KEY` already maps to `wake_phrase`.

- [ ] **Step 1: Swap the support test and its reason**

`const supported = useRecognizerSupported();` becomes `const supported = useMicrophoneAvailable();` (Task 5 may have done this already — then only the copy below remains). Replace

```ts
  const ambientBlocked = !supported
    ? "This browser has no speech recogniser. Chrome and Edge do; Firefox does not. The Ctrl+Space hotkey and the typed conversation still work."
    : "Arms this browser's wake word on every admin screen. Off by default, and only ever for your own account.";
```

with

```ts
  // The old reason named a browser feature; the new one names a device. Firefox can
  // do all of this, which is the point of the change.
  const ambientBlocked = !supported
    ? "This browser will not open and encode a microphone, so there is nothing to listen with. The Ctrl+Space hotkey, push to talk and the typed conversation all still work."
    : "Arms this browser's wake word on every admin screen. Off by default, and only ever for your own account.";
```

- [ ] **Step 2: Rewrite the disclosure bullets first**

The consent panel's first `<li>` currently reads *"This browser's speech recogniser runs continuously while the tab is visible, and streams what it hears to the browser vendor's speech service — Chrome sends it to Google — independently of this portal."* Replace it, and add the gate's honesty, in this order:

```tsx
                <li>
                  While the tab is visible, this browser watches the microphone&apos;s loudness
                  locally and cuts a segment whenever someone talks. Nothing leaves the machine
                  between segments.
                </li>
                <li>
                  A segment is sent to this portal&apos;s own transcription model — not to a browser
                  vendor&apos;s speech service — for one reason: to find out whether you said the wake
                  phrase. If you did not, the words are discarded and nothing is logged about the
                  near-miss.
                </li>
                <li>
                  {LISTENING_QUOTA_SENTENCE}
                </li>
```

Keep the existing bullets about hiding the tab, the app-bar indicator, audio never being stored, and an administrator arming nothing. Then the section's own hint, which still says *"One recogniser, one owner"*, becomes *"One microphone, one owner: while the wake word is armed, the Assistant page's hands-free mode stands down and this one takes what it hears."*

- [ ] **Step 3: Add the phrase control beneath the switch**

Inside the `The microphone` `<Section>`, immediately after the `Wake word on every admin screen` `<SwitchRow>` and before `{consentOpen && (`, insert:

```tsx
        <div className="py-3">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-brand-ink/70">
            Wake phrase
            <input
              value={form.wakePhrase ?? ""}
              maxLength={MAX_WAKE_PHRASE_LEN}
              placeholder={DEFAULT_WAKE_PHRASE_TEXT}
              disabled={locked}
              onChange={(event) => {
                setPreviewProblem(null);
                // The box keeps what was typed so it can be edited; nothing is written
                // from a keystroke, because a half-typed phrase is not a choice.
                setForm((current) => ({ ...current, wakePhrase: event.target.value }));
              }}
              onBlur={(event) => commitPhrase(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] outline-none focus:border-brand-gold"
            />
          </label>
          <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/55">
            Listening for “{prefs.wakePhrase?.trim() || DEFAULT_WAKE_PHRASE_TEXT}” — said in any
            language, in any mix, because this portal&apos;s own model decides what it heard. Stored on
            your account, so the same phrase waits on every machine you sign in from.
          </p>
          {prefs.wakePhrase !== null && prefs.wakePhrase.trim() !== DEFAULT_WAKE_PHRASE_TEXT && (
            <button
              type="button"
              disabled={locked}
              onClick={() => void commitPhrase("")}
              className="mt-2 rounded-full border border-brand-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              Back to “{DEFAULT_WAKE_PHRASE_TEXT}”
            </button>
          )}
        </div>
```

The Reset row appears only once the value differs from the default — the idiom the speech-rate row already uses with `speechRate !== DEFAULT_SPEECH_RATE && ( … "Back to a normal pace" )`.

Then the writer, beside `commitClock` and sharing its reasoning:

```ts
  /**
   * Save the phrase, or say why the box cannot hold it.
   *
   * A field over the ceiling is refused by the row the server writes, so the panel
   * refuses it first and leaves the stored phrase alone — the same rule as a quiet
   * window typed as `9am`. A cleared box is a real request and falls back to the
   * default, which is what `null` means here, and the notice says so rather than
   * letting the person believe the orb went deaf.
   */
  function commitPhrase(value: string) {
    const clean = value.trim();
    if (clean.length > MAX_WAKE_PHRASE_LEN) {
      setForm(prefs);
      setNotice(`A wake phrase is at most ${MAX_WAKE_PHRASE_LEN} characters. What you had chosen is still listening.`);
      return;
    }
    const next = clean === "" ? null : clean;
    if (next === (prefs.wakePhrase?.trim() ?? null)) {
      setForm(prefs);
      return;
    }
    setForm({ ...prefs, wakePhrase: next });
    void save({ wakePhrase: next });
  }
```

`summarizeJarvisChange` (Task 1) names the field in the trail, so no extra `saved` copy is needed here.

- [ ] **Step 4: Make the retired stamp ask again**

Two changes, both about the moment a person whose orb went quiet because of the cutoff comes to the panel.

`toggleAmbient` currently skips the consent box on `if (form.ambientConsentAt) {`. That is now the wrong test — a stamp can exist and still be worth nothing. Replace it:

```ts
    // The explanation is shown once per wording. A stamp taken under the browser-vendor
    // promise does not cover this portal's gateway, so the box opens again and the
    // person answers the true question before the microphone re-arms.
    if (consentCarriesOver(form.ambientConsentAt)) {
      void save({ ambient: true });
      return;
    }
```

and add `consentCarriesOver` to the file's `domain/jarvis` import list.

Then, after the `Wake word on every admin screen` `<SwitchRow>`, surface the state instead of leaving the switch on and the orb silent. Replace the existing `{form.ambient && !consentOpen && ( … )}` block:

```tsx
        {form.ambient && !consentOpen && !consentCarriesOver(form.ambientConsentAt) && (
          <div className="py-2.5">
            <p className="text-[11px] font-semibold leading-relaxed text-amber-800">
              The wake word is switched on and not listening. Where your voice goes changed — it was
              the browser&apos;s own speech service, and it is now this portal&apos;s transcription model
              — so the explanation you agreed to is no longer the one on this screen. Read it and
              acknowledge it once; until then nothing is armed and nothing is sent.
            </p>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setAcknowledged(false);
                setConsentOpen(true);
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-ink px-3 py-1.5 text-[11px] font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:opacity-50"
            >
              Show me what changed
            </button>
          </div>
        )}
        {form.ambient && !consentOpen && consentCarriesOver(form.ambientConsentAt) && (
          <p className="py-2.5 text-[11px] leading-relaxed text-brand-ink/55">
            Listening is reported by the microphone itself, not by this switch: if this browser
            refuses the capture, the orb says so and nothing is heard.
          </p>
        )}
```

The old sentence's lie was *"reported by the recogniser itself"* — there is no recogniser. The new one is true because `useJarvisMeter` is the thing that either has a capture or explains why it does not.

- [ ] **Step 5: Prove the panel cannot skip the ask**

No fixture can render this client component, so the rule is asserted where the repo asserts client rules — as a source needle. Append to `check16` in `scripts/prove-jarvis-presence.mjs` (before its `return`):

```js
  // The panel that asks again is the only writer of a stamp, so a copy check here is
  // what keeps "loud, not silent" true: a switch left on with a retired stamp must
  // render the re-ask rather than the armed-state sentence.
  const consoleCopy = read("src/app/(admin)/settings/JarvisPresenceConsole.tsx");
  expect(problems, "the panel tests the stamp, not its presence", consoleCopy.includes("consentCarriesOver(form.ambientConsentAt)"), true);
  expect(problems, "and the switch obeys the same test", consoleCopy.includes("disabled={locked || !supported}"), true);
  expect(problems, "no recogniser left in the panel's copy", /speech recogniser|recogniser itself/.test(consoleCopy), false);
```

Run: `node --experimental-strip-types scripts/prove-jarvis-presence.mjs`
Expected: `19/19 checks held` — and before Step 1–4 land, these three lines fail, which is why they belong in the same commit.

Then add its mutation:

```js
await mutation(
  "43. The panel re-arms on a stamp taken under the old wording → check 16 red",
  "src/app/(admin)/settings/JarvisPresenceConsole.tsx",
  "    if (consentCarriesOver(form.ambientConsentAt)) {",
  "    if (form.ambientConsentAt) {",
  async () => checkIsRed(16)
);
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(admin\)/settings/JarvisPresenceConsole.tsx scripts/prove-jarvis-presence.mjs
git commit -m "feat(assistant): the wake phrase is set on the account, and a changed destination asks once"
```

---

### Task 8: An answer the machine cannot speak says so

`speechLanguageOf` counts Arabic letters against Latin ones and returns `null` for anything else, and `speak` returns on that `null` without a sound or a sentence. Removing the selector deletes the only lever a person could pull in response, so the silent case becomes a stated one.

**Files:**
- Modify: `src/modules/assistant/presentation/voice/useSpeech.ts`
- Modify: `scripts/prove-assistant-voice.mjs`

**Interfaces:**
- Consumes: `speechLanguageOf(text): "ar" | "en" | null` (unchanged) and the hook's existing `setError`.
- Produces: no new exports; `speak`'s behaviour widens from "silently drops" to "drops and names why".

- [ ] **Step 1: Write the failing needle**

In `scripts/prove-assistant-voice.mjs`, inside `async function check16()` — "The voice and the pace are chosen once, in this browser, and both engines obey" — add the assertion after the loop that reads `pickDeviceVoice` out of both engines. `check16` already has `const speechHook = read("…/useSpeech.ts")` near its top (so does check 14, for the queue; the one you want declares `jarvisHook` beside it), so pin the sentence on that variable rather than reading the file a second time:

```js
  // A script this machine has no voice for, and no language even chosen for, is the
  // one case where an answer used to arrive with no sound and no reason. The selector
  // is gone; the sentence replaces it.
  if (!speechHook.includes("in a language this device has no voice for")) {
    problems.push("an unvoiceable answer is still silent");
  }
```

Run: `node --experimental-strip-types scripts/prove-assistant-voice.mjs`
Expected: that check `FAIL` with `an unvoiceable answer is still silent`.

- [ ] **Step 2: Set the error instead of returning**

In `useSpeech.ts`, `speak` is

```ts
      const wanted = language ?? speechLanguageOf(text);
      if (!wanted) return;
```

Replace the second line:

```ts
      // Two scripts can be *spoken* on this machine, and a listening model can read
      // many more. An answer in a third is real text the person will read; what it
      // must not be is silence with no explanation, now that the language a person
      // used to be able to choose is gone.
      const wanted = language ?? speechLanguageOf(text);
      if (!wanted) {
        setError("That answer is in a language this device has no voice for — the words stay on screen.");
        return;
      }
```

Leave `pickDeviceVoice`'s per-piece refusals and `speakNow`'s `"en"` system cues exactly as they are: a cue is chosen by the portal, not translated by a model, so it always has a language.

- [ ] **Step 3: Prove the rule holds and the mutation catches it**

Run: `node --experimental-strip-types scripts/prove-assistant-voice.mjs`
Expected: green. Append the mutation at the foot, in the file's own order:

```js
await mutation(
  "97. An unvoiceable script is silent again → check 16 red",
  "src/modules/assistant/presentation/voice/useSpeech.ts",
  '        setError("That answer is in a language this device has no voice for — the words stay on screen.");\n        return;',
  "        return;",
  async () => checkIsRed(16)
);
```

`97` is the next free number — `prove-assistant-voice.mjs` already carries 96 mutations and the labels are the sequence, not a lookup. A `needle not found` means the two lines are indented differently in the finished file; fix the needle, not the check.

- [ ] **Step 4: Confirm nothing else reads the removed lever**

Run: `grep -rn "speak(.*\"" src/app/\(admin\)/assistant/AssistantChat.tsx src/modules/assistant/presentation/`
Expected: matches only on `speakNow(x, "en")` system cues and the two-script refusal sentences — no call passes a person-chosen language. This is the fact that made the selector cheap, and it is now also the fact that keeps this task to three lines.

- [ ] **Step 5: Commit**

```bash
git add src/modules/assistant/presentation/voice/useSpeech.ts scripts/prove-assistant-voice.mjs
git commit -m "fix(assistant): an answer this machine cannot voice says so instead of going silent"
```

---

### Task 9: The copy sweep, and the needles it moves

Four Guide sentences assert behaviour this slice removes, six pinned proof needles would match nothing, and two proofs import the deleted hook by exact name. All of it is one pass, because a needle that matches nothing turns its mutation into a free pass.

**Files:**
- Modify: `src/modules/shell/domain/pageGuide.ts` (the `/assistant` entry — its `how` items and `edges`)
- Modify: `scripts/prove-assistant-voice.mjs`
- Modify: `scripts/prove-assistant-merge.mjs` (its module stub, its file list, its disclosure and `Hands-free` asserts)
- Modify: `scripts/prove-jarvis-corner.mjs`, `scripts/prove-person-spine.mjs`
- Modify: `src/app/(admin)/settings/JarvisPresenceConsole.tsx` (`problem === "absent"` banner)

**Interfaces:**
- Consumes: everything Tasks 1–8 shipped.
- Produces: no code. `scripts/prove-guide-figures.mjs` reads the Guide's pinned figures, so any number in the rewritten sentences must be derived from the tree at write time, not recalled.

- [ ] **Step 1: Rewrite the two sentences that are now false**

In `pageGuide.ts`, the `/assistant` `how` entry beginning `"Audio is never stored."` contains the clause `hands-free uses the browser's own recognizer, which sends what it hears to the browser vendor, and runs on /assistant only while armed and the tab is visible`. Replace that clause with `hands-free watches the microphone's loudness in this browser and sends only a spoken segment to this portal's own transcription model, which returns the words and keeps nothing; it runs on /assistant only while armed and the tab is visible`. The sentence's first half (`"Audio is never stored. Push-to-talk sends one clip to the transcription model and keeps only the words"`) and its last half (the `046 … applied` clause) stay verbatim.

The entry beginning `"The wake phrase armed at Settings → Assistant is the same browser recognizer"` is rewritten whole:

```ts
      "The wake phrase armed at Settings → Assistant is heard by this portal's own transcription model, not by the browser's speech service: while the tab is visible the browser watches the microphone's loudness locally, and a segment of someone talking is sent to the gateway to find out whether it names the phrase. If it does not, the words are discarded and nothing is logged about the near-miss. It is off by default, only the account it belongs to can arm it, hiding the tab releases the microphone, and no audio reaches a table, a bucket or a log — only the transcript of a turn you send is saved, exactly as if typed. Any language, and any mix of two, because a model decides what it heard rather than a browser being told what to expect.",
```

- [ ] **Step 2: Bring the two adjacent entries in line**

The entry that lists presence switches (`"The orb at the corner of every admin screen is the presence…"`) carries `every switch is stored on your account and trailed, and db/migrations/047_assistant_jarvis_prefs.sql is applied on this database`. Extend it so the phrase is named as account-stored, in the tense the database actually supports (Task 11 flips it to applied once 050 is on):

```
The phrase itself is stored on the account too, so it waits for you on any machine you sign in from; db/migrations/050_jarvis_wake_phrase.sql is authored but not applied, so until it lands the phrase falls back to Hey Jarvis and every other switch still saves.
```

The `edges` entry about the voice and the pace is unchanged except that no entry may still claim a language is chosen for listening; `grep -n "listening language\|Listening language" src/modules/shell/domain/pageGuide.ts` must return nothing.

- [ ] **Step 3: Fix the console's absent banner**

`JarvisPresenceConsole.tsx`'s `problem === "absent"` banner names 047 and says *"no setting on your account can be stored or armed yet"*. That stays true for 047 and must not be reused for 050 — Task 2's writer already names the right file in the error it returns. Confirm no second banner was added, and that the `saved`/`error` line renders whatever `setJarvisPresence` refused, so a 050 refusal reaches the person with 050 in it.

- [ ] **Step 4: Move every needle this slice stepped on**

Work the list; for each, retarget the string to what the file says now and re-run the proof until its mutation reports red-for-the-right-reason rather than `needle not found`.

`scripts/prove-assistant-voice.mjs`:
- `:702` area — the privacy needle `"browser vendor"` (Task 6 Step 4).
- `:721` area — `if (!strip.includes("the browser sends what it hears to its own speech service"))` (Task 6 Step 4).
- `:895` area, inside `async function check13()` — `const hook = read("…/useWakeWord.ts")` and its three assertions (Task 4 Step 2).
- `:1840` — `const WAKE_HOOK_REL = "…/useWakeWord.ts"` (Task 4 Step 2).
- mutation `#27` (`:1777-1780`) and `#30` (`:1801`) — whichever assertions inside them reference the recogniser's `lang` or the `network` error sentence: retarget both to `useWakeListening.ts`'s fatal-refusal rules, or delete the mutation and say so in its place with a one-line comment naming the rule it used to guard. Never leave a mutation pointing at a string no file contains.
- `:2014-2020` — mutation **55** ("The listening line stops saying where the words go → check 11 red"), whose needle is the strip's listening clause ` — the browser sends what it hears to its own speech service.`. Task 6 Step 2 rewrites that very sentence, so retarget this needle to the clause the new sentence carries in the same pass; left alone, mutation 55 reports `needle not found` and the rule it guarded is unguarded.

`scripts/prove-assistant-merge.mjs`:
- `:105` — the stub `if (name.endsWith("/useWakeWord")) return { useWakeWord: () => ({ supported: true, listening: false, error: null }) };` becomes
  `if (name.endsWith("/useWakeListening")) return { useWakeListening: () => ({ listening: false, error: null, quotaHit: false }), useMicrophoneAvailable: () => true };`
  and the loader's whitelist is extended to admit the new module name — this repo's proofs import client files through an exact-name whitelist, so an unlisted specifier fails the whole render check rather than the one assertion.
- `:228` — `ui.check("Hands-free")` stays, and the language selector's `<option value="ar">العربية</option>` assert is deleted with the element.
- `:180` — the assertion that the disclosure contains `"browser vendor"` becomes an assertion that it contains `"this portal's own transcription model"` and does **not** contain `"sends it to Google"`.
- `:262` — the file list `[..., "useWakeWord.ts", ...]` drops the deleted name and gains `"useWakeListening.ts"`.

`scripts/prove-jarvis-corner.mjs`, `scripts/prove-person-spine.mjs`: run them and fix only what they name. `prove-person-spine.mjs` asserts on import whitelists and staff-guard returns, and moving a console invalidates both — if it names `useWakeWord`, retarget and re-run.

- [ ] **Step 5: Prove the sweep held**

```bash
node --experimental-strip-types scripts/prove-assistant-voice.mjs
node --experimental-strip-types scripts/prove-assistant-merge.mjs
node --experimental-strip-types scripts/prove-jarvis-corner.mjs
node --experimental-strip-types scripts/prove-person-spine.mjs
node --experimental-strip-types scripts/prove-guide-figures.mjs
```
Expected: all green, with every mutation reported as turned red. A `needle not found in …` line is this task unfinished, not a flaky gate.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shell/domain/pageGuide.ts src/app/\(admin\)/settings/JarvisPresenceConsole.tsx scripts/prove-assistant-voice.mjs scripts/prove-assistant-merge.mjs scripts/prove-jarvis-corner.mjs scripts/prove-person-spine.mjs
git commit -m "docs(assistant): the Guide and every pinned proof describe listening through our own model"
```

---

### Task 10: Type the slice, and leave nothing half-referenced

A sweep task so the deletions are genuinely deletions: no orphan import, no dead storage key, no `lang` anywhere in the listening path.

**Files:**
- Modify: whatever Steps 1–3 name.
- No new code.

- [ ] **Step 1: The four greps that define done**

```bash
grep -rn "useWakeWord\|SpeechRecognition\|webkitSpeechRecognition\|ar-EG\|en-US" src/ | grep -v "src/lib/i18n\|locale"
grep -rn "VoiceLanguage\|readStoredVoiceLanguage\|writeStoredVoiceLanguage\|Listening language" src/
grep -rn "readStoredWakePhrase\|writeStoredWakePhrase\|WAKE_KEY\|VOICE_LANG_KEY" src/
grep -rn "browser vendor\|sends it to Google\|no speech recogniser" src/
```
Expected: all four empty. The first grep's `grep -v` protects the portal's own locale table, which is not this slice and is not a listening language.

- [ ] **Step 2: The one-microphone audit**

```bash
grep -rn "getUserMedia" src/modules/assistant/
```
Expected: exactly **two** call sites — `useJarvisMeter.ts` (the presence orb) and `useRecorder.ts` (push-to-talk, which is a deliberate, person-initiated capture with its own release). `useWakeListening.ts` must not appear. A third `getUserMedia` is the defect the spec named and Task 4 was written to prevent.

- [ ] **Step 3: Typecheck, lint, all proofs**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```
Expected: clean. Then the presence and voice proofs once more; expected green with no `needle not found` line.

- [ ] **Step 4: Commit whatever the greps found**

```bash
git add -u src scripts
git commit -m "refactor(assistant): nothing left standing points at the removed recogniser"
```
If Steps 1–3 found nothing, do not create an empty commit — say so in the report instead.

---

### Task 11: Gates, the migration, and one live orb

The slice's own acceptance: every gate over the whole tree, `050` applied on the owner's named approval, and one armed orb proved with a real microphone — because real audio to the gateway is a spend and none is made unasked.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-jarvis-any-language-listening-design.md` (the Status line only)
- Modify: `src/modules/shell/domain/pageGuide.ts` (the 050 tense, once applied)

**Interfaces:**
- Consumes: all ten tasks.
- Produces: a shipped slice. Nothing new.

- [ ] **Step 1: Run every gate, in order, and record the output**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
node --experimental-strip-types scripts/prove-jarvis-presence.mjs
node --experimental-strip-types scripts/prove-assistant-voice.mjs
node --experimental-strip-types scripts/prove-assistant-merge.mjs
node --experimental-strip-types scripts/prove-jarvis-corner.mjs
node --experimental-strip-types scripts/prove-person-spine.mjs
node --experimental-strip-types scripts/prove-migration-claims.mjs
node --experimental-strip-types scripts/prove-guide-figures.mjs
node --experimental-strip-types scripts/check-staff-routes.mjs
node --experimental-strip-types scripts/audit-secrets.mjs
```
Expected: every proof reports all checks held and all mutations turned red; `audit-secrets` finds nothing new. If `tsc` errors on `.next/types/validator.ts`, that is the known stale typegen — run `next typegen` rather than changing code.

- [ ] **Step 2: Ask for the named approval, then apply 050 locally**

Do not apply without it. The ask, in one message: `050_jarvis_wake_phrase.sql` adds one nullable column to the person's own prefs row and needs the owner's approval to run. On a yes:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T db psql -U postgres -d sharm_dreams -v ON_ERROR_STOP=1 -f - < db/migrations/050_jarvis_wake_phrase.sql
```
Then re-run `node --experimental-strip-types scripts/prove-migration-claims.mjs` and confirm 050 reports **present**.

- [ ] **Step 3: Retire the unapplied tense**

Two places name 050 as authored-but-not-applied. `scripts/prove-migration-claims.mjs`'s polarity scan reads both, so they must move in the same pass as the apply: the Guide sentence from Task 9 Step 2, and any header comment written into the migration itself. Never rewrite the spec or an earlier plan.

- [ ] **Step 4: The live proof, with the owner signed in**

The owner signs in personally — no login bypass. Sequence, each step reported as observed rather than assumed:

1. Settings → Assistant: the wake-word switch is on, and the re-consent box appears over it once (the retired stamp), and arming clears it.
2. Say the phrase in English → the orb opens the conversation and the question lands in the saved thread.
3. Say it in Arabic → same.
4. Say a phrase in a mix of both → same, and the transcript reads as spoken.
5. Say something that is *not* the phrase → nothing happens, and no turn is filed.
6. Set quiet hours to cover now → the orb stays animated and nothing is transcribed.
7. Hide the tab for ten seconds and return → the capture was released and re-opened without a second prompt.
8. Drive the ceiling: speak twenty segments inside five minutes and confirm the panel shows `LISTENING_QUOTA_SENTENCE`'s state rather than failing silently.
9. Push to talk and the Ctrl+Space hotkey still work — the two paths this slice did not touch.
10. The app-bar listening indicator follows `wake.listening`, and the microphone icon in the browser's own site settings is gone after sign-out or tab-hide.

If `speechSynthesis.getVoices()` is empty on the first read in the browser being used, wait ~1.5s for the `voiceschanged` pass before concluding a voice is missing — that is a known quirk of this harness, not a defect.

- [ ] **Step 5: Close the record**

Set the spec's Status line from *"Approved design — awaiting the owner's read of this spec; no code written"* to what actually happened, with the commit that shipped it, and say plainly in the report what was **not** proved — tier 3 was not built, an unvoiceable script was tested only if a voice-less device was available, and the 429 was driven or reasoned.

```bash
git add docs/superpowers/specs/2026-10-29-jarvis-any-language-listening-design.md src/modules/shell/domain/pageGuide.ts
git commit -m "docs(migrations): 050 is on the local database, and the Guide says what the orb now hears"
```

---

## Out of this plan

Tier 3's streaming session (the next chunk). `speechLanguageOf` past two scripts. The appearance console. Any candidate-portal change. Folding `040`–`049` into `db/schema.sql`. The eleven stale migration headers (task #746). Pushing.
