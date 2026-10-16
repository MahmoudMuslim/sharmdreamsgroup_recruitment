import { connection } from "next/server";
import { Timer } from "lucide-react";
import { getLedger } from "./actions";
import { TimeView } from "./TimeView";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { LEDGER_NOTES, timeWindow, TRACK_DENIED } from "@/modules/timelog/domain/ledger";

export const metadata = {
  title: "Time Tracker · Sharm Dreams Group",
  description: "Hours logged against candidates, openings and the hiring paperwork",
};

/** Auth-gated route: the ledger is different rows for every staff account. */
export const instant = false;

const DEFAULT_WINDOW = "7d" as const;
const DEFAULT_SCOPE = "mine" as const;

export default async function TimePage() {
  await connection();
  const user = await requireStaff("/time");

  const canTrack = await hasPermissionForUser("time.track");

  const result = canTrack
    ? await getLedger({ window: DEFAULT_WINDOW, scope: DEFAULT_SCOPE })
    : { ok: false as const, error: TRACK_DENIED };

  const view = result.view;

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Day to day"
        title="Time Tracker"
        description={
          "Someone starts a timer against a candidate, an opening or the paperwork around them, and the ledger measures the span with the database clock. Hours are not inferred: a stage move, an interview or a grade adds nothing here unless a person logs it — so the rows are what the team says it worked, on the office wall clock rather than the browser's."
        }
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
              <Timer className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              time.track
            </span>
            {view && (
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
                {timeWindow(view.window).label} · {view.timeZone}
              </span>
            )}
          </>
        }
      />

      {!view ? (
        <Card className="mt-6 p-6">
          <EmptyState
            title={canTrack ? "The ledger could not be read" : "This ledger is not open to you"}
            icon={<Timer className="h-7 w-7" aria-hidden />}
            description={
              result.error ??
              "Nothing here is estimated, so a ledger that cannot be read is shown as unreadable rather than as a week with no hours in it."
            }
          />
        </Card>
      ) : (
        <TimeView initial={view} caveats={LEDGER_NOTES.caveats} />
      )}
    </AdminShell>
  );
}
