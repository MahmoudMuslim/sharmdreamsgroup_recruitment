"use client";

import { useState, useTransition } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  Download,
  FileQuestion,
  FileText,
  Info,
  Loader2,
  Send,
  UploadCloud,
  UserRound,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { getRowReport, type RowReportPreview } from "./actions";
import { FORM_REPORTS } from "@/modules/analytics/domain/reportScope";
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
  application_forms: FileText,
  form_questions: FileQuestion,
  unclaimed_uploads: UploadCloud,
  person_profiles: UserRound,
} as const;

type Definition = { id: keyof typeof ICONS; label: string; blurb: string; caveats: string[] };
type Format = { key: string; label: string; hint: string };

interface Loaded {
  report: keyof typeof ICONS;
  window: AnalyticsWindow;
  sheet: ExportSheet;
  totalRows: number;
  limitations: string[];
  /** What the list is cut by, e.g. "90 days". */
  scope: string;
  timeZone: string;
  /** The form the two form lists are narrowed to, when a filter is on. */
  formId: string | null;
  formName: string | null;
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

  /**
   * Drop `form` from the address, keeping every other parameter.
   *
   * Next's native history API is the shallow update its own docs prescribe for a
   * client component that owns its selection, so this rewrites the address
   * without a navigation or a second read.
   */
  function forgetFormInUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("form")) return;
    params.delete("form");
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
    );
  }

  /**
   * Load one list, carrying the form filter only where it means something.
   *
   * The filter rides in state rather than the address bar: a recruiter who
   * deep-linked from a form keeps it while stepping between the two form lists,
   * and switching to a report that has no form column drops it from the read
   * (the action would ignore it anyway) without forgetting which form they came
   * from. "Show every form" is the explicit way to clear it.
   */
  function load(
    report: keyof typeof ICONS,
    window: AnalyticsWindow,
    formId: string | null = data.formId
  ) {
    const nextForm = FORM_REPORTS.has(report) ? formId : null;
    if (report === data.report && window === data.window && nextForm === data.formId) return;
    setError(null);
    startTransition(async () => {
      const result: RowReportPreview = await getRowReport(report, window, nextForm);
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
        scope: result.scope ?? "",
        timeZone: result.timeZone ?? "",
        formId: result.formName == null ? null : nextForm,
        formName: result.formName ?? null,
      });
      // The one move that changes what the address promises. Keeping the filter
      // in state while stepping between lists is deliberate; keeping `form` in
      // the URL after the reader widened the list is not — a reload would read
      // it and narrow what the screen had just shown wide.
      if (data.formId !== null && nextForm === null) forgetFormInUrl();
    });
  }

  /** The filter the current tab actually reads with. */
  const formFilter = FORM_REPORTS.has(data.report) ? data.formId : null;
  const query =
    `report=${encodeURIComponent(data.report)}&window=${encodeURIComponent(data.window)}` +
    (formFilter ? `&form=${encodeURIComponent(formFilter)}` : "");
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

      {formFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-gold/40 bg-brand-gold/10 px-3.5 py-2 text-xs leading-relaxed text-brand-ink/70">
          <FileText className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
          <span>
            Narrowed to{" "}
            <strong className="font-semibold text-brand-ink">
              {data.formName ? `“${data.formName}”` : "one form"}
            </strong>
            : only the applications whose filed snapshot named it. Other forms&apos; applications
            share the window but are not in these rows.
          </span>
          <button
            type="button"
            onClick={() => load(data.report, data.window, null)}
            disabled={pending}
            className="rounded-lg border border-brand-line bg-white px-2.5 py-1 font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-60"
          >
            Show every form
          </button>
        </div>
      )}

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
          meta={`${data.totalRows.toLocaleString()} rows · ${data.scope} · ${data.timeZone}`}
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
            title={
              formFilter
                ? `No application filed against ${
                    data.formName ? `“${data.formName}”` : "that form"
                  } inside this window`
                : "No record carries a date inside this window"
            }
            description={
              formFilter
                ? "The filter is still on. Widen the window above, or show every form to see what the window holds without it."
                : "Widen the window above. A download of this report is an empty table with the same notes written above it, never a row invented to fill the space."
            }
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
          <li>
            The window is the only selector that applies to every list. The two form lists can also
            be narrowed to one form, from the Forms board or its form page; opening a report by hand
            cannot be filtered by opening or recruiter.
          </li>
        </ul>
      </Card>
    </div>
  );
}
