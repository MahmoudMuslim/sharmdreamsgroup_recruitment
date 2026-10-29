"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_WAKE_PHRASE } from "@/modules/assistant/domain/voice";

/**
 * The voice console's controls, above its composer.
 *
 * Every control here describes what it does plainly: hands-free is a listening
 * state with a visible indicator, the wake phrase it listens for is set on the
 * account in Settings, and "Speak answers" changes playback only. Nothing here
 * approves anything — the autonomy panel below the chat decides that.
 */
export function VoiceStrip({
  pushToTalk,
  recording,
  transcribing,
  secondsLeft,
  hitLimit,
  supported,
  handsFree,
  onHandsFree,
  listening,
  ambientArmed,
  wakePhrase,
  speakReplies,
  onSpeakReplies,
  speaking,
  onStopSpeaking,
  caption,
  error,
}: {
  pushToTalk: () => void;
  recording: boolean;
  transcribing: boolean;
  secondsLeft: number;
  /** The two-minute cap ended the last clip, not the person. */
  hitLimit: boolean;
  supported: boolean;
  handsFree: boolean;
  onHandsFree: (next: boolean) => void;
  listening: boolean;
  /**
   * True while the presence orb's own recogniser holds the microphone on this page.
   *
   * One capture per tab: this console stands its recognizer down then, and the strip
   * has to say who is listening instead of claiming nothing is.
   */
  ambientArmed: boolean;
  wakePhrase: string;
  speakReplies: boolean;
  onSpeakReplies: (next: boolean) => void;
  speaking: boolean;
  onStopSpeaking: () => void;
  caption: string;
  error: string | null;
}) {
  // The box keeps what was typed so it can be edited; the phrase actually being
  // listened for falls back to the default when the box is empty, because an
  // empty phrase matches nothing. Saying "Listening for “”" would be a lie.
  const shownPhrase = wakePhrase.trim() || DEFAULT_WAKE_PHRASE;

  return (
    <div className="mb-2 rounded-xl border border-brand-line bg-brand-cream/70 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pushToTalk}
          disabled={transcribing}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition",
            recording
              ? "bg-rose-600 text-brand-on-accent hover:bg-rose-700"
              : "bg-brand-ink text-brand-cream hover:bg-brand-ink/85",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : recording ? (
            <Square className="h-4 w-4" aria-hidden />
          ) : (
            <Mic className="h-4 w-4" aria-hidden />
          )}
          {recording
            ? `Stop · ${secondsLeft}s`
            : transcribing
              ? "Transcribing…"
              : "Push to talk"}
        </button>

        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/70">
          <input
            type="checkbox"
            checked={handsFree}
            onChange={(event) => onHandsFree(event.target.checked)}
            disabled={!supported}
          />
          Hands-free
        </label>

        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/70">
          <input
            type="checkbox"
            checked={speakReplies}
            onChange={(event) => onSpeakReplies(event.target.checked)}
          />
          Speak answers
        </label>

        {speaking && (
          <button
            type="button"
            onClick={onStopSpeaking}
            className="rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-bold text-brand-ink/60 transition hover:bg-brand-sand"
          >
            Stop speaking
          </button>
        )}

      </div>

      {handsFree && supported && (
        <p className="mt-2 text-[10px] font-semibold leading-relaxed text-brand-ink/60">
          Listening for “{shownPhrase}” — the phrase is set in Settings → Assistant, on your account,
          so it is the same phrase on every machine you sign in from.
        </p>
      )}

      <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/55">
        {recording
          ? "Recording — this clip goes to the transcription model, and is discarded once the words come back."
          : ambientArmed
            ? "The assistant's orb is holding this browser's microphone, so it hears the wake phrase from the room and brings the question here."
            : handsFree
              ? listening
                ? `Listening for “${shownPhrase}” — what it hears is transcribed by this portal's own model and discarded once the words come back.`
                : error
                  ? "Listening stopped — the error below says why."
                  : "Arming the microphone…"
              : "Nothing is being recorded."}
        {caption ? ` ${caption}` : ""}
      </p>

      {hitLimit && !recording && (
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-brand-ink/60">
          Stopped at two minutes — the clip was transcribed.
        </p>
      )}

      {!supported && (
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-amber-700">
          Hands-free needs a microphone this browser will both open and encode. Push-to-talk works in
          this browser.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[10px] font-semibold leading-relaxed text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
