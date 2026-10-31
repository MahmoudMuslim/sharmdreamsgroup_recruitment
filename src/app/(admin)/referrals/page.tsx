import { Gift } from "lucide-react";
import { getReferralBoard } from "./actions";
import { ReferralsBoard } from "./ReferralsBoard";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Referrals",
  description: "The employee referral book: who brought whom, where they stand, and what was decided",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function ReferralsPage() {
  await connection();
  await requireStaff("/referrals");
  const desk = await getReferralBoard();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Hiring"
        title="Referrals"
        description="Every claim by a member of staff on a person for a role. A claim's progress is the linked application's stage, read here rather than copied, so a move made on the candidates page shows up on the next load."
      />

      <ReferralsBoard desk={desk} />

      <Card className="mt-6 flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <Gift className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-display text-base font-bold">How the book works</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            Your link is durable: it carries the same code for every role, and whoever applies
            through it is credited to you. A person who applied another way can be filed by hand,
            by anybody on staff, so long as they have not already been claimed for that role by
            somebody else — the database holds that rule, not this screen.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            A hiring manager reads their own book. A recruiter reads every book, can move a claim
            to the person who actually made the introduction, and records the bonus decision —
            pending, paid or declined — with a note. The decision is a record of what the
            programme said, not a payment: no money moves from this screen.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            The numbers are populations, not conversions: how many claims are invited, in the
            pipeline, hired or closed right now. A claim with no application yet is waiting on the
            person, not failing.
          </p>
        </div>
      </Card>
    </PageTransition>
  );
}
