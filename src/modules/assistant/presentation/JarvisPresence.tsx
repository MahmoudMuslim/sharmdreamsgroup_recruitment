"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import {
  getJarvisPresence,
  getJarvisAppearance,
  type PresenceRead,
} from "@/app/(admin)/settings/jarvis-actions";
import { DEFAULT_SPEECH_RATE, matchWakePhrase } from "@/modules/assistant/domain/voice";
import {
  DEFAULT_JARVIS_PREFS,
  DEFAULT_WAKE_PHRASE_TEXT,
  briefingSentences,
  canArmAmbient,
  isStopCommand,
  withinQuietHours,
} from "@/modules/assistant/domain/jarvis";
import {
  handToJarvisChat,
  jarvisUiOnServer,
  readJarvisUi,
  setJarvisAmbient,
  setJarvisOpen,
  subscribeJarvisUi,
  toggleJarvisOpen,
} from "@/lib/jarvis-ui";
import {
  readStoredSpeechRate,
  readStoredVoiceId,
  subscribeVoicePrefs,
} from "@/app/(admin)/assistant/AssistantPrefs";
import { useWakeListening } from "./voice/useWakeListening";
import { DEFAULT_JARVIS_APPEARANCE, type JarvisAppearance, type ReactorState } from "@/modules/assistant/domain/jarvisAppearance";
import { JarvisReactor } from "./JarvisReactor";
import { useJarvisMeter } from "./useJarvisMeter";
import { useJarvisVoice } from "./useJarvisVoice";
import { useJarvisWatcher } from "./useJarvisWatcher";

/**
 * What the reactor is doing, in the one sentence a person needs before they look.
 *
 * Only states the presence can actually observe are reachable from here. There is no
 * "ready" and no "waiting for a question" of its own: the first is a promise about a
 * turn nobody asked for, and the second is the conversation's fact, mirrored into the
 * store by the chat that holds it.
 */
const STATE_LABEL: Record<ReactorState, string> = {
  idle: "The assistant is present but not listening — open it",
  listening: "The assistant is listening for the wake phrase — open it",
  thinking: "The assistant is working on your question",
  speaking: "The assistant is speaking — say stop to interrupt",
  approval: "The assistant is waiting for your click",
  alert: "A queue the assistant watches is above its threshold — open it",
};

/**
 * How long an idle, untouched orb waits before it shrinks into the corner.
 *
 * Long enough that it does not duck away from a pointer on its way somewhere else,
 * short enough that a still page is not left with a bright orb and a status line
 * competing with the content.
 */
const REST_AFTER_MS = 2500;

/**
 * Minutes past midnight where the group's clock says it is, for the quiet-hours test.
 *
 * A component body may not read a clock — the same purity rule that keeps the chat's
 * comparison behind a hook method — so this is called from render with a `timeZone`
 * the server handed down, and its own `new Date()` is a dependency of the render, not
 * of a memo. The watcher already does this with the pair it is given.
 */
function minutesInGroupZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export interface JarvisPresenceProps {
  user: SessionUser;
  timeZone: string;
}

/**
 * The assistant as a presence: one orb, on every admin screen.
 *
 * It owns three things and nothing else — the microphone while ambient listening is
 * armed, the voice that reads the briefing and the alerts, and the hotkey that
 * opens the conversation. It deliberately owns no conversation: what it hears is
 * handed to `AssistantChat` for interpretation, because the wake phrase, the
 * approval verdicts and the refusals are decided and proved there already.
 *
 * ## One microphone, one owner
 *
 * While this recogniser is armed the chat's own is stood down (its `ambientArmed`
 * subscription). Two continuous recognisers in one page would each hear the person
 * and each hand the assistant the same turn.
 *
 * ## What the orb never claims
 *
 * Every switch it honours comes from the person's own row through `canArmAmbient`,
 * which refuses a wake word with no consent stamp the server wrote — so an orb
 * cannot be armed by a value a browser invented. While migration 047 is unapplied
 * the read returns defaults and the refusal sentence, and nothing arms at all.
 */
