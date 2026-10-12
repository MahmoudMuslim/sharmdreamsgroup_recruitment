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

async function loadTemplates() {
  const [templates, candidates, options] = await Promise.all([
    getTemplates(),
    getAssignableCandidates(),
    getMasterOptions(),
  ]);

  return { templates, candidates, options };
}

export default async function AssessmentsBuilderPage() {
  await connection();
  const user = await requireStaff("/assessments");

  // Fetched in the page component rather than behind a <Suspense> boundary.
  // The page is already request-time (await connection() above), so a boundary
  // here only produced a static shell whose hole the client had to re-fetch —
  // and on a hard load that fetch never landed, leaving the skeleton up
  // forever and every button unclickable.
  const { templates, candidates, options } = await loadTemplates();

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Assessment engine"
        title="Test suite builder"
        description="Every suite currently defined for the group, with live question counts and assignment activity."
      />

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            title="No assessment suites yet"
            description="Create a suite to start evaluating candidates with Excel models, video pitches and case studies."
            icon={<ClipboardCheck className="h-8 w-8" aria-hidden />}
          />
        </Card>
      ) : (
        <AssessmentGrid
          templates={templates}
          candidates={candidates}
          options={{
            roleFamilies: options.roleFamilies,
            companies: options.companies,
          }}
        />
      )}
    </AdminShell>
  );
}