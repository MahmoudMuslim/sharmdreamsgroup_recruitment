import { FileSpreadsheet } from "lucide-react";
import { connection } from "next/server";
import { REPORTS } from "@/modules/analytics/domain/documents";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
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

export default async function ReportsPage() {
  await connection();
  await requireStaff("/reports");

  const [canView, canExport] = await Promise.all([
    hasPermissionForUser("analytics.view"),
    hasPermissionForUser("analytics.export"),
  ]);

  const result = canView
    ? await getRowReport(DEFAULT_REPORT, DEFAULT_WINDOW)
    : { ok: false as const, error: "These reports need the View analytics permission." };

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        description="The lists behind the analytics numbers: every application, every issued test, every sourced prospect, every candidate message and every interview panel in the window you pick. Anything you can see here you can take with you, in CSV, Excel or PDF."
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
          }}
        />
      )}

    </PageTransition>
  );
}
