import { getTemplates, getAssignableCandidates, getQuestionsForEditor, getIssuedLinks } from "./actions";
import { AssessmentGrid } from "./AssessmentGrid";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { getNumberSetting, getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { connection } from "next/server";

export const metadata = {
  title: "Assessment Builder",
  description: "Design Excel, video, case-study and quiz suites, then read the answers they bring back",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

async function loadTemplates() {
  const [templates, candidates, options, questionsByTemplate, links, timeZone] = await Promise.all([
    getTemplates(),
    getAssignableCandidates(),
    getMasterOptions(),
    getQuestionsForEditor(),
    getIssuedLinks(),
    getOrganisationTimeZone(),
  ]);

  return { templates, candidates, options, questionsByTemplate, links, timeZone };
}

export default async function AssessmentsBuilderPage() {
  await connection();
  await requireStaff("/assessments");

  // Fetched in the page component rather than behind a <Suspense> boundary.
  // The page is already request-time (await connection() above), so a boundary
  // here only produced a static shell whose hole the client had to re-fetch —
  // and on a hard load that fetch never landed, leaving the skeleton up
  // forever and every button unclickable.
  const { templates, candidates, options, questionsByTemplate, links, timeZone } =
    await loadTemplates();
  const canEdit = await hasPermissionForUser("assessments.create");
  const defaultDurationMinutes = await getNumberSetting(
    "assessment.default_duration_minutes",
    60
  );

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Assessment engine"
        title="Test suite builder"
        description="Every suite currently defined for the group, the links candidates hold, and the answers those links brought back."
      />

      {/* Rendered even with zero suites: the create drawer lives inside the
          grid, so hiding the grid behind an empty state made the very first
          suite impossible to create from the portal. */}
      <AssessmentGrid
        templates={templates}
        candidates={candidates}
        options={{
          roleFamilies: options.roleFamilies,
          companies: options.companies,
        }}
        questionsByTemplate={questionsByTemplate}
        defaultDurationMinutes={defaultDurationMinutes}
        canEdit={canEdit}
        links={links}
        timeZone={timeZone}
      />
    </PageTransition>
  );
}