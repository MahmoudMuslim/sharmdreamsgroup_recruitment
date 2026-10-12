import { BriefcaseBusiness, MapPin } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Badge, Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { formatSalaryRange } from "@/lib/currency";
import { NewJobDrawer } from "./NewJobDrawer";
import { connection } from "next/server";

export const metadata = {
  title: "Job openings",
  description: "Multi-company showcase of published roles",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

interface JobRow {
  id: string;
  title: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  status: string;
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
  applications: { count: number }[];
}

export default async function JobsPage() {
  await connection();
  const user = await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("job_openings")
    .select(
      "id, title, department, sector, location, employment_type, status, min_salary_usd, max_salary_usd, salary_currency, applications(count)"
    )
    .order("created_at", { ascending: false });

  const options = await getMasterOptions();
  const jobs = (data ?? []) as unknown as JobRow[];

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Requisitions"
        title="Job openings"
        description="Every published and draft role across the group's companies."
        actions={
          <NewJobDrawer
            options={{
              companies: options.companies,
              departments: options.departments,
              locations: options.locations,
              currencies: options.currencies,
            }}
          />
        }
      />

      {jobs.length === 0 ? (
        <Card className="p-10 text-center">
          <BriefcaseBusiness className="mx-auto mb-3 h-8 w-8 text-brand-gold" aria-hidden />
          <p className="font-display font-bold">No openings yet</p>
          <p className="mt-1 text-sm text-brand-ink/55">Create a role to start receiving applications.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {jobs.map((job) => {
            const applicants = job.applications?.[0]?.count ?? 0;
            const salary = formatSalaryRange(
              {
                min: job.min_salary_usd,
                max: job.max_salary_usd,
                // Pre-dating the currency column every row was USD.
                currency: job.salary_currency || "USD",
              },
              options.currencies
            );
            return (
              <Card key={job.id} className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold leading-snug">{job.title}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-brand-ink/55">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {job.location}
                    </p>
                  </div>
                  <Badge
                    tone={job.status === "PUBLISHED" ? "success" : job.status === "DRAFT" ? "neutral" : "danger"}
                  >
                    {job.status}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-brand-ink/55">
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">{job.department}</span>
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">
                    {job.employment_type.replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">
                    {job.sector.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-brand-line pt-4 text-sm">
                  <span className="text-brand-ink/60">
                    <strong className="font-display text-base text-brand-ink">{applicants}</strong>{" "}
                    applicant{applicants === 1 ? "" : "s"}
                  </span>
                  {salary && (
                    <span className="font-mono text-xs text-brand-ink/50">{salary}</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}