import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import {
  HIREABLE_STATUSES,
  OPENING_READ_LIMIT,
  type JobStatus,
} from "@/modules/jobs/domain/hireable";
import { HIRED_STAGE, IN_PIPELINE_STAGES } from "@/modules/jobs/domain/hiringDemand";
import { getOpeningTermsByIds } from "@/modules/jobs/application/openingTermsRead";
import {
  getOpeningsRequiredSkills,
  getSkillsCatalogue,
} from "@/modules/jobs/application/openingSkillsRead";
import type { RequiredSkill } from "@/modules/jobs/domain/openingSkills";

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
  /**
   * JUNIOR, MID, SENIOR or LEAD — or null when none was recorded, which also
   * covers every opening on a database where 033 has not been applied. The
   * accompanying `termsNote` says which of the two it is.
   */
  experience_level: string | null;
  status: string;
  description: string | null;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  closing_at: string | null;
  /** Live applicants total — everyone not archived, whatever their stage. */
  applicants: number;
  /**
   * Who sits in the funnel being worked, and who is hired.
   *
   * The same two stage-grouped counts the openings grid prints beside each
   * card, so a chat answer cannot report a tally the table splits three ways.
   * These are populations at an instant — who holds a stage now — never a
   * movement, a conversion or a rate. The headcount target is deliberately not
   * here: that column is not applied yet, and the grid reads it in its own
   * degradable query rather than coupling every opening read to it.
   */
  in_pipeline: number;
  hired: number;
}

// No `experience_level`: db/migrations/033_opening_terms.sql is authored but not
// applied, and naming the column here would fail every openings read — the list,
// the count and `update_job`'s pre-read — on a database that has not run it.
// The level is read by id in `getOpeningTermsByIds` and merged below.
const JOB_SELECT =
  "id, title, tenant_id, tenants_and_companies(name), department, sector, location, employment_type, status, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, applicants:applications(count), pipeline:applications(count), hired:applications(count)";

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
  applicants?: { count: number }[] | null;
  pipeline?: { count: number }[] | null;
  hired?: { count: number }[] | null;
}

function companyNameOf(row: RawJobRow): string | null {
  const joined = row.tenants_and_companies;
  const name = Array.isArray(joined) ? joined[0]?.name : joined?.name;
  return typeof name === "string" && name !== "" ? name : null;
}

