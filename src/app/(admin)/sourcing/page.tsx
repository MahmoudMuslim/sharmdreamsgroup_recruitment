import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getOutreachCopy, getProspectJobs, getProspects } from "./actions";
import { SourcingBoard } from "./SourcingBoard";

export const metadata = {
  title: "Sourcing · Sharm Dreams Talent Cloud",
  description: "Prospects you found off-pipeline, loaded for outreach",
};

/** Auth-gated route: the pool is staff-only and RLS-scoped. */
export const instant = false;

export default async function SourcingPage() {
  await connection();
  const user = await requireStaff("/sourcing");

  const [canWrite, canDelete, canSend, prospects, jobs, copy] = await Promise.all([
    hasPermissionForUser("candidates.write"),
    hasPermissionForUser("candidates.delete"),
    hasPermissionForUser("messages.send"),
    getProspects(),
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
        prospects={prospects}
        jobs={jobs}
        copy={copy}
        canWrite={canWrite}
        canDelete={canDelete}
        canSend={canSend}
      />
    </AdminShell>
  );
}
