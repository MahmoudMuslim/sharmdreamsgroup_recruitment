import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page-level heading used at the top of every admin screen. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-ink/60 sm:text-base">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>}
    </header>
  );
}

/**
 * Elevated card with the group's warm, low-contrast surface treatment.
 *
 * `min-w-0` is load-bearing: a card is usually a grid or flex item, and an item's
 * automatic minimum size is its content's minimum, so one figure that cannot
 * break (a table, a long permission name) would widen the track past the screen
 * and send the whole page scrolling sideways.
 */
export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border border-brand-line bg-white shadow-soft transition",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  meta,
  className,
}: {
  title: string;
  meta?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-b border-brand-line px-5 py-4 sm:px-6",
        className
      )}
    >
      <h2 className="font-display text-base font-bold sm:text-lg">{title}</h2>
      {meta && <span className="text-xs text-brand-ink/45">{meta}</span>}
    </div>
  );
}

/** Primary call-to-action. */
export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        variant === "primary" &&
          "bg-brand-ink text-brand-cream shadow-soft hover:bg-brand-ink/90",
        variant === "outline" &&
          "border border-brand-line bg-white text-brand-ink hover:bg-brand-sand",
        variant === "ghost" && "text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Small status pill used for pipeline stages and badges. */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "success" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
        tone === "neutral" && "bg-brand-sand text-brand-ink/65",
        tone === "gold" && "bg-brand-gold/20 text-brand-gold-dark",
        tone === "success" && "bg-emerald-500/12 text-emerald-700",
        tone === "danger" && "bg-rose-500/12 text-rose-700",
        tone === "info" && "bg-sky-500/12 text-sky-700",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Horizontal progress track used by the fit-score and funnel visuals. */
export function Meter({
  value,
  max = 100,
  tone = "gold",
  className,
}: {
  value: number;
  max?: number;
  tone?: "gold" | "ink" | "success" | "danger";
  className?: string;
}) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-brand-sand", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700",
          tone === "gold" && "bg-gradient-to-r from-brand-gold-dark to-brand-gold-light",
          tone === "ink" && "bg-brand-ink",
          tone === "success" && "bg-gradient-to-r from-emerald-700 to-emerald-400",
          tone === "danger" && "bg-gradient-to-r from-rose-700 to-rose-400"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Empty-state block so data gaps never look like broken pages. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-brand-gold">{icon}</div>}
      <p className="font-display text-base font-bold">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-brand-ink/55">{description}</p>
      )}
    </div>
  );
}

/** Label + value pair used across the stats and detail panels. */
export function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
          {label}
        </p>
        <p className="mt-1.5 font-display text-3xl font-extrabold tracking-tight">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-brand-ink/50">{hint}</p>}
      </div>
      {icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          {icon}
        </span>
      )}
    </Card>
  );
}

/**
 * Filter pill carrying a live count, used by the rails on the candidates and
 * jobs boards. The count is the point of the control, so it is never hidden.
 */
export function FilterRail({
  label,
  count,
  active,
  onClick,
  tone = "solid",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "solid" | "muted";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={count === 0 && !active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? tone === "muted"
            ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
            : "border-brand-ink bg-brand-ink text-brand-cream"
          : "border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
          active
            ? tone === "muted"
              ? "bg-brand-gold/25 text-brand-gold-dark"
              : "bg-brand-on-accent/20 text-brand-cream"
            : "bg-brand-sand text-brand-ink/55"
        )}
      >
        {count}
      </span>
    </button>
  );
}