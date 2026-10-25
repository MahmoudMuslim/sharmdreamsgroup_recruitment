"use client";

import { useState } from "react";
import { Eraser, FileText, Loader2, Mail, ShieldCheck } from "lucide-react";
import {
  PRIVACY_NOTE_MAX,
  PRIVACY_REQUEST_KINDS,
  type PrivacyRequestKind,
} from "@/modules/privacy/domain/privacy";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  filePrivacyRequest,
  requestPrivacyLink,
  type PrivacyTokenDescription,
} from "./actions";

type Described = Extract<PrivacyTokenDescription, { ok: true }>;

/**
 * The two doors this page offers, chosen by whether a link is on the address.
 *
 * With a link, the visitor sees which application it names and files one
 * request against it. Without one, the only thing they can do is ask for a link
 * by email — and the answer to that is deliberately the same sentence whether an
 * address is on file or not, because a different answer would turn this page into
 * a way to test whether somebody applied.
 *
 * Nothing here decides anything: the server action re-reads the request, re-plans
 * it and answers with the sentence to show. This component's job is to collect
 * the two fields and put the answer on screen.
 */
export function PrivacyDoor({
  token,
  description,
  problem,
}: {
  token: string | null;
  description: Described | null;
  problem: string | null;
}) {
  const locale = usePublicLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<PrivacyRequestKind>("access");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"link" | "file" | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function askForLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy("link");
    setOutcome(null);
    try {
      const result = await requestPrivacyLink({ email });
      setOutcome({ ok: result.ok, text: result.message });
    } catch {
      setOutcome({ ok: false, text: t("privacy.unreachable") });
    } finally {
      setBusy(null);
    }
  }

  async function fileRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy("file");
    setOutcome(null);
    try {
      const result = await filePrivacyRequest({ token, kind, note });
      setOutcome({ ok: result.ok, text: result.message });
    } catch {
      setOutcome({ ok: false, text: t("privacy.unreachable") });
    } finally {
      setBusy(null);
    }
  }

  const filed = outcome?.ok === true;

  return (
    <div className="mt-6 rounded-2xl border border-brand-line bg-white p-6 shadow-soft sm:p-8">
      {description && (
        <div className="rounded-xl border border-brand-gold/40 bg-brand-gold/5 px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gold-dark">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {t("privacy.signedLink")}
          </p>
          <p className="mt-2 text-sm text-brand-ink/70">
            {t("privacy.recordFor")} <span className="font-bold">{description.fullName}</span>
          </p>
          {description.jobTitle && (
            <p className="mt-0.5 text-xs text-brand-ink/55">{description.jobTitle}</p>
          )}
          <p className="mt-1 text-xs text-brand-ink/45">
            {t("privacy.linkMask", { email: description.maskedEmail })}{" "}
            {t("privacy.linkExpires", { date: description.validUntil.slice(0, 10) })}
          </p>
        </div>
      )}

      {!description && (
        <p
          className={cn(
            "rounded-xl border px-4 py-3 text-sm leading-relaxed",
            problem
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-brand-line bg-brand-cream text-brand-ink/65"
          )}
        >
          {problem ?? t("privacy.askLinkBody")}
        </p>
      )}

      {outcome && (
        <p
          role="status"
          className={cn(
            "mt-4 rounded-xl border px-4 py-3 text-sm leading-relaxed",
            outcome.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          )}
        >
          {outcome.text}
        </p>
      )}

      {description && !filed && (
        <form onSubmit={fileRequest} className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
            {t("privacy.chooseKind")}
          </p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PRIVACY_REQUEST_KINDS.map((value) => {
              const Icon = value === "access" ? FileText : Eraser;
              const active = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setKind(value);
                    setOutcome(null);
                  }}
                  aria-pressed={active}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-4 py-3 text-start transition",
                    active
                      ? "border-brand-gold bg-brand-gold/10"
                      : "border-brand-line bg-white hover:border-brand-gold/50"
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{t(`privacy.kind.${value}`)}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-brand-ink/55">
                      {t(`privacy.kind.${value}Hint`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {kind === "erasure" && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-700">
              {t("privacy.erasureWarning")}
            </p>
          )}

          <label className="mt-4 block">
            <span className="text-xs font-bold text-brand-ink/60">{t("privacy.noteLabel")}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={PRIVACY_NOTE_MAX}
              rows={3}
              className="mt-1.5 w-full resize-y rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-ink outline-none transition focus:border-brand-gold focus-visible:ring-2 focus-visible:ring-brand-gold/40"
            />
          </label>

          <button
            type="submit"
            disabled={busy !== null}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "file" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy === "file" ? t("privacy.filing") : t("privacy.file")}
          </button>
        </form>
      )}

      {!description && (
        <form onSubmit={askForLink} className="mt-5">
          <label className="block">
            <span className="text-xs font-bold text-brand-ink/60">{t("privacy.emailLabel")}</span>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setOutcome(null);
                }}
                autoComplete="email"
                className="h-11 flex-1 rounded-xl border border-brand-line bg-white px-3 text-sm text-brand-ink outline-none transition focus:border-brand-gold focus-visible:ring-2 focus-visible:ring-brand-gold/40"
              />
              <button
                type="submit"
                disabled={busy !== null}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "link" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Mail className="h-4 w-4" aria-hidden />
                )}
                {busy === "link" ? t("privacy.sending") : t("privacy.sendLink")}
              </button>
            </div>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/45">
            {t("privacy.linkQuiet")}
          </p>
        </form>
      )}
    </div>
  );
}
