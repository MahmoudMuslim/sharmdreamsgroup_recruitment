"use client";

import { useState } from "react";
import { Check, Clock, Loader2, X } from "lucide-react";
import type { OfferStanding } from "@/modules/offers/domain/offer";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { answerOffer, type OfferDoorDescription } from "./actions";

type Described = Extract<OfferDoorDescription, { ok: true }>;

/**
 * The two answers, and the sentence that stands in for them when answering is no
 * longer possible.
 *
 * The server decides whether an answer counts; this component only sends the
 * choice and shows the sentence that comes back. A refusal is not retried
 * automatically and the buttons are hidden afterwards, so a deadline that passed
 * between the page loading and the click cannot invite a second click on an
 * offer that will keep refusing.
 */
export function OfferDoor({
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

  const [standing, setStanding] = useState<OfferStanding | null>(
    description?.standing ?? null
  );
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function answer(input: { decision: "accept" | "decline" }) {
    if (!token) return;
    setBusy(input.decision);
    setOutcome(null);
    try {
      const result = await answerOffer({ token, decision: input.decision });
      setOutcome({ ok: result.ok, text: result.message });
      setSettled(true);
      if (result.ok) setStanding(input.decision === "accept" ? "accepted" : "declined");
    } catch {
      setOutcome({ ok: false, text: t("offer.unreachable") });
      setSettled(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-brand-line bg-white p-6 shadow-soft sm:p-8">
      {description ? (
        <>
          <p className="text-sm text-brand-ink/70">
            {t("offer.for")} <span className="font-bold">{description.fullName}</span>
          </p>
          {description.jobTitle && (
            <p className="mt-0.5 text-xs text-brand-ink/55">{description.jobTitle}</p>
          )}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-ink/50">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("offer.deadline", { date: description.expiresOn })}
          </p>

          {standing !== "open" && !outcome && (
            <div className="mt-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
              {(standing === "accepted" || standing === "declined") && (
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                  {t("offer.answered")}
                </p>
              )}
              <p className="mt-1 text-sm leading-relaxed text-brand-ink/70">
                {standing === "accepted"
                  ? t("offer.accepted")
                  : standing === "declined"
                    ? t("offer.declined")
                    : standing === "withdrawn"
                      ? t("offer.withdrawn")
                      : t("offer.expired")}
              </p>
            </div>
          )}

          {standing === "open" && !settled && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void answer({ decision: "accept" })}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "accept" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" aria-hidden />
                )}
                {busy === "accept" ? t("offer.sending") : t("offer.accept")}
              </button>
              <button
                type="button"
                onClick={() => void answer({ decision: "decline" })}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-5 py-2.5 text-sm font-bold text-brand-ink/75 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "decline" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <X className="h-4 w-4" aria-hidden />
                )}
                {busy === "decline" ? t("offer.sending") : t("offer.decline")}
              </button>
            </div>
          )}

          {outcome && (
            <p
              role="status"
              className={cn(
                "mt-4 rounded-xl border px-4 py-3 text-sm leading-relaxed",
                outcome.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              )}
            >
              {outcome.text}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          {problem ?? t("offer.noToken")}
        </p>
      )}
    </div>
  );
}
