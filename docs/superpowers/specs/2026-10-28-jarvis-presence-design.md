# JARVIS mode: a presence, not a page

**Date:** 2026-10-28
**Status:** Approved design — implementation in progress
**Scope:** one slice — the assistant stops being a page you visit and becomes a presence in the admin shell. A floating orb on every screen, a global hotkey, ambient "Hey Jarvis" listening behind an opt-in consent, a spoken morning briefing built from the live attention feed, threshold alerts from the same feed, all governed by a per-person preferences table (`047`) and spoken through a neural voice with a device-voice fallback.

It adds no tool. Every action still runs through `sendAssistantMessage` → the approval gate → the activity trail.

---

## Why

The assistant already reads and changes the portal, holds every write behind an approval card, and takes dictation. What it does not do is behave like a presence: it waits on one page, it never speaks first, and it answers in the flat voice of whichever machine the recruiter happens to use.

The pieces this needs already exist — the attention feed counts the work that is waiting, the wake-word state machine matches phrases, the approval gate makes spoken writes safe, and `SpeechSynthesis` is a fallback that never calls a provider. The work is assembling them into something that is always there, and writing down honestly what it costs in privacy.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Presence | a floating orb mounted in `AdminShell`, plus `Ctrl+Space` | The shell is rendered once per admin request, so the presence survives navigation and never duplicates |
| Conversation | the existing `AssistantChat`, opened by the orb | One conversation, one saved session, one approval gate. A second chat surface would split the transcript |
| Microphone reach | visible everywhere, and ambient wake word everywhere, opt-in per person | Chosen by the owner. The cost is stated below rather than hidden |
| Initiative | a spoken briefing once a day **and** threshold alerts, each toggleable | Chosen by the owner, and controlled per queue so a shared office can be quiet |
| Voice | neural provider with a sentence cache, device voice as fallback | Same voice on every machine; the fallback keeps the portal working with no key |
| Briefings | a card in the orb, not a saved chat turn | A briefing has no question behind it; writing one into the transcript would make "why is that queue growing?" the second half of a conversation the person never started |
| Preferences | server-side, RLS-scoped, trailed | The ambient toggle and alert thresholds are safety-relevant and must not be upgradeable from a browser |

## Architecture

### Pure domain — `src/modules/assistant/domain/jarvis.ts`

No imports, nothing async, provable in `scripts/prove-jarvis-presence.mjs`.

- `JARVIS_QUEUES` — the five ids the attention feed already issues (`new-applications`, `ungraded`, `upcoming-interviews`, `failed-sends`, `parked-jobs`) with default thresholds.
- `readClock("08:30")` → minutes, `withinQuietHours(nowMinutes, from, to)` — handles a window that wraps midnight (`18:00 → 08:00`), which is the ordinary case.
- `crossedQueues(previous, next, rules)` → the queues that went from at-or-below their threshold to above it. A queue below its threshold is silent however many times it is polled.
- `briefingSentences(alerts)` → at most three spoken lines, most urgent first, with counts as words ("twelve applications") because a synthesiser reads digits unpredictably.
- `isStopCommand(transcript)` — the words that interrupt playback, English and Arabic, matched as whole words.

### Server

- `db/migrations/047_assistant_jarvis_prefs.sql` — one row per person: `ambient`, `briefing`, `briefing_hour`, `watching`, `watch_queues text[]`, `quiet_from`, `quiet_to`, `voice`, `neural_voice`.
- `src/modules/assistant/application/jarvisSettings.ts` — read/write those rows; every write appends an activity row (`area: "settings"`, action `jarvis_prefs_changed`). Absent table → defaults plus `problem`, the same honesty pattern as `046`.
- `src/modules/assistant/infrastructure/speech.ts` — ElevenLabs `text-to-speech`, key resolved through `resolveSecret("elevenlabs")` (stored credential first, then `ELEVENLABS_API_KEY`), sentence-level cache keyed by voice + text hash, so "Listening" and the briefing opener cost nothing after the first play.
- `src/app/api/assistant/speak/route.ts` — `POST { text, voice }` → `audio/mpeg`. Staff-only (401), per-profile sliding window (429), text never logged, provider refusal → 502 with the reason summarised, no key → 503 so the client falls back deliberately rather than silently.

### Client

| Unit | Job |
| --- | --- |
| `src/lib/jarvis-ui.ts` | The presence's own store: `open`, `pendingUtterance`, `ambientArmed`. Same external-store shape as `rail.ts` and `alert-ack.ts`, so the orb, the dock and the chat agree without prop drilling |
| `src/modules/assistant/presentation/JarvisPresence.tsx` | The orb, its state ring (idle / listening / thinking / speaking / needs-approval), the badge, `Ctrl+Space`, the briefing card, the watcher, and the single ambient recognizer |
| `src/modules/assistant/presentation/useJarvisWatcher.ts` | Polls `getStaffAlerts()` on an interval, diffs with `crossedQueues`, respects quiet hours and the per-queue toggles, and speaks at most one line per crossing |
| `src/app/(admin)/assistant/jarvis/` | The settings screen: every switch, threshold and quiet-hour field, written through a server action |

### Wiring, and the one thing that must not double

`AssistantDock` moves its open state into the store so the orb can open it. `AssistantChat` gains an optional pending-utterance subscription and stops arming its own recognizer while ambient is armed — one microphone has one owner, always.

## Privacy, stated plainly

Ambient listening is the part of this slice that changes a promise. The voice spec previously said listening happens only on `/assistant/voice`, in the foreground. From this slice:

- It can be armed on any admin screen, but only by the person, only for their own account, and only after a one-time explanation naming what Chrome does: the browser's recognizer streams the microphone to Google's speech service, independently of this portal.
- The app bar carries a persistent indicator while it is armed, and the orb shows listening as a state. Arming in one tab is visible in another.
- Hiding the tab disarms. Quiet hours silence speech, not the recognizer; the recognizer has its own switch.
- Off by default. No account can be armed by an administrator, and no default grants it.
- Audio is still never stored. Only the transcript of a turn the person chose to send is saved, exactly as if typed.

## Errors and fallbacks

| Situation | What the person sees |
| --- | --- |
| No TTS key, or the provider refuses | That sentence is read by the device voice; the orb says once that the neural voice is unavailable |
| TTS rate limit reached | Device voice for the rest of the window, no error dialogue |
| `047` not applied | Defaults, all switches off, the panel names the migration |
| Ambient unsupported (Firefox) | The switch is disabled with the reason; the hotkey and push-to-talk still work |
| Wake phrase heard mid-sentence | No match: matching is anchored to the start of the utterance |
| Briefing already given today | Silent until tomorrow, per person, per day |
| Quiet hours | Watcher silent, briefing deferred to the window's end, orb badge still updates |

## Proofs

`scripts/prove-jarvis-presence.mjs` over the pure module, each with a mutation that must turn it red: quiet hours wrapping midnight; a queue below threshold never crossing; a queue crossing once and not again at the same count; briefing capped at three lines and ordering danger first; digits spoken as words; stop words matched as whole words only ("stopwatch" is not "stop").

Then the gates: `tsc --noEmit`, eslint, the existing assistant and activity checks, and a live pass in the app — orb renders, hotkey opens it, briefing speaks, a threshold alert fires, settings persist across reload.

## Out of scope

- Token-streamed answers. The agent loop plus the approval gate make that a separate slice; this one masks latency with a thinking state and a short acknowledgement instead.
- Scheduled assistant runs with no one signed in.
- Candidate-facing voice anywhere.
- A per-account grant for ambient listening beyond the person's own switch.
