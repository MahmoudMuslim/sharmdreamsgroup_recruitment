"use client";

import { useState, useTransition } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  Download,
  Info,
  Loader2,
  Send,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { getRowReport, type RowReportPreview } from "./actions";
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from "@/modules/analytics/domain/report";
import type { ExportSheet } from "@/modules/analytics/domain/exportDocument";
import { Card, CardHeader, EmptyState } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

/** Keyed by report id, so a tab cannot be drawn without its icon. */
const ICONS = {
  pipeline: Users,
  assessments: ClipboardCheck,
  sourcing: UserRoundSearch,
  messages: Send,
  interviews: CalendarDays,
} as const;

type Definition = { id: keyof typeof ICONS; label: string; blurb: string; caveats: string[] };
type Format = { key: string; label: string; hint: string };

interface Loaded {
  report: keyof typeof ICONS;
  window: AnalyticsWindow;
  sheet: ExportSheet;
  totalRows: number;
  limitations: string[];
  windowLabel: string;
  timeZone: string;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

export function ReportsView({
  definitions,
  formats,
  initial,
  canExport,
}: {
  definitions: Definition[];
  formats: Format[];
  initial: Loaded;
  canExport: boolean;
}) {
  const [data, setData] = useState<Loaded>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const definition = definitions.find((option) => option.id === data.report) ?? definitions[0];
  const caveatCount = definition.caveats.length;

  function load(report: keyof typeof ICONS, window: AnalyticsWindow) {
    if (report === data.report && window === data.window) return;
    setError(null);
    startTransition(async () => {
      const result: RowReportPreview = await getRowReport(report, window);
      if (!result.ok || !result.sheet || !result.report || !result.window) {
        setError(result.error ?? "That report could not be read.");
        return;
      }
      setData({
        report: result.report,
        window: result.window,
        sheet: result.sheet,
        totalRows: result.totalRows ?? result.sheet.rows.length,
        limitations: result.limitations ?? [],
        windowLabel: result.windowLabel ?? "",
        timeZone: result.timeZone ?? "",
      });
    });
  }

  const query = `report=${encodeURIComponent(data.report)}&window=${encodeURIComponent(data.window)}`;
  /** A column is right-aligned only when it really carries numbers. */
  const numeric = data.sheet.columns.map(
    (_, index) => data.sheet.rows.length > 0 && typeof data.sheet.rows[0][index] === "number"
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reports">
        {definitions.map((option) => {
          const Icon = ICONS[option.id];
          const active = option.id === data.report;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              id={`reports-tab-${option.id}`}
              aria-selected={active}
              aria-controls="reports-panel"
              disabled={pending}
              onClick={() => load(option.id, data.window)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
                active
                  ? "bg-brand-ink text-brand-cream shadow-soft"
                  : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Report window">
          {ANALYTICS_WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => load(data.report, option.key)}
              disabled={pending}
              aria-pressed={data.window === option.key}
              className={cn(
                "rounded-xl px-3.5 py-1.5 text-xs font-semibold transition disabled:opacity-60",
                data.window === option.key
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
              Reading
            </span>
          )}
        </div>

        {canExport ? (
          <div className="flex flex-wrap items-center gap-2">
            {formats.map((format) => (
              <a
                key={format.key}
                href={`/api/reports/export?${query}&format=${encodeURIComponent(format.key)}`}
                title={format.hint}
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

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      <Card className="mt-1 p-5">
        <CardHeader
          title={definition.label}
          meta={`${data.totalRows.toLocaleString()} rows · ${data.windowLabel} · ${data.timeZone}`}
        />
        <p className="mt-2 text-xs leading-relaxed text-brand-ink/60">{definition.blurb}</p>

        <div className="mt-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
            <Info className="h-3.5 w-3.5" aria-hidden />
            What this list does not cover
          </p>
          <ul className="mt-1.5 space-y-1">
            {definition.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-brand-ink/65">
                {caveat}
              </li>
            ))}
            {data.limitations.slice(caveatCount).map((limitation) => (
              <li
                key={limitation}
                className="text-xs font-semibold leading-relaxed text-rose-800"
              >
                {limitation}
              </li>
            ))}
          </ul>
        </div>

        {data.sheet.rows.length === 0 ? (
          <EmptyState
            title="No record carries a date inside this window"
            description="Widen the window above. A download of this report is an empty table with the same notes written above it, never a row invented to fill the space."
          />
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-max text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-brand-ink/45">
                    {data.sheet.columns.map((column, index) => (
                      <th
                        key={column}
                        className={cn(
                          "whitespace-nowrap border-b border-brand-line px-3 py-2 font-bold",
                          numeric[index] && "text-right"
                        )}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {data.sheet.rows.map((row, index) => (
                    <tr key={index} className="hover:bg-brand-sand/60">
                      {row.map((value, column) => (
                        <td
                          key={column}
                          title={text(value)}
                          className={cn(
                            "max-w-[24rem] truncate whitespace-nowrap px-3 py-2",
                            numeric[column] && "text-right tabular-nums",
                            text(value) === "" && "text-brand-ink/30"
                          )}
                        >
                          {text(value) === "" ? "—" : text(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.totalRows > data.sheet.rows.length && (
              <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/50">
                The screen shows the newest {data.sheet.rows.length.toLocaleString()} rows; the
                download carries all {data.totalRows.toLocaleString()}.
              </p>
            )}
            {canExport && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/45">
                All three formats are rendered from this same read, so they cannot disagree about a
                figure. The window, the time zone, who exported it and the notes above are written into
                each file.
              </p>
            )}
          </>
        )}
      </Card>

      <Card className="p-5">
        <CardHeader title="What reporting does not do yet" meta="No schedule, nothing saved" />
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-brand-ink/60">
          <li>
            A report is read when you open it. Nothing is generated on a schedule and nothing is
            emailed to anyone — the Outbox only sends candidate messages.
          </li>
          <li>
            Nothing is saved: every download re-reads the database, so a file from last month cannot
            be reopened here.
          </li>
          <li>The window is the only selector. There is no filter by opening or recruiter.</li>
        </ul>
      </Card>
    </div>
  );
}
