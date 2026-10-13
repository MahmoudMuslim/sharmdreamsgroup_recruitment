import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";

/**
 * Read queries the assistant needs that no screen action already exposes.
 *
 * Everything else the assistant can see comes from the existing server actions
 * so their permission gates stay the single source of truth. These two only
 * exist because the jobs page inlines its own query instead of having one.
 *
 * Reads run on the session client, so Row Level Security applies exactly as it
 * does for the staff member driving the chat.
 */

export interface AssistantJobRow {
  id: string;
  title: string;
  tenant_id: string | null;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  status: string;
  description: string | null;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  closing_at: string | null;
  applicants: number;
}

const JOB_SELECT =
  "id, title, tenant_id, department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applications(count)";

interface RawJobRow {
  id: string;
  title: string;
  tenant_id: string | null;
  department: string | null;
  sector: string | null;
  location: string | null;
  employment_type: string | null;
  status: string | null;
  description: string | null;
  requirements: string[] | null;
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  closing_at: string | null;
  applications?: { count: number }[] | null;
}

function toJob(row: RawJobRow): AssistantJobRow {
  return {
    id: row.id,
    title: row.title,
    tenant_id: row.tenant_id,
    department: row.department ?? "",
    sector: row.sector ?? "",
    location: row.location ?? "",
    employment_type: row.employment_type ?? "",
    status: row.status ?? "DRAFT",
    description: row.description,
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    min_salary_usd: row.min_salary_usd,
    max_salary_usd: row.max_salary_usd,
    salary_currency: row.salary_currency,
    posted_at: row.posted_at,
    closing_at: row.closing_at,
    applicants: row.applications?.[0]?.count ?? 0,
  };
}

/** Every opening, newest first, with its applicant count. */
export async function listJobOpenings(): Promise<AssistantJobRow[]> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("job_openings")
    .select(JOB_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Job openings could not be read: ${error.message}`);
  return ((data ?? []) as unknown as RawJobRow[]).map(toJob);
}

/** One opening in full — what `update_job` needs before it changes a field. */
export async function getJobOpening(jobId: string): Promise<AssistantJobRow | null> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("job_openings")
    .select(JOB_SELECT)
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(`That opening could not be read: ${error.message}`);
  return data ? toJob(data as unknown as RawJobRow) : null;
}
