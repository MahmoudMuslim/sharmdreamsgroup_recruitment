import { ShieldCheck } from "lucide-react";
import { connection } from "next/server";
import { getTrail } from "./actions";
import { ActivityView } from "./ActivityView";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
import { TRAIL_LIST } from "@/modules/activity/domain/trail";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

export const metadata = {
  title: "Activity · Sharm Dreams Group",
  description: "Every change to the hiring data, and who or what made it",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

const DEFAULT_WINDOW = "30d" as const;

export default async function ActivityPage() {
  await connection();
  const user = await requireStaff("/activity");

  const canRead = await hasPermissionForUser("settings.manage_platform");

  const result = canRead
    ? await getTrail({ window: DEFAULT_WINDOW })
    : {
        ok: false as const,
        error:
          "Reading the change trail needs the Manage platform settings permission.",
      };

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Oversight"
        title="Activity"
        description="Every change the portal makes, with the name or the engine behind it: a recruiter moving a candidate, the screening engine deciding a fit score, a scheduler closing an expired test. Each row says who, when, through which door and what moved — and the fields that must not be kept are recorded as withheld rather than stored."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            settings.manage_platform
          </span>
        }
      />

      {!result.ok || !result.view ? (
        <Card className="mt-6 p-6">
          <EmptyState
            title={canRead ? "The trail could not be read" : "This trail is not open to you"}
            description={
              result.error ??
              "The rows could not be read. Nothing here is estimated, so an unavailable trail is shown as one rather than as an empty feed."
            }
          />
        </Card>
      ) : (
        <ActivityView
          initial={result.view}
          formats={EXPORT_FORMATS}
          caveats={TRAIL_LIST.caveats}
        />
      )}
    </AdminShell>
  );
}