function toJob(row: RawJobRow, experienceLevel: string | null = null): AssistantJobRow {
  return {
    id: row.id,
    title: row.title,
    tenant_id: row.tenant_id,
    company_name: companyNameOf(row),
    department: row.department ?? "",
    sector: row.sector ?? "",
    location: row.location ?? "",
    employment_type: row.employment_type ?? "",
    experience_level: experienceLevel,
    status: row.status ?? "DRAFT",
    description: row.description,
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    min_salary_usd: row.min_salary_usd,
    max_salary_usd: row.max_salary_usd,
    salary_currency: row.salary_currency,
    posted_at: row.posted_at,
    closing_at: row.closing_at,
    applicants: row.applicants?.[0]?.count ?? 0,
    in_pipeline: row.pipeline?.[0]?.count ?? 0,
    hired: row.hired?.[0]?.count ?? 0,
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
  /**
   * Why no level could be read — 033 unapplied — or null when the column was
   * readable. Without this every `experience_level: null` reads as "none was
   * recorded", which is a different fact from "there is nowhere to record one".
   */
  termsNote: string | null;
}

/**
 * One requirement row with the catalogue's word for it.
 *
 * The id travels because a chat edit sends the list back, and the name because a
 * uuid in a spoken answer is not a skill anyone can read. `name` is null only
 * when the catalogue itself could not be read — a stored row's foreign key means
 * the skills table has the row, retired or not.
 */
export type AssistantRequiredSkill = RequiredSkill & { name: string | null };

/** One opening with the same schema honesty the list carries. */
export interface AssistantJobDetail {
  job: AssistantJobRow;
  termsNote: string | null;
  /** The requisition's skill list, or empty when it asks for nothing. */
  requiredSkills: AssistantRequiredSkill[];
  /**
   * Why the list is empty when it is empty for a reason other than the opening.
   *
   * `job_opening_skills` ships ahead of its ALTER (037 is authored, not applied),
   * so on this database an empty list and a table that cannot be read look alike
   * to everything above. The note says which of the two the recruiter is being
   * told about; null when the read worked.
   */
  skillsNote: string | null;
}

/**
 * The company carrying an id, by name — or `null` when none does.
 *
 * Both rails that light by company id, the openings grid and the candidates
 * table, have to tell "this company has nobody in it" apart from "no company
 * carries that id", and a read of the child rows cannot: an empty set looks the
 * same either way. So the id is looked up on its own before anything is counted,
 * and a caller turns `null` into a refusal rather than an empty list.
 */
export async function companyNameById(id: string): Promise<string | null> {
  const restClient = await createServerRestClient();
  const one = await restClient
    .from("tenants_and_companies")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (one.error) throw new Error(`That company could not be read: ${one.error.message}`);
  const name = (one.data as { name?: string } | null)?.name;
  return typeof name === "string" && name !== "" ? name : null;
}

/** Openings newest first, with their live applicant count and the set's size. */
export async function listJobOpenings(
  filter: JobReadFilter = null,
  companyId: string | null = null
): Promise<AssistantJobRead> {
  await requireStaff("/jobs");
  const restClient = await createServerRestClient();

  // The company is named before its openings are counted, and an id no company
  // carries is reported rather than answered with an empty list a caller could
  // mistake for "that company has nothing".
  const companyName = companyId ? await companyNameById(companyId) : null;
  if (companyId && !companyName) {
    return { jobs: [], total: 0, companyName: null, unknownCompany: true, termsNote: null };
  }

  const rowsQuery = restClient.from("job_openings").select(JOB_SELECT);
  const countQuery = restClient.from("job_openings").select("id", { count: "exact", head: true });
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
      // The three count embeds each carry their own filter on the dotted alias
      // key — the form PostgREST accepts; the inline `applications(count,stage.eq…)`
      // is rejected. `applicants` is every live candidate, `pipeline` the stages
      // still being worked, `hired` the HIRED rows. The head count below selects
      // only `id`, so it carries none of these and stays the set's full size.
      .is("applicants.archived_at", null)
      .is("pipeline.archived_at", null)
      .in("pipeline.stage", IN_PIPELINE_STAGES)
      .is("hired.archived_at", null)
      .eq("hired.stage", HIRED_STAGE)
      .order("created_at", { ascending: false })
      .limit(OPENING_READ_LIMIT),
    // A head count cannot carry the nested filter above: probed on the live pool,
    // `applications.archived_at` on a `count()` embed returns no number at all.
    // The embeds only trim each row's tallies, so they move no opening in or out
    // of the set `total` describes.
    scoped.count,
  ]);

  if (rows.error) throw new Error(`Job openings could not be read: ${rows.error.message}`);
  if (count.error) {
    console.error("[assistant] opening head count failed:", count.error.message);
  }

  const rowData = (rows.data ?? []) as unknown as RawJobRow[];
  // Asked for by the ids this read actually holds, so a company- or status-
  // scoped list gets its own rows' levels rather than whichever openings happen
  // to be newest. A missing column leaves every level null and says why.
  const terms = await getOpeningTermsByIds(
    restClient,
    rowData.map((row) => row.id)
  );

  return {
    jobs: rowData.map((row) => toJob(row, terms.experienceById.get(row.id) ?? null)),
    // A failed head count leaves nothing truer than the rows in hand.
    total: count.count ?? rowData.length,
    companyName,
    unknownCompany: false,
    termsNote: terms.note,
  };
}

/** One opening in full — what `update_job` needs before it changes a field. */
export async function getJobOpening(jobId: string): Promise<AssistantJobDetail | null> {
  await requireStaff("/jobs");
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("job_openings")
    .select(JOB_SELECT)
    // The same three aliased embeds as the grid read, so `get_job` and
    // `update_job` see one opening's funnel the way the list does. JOB_SELECT
    // no longer carries a plain `applications` alias, so a filter on that key
    // would be rejected here too.
    .is("applicants.archived_at", null)
    .is("pipeline.archived_at", null)
    .in("pipeline.stage", IN_PIPELINE_STAGES)
    .is("hired.archived_at", null)
    .eq("hired.stage", HIRED_STAGE)
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(`That opening could not be read: ${error.message}`);
  if (!data) return null;

  const terms = await getOpeningTermsByIds(restClient, [jobId]);
  // The skill list is a third degradable read, for the third unapplied file. It
  // is asked for by this opening's id, the same way the level is, so nothing here
  // can describe a different window of openings.
  const skills = await getOpeningsRequiredSkills(restClient, [jobId]);
  const rows = skills.requiredById.get(jobId) ?? [];
  // The catalogue is only worth a query when there is something to name: an
  // opening that asks for nothing has no ids to translate.
  const catalogue = rows.length > 0 ? await getSkillsCatalogue(restClient) : null;
  const names = new Map((catalogue?.all ?? []).map((skill) => [skill.id, skill.name]));

  return {
    job: toJob(data as unknown as RawJobRow, terms.experienceById.get(jobId) ?? null),
    termsNote: terms.note,
    requiredSkills: rows.map((row) => ({
      skill_id: row.skill_id,
      name: names.get(row.skill_id) ?? null,
      required_level: row.required_level,
      source: row.source,
    })),
    skillsNote: skills.note ?? catalogue?.note ?? null,
  };
}
