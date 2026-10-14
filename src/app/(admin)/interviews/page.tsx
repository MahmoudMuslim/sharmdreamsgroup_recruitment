import { CalendarDays } from "lucide-react";
import { getInterviewAgenda } from "./actions";
import { InterviewAgenda } from "./InterviewAgenda";
import { requireStaff } from "@/lib/auth/session";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Interview Agenda",
  description: "Every scheduled panel across the group, grouped by day",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function InterviewsPage() {
  await connection();
  const [user, interviews, timeZone] = await Promise.all([
    requireStaff("/interviews"),
    getInterviewAgenda(),
    getOrganisationTimeZone(),
  ]);

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Hiring calendar"
        title="Interviews"
        description={`Scheduled panels for the whole group. Times and day boundaries follow the organisation timezone (${timeZone}).`}
      />

      <InterviewAgenda interviews={interviews} timeZone={timeZone} />

      <Card className="mt-6 flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-display text-base font-bold">Booking a panel</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            Interviews are scheduled from a candidate&apos;s profile, so the slot, the interviewer
            and the WhatsApp confirmation to the candidate are set together. Rescheduling and
            outcomes (completed, no-show, cancelled) are recorded from the same place.
          </p>
        </div>
      </Card>
    </AdminShell>
  );
}