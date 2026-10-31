import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getQuestionBankData } from "./actions";
import { BankBoard } from "./BankBoard";

export const metadata = {
  title: "Question Bank",
  description: "Write and place every apply-form and assessment question the portal holds",
};

/** Auth-gated route, and the questions belong to whoever is signed in. */
export const instant = false;

export default async function QuestionBankPage() {
  await connection();
  await requireStaff("/questions");

  const data = await getQuestionBankData();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Hiring"
        title="Question bank"
        description="Every question a recruiter has written, in one place — the no-points ones a candidate answers on an apply form, and the marked ones inside a test suite. Add, rewrite, reorder, switch off, delete and place them from here, as a list grouped any way you ask or as a board of the roles and suites that ask them. This page owns no table: each control writes a real row in one of the two stores, through the action that owns it."
      />

      <BankBoard data={data} />
    </PageTransition>
  );
}
