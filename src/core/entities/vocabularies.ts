/**
 * The label vocabularies the five entity tables are constrained to.
 *
 * Each one is declared here once, as a tuple with a type folded out of it, so
 * a row type and the words it may hold are written down in the same place. The
 * database is the authority: `scripts/prove-core-entities.mjs` reads the enum
 * labels out of `pg_enum` and the text vocabularies out of the CHECK
 * constraints and fails when a list here and the live database disagree.
 *
 * The six `*_STATUSES` / `*_ROLES` / `*_SECTORS` / `*_STAGES` / `*_SOURCES`
 * backed by a Postgres enum are the narrow end of the ladder — a value outside
 * one is refused at the column before any of this code sees it. The rest are
 * `text` with a CHECK, so a row can already hold a word this list has never
 * heard; readers of those columns are expected to handle that.
 */

/** `user_profiles.role` — the `user_role` enum. */
export const USER_ROLES = ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER", "CANDIDATE"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** `job_openings.sector` — the `business_sector` enum. */
export const BUSINESS_SECTORS = ["HOSPITALITY", "REAL_ESTATE", "COMMERCIAL_DEVELOPMENT", "CORPORATE"] as const;
export type BusinessSector = (typeof BUSINESS_SECTORS)[number];

/** `job_openings.status` — the `job_status` enum. */
export const JOB_STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** `applications.stage` — the `application_stage` enum. */
export const APPLICATION_STAGES = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** `applications.source` — the `application_source` enum. */
export const APPLICATION_SOURCES = [
  "LINKEDIN",
  "WHATSAPP",
  "JOB_BOARD",
  "CAREER_SITE",
  "REFERRAL",
  "ATS_IMPORT",
] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

/** `candidate_attempts.status` — the `attempt_status` enum. */
export const ATTEMPT_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "GRADED",
  "EXPIRED",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * `job_openings.employment_type` — `text` with a CHECK, not an enum.
 *
 * A `FULL_TIME` opening and a `REMOTE` one are the same column, so the words
 * that describe what the person does and where they do it live side by side in
 * one vocabulary.
 */
export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "REMOTE",
  "HYBRID",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** `job_openings.experience_level` — nullable, so null is legal too. */
export const EXPERIENCE_LEVELS = ["JUNIOR", "MID", "SENIOR", "LEAD"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** `sourced_prospects.origin` — how the prospect entered the pool. */
export const PROSPECT_ORIGINS = ["LINKEDIN", "CSV", "MANUAL", "CHATBOT"] as const;
export type ProspectOrigin = (typeof PROSPECT_ORIGINS)[number];

/** `sourced_prospects.stage` — the outreach ladder, separate from the pipeline. */
export const PROSPECT_STAGES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERVIEW",
  "CONVERTED",
  "PASSED",
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

/** `sourced_prospects.profile_source` — which door the captured profile came in through. */
export const PROSPECT_PROFILE_SOURCES = ["URL", "PASTE", "FILE"] as const;
export type ProspectProfileSource = (typeof PROSPECT_PROFILE_SOURCES)[number];

/**
 * `user_profiles.locale` — the languages a person's own copy can be served in.
 *
 * A person's choice, not the viewer's: the public pages remember it per
 * visitor and the staff portal does not read it.
 */
export const LOCALES = ["en", "ar", "ru", "de"] as const;
export type Locale = (typeof LOCALES)[number];
