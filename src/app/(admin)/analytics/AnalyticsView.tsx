"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  Download,
  Info,
  Loader2,
  MessageCircle,
  Send,
  UserRoundSearch,
} from "lucide-react";
import { getAnalyticsReport } from "./actions";
import {
  ANALYTICS_WINDOWS,
  type AnalyticsReport,
  type AnalyticsWindow,
} from "@/modules/analytics/domain/report";
import { Badge, Card, CardHeader, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function count(value: number): string {
  return value.toLocaleString();
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

function FunnelRow({
  label,
  value,
  base,
  hint,
}: {
  label: string;
  value: number;
  base: number;
  hint?: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-xs tabular-nums text-brand-ink/55">
          {count(value)}
          {base > 0 ? ` · ${Math.round((value / base) * 100)}%` : ""}
        </span>
      </div>
      <Meter value={value} max={Math.max(base, 1)} tone="gold" className="mt-1.5" />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">{hint}</p>}
    </li>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-white px-3 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">{label}</p>
      <p className="mt-0.5 font-display text-xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/50">{hint}</p>}
    </div>
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

  function load(window: AnalyticsWindow) {
    if (window === report.window) return;
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

  const query = `report=analytics&window=${encodeURIComponent(report.window)}`;

  const { assessments, sourcing, messages, interviews } = report;

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
                <FunnelRow label="Issued" value={assessments.issued} base={assessments.issued} />
                <FunnelRow
                  label="Opened"
                  value={assessments.opened}
                  base={assessments.issued}
                  hint="At least one attempt with a start time."
                />
                <FunnelRow label="Submitted" value={assessments.submitted} base={assessments.issued} />
                <FunnelRow label="Graded" value={assessments.graded} base={assessments.issued} />
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Opened"
                  value={percent(assessments.openRate)}
                  hint="Share of invites that were ever started."
                />
                <Figure
                  label="Finished once opened"
                  value={percent(assessments.finishRate)}
                  hint="Submitted divided by opened."
                />
                <Figure
                  label="Invite to opening"
                  value={hours(assessments.medianInviteToOpenHours)}
                  hint="Median, across attempts that started."
                />
                <Figure
                  label="Time on the test"
                  value={minutes(assessments.medianTimeOnTestMinutes)}
                  hint="Median, from start to submit."
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="neutral">{count(assessments.notStarted)} not started</Badge>
                <Badge tone="info">{count(assessments.inProgress)} in progress</Badge>
                <Badge tone="danger">{count(assessments.expired)} expired</Badge>
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Test scores"
            meta={
              report.scoresHidden
                ? "Withheld from your account"
                : "As a share of each suite's own maximum"
            }
          />
          {report.scoresHidden ? (
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
                />
                <Figure
                  label="Graded"
                  value={count(assessments.graded)}
                  hint="Attempts the engine finished scoring."
                />
              </div>
              <ul className="mt-4 space-y-3">
                {assessments.scoreBands.map((band) => (
                  <FunnelRow
                    key={band.label}
                    label={band.label}
                    value={band.count}
                    base={assessments.scoredAttempts}
                  />
                ))}
              </ul>
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
                <FunnelRow label="In the pool" value={sourcing.total} base={sourcing.total} />
                <FunnelRow label="Contacted" value={sourcing.contacted} base={sourcing.total} />
                <FunnelRow label="Replied" value={sourcing.replied} base={sourcing.total} />
                <FunnelRow label="Interviewing" value={sourcing.interviewing} base={sourcing.total} />
                <FunnelRow
                  label="Converted"
                  value={sourcing.converted}
                  base={sourcing.total}
                  hint="Reached CONVERTED or now carries an application."
                />
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Figure
                  label="Reply rate"
                  value={percent(sourcing.replyRate)}
                  hint="Replied divided by contacted."
                />
                <Figure
                  label="Conversion"
                  value={percent(sourcing.conversionRate)}
                  hint="Converted divided by the whole pool."
                />
                <Figure
                  label="Added to first message"
                  value={hours(sourcing.medianHoursToFirstContact)}
                  hint={`Median over ${count(sourcing.prospectsWithMessages)} prospects with a logged message.`}
                />
                <Figure label="Passed" value={count(sourcing.passed)} hint="Marked not a fit." />
              </div>
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
              <table className="mt-3 w-full text-left text-xs">
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
                        <span className="inline-flex items-center gap-1.5">
                          {row.channel === "WHATSAPP" ? (
                            <MessageCircle className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
                          ) : null}
                          {row.channel.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{count(row.sent)}</td>
                      <td className="py-2 text-right tabular-nums">{count(row.delivered)}</td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          row.undelivered > 0 && "text-rose-700"
                        )}
                      >
                        {count(row.undelivered)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {row.channel === "IN_APP" ? count(row.read) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/50">
                Delivered is the state the log holds now, not a record of every attempt: a message that
                failed twice and then went through reads as delivered. A dash under Read means that
                channel reports no read signal at all — only the portal notice carries one.
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
              <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2">
                <Figure label="Booked" value={count(interviews.booked)} />
                <Figure label="Upcoming" value={count(interviews.upcoming)} hint="Still marked scheduled and in the future." />
                <Figure label="Completed" value={count(interviews.completed)} />
                <Figure label="Cancelled" value={count(interviews.cancelled)} />
                <Figure
                  label="No-show rate"
                  value={percent(interviews.noShowRate)}
                  hint="Of the panels that ended in a person attending or not."
                />
                <Figure
                  label="Applied to interview"
                  value={
                    interviews.medianLeadDays === null
                      ? "—"
                      : `${interviews.medianLeadDays} d`
                  }
                  hint="Median days from the application to the slot."
                />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
                  Who is sitting on panels
                </p>
                {interviews.byInterviewer.length === 0 ? (
                  <p className="mt-2 text-xs text-brand-ink/55">
                    No panel in this window names an interviewer.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {interviews.byInterviewer.map((panel) => (
                      <FunnelRow
                        key={panel.name}
                        label={panel.name}
                        value={panel.panels}
                        base={interviews.byInterviewer[0].panels}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
