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
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the role's `jobLocation`/`applicantLocationRequirements` (Task 3+) are the only consumers; kept here so the constant lives with the mapping it belongs to.
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

  return posting;
}
