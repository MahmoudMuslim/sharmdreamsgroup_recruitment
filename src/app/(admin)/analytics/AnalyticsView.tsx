"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  Download,
  FileText,
  Info,
  Loader2,
  Lock,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Send,
  UserRoundSearch,
} from "lucide-react";
import { getAnalyticsReport } from "./actions";
import { ChipRail, DrillDrawer, TrendStrip } from "./AnalyticsDrill";
import type { AnalyticsDrillScope } from "@/modules/analytics/infrastructure/analyticsDrill";
import type { FormProfileReport } from "@/modules/analytics/domain/formAndProfile";
import {
  ANALYTICS_WINDOWS,
  measuresDelivery,
  type AnalyticsReport,
  type AnalyticsWindow,
  type TrendBucket,
} from "@/modules/analytics/domain/report";
import { Card, CardHeader, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { formatInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

/**
 * The channel wildcard the popups understand.
 *
 * Written as a literal rather than imported: `ANY_CHANNEL` lives in a
 * `server-only` module, and only its types may cross into the browser.
 */
const ANY = "ALL";

/** How many questions the "Answers by question" block lists before the report takes over. */
const QUESTION_PREVIEW = 8;

type Open = (scope: AnalyticsDrillScope) => void;

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function count(value: number): string {
  return value.toLocaleString();
}

/** A month total as words: 39 → "3 years 3 months". Never a grade. */
function months(value: number | null): string {
  if (value === null) return "—";
  if (value <= 0) return "Less than a month";
  const years = Math.floor(value / 12);
  const rest = value % 12;
  if (years === 0) return `${rest} ${rest === 1 ? "month" : "months"}`;
  if (rest === 0) return `${years} ${years === 1 ? "year" : "years"}`;
  return `${years} ${years === 1 ? "year" : "years"} ${rest} ${rest === 1 ? "month" : "months"}`;
}

function hours(value: number | null): string {
  if (value === null) return "—";
  if (value < 24) return `${value.toFixed(1)} h`;
  return `${Math.round(value / 24)} d`;
}

function minutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)} min`;
  return `${(value / 60).toFixed(1)} h`;
}

const words = (value: string): string => value.replace(/_/g, " ");

/** Every control on this page opens the same popup, so they share one affordance. */
const HIT =
  "group/hit text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold";

function Cue() {
  return (
    <span
      aria-hidden
      className="ml-1.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-brand-gold-dark opacity-0 transition group-hover/hit:opacity-100 group-focus-visible/hit:opacity-100"
    >
      <MousePointerClick className="h-2.5 w-2.5" />
      rows
    </span>
  );
}

/**
 * One headline number, and the click that lists what went into it.
 *
 * A figure with no scope is drawn as a plain tile rather than a dead button: a
 * control that opens nothing is what this page must not print, because every
 * other one of them does.
 */
function Figure({
  label,
  value,
  hint,
  scope,
  onOpen,
}: {
  label: string;
  value: string;
  hint?: string;
  scope?: AnalyticsDrillScope;
  onOpen?: Open;
}) {
  const body = (
    <>
      <p className="flex items-center text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
        {label}
        {scope && <Cue />}
      </p>
      <p className="mt-0.5 font-display text-xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/50">{hint}</p>}
    </>
  );

  if (!scope || !onOpen)
    return <div className="rounded-xl border border-brand-line bg-white px-3 py-2.5">{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onOpen(scope)}
      title={`List the rows behind “${label}”`}
      className={cn(
        HIT,
        "rounded-xl border border-brand-line bg-white px-3 py-2.5 hover:border-brand-gold hover:bg-brand-sand/40 hover:shadow-soft"
      )}
    >
      {body}
    </button>
  );
}

/** One step of a funnel, clickable down to its meter. */
function FunnelRow({
  label,
  value,
  base,
  hint,
  scope,
  onOpen,
}: {
  label: string;
  value: number;
  base: number;
  hint?: string;
  scope?: AnalyticsDrillScope;
  onOpen?: Open;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold">
          {label}
          {scope && <Cue />}
        </span>
        <span className="text-xs tabular-nums text-brand-ink/55">
          {count(value)}
          {base > 0 ? ` · ${Math.round((value / base) * 100)}%` : ""}
        </span>
      </div>
      <Meter value={value} max={Math.max(base, 1)} tone="gold" className="mt-1.5" />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">{hint}</p>}
    </>
  );

  if (!scope || !onOpen) return <li>{body}</li>;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(scope)}
        title={`List the rows at “${label}”`}
        className={cn(HIT, "-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 hover:bg-brand-sand/50")}
      >
        {body}
      </button>
    </li>
  );
}

/** A number in the channel table that the reader can ask about. */
function Cell({
  value,
  scope,
  onOpen,
  danger,
}: {
  value: number;
  scope: AnalyticsDrillScope;
  onOpen: Open;
  danger?: boolean;
}) {
  return (
    <td className="py-2 text-right">
      <button
        type="button"
        onClick={() => onOpen(scope)}
        title="List these messages"
        className={cn(
          HIT,
          "rounded-md px-1.5 py-0.5 tabular-nums hover:bg-brand-sand/60 hover:underline hover:underline-offset-2",
          danger && value > 0 && "text-rose-700"
        )}
      >
        {count(value)}
      </button>
    </td>
  );
}

/**
 * A counted label drawn as text, not a chip.
 *
 * The demographic tallies use this because there is deliberately no rows
 * popup behind them: a list of who is which gender would be the per-person
 * export the aggregate was allowed in place of.
 */
function Tally({ label, rows }: { label: string; rows: { label: string; count: number }[] }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="truncate text-brand-ink/65">{row.label}</span>
            <span className="tabular-nums font-semibold text-brand-ink/75">{count(row.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A coverage bar: how many of the people on file have anything in this group. */
function CoverageLine({ row }: { row: FormProfileReport["profiles"]["coverage"][number] }) {
  const pct = row.total > 0 ? Math.round((row.filled / row.total) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="truncate text-brand-ink/65">{row.label}</span>
        <span className="shrink-0 tabular-nums font-semibold text-brand-ink/75">
          {count(row.filled)}
          <span className="font-normal text-brand-ink/40"> / {count(row.total)}</span>
        </span>
      </div>
      <Meter value={pct} className="mt-1 h-1.5" />
    </li>
  );
}

export function AnalyticsView({
  report: initial,
  formats,
  canExport,
}: {
  report: AnalyticsReport;
  /** Rendered from `EXPORT_FORMATS` on the server, so this client never imports it. */
  formats: { key: string; label: string; hint: string }[];
  canExport: boolean;
}) {
  const [report, setReport] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drill, setDrill] = useState<AnalyticsDrillScope | null>(null);

  const open: Open = useCallback((scope) => setDrill(scope), []);
  const closeDrill = useCallback(() => setDrill(null), []);

  /** Any window change re-reads the page and closes the popup it was cut from. */
  function load(window: AnalyticsWindow) {
    setDrill(null);
    setError(null);
    startTransition(async () => {
      const result = await getAnalyticsReport(window);
      if (result.ok && result.report) {
        setReport(result.report);
      } else {
        setError(result.error ?? "The report could not be re-read.");
      }
    });
  }

  /** A trend bar is its card's figure, cut to that bucket's calendar days. */
  function ranged(scope: AnalyticsDrillScope, bucket: TrendBucket) {
    open({ ...scope, range: { fromKey: bucket.fromKey, toKey: bucket.toKey } });
  }

  const query = `report=analytics&window=${encodeURIComponent(report.window)}`;

  const { assessments, sourcing, messages, interviews, formProfile, timeZone, scoresHidden } = report;
  const neverOpened = assessments.issued - assessments.opened;
  const strongestBand = assessments.scoreBands[assessments.scoreBands.length - 1];
  const weakestBand = assessments.scoreBands[0];

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Report window">
          {ANALYTICS_WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => load(option.key)}
              disabled={pending}
              aria-pressed={report.window === option.key}
              className={cn(
                "rounded-xl px-3.5 py-1.5 text-xs font-semibold transition disabled:opacity-60",
                report.window === option.key
                  ? "bg-brand-ink text-brand-cream shadow-soft"
                  : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
              )}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(report.window)}
            disabled={pending}
            title="Re-read every figure on this page from the database"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
            Recount
          </button>
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-ink/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Re-reading
            </span>
          )}
        </div>

        {canExport ? (
          <div className="flex flex-wrap items-center gap-2">
            {formats.map((format) => (
              <a
                key={format.key}
                href={`/api/reports/export?${query}&format=${encodeURIComponent(format.key)}`}
                title={`${format.hint} — the figures are re-read from the database when you click`}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {`${format.label} .${format.key}`}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-brand-ink/45">
            Downloading needs the
            <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">analytics.export</code>
            permission.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-brand-ink/45">
        <p>
          Read{" "}
          {formatInZone(report.generatedAt, timeZone, { dateStyle: "medium", timeStyle: "short" })} ·
          window edges and dated labels follow {report.timeZone}
        </p>
        <p className="inline-flex items-center gap-1.5 font-semibold text-brand-ink/55">
          <MousePointerClick className="h-3 w-3" aria-hidden />
          Click a figure, funnel step, chip, bar or cell to list the rows behind it
        </p>
      </div>

      {canExport && (
        <p className="text-[11px] leading-relaxed text-brand-ink/45">
          A download re-reads the window from the database rather than printing what is on this screen,
          and carries these notes into the file. Row-level lists are on the{" "}
          <Link className="font-semibold text-brand-gold-dark underline" href="/reports">
            Reports
          </Link>{" "}
          page.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {report.limitations.length > 0 && (
        <div className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
            <Info className="h-3.5 w-3.5" aria-hidden />
            What these numbers do not cover
          </p>
          <ul className="mt-1.5 space-y-1">
            {report.limitations.map((limitation) => (
              <li key={limitation} className="text-xs leading-relaxed text-brand-ink/65">
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            title="Assessments"
            meta={`Issued to submitted, ${report.windowLabel.toLowerCase()}`}
          />
          {assessments.issued === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
              title="No test was issued in this window"
              description="Issue one from a candidate's profile; its invite, open and submit times land here."
            />
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                <FunnelRow
                  label="Issued"
                  value={assessments.issued}
                  base={assessments.issued}
                  scope={{ table: "attempts", predicate: "issued" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Opened"
                  value={assessments.opened}
                  base={assessments.issued}
                  hint="At least one attempt with a start time."
                  scope={{ table: "attempts", predicate: "opened" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Never opened"
                  value={neverOpened}
                  base={assessments.issued}
                  hint="Invites with no start time at all."
                  scope={{ table: "attempts", predicate: "not_opened" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Submitted"
                  value={assessments.submitted}
                  base={assessments.issued}
                  scope={{ table: "attempts", predicate: "submitted" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Graded"
                  value={assessments.graded}
                  base={assessments.issued}
                  scope={{ table: "attempts", predicate: "graded" }}
                  onOpen={open}
                />
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Opened"
                  value={percent(assessments.openRate)}
                  hint="Share of invites that were ever started."
                  scope={{ table: "attempts", predicate: "opened" }}
                  onOpen={open}
                />
                <Figure
                  label="Finished once opened"
                  value={percent(assessments.finishRate)}
                  hint="Submitted divided by opened."
                  scope={{ table: "attempts", predicate: "submitted" }}
                  onOpen={open}
                />
                <Figure
                  label="Invite to opening"
                  value={hours(assessments.medianInviteToOpenHours)}
                  hint="Median, across attempts that started."
                  scope={{ table: "attempts", predicate: "invite_lag" }}
                  onOpen={open}
                />
                <Figure
                  label="Time on the test"
                  value={minutes(assessments.medianTimeOnTestMinutes)}
                  hint="Median, from start to submit."
                  scope={{ table: "attempts", predicate: "time_on_test" }}
                  onOpen={open}
                />
              </div>
              <ChipRail
                label="Every status in the read"
                buckets={assessments.statusMix}
                onPick={(status) => open({ table: "attempts", predicate: "status", status })}
              />
              <TrendStrip
                caption="Invites issued"
                grain={assessments.trendGrain}
                buckets={assessments.trend}
                onPick={(bucket) => ranged({ table: "attempts", predicate: "issued" }, bucket)}
              />
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Test scores"
            meta={
              scoresHidden
                ? "Withheld from your account"
                : "As a share of each suite's own maximum"
            }
          />
          {scoresHidden ? (
            <EmptyState
              icon={<AlertTriangle className="h-6 w-6" aria-hidden />}
              title="Scores are hidden"
              description="The score-masking setting is on and your role is not granted “View unmasked scores”, so no score or band leaves the server for this page."
            />
          ) : assessments.scoredAttempts === 0 ? (
            <EmptyState
              title="Nothing has been scored yet"
              description="A score appears once an attempt is graded against a suite that sets a maximum."
            />
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Median score"
                  value={percent(assessments.medianScorePercent)}
                  hint={`Across ${count(assessments.scoredAttempts)} scored attempts.`}
                  scope={{ table: "attempts", predicate: "scored" }}
                  onOpen={open}
                />
                <Figure
                  label="Graded"
                  value={count(assessments.graded)}
                  hint="Attempts the engine finished scoring."
                  scope={{ table: "attempts", predicate: "graded" }}
                  onOpen={open}
                />
                {weakestBand && (
                  <Figure
                    label={weakestBand.label}
                    value={count(weakestBand.count)}
                    hint="Attempts in the lowest band on this page."
                    scope={{ table: "attempts", predicate: "band", band: weakestBand.label }}
                    onOpen={open}
                  />
                )}
                {strongestBand && (
                  <Figure
                    label={strongestBand.label}
                    value={count(strongestBand.count)}
                    hint="Attempts in the highest band on this page."
                    scope={{ table: "attempts", predicate: "band", band: strongestBand.label }}
                    onOpen={open}
                  />
                )}
              </div>
              <ul className="mt-4 space-y-3">
                {assessments.scoreBands.map((band) => (
                  <FunnelRow
                    key={band.label}
                    label={band.label}
                    value={band.count}
                    base={assessments.scoredAttempts}
                    scope={{ table: "attempts", predicate: "band", band: band.label }}
                    onOpen={open}
                  />
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
                Every band is a share of the suite’s own maximum, so a 62 on a 40-question test and a
                62 on a 200-point one are not counted as the same result.
              </p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Sourcing"
            meta={`Outbound stages, ${report.windowLabel.toLowerCase()}`}
          />
          {sourcing.total === 0 ? (
            <EmptyState
              icon={<UserRoundSearch className="h-6 w-6" aria-hidden />}
              title="No prospect was added in this window"
              description="Import a list on the Sourcing board; its stage steps are counted here."
            />
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                <FunnelRow
                  label="In the pool"
                  value={sourcing.total}
                  base={sourcing.total}
                  scope={{ table: "prospects", predicate: "pool" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Contacted"
                  value={sourcing.contacted}
                  base={sourcing.total}
                  scope={{ table: "prospects", predicate: "stage", stage: "CONTACTED" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Replied"
                  value={sourcing.replied}
                  base={sourcing.total}
                  scope={{ table: "prospects", predicate: "stage", stage: "REPLIED" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Interviewing"
                  value={sourcing.interviewing}
                  base={sourcing.total}
                  scope={{ table: "prospects", predicate: "stage", stage: "INTERVIEW" }}
                  onOpen={open}
                />
                <FunnelRow
                  label="Converted"
                  value={sourcing.converted}
                  base={sourcing.total}
                  hint="Reached CONVERTED or now carries an application."
                  scope={{ table: "prospects", predicate: "converted" }}
                  onOpen={open}
                />
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Reply rate"
                  value={percent(sourcing.replyRate)}
                  hint="Replied divided by contacted."
                  scope={{ table: "prospects", predicate: "stage", stage: "REPLIED" }}
                  onOpen={open}
                />
                <Figure
                  label="Conversion"
                  value={percent(sourcing.conversionRate)}
                  hint="Converted divided by the whole pool."
                  scope={{ table: "prospects", predicate: "converted" }}
                  onOpen={open}
                />
                <Figure
                  label="Added to first message"
                  value={hours(sourcing.medianHoursToFirstContact)}
                  hint={`Median over ${count(sourcing.prospectsWithMessages)} prospects with a logged message.`}
                  scope={{ table: "prospects", predicate: "messaged" }}
                  onOpen={open}
                />
                <Figure
                  label="Passed"
                  value={count(sourcing.passed)}
                  hint="Marked not a fit."
                  scope={{ table: "prospects", predicate: "stage", stage: "PASSED" }}
                  onOpen={open}
                />
              </div>
              <ChipRail
                label="Every stage in the read"
                buckets={sourcing.stages}
                onPick={(stage) => open({ table: "prospects", predicate: "stage", stage })}
              />
              <TrendStrip
                caption="Prospects added"
                grain={sourcing.trendGrain}
                buckets={sourcing.trend}
                onPick={(bucket) => ranged({ table: "prospects", predicate: "pool" }, bucket)}
              />
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader title="Candidate messages" meta="Current delivery state per channel" />
          {messages.byChannel.length === 0 ? (
            <EmptyState
              icon={<Send className="h-6 w-6" aria-hidden />}
              title="Nothing was sent in this window"
              description="Stage moves, interview notices and outreach all land in this log."
            />
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Logged"
                  value={count(messages.scanned)}
                  hint="Rows the read found across every channel."
                  scope={{ table: "messages", channel: ANY, state: "sent" }}
                  onOpen={open}
                />
                <Figure
                  label="Delivered"
                  value={count(messages.delivered)}
                  hint="Email and WhatsApp only — a portal notice is written, not delivered."
                  scope={{ table: "messages", channel: ANY, state: "delivered" }}
                  onOpen={open}
                />
                <Figure
                  label="Not delivered"
                  value={count(messages.undelivered)}
                  hint="Refused by the relay, or still waiting in the WhatsApp queue."
                  scope={{ table: "messages", channel: ANY, state: "undelivered" }}
                  onOpen={open}
                />
                <Figure
                  label="Read"
                  value={count(messages.read)}
                  hint="Portal notices only — no other channel reports a read."
                  scope={{ table: "messages", channel: "IN_APP", state: "read" }}
                  onOpen={open}
                />
              </div>
              <table className="mt-4 w-full text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-brand-ink/45">
                    <th className="py-1.5 font-bold">Channel</th>
                    <th className="py-1.5 text-right font-bold">Sent</th>
                    <th className="py-1.5 text-right font-bold">Delivered</th>
                    <th className="py-1.5 text-right font-bold">Failed</th>
                    <th className="py-1.5 text-right font-bold">Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {messages.byChannel.map((row) => (
                    <tr key={row.channel}>
                      <td className="py-2 font-semibold">
                        <button
                          type="button"
                          onClick={() =>
                            open({ table: "messages", channel: row.channel, state: "sent" })
                          }
                          title={`List every ${words(row.channel)} message in the window`}
                          className={cn(
                            HIT,
                            "rounded-md px-1.5 py-0.5 hover:bg-brand-sand/60 hover:underline hover:underline-offset-2"
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {row.channel === "WHATSAPP" ? (
                              <MessageCircle className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
                            ) : null}
                            {words(row.channel)}
                            <Cue />
                          </span>
                        </button>
                      </td>
                      <Cell
                        value={row.sent}
                        scope={{ table: "messages", channel: row.channel, state: "sent" }}
                        onOpen={open}
                      />
                      {measuresDelivery(row.channel) ? (
                        <>
                          <Cell
                            value={row.delivered ?? 0}
                            scope={{ table: "messages", channel: row.channel, state: "delivered" }}
                            onOpen={open}
                          />
                          <Cell
                            value={row.undelivered ?? 0}
                            danger
                            scope={{ table: "messages", channel: row.channel, state: "undelivered" }}
                            onOpen={open}
                          />
                        </>
                      ) : (
                        <td
                          colSpan={2}
                          className="py-2 text-right text-brand-ink/35"
                          title="A portal notice is written, not delivered — its own signal is the Read column"
                        >
                          —
                        </td>
                      )}
                      {row.channel === "IN_APP" ? (
                        <Cell
                          value={row.read}
                          scope={{ table: "messages", channel: row.channel, state: "read" }}
                          onOpen={open}
                        />
                      ) : (
                        <td
                          className="py-2 text-right text-brand-ink/35"
                          title="This channel reports no read signal to the portal"
                        >
                          —
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <TrendStrip
                caption="Messages sent"
                grain={messages.trendGrain}
                buckets={messages.trend}
                onPick={(bucket) => ranged({ table: "messages", channel: ANY, state: "sent" }, bucket)}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/50">
                Delivered is the state the log holds now, not a record of every attempt: an email that
                failed twice and then went through reads as delivered. The inbox row a send also leaves
                is not counted as a delivery — a notice is written, and its own signal is the Read
                column, which is why those two cells print a dash. A dash under Read means that channel
                reports no read signal at all.
              </p>
            </>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <CardHeader title="Interview panels" meta="Booked, decided and still to come" />
          {interviews.booked === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" aria-hidden />}
              title="No panel was booked in this window"
              description="Panels are scheduled from a candidate's profile and appear here as soon as one is saved."
            />
          ) : (
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
                <Figure
                  label="Booked"
                  value={count(interviews.booked)}
                  scope={{ table: "interviews", predicate: "booked" }}
                  onOpen={open}
                />
                <Figure
                  label="Upcoming"
                  value={count(interviews.upcoming)}
                  hint="Still scheduled, with the slot still in the future."
                  scope={{ table: "interviews", predicate: "upcoming" }}
                  onOpen={open}
                />
                <Figure
                  label="Decided"
                  value={count(interviews.decided)}
                  hint="Completed or a no-show: what a rate can be taken over."
                  scope={{ table: "interviews", predicate: "decided" }}
                  onOpen={open}
                />
                <Figure
                  label="Completed"
                  value={count(interviews.completed)}
                  scope={{ table: "interviews", predicate: "status", status: "COMPLETED" }}
                  onOpen={open}
                />
                <Figure
                  label="Cancelled"
                  value={count(interviews.cancelled)}
                  scope={{ table: "interviews", predicate: "status", status: "CANCELLED" }}
                  onOpen={open}
                />
                <Figure
                  label="No-shows"
                  value={count(interviews.noShow)}
                  scope={{ table: "interviews", predicate: "status", status: "NO_SHOW" }}
                  onOpen={open}
                />
                <Figure
                  label="No-show rate"
                  value={percent(interviews.noShowRate)}
                  hint="No-shows over decided panels; this lists the no-shows."
                  scope={{ table: "interviews", predicate: "status", status: "NO_SHOW" }}
                  onOpen={open}
                />
                <Figure
                  label="Applied to interview"
                  value={interviews.medianLeadDays === null ? "—" : `${interviews.medianLeadDays} d`}
                  hint={`Median over ${count(interviews.panelsWithLead)} panels with an application date.`}
                  scope={{ table: "interviews", predicate: "lead" }}
                  onOpen={open}
                />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                  Who is sitting on panels
                </p>
                {interviews.byInterviewer.length === 0 ? (
                  <p className="mt-2 text-xs text-brand-ink/55">
                    No panel in this window names an interviewer. Only a panel booked inside the portal
                    records one.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {interviews.byInterviewer.map((panel) => (
                      <FunnelRow
                        key={panel.name}
                        label={panel.name}
                        value={panel.panels}
                        base={interviews.byInterviewer[0].panels}
                        scope={{
                          table: "interviews",
                          predicate: "interviewer",
                          interviewer: panel.name,
                        }}
                        onOpen={open}
                      />
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
                  The six busiest names out of {count(interviews.booked)} panels read.
                </p>
              </div>
              <div className="lg:col-span-3">
                <ChipRail
                  label="Every status in the read"
                  buckets={interviews.statusMix}
                  onPick={(status) => open({ table: "interviews", predicate: "status", status })}
                />
                <TrendStrip
                  caption="Panels booked"
                  grain={interviews.trendGrain}
                  buckets={interviews.trend}
                  onPick={(bucket) => ranged({ table: "interviews", predicate: "booked" }, bucket)}
                />
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <CardHeader
            title="Applications & profiles"
            meta={`What the form captured, and what the person store holds, ${report.windowLabel.toLowerCase()}`}
          />
          {formProfile.applications.total === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" aria-hidden />}
              title="No application landed in this window"
              description="The form figures count the applications in this window; the profile coverage below describes the whole person store and stays empty while it holds nobody."
            />
          ) : (
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
                <Figure
                  label="Filed on the form"
                  value={count(formProfile.applications.withForm)}
                  hint="A snapshot saved with the application, question for question."
                  scope={{ table: "forms", predicate: "with_form" }}
                  onOpen={open}
                />
                <Figure
                  label="Filed before the form"
                  value={count(formProfile.applications.withoutForm)}
                  hint="No snapshot: only the four fixed columns exist for these."
                  scope={{ table: "forms", predicate: "without_form" }}
                  onOpen={open}
                />
                <Figure
                  label="Form adoption"
                  value={percent(formProfile.applications.adoptionRate)}
                  hint="Form-filed over every application in the window."
                  scope={{ table: "forms", predicate: "with_form" }}
                  onOpen={open}
                />
                <Figure
                  label="With a CV"
                  value={count(formProfile.applications.withCv)}
                  hint="Applications whose record names an attached CV file."
                />
                <Figure
                  label="Form attachments"
                  value={count(formProfile.applications.attachments)}
                  hint={`${count(formProfile.applications.withAttachments)} applications carry at least one file uploaded while filling the form.`}
                />
                <Figure
                  label="File completion"
                  value={percent(formProfile.completion.completionRate)}
                  hint={`${count(formProfile.completion.withAttachment)} of ${count(formProfile.completion.fileFieldsAsked)} applications whose form asks for a file carried one.`}
                />
                <Figure
                  label="Unclaimed uploads"
                  value={count(formProfile.completion.unclaimed)}
                  hint={`${count(formProfile.completion.unclaimedInsideWindow)} still inside the ${formProfile.completion.orphanWindowHours}-hour window; ${count(formProfile.completion.unclaimedPastWindow)} the sweep will clear.`}
                />
                <Figure
                  label="Processing consent"
                  value={count(formProfile.applications.processingConsent)}
                  hint="Accepted the privacy notice for this application."
                />
                <Figure
                  label="Talent-pool consent"
                  value={count(formProfile.applications.talentPoolConsent)}
                  hint="Also agreed to be kept for later openings."
                />
                <Figure
                  label="Notice versions"
                  value={count(formProfile.applications.noticeVersions.length)}
                  hint={
                    formProfile.applications.noticeVersions.length === 0
                      ? "No application in this window records the notice it accepted."
                      : formProfile.applications.noticeVersions
                          .map((row) => `${row.label} × ${count(row.count)}`)
                          .join(" · ")
                  }
                />
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                  People on file
                </p>
                {formProfile.profiles.total === 0 ? (
                  <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
                    The person store holds nobody yet, so coverage has nothing to divide by. It is
                    not windowed: it describes the base as it stands.
                  </p>
                ) : (
                  <>
                    <ul className="mt-2 grid grid-cols-2 gap-2">
                      <Figure label="People" value={count(formProfile.profiles.total)} />
                      <Figure
                        label="Named"
                        value={count(formProfile.profiles.withName)}
                        hint="A legal name on file."
                      />
                      <Figure
                        label="With a birth date"
                        value={count(formProfile.profiles.withDob)}
                        hint="What an age band is counted from."
                      />
                      <Figure
                        label="Identity complete"
                        value={count(formProfile.profiles.identityComplete)}
                        hint="Both a legal name and a birth date."
                      />
                    </ul>
                    {formProfile.profiles.coverage.length === 0 ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
                        No group holds a value yet beyond what the figures above count.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {formProfile.profiles.coverage.map((row) => (
                          <CoverageLine key={row.group} row={row} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <div className="lg:col-span-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                  What the form asked
                </p>
                <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">
                  {formProfile.forms.asked === 0
                    ? "No snapshot in this window carries an answerable field."
                    : `${count(formProfile.forms.answered)} of ${count(formProfile.forms.asked)} answerable fields carry a value (${percent(formProfile.forms.answerRate)}). Section headings are not questions and are not counted.`}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
                  {formProfile.forms.versions.length === 0
                    ? "No form version is recorded in this window's snapshots."
                    : `Snapshots were taken from ${formProfile.forms.versions
                        .map((row) => `${row.label} × ${count(row.count)}`)
                        .join(", ")}. A later edit of the form does not rewrite what was asked.`}
                </p>

                {formProfile.questions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                      Answers by question
                    </p>
                    <ul className="mt-2 space-y-1">
                      {formProfile.questions.slice(0, QUESTION_PREVIEW).map((row) => (
                        <li
                          key={row.key}
                          className="flex items-baseline justify-between gap-3 text-[11px]"
                        >
                          <span className="truncate text-brand-ink/65" title={row.label}>
                            {row.label}
                          </span>
                          <span className="shrink-0 tabular-nums text-brand-ink/60">
                            {count(row.answered)}
                            <span className="text-brand-ink/35"> / {count(row.asked)}</span>
                            {row.skipped > 0 && (
                              <span className="ml-2 text-brand-ink/40">
                                {count(row.skipped)} skipped
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/45">
                      {formProfile.questions.length > QUESTION_PREVIEW
                        ? `The ${QUESTION_PREVIEW} most-asked of ${count(formProfile.questions.length)} questions in these snapshots. The full list is a report on the `
                        : "Every question these snapshots asked. The same list is a report on the "}
                      <Link className="font-semibold text-brand-gold-dark underline" href="/reports">
                        Reports
                      </Link>{" "}
                      page. Counts only — no answer value is shown here.
                    </p>
                  </div>
                )}

                {formProfile.completion.fields.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                      Uploads nobody submitted
                    </p>
                    <ul className="mt-2 space-y-1">
                      {formProfile.completion.fields.map((row) => (
                        <li
                          key={row.fieldKey}
                          className="flex items-baseline justify-between gap-3 text-[11px]"
                        >
                          <span className="truncate font-mono text-brand-ink/60">{row.fieldKey}</span>
                          <span className="shrink-0 tabular-nums text-brand-ink/60">
                            {count(row.uploads)}
                            <span className="text-brand-ink/35">
                              {" "}
                              · {count(row.insideWindow)} open · {count(row.pastWindow)} past
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/45">
                      A file lands here when someone uploaded it during the form and never
                      submitted. The store has no record of where a form was started, so this is the
                      only abandonment signal that exists; “past” means the retention sweep will
                      delete it. No path, file name or content is read for this.
                    </p>
                  </div>
                )}

                <div className="mt-4 border-t border-brand-line pt-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                    <Lock className="h-3 w-3" aria-hidden />
                    Demographics
                  </p>
                  {formProfile.demographics === null ? (
                    <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">
                      Counted only for staff holding
                      <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono text-[11px]">
                        candidates.view_family_data
                      </code>
                      — the same grant that opens a family record. Without it this section is
                      withheld rather than shown empty, and the tier-3 coverage groups are left out
                      of the bars above.
                    </p>
                  ) : formProfile.demographics.stated === 0 ? (
                    <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">
                      Nobody on file has stated a demographic fact, so every tally would be the
                      whole population under “Not stated”.
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <Tally label="Gender" rows={formProfile.demographics.gender} />
                        <Tally label="Nationality" rows={formProfile.demographics.nationality} />
                        <Tally label="Marital status" rows={formProfile.demographics.maritalStatus} />
                        <Tally label="Children" rows={formProfile.demographics.children} />
                        <Tally label="Age band" rows={formProfile.demographics.ageBands} />
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/45">
                        {count(formProfile.demographics.stated)} of{" "}
                        {count(formProfile.profiles.total)} people on file stated at least one of
                        these. “Not stated” is a real answer and is counted, not dropped. These are
                        tallies only — there is no per-person list behind them.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* ---- Experience and stability, from the work-history rows ---- */}
        <Card className="p-5 lg:col-span-2">
          <CardHeader
            title="Experience & stability"
            meta="Work-history durations on file · a roll-up, never a score"
          />
          {formProfile.experience.withHistory === 0 ? (
            <EmptyState
              icon={<UserRoundSearch className="h-6 w-6" aria-hidden />}
              title="No work history on file"
              description="Experience is counted from the employment rows on a person's profile. It fills as candidates and recruiters add them, and it is not cut by the window above."
            />
          ) : (
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
                <Figure
                  label="People with history"
                  value={count(formProfile.experience.withHistory)}
                  hint={`Of ${count(formProfile.experience.people)} people the read reached; the person store is not windowed.`}
                />
                <Figure
                  label="Roles recorded"
                  value={count(formProfile.experience.roles)}
                  hint="One employment row each."
                />
                <Figure
                  label="Median total experience"
                  value={months(formProfile.experience.medianTotalMonths)}
                  hint="Middle person of everyone whose rows add up to a duration."
                />
                <Figure
                  label="Month-precise starts"
                  value={count(formProfile.experience.rowsWithMonths)}
                  hint={`Of ${count(formProfile.experience.roles)} rows; the rest named a year only and still count twelve months each.`}
                />
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                  Total experience
                </p>
                <ul className="mt-2 space-y-2">
                  {formProfile.experience.bands.map((band) => (
                    <li key={band.label}>
                      <div className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="truncate text-brand-ink/65">{band.label}</span>
                        <span className="shrink-0 tabular-nums font-semibold text-brand-ink/75">
                          {count(band.count)}
                          <span className="font-normal text-brand-ink/40">
                            {" "}
                            / {count(formProfile.experience.withHistory)}
                          </span>
                        </span>
                      </div>
                      <Meter
                        value={band.count}
                        max={Math.max(formProfile.experience.withHistory, 1)}
                        className="mt-1 h-1.5"
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[11px] leading-relaxed text-brand-ink/45 lg:col-span-3">
                Counted month by month from each person’s employment rows. A year-only period counts
                as twelve months; a role with no end, and an ongoing role, count to the report date.
                Rows with no start year add nothing. This is a duration roll-up for reading a CV at a
                glance — it is not a rating, a ranking or a prediction about anyone.
              </p>
            </div>
          )}
        </Card>
      </div>

      {drill && (
        <DrillDrawer
          // A different figure remounts the panel: an earlier popup's rows must
          // never sit under the new heading while the fresh read is in flight.
          key={JSON.stringify(drill)}
          window={report.window}
          scope={drill}
          timeZone={timeZone}
          masked={scoresHidden}
          onClose={closeDrill}
        />
      )}
    </div>
  );
}
