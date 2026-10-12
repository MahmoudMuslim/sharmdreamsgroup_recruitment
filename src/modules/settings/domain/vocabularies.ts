/**
 * Constrained vocabularies that mirror Postgres enum types.
 *
 * These live in code so the settings UI can offer a select and the server
 * action can validate before the database rejects the write with an opaque
 * `invalid input value for enum` error.
 */

/** Mirrors the `business_sector` enum on `tenants_and_companies.sector`. */
export const SECTORS = [
  "HOSPITALITY",
  "REAL_ESTATE",
  "COMMERCIAL_DEVELOPMENT",
  "CORPORATE",
] as const;

export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABELS: Record<Sector, string> = {
  HOSPITALITY: "Hospitality",
  REAL_ESTATE: "Real estate",
  COMMERCIAL_DEVELOPMENT: "Commercial development",
  CORPORATE: "Corporate",
};

export function isSector(value: string): value is Sector {
  return (SECTORS as readonly string[]).includes(value);
}

/** Mirrors the `application_source` enum. */
export const APPLICATION_SOURCES = [
  "LINKEDIN",
  "WHATSAPP",
  "JOB_BOARD",
  "CAREER_SITE",
  "REFERRAL",
  "ATS_IMPORT",
] as const;