import { FileSpreadsheet } from "lucide-react";
import { connection } from "next/server";
import { REPORTS } from "@/modules/analytics/domain/documents";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
import { ANALYTICS_WINDOWS } from "@/modules/analytics/domain/report";
import { getRowReport } from "./actions";
import { ReportsView } from "./ReportsView";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

export const metadata = {
  title: "Reports · Sharm Dreams Group",
  description: "Row-level hiring lists, downloadable as CSV, Excel or PDF",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

const DEFAULT_REPORT = "pipeline" as const;
const DEFAULT_WINDOW = "90" as const;

/**
 * The screen is addressable: `?report=…&window=…&form=…` opens it on that tab.
 *
 * A deep link from the Forms board names a form report and a form, so a
 * recruiter lands on the applications filed against that form rather than on
 * the pipeline tab. The report and window are matched against the shipped
 * vocabulary here and fall back to the defaults, so a hand-typed address can
 * still draw the page; the form id is validated by the action it is passed to.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireStaff("/reports");

  const params = await searchParams;
  const pick = (key: string): string | null => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  const [canView, canExport] = await Promise.all([
    hasPermissionForUser("analytics.view"),
    hasPermissionForUser("analytics.export"),
  ]);

  const report = REPORTS.find((option) => option.id === pick("report"))?.id ?? DEFAULT_REPORT;
  const window = ANALYTICS_WINDOWS.find((option) => option.key === pick("window"))?.key ?? DEFAULT_WINDOW;
  const form = pick("form");

  const result = canView
    ? await getRowReport(report, window, form)
    : { ok: false as const, error: "These reports need the View analytics permission." };

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        description="The lists behind the analytics numbers: every application, every issued test, every sourced prospect, every candidate message, every interview panel, every application form, every form question, every unclaimed upload and every person profile in the window you pick. Anything you can see here you can take with you, in CSV, Excel or PDF."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            CSV, Excel and PDF
          </span>
        }
      />

      {!result.ok || !result.sheet || !result.report || !result.window ? (
        <Card className="mt-6 p-6">
          <EmptyState
            title="These reports are not available to you"
            description={
              result.error ??
              "The rows could not be read. Nothing on this page is estimated, so an unavailable report is shown as one rather than as an empty table."
            }
          />
        </Card>
      ) : (
        <ReportsView
          definitions={REPORTS}
          formats={EXPORT_FORMATS}
          canExport={canExport}
          initial={{
            report: result.report,
            window: result.window,
            sheet: result.sheet,
            totalRows: result.totalRows ?? result.sheet.rows.length,
            limitations: result.limitations ?? [],
            scope: result.scope ?? "",
            timeZone: result.timeZone ?? "",
            formId: result.formName == null ? null : form,
            formName: result.formName ?? null,
          }}
        />
      )}

    </PageTransition>
  );
}
