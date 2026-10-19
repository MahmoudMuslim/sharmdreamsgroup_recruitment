"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Loader2,
  MessageCircle,
  Send,
  UserRoundSearch,
  X,
} from "lucide-react";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MAX_TURNS, type ChatTurn } from "@/modules/careers/chatbot/conversation";

/**
 * The careers assistant, as a candidate meets it.
 *
 * A floating panel on the public pages. It asks one question at a time of
 * `/api/careers/chat`, which answers from the role and company facts that page
 * already prints — so the panel can only ever repeat what is on screen, or say
 * that the page does not state something.
 *
 * The second half of it is the part a recruiter cares about: leaving a name and
 * a way to be reached, with the conversation attached. That is a *lead*, and the
 * copy says so, because a chat is not an application — an application needs a CV
 * and the answers to the role's questions, and neither of those happens here.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function CareersChat({
  jobId = null,
  jobTitle = null,
  starters,
}: {
  jobId?: string | null;
  jobTitle?: string | null;
  starters: string[];
}) {
  const locale = usePublicLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const [leadOpen, setLeadOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns, busy, leadOpen, failure]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const greet = () => {
    setOpen(true);
    if (turns.length > 0) return;
    setTurns([
      {
        role: "assistant",
        content: t(jobId ? "chat.greetingRole" : "chat.greetingBoard", {
          role: jobTitle ?? "",
        }),
      },
    ]);
  };

  const send = async (text?: string) => {
    const question = (text ?? draft).trim();
    if (!question || busy) return;

    setDraft("");
    setFailure(null);
    const asked = [...turns, { role: "candidate" as const, content: question }].slice(-MAX_TURNS);
    setTurns(asked);
    setBusy(true);

    try {
      const response = await fetch("/api/careers/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, locale, messages: asked }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { reply?: unknown; error?: unknown }
        | null;

      if (!response.ok || typeof payload?.reply !== "string") {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : t("chat.failed")
        );
      }

      setTurns([...asked, { role: "assistant" as const, content: payload.reply }].slice(-MAX_TURNS));
    } catch (error) {
      // The question stays on screen so it can be retried; only the answer failed.
      setFailure(error instanceof Error && error.message ? error.message : t("chat.failed"));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const saveLead = async () => {
    if (saving) return;
    setLeadError(null);
    setSaving(true);

    try {
      const response = await fetch("/api/careers/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name, email, phone, messages: turns }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : t("chat.leadFailed")
        );
      }

      setSaved(true);
    } catch (error) {
      setLeadError(error instanceof Error && error.message ? error.message : t("chat.leadFailed"));
    } finally {
      setSaving(false);
    }
  };

  const emailLooksWrong = email.trim().length > 0 && !EMAIL.test(email.trim());
  const canSave = name.trim().length >= 2 && (EMAIL.test(email.trim()) || phone.trim().length >= 6);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-3 p-4 sm:items-end">
      {open && (
        <section
          role="dialog"
          aria-label={t("chat.title")}
          className="pop-in pointer-events-auto flex max-h-[min(34rem,72vh)] w-full flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-lift sm:w-[24rem]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-brand-line px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-display text-sm font-bold">
                {t("chat.title")}
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-gold-dark">
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                  {t("chat.aiBadge")}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
                {jobTitle ? `${jobTitle} — ` : ""}
                {t("chat.note")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-brand-ink/50 transition hover:bg-brand-sand hover:text-brand-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.map((turn, index) => (
              <div
                key={`${index}-${turn.content.slice(0, 12)}`}
                className={cn("flex", turn.role === "candidate" ? "justify-end" : "justify-start")}
              >
                <p
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                    turn.role === "candidate"
                      ? "rounded-br-md bg-brand-ink text-brand-cream"
                      : "rounded-bl-md bg-brand-sand text-brand-ink/85"
                  )}
                >
                  {turn.content}
                </p>
              </div>
            ))}

            {busy && (
              <p className="flex items-center gap-2 text-[11px] font-semibold text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("chat.thinking")}
              </p>
            )}

            {failure && (
              <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {failure}
              </p>
            )}

            {leadOpen && !saved && (
              <div className="rounded-xl border border-brand-line bg-brand-cream px-3.5 py-3">
                <p className="text-xs font-bold">{t("chat.leadTitle")}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/60">
                  {t("chat.leadNote")}
                </p>
                <div className="mt-2.5 space-y-2">
                  <Field
                    label={t("chat.leadName")}
                    value={name}
                    onChange={setName}
                    autoComplete="name"
                  />
                  <Field
                    label={t("chat.leadEmail")}
                    value={email}
                    onChange={setEmail}
                    type="email"
                    autoComplete="email"
                    invalid={emailLooksWrong}
                  />
                  <Field
                    label={t("chat.leadPhone")}
                    value={phone}
                    onChange={setPhone}
                    type="tel"
                    autoComplete="tel"
                  />
                </div>
                {leadError && (
                  <p className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {leadError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={saveLead}
                  disabled={saving || !canSave}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-3 py-2 text-xs font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {saving ? t("chat.leadSaving") : t("chat.leadSave")}
                </button>
              </div>
            )}

            {saved && (
              <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-800">
                <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("chat.leadSaved")}
              </p>
            )}
          </div>

          <div className="border-t border-brand-line px-4 py-3">
            {turns.length <= 3 && starters.length > 0 && !busy && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {starters.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void send(t(key))}
                    className="rounded-full border border-brand-line bg-brand-cream px-2.5 py-1 text-[11px] font-semibold text-brand-ink/70 transition hover:bg-brand-sand hover:text-brand-ink"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={input}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void send();
                  }
                }}
                maxLength={800}
                placeholder={t("chat.placeholder")}
                aria-label={t("chat.placeholder")}
                className="min-w-0 flex-1 rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-[13px] outline-none transition placeholder:text-brand-ink/40 focus:border-brand-gold"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || draft.trim().length === 0}
                aria-label={t("chat.send")}
                className="shrink-0 rounded-xl bg-brand-ink p-2.5 text-brand-cream transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {!saved && (
              <button
                type="button"
                onClick={() => setLeadOpen((current) => !current)}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-gold-dark transition hover:text-brand-ink"
              >
                <UserRoundSearch className="h-3.5 w-3.5" aria-hidden />
                {leadOpen ? t("chat.leadCancel") : t("chat.lead")}
              </button>
            )}
          </div>
        </section>
      )}

      {!open && (
        <button
          type="button"
          onClick={greet}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-brand-ink px-4 py-3 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          {t(jobId ? "chat.openRole" : "chat.openBoard")}
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  autoComplete?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-[13px] outline-none transition focus:border-brand-gold",
          invalid ? "border-rose-300" : "border-brand-line"
        )}
      />
    </label>
  );
}
