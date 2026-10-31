# The assistant, spoken

**Date:** 2026-10-27
**Status:** Approved design — implementation plan not yet written
**Scope:** one slice — the assistant gains a microphone. Push-to-talk dictation in the dock and the Assistant page, a dedicated `/assistant/voice` console, a hands-free mode triggered by a configurable phrase (default "Hey Jarvis"), and spoken replies. Transcribed text is the only artefact kept; audio is never stored. A per-account autonomy setting decides whether a spoken word can approve a pending write. One migration (`046`, **authored, not applied**) for that setting only. No job-board or ATS integration is in scope.

---

## Why

The assistant already reads and changes the portal through the same server actions the screens use, holds every write behind an approval card, and answers with tables, charts and files. What it does not take is the input people use while their hands are busy: a recruiter walking a venue, a manager reviewing a pipeline on a phone, someone whose first language is Arabic and who would rather speak than type it.

The platform already transcribes speech for candidate video pitches through Google's audio path. That capability, the approval gate, and the saved-session model are the three pieces a voice slice needs. Nothing has to be invented at the provider layer; the work is capture, a staff-only door, the wake-word state machine, and an honest autonomy setting.

The hard constraint is privacy. A microphone in a hiring tool touches candidate-adjacent conversations. Audio is therefore never written anywhere — not to storage, not to the database, not to the assistant transcript — and listening exists only while the voice console is open and armed.

## What the platform already has

| Fact | Where |
| --- | --- |
| The assistant's composer is a plain textarea; a transcript can land where typing does | `src/app/(admin)/assistant/AssistantChat.tsx:823` |
| One turn is sent through a server action that takes history, prompt, engine, model and an attachment | `src/app/(admin)/assistant/actions.ts:237` (`sendAssistantMessage`) |
| Writes wait on an approval card held server-side with a 20-minute TTL | `src/modules/assistant/domain/approvals.ts:54`, `:30` |
| Approving runs the held arguments; the browser cannot name a different record | `src/app/(admin)/assistant/actions.ts:422` (`approveAssistantChange`) |
| Speech-to-text for candidate pitches, Gemini-only, refuses above 14 MB | `src/modules/screening/infrastructure/aiGateway.ts:405`, `:387` |
| The assistant already imports the screening gateway for completions — the boundary is established | `src/modules/assistant/infrastructure/agent.ts:5` |
| Upload doors refuse an oversize body before buffering it | `src/lib/files/upload-guard.ts:46` (`oversizeUploadResponse`) |
| Route handlers refuse with JSON rather than redirecting | `src/app/api/reports/export/route.ts:33` (`getSessionUser`, `isStaff`) |
| Assistant preferences already live in `localStorage` | `src/app/(admin)/assistant/AssistantPrefs.tsx:27`, `:63` |
| Assistant conversations are saved per person, RLS-scoped to the owner | `db/migrations/020_assistant_sessions.sql:29` (`current_user_profile_id()`) |
| The activity trail names the surface a change arrived through | `src/modules/activity/domain/trail.ts:35` (`ACTIVITY_SURFACES`) |
| `settings.manage_platform` is the group-wide administrative grant | `src/modules/settings/domain/types.ts:40`; `hasPermissionForUser` at `src/modules/settings/infrastructure/permissions.ts:18` |
| Public-site dictionaries cover en, ar, ru, de; the staff console is English | `src/lib/config.ts:46` |
| The last authored migration is `045_form_usage.sql` | `db/migrations/` |

## What the platform does not have

