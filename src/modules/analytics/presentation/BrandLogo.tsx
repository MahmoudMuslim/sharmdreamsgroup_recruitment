import { cn } from "@/lib/utils";

/**
 * Official Sharm Dreams Group wordmark. The pixels come from
 * `/api/branding/logo`, which redirects to the path set under
 * Settings → Organisation & branding and falls back to `/sdg-icon.png`
 * (the same asset used on sharmdreamsgroup.com).
 *
 * `tone` controls the backdrop behind the mark:
 *  - `transparent` no backdrop at all — the mark sits directly on whatever
 *                  is behind it (default; the asset carries its own spacing)
 *  - `ink`         gold mark on the group's near-black
 *  - `cream`       gold mark on ivory, for light surfaces
 */
export function SdgMark({
  size = 36,
  tone = "transparent",
  className,
}: {
  size?: number;
  tone?: "ink" | "cream" | "transparent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl",
        tone === "ink" && "bg-brand-ink",
        tone === "cream" && "border border-brand-line bg-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* next/image optimisation is unnecessary for a tiny, static asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/api/branding/logo"
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
  markTone = "transparent",
  compact = false,
}: {
  subtitle?: string;
  className?: string;
  markClassName?: string;
  markTone?: "ink" | "cream" | "transparent";
  compact?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <SdgMark size={compact ? 34 : 38} tone={markTone} className={markClassName} />
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