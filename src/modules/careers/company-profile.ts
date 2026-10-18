/**
 * The public careers page's view of a company.
 *
 * The words live on `tenants_and_companies` and are written in
 * Settings → Master data → Companies, so the page prints what the console holds
 * and nothing it does not: an empty field renders no heading, no paragraph and no
 * placeholder, and a company whose story was never filed is shown as the list of
 * roles it is hiring for. That is the only way the page can be pointed at the
 * database and said to be true.
 *
 * The rows arrive as raw column values, and two of them — `milestones` and
 * `benefits` — are jsonb the recruiter types into the console, so every reader
 * here tolerates what the column can actually hold: an array of entries, an array
 * of bare strings, JSON text, or nothing. A profile the console writes is read by
 * the same rules the console stores it under.
 *
 * Pure by design — no database, no clock, no JSX — so the server read, the client
 * board and a plain Node check all group and order a company the same way.
 */

import { sectorLabel } from "./job-board";
import type { PublicJob } from "./job-board";

/** One point on the company's timeline. */
export interface CompanyMilestone {
  year: number | null;
  title: string;
  detail: string | null;
}

/** One thing the company says it gives its people. */
export interface CompanyBenefit {
  title: string;
  text: string | null;
}

/** A company row, as far as the public page is allowed to see it. */
export interface PublicCompany {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  sector: string;
  tagline: string | null;
  description: string | null;
  history: string | null;
  careers_pitch: string | null;
  founded_year: number | null;
  ownership_type: string | null;
  employee_range: string | null;
  headquarters: string | null;
  milestones: CompanyMilestone[];
  benefits: CompanyBenefit[];
  website: string | null;
  is_group_profile: boolean;
  sort_order: number;
}

/** Blank-as-absent text, so a column of spaces cannot render an empty block. */
function field(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A four-digit year from either column type the console can store. */
function yearOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = field(value);
  return text && /^\d{4}$/.test(text) ? Number(text) : null;
}

/**
 * The stored list, whichever shape it arrived in.
 *
 * A jsonb column reads back as an array, but a row edited outside the console can
 * hold the JSON as text, and the console's own textarea fallback lets someone type
 * a plain line. A bare string becomes an entry titled by it rather than being
 * dropped, because dropping it would silently delete a milestone nobody can see.
 */
function listRows(raw: unknown): Record<string, unknown>[] {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      return [{ title: text }];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") return item as Record<string, unknown>;
      const text = field(item);
      return text ? { title: text } : null;
    })
    .filter((item): item is Record<string, unknown> => item !== null);
}

/**
 * The timeline in the order a reader walks it: oldest first.
 *
 * An entry with no year is the company's own present tense — the group row ends
 * with a "Today" milestone — so it stays at the end rather than being filed under
 * a year it does not claim.
 */
export function parseMilestones(raw: unknown): CompanyMilestone[] {
  return listRows(raw)
    .map((row) => ({
      year: yearOf(row.year),
      title: field(row.title) ?? "",
      detail: field(row.detail),
    }))
    .filter((row) => row.title)
    .sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER));
}

export function parseBenefits(raw: unknown): CompanyBenefit[] {
  return listRows(raw)
    .map((row) => ({ title: field(row.title) ?? "", text: field(row.text) }))
    .filter((row) => row.title);
}

/**
 * The story as paragraphs.
 *
 * Split on a blank line only: the console's history box is a multi-line textarea,
 * so a single newline is the recruiter's own break and each paragraph is printed
 * with it intact.
 */
export function splitParagraphs(body: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** A row of the companies table, projected onto what the page may print. */
export function toPublicCompany(row: Record<string, unknown>): PublicCompany {
  return {
    id: String(row.id ?? ""),
    name: field(row.name) ?? "",
    legal_name: field(row.legal_name),
    slug: field(row.slug) ?? "",
    sector: field(row.sector) ?? "",
    tagline: field(row.tagline),
    description: field(row.description),
    history: field(row.history),
    careers_pitch: field(row.careers_pitch),
    founded_year: yearOf(row.founded_year),
    ownership_type: field(row.ownership_type),
    employee_range: field(row.employee_range),
    headquarters: field(row.headquarters),
    milestones: parseMilestones(row.milestones),
    benefits: parseBenefits(row.benefits),
    website: field(row.website),
    is_group_profile: row.is_group_profile === true,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 100,
  };
}

/** The group's own row — the one that heads the page — or null. */
export function groupProfile(companies: PublicCompany[]): PublicCompany | null {
  return companies.find((company) => company.is_group_profile) ?? null;
}

/** The company a role belongs to, by the id the opening carries. */
export function companyOfJob(
  job: PublicJob,
  companies: PublicCompany[]
): PublicCompany | null {
  if (!job.company_id) return null;
  return companies.find((company) => company.id === job.company_id) ?? null;
}

/** The figures printed under a name, in the order the page reads them. */
export function companyAtAGlance(
  company: PublicCompany
): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "Founded", value: company.founded_year ? String(company.founded_year) : null },
    { label: "Ownership", value: company.ownership_type },
    { label: "People", value: company.employee_range },
    { label: "Headquarters", value: company.headquarters },
    { label: "Sector", value: company.sector ? sectorLabel(company.sector) : null },
  ];
  return rows
    .filter((row) => row.value)
    .map((row) => ({ label: row.label, value: row.value as string }));
}

/** One company and the openings it is currently hiring for. */
export interface CompanySection {
  company: PublicCompany | null;
  name: string;
  jobs: PublicJob[];
}

/**
 * The board, grouped by company.
 *
 * Grouped by the id on the opening rather than by the name the old embed carried,
 * so two companies that read alike are still two sections; a role whose company
 * the page cannot see — retired, or a tenant the anon read does not return — keeps
 * the name it arrived with and is filed last, under that name, rather than
 * disappearing from the board.
 */
export function sectionsForBoard(
  jobs: PublicJob[],
  companies: PublicCompany[]
): CompanySection[] {
  const byId = new Map(companies.map((company) => [company.id, company]));
  const groups = new Map<string, CompanySection>();

  for (const job of jobs) {
    const company =
      job.company_id && byId.has(job.company_id) ? byId.get(job.company_id)! : null;
    const key = company
      ? `id:${company.id}`
      : `name:${(job.company_name ?? "").trim().toLocaleLowerCase()}`;
    const group = groups.get(key);
    if (group) group.jobs.push(job);
    else
      groups.set(key, {
        company,
        name: company?.name ?? job.company_name ?? "",
        jobs: [job],
      });
  }

  return [...groups.values()].sort((a, b) => {
    const rank = (section: CompanySection) =>
      section.company ? section.company.sort_order : Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}

/**
 * Every company the group is made of that has nothing open.
 *
 * Shown as a directory so the page describes the whole group while naming the
 * roles it actually has; the group's own row is not listed among its companies.
 */
export function companiesWithoutOpenings(
  companies: PublicCompany[],
  jobs: PublicJob[]
): PublicCompany[] {
  const hiring = new Set(jobs.map((job) => job.company_id).filter(Boolean));
  return companies.filter(
    (company) => !company.is_group_profile && !hiring.has(company.id)
  );
}
