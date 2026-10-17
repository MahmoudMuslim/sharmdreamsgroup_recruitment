/**
 * The public job board's shape and its filtering rules.
 *
 * Kept out of the page because the board narrows its own list in the browser
 * (see `CareersBoard`), so the rules that decide what an applicant is shown have
 * to be readable and testable without a DOM or a database.
 */

import { SECTOR_LABELS, type Sector } from "@/modules/settings/domain/vocabularies";

export interface PublicJob {
  id: string;
  title: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  description: string;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
  company_name: string | null;
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
};

/**
 * `real_estate` -> "Real estate", for any stored value the maps miss.
 *
 * `SECTOR_LABELS` is keyed to the `business_sector` enum, but a label here is
 * also asked to describe `employment_type`, which the database constrains only
 * with a CHECK, and anything a recruiter later types into it. A mapping that
 * returns nothing for an unmapped value makes a real opening look like it has no
 * sector at all, so the raw code is humanized instead of dropped.
 */
function humanize(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .join(" ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function sectorLabel(sector: string): string {
  return SECTOR_LABELS[sector as Sector] ?? humanize(sector);
}

export function employmentLabel(type: string): string {
  return EMPLOYMENT_LABELS[type] ?? humanize(type);
}

/**
 * The stored text as a facet sees it.
 *
 * A department, a location and a currency are free-text columns on `job_openings`,
 * so "Cairo" and "cairo" are two values in the database and one city to whoever is
 * applying. Every facet comparison goes through this.
 */
const fold = (text: string): string => text.trim().toLocaleLowerCase();

export type FacetField = "department" | "location" | "employment_type" | "sector";

export interface BoardFilters {
  q: string;
  department: string;
  location: string;
  employment_type: string;
  sector: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  q: "",
  department: "",
  location: "",
  employment_type: "",
  sector: "",
};

/**
 * Each facet, with the query-string key it is shared under.
 *
 * Ordered as the spec orders its filters — department, location, job type — so
 * the board reads in the expected direction, then the group's own axis
 * (sector) last.
 */
export const FACETS: {
  field: Exclude<FacetField, "q">;
  param: string;
  label: string;
}[] = [
  { field: "department", param: "department", label: "Department" },
  { field: "location", param: "location", label: "Location" },
  { field: "employment_type", param: "type", label: "Job type" },
  { field: "sector", param: "sector", label: "Sector" },
];

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * The values a facet can actually be filtered to, counted over the whole board.
 *
 * Counted over *every* published opening rather than the rows the other facets
 * left standing: an option's number then means "this many roles carry it", the
 * same wherever the applicant is in the filter sequence, instead of a figure
 * that shifts under them.
 *
 * Grouped by folded text, because the stored value is free text and two openings
 * spelled "Cairo" and "cairo" are one place to an applicant — shown as two chips,
 * each with half the roles, they read as two locations. The chip carries the
 * spelling the most openings use, and `filterJobs` matches by the same fold, so
 * clicking it and pasting its URL return the same rows.
 */
export function facetOptions(jobs: PublicJob[], field: FacetField): FacetOption[] {
  const byFold = new Map<string, { value: string; count: number; spellings: Map<string, number> }>();
  for (const job of jobs) {
    const value = job[field].trim();
    if (!value) continue;
    const folded = fold(value);
    const group = byFold.get(folded) ?? { value, count: 0, spellings: new Map() };
    group.count += 1;
    group.spellings.set(value, (group.spellings.get(value) ?? 0) + 1);
    // The most-used spelling wins the chip's label and its URL value, so what an
    // applicant reads is what the majority of the roles actually say.
    const best = [...group.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0]![0];
    group.value = best;
    byFold.set(folded, group);
  }

  return [...byFold.values()]
    .map((group) => ({
      value: group.value,
      count: group.count,
      label:
        field === "sector"
          ? sectorLabel(group.value)
          : field === "employment_type"
            ? employmentLabel(group.value)
            : group.value,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** One word matches anywhere in the role's own words, and every word must land. */
function matchesQuery(job: PublicJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [job.title, job.department, job.location, job.description, job.company_name ?? ""]
    .join(" \u0000 ")
    .toLowerCase();

  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function filterJobs(jobs: PublicJob[], filters: BoardFilters): PublicJob[] {
  return jobs.filter(
    (job) =>
      matchesQuery(job, filters.q) &&
      FACETS.every(
        (facet) =>
          !filters[facet.field] || fold(job[facet.field]) === fold(filters[facet.field])
      )
  );
}

/** How many choices the applicant has actually narrowed by, keywords excluded. */
export function activeFacetCount(filters: BoardFilters): number {
  return FACETS.filter((facet) => filters[facet.field]).length;
}

export function readFilters(search: string): BoardFilters {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q")?.slice(0, 120) ?? "",
    department: params.get("department") ?? "",
    location: params.get("location") ?? "",
    employment_type: params.get("type") ?? "",
    sector: params.get("sector") ?? "",
  };
}

/** Empty choices are left out, so a shared board URL stays short and readable. */
export function writeFilters(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const facet of FACETS) {
    if (filters[facet.field]) params.set(facet.param, filters[facet.field]);
  }
  return params.toString();
}
