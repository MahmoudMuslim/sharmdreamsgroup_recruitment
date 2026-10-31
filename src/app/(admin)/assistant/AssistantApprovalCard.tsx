"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantApproval } from "@/modules/assistant/domain/approvals";

/**
 * The change the assistant wants to make, held until a person agrees to it.
 *
 * Nothing runs on the model's say-so: this card is the only way a chat write
 * reaches the database. The values on it are the ones the server holds for this
 * id, so what is described is exactly what the click applies — and ignoring it
 * is a real option, which is why the card says what ignoring does.
 *
 * When the card carries a code, the code is printed and must be typed. It is a
 * challenge against a stray or overheard word, not a secret kept from the
 * browser, which is why showing it here is honest rather than leaky. A card
 * minted for `open` says so, because "this runs on a spoken yes" is the one thing
 * about it a person must know before turning away.
 */
export function ApprovalCard({
  approval,
  live,
  busy,
  onApprove,
}: {
  approval: AssistantApproval;
  live: boolean;
  busy: boolean;
  onApprove: (approval: AssistantApproval, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const needsCode = typeof approval.code === "string" && approval.code.length > 0;

  return (
    <div
      className={cn(
        "mt-1.5 rounded-xl border p-2.5",
        approval.destructive ? "border-rose-200 bg-rose-50/70" : "border-brand-gold bg-brand-gold/10"
      )}
    >
      <p
        className={cn(
          "text-[10px] font-bold uppercase tracking-wide",
          approval.destructive ? "text-rose-700" : "text-brand-gold-dark"
        )}
      >
        {approval.destructive ? "Delete waiting for you" : "Change waiting for you"}
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug text-brand-ink">{approval.label}</p>
      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-brand-ink/65">
        {approval.summary}
      </p>
      {approval.autonomy === "open" && (
        <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-rose-700">
          Hands-free: this console may run it on the one click it sends after it hears you say
          approve.
        </p>
      )}
      {needsCode && (
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-lg border border-brand-line bg-white px-2 py-1 font-mono text-sm font-bold tracking-[0.3em] text-brand-ink">
            {approval.code}
          </code>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            aria-label="Approval code"
            placeholder="Type the code"
            maxLength={12}
            className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 font-mono text-xs uppercase tracking-widest outline-none focus:border-brand-gold"
          />
        </div>
      )}
      {live ? (
        <>
          <button
            type="button"
            onClick={() => onApprove(approval, code)}
            disabled={busy || (needsCode && code.trim().length === 0)}
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition",
              "disabled:cursor-not-allowed disabled:opacity-50",
              approval.destructive
                ? "bg-rose-600 text-brand-on-accent hover:bg-rose-700"
                : "bg-brand-gold text-brand-ink hover:bg-brand-gold/70"
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "Applying…" : approval.destructive ? "Approve the delete" : "Approve & run"}
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/45">
            {`Ignoring this leaves the record exactly as it is. The offer expires at ${new Date(
              approval.expiresAt
            ).toLocaleString("en-GB")}.`}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/40">
          {
            "No longer clickable — either you answered it below, or the conversation has moved past it."
          }
        </p>
      )}
    </div>
  );
}
