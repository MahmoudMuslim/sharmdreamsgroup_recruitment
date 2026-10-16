"use server";

import { requireStaff } from "@/lib/auth/session";
import {
  ANALYTICS_WINDOWS,
  type AnalyticsReport,
  type AnalyticsWindow,
} from "@/modules/analytics/domain/report";
import {
  parseDrillScope,
  readAnalyticsDrill,
  type AnalyticsDrillResult,
} from "@/modules/analytics/infrastructure/analyticsDrill";
import { readAnalyticsReport } from "@/modules/analytics/infrastructure/reportReader";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

const VIEW_DENIED = "This report needs the View analytics permission.";

export interface AnalyticsResult {
  ok: boolean;
  report?: AnalyticsReport;
  error?: string;
}

/** A window key arrives from a client component, so its shape is checked. */
function safeWindow(value: unknown): AnalyticsWindow {
  return ANALYTICS_WINDOWS.some((option) => option.key === value)
    ? (value as AnalyticsWindow)
    : "90";
}

/**
 * The report for one window.
 *
 * The page calls this during its own render, and the view calls it again when
 * the window changes. Both paths re-check the permission rather than trusting
 * that the caller is the page — a server action is a public endpoint. Downloads
 * do not go through here: they re-read through the export route, where the
 * `analytics.export` grant decides what leaves the building.
 */
export async function getAnalyticsReport(value: unknown): Promise<AnalyticsResult> {
  await requireStaff("/analytics");

  if (!(await hasPermissionForUser("analytics.view"))) {
    return { ok: false, error: VIEW_DENIED };
  }

  const { report, error } = await readAnalyticsReport(safeWindow(value));
  return report
    ? { ok: true, report }
    : { ok: false, error: error ?? "The report could not be built." };
}

/**
 * The rows behind one figure, for the popup that opens when it is clicked.
 *
 * `{ window, scope }` is built in the browser, so both halves are re-checked
 * here: the window against the four the page offers, the scope against the
 * figures the page draws. The rows come from the same read as the report, which
 * is what lets a popup name a total its card agrees with — and why a caller
 * with masked scores gets a list with no scores in it, since the reader drops
 * them before a figure is ever counted.
 */
export async function getAnalyticsDrilldown(input: unknown): Promise<AnalyticsDrillResult> {
  await requireStaff("/analytics");

  if (!(await hasPermissionForUser("analytics.view"))) {
    return { ok: false, error: VIEW_DENIED };
  }

  const request = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  if (!request) return { ok: false, error: "No figure was asked for." };

  const scope = parseDrillScope(request.scope);
  if (!scope) return { ok: false, error: "That figure is not one this page can list." };

  return readAnalyticsDrill(scope, safeWindow(request.window));
}
