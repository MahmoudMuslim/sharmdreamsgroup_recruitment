import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { getFilingVocabularies } from "@/modules/jobs/application/filingVocabularies";
import { NewJobDrawer, type JobFormOptions } from "./JobFormDrawer";
import { JobsBrowser, type JobRow } from "./JobsBrowser";
import { connection } from "next/server";

export const metadata = {
  title: "Job openings",
  description: "Multi-company showcase of published roles",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function JobsPage() {
  await connection();
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const [result, canManage, canDecide, filing] = await Promise.all([
    supabase
      .from("job_openings")
      .select(
        "id, title, tenant_id, department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applications(count)"
      )
      // The badge has to agree with the applicant list it opens, which hides
      // filed candidates.
      .is("applications.archived_at", null)
      .order("created_at", { ascending: false }),
    hasPermissionForUser("jobs.manage"),
    hasPermissionForUser("candidates.write"),
    getFilingVocabularies(supabase).then((read) => read.vocabularies),
  ]);

  const master = await getMasterOptions();
  const options: JobFormOptions = {
    companies: master.companies,
    departments: master.departments,
    locations: master.locations,
    currencies: master.currencies,
    // Every row of the four lists an opening files itself under, retired ones
    // included — the picker only offers the live rows, so the drawer needs the
    // rest to label a legacy value it cannot offer.
    filing,
  };
  const jobs = (result.data ?? []) as unknown as JobRow[];

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Requisitions"
        title="Job openings"
        description="Every published and draft role across the group's companies."
        actions={canManage ? <NewJobDrawer options={options} /> : undefined}
      />

      <JobsBrowser jobs={jobs} options={options} canManage={canManage} canDecide={canDecide} />
    </PageTransition>
  );
}
