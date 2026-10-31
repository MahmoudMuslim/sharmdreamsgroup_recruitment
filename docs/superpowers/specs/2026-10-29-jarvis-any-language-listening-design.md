# JARVIS listens in any language

**Date:** 2026-10-29
**Status:** Built and committed (`06a9d4d`); migration 050 applied on this database 2026-10-29; the armed-microphone proof awaits the owner signed in
**Scope:** one slice — the wake word and hands-free stop being bound to whichever language a browser was told to expect. The browser's speech recogniser is replaced by this portal's own transcription model behind a language-agnostic energy gate, the wake phrase moves out of `localStorage` onto the person's account (`050`), the "Listening language" selector comes out of the assistant controls, and the Settings → Assistant console gains the wake-word control that lives there.

It adds no tool and opens no door. A phrase heard still becomes a question in the same saved conversation, still runs through the assistant's approval card, and still lands in the activity trail.

---

## Why

`SpeechRecognition.lang` takes exactly one BCP-47 tag per run — there is no `auto`, no `any`. The console therefore asks the person which language they will speak ([VoiceStrip.tsx:132-142](../../../src/modules/assistant/presentation/voice/VoiceStrip.tsx), [useWakeWord.ts:109](../../../src/modules/assistant/presentation/voice/useWakeWord.ts)) and sets it (`ar-EG` or `en-US`). A recruiter answering in the other one, or in neither, is not heard at all, and the failure is invisible: the recognizer reports silence, not a mismatch.

The primitive that removes the limit is already wired. `transcribeRecording` sends a clip to the gateway with the instruction *"Transcribe everything said in this recording, verbatim, in the language spoken"*, and `/api/assistant/voice` is the staff door around it — capped, rate-limited, and holding nothing: no bucket, no row, no log. So the question was never "can this portal transcribe any language" but "what is always-on listening with no language to key on, and what does it cost."

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Any-language mechanism | **our own model**, not the browser's recogniser | The owner chose the heaviest option deliberately: mic audio now leaves this browser to this portal's AI gateway instead of the browser vendor's speech service. It is the only option that can be genuinely any-language |
| Engine coverage | "all 3" → a **tiered ladder** | Tier 1 language-agnostic gate, tier 2 gateway segments, tier 3 a streaming session while conversing |
| Browser recogniser as a cheap pre-gate | **dropped, not demoted** | A gate that needs a `lang` misses an Arabic wake phrase in an English-locale Chrome outright. Its cheapness is not buying correctness |
| Microphone budget | "all 3" → the same ladder | Continuous energy gate; transcription only while the orb is awake and outside quiet hours; streaming only while the dock or page is open. The panel prints the cap it is spending against |
| Wake phrase storage | **on the account, new column** (`050`) | Not `localStorage`. It arrives on the read the orb already does, so no second fetch, and it survives a different machine |
| The old consent stamp | **does not carry over** | `ambient_consent_at` was taken under "Chrome sends this to Google". The destination changed, so the panel asks again, once |
| Speaking in an unvoiced language | **stated, not solved** | `speechSynthesis` needs a voice the machine has. The two-script rule stays; the silent case says so |

## Architecture

### Tier 1 — the energy gate (always on, language-blind)

The orb already owns a live `MediaStream` and an `AnalyserNode`: `useJarvisMeter.ts` calls `getUserMedia({audio:true})` at `:100`, `createMediaStreamSource` at `:112`, `createAnalyser` at `:113` and reads levels on a `requestAnimationFrame` loop at `:125` to drive the pulse. **This slice grows a recorder on that same stream — no third `getUserMedia`, no second capture.**

The gate knows nothing about language, which is exactly why it can be the always-on tier: nothing about it can mis-guess what a person is speaking. It opens a segment on sustained level above threshold, closes it on silence, discards a segment shorter than a floor, and caps a segment that never stops. **Four constants govern it — the level threshold, the open/close hysteresis, the minimum segment and the maximum segment — and all four live in the pure domain module as named values, so a fixture test can drive them without a microphone and the plan can retune them without touching the client.** It runs in Chrome, Edge **and Firefox**, so hands-free stops being a Chrome-only feature.

