"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, Mail, Undo2, XCircle } from "lucide-react";
import { Badge, Button } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, TextInput } from "@/modules/analytics/presentation/Form";
import { formatInZone } from "@/lib/timezone";
import {
  OFFER_DEFAULT_DAYS,
  OFFER_MAX_DAYS,
  OFFER_MIN_DAYS,
  offerStateLabel,
  type OfferStanding,
} from "@/modules/offers/domain/offer";
import {
  confirmOfferHire,
  issueOffer,
  readOfferPanel,
  withdrawOffer,
  type OfferPanelState,
} from "./offer-actions";

/**
 * The drawer's offer desk.
 *
 * An offer is a document with a deadline, so this panel reads the newest one and
 * shows what can still be done to it. Issuing mails the letter with the answer
 * link and records the offer; withdrawing closes an unanswered offer, including
 * one past its deadline, which the record still counts as open; confirming a hire
 * is offered only once the candidate has accepted, and it uses the same stage
 * writer the pipeline does.
 *
 * The panel lives at the OFFER stage because that is where an offer is worked on.
 * A recruiter moves the candidate there with the pipeline chips first; issuing
 * from here then sends the letter again, this time with the link.
 */
export function OfferPanel({
  applicationId,
  candidateName,
  timeZone,
}: {
  applicationId: string;
  candidateName: string;
  timeZone: string;
}) {
  const router = useRouter();

  const [panel, setPanel] = useState<OfferPanelState | null>(null);
  const [days, setDays] = useState(String(OFFER_DEFAULT_DAYS));
  const [busy, setBusy] = useState<"issue" | "withdraw" | "hire" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    const state = await readOfferPanel(applicationId);
    setPanel(state);
  }, [applicationId]);

  useEffect(() => {
    let live = true;
    void readOfferPanel(applicationId).then((state) => {
      if (live) setPanel(state);
    });
    return () => {
      live = false;
    };
  }, [applicationId]);

  async function issue() {
    setBusy("issue");
    setError(null);
    setDone(null);
    setWarning(null);
    try {
      const result = await issueOffer({ applicationId, days });
      if (result.ok) {
        setDone(
          `Offer sent to ${result.recipient ?? candidateName}, open until ${result.expiresOn}.`
        );
        if (result.warning) setWarning(result.warning);
        await load();
        router.refresh();
      } else {
        setError(result.error ?? "The offer could not be sent.");
      }
    } catch {
      setError("Something went wrong sending the offer.");
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(offerId: string) {
    setBusy("withdraw");
    setError(null);
    setDone(null);
    setWarning(null);
    try {
      const result = await withdrawOffer({ applicationId, offerId });
      if (result.ok) {
        setDone("The offer was withdrawn. The candidate is still in the pipeline.");
        await load();
        router.refresh();
      } else {
        setError(result.error ?? "The offer could not be withdrawn.");
      }
    } catch {
      setError("Something went wrong withdrawing the offer.");
    } finally {
      setBusy(null);
    }
  }

  async function hire() {
    setBusy("hire");
    setError(null);
    setDone(null);
    setWarning(null);
    try {
      const result = await confirmOfferHire({ applicationId });
      if (result.ok) {
        setDone(`${candidateName} is hired. The stage now reads Hired.`);
        await load();
        router.refresh();
      } else {
        setError(result.error ?? "The hire could not be confirmed.");
      }
    } catch {
      setError("Something went wrong confirming the hire.");
    } finally {
      setBusy(null);
    }
  }

  const offer = panel && panel.ok ? panel.offer : null;
  const standing: OfferStanding | null = panel && panel.ok ? panel.standing : null;
  const deadline = offer
    ? formatInZone(offer.expiresAt, timeZone, { dateStyle: "medium", timeStyle: "short" })
    : "";

  const tone =
    standing === "open"
      ? "gold"
      : standing === "accepted"
        ? "success"
        : standing === "declined"
          ? "danger"
          : "neutral";

  return (
    <section>
      <h3 className="mb-2 font-display text-sm font-bold">Offer</h3>

      {panel === null ? (
        <p className="flex items-center gap-1.5 text-xs text-brand-ink/45">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Reading the offer…
        </p>
      ) : !panel.ok ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {panel.error}
        </p>
      ) : offer ? (
        <div className="rounded-xl border border-brand-line bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{offerStateLabel(offer.state)}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-brand-ink/55">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {standing === "open" ? `Answer by ${deadline}` : `Deadline ${deadline}`}
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
            {standing === "open"
              ? "The candidate has the link. Answering records their choice; it does not move the stage."
              : standing === "accepted"
                ? "The candidate accepted. Confirming the hire is the desk's separate decision."
                : standing === "declined"
                  ? "The candidate declined. The stage stays at Offer — archive, reject or reopen with the pipeline chips as you see fit."
                  : standing === "withdrawn"
                    ? "This offer was withdrawn. Sending a new one below opens a fresh deadline."
                    : "The deadline has passed without an answer. Nothing was decided for anyone. Close the expired offer to clear the record before a new one can be sent."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {standing === "open" || standing === "expired" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void withdraw(offer.id)}
              >
                {busy === "withdraw" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                )}
                {standing === "expired" ? "Close the expired offer" : "Withdraw the offer"}
              </Button>
            ) : null}
            {standing === "accepted" && (
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                onClick={() => void hire()}
              >
                {busy === "hire" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                )}
                Confirm the hire
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-brand-ink/55">
          No offer has been sent from this panel yet. This drawer is at the Offer stage, so
          sending the link here mails the offer letter again — this time with the page the
          candidate answers from.
        </p>
      )}

      {panel?.ok &&
        (standing === null || standing === "withdrawn" || standing === "declined") && (
        <div className="mt-3 flex items-end gap-2">
          <Field
            label="Answer deadline (days)"
            htmlFor={`offer-days-${applicationId}`}
            hint={`${OFFER_MIN_DAYS}–${OFFER_MAX_DAYS} days. Expiry never decides for the candidate.`}
            className="w-32"
          >
            <TextInput
              id={`offer-days-${applicationId}`}
              type="number"
              min={OFFER_MIN_DAYS}
              max={OFFER_MAX_DAYS}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void issue()}
          >
            {busy === "issue" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Mail className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy === "issue" ? "Sending…" : "Send the offer link"}
          </Button>
        </div>
      )}

      {panel?.ok && standing === "declined" && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-brand-ink/40">
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          A new offer starts a fresh deadline and its own answer link; the declined one stays on
          the record.
        </p>
      )}

      {warning && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {warning}
        </p>
      )}
      <FormMessage error={error} success={done} />
    </section>
  );
}
