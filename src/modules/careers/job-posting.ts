/**
 * The schema.org `JobPosting` for one published role.
 *
 * Kept out of the page and out of the routes because five surfaces publish the
 * same record in five formats, and a role that reads as posted on Monday in the
 * sitemap and Tuesday in the feed is worse than a role nobody indexes. Both
 * imports are type-only: this module has no runtime dependency on the board's
 * vocabularies or the company parser, and a proof script can exercise every rule
 * here against a plain object.
 */

import type { PublicJob } from "@/modules/careers/job-board";
import type { PublicCompany } from "@/modules/careers/company-profile";

/**
 * `job_openings` has no country column and its `location` is free text, and the
 * public company read deliberately lists only the columns the public page
 * prints. So the country in a posting is the group's own country — a named
 * constant, not a per-role fact.
 */
const COUNTRY = "Egypt";

/** The employer a role falls back to when nothing above it names one. */
export const GROUP_NAME = "Sharm Dreams Group";

/**
 * The two shapes that carry "where the work happens".
 *
 * Typed rather than `unknown[]` because a posting's place is the one part of this
 * object another module reads back — the proof checks a nested path, and so does
 * nothing else in the domain. A `Country` is a name, not a code: `job_openings`
 * has no country column, and the value is the group's own country.
 */
export interface Country {
  "@type": "Country";
  name: string;
}

export interface Place {
  "@type": "Place";
  address: {
    "@type": "PostalAddress";
    addressLocality: string;
    addressCountry: Country;
  };
}

export interface JobPosting {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  description: string;
  datePosted: string;
  hiringOrganization: {
    "@type": "Organization";
    name: string;
    legalName?: string;
    sameAs?: string;
  };
  url: string;
  identifier: { "@type": "PropertyValue"; name: string; value: string };
  directApply: boolean;
  employmentType?: string;
  jobLocationType?: string;
  jobLocation?: Place[];
  applicantLocationRequirements?: Country[];
  validThrough?: string;
}

