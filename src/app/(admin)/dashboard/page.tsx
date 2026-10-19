import { Zap } from "lucide-react";
import { getDashboardAnalytics } from "./actions";
import { DashboardView } from "./DashboardView";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import type { DashboardAnalytics } from "@/types";
import { connection } from "next/server";

export const metadata = {
  title: "Recruiter Analytics Dashboard",
  description: "Real-time hiring pipeline, AI fit scores and channel effectiveness",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function DashboardPage() {
  await connection();
  await requireStaff("/dashboard");

  // Fetched in the page component rather than behind a <Suspense> boundary.
  // The page is already request-time (await connection() above), so the boundary
  // only produced a static shell whose hole the client had to re-fetch — and on
  // a hard load that fetch intermittently never landed, leaving the skeleton up
  // forever.
  const analytics: DashboardAnalytics = await getDashboardAnalytics();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Recruit intelligence"
        title="Hiring overview"
        description="Real-time pipeline movement, AI fit scores and sourcing performance across the Sharm Dreams Group."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Zap className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Live data
          </span>
        }
      />

      <DashboardView analytics={analytics} />
    </PageTransition>
  );
}
