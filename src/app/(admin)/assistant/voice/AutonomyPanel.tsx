"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VOICE_AUTONOMY,
  VOICE_AUTONOMY_HINTS,
  VOICE_AUTONOMY_LABELS,
  type VoiceAutonomy,
  type VoiceAutonomyState,
} from "@/modules/assistant/domain/voice";
import { setVoiceAutonomy } from "./actions";

/**
 * What a spoken word may release.
 *
 * Stored on the server, so the browser cannot upgrade itself; this panel is the
 * only place it is written. The levels it offers are gated on `problem`, not on
 * `stored`: a row that was read proves the table works, but an empty table and a
 * table that was never applied both read no row, and only the first may offer
 * every level a caller is allowed. While 046 is absent only `confirm` is offered
 * and the panel names the file; an unreadable table offers the same safe level
 * and says the read failed rather than blaming a migration.
 */
export function AutonomyPanel({ initial }: { initial: VoiceAutonomyState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<VoiceAutonomy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VoiceAutonomy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** A level that cannot be stored cannot be enforced, so only `confirm` is offered. */
  const storable = state.problem === null;

  async function choose(level: VoiceAutonomy) {
    setNotice(null);
    if (level === state.level) {
      // While 046 is absent the safe level is already in effect, so its button
      // is the only enabled one. Clicking it changes nothing, and the panel has
      // to say that rather than leave the person guessing.
      if (!state.stored) {
        setNotice(
          state.problem === "absent"
            ? "Confirm with a click is already in effect — nothing changed, because the table that stores the other levels is not applied."
            : "Confirm with a click is already in effect — nothing changed."
        );
      }
      return;
    }
    if (busy) return;
    setBusy(level);
    setError(null);
    setSaved(null);
    try {
      const result = await setVoiceAutonomy(level);
      if (!result.ok) {
        setError(result.error ?? "That setting could not be saved.");
        return;
      }
      setState((current) => ({ ...current, level: result.level, stored: true, problem: null }));
      setSaved(result.level);
    } catch {
      // A thrown action is a failed save like any other: the spinner stops and
      // the same error line reports it, instead of the panel sitting on `busy`.
      setError("That setting could not be saved. Nothing has changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-white p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        What a spoken word may release
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">
        This is stored on your account, not in this browser, and the server reads it every time a
        card is raised.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {VOICE_AUTONOMY.map((level) => {
          const disabled =
            busy !== null ||
            (!storable && level !== "confirm") ||
            (level === "open" && !state.canOpen);
          return (
            <button
              key={level}
              type="button"
              onClick={() => void choose(level)}
              disabled={disabled}
              aria-pressed={state.level === level}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                state.level === level
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-brand-line bg-white hover:bg-brand-cream",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <p className="flex items-center gap-1.5 text-xs font-bold text-brand-ink">
                {VOICE_AUTONOMY_LABELS[level]}
                {busy === level && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                {VOICE_AUTONOMY_HINTS[level]}
              </p>
              {level === "open" && !state.canOpen && (
                <p className="mt-1 text-[10px] font-semibold text-amber-700">
                  Needs settings.manage_platform.
                </p>
              )}
            </button>
          );
        })}
      </div>

      {state.problem === "absent" && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
          db/migrations/046_assistant_voice_autonomy.sql is authored but not applied, so only
          “Confirm with a click” can be used. The other two need the table that stores them.
        </p>
      )}
      {state.problem === "unreadable" && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
          The voice setting could not be read just now, so only “Confirm with a click” can be used
          until it can be. Nothing has been assumed about the level you chose.
        </p>
      )}
      {state.problem === null && !state.stored && (
        <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/55">
          No level is stored yet. Until you choose one, every write waits for your click.
        </p>
      )}
      {notice && !error && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[11px] font-semibold leading-relaxed text-rose-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 text-[11px] font-semibold text-brand-ink/60">
          Saved — {VOICE_AUTONOMY_LABELS[saved]}.
        </p>
      )}
    </section>
  );
}
