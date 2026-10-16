"use client";

import { Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { AssistantChart } from "@/modules/assistant/domain/charts";

/**
 * A tool result drawn as bars inside the assistant's answer.
 *
 * The figures on this card are the ones the read returned — the model chose
 * which series to show, not what any of them says — so the card is labelled with
 * its population, its scale and the mistake a reader would otherwise make. A
 * chart that hides its denominator is a claim, so none of these three are left
 * for the recruiter to infer.
 */

export function ReplyChart({ chart, className }: { chart: AssistantChart; className?: string }) {
  // A series whose every row is zero has a peak of 0, which is the truth the
  // card states. The bars still need a divisor, so they are drawn against one.
  const scaleBase = Math.max(chart.peak, 1);

  return (
    <figure
      className={cn(
        "rounded-xl border border-brand-line bg-white p-2.5 shadow-soft",
        className
      )}
    >
      <figcaption>
        <p className="font-display text-xs font-bold text-brand-ink">{chart.title}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-brand-ink/50">
          {chart.population} · counted in {chart.unit}
        </p>
      </figcaption>

      {chart.shape === "columns" ? (
        <ColumnsChart chart={chart} scaleBase={scaleBase} />
      ) : (
        <ul className="mt-2 space-y-1.5">
          {chart.rows.map((row, index) => (
            <li key={`${row.label}-${index}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 text-[11px] font-semibold">{row.label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-brand-ink/60">
                  {row.value.toLocaleString()}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
              </div>
              <Meter
                value={row.value}
                max={scaleBase}
                tone={row.tone}
                className="mt-1"
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] leading-snug text-brand-ink/45">
        {chart.scale}
        {chart.caveat ? `. ${chart.caveat}` : ""}
      </p>
    </figure>
  );
}

/**
 * A day-at-a-time series, too many rows for a list.
 *
 * Each column is one day's count against the busiest day, and every value is in
 * the text too — as a title on hover and in a screen-reader list — because a
 * shape nobody can read the numbers off is decoration.
 */
function ColumnsChart({ chart, scaleBase }: { chart: AssistantChart; scaleBase: number }) {
  const first = chart.rows[0];
  const last = chart.rows[chart.rows.length - 1];

  return (
    <>
      <div className="mt-2 flex h-14 items-end gap-[3px]">
        {chart.rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            title={`${row.label}: ${row.value} ${chart.unit}`}
            className={cn(
              "min-w-0 flex-1 rounded-t",
              row.value === 0 ? "bg-brand-sand" : "bg-gradient-to-t from-brand-gold-dark to-brand-gold-light"
            )}
            style={{ height: `${Math.max((row.value / scaleBase) * 100, 3)}%` }}
          />
        ))}
      </div>
      <p className="mt-1 flex justify-between text-[10px] tabular-nums text-brand-ink/45">
        <span>{first?.label}</span>
        <span>{chart.rows.length} days</span>
        <span>{last?.label}</span>
      </p>
      <ul className="sr-only">
        {chart.rows.map((row, index) => (
          <li key={`${row.label}-text-${index}`}>
            {row.label}: {row.value} {chart.unit}
          </li>
        ))}
      </ul>
    </>
  );
}
