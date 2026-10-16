import { CalendarDays } from "lucide-react";
import { getInterviewAgenda } from "./actions";
import { InterviewAgenda } from "./InterviewAgenda";
import { listInterviewers } from "@/app/(admin)/candidates/interview-actions";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Interview Agenda",
  description: "Every scheduled panel across the group, grouped by day, and the desk they are moved from",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function InterviewsPage() {
  await connection();
  const [user, interviews, timeZone, canWrite] = await Promise.all([
    requireStaff("/interviews"),
    getInterviewAgenda(),
    getOrganisationTimeZone(),
    hasPermissionForUser("candidates.write"),
  ]);
  // Read in the render rather than on first click, so opening an editor never
  // stalls on a round-trip for the panel roster.
  const interviewers = canWrite ? await listInterviewers() : [];

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Hiring calendar"
        title="Interviews"
        description={`Scheduled panels for the whole group. Times and day boundaries follow the organisation timezone (${timeZone}).`}
      />

      <InterviewAgenda
        interviews={interviews}
        timeZone={timeZone}
        canWrite={canWrite}
        interviewers={interviewers}
      />

      <Card className="mt-6 flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-display text-base font-bold">Moving a panel</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            The first invitation is sent from a candidate&apos;s profile, because booking needs the
            application, the stage and the notice together. Everything after that happens here:
            move a panel to a new slot, change who interviews, or record the outcome — completed,
            no-show, cancelled — without leaving the calendar. A move is messaged to the candidate
            over every channel that is switched on; an outcome stays internal.
          </p>
        </div>
      </Card>
    </AdminShell>
  );
}