"use client";

import {
  Loader2,
  Paperclip,
  Sparkles,
  Upload,
  X
} from "lucide-react";
import {
  CV_MAX_MB
} from "@/modules/careers/cv-rules";
import { cn } from "@/lib/utils";
import { StepHead, type T } from "./ApplyBits";

export function CvStep({
  t,
  file,
  hasAbout,
  filling,
  fillNote,
  fileInput,
  onPick,
  onClear,
  onFill,
}: {
  t: T;
  file: File | null;
  /** Whether the About-you box already holds enough to review them by. */
  hasAbout: boolean;
  filling: boolean;
  fillNote: { tone: "ok" | "bad"; text: string } | null;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onFill: () => void;
}) {
  return (
    <div>
      <StepHead title={t("apply.cvTitle")} note={t("apply.cvNote")} />

      <div className="mt-6">
        <span className="mb-1.5 block text-xs font-bold">{t("apply.cvAttach")}</span>

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
            <Paperclip className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <span className="shrink-0 text-xs text-brand-ink/45">
              {(file.size / 1024).toFixed(0)} KB
            </span>
            <button
              type="button"
              onClick={onClear}
              aria-label={t("apply.cvRemove")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-line bg-brand-cream px-4 py-6 text-center transition hover:border-brand-gold/50 hover:bg-brand-sand">
            <Upload className="h-5 w-5 text-brand-gold-dark" aria-hidden />
            <span className="mt-2 text-sm font-semibold">{t("apply.cvChoose")}</span>
            <span className="mt-0.5 text-xs text-brand-ink/45">
              {t("apply.cvTypes", { mb: CV_MAX_MB })}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="sr-only"
              onChange={(event) => onPick(event.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {file && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onFill}
              disabled={filling}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/60 bg-brand-sand/60 px-3.5 py-2 text-xs font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {filling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
              )}
              {filling ? t("apply.cvFilling") : t("apply.cvFill")}
            </button>

            {fillNote && (
              <p
                role={fillNote.tone === "bad" ? "alert" : "status"}
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  fillNote.tone === "ok" ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {fillNote.text} {fillNote.tone === "ok" && t("apply.cvFillCheck")}
              </p>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {t("apply.cvFillNote")}
            </p>
          </div>
        )}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-brand-ink/45">
        {hasAbout ? t("apply.cvHasAbout") : t("apply.cvNoAbout")}
      </p>
    </div>
  );
}
