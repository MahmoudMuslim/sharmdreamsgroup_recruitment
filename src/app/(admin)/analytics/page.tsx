import { BarChart3 } from "lucide-react";
import { connection } from "next/server";
import { getAnalyticsReport } from "./actions";
import { AnalyticsView } from "./AnalyticsView";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

export const metadata = {
  title: "Analytics",
  description: "Assessment, sourcing, messaging and interview reporting",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function AnalyticsPage() {
  await connection();
  await requireStaff("/analytics");

  const [canExport, result] = await Promise.all([
    hasPermissionForUser("analytics.export"),
    getAnalyticsReport("90"),
  ]);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Reporting"
        title="Analytics"
        description="How the funnel behaves once a candidate is in it: whether issued tests get opened and finished, how an outbound pool converts, whether candidate messages land, and what the interview panel load looks like. Window boundaries and any dated label follow the organisation timezone."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <BarChart3 className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            90 days by default
          </span>
        }
      />

      {!result.ok || !result.report ? (
        <Card className="mt-6 p-6">
          <EmptyState
            title="This report is not available to you"
            description={
              result.error ??
              "The figures could not be read. Nothing on this page is estimated, so an unavailable report is shown as one rather than as zeros."
            }
          />
        </Card>
      ) : (
        <AnalyticsView report={result.report} formats={EXPORT_FORMATS} canExport={canExport} />
      )}
    </PageTransition>
  );
}
