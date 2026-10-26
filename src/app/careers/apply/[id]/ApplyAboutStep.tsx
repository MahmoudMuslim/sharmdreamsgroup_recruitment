"use client";

import {
  Loader2,
  Sparkles
} from "lucide-react";
import {
  ABOUT_ME_MAX_CHARS,
  CV_MAX_MB,
  profileLink
} from "@/modules/careers/cv-rules";
import { cn } from "@/lib/utils";
import { FIELD, Label, SOURCES, StepHead, type T } from "./ApplyBits";

export function AboutStep({
  t,
  fullName,
  email,
  phone,
  linkedinUrl,
  aboutMe,
  source,
  referred,
  writing,
  writeNote,
  fillNote,
  hasFile,
  aboutFileInput,
  onName,
  onEmail,
  onPhone,
  onLink,
  onAboutMe,
  onAsk,
  onPickForAbout,
  onSource,
}: {
  t: T;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  aboutMe: string;
  source: string;
  /** True when a staff member's code carried the applicant here. */
  referred: boolean;
  writing: boolean;
  writeNote: { tone: "ok" | "bad"; text: string } | null;
  /** What the CV's contact block filled, so the press reports both halves. */
  fillNote: { tone: "ok" | "bad"; text: string } | null;
  hasFile: boolean;
  aboutFileInput: React.RefObject<HTMLInputElement | null>;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onLink: (value: string) => void;
  onAboutMe: (value: string) => void;
  onAsk: () => void;
  onPickForAbout: (file: File | null) => void;
  onSource: (value: string) => void;
}) {
  // The same predicate the reader and the submit action use, so the sentence under
  // the field cannot promise a read of a link nothing will fetch.
  const readableLink = profileLink(linkedinUrl);
  const canWrite = readableLink !== null || hasFile;

  return (
    <div>
      <StepHead
        title={t("apply.aboutTitle")}
        note={t("apply.aboutNote")}
        action={
          <>
            <button
              type="button"
              onClick={onAsk}
              disabled={writing}
              title={t("apply.aboutFillNote", { mb: CV_MAX_MB })}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/60 bg-brand-sand/60 px-3.5 py-2 text-xs font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {writing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
              )}
              {writing ? t("apply.aboutFilling") : t("apply.aboutFill")}
            </button>

            {/* Driven by the button above, so it stays out of the tab order — but it
                is still named, because the picker the operating system draws shows
                nothing but this label. */}
            <input
              ref={aboutFileInput}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              aria-label={t("apply.aboutPick")}
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                // Cleared so the same file can be chosen again after a refusal.
                event.target.value = "";
                onPickForAbout(selected);
              }}
            />
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="apply-name">
            {t("apply.name")} <span className="ml-1 text-rose-600">*</span>
          </Label>
          <input
            id="apply-name"
            required
            autoComplete="name"
            value={fullName}
            onChange={(event) => onName(event.target.value)}
            className={FIELD}
            placeholder={t("apply.namePlaceholder")}
          />
        </div>

        <div>
          <Label htmlFor="apply-email">
            {t("apply.email")} <span className="ml-1 text-rose-600">*</span>
          </Label>
          <input
            id="apply-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            className={FIELD}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <Label htmlFor="apply-phone">{t("apply.phone")}</Label>
          <input
            id="apply-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => onPhone(event.target.value)}
            className={FIELD}
            placeholder={t("apply.phonePlaceholder")}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="apply-linkedin">
            {t("apply.linkedin")}{" "}
            <span className="ml-1 font-normal text-brand-ink/40">{t("apply.optional")}</span>
          </Label>
          <input
            id="apply-linkedin"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={linkedinUrl}
            onChange={(event) => onLink(event.target.value)}
            className={FIELD}
            placeholder={t("apply.linkedinPlaceholder")}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
            {t("apply.linkedinNote")}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="apply-about">{t("apply.aboutMe")}</Label>
          <textarea
            id="apply-about"
            rows={7}
            maxLength={ABOUT_ME_MAX_CHARS}
            value={aboutMe}
            onChange={(event) => onAboutMe(event.target.value)}
            className={cn(FIELD, "resize-y")}
            placeholder={t("apply.aboutMePlaceholder")}
          />

          <div className="mt-2">
            {fillNote && (
              <p
                role={fillNote.tone === "bad" ? "alert" : "status"}
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  fillNote.tone === "ok" ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {fillNote.text}
              </p>
            )}

            {writeNote && (
              <p
                role={writeNote.tone === "bad" ? "alert" : "status"}
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  writeNote.tone === "ok" ? "text-emerald-800" : "text-amber-800"
                )}
              >
                {writeNote.text}
              </p>
            )}

            {!canWrite && !writeNote && (
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
                {t("apply.about.noSource")}
              </p>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {t("apply.aboutMeNote")}
            </p>
          </div>
        </div>

        <div className="sm:col-span-2">
          {referred ? (
            <div className="rounded-xl border border-brand-gold/30 bg-brand-gold/10 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-gold-dark">
                {t("apply.source.referral")}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-brand-ink/65">
                {t("apply.source.referred")}
              </p>
            </div>
          ) : (
            <>
              <Label htmlFor="apply-source">{t("apply.source")}</Label>
              <select
                id="apply-source"
                value={source}
                onChange={(event) => onSource(event.target.value)}
                className={FIELD}
              >
                {SOURCES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.key)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