/** Blank-as-absent text, so a column of spaces cannot become a published value. */
function trimmed(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

/**
 * The one date rule, in one place.
 *
 * `posted_at` is the day the role went public; `created_at` is the fallback for a
 * row that reached PUBLISHED without one. Both blank means the role has no day to
 * publish on, and `datePosted` is one of Google's required properties — so the
 * caller gets null and every surface decides what to do about it. The feed, the
 * sitemap and the CSV all ask this function rather than each inventing a date.
 */
export function dateOf(job: PublicJob): string | null {
  return trimmed(job.posted_at) ?? trimmed(job.created_at);
}

/** The role's canonical page, on the one public base URL the app has. */
function jobUrl(job: PublicJob, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/careers/${job.id}`;
}

/**
 * The employer, in the order the record supports.
 *
 * The role's own company row first. Then the name the role's own join carried —
 * `getPublicCompanies` asks for active rows only, so a role filed under a retired
 * company resolves to no company at all while still naming its employer, which is
 * the name the page itself prints. Then the group profile, then the group.
 */
function employerName(
  job: PublicJob,
  company: PublicCompany | null,
  groupName: string | undefined
): string {
  return (
    trimmed(company?.name) ??
    trimmed(job.company_name) ??
    trimmed(groupName) ??
    GROUP_NAME
  );
}

/** Google names a contract; the platform's column mixes contracts with arrangements. */
const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: "FULL_TIME",
  PART_TIME: "PART_TIME",
  CONTRACT: "CONTRACTOR",
  INTERNSHIP: "INTERN",
};

/**
 * Codes that describe where the work happens, not what the worker is on.
 *
 * The platform's own column default is FULL_TIME, but a recruiter who filed
 * "Remote" replaced that default rather than added to it, so the contract is
 * genuinely unrecorded. Stating FULL_TIME would be a claim the record does not
 * make; the arrangement is not lost — `jobLocationType` is where Google looks
 * for it.
 */
const ARRANGEMENT_ONLY = new Set(["REMOTE", "HYBRID"]);

/** A role is remote when the text says so or the code says so. */
function isRemote(job: PublicJob): boolean {
  return /\bremote\b/i.test(job.location) || job.employment_type.trim().toUpperCase() === "REMOTE";
}

function employmentTypeOf(job: PublicJob): string | null {
  const code = job.employment_type.trim().toUpperCase();
  if (!code) return null;
  const mapped = EMPLOYMENT_TYPES[code];
  if (mapped) return mapped;
  return ARRANGEMENT_ONLY.has(code) ? null : "OTHER";
}

function locationTypeOf(job: PublicJob): string | null {
  if (isRemote(job)) return "TELECOMMUTE";
  return job.employment_type.trim().toUpperCase() === "HYBRID" ? "HYBRID" : null;
}

/**
 * The recruiter's own words, or null when they name no place.
 *
 * "Remote" alone is an arrangement; "Cairo / Remote" still names an office. The
 * text is returned whole rather than re-spelled, because `location` is free text
 * and editing it would invent an address nobody filed.
 */
function placeOf(location: string): string | null {
  const words = location.split(/\s+/).filter(Boolean);
  return words.some((word) => !/^remote[.,!?]$/i.test(word)) ? location.trim() : null;
}

function placeValue(locality: string): Place {
  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: locality,
      addressCountry: { "@type": "Country", name: COUNTRY },
    },
  };
}

/**
 * The role as Google wants it, or null when the record cannot make a valid posting.
 *
 * Returning null rather than a half-built object forces every caller to decide
 * what to do, and the decision is stated once: a role with no date is not
 * published to the world.
 */
export function jobPosting(
  job: PublicJob,
  company: PublicCompany | null,
  options: { baseUrl: string; groupName?: string }
): JobPosting | null {
  const datePosted = dateOf(job);
  if (!datePosted) return null;

  const employer = employerName(job, company, options.groupName);
  const posting: JobPosting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted,
    hiringOrganization: { "@type": "Organization", name: employer },
    url: jobUrl(job, options.baseUrl),
    identifier: { "@type": "PropertyValue", name: "Job ID", value: job.id },
    directApply: true,
  };

  const legalName = trimmed(company?.legal_name);
  if (legalName && legalName !== employer) posting.hiringOrganization.legalName = legalName;
  const website = trimmed(company?.website);
  if (website) posting.hiringOrganization.sameAs = website;

  const closing = trimmed(job.closing_at);
  if (closing) posting.validThrough = closing;

  const employmentType = employmentTypeOf(job);
  if (employmentType) posting.employmentType = employmentType;

  const locationType = locationTypeOf(job);
  if (locationType) posting.jobLocationType = locationType;

  const locality = placeOf(job.location);
  // A remote role keeps an office only when its text names one, and always names
  // the countries an applicant may live in — Google requires at least one.
  if (locality) posting.jobLocation = [placeValue(locality)];
  if (isRemote(job)) {
    posting.applicantLocationRequirements = [{ "@type": "Country", name: COUNTRY }];
  }

  return posting;
}

/**
 * The exact string that goes inside the `<script type="application/ld+json">` tag.
 *
 * Next's own recipe (`node_modules/next/dist/docs/01-app/02-guides/json-ld.md`):
 * every `<` becomes the JSON escape, which parses back to `<` in the object and
 * cannot close the tag the description opened. The proof script parses the same
 * string this returns, so the escaping is tested rather than asserted.
 *
 * `baseSalary` is absent by design. Google wants a `MonetaryAmount` with a
 * `unitText` — YEAR, MONTH, HOUR — and the platform records an amount and a
 * currency and no period. A `salary_period` column would make this emittable
 * honestly; that column is not in this slice.
 */
export function jobPostingJsonLd(posting: JobPosting): string {
  return JSON.stringify(posting).replace(/</g, "\\u003c");
}
