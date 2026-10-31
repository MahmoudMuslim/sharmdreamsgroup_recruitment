import { connection } from "next/server";
import { Timer } from "lucide-react";
import { getLedger } from "./actions";
import { TimeView } from "./TimeView";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { LEDGER_NOTES, TRACK_DENIED } from "@/modules/timelog/domain/ledger";

export const metadata = {
  title: "Time Tracker",
  description: "Hours logged against candidates, openings and the hiring paperwork",
};

/** Auth-gated route: the ledger is different rows for every staff account. */
export const instant = false;

/**
 * The first cut the screen renders comes from the address bar, so a link a
 * recruiter pastes into the chat lands on the window and scope it names. An
 * unknown value narrows nothing instead of emptying the ledger: `ledgerCut`
 * coerces it to the default, and the screen says which cut it actually read.
 */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** A repeated parameter is not a cut; a browser reads the first value, so this does too. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TimePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  await requireStaff("/time");

  const canTrack = await hasPermissionForUser("time.track");
  const params = await searchParams;

  const result = canTrack
    ? await getLedger({ window: first(params.window), scope: first(params.scope) })
    : { ok: false as const, error: TRACK_DENIED };

  const view = result.view;

  return (
    <PageTransition>
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
            {/*
              The window is not repeated here: the pills below change it without
              re-rendering this server component, so a label in the header would
              keep claiming the cut the page loaded with. The lit pill and the
              status line under it state the cut that is on screen.
            */}
            {view && (
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
                {view.timeZone} clock
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
        <TimeView
          initial={view}
          caveats={LEDGER_NOTES.caveats}
          exportFormats={EXPORT_FORMATS}
        />
      )}
    </PageTransition>
  );
}
