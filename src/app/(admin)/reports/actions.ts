"use server";

import { requireStaff } from "@/lib/auth/session";
import { REPORTS, type ReportId } from "@/modules/analytics/domain/documents";
import type { ExportSheet } from "@/modules/analytics/domain/exportDocument";
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from "@/modules/analytics/domain/report";
import { readRowReport } from "@/modules/analytics/infrastructure/reportReader";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

const VIEW_DENIED = "These reports need the View analytics permission.";

/**
 * How many rows the screen draws.
 *
 * The preview is a sample so a recruiter can see the shape of a report without
 * shipping 4,000 rows to the browser; the download is built by the route from
 * the same read, and says so on the page.
 */
const PREVIEW_ROWS = 150;

export interface RowReportPreview {
  ok: boolean;
  error?: string;
  report?: ReportId;
  window?: AnalyticsWindow;
  sheet?: ExportSheet;
  /** Rows the read actually returned, so the page can say what the preview left out. */
  totalRows?: number;
  limitations?: string[];
  /** What the list is cut by, e.g. "90 days · only “Careers”". */
  scope?: string;
  /** The form the list was narrowed to, when `formId` named a live form. */
  formName?: string | null;
  timeZone?: string;
  generatedAt?: string;
}

/** Both a tab id and a window key arrive from a client component: neither shape is trusted. */
function safeReport(value: unknown): ReportId | null {
  return REPORTS.some((report) => report.id === value) ? (value as ReportId) : null;
}

function safeWindow(value: unknown): AnalyticsWindow | null {
  return ANALYTICS_WINDOWS.some((option) => option.key === value)
    ? (value as AnalyticsWindow)
    : null;
}

/** A form id arrives from a URL or a client component; only a uuid reaches the read. */
const FORM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFormId(value: unknown): string | null {
  return typeof value === "string" && FORM_ID.test(value) ? value : null;
}

/**
 * One row-level report, re-checked on every call.
 *
 * The page renders the first tab server-side and this action serves the others,
 * so both paths ask the database for `analytics.view` rather than trusting the
 * caller — a server action is a public endpoint.
 *
 * `formId` narrows only the two form reports: `readRowReport` ignores it on the
 * others, and a value that is not a uuid is dropped here so the screen can never
 * ask the database to widen a query with junk.
 */
export async function getRowReport(
  id: unknown,
  windowKey: unknown,
  formId: unknown = null
): Promise<RowReportPreview> {
  await requireStaff("/reports");

  if (!(await hasPermissionForUser("analytics.view"))) {
    return { ok: false, error: VIEW_DENIED };
  }

  const report = safeReport(id);
  const win = safeWindow(windowKey);
  if (!report || !win) return { ok: false, error: "That report or window does not exist." };

  const form = safeFormId(formId);
  const result = await readRowReport(report, win, { formId: form });
  if (result.error || !result.sheet) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    report,
    window: win,
    sheet: {
      ...result.sheet,
      rows: result.sheet.rows.slice(0, PREVIEW_ROWS),
    },
    totalRows: result.sheet.rows.length,
    limitations: result.limitations,
    scope: result.scope,
    formName: result.formName,
    timeZone: result.timeZone,
    generatedAt: result.generatedAt,
  };
}