export function JarvisPresence({ user, timeZone }: JarvisPresenceProps) {
  const ui = useSyncExternalStore(subscribeJarvisUi, readJarvisUi, jarvisUiOnServer);
  const [presence, setPresence] = useState<PresenceRead | null>(null);
  // What the orb looks like, read from the same row that says what it may do. The
  // portal default is drawn until the read answers, so an absent or unreadable
  // 049 leaves the orb wearing the portal's own gold rather than nothing.
  const [appearance, setAppearance] = useState<JarvisAppearance>(DEFAULT_JARVIS_APPEARANCE);
  const [stopped, setStopped] = useState(false);
  // The note card is fed by several sources that outlive a click — a briefing that
  // was given, the recogniser's refusal, the prefs read. None of them is a piece of
  // state this component owns, so closing the card is remembered here, by the text
  // that was showing: a note the person closed stays closed, and a different one
  // still arrives.
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);
  // The corner shape has two halves: the room has been still long enough, and the
  // pointer or the keyboard is not on the orb. Either one alone is not rest.
  const [idle, setIdle] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // The same browser-level pair the chat speaks with, so the orb and the answers it
  // reads aloud cannot sound like two different people on one machine.
  const voiceId = useSyncExternalStore(subscribeVoicePrefs, readStoredVoiceId, () => "");
  const speechRate = useSyncExternalStore(
    subscribeVoicePrefs,
    readStoredSpeechRate,
    () => DEFAULT_SPEECH_RATE
  );

  const prefs = presence?.ok ? presence.prefs : null;
  // The phrase is the account's, so it arrives on the read the orb already does and
  // survives a different machine. An empty row means the default, which is what the
  // panel shows too — "Listening for “”" would be a lie.
  const wakePhrase = prefs?.wakePhrase?.trim() || DEFAULT_WAKE_PHRASE_TEXT;
  const voice = useJarvisVoice({ voiceId, rate: speechRate });
  const { wakeAudio, tone, say, stop, notice, dismissNotice, heardOwnVoice } = voice;

  useEffect(() => {
    let alive = true;
    void getJarvisPresence().then((read) => {
      if (alive) setPresence(read);
    });
    // The console bumps `prefsEpoch` after either save, so an appearance written
    // on Settings → Assistant reaches this orb without a reload — the shell, and so
    // this component, survives every in-app navigation.
    void getJarvisAppearance().then((read) => {
      if (alive) setAppearance(read.appearance);
    });
    return () => {
      alive = false;
    };
  }, [ui.prefsEpoch]);

  const watcher = useJarvisWatcher({
    enabled: prefs !== null && (prefs.watching || prefs.briefing),
    prefs: prefs ?? DEFAULT_JARVIS_PREFS,
    timeZone,
    profileId: user.profileId,
    say,
    tone,
  });

  /**
   * Everything the microphone hears, filtered before it reaches the conversation.
   *
   * Three things are dropped, and each is a real way an ambient microphone picks up
   * noise that is not a person talking to it: the assistant's own voice coming back
   * through the speaker, a command aimed at the playback rather than at a new turn,
   * and any utterance that never named the wake phrase while nothing is waiting for
   * a follow-up.
   */
  const hear = useCallback(
    (text: string) => {
      if (heardOwnVoice(text)) return;
      if (voice.speaking && isStopCommand(text)) {
        stop();
        setStopped(true);
        return;
      }
      const phrase = wakePhrase;
      if (!matchWakePhrase(text, phrase).matched && !ui.awaiting) return;
      setStopped(false);
      // A click is what lets a tab make a sound at all, and a wake phrase said out
      // loud is not one — so the audio is unlocked here, at the moment the person
      // chose to speak to the assistant, rather than at the next briefing.
      wakeAudio();
      tone("heard");
      setJarvisOpen(true);
      handToJarvisChat(text);
    },
    [heardOwnVoice, stop, tone, ui.awaiting, voice.speaking, wakeAudio, wakePhrase]
  );

  // Kept current after commit rather than during render: the recogniser holds one
  // handler for its whole run, and re-arming the microphone to pass a new closure
  // would drop the utterance in flight.
  const hearRef = useRef(hear);
  useEffect(() => {
    hearRef.current = hear;
  });

  // One capture, one owner: the meter holds the microphone whenever the wake word is
  // armed, and the listening hook cuts its segments from that same stream. Arming is
  // a preference, so the capture follows the preference and not a recogniser's report.
  const ambientArmed = prefs !== null && canArmAmbient(prefs);
  const meter = useJarvisMeter({ enabled: ambientArmed });

  const nowMinutes = minutesInGroupZone(timeZone);
  const segmentsQuiet = withinQuietHours(
    nowMinutes,
    prefs?.quietFrom ?? "18:00",
    prefs?.quietTo ?? "08:00"
  );

  const wake = useWakeListening({
    enabled: ambientArmed,
    meter,
    quiet: segmentsQuiet,
    onUtterance: (text) => hearRef.current(text),
  });

  // The store reports the microphone's truth, from the hook that owns it, so no
  // surface can advertise a recogniser the browser refused to start.
  useEffect(() => {
    setJarvisAmbient(wake.listening);
  }, [wake.listening]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.code !== "Space" || event.altKey || event.metaKey) return;
      // A composer or a rich field owning the space bar keeps it: the hotkey is for
      // the person looking at a page, not for the one mid-sentence in a text box.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      wakeAudio();
      toggleJarvisOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wakeAudio]);

  const state: ReactorState =
    voice.speaking || ui.speaking
      ? "speaking"
      : ui.pendingApproval
        ? "approval"
        : ui.thinking
          ? "thinking"
          : wake.listening
            ? "listening"
            : watcher.news.length > 0
              ? "alert"
              : "idle";

  /**
   * The newest thing the presence has to say, shown without opening a conversation
   * nobody started — a briefing has no question behind it.
   *
   * An unapplied 047 is not among the things it says: every switch defaults to off,
   * so the orb's silence is the honest state, and the panel at Settings → Assistant is
   * where the missing table is named. Pinning a migration path over every admin
   * screen would tell a recruiter about a file they cannot act on. An unreadable
   * table is different — that is an outage, and it is said once.
   */
  const readProblem =
    presence && !presence.ok && presence.reason !== "absent-table" ? presence.message : null;
  const lines = notice
    ? null
    : stopped
      ? "Stopped."
      : watcher.briefing.length
        ? watcher.briefing.join(". ")
        : briefingSentences(watcher.recent)[0] ?? null;
  const candidate = notice ?? lines ?? watcher.error ?? wake.error ?? readProblem;
  const announcement = candidate && candidate !== dismissedAnnouncement ? candidate : null;

  /**
   * Whether the orb may rest: the conversation is closed, nothing is happening,
   * and it has nothing to say. Those four facts are what make a small orb honest —
   * an orb that shrank while a queue was over its threshold, or while a briefing
   * was on screen, would be hiding the one thing it exists to show.
   *
   * `idle` is a latch, not a countdown: once the orb has rested, `resting` above is
   * still gated by `canRest` on every render, so a busier state brings it straight
   * back — and a pointer or a tab focus holds it out until both leave.
   */
  const canRest = !ui.open && state === "idle" && !announcement && watcher.news.length === 0;
  const resting = canRest && idle && !expanded;

  useEffect(() => {
    if (!canRest) return;
    const timer = window.setTimeout(() => setIdle(true), REST_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [canRest]);

  return (
    <div
      className={cn(
        "fixed z-40",
        // Beside the panel, not under it: a conversation you are having is exactly
        // when you want to see the assistant reacting to your voice. In full-window
        // mode the panel covers the corner and its own `z-50` wins, so the reactor
        // goes behind it rather than floating over the transcript.
        ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-5 right-5"
      )}
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      {announcement && (
        <div className="mb-2 w-56 rounded-xl border border-brand-line bg-white p-3 text-[11px] leading-relaxed text-brand-ink/75 shadow-lift">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{announcement}</span>
            <button
              type="button"
              onClick={() => {
                setDismissedAnnouncement(announcement);
                dismissNotice();
                setStopped(false);
              }}
              aria-label="Dismiss the assistant's note"
              className="shrink-0 rounded-md p-0.5 text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {watcher.news.length > 0 && (
            <p className="mt-1.5 border-t border-brand-line pt-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-gold-dark">
              {watcher.news.length} queue
              {watcher.news.length === 1 ? "" : "s"} above its threshold
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          // The canvas is a fixed 104 px square and CSS scales it, so shrinking
          // never re-initialises the WebGL scene behind the orb. Scaling about the
          // bottom-right corner and pushing a third of the way past it leaves a
          // small orb tucked into the frame rather than one floating over the page.
          "relative inline-block origin-bottom-right transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
          resting
            ? "translate-x-[34%] translate-y-[34%] scale-50 opacity-80 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:scale-75 [@media(hover:none)]:opacity-100"
            : "translate-x-0 translate-y-0 scale-100 opacity-100"
        )}
        data-resting={resting ? "true" : undefined}
      >
        <JarvisReactor
          state={state}
          appearance={appearance}
          size={ui.open ? 76 : 104}
          level={meter.armed ? meter.read : undefined}
          showStatus={!resting}
          line={ui.awaiting ? "AWAKE · SAY YOUR QUESTION" : null}
          ariaLabel={`${STATE_LABEL[state]}${meter.error ? ` — ${meter.error}` : ""}`}
          ariaExpanded={ui.open}
          onClick={() => {
            wakeAudio();
            toggleJarvisOpen();
          }}
        />
        {watcher.news.length > 0 && (
          <span className="absolute -right-1 -top-1 z-20 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-ink px-1 text-[10px] font-bold text-brand-cream">
            {watcher.news.length}
          </span>
        )}
      </div>
    </div>
  );
}
