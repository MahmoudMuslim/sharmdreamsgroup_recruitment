"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock,
  CornerUpLeft,
  ExternalLink,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantLink } from "@/modules/assistant/domain/links";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";

/** The headline of a failure, kept to one readable line. */
const MAX_HEADLINE_CHARS = 180;

/**
 * What to do next, read off what the server actually reported.
 *
 * A guessed instruction sends a recruiter hunting for a settings switch that is
 * not the problem, so anything unrecognised falls back to the one sentence that
 * is always true here: a failed turn changed nothing.
 */
function nextStepFor(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("429") || text.includes("rate") || text.includes("quota")) {
    return "That provider has spent its allowance for the moment. Pick another model below, or wait a minute and send it again.";
  }
  if (
    text.includes("502") ||
    text.includes("503") ||
    text.includes("overload") ||
    text.includes("unavailable") ||
    text.includes("timeout")
  ) {
    return "That provider is not answering right now. Send it again, or choose a different model below.";
  }
  if (text.includes("key") || text.includes("credential") || text.includes("token")) {
    return "Settings → API keys holds the credential this answer needed — check it is there and verified.";
  }
  if (text.includes("model")) {
    return "Choose another model below, or leave it on default routing, which uses the one named in Settings → AI models.";
  }
  if (text.includes("approval")) {
    return "Nothing has changed. Ask for the same change again and the card goes back up.";
  }
  if (text.includes("conversation")) {
    return "The conversation itself is still stored — try opening it again, or start a new one.";
  }
  if (text.includes("ask me something")) {
    return "Type the question in the box below, then send it.";
  }
  return "Nothing was changed by this. Send the question again, or ask for a smaller piece of it.";
}

/**
 * A failure the operator can read and act on.
 *
 * The gateway reports every provider hop it tried, which is the right thing for
 * diagnosing an outage and far too much to read in a chat bubble — so the first
 * hop is the headline, the rest sits behind a disclosure, and the line under it
 * names the next move rather than leaving the panel looking broken.
 */
export function FailureNote({
  tone = "hard",
  message,
  hint,
  action,
}: {
  tone?: "hard" | "soft";
  message: string;
  /** Overrides the read-off next step when the caller knows better. */
  hint?: string;
  action?: { label: string; run: () => void } | null;
}) {
  const hops = message.split(" | ");
  const headline =
    hops[0].length <= MAX_HEADLINE_CHARS ? hops[0] : `${hops[0].slice(0, MAX_HEADLINE_CHARS)}…`;
  const raw = hops.slice(1).join(" | ").trim();

  return (
    <div
      role="alert"
      className={cn(
        "mb-2 rounded-xl border p-2.5",
        tone === "hard" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"
      )}
    >
      <p
        className={cn(
          "flex items-start gap-1.5 text-xs font-bold leading-snug",
          tone === "hard" ? "text-rose-700" : "text-amber-700"
        )}
      >
        {tone === "hard" ? (
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0">{headline}</span>
      </p>
      <p className="mt-1 pl-5 text-[11px] leading-relaxed text-brand-ink/65">{hint ?? nextStepFor(message)}</p>

      {raw && (
        <details className="mt-1 pl-5">
          <summary className="cursor-pointer text-[10px] font-semibold text-brand-ink/45">
            What the server reported
          </summary>
          <pre className="rail-scroll mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[10px] font-medium leading-relaxed text-brand-ink/60">
            {message}
          </pre>
        </details>
      )}

      {action && (
        <button
          type="button"
          onClick={action.run}
          className="mt-1.5 ml-5 inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[10px] font-bold text-brand-ink/65 transition hover:bg-brand-sand"
        >
          <CornerUpLeft className="h-3 w-3" aria-hidden />
          {action.label}
        </button>
      )}
    </div>
  );
}

function StepChip({ step }: { step: AssistantStep }) {
  const router = useRouter();
  const link: AssistantLink | null = step.link ?? null;
  // A held write is not a failed one. Rendering it in rose would tell the
  // recruiter the action went wrong, when the truth is that it has not run yet.
  const tone = step.approval ? "waiting" : step.ok ? "done" : "failed";

  return (
    <li className="flex items-center gap-1">
      <span
        title={step.detail}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          tone === "done" && "border-brand-line bg-white text-brand-ink/60",
          tone === "waiting" && "border-amber-200 bg-amber-50 text-amber-700",
          tone === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
        )}
      >
        {tone === "done" ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : tone === "waiting" ? (
          <Clock className="h-3 w-3" aria-hidden />
        ) : (
          <AlertTriangle className="h-3 w-3" aria-hidden />
        )}
        {step.label}
      </span>
      {link && (
        <button
          type="button"
          onClick={() => router.push(link.href)}
          title={link.href}
          className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-gold/15 px-2 py-0.5 text-[11px] font-bold text-brand-gold-dark transition hover:bg-brand-gold/30"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {link.label}
        </button>
      )}
    </li>
  );
}

export function StepChips({ steps }: { steps: AssistantStep[] }) {
  if (steps.length === 0) return null;

  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5">
      {steps.map((step, index) => (
        <StepChip key={`${step.tool}-${index}`} step={step} />
      ))}
    </ul>
  );
}
