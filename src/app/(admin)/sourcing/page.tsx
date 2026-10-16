import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getOutreachCopy, getProspectJobs, getProspectPool } from "./actions";
import { isProspectStage } from "./pool-model";
import { SourcingBoard } from "./SourcingBoard";

export const metadata = {
  title: "Sourcing · Sharm Dreams Talent Cloud",
  description: "Prospects you found off-pipeline, loaded for outreach",
};

/** Auth-gated route: the pool is staff-only and RLS-scoped. */
export const instant = false;

/**
 * `?stage=` is the chip the recruiter clicked, and it filters the *query* over
 * the whole pool rather than the rows this render happens to hold — the same
 * decision `/candidates` makes for its rails. It arrives through the pool's
 * validator, so a parameter that names no stage narrows nothing instead of
 * quietly emptying the board. `?prospect=` is left to the board, which opens
 * that one record.
 */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await connection();
  const user = await requireStaff("/sourcing");

  const params = await searchParams;
  const stage = isProspectStage(params.stage);

  const [canWrite, canDelete, canSend, pool, openings, copy] = await Promise.all([
    hasPermissionForUser("candidates.write"),
    hasPermissionForUser("candidates.delete"),
    hasPermissionForUser("messages.send"),
    getProspectPool({ stage }),
    getProspectJobs(),
    getOutreachCopy(),
  ]);

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Talent pool"
        title="Sourcing"
        description="People you found yourself — a LinkedIn search, a conference list, a referral — loaded here so they are more than a browser tab."
      />

      <SourcingBoard
        prospects={pool.prospects}
        totals={pool.totals}
        stage={stage}
        jobs={openings.jobs}
        jobsTotal={openings.total}
        copy={copy}
        canWrite={canWrite}
        canDelete={canDelete}
        canSend={canSend}
      />
    </AdminShell>
  );
}
