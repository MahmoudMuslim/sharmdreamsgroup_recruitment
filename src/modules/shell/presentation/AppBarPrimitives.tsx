"use client";

import { cn } from "@/lib/utils";

export type Panel = "search" | "guide" | "alerts" | "account" | null;

/* -------------------------------------------------------------------------- */
/* Bar pieces                                                                 */
/* -------------------------------------------------------------------------- */

export function BarButton({
  label,
  active,
  onClick,
  children,
  badge,
  keyName,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  /** The key that opens this panel. Named on the button so the hint is the same one the bar answers to. */
  keyName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label} (${badge})` : label}
      aria-expanded={active}
      aria-haspopup="dialog"
      aria-keyshortcuts={keyName?.replace("Ctrl", "Control")}
      title={keyName ? `${label} — press ${keyName}` : label}
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition",
        active
          ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold-dark"
          : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink"
      )}
    >
      {children}
      {badge && badge > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-brand-on-accent"
          aria-hidden
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A dropdown hanging from the bar.
 *
 * All four panels stay mounted and are hidden rather than unmounted: the search
 * box keeps its typed term and the account panel keeps the profile it already
 * read, so reopening one is instant instead of another round trip.
 */
export function PanelShell({
  id,
  open,
  label,
  width = "w-[min(92vw,420px)]",
  maxHeight = "max-h-[min(72vh,560px)]",
  side = "right",
  children,
}: {
  id: Exclude<Panel, null>;
  open: Panel;
  label: string;
  width?: string;
  /** The Guide carries a manual beside a list, so it needs more room than a feed. */
  maxHeight?: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      id={`appbar-${id}`}
      aria-label={label}
      className={cn(
        "rail-scroll absolute top-full mt-2 overflow-y-auto overscroll-contain rounded-2xl border border-brand-line bg-brand-cream p-4 shadow-lift",
        maxHeight,
        width,
        side === "right" ? "right-0" : "left-0",
        open !== id && "hidden"
      )}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/45">
        {children}
      </h2>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">{note}</p>}
    </div>
  );
}

/** A key drawn as a key — the only place a shortcut is legible to a recruiter. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-md border border-brand-line bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-brand-ink/70">
      {children}
    </kbd>
  );
}

export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-brand-line bg-white text-brand-ink/55"
      )}
    >
      {children}
    </p>
  );
}
