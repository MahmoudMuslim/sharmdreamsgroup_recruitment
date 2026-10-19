import { ShieldQuestion } from "lucide-react";
import { connection } from "next/server";
import { getGateConsoleData } from "./actions";
import { GateQuestionBoard } from "./GateQuestionBoard";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";

export const metadata = {
  title: "Apply Questions · Sharm Dreams Talent Cloud",
  description: "Write the no-points viability questions candidates answer on the public apply form",
};

/** Auth-gated route, and the questions belong to whoever is signed in. */
export const instant = false;

export default async function ApplyQuestionsPage() {
  await connection();
  await requireStaff("/apply-questions");

  const canManage = await hasPermissionForUser("jobs.manage");
  const data = canManage ? await getGateConsoleData() : null;

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Careers site"
        title="Apply form questions"
        description="Ask a role's requirements before anyone spends a CV read on them. These questions carry no points: an answer the role cannot accept records the application as rejected for your team to see, while the applicant is shown the ordinary receipt screen — nothing tells them which answer decided it."
      />

      {!canManage || !data ? (
        <Card>
          <EmptyState
            title="Questions follow the Manage jobs permission"
            description="These questions decide who can be considered for a role, so they are written by the people who publish it. Ask an administrator for the Manage jobs permission to add or change them."
            icon={<ShieldQuestion className="h-8 w-8" aria-hidden />}
          />
        </Card>
      ) : (
        <GateQuestionBoard questions={data.questions} jobs={data.jobs} canManage />
      )}
    </PageTransition>
  );
}