- No microphone input anywhere in the staff portal. `MediaRecorder` and `getUserMedia` appear exactly once, in the candidate pitch recorder (`src/modules/assessment/presentation/components/VideoPitchRecorder.tsx:58`).
- No staff-facing transcription door. The only audio route is `/api/attempt/[token]/video`, keyed to a candidate attempt token.
- No speech output. Nothing in the portal calls `speechSynthesis`.
- No wake-word handling, and no client-side speech recognition.
- No per-account setting that changes what a spoken confirmation may do. The approval gate has one shape: a click.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Surfaces | All four: dock mic, Assistant-page mic, `/assistant/voice`, hands-free mode | The owner chose all four; the first three share one capture hook, and the console is where hands-free can be armed safely |
| Speech-to-text | **Hybrid.** Push-to-talk and the console record and send to the server; hands-free uses the browser recognizer | Server path works in every browser, detects Arabic and English, and keeps one auditable transcript pipeline; hands-free needs continuous recognition, which only the browser provides |
| Wake phrase | Configurable per browser, default "Hey Jarvis" | Chosen by the owner; matched locally against the recognizer's text, never stored or sent |
| Autonomy | Three server-stored levels: `confirm` (default), `code`, `open` | The owner asked for selectable levels; storing server-side stops a browser from upgrading itself |
| Audio retention | None | The privacy promise the slice is built around |
| Where interaction lives | `/assistant/voice` is the only place hands-free can be armed | A listening page is visible; background listening anywhere else would be a privacy failure by construction |

## Architecture

### Pure domain — `src/modules/assistant/domain/voice.ts`

No imports, nothing async, so every rule is provable in a fixture script.

- `VoiceAutonomy = "confirm" | "code" | "open"`, `VOICE_AUTONOMY` labels and descriptions.
- `normalizeWakePhrase(phrase)` and `matchWakePhrase(transcript, phrase)` → `{ matched, remainder }`. Case-, punctuation-, spacing- and Arabic-diacritic-tolerant (tatweel, alef forms, harakat); matches at the start and strips the phrase so "Hey Jarvis, who is waiting today" is one turn, while "hey jarvis" alone is a wake with no question.
- `normalizeSpokenCode(text)` → upper-case letters and digits only, so "k seven q two" is not required — "K7Q2" and "k7q2" match.
- `spokenApproval(transcript, code)` → `"approve" | "cancel" | null`. Recognises English and Arabic approve/cancel words; when a code is in play the phrase must carry it; cancel always wins over approve in the same utterance.
- `spokenSummary(markdown)` → plain text for speech: fences, emphasis, links and tables stripped, clipped at 600 characters with "the rest is on screen". Never speaks raw markup.
- `speechLanguageOf(text)` → `"ar"` or `"en"` (or `null`) from the script written, used to choose a speech-synthesis voice.

### Client — `src/app/(admin)/assistant/voice/`

| Unit | Job |
| --- | --- |
| `useRecorder.ts` | `getUserMedia({ audio: true })` → MediaRecorder; negotiates `audio/webm;codecs=opus`, then `audio/ogg;codecs=opus`; reports the container as `audio/webm` / `audio/ogg` (the codec parameter is dropped — the transcriber reads a container, not a codec); stops at 120 s; aborts on unmount, hidden tab or route change; leaves no stream tracks open. A browser whose recorder offers neither container (Safari today) gets the honest "this browser's recording format cannot be transcribed — type it instead" rather than a clip the provider will refuse |
| `useWakeWord.ts` | Feature-detects `SpeechRecognition`/`webkitSpeechRecognition`; `continuous` + `interimResults`; restarts while armed; reports permission and support failures; mounted only by the voice console with the toggle on |
| `useSpeech.ts` | `speechSynthesis`; picks a voice matching `speechLanguageOf`; `stopSpeaking()`; reports "no voice installed for this language" rather than failing silently |
| `VoiceButton.tsx` | Mic beside the composer in `AssistantChat`; states idle / recording / transcribing / error; inserts at the cursor and focuses the textarea; Escape cancels |
| `VoiceConsole.tsx`, `page.tsx` | `/assistant/voice`: large push-to-talk control, live caption, the current conversation (same `sendAssistantMessage` and saved session as the chat), hands-free toggle, speak toggle, stop-speaking, autonomy selector |

### Server

- **`src/app/api/assistant/voice/route.ts`** — `POST` multipart:
  - `getSessionUser()` + `isStaff()` → 401 for anyone else (a route refuses; it does not redirect).
  - `oversizeUploadResponse(request, 8 MB)` before `formData()`, then a post-buffer size check.
  - MIME allowlist: `audio/webm`, `audio/ogg`; 415 otherwise. The client normalises `audio/webm;codecs=opus` to `audio/webm` before sending, because `transcribeRecording` forwards the label to the provider untouched and the provider reads a container, not a codec.
  - Per-profile sliding window, 20 utterances per 5 minutes → 429. In-memory, so it is a cost guard, not a security boundary; it resets when the process does. The spec says so in the route's header comment.
  - Calls `transcribeRecording(bytes, mimeType)`; returns `{ text }`. Nothing is written to storage, the database or the trail. An empty transcript returns `{ text: "" }` and the client says "nothing was heard".
  - `RecordingNotTranscribableError` (no key, over the provider's inline limit) → 503 with copy that names Settings → API keys; any other provider failure → 502 with the model's own message summarised.
- **`src/modules/assistant/application/voiceSettings.ts`** — read/write the autonomy level for the signed-in profile; `open` requires `settings.manage_platform`; every change writes an activity row (`area: "settings"`, `entity: "setting"`, action `voice_autonomy_changed`).
- **Approvals** — `mintApproval(tool, args, profileId)` keeps its shape and gains the caller's level as a parameter; both engines read it before minting (`agent.ts:420`, `qoderAgent.ts:180`), because `approvals.ts` is pure and cannot query. In `code` mode the card carries a 4-character challenge (alphabet excluding `0/O/1/I`); `confirm` and `open` carry none. `AssistantApproval` grows an optional `code`, and `AssistantApprovalCard.tsx` shows it with a code box — the same card in the dock, the page and the voice console.
  `approveAssistantChange` gains an optional `spokenCode`. A wrong or missing code must refuse **without consuming the card**, so the check is a peek (`verifyApprovalCode(id, profileId, code)` in `approvals.ts`, reading `pending` and not deleting) that runs before `takeApproval`'s single-use delete. The code is compared in constant time. `confirm` keeps today's one-click shape; `open` runs on the one click the client sends after hearing "yes". Voice approvals pass `via: "assistant voice"` (a new value in `ACTIVITY_SURFACES`, so the Activity console's surface filter at `ActivityView.tsx:393` and the assistant's own trail-read description at `registry/reads.ts:925` pick it up automatically); the client asserts that label, so it records how the person asked, never who they are — every other field on the row stays server-derived.

### Data flow, per surface

1. **Dock / Assistant page mic** — click → record → click or 120 s → POST → transcript appended at the cursor. Never auto-sent here; the words are editable before they are a turn.
2. **Voice console button** — the same recording path, but the transcript lands in the console's composer; saying or typing "send" submits it. Every turn is saved exactly as a typed one.
3. **Hands-free** — arm → the browser recognizer listens for the phrase → on a match with no remainder the assistant says "Listening" → the next final transcript is sent → the answer is spoken → the recognizer re-arms. "Stop listening", leaving the page, hiding the tab or a permission error disarms.
4. **Spoken replies** — off by default in the chat surfaces, on by default in the voice console; a stop control is always visible while speaking; `spokenSummary` caps what is read and says where the rest is.

## Data model

`db/migrations/046_assistant_voice_autonomy.sql` — authored, applied only on explicit approval.

```sql
create table if not exists assistant_voice_autonomy (
  profile_id uuid primary key references user_profiles (id) on delete cascade,
  mode text not null default 'confirm'
    check (mode in ('confirm', 'code', 'open')),
  updated_at timestamptz not null default now()
);

alter table assistant_voice_autonomy enable row level security;

create policy "own voice autonomy, read" on assistant_voice_autonomy
  for select using (profile_id = current_user_profile_id());
create policy "own voice autonomy, insert" on assistant_voice_autonomy
  for insert with check (profile_id = current_user_profile_id());
create policy "own voice autonomy, update" on assistant_voice_autonomy
  for update using (profile_id = current_user_profile_id())
  with check (profile_id = current_user_profile_id());
```

- No audio column anywhere. The table stores one word per person.
- The `open` gate is checked by the writer (`voiceSettings.ts`), not by RLS: the database does not know about `settings.manage_platform`, and the writer is the only door that sets a level.
- **Until 046 is applied**, the reader falls back to `confirm` and the settings panel says so, naming the migration — the honesty pattern used by `038`, `042` and `045`. `code` and `open` are not offered while the table is absent, because a level that cannot be stored cannot be enforced.
- Cosmetic preferences (wake phrase, auto-speak, language hint, voice URI) live in `localStorage`, like the assistant's engine and web switches. They change nothing about what a spoken word may do.

## Autonomy, stated plainly

| Level | How a change runs | Who may choose it | What the card shows |
| --- | --- | --- | --- |
| `confirm` (default) | A click. Voice reads the card aloud and waits | Every staff member | The card as today |
| `code` | The code and the word: "approve K7Q2" in the voice console, or typing the code on the card | Every staff member | The 4-character code |
| `open` | The one click the client sends after hearing "yes"/"approve" | Holders of `settings.manage_platform` | The card plus a standing warning |

The code is a guard against accidental and overheard speech, not against a malicious client: the browser can read the code it is shown. The server enforces that **a code-mode approval without the matching code never runs**; the click in `confirm` mode is the same deliberate act it is today; `open` is the level the owner chose to allow for full hands-free use, and only administrative accounts can enable it.

## Privacy and retention

- Audio exists in browser memory and in the request body only. It is never uploaded to a bucket, written to a row, logged, or attached to the conversation.
- Only the transcript is kept, and only when the person sends the turn — identical to typing. Saved sessions therefore contain speech as text and no audio.
- Hands-free listens only on `/assistant/voice`, only while the toggle is armed, and only in the foreground. Leaving the page, hiding the tab, or losing microphone permission disarms it. No other page in the portal opens a microphone.
- **Hands-free audio does leave the device.** Chrome's `SpeechRecognition` streams the microphone to Google's speech service; that is how the browser recogniser works, and no configuration of this app changes it. The toggle therefore says so before it is armed, beside a plain "use push-to-talk to keep audio on the portal's own path" alternative. Push-to-talk audio goes only to the portal's route and then to the transcription provider named in the risks.
- Wake-phrase matching is local string comparison on the recognised text; the phrase itself is a browser preference and is never transmitted as a phrase.
- Both recording and hands-free show a visible listening indicator. The first use of either explains where the audio goes and that it is discarded afterwards.
- Speech output uses the device's own voices; no provider is called and no answer is sent anywhere for playback.

## Errors and fallbacks

| Situation | What the person sees |
| --- | --- |
| Microphone blocked or absent | The browser's own setting named, with the path to re-enable it; the button stays available |
| Nothing heard | "Nothing was heard — try again." No empty turn is created |
| Recording hit 120 s | The clip stops and is transcribed; the message says it stopped at two minutes |
| Transcription model missing or refusing | "The transcription model did not answer; you can type it instead." Admins get the Settings → AI models path |
| Provider outage | 502 with the provider's own short reason; the typed door is unchanged |
| Wake word unsupported (the browser offers no speech recognition — Firefox today) | Hands-free is disabled with the reason; push-to-talk works |
| The browser records a container the transcriber cannot take (Safari's MP4) | "This browser's recording format cannot be transcribed — type it instead"; no upload is attempted |
| No speech-synthesis voice for the language | The answer stays on screen with "this device has no voice for Arabic" |
| `open` chosen without the grant | Refused, naming `settings.manage_platform`; the level stays where it was |
| Code-mode approval with a wrong or missing code | "That code did not match. Nothing changed." The card and code stay live until they expire |
| 046 not applied | Only `confirm` is offered; the panel names the migration |

## Language

Arabic and English are the first-class dictation languages because the transcription model detects the spoken language itself; no menu is required to switch. `speechLanguageOf` picks the playback voice from what was transcribed. The staff console's own interface stays English in this slice; the voice controls follow the same dictionary once the staff-console localisation slice exists. The wake phrase may be written in Arabic; matching normalises diacritics so "يا جارفس" and "يا جارفيس" both work.

## Proofs and gates

- **`scripts/prove-assistant-voice.mjs`** over the pure module, with mutation checks that must turn a named check red:
  - wake phrase matched at the start, stripped from the remainder, and not matched mid-sentence;
  - Arabic normalisation (diacritics, alef forms, tatweel) and a phrase written in Arabic;
  - "cancel" wins over "approve" in one utterance;
  - a code-mode approval without the code is refused, with the wrong code refused, and with `k7q2` accepted;
  - a wrong code **does not consume** the card: the same id still runs with the right code afterwards;
  - `spokenSummary` strips fences/emphasis/links and clips with a statement of the cut;
  - `speechLanguageOf` picks Arabic for Arabic script and English for Latin.
- **Route behaviour** proven without audio provider access: 401 without a staff session, 413 over the cap, 415 for a non-audio type, 429 past the window, a codec-parameter label (`audio/webm;codecs=opus`) accepted as `audio/webm`, and an 8 MB body accepted up to the provider call.
- **Live proof** with the owner signed in: one dictated sentence lands in the dock; one console turn is spoken and answered aloud; one hands-free turn in Chrome; one `code` approval by voice, with the trail row showing `via: "assistant voice"`; one refusal when 046 is absent.
- **Gates**: `tsc --noEmit` after `next typegen`, eslint, the new proof script, and the existing assistant, activity and portal checks that the `ACTIVITY_SURFACES` and approvals changes touch.

## Out of scope

- Job-board and ATS integrations — dropped by the owner.
- Per-account permission overrides and a dedicated sensitive-export grant — the next slice, designed separately.
- Opening-level candidate matching — the slice after that.
- Proactive or scheduled assistant runs ("personal automation" beyond voice): the cron sweeps that exist today stay as they are. A future slice can design scheduled assistant work on top of this one.
- Candidate-facing voice anywhere: the candidate portal is untouched.
- Staff-console localisation: voice copy is English until that slice.
- Any stored audio, for any purpose, including debugging.

## Risks and assumptions

- **Browser recognition quality varies.** Hands-free lives or dies on the browser's recognizer; Chrome is the target, and every other browser is told the truth and offered push-to-talk. Arabic hands-free quality is not asserted until it is proven on the owner's machine.
- **The provider hears the audio.** Transcription sends the clip to Google AI Studio under the portal's configured key, exactly as pitch transcription already does. The UI says where the audio goes; if the owner later wants a local engine, the route is the single place to change. Hands-free adds a second listener: the browser's own recognizer, which in Chrome streams to Google independently of this route. The toggle states both before it is armed; the owner can decline hands-free and keep push-to-talk.
- **The audio-only webm container is unproven at the provider.** The pitch path proves `video/webm`; nothing in this stack has sent an audio-only webm clip. The first execution step is a one-clip probe through `transcribeRecording`. If the provider refuses, the route converts to a container it accepts before any UI is built on top — the container is an implementation detail the design does not depend on.
- **Safari push-to-talk is typing in this slice.** Safari's recorder offers MP4, whose acceptance at the provider is unproven; offering it without a probe would be a button that fails after the person has spoken. Proving the MP4 path is a later, small change.
- **`open` autonomy is a real power.** It is off by default, limited to administrative accounts, warned on the card, and visible in the trail. If the owner prefers, the permission gate can become a dedicated key in the permissions slice instead of `settings.manage_platform`.
- **In-memory rate limiting resets with the process.** It is a cost guard; the provider's own quota is the backstop.
- **The 4-character code is short.** It is a human challenge, not a secret; its job is to stop accidental approvals, and the design says so rather than implying cryptographic protection.
