/**
 * The public job board's shape and its filtering rules.
 *
 * Kept out of the page because the board narrows its own list in the browser
 * (see `CareersBoard`), so the rules that decide what an applicant is shown have
 * to be readable and testable without a DOM or a database.
 */

import { SECTOR_LABELS, type Sector } from "@/modules/settings/domain/vocabularies";
import { hasKey, translate } from "@/lib/i18n";
import type { Locale } from "@/types";

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
  company_id: string | null;
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

export function sectorLabel(sector: string, locale?: Locale): string {
  return localize(sector, SECTOR_LABELS[sector as Sector] ?? humanize(sector), locale);
}

export function employmentLabel(type: string, locale?: Locale): string {
  return localize(type, EMPLOYMENT_LABELS[type] ?? humanize(type), locale);
}

/**
 * The dictionary key a stored enum code is words under, if it has any.
 *
 * `REAL_ESTATE` and `real_estate` land on the same key because the database has
 * not been consistent about the case of a CHECK-constrained text column.
 */
export function enumKeyFor(value: string): string {
  return `enum.${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/**
 * The English label, unless the candidate's language has words for this code.
 *
 * A recruiter can type a value the enum has never seen into a text column, and
 * inventing a translation for it would mean inventing the word too — so an
 * unmapped code keeps the label it already had rather than falling back to a
 * dictionary key a candidate cannot read.
 */
function localize(code: string, english: string, locale?: Locale): string {
  if (!locale) return english;
  const key = enumKeyFor(code);
  return hasKey(key) ? translate(locale, key) : english;
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

/**
 * What the applicant has chosen, in their own words.
 *
 * A facet holds a list, because the board is a sidebar of ticked choices and
 * "Cairo or Sharm" is a question an applicant legitimately asks — a single
 * dropdown could only answer it by making them load the page twice. The values
 * are the stored spellings, so a shared URL filters the same rows whatever
 * language the board is read in.
 */
export interface BoardFilters {
  q: string;
  department: string[];
  location: string[];
  employment_type: string[];
  sector: string[];
}

export const EMPTY_FILTERS: BoardFilters = {
  q: "",
  department: [],
  location: [],
  employment_type: [],
  sector: [],
};

/** A query string is not a form; past that, the URL is only getting long. */
const MAX_FACET_VALUES = 12;

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
  labelKey: string;
}[] = [
  { field: "department", param: "department", label: "Department", labelKey: "facet.department" },
  { field: "location", param: "location", label: "Location", labelKey: "facet.location" },
  { field: "employment_type", param: "type", label: "Job type", labelKey: "facet.jobType" },
  { field: "sector", param: "sector", label: "Sector", labelKey: "facet.sector" },
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
 *
 * The two closed enums are labelled in the candidate's language when one is
 * given; the value written into the URL stays the stored code, so a shared
 * filtered board filters the same rows whatever language it is read in.
 */
export function facetOptions(
  jobs: PublicJob[],
  field: FacetField,
  locale?: Locale
): FacetOption[] {
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
          ? sectorLabel(group.value, locale)
          : field === "employment_type"
            ? employmentLabel(group.value, locale)
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
      FACETS.every((facet) => {
        const chosen = filters[facet.field];
        if (chosen.length === 0) return true;
        const value = fold(job[facet.field]);
        return chosen.some((each) => fold(each) === value);
      })
  );
}

/** Whether a choice is already ticked, whatever spelling the link carried. */
export function isTicked(chosen: string[], value: string): boolean {
  const target = fold(value);
  return chosen.some((each) => fold(each) === target);
}

/**
 * One choice in, one choice out: a ticked box clicked again is unticked.
 *
 * The comparison is folded, so a pasted `?location=cairo` unticks the "Cairo"
 * box rather than leaving a second folded-equal value sitting in the list.
 */
export function toggleFacet(
  filters: BoardFilters,
  field: FacetField,
  value: string
): BoardFilters {
  const chosen = filters[field];
  const next = isTicked(chosen, value)
    ? chosen.filter((each) => fold(each) !== fold(value))
    : [...chosen, value].slice(-MAX_FACET_VALUES);
  return { ...filters, [field]: next };
}

/** How many choices the applicant has actually ticked, keywords excluded. */
export function activeFacetCount(filters: BoardFilters): number {
  return FACETS.reduce((sum, facet) => sum + filters[facet.field].length, 0);
}

/**
 * The choices a shared link carries.
 *
 * A facet may repeat (`?location=Cairo&location=Sharm`), and an older link with
 * one value per facet still reads. Spent values are dropped, duplicates
 * collapsed, and the count capped — a URL that arrives with four hundred
 * locations is a bug somewhere else, and the board should not inherit it.
 */
export function readFilters(search: string): BoardFilters {
  const params = new URLSearchParams(search);
  const values = (param: string): string[] => {
    const seen = new Set<string>();
    for (const raw of params.getAll(param)) {
      const value = raw.trim().slice(0, 120);
      if (value) seen.add(value);
      if (seen.size >= MAX_FACET_VALUES) break;
    }
    return [...seen];
  };

  return {
    q: params.get("q")?.slice(0, 120) ?? "",
    department: values("department"),
    location: values("location"),
    employment_type: values("type"),
    sector: values("sector"),
  };
}

/** Empty choices are left out, so a shared board URL stays short and readable. */
export function writeFilters(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const facet of FACETS) {
    for (const value of filters[facet.field]) params.append(facet.param, value);
  }
  return params.toString();
}
