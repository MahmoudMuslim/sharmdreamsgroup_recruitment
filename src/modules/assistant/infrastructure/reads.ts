import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import {
  HIREABLE_STATUSES,
  OPENING_READ_LIMIT,
  type JobStatus,
} from "@/modules/jobs/domain/hireable";

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
  /**
   * The company the role belongs to, by name.
   *
   * A uuid means nothing in a spoken answer, and the openings search matches a
   * company by the words a recruiter types rather than by its id — so the read
   * carries the name, which is what lets the chat search the same column the
   * grid searches.
   */
  company_name: string | null;
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
  "id, title, tenant_id, tenants_and_companies(name), department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applications(count)";

interface RawJobRow {
  id: string;
  title: string;
  tenant_id: string | null;
  tenants_and_companies?: { name: string } | { name: string }[] | null;
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

function companyNameOf(row: RawJobRow): string | null {
  const joined = row.tenants_and_companies;
  const name = Array.isArray(joined) ? joined[0]?.name : joined?.name;
  return typeof name === "string" && name !== "" ? name : null;
}

function toJob(row: RawJobRow): AssistantJobRow {
  return {
    id: row.id,
    title: row.title,
    tenant_id: row.tenant_id,
    company_name: companyNameOf(row),
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

/**
 * The half of the openings set a read is asked for: one `job_status`, `HIREABLE`
 * for everything a person may still be filed under, or `null` for all four.
 * `HIREABLE` is a word the console uses rather than an enum value, which is why
 * it is spelled here instead of being added to `JOB_STATUSES`.
 */
export type JobReadFilter = JobStatus | "HIREABLE" | null;

export interface AssistantJobRead {
  jobs: AssistantJobRow[];
  /** Openings matching the filter, whether or not this read could carry them. */
  total: number;
  /**
   * The company the read was scoped to, by name.
   *
   * `null` when no company was asked for. Resolved before the openings are
   * counted so an answer about a company with no roles can still say which
   * company it looked at — and so the grid's own rail, which holds the same id,
   * shows the set this read counted.
   */
  companyName: string | null;
  /** True when a company id was passed and no company carries it. */
  unknownCompany: boolean;
}

/** Openings newest first, with their live applicant count and the set's size. */
export async function listJobOpenings(
  filter: JobReadFilter = null,
  companyId: string | null = null
): Promise<AssistantJobRead> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  // The company is named before its openings are counted, and an id no company
  // carries is reported rather than answered with an empty list a caller could
  // mistake for "that company has nothing".
  let companyName: string | null = null;
  if (companyId) {
    const one = await supabase
      .from("tenants_and_companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    if (one.error) throw new Error(`That company could not be read: ${one.error.message}`);
    if (!one.data) return { jobs: [], total: 0, companyName: null, unknownCompany: true };
    companyName = (one.data as { name: string }).name;
  }

  const rowsQuery = supabase.from("job_openings").select(JOB_SELECT);
  const countQuery = supabase.from("job_openings").select("id", { count: "exact", head: true });
  // `null` adds no status predicate at all. `.eq("status", null)` would send
  // `status=eq.null`, and Postgres rejects that for the enum with
  // `invalid input value for enum job_status: "null"` — probed on the live pool.
  const statusScoped =
    filter === null
      ? { rows: rowsQuery, count: countQuery }
      : filter === "HIREABLE"
        ? {
            rows: rowsQuery.in("status", [...HIREABLE_STATUSES]),
            count: countQuery.in("status", [...HIREABLE_STATUSES]),
          }
        : { rows: rowsQuery.eq("status", filter), count: countQuery.eq("status", filter) };
  const scoped = {
    rows: companyId ? statusScoped.rows.eq("tenant_id", companyId) : statusScoped.rows,
    // The same two predicates on the count, so `total` describes the set the
    // rows were taken from rather than a wider one.
    count: companyId ? statusScoped.count.eq("tenant_id", companyId) : statusScoped.count,
  };

  const [rows, count] = await Promise.all([
    scoped.rows
      .is("applications.archived_at", null)
      .order("created_at", { ascending: false })
      .limit(OPENING_READ_LIMIT),
    // The same parent predicate, counted. A head count cannot carry the nested
    // filter above: probed on the live pool, `applications.archived_at` on a
    // `count()` embed returns no number at all. That embed only trims each row's
    // applicant tally, so it moves no opening in or out of the set.
    scoped.count,
  ]);

  if (rows.error) throw new Error(`Job openings could not be read: ${rows.error.message}`);
  if (count.error) {
    console.error("[assistant] opening head count failed:", count.error.message);
  }

  return {
    jobs: ((rows.data ?? []) as unknown as RawJobRow[]).map(toJob),
    // A failed head count leaves nothing truer than the rows in hand.
    total: count.count ?? (rows.data ?? []).length,
    companyName,
    unknownCompany: false,
  };
}

/** One opening in full — what `update_job` needs before it changes a field. */
export async function getJobOpening(jobId: string): Promise<AssistantJobRow | null> {
  await requireStaff("/jobs");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("job_openings")
    .select(JOB_SELECT)
    .is("applications.archived_at", null)
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(`That opening could not be read: ${error.message}`);
  return data ? toJob(data as unknown as RawJobRow) : null;
}
