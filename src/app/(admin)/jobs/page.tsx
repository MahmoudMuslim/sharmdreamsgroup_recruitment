import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { getFilingVocabularies } from "@/modules/jobs/application/filingVocabularies";
import { getOpeningsHeadcount } from "@/modules/jobs/application/hiringDemand";
import { GRID_ROW_LIMIT } from "@/modules/jobs/domain/hireable";
import { HIRED_STAGE, IN_PIPELINE_STAGES } from "@/modules/jobs/domain/hiringDemand";
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

  const [result, headcount, canManage, canDecide, filing] = await Promise.all([
    supabase
      .from("job_openings")
      .select(
        "id, title, tenant_id, department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applicants:applications(count), pipeline:applications(count), hired:applications(count)",
        // The grid's rails filter the rows it already holds, so the read has a
        // ceiling — and `count` reports the scope that ceiling sits inside.
        { count: "exact" }
      )
      // The badge and the applicants list it opens both hide filed candidates, and
      // the demand counts hide them too — an archived person is neither in the
      // pipeline nor a hire.
      .is("applicants.archived_at", null)
      .is("pipeline.archived_at", null)
      // Each aliased embed carries its own filter, so the three counts split the
      // same applications by stage: everyone live, the funnel still being worked,
      // and the hires. `applications.stage` exists on every database, so unlike
      // the headcount target this needs no migration.
      .in("pipeline.stage", IN_PIPELINE_STAGES)
      .is("hired.archived_at", null)
      .eq("hired.stage", HIRED_STAGE)
      // Newest first, then by id: the timestamp alone is not unique, and a page
      // that splits a batch of same-instant rows shows them twice.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, GRID_ROW_LIMIT - 1),
    // Read apart from the grid's own row read so an unapplied `positions_needed`
    // column costs only the target figure, never the whole page.
    getOpeningsHeadcount(supabase),
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
  const jobs: JobRow[] = ((result.data ?? []) as unknown as Omit<JobRow, "positions_needed">[]).map(
    (row) => ({ ...row, positions_needed: headcount.neededById.get(row.id) ?? null })
  );

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Requisitions"
        title="Job openings"
        description="Every published and draft role across the group's companies."
        actions={canManage ? <NewJobDrawer options={options} /> : undefined}
      />

      <JobsBrowser
        jobs={jobs}
        // The scope the database reports, which the bounded read above may only
        // hold a window of. The grid has to say which of the two it is counting.
        scopeTotal={result.count ?? jobs.length}
        // The target column could not be read at all (it is not applied yet on a
        // fresh database); the grid names that instead of calling every role
        // target-less.
        headcountUnavailable={headcount.unavailable}
        options={options}
        canManage={canManage}
        canDecide={canDecide}
      />
    </PageTransition>
  );
}
