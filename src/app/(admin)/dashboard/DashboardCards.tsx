"use client";

import { type ReactNode } from "react";
import {
  ArrowUpRight,
  Filter,
  TrendingDown,
  TrendingUp,
  X
} from "lucide-react";
import {
  Card
} from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

/**
 * A headline number that answers "who is behind this?" when it is clicked.
 *
 * The whole card is the control, so the recruiter never hunts for a link hidden
 * in a corner — and a card only gets a click target when there is a read that
 * can genuinely list the rows behind the figure.
 */
export function Tile({
  label,
  value,
  hint,
  icon,
  delta,
  detail,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
  delta?: { value: number; label: string } | null;
  /** What the popup will show, e.g. "Every live application". */
  detail?: string;
  onClick?: () => void;
}) {
  const up = (delta?.value ?? 0) > 0;
  return (
    <Card className={cn("group relative p-5", onClick && "hover:border-brand-gold hover:shadow-soft")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
          {label}
        </p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-3xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-brand-ink/50">{hint}</p>}
      {delta && delta.value !== 0 && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            up ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-700"
          )}
        >
          {up ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          {up ? "+" : ""}
          {delta.value}
          {delta.label}
        </p>
      )}
      {onClick && detail && (
        <p className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/35 transition group-hover:text-brand-gold-dark">
          {detail}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </p>
      )}
      {onClick && (
        // Last in the DOM, so the whole card is one click target and the text
        // above it stays selectable-looking rather than half-interactive.
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}: ${detail}`}
          className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        />
      )}
    </Card>
  );
}

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold bg-brand-gold/15 py-1 pl-2.5 pr-1 text-[11px] font-bold uppercase tracking-wide text-brand-gold-dark">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label} filter`}
        className="rounded-full p-0.5 transition hover:bg-brand-gold/25"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/** Small strip at the bottom of a card that carries its next step. */
export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-line bg-brand-cream px-5 py-3 sm:px-6">
      {children}
    </div>
  );
}

export function GhostAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60 transition hover:bg-brand-sand hover:text-brand-ink"
    >
      {children}
    </button>
  );
}

/** The one control every chart row shares: narrow the board under the charts. */
export function BoardFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      aria-label={active ? `Board is filtered to ${label}` : `Filter the board to ${label}`}
      title={active ? `Board is filtered to ${label}` : `Filter the board to ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition",
        active
          ? "border-brand-gold bg-brand-gold/20 text-brand-gold-dark"
          : "border-brand-line bg-white text-brand-ink/50 hover:bg-brand-sand hover:text-brand-ink"
      )}
    >
      <Filter className="h-3 w-3" aria-hidden />
      {active ? "Filtered" : "Filter"}
    </button>
  );
}
