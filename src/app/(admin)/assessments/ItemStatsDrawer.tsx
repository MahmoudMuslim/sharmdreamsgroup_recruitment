"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { getTemplateItemStats, type ItemStatsResult } from "./actions";
import { MIN_ITEM_STATISTICS } from "@/modules/assessment/domain/itemStats";
import type { TemplateItemStats } from "@/modules/assessment/application/templateItemStats";
import { cn } from "@/lib/utils";

/**
 * The suite-level counts.
 *
 * Only the last one is an opinion, and it is a count: how many questions the
 * weakest papers out-earned the strongest on. Those are the items a person wants
 * to re-read first, and naming them a number keeps the judgement with the reader.
 */
function SummaryTiles({ stats }: { stats: TemplateItemStats }) {
  const flagged = stats.items.filter(
    (item) => item.discrimination_pct_points !== null && item.discrimination_pct_points < 0
  ).length;
  const tiles = [
    { label: "Questions", value: stats.items.length.toLocaleString() },
    { label: "Graded papers", value: stats.papers.toLocaleString() },
    { label: "Graded answers", value: stats.answers.read.toLocaleString() },
    { label: "Reversed items", value: flagged === 0 ? "none" : `${flagged} of ${stats.items.length}` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cn(
            "rounded-xl border px-3 py-2.5",
            tile.label === "Reversed items" && flagged > 0
              ? "border-amber-200 bg-amber-50"
              : "border-brand-line bg-brand-cream"
          )}
        >
          <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
            {tile.label}
          </dt>
          <dd className="mt-0.5 font-display text-base font-bold">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A figure, or the honest blank its counts left behind. */
function Figure({ value, suffix, signed }: { value: number | null; suffix?: string; signed?: boolean }) {
  if (value === null) {
    return <span className="text-brand-ink/35">not claimed</span>;
  }
  const shown = `${signed && value > 0 ? "+" : ""}${value}${suffix ?? ""}`;
  return (
    <span
      className={cn(
        "font-display text-sm font-bold tabular-nums",
        signed && value < 0 && "text-amber-800"
      )}
    >
      {shown}
    </span>
  );
}

/**
 * How each question in this suite performed, over every graded paper it produced.
 *
 * Loaded when the drawer opens rather than with the grid: the two figures need
 * every graded answer of every paper the suite made, and a dozen cards would have
 * to fetch a dozen suites' worth of marks to draw.
 *
 * Nothing here calls a question hard, easy, good or bad. There is no target
 * difficulty stored anywhere in this portal, so the numbers print with the counts
 * they came from, and a question with too few graded answers to measure gets the
 * count instead of a figure — the same rule `benchmark.ts` applies to a percentile
 * taken from three papers.
 */
export function ItemStatsDrawer({
  templateId,
  templateName,
  onClose,
}: {
  templateId: string;
  templateName: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ItemStatsResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    getTemplateItemStats(templateId).then(
      (read) => {
        if (active) setResult(read);
      },
      () => {
        // A rejected action call is a session or transport failure, not a finding
        // about this suite's questions.
        if (active) {
          setResult({
            ok: false,
            reason: "failed",
            error: "The graded answers for this suite could not be read. Please retry.",
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [templateId, retry]);

  const stats = result?.ok ? result.stats : null;

  /** Cleared from the click, not from the effect, so the read never re-renders twice. */
  function reload() {
    setResult(null);
    setRetry((n) => n + 1);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      eyebrow="Assessment engine"
      title={`Item statistics — ${templateName}`}
      subtitle="Difficulty and top-versus-bottom discrimination for every question in this suite."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-brand-ink/50">
            A question needs at least {MIN_ITEM_STATISTICS.toLocaleString()} graded answers before a
            figure is claimed for it.
          </p>
          <button
            type="button"
            onClick={reload}
            disabled={!result}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Reload
          </button>
        </div>
      }
    >
      {!result && (
        <p className="flex items-center gap-2 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Reading every graded answer in this suite…
        </p>
      )}

      {result && !result.ok && (
        <p
          role={result.reason === "failed" ? "alert" : "status"}
          className={cn(
            "rounded-xl border px-3.5 py-3 text-xs leading-relaxed",
            result.reason === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-brand-line bg-brand-cream text-brand-ink/70"
          )}
        >
          {result.error}
        </p>
      )}

      {stats && (
        <div className="space-y-4">
          <SummaryTiles stats={stats} />

          {stats.partial && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                This suite holds {stats.answers.on_file.toLocaleString()} graded answers and the read
                stopped at {stats.answers.read.toLocaleString()}, so the figures below cover the
                answers that were read, not the whole suite.
              </span>
            </p>
          )}

          <ol className="space-y-3">
            {stats.items.map((item, index) => (
              <li
                key={item.question_id}
                className="rounded-xl border border-brand-line bg-white px-4 py-3.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    <span className="mr-2 text-xs font-bold text-brand-ink/40 tabular-nums">
                      {index + 1}
                    </span>
                    {item.title}
                  </p>
                  <p className="text-[11px] text-brand-ink/45">
                    {item.answers.toLocaleString()} graded answer{item.answers === 1 ? "" : "s"}
                  </p>
                </div>

                <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-brand-ink/50">Difficulty</dt>
                    <dd>
                      <Figure value={item.difficulty_pct} suffix="%" />
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-brand-ink/50">Strongest papers</dt>
                    <dd>
                      <Figure value={item.top_pct} suffix="%" />
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-brand-ink/50">Weakest papers</dt>
                    <dd>
                      <Figure value={item.bottom_pct} suffix="%" />
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-brand-ink/50">Discrimination</dt>
                    <dd>
                      <Figure value={item.discrimination_pct_points} suffix=" pts" signed />
                    </dd>
                  </div>
                </dl>

                <p className="mt-2.5 text-[11px] leading-relaxed text-brand-ink/60">{item.note}</p>
              </li>
            ))}
          </ol>

          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            Difficulty is the share of the points on offer that candidates actually earned.
            Discrimination is the gap, in percentage points of that question, between the highest-scoring
            papers of this suite and the lowest-scoring ones; the papers are ranked on their own mark total,
            so a suite re-weighted mid-flight still ranks fairly. A negative gap is a flag on the question —
            the weakest papers out-earned the strongest on it.
          </p>
        </div>
      )}
    </Drawer>
  );
}
