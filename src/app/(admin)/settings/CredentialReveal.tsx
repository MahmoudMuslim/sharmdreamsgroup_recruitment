"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

/**
 * Shows a generated credential exactly once.
 *
 * The password exists only in this client's state: it is never written to a
 * table, the audit log or the URL, so dismissing the panel is the only way to
 * lose it, and re-issuing is the only recovery. Selecting the field is the
 * manual fallback for browsers that block the clipboard.
 */
export function CredentialReveal({
  label,
  password,
  onDismiss,
}: {
  label: string;
  password: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyBlocked, setCopyBlocked] = useState(false);

  function copy() {
    navigator.clipboard.writeText(password).then(
      () => setCopied(true),
      () => setCopyBlocked(true)
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-brand-line bg-brand-cream p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        {label}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={password}
          onFocus={(e) => e.target.select()}
          aria-label={label}
          className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-ink/50 transition hover:bg-white hover:text-brand-ink"
        >
          Done
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/50">
        {copyBlocked
          ? "Your browser blocked the copy — select the text above and copy it by hand. "
          : ""}
        Hand this to them over a channel you both trust. It is shown once and is not
        stored, so generate a new one if it is lost.
      </p>
    </div>
  );
}
