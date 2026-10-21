"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  RefreshCw
} from "lucide-react";
import {
  Badge,
  EmptyState
} from "@/modules/analytics/presentation/ui";
import { formatDateTime } from "@/lib/utils";
import {
  getDashboardDrilldown,
  type DashboardDrillResult,
  type DashboardDrillRow,
  type DashboardDrillScope
} from "./actions";
import { prettyStage, shortDate, stageTone } from "./DashboardBits";
import { GhostAction } from "./DashboardCards";

/**
 * The rows behind one dashboard figure, read from the database on open.
 *
 * The board under the charts only ships 200 applications, and every figure here
 * counts all of them, so a popup that names a total has to re-read rather than
 * count the rows the browser happens to be holding.
 */
export function DrillPanel({ scope, masked }: { scope: DashboardDrillScope; masked: boolean }) {
  const [result, setResult] = useState<DashboardDrillResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    getDashboardDrilldown(scope).then(
      (next) => {
        if (active) setResult(next);
      },
      () => {
        // A rejected action call is a session or transport failure, not a
        // recruiter error, so it reads the same as a retry would.
        if (active) setResult({ ok: false, error: "These applications could not be read. Please retry." });
      }
    );
    return () => {
      active = false;
    };
  }, [scope, retry]);

  function reload() {
    setResult(null);
    setRetry((count) => count + 1);
  }

  if (!result) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-brand-ink/55">
        <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
        Reading the applications behind this figure…
      </p>
    );
  }

  if (!result.ok) {
    return (
      <div className="space-y-3 py-2">
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-800">
          {result.error}
        </p>
        <GhostAction onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </GhostAction>
      </div>
    );
  }

  const { rows, total, shown, read_at } = result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5">
        <p className="text-sm" aria-live="polite">
          <strong className="font-display text-base font-extrabold">
            {total.toLocaleString()}
          </strong>{" "}
          application{total === 1 ? "" : "s"}
          <span className="text-[11px] text-brand-ink/50">
            {" "}
            · {shown < total ? `first ${shown} listed` : "all listed"} · read{" "}
            {formatDateTime(read_at)}
          </span>
        </p>
        <GhostAction onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Recount
        </GhostAction>
      </div>

      {/* Filed records are never part of a dashboard count, so say what is not
          in the list rather than let a missing name look like a bug. */}
      {total === 0 ? (
        <EmptyState
          title="Nothing matches this yet"
          description="Filed-away records are excluded, so an empty list means the pipeline genuinely holds none."
        />
      ) : (
        <>
          {scope.type !== "stage" && rows.length > 1 && <StageStrip rows={rows} />}
          <ul className="divide-y divide-brand-line">
            {rows.map((row) => (
              <DrillRow key={row.application_id} row={row} masked={masked} />
            ))}
          </ul>
          {shown < total && (
            <p className="text-[11px] text-brand-ink/45">
              The {shown} most recent are listed — use the candidates board search to reach the
              rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Stage mix of the rows on screen, so a popup is scannable before it is read. */
function StageStrip({ rows }: { rows: DashboardDrillRow[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
  const steps = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
        Of these {rows.length}
      </span>
      {steps.map(([stage, count]) => (
        <Badge key={stage} tone={stageTone(stage)}>
          {prettyStage(stage)} · {count}
        </Badge>
      ))}
    </div>
  );
}

function DrillRow({ row, masked }: { row: DashboardDrillRow; masked: boolean }) {
  const clock =
    row.days_to_hire !== null
      ? `${row.days_to_hire}d to hire`
      : row.waiting_days !== null
        ? `waiting ${row.waiting_days}d`
        : row.hired_at
          ? `hired ${shortDate(row.hired_at)}`
          : "closed";

  return (
    <li className="group flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          href={`/candidates/${row.application_id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-brand-gold-dark hover:underline"
        >
          {row.full_name}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100" aria-hidden />
        </Link>
        <p className="truncate text-[11px] text-brand-ink/45">
          {row.email} · {row.tracking_code}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-brand-ink/55">
          {row.job_title || "—"} · {prettyStage(row.source)} · applied {shortDate(row.applied_at)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Badge tone={stageTone(row.stage)}>{prettyStage(row.stage)}</Badge>
        <p className="mt-1.5 text-[11px] font-bold text-brand-ink/55">{clock}</p>
        {!masked && (
          <p className="mt-0.5 text-[11px] text-brand-gold-dark">
            {row.match_score === null ? "unscored" : `${row.match_score}% fit`}
            {row.has_assessment &&
              ` · ${row.assessment_score === null ? "assessment" : `score ${row.assessment_score}`}`}
          </p>
        )}
      </div>
    </li>
  );
}