### Tier 2 — a segment, then a verdict

A closed segment goes to `POST /api/assistant/voice` as `audio/webm` — the door that already exists, with its own ceilings (`MAX_BYTES` 8 MB, `WINDOW_MS` 5 min, `MAX_UTTERANCES` 20 per profile, 429 with `Retry-After`) and its own promise: transcribed and discarded. The wake phrase is then matched against the **transcript**, using the Arabic-aware folding that already lives in `voice.ts` (`fold`, `matchWakePhrase`, `wakeRemainder`), so a phrase in mixed case or with diacritics matches as it does today. A match hands `wakeRemainder` to the conversation; a miss discards the text. **No `lang` is set anywhere in this path.**

The client ladder mirrors the door's: the gate runs continuously while the wake word is armed; segments are transcribed only while the orb is awake on screen and outside quiet hours (both already in prefs); the ceiling is stated on the panel, not discovered by a person mid-sentence.

### Tier 3 — the streaming session (its own chunk)

While the dock or the Assistant page is open, a low-latency session carries partial transcripts so a turn in flight isn't waiting on segment boundaries. This is the only tier that needs new transport. **The slice is complete without it:** tier 1 + tier 2 replace the recogniser and leave nothing dangling, so tier 3 is a separate chunk after this one ships.

### What replaces `useWakeWord`

`useWakeWord.ts` is deleted, not extended: its restart-on-`onend`, its suspend-on-`visibilitychange`, its three fatal error codes and its `language` parameter are all artefacts of the API being removed. Its two callers — the orb ([JarvisPresence.tsx:206](../../../src/modules/assistant/presentation/JarvisPresence.tsx)) and the Assistant page's voice console ([AssistantChat.tsx:781](../../../src/app/(admin)/assistant/AssistantChat.tsx), `voiceMode === "console" && handsFree && !ambientArmed`) — are served by one new hook with the same contract: *armed → hears a phrase → hands me the text*, plus `listening` and `error`.

`useRecognizerSupported()` is the one thing worth keeping, and it moves into the new hook's module rather than dying with the file: the Settings console reads it to disable the switch with a reason. Its answer changes shape — the block is now "no microphone is available to this browser", not "this browser has no speech recogniser". `MediaRecorder` with `audio/webm;codecs=opus` is the encoding; a browser without it gets push-to-talk, which already worked there.

The one-microphone-per-tab rule is unchanged in wording and stricter in practice — one stream, one owner. The console still stands its recognizer down while the orb is armed.

## The wake phrase, and the column

`db/migrations/050_jarvis_wake_phrase.sql`, authored in 049's exact idiom — `begin`, `alter table … add column if not exists`, a named check, `notify pgrst, 'reload schema'`, `commit`:

```sql
wake_phrase text
  constraint assistant_jarvis_wake_phrase_shape check (
    wake_phrase is null
    or (char_length(btrim(wake_phrase)) between 1 and 48
        and wake_phrase !~ '[\u0000-\u001F]')
  );
```

`null` means "use `Hey Jarvis`" (`DEFAULT_WAKE_PHRASE`), so no backfill and no seeded phrase on anyone's row. The 1–48 ceiling is `MAX_WAKE_PHRASE_CHARS` written as SQL, pinned against the constant the way `MAX_REQUIRED_SKILLS` is pinned in `prove-guide-figures.mjs`.

**The write ladder.** `wake_phrase` joins the eight places that already carry `quiet_from` in `jarvis.ts`: `JarvisPrefs`, `DEFAULT_JARVIS_PREFS`, the row reader, `JARVIS_PREF_COLUMNS`, `COLUMN_BY_DRAFT_KEY`, `prefsToRow`, `draftValue`, `summarizeJarvisChange`. `draftValue`'s rule is the one that matters: an over-long, blank or control-character phrase is **refused, not defaulted** — the same reasoning as `9am` not resetting your quiet window (`commitClock` at `JarvisPresenceConsole.tsx`). A cleared field falls back to `null`, which *is* the default, and the panel says so. `summarizeJarvisChange` names the phrase when it moved and never copies the row into the summary.

