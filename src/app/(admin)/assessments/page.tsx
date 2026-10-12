import { Suspense } from "react";
import { ClipboardCheck } from "lucide-react";
import { getTemplates, getAssignableCandidates } from "./actions";
import { AssessmentGrid } from "./AssessmentGrid";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { connection } from "next/server";

export const metadata = {
  title: "Assessment Builder",
  description: "Design Excel, video, case-study and quiz evaluation suites",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

async function TemplateList() {
  const [templates, candidates, options] = await Promise.all([
    getTemplates(),
    getAssignableCandidates(),
    getMasterOptions(),
  ]);

  if (templates.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No assessment suites yet"
          description="Create a suite to start evaluating candidates with Excel models, video pitches and case studies."
          icon={<ClipboardCheck className="h-8 w-8" aria-hidden />}
        />
      </Card>
    );
  }

  return (
    <AssessmentGrid
      templates={templates}
      candidates={candidates}
      options={{
        roleFamilies: options.roleFamilies,
        companies: options.companies,
      }}
    />
  );
}

export default async function AssessmentsBuilderPage() {
  await connection();
  const user = await requireStaff("/assessments");

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Assessment engine"
        title="Test suite builder"
        description="Every suite currently defined for the group, with live question counts and assignment activity."
      />

      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        }
      >
        <TemplateList />
      </Suspense>
    </AdminShell>
  );
}