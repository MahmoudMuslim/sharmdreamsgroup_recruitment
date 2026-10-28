"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import {
  getJarvisPresence,
  type PresenceRead,
} from "@/app/(admin)/assistant/jarvis/actions";
import {
  DEFAULT_WAKE_PHRASE,
  matchWakePhrase,
} from "@/modules/assistant/domain/voice";
import {
  DEFAULT_JARVIS_PREFS,
  briefingSentences,
  canArmAmbient,
  isStopCommand,
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
  readStoredVoiceLanguage,
  readStoredWakePhrase,
  subscribeVoicePrefs,
  type VoiceLanguage,
} from "@/app/(admin)/assistant/AssistantPrefs";
import { useWakeWord } from "@/app/(admin)/assistant/voice/useWakeWord";
import { JarvisReactor, type ReactorState } from "./JarvisReactor";
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
  const [stopped, setStopped] = useState(false);

  const wakePhrase = useSyncExternalStore(
    subscribeVoicePrefs,
    readStoredWakePhrase,
    () => DEFAULT_WAKE_PHRASE
  );
  const voiceLanguage = useSyncExternalStore(
    subscribeVoicePrefs,
    readStoredVoiceLanguage,
    () => "en" as VoiceLanguage
  );

  const prefs = presence?.ok ? presence.prefs : null;
  const voice = useJarvisVoice({
    neural: prefs?.neuralVoice ?? false,
    voice: prefs?.voice ?? DEFAULT_JARVIS_PREFS.voice,
  });
  const { wakeAudio, tone, say, stop, notice, dismissNotice, heardOwnVoice } = voice;

  useEffect(() => {
    let alive = true;
    void getJarvisPresence().then((read) => {
      if (alive) setPresence(read);
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
      const phrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;
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

  const wake = useWakeWord({
    enabled: prefs !== null && canArmAmbient(prefs),
    language: voiceLanguage,
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
   * The loudness the core breathes with, read while the ambient recogniser is the
   * one holding the microphone.
   *
   * This is a second consumer of the same device, so it is armed for no state but
   * `wake.listening` — a switch the person set themselves, behind the one-time
   * explanation, and the only moment the portal is already holding the microphone.
   * The audio is averaged to one number on this machine and dropped; nothing is
   * stored and nothing new leaves the browser.
   */
  const meter = useJarvisMeter({ enabled: wake.listening });

  /**
   * The newest thing the presence has to say, shown without opening a conversation
   * nobody started — a briefing has no question behind it.
   */
  const lines = notice
    ? null
    : stopped
      ? "Stopped."
      : watcher.briefing.length
        ? watcher.briefing.join(". ")
        : briefingSentences(watcher.recent)[0] ?? null;
  const announcement =
    notice ?? lines ?? watcher.error ?? wake.error ?? (presence && !presence.ok ? presence.message : null);

  return (
    <div
      className={cn(
        "fixed z-40",
        // Beside the panel, not under it: a conversation you are having is exactly
        // when you want to see the assistant reacting to your voice. In full-window
        // mode the panel covers the corner and its own `z-50` wins, so the reactor
        // goes behind it rather than floating over the transcript.
        ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-24 right-6"
      )}
    >
      {announcement && (
        <div className="mb-2 w-56 rounded-xl border border-brand-line bg-white p-3 text-[11px] leading-relaxed text-brand-ink/75 shadow-lift">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{announcement}</span>
            <button
              type="button"
              onClick={() => {
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

      <div className="relative inline-block">
        <JarvisReactor
          state={state}
          size={ui.open ? 76 : 104}
          level={meter.armed ? meter.read : undefined}
          showStatus
          line={ui.awaiting ? "AWAKE · SAY YOUR QUESTION" : null}
          ariaLabel={`${STATE_LABEL[state]}${meter.error ? ` — ${meter.error}` : ""}`}
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
