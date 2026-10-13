import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
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
  const user = await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const [result, canManage] = await Promise.all([
    supabase
      .from("job_openings")
      .select(
        "id, title, tenant_id, department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applications(count)"
      )
      .order("created_at", { ascending: false }),
    hasPermissionForUser("jobs.manage"),
  ]);

  const master = await getMasterOptions();
  const options: JobFormOptions = {
    companies: master.companies,
    departments: master.departments,
    locations: master.locations,
    currencies: master.currencies,
  };
  const jobs = (result.data ?? []) as unknown as JobRow[];

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Requisitions"
        title="Job openings"
        description="Every published and draft role across the group's companies."
        actions={canManage ? <NewJobDrawer options={options} /> : undefined}
      />

      <JobsBrowser jobs={jobs} options={options} canManage={canManage} />
    </AdminShell>
  );
}
