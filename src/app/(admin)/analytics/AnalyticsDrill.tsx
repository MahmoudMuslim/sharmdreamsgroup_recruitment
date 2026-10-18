"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, Video } from "lucide-react";
import { getAnalyticsDrilldown } from "./actions";
import type {
  AnalyticsDrillResult,
  AnalyticsDrillScope,
  DrillAttempt,
  DrillMessage,
  DrillPanel as DrillPanelRow,
  DrillProspect,
} from "@/modules/analytics/infrastructure/analyticsDrill";
import { measuresDelivery } from "@/modules/analytics/domain/report";
import type { AnalyticsWindow, TrendBucket, TrendGrain } from "@/modules/analytics/domain/report";
import { Badge, EmptyState } from "@/modules/analytics/presentation/ui";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { formatInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const GRAIN_WORDS: Record<TrendGrain, string> = { day: "day", week: "week", month: "month" };

function stamp(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return formatInZone(iso, timeZone, { day: "numeric", month: "short" });
}

function clock(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return formatInZone(iso, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** When it happened and to the minute, when the clock is known. */
const when = (iso: string | null, timeZone: string): string => {
  const day = stamp(iso, timeZone);
  const at = clock(iso, timeZone);
  return at ? `${day} ${at}` : day;
};

function pretty(value: string): string {
  return value.replace(/_/g, " ");
}

function statusTone(status: string): "neutral" | "gold" | "success" | "danger" | "info" {
  const value = status.toUpperCase();
  if (value === "GRADED" || value === "COMPLETED" || value === "HIRED") return "success";
  if (value === "EXPIRED" || value === "NO_SHOW" || value === "REJECTED" || value === "CANCELLED")
    return "danger";
  if (value === "IN_PROGRESS" || value === "SCHEDULED" || value === "INTERVIEW" || value === "REPLIED")
    return "info";
  if (value === "CONVERTED" || value === "OFFER") return "gold";
  return "neutral";
}

const hours = (value: number | null): string | null =>
  value === null ? null : value < 24 ? `${value.toFixed(1)} h` : `${Math.round(value / 24)} d`;

const minutes = (value: number | null): string | null =>
  value === null ? null : value < 60 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} h`;

/* ------------------------------------------------------------ trend bars -- */

/**
 * A card's activity over the window, one bar per bucket.
 *
 * The buckets are continuous, so an empty week is a zero bar rather than a
 * flattering gap. A bar opens the popup for exactly its own date range, and a
 * bar with nothing in it is not a button: it cannot show what it does not hold.
 */
export function TrendStrip({
  buckets,
  grain,
  caption,
  onPick,
}: {
  buckets: TrendBucket[];
  grain: TrendGrain;
  caption: string;
  onPick: (bucket: TrendBucket) => void;
}) {
  if (buckets.length === 0) {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
        {caption} — nothing in this window carries a readable date, so there is no strip to draw.
      </p>
    );
  }

  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
        {caption}
        <span className="ml-1.5 font-normal normal-case tracking-normal text-brand-ink/40">
          per {GRAIN_WORDS[grain]} · {total.toLocaleString()} in all
        </span>
      </p>
      <div className="mt-2 flex h-14 items-end gap-[3px]" role="group" aria-label={caption}>
        {buckets.map((bucket) => {
          const empty = bucket.count === 0;
          const span =
            bucket.fromKey === bucket.toKey ? bucket.fromKey : `${bucket.fromKey} to ${bucket.toKey}`;
          return (
            <button
              key={bucket.key}
              type="button"
              disabled={empty}
              onClick={() => onPick(bucket)}
              title={
                empty ? `Nothing between ${span}` : `${bucket.count} between ${span} — open the list`
              }
              aria-label={
                empty ? `${bucket.count} between ${span}` : `${bucket.count} between ${span}, open rows`
              }
              className="group flex h-full min-w-[6px] flex-1 flex-col justify-end gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold"
            >
              <span
                className={cn(
                  "w-full rounded-t transition-all duration-500",
                  empty
                    ? "h-[3px] bg-brand-line"
                    : "bg-gradient-to-t from-brand-gold-dark to-brand-gold-light group-hover:from-brand-ink group-hover:to-brand-gold-dark"
                )}
                style={empty ? undefined : { height: `${Math.max(8, (bucket.count / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-brand-ink/40">
        <span>{buckets[0].fromKey}</span>
        <span>{buckets[buckets.length - 1].toKey}</span>
      </div>
    </div>
  );
}

/** A counted label — a status, a stage — that opens the rows carrying it. */
export function ChipRail({
  label,
  buckets,
  onPick,
}: {
  label: string;
  buckets: { label: string; count: number }[];
  onPick: (value: string) => void;
}) {
  if (buckets.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
        {label}
      </span>
      {buckets.map((bucket) => (
        <button
          key={bucket.label}
          type="button"
          onClick={() => onPick(bucket.label)}
          disabled={bucket.count === 0}
          title={`Open the ${bucket.count.toLocaleString()} rows at ${pretty(bucket.label)}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
            bucket.count === 0
              ? "cursor-not-allowed border-brand-line bg-white text-brand-ink/35"
              : "border-brand-line bg-white text-brand-ink/65 hover:border-brand-gold hover:bg-brand-sand"
          )}
        >
          {pretty(bucket.label)}
          <span className="tabular-nums text-brand-ink/45">{bucket.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ drill rows -- */

type Line = string | null | undefined | false;

function RowShell({
  title,
  href,
  lines,
  right,
}: {
  title: string;
  href?: string;
  lines: Line[];
  right: React.ReactNode;
}) {
  const detail = lines.filter((line): line is string => Boolean(line));
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        {href ? (
          <Link
            href={href}
            title="Open this record in its own page"
            className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-brand-gold-dark hover:underline"
          >
            <span className="truncate">{title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold">{title}</p>
        )}
        {detail.map((line) => (
          <p key={line} className="truncate text-[11px] text-brand-ink/50" title={line}>
            {line}
          </p>
        ))}
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </li>
  );
}

function AttemptRow({
  row,
  timeZone,
  masked,
}: {
  row: DrillAttempt;
  timeZone: string;
  masked: boolean;
}) {
  const open = hours(row.invite_to_open_hours);
  const sit = minutes(row.minutes_on_test);
  return (
    <RowShell
      title={row.candidate}
      href={row.application_id ? `/candidates/${row.application_id}` : undefined}
      lines={[
        [row.opening || "No opening on file", row.suite].filter(Boolean).join(" · "),
        [
          `invited ${when(row.invited_at, timeZone)}`,
          row.opened_at ? `opened ${when(row.opened_at, timeZone)}` : "never opened",
          row.submitted_at ? `submitted ${when(row.submitted_at, timeZone)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        [
          open ? `${open} to open` : null,
          sit ? `${sit} on the test` : null,
          row.score_percent !== null ? `${row.score_percent}% of the maximum` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ]}
      right={
        <>
          <Badge tone={statusTone(row.status)}>{pretty(row.status)}</Badge>
          {!masked && (
            <p className="mt-1.5 text-[11px] font-bold text-brand-gold-dark">
              {row.score_percent === null ? "unscored" : `${row.score_percent}%`}
            </p>
          )}
        </>
      }
    />
  );
}

function ProspectRow({ row, timeZone }: { row: DrillProspect; timeZone: string }) {
  return (
    <RowShell
      title={row.candidate}
      href={`/sourcing?prospect=${encodeURIComponent(row.id)}`}
      lines={[
        [row.headline, row.company, row.location].filter(Boolean).join(" · "),
        row.email ?? null,
        `${pretty(row.origin)} · added ${stamp(row.added_at, timeZone)} · ${row.messages} logged message${
          row.messages === 1 ? "" : "s"
        }`,
        row.first_message_at
          ? `first message ${stamp(row.first_message_at, timeZone)}${
              row.last_contacted_at && row.last_contacted_at !== row.first_message_at
                ? ` · last ${stamp(row.last_contacted_at, timeZone)}`
                : ""
            }`
          : "no message logged",
      ]}
      right={
        <>
          <Badge tone={statusTone(row.stage)}>{pretty(row.stage)}</Badge>
          {row.converted && (
            <p className="mt-1.5 text-[11px] font-bold text-emerald-700">
              {row.application_id ? "became an application" : "marked converted"}
            </p>
          )}
        </>
      }
    />
  );
}

function MessageRow({ row, timeZone }: { row: DrillMessage; timeZone: string }) {
  const href = row.application_id
    ? `/candidates/${row.application_id}`
    : row.prospect_id
      ? `/sourcing?prospect=${encodeURIComponent(row.prospect_id)}`
      : undefined;
  return (
    <RowShell
      title={row.recipient || "(no recipient on file)"}
      href={href}
      lines={[
        row.subject || "no subject",
        [
          row.candidate ? `to ${row.candidate}` : null,
          pretty(row.direction),
          `sent ${when(row.sent_at, timeZone)}`,
          row.read_at ? `read ${when(row.read_at, timeZone)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ]}
      right={
        <>
          <Badge tone={statusTone(row.channel)}>{pretty(row.channel)}</Badge>
          {measuresDelivery(row.channel) ? (
            <p
              className={cn(
                "mt-1.5 text-[11px] font-bold",
                row.delivered ? "text-emerald-700" : "text-rose-700"
              )}
            >
              {row.delivered ? "delivered" : "not delivered"}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] font-bold text-brand-ink/45">
              {row.read_at ? "read in the inbox" : "in the inbox"}
            </p>
          )}
          {row.error_message && (
            <p className="mt-0.5 max-w-[16rem] text-[10px] leading-relaxed text-rose-700">
              {row.error_message}
            </p>
          )}
        </>
      }
    />
  );
}

function PanelRow({ row, timeZone }: { row: DrillPanelRow; timeZone: string }) {
  return (
    <RowShell
      title={row.candidate || "(candidate not on file)"}
      href={row.application_id ? `/candidates/${row.application_id}` : undefined}
      lines={[
        row.opening || "No opening on file",
        [
          row.interviewer ?? "no interviewer named",
          row.duration_minutes !== null ? `${row.duration_minutes} min` : null,
          `booked ${stamp(row.booked_at, timeZone)}`,
        ]
          .filter(Boolean)
          .join(" · "),
        row.lead_days !== null ? `${row.lead_days} days from application to slot` : null,
      ]}
      right={
        <>
          <p className="font-display text-sm font-bold tabular-nums">
            {when(row.scheduled_at, timeZone)}
          </p>
          <Badge tone={statusTone(row.status)}>{pretty(row.status)}</Badge>
          {row.meeting_link && (
            <a
              href={row.meeting_link}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-gold-dark hover:underline"
            >
              <Video className="h-3 w-3" aria-hidden />
              Join
            </a>
          )}
        </>
      }
    />
  );
}

function RowList({
  result,
  timeZone,
  masked,
}: {
  result: Extract<AnalyticsDrillResult, { ok: true }>;
  timeZone: string;
  masked: boolean;
}) {
  if (result.kind === "attempts") {
    return (
      <ul className="divide-y divide-brand-line">
        {result.rows.map((row) => (
          <AttemptRow key={row.id} row={row} timeZone={timeZone} masked={masked} />
        ))}
      </ul>
    );
  }
  if (result.kind === "prospects") {
    return (
      <ul className="divide-y divide-brand-line">
        {result.rows.map((row) => (
          <ProspectRow key={row.id} row={row} timeZone={timeZone} />
        ))}
      </ul>
    );
  }
  if (result.kind === "messages") {
    return (
      <ul className="divide-y divide-brand-line">
        {result.rows.map((row) => (
          <MessageRow key={row.id} row={row} timeZone={timeZone} />
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-brand-line">
      {result.rows.map((row) => (
        <PanelRow key={row.id} row={row} timeZone={timeZone} />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ drill drawer -- */

const NOUNS: Record<AnalyticsDrillScope["table"], string> = {
  attempts: "attempt",
  prospects: "prospect",
  messages: "message",
  interviews: "panel",
};

/**
 * The rows behind the figure that was clicked, read when the popup opens.
 *
 * Nothing here rides in the page's props: a popup that listed the rows the
 * browser already held could only ever describe what the page chose to load, and
 * would silently disagree with the number above it.
 */
export function DrillDrawer({
  window: windowKey,
  scope,
  timeZone,
  masked,
  onClose,
}: {
  window: AnalyticsWindow;
  scope: AnalyticsDrillScope;
  timeZone: string;
  masked: boolean;
  onClose: () => void;
}) {
  const [result, setResult] = useState<AnalyticsDrillResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    getAnalyticsDrilldown({ window: windowKey, scope }).then(
      (next) => {
        if (active) setResult(next);
      },
      () => {
        // A rejected call is a session or transport failure, not an answer of no.
        if (active) setResult({ ok: false, error: "These rows could not be read. Please retry." });
      }
    );
    return () => {
      active = false;
    };
  }, [windowKey, scope, retry]);

  const heading = result?.ok ? result.heading : null;

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      eyebrow={heading?.eyebrow ?? "Analytics"}
      title={heading?.title ?? "The rows behind this figure"}
      subtitle={heading ? heading.subtitle : "Reading the window…"}
      footer={
        <>
          <p className="max-w-[22rem] text-[11px] leading-relaxed text-brand-ink/50">
            Dates are printed in {timeZone}, the organisation&apos;s timezone.
          </p>
          <button
            type="button"
            onClick={() => {
              setRetry((value) => value + 1);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Re-read these rows
          </button>
        </>
      }
    >
      {!result && (
        <p className="flex items-center gap-2 py-6 text-sm text-brand-ink/55">
          <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
          Reading the rows behind this figure…
        </p>
      )}

      {result && !result.ok && (
        <div className="space-y-3 py-2">
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-800">
            {result.error}
          </p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/55 hover:text-brand-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </button>
        </div>
      )}

      {result && result.ok && (
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5">
            <p className="text-sm" aria-live="polite">
              <strong className="font-display text-base font-extrabold">
                {result.total.toLocaleString()}
              </strong>{" "}
              {NOUNS[scope.table]}
              {result.total === 1 ? "" : "s"}
              <span className="text-[11px] text-brand-ink/50">
                {" "}
                · {result.shown < result.total ? `newest ${result.shown.toLocaleString()} listed` : "all listed"}{" "}
                · read{" "}
                {formatInZone(result.read_at, timeZone, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </p>
          </div>

          {result.note && (
            <p className="rounded-xl border border-brand-line bg-white px-3.5 py-2.5 text-[11px] leading-relaxed text-brand-ink/60">
              {result.note}
            </p>
          )}

          {result.total === 0 ? (
            <EmptyState
              title="Nothing matches this in the window"
              description="The figure counts the rows it read, and this cut of them holds none. Widen the window if you expected more."
            />
          ) : (
            <RowList result={result} timeZone={timeZone} masked={masked} />
          )}

          {result.shown < result.total && (
            <p className="text-[11px] leading-relaxed text-brand-ink/45">
              The figure above counts every row this window read; only the newest{" "}
              {result.shown.toLocaleString()} are listed here, newest first.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
