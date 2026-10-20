import { ShieldCheck } from "lucide-react";
import { connection } from "next/server";
import { getTrail } from "./actions";
import type { TrailQuery } from "./actions";
import { paramsToQuery } from "@/modules/activity/domain/trailQuery";
import { ActivityView } from "./ActivityView";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
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

/**
 * The first cut the screen renders comes from the address bar, so a link a
 * recruiter pastes into the chat lands on the rows it names — the page and the
 * filters alike. Everything is re-coerced by `resolveTrailQuery` on the way to the
 * read, so a parameter that names no window or no page narrows nothing instead of
 * emptying the trail.
 */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  await requireStaff("/activity");

  const canRead = await hasPermissionForUser("settings.manage_platform");
  const params = await searchParams;

  const query: TrailQuery = paramsToQuery(
    new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) =>
        value === undefined ? [] : Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]
      )
    )
  );
  if (!query.window) query.window = DEFAULT_WINDOW;

  const result = canRead
    ? await getTrail(query)
    : {
        ok: false as const,
        error:
          "Reading the change trail needs the Manage platform settings permission.",
      };

  return (
    <PageTransition>
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
    </PageTransition>
  );
}
