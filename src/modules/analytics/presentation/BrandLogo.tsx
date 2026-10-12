import { cn } from "@/lib/utils";

/**
 * Official Sharm Dreams Group wordmark, served from `/sdg-icon.png`
 * (the same asset used on sharmdreamsgroup.com).
 *
 * `tone` controls the backdrop behind the mark:
 *  - `ink`   gold mark on the group's near-black (default)
 *  - `cream` gold mark on ivory, for light surfaces
 */
export function SdgMark({
  size = 36,
  tone = "ink",
  className,
}: {
  size?: number;
  tone?: "ink" | "cream";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl",
        tone === "ink" ? "bg-brand-ink" : "border border-brand-line bg-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* next/image optimisation is unnecessary for a tiny, static asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/sdg-icon.png"
        alt="Sharm Dreams Group"
        width={size}
        height={size}
        className="h-full w-full scale-[1.02] object-contain"
      />
    </span>
  );
}

/**
 * Mark + wordmark lockup used in headers and the admin side panel.
 * Collapses to the mark alone on the narrowest screens.
 */
export function SdgLockup({
  subtitle = "Sharm Dreams Group",
  className,
  markClassName,
  compact = false,
}: {
  subtitle?: string;
  className?: string;
  markClassName?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <SdgMark size={compact ? 34 : 38} className={markClassName} />
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-bold leading-tight">
            Talent Cloud
          </span>
          <span className="block truncate text-[11px] leading-tight text-brand-ink/50">
            {subtitle}
          </span>
        </span>
      )}
    </div>
  );
}