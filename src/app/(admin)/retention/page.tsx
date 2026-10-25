import { ShieldCheck } from "lucide-react";
import { connection } from "next/server";

import { requireStaff } from "@/lib/auth/session";

import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";

import { getRetentionDesk } from "./actions";
import { RetentionBoard } from "./RetentionBoard";

export const metadata = {
  title: "Privacy & retention",
  description:
    "The privacy desk: requests to see or erase a candidate's data, and the records inside a retention window",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function RetentionPage() {
  await connection();
  await requireStaff("/retention");
  const data = await getRetentionDesk();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Records"
        title="Privacy & retention"
        description="What people have asked us to show or erase, and which application records are inside a retention window. The desk reads the same rules the nightly sweep obeys, so the date printed beside a row is the date acted on."
      />

      <RetentionBoard data={data} />

      <Card className="mt-6 flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-display text-base font-bold">How the desk works</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            A request moves in one direction: a recruiter or the owner verifies that the person
            asking is the person on the record, the owner approves or declines it, and the owner
            runs it. Verifying matches the address to an application on file; it does not mail
            anything. Approving decides what happens next. Running an access request mails a
            bounded copy; running an erasure removes the stored files and blanks the person&apos;s
            data while keeping the application row, its stage, its scores and its dates.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            The sweep is the only thing that erases on a timer, and it ships off. Even switched on,
            it warns first and then waits the stated warning days before removing anything, so a
            record that is already due on the first run is warned rather than deleted. Hired
            records and records with an assessment or interview still open are never erased.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            The tiles are populations, not rates: how many requests sit in each state and how many
            records are due, warned or held right now. The windows themselves live under Settings →
            Privacy &amp; retention, and changing one changes both this screen and the public
            notice.
          </p>
        </div>
      </Card>
    </PageTransition>
  );
}