**The control.** In the microphone section beneath `Wake word on every admin screen`: a text input, the live `Listening for "…"` line, and a **Reset** row that appears only once the value differs from `Hey Jarvis` (mirroring the speech-rate row at `JarvisPresenceConsole.tsx:603`). The phrase input stops being conditional on hands-free in the strip — Settings is where it lives now, and the strip points there.

**Re-consent.** `ambient_consent_at` is a stamp taken under an explanation that said *Chrome sends this to Google*. That sentence stops being true the moment this ships, so a stamp taken under the old wording does not carry over silently: the first render after the change shows the new explanation over an armed orb and asks once. The wake word pauses for that one acknowledgement. Loud, not silent — the only defensible way to break a consent. The panel's four bullets are rewritten **before** the ask, not after.

Two things deliberately excluded: a "Say it and see" test button (a second arming path, and it means nothing before tier 1 works) and any promise about an answer in an unvoiced language.

## The selector comes out

The "Listening language" `<select>` and its `language`/`onLanguage` props are deleted from `VoiceStrip.tsx`. What it actually fed is the finding that makes this cheap:

- `useWakeWord({ language })` — twice, the orb and the console. Dies with the hook.
- The strip's own display.
- **Nothing else.** No call to `speech.speak` passes a language: every one falls through `language ?? speechLanguageOf(text)` ([useSpeech.ts:191](../../../src/modules/assistant/presentation/voice/useSpeech.ts)), and the orb's briefing at `useJarvisVoice.ts:167` calls `speechLanguageOf` with no override at all. The `"en"` arguments elsewhere are fixed system cues ("Listening", "Cancelled."), not the selector.

So the type and its storage go with it, not just the control: `VoiceLanguage`, `readStoredVoiceLanguage`, `writeStoredVoiceLanguage` (`AssistantPrefs.tsx:236-246`), the `useSyncExternalStore` reads at `AssistantChat.tsx:179-182` and `JarvisPresence.tsx:124-127`, and the strip's props. A stale key left in someone's `localStorage` gets no migration — nothing will read it.

## What "any language" does not mean for speaking

`speechLanguageOf` is a **two-script** function — Arabic-letter count versus Latin-letter count, `"ar" | "en" | null`. Listening becomes genuinely any-language because a model decides; speaking stays bound to the machine:

- Arabic and English keep the current behaviour: `pickDeviceVoice` prefers the person's chosen `voiceURI`, falls back to a voice whose `lang` starts with the script's tag, and returns `null` when neither holds. A piece the device cannot speak is dropped **with its reason** and the queue moves on (`useSpeech.ts:87-96`), so one unpronounceable line never ends the rest of an answer.
- Any other script returns `null` today, and `speak` returns at `:192` **silently** — no error, no notice, no sound. Removing the selector deletes the only lever a person could try in response, and that silent shape is exactly the "why is JARVIS not outputting any voice" report this project already had.

One line, therefore: a `null` language sets the existing error with a sentence naming what the machine was asked to say, instead of saying nothing. Widening the device-voice rule past two scripts is a different slice with a bigger surface and is out of scope. If the owner cuts this line, the behaviour stays silent and the Guide states the limit.

## Privacy, stated plainly

This slice moves where a person's voice goes, so the promise moves with it:

- Audio is **not** stored — the door's own wording, still true: transcribed and discarded, no bucket, no row, no log. Only the transcript of a turn the person chose to send is saved, exactly as if typed.
- It **does** now leave the browser to this portal's AI gateway, on this portal's provider key, which is a different recipient than the one every existing disclosure names. That is the reason for re-consent, and the reason the Guide's two browser-vendor sentences are rewritten in the same pass rather than left.
- Off by default; only the account it belongs to can arm it; an administrator cannot arm it for anyone. Hiding the tab releases the microphone. An app-bar indicator shows while it is armed.
- Transcription is capped per profile per window, the ceiling is printed on the panel, and the 429's `Retry-After` is surfaced rather than swallowed.
- The energy gate is local: while no segment is open, nothing leaves the machine at all. That is the honest counterweight to the destination change, and it is what makes the always-on tier defensible.

## Errors and fallbacks

| Situation | What the person sees |
| --- | --- |
| No microphone in this browser | The wake-word switch disabled with "no microphone", not "no speech recogniser"; push-to-talk and the hotkey still work |
| Mic permission denied | Armed, then refused with the reason; arming again retries. No retry loop |
| Gateway has no key / refuses | 503 / 502 with the reason summarised; the orb says once that listening is not working, and stops claiming to hear |
| 429 from the voice door | The panel shows the ceiling it hit and when it resets; wake word stays armed |
| `NO_SPEECH` back | Silent — nobody spoke; the segment is discarded |
| Transcript with no wake phrase in it | Silent discard. Nothing is logged about the near-miss |
| `050` not applied | The console names the migration and the phrase falls back to `Hey Jarvis`; every other switch still writes |
| Stamp taken under the old wording | The new explanation over an armed orb, asked once; the wake word waits for it |
| Quiet hours | Segments are not transcribed; the gate keeps running so the orb is still awake |
| An answer in a script with no device voice | Screen text plus one sentence naming the limit — never silence |

## Proofs

**Pure, fixture-only.** The tier-1 gate (threshold open, silence close, too-short discard, never-ending cap), the tier-2 match (wake on a transcript, `wakeRemainder` hand-off, folding of case and diacritics, a mid-sentence phrase not matching), `draftValue`'s refuse-not-default trio, `summarizeJarvisChange` naming the phrase and never the row, and the column check itself — all proved without a microphone, the way the voice slice already does. In `scripts/prove-jarvis-presence.mjs` and `scripts/prove-assistant-voice.mjs`, each with a mutation that must turn it red.

**Copy and proof sweep.** Four `pageGuide.ts` sentences assert the behaviour being removed: `:538` ("hands-free uses the browser's own recognizer, which sends what it hears to the browser vendor") and `:540` ("the same browser recognizer … streams the microphone to the browser vendor's speech service") are both false afterwards — the audio goes to this portal's gateway. The "no audio reaches a table, a bucket or a log" half of each survives. `:525` gains the account-stored phrase; `:524` is unchanged. `ambientBlocked` in `JarvisPresenceConsole.tsx` ("Chrome and Edge do; Firefox does not") becomes wrong in the opposite direction and is rewritten.

Pinned needles to rewrite in the same pass — a needle that matches nothing makes its mutation a no-op: `prove-assistant-voice.mjs:702`, `:721`, `:2016`, mutation #27 (`:1777-1780`) and #30 (`:1801`); `prove-assistant-merge.mjs:180` (asserts the disclosure contains "browser vendor") and `:228` (asserts a `Hands-free` checkbox); plus `prove-jarvis-corner.mjs` and `prove-person-spine.mjs`.

**Gates.** Register `050`'s probe in `scripts/prove-migration-claims.mjs` as part of authoring it, then: `tsc --noEmit`, eslint, every proof above, `prove-migration-claims.mjs`, `prove-guide-figures.mjs`.

**Live.** One armed orb with the owner signed in, because real mic audio to the gateway is a spend and none is made unasked. Sequence: arm, say the phrase in English, in Arabic, and in a mix; check the transcript lands in the saved conversation; check quiet hours and the hidden tab; check the ceiling message by driving the 429. Applying `050` locally needs its own named approval.

## Out of scope

Tier 3's streaming session (chunk after this one); a per-answer language for speaking beyond the two scripts already handled; widening `speechLanguageOf`; any change to the candidate portal; folding `040`–`049` into `db/schema.sql`; the eleven stale migration headers; and the appearance console, which this slice does not touch.
