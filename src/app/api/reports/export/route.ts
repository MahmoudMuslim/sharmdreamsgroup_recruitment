/**
 * The one door a report leaves the building through.
 *
 * A page can hide a button; only a route can refuse a file. So every download
 * — from the Analytics page, the Reports page or the candidates toolbar, in any
 * of the three formats — comes here, re-reads the data from the database and
 * re-checks `analytics.export` before a single byte is rendered. Handing the
 * browser a copy of the report and letting it build the file would make the
 * grant decorative.
 */

import {
  buildExport,
  EXPORT_FORMATS,
  type ExportDocument,
  type ExportFormat,
} from "@/modules/analytics/domain/exportDocument";
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from "@/modules/analytics/domain/report";
import {
  buildCandidateExport,
  buildReportDocument,
  type CandidateExportFilters,
} from "@/modules/analytics/infrastructure/reportReader";
import { REPORTS, type ReportId } from "@/modules/analytics/domain/documents";
import {
  isApplicationSource,
  isCandidateSort,
  isCompanyId,
  isPipelineStage,
  type CandidateSort,
} from "@/modules/candidates/domain/listFilters";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getSessionUser, isStaff } from "@/lib/auth/session";

/** A download is a file, not a page — `requireStaff()` would redirect instead of refusing. */
function json(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Query strings are attacker-controlled, so every parameter is coerced or refused. */
function safeReport(value: string | null): "analytics" | ReportId | "candidates" | null {
  if (value === "analytics" || value === "candidates") return value;
  return REPORTS.some((report) => report.id === value) ? (value as ReportId) : null;
}

function safeWindow(value: string | null): AnalyticsWindow | null {
  return ANALYTICS_WINDOWS.some((option) => option.key === value)
    ? (value as AnalyticsWindow)
    : null;
}

function safeFormat(value: string | null): ExportFormat | null {
  return EXPORT_FORMATS.some((format) => format.key === value) ? (value as ExportFormat) : null;
}

/**
 * The candidates console's filters, as the toolbar holds them.
 *
 * Stage and source are whitelisted enums and an unknown value is dropped rather
 * than passed on; the free text is only ever compared in JavaScript, so its
 * length is capped and no SQL operator can be spelled with it. The company is a
 * uuid or nothing, because it is the one of these that reaches Postgres as an
 * embed filter — a name in that slot would surface as a database error mid-
 * download. The two view switches are flags a page sets on this same href, so
 * they are read here as the booleans the reader already sees.
 */
function candidateFilters(params: URLSearchParams): CandidateExportFilters {
  const sort: CandidateSort = isCandidateSort(params.get("sort"));
  return {
    stage: isPipelineStage(params.get("stage")),
    source: isApplicationSource(params.get("source")),
    company: isCompanyId(params.get("company")),
    query: params.get("q")?.trim().slice(0, 120) || null,
    sort,
    archived: params.get("archived") === "1",
    ungraded: params.get("ungraded") === "1",
  };
}

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json("Sign in as a staff member to download a report.", 401);
  }

  if (!(await hasPermissionForUser("analytics.export"))) {
    return json("Downloading a report needs the Export analytics permission.", 403);
  }

  const params = new URL(request.url).searchParams;
  const report = safeReport(params.get("report"));
  const format = safeFormat(params.get("format"));
  if (!report || !format) return json("A report and a format are both required.", 400);

  let built: { document: ExportDocument } | { error: string };
  if (report === "candidates") {
    /* The candidates list is cut by its filters, not by a window: there is no
     * window on that screen to carry into a file. */
    built = await buildCandidateExport(
      candidateFilters(params),
      user.fullName
    );
  } else {
    const window = safeWindow(params.get("window"));
    if (!window) {
      return json("A report, a window and a format are all required.", 400);
    }
    built = await buildReportDocument(report, window, user.fullName);
  }
  if ("error" in built) return json(built.error, 500);

  const file = await buildExport(built.document, format);
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      /** A report is candidate PII: keep it out of any shared cache on the way out. */
      "X-Content-Type-Options": "nosniff",
    },
  });
}
