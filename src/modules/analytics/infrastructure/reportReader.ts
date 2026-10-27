/**
 * Every read behind an exportable report, in one place.
 *
 * The page, the window switcher, the drill-down popups and the download route
 * all come through here, so a file that leaves the building is built from the
 * same query as the screen the recruiter was looking at, and a popup lists the
 * rows the figure above it counted. Two implementations of one report is how an
 * export ends up disagreeing with the page that produced it.
 *
 * Reads are bounded and newest-first, because a report must cost the same no
 * matter how long the company has been hiring. A read that overflows its budget
 * still returns, with a line in `limitations` saying the figures are a floor; a
 * read that *fails* refuses the whole report, because zero where an unknown
 * belongs is the one thing an analytics page must never print.
 */

import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { parseSnapshot } from "@/modules/form-builder/domain/snapshot";
import { LIMITS as FORM_LIMITS } from "@/modules/form-builder/domain/limits";
import {
  computeCareerIndicators,
  type EmploymentRow,
} from "@/modules/candidates/domain/careerIndicators";
import {
  buildFormProfileReport,
  exportableGroups,
  formAnswerCounts,
  identityComplete,
  snapshotLabel,
  type FormFileRow,
  type FormProfileApplicationRow,
  type FormProfileEmploymentRow,
  type FormProfilePersonRow,
  type FormProfileReport,
} from "@/modules/analytics/domain/formAndProfile";
import {
  CANDIDATE_LIST,
  analyticsDocument,
  applicationFormSheet,
  assessmentSheet,
  candidateListSheet,
  messageSheet,
  panelSheet,
  pipelineSheet,
  profileSheet,
  questionSheet,
  reportDefinition,
  rowReportDocument,
  sourcingSheet,
  unclaimedSheet,
  type ApplicationFormRow,
  type AssessmentRow,
  type CandidateListRow,
  type DocumentContext,
  type MessageRow,
  type PanelRow,
  type PipelineRow,
  type ProfileRow,
  type ReportDefinition,
  type ReportId,
  type SourcedRow,
} from "@/modules/analytics/domain/documents";
import type { ExportDocument, ExportSheet } from "@/modules/analytics/domain/exportDocument";
import {
  candidateSortLabel,
  filterCandidates,
  sortCandidates,
  UNGRADED_ATTEMPT_FILTER,
  UNSCORED_ATTEMPT_STATUS,
  type CandidateListFilters,
} from "@/modules/candidates/domain/listFilters";
import {
  buildAnalyticsReport,
  windowCutoff,
  windowLabel,
  type AnalyticsReport,
  type AnalyticsWindow,
  type AttemptRow,
  type InterviewRow,
  type LogRow,
  type ProspectRow,
} from "@/modules/analytics/domain/report";

/** Row budgets per table, shared by the aggregates, the row-level lists and the popups. */
export const LIMITS = {
  attempts: 5000,
  prospects: 3000,
  logs: 5000,
  interviews: 3000,
  applications: 4000,
  formFiles: 8000,
  persons: 4000,
  personEntries: 15000,
} as const;

type Raw = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const str = (value: unknown): string => text(value) ?? "";

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : null;

/** Nested embeds come back as an object, or an array of one on some clients. */
function embedded(row: Raw, key: string): Raw {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] ?? {}) as Raw;
  return (value ?? {}) as Raw;
}

interface Read<T> {
  rows: T[];
  error: string | null;
  truncated: boolean;
}

async function read<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  limit: number,
  label: string
): Promise<Read<T>> {
  const result = await query;
  if (result.error) {
    return { rows: [], error: `${label} could not be read: ${result.error.message}`, truncated: false };
  }
  const rows = (result.data ?? []) as T[];
  return { rows, error: null, truncated: rows.length >= limit };
}

function floor(limit: number, what: string, scope = "in this window"): string {
  return `Only the newest ${limit.toLocaleString()} ${what} ${scope} were read, so this report is a floor, not a total.`;
}

/**
 * Months as words, rounded to the whole month — a report column, not a score.
 *
 * Null stays null: "no dated role" is a fact about the record, and printing
 * "0 months" would read as a career that lasted nothing.
 */
function monthsLabel(months: number | null): string | null {
  if (months === null || !Number.isFinite(months)) return null;
  const total = Math.round(months);
  const years = Math.floor(total / 12);
  const rest = total % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.length === 0 ? "Less than a month" : parts.join(" ");
}

/** The scope, the clock and the masking decision every report is stamped with. */
async function contextFor(
  window: AnalyticsWindow
): Promise<{ context: ReadContext; cutoff: string | null }> {
  const [timeZone, scoresHidden] = await Promise.all([
    getOrganisationTimeZone(),
    scoresAreMaskedForCurrentUser(),
  ]);
  return {
    context: {
      scope: windowLabel(window),
      timeZone,
      generatedAt: new Date().toISOString(),
      scoresHidden,
    },
    cutoff: windowCutoff(window, new Date()),
  };
}

/* ------------------------------------------------------------- analytics -- */

/** The four window-scoped reads, as the typed rows the page and popups share. */
export interface AnalyticsRows {
  attempts: AttemptRow[];
  prospects: ProspectRow[];
  logs: LogRow[];
  interviews: InterviewRow[];
  /** Which read hit its row budget, so its count is a floor rather than a total. */
  floored: Record<"attempts" | "prospects" | "logs" | "interviews", boolean>;
  context: ReadContext;
}

export type AnalyticsRowsRead =
  | { rows: AnalyticsRows; error: null }
  | { rows: null; error: string };

/**
 * Every row the Analytics page is built from, read once.
 *
 * The aggregates and the drill-down popups both come through here, so a number
 * on the screen and the list behind it are counted from the same rows under the
 * same window and the same row budget. Two reads of one table is how a popup
 * ends up naming a total the card above it does not show.
 *
 * Selects carry the columns a list needs (names, openings, subjects) as well as
 * the ones the aggregates use, because a popup that re-queried for its own
 * columns would need its own budget and its own window edge. When the
 * score-masking setting applies to this account the scores are dropped here, so
 * no score reaches a list that was not allowed to read one.
 */
export async function readAnalyticsRows(window: AnalyticsWindow): Promise<AnalyticsRowsRead> {
  const { context, cutoff } = await contextFor(window);
  const restClient = await createServerRestClient();

  const scoped = <T,>(table: string, columns: string, limit: number) => {
    let query = restClient.from(table).select(columns);
    if (cutoff) query = query.gte("created_at", cutoff);
    return read<T>(query.order("created_at", { ascending: false }).limit(limit), limit, table);
  };

  const [attempts, prospects, logs, interviews] = await Promise.all([
    scoped<Raw>(
      "candidate_attempts",
      "id, application_id, status, created_at, started_at, submitted_at, total_score, max_score, " +
        "applications ( full_name, job_openings ( title ) ), assessment_templates ( name )",
      LIMITS.attempts
    ),
    scoped<Raw>(
      "sourced_prospects",
      "id, full_name, headline, company, location, email, origin, stage, created_at, last_contacted_at, application_id",
      LIMITS.prospects
    ),
    scoped<Raw>(
      "communication_logs",
      "id, channel, direction, recipient, subject, delivered, read_at, error_message, created_at, " +
        "prospect_id, application_id, applications ( full_name )",
      LIMITS.logs
    ),
    scoped<Raw>(
      "interview_schedules",
      "id, status, scheduled_at, created_at, duration_minutes, meeting_link, application_id, " +
        "applications ( created_at, job_openings ( title ) ), user_profiles!interview_schedules_interviewer_profile_id_fkey ( full_name )",
      LIMITS.interviews
    ),
  ]);

  const failed = [attempts, prospects, logs, interviews].find((result) => result.error);
  if (failed) return { rows: null, error: failed.error as string };

  const hidden = context.scoresHidden;

  return {
    rows: {
      context,
      floored: {
        attempts: attempts.truncated,
        prospects: prospects.truncated,
        logs: logs.truncated,
        interviews: interviews.truncated,
      },
      attempts: attempts.rows.map((row) => {
        const application = embedded(row, "applications");
        return {
          id: str(row.id),
          application_id: text(row.application_id),
          candidate: text(application.full_name) ?? "(no name on file)",
          opening: text(embedded(application, "job_openings").title),
          suite: text(embedded(row, "assessment_templates").name),
          // A status chip and the list behind it are matched on this string, so
          // a row with no status has to carry the same word the chip prints.
          status: text(row.status) ?? "UNKNOWN",
          created_at: text(row.created_at),
          started_at: text(row.started_at),
          submitted_at: text(row.submitted_at),
          total_score: hidden ? null : num(row.total_score),
          max_score: hidden ? null : num(row.max_score),
        };
      }),
      prospects: prospects.rows.map((row) => ({
        id: str(row.id),
        candidate: str(row.full_name) || "(no name on file)",
        headline: text(row.headline),
        company: text(row.company),
        location: text(row.location),
        email: text(row.email),
        origin: text(row.origin) ?? "LINKEDIN",
        stage: text(row.stage) ?? "NEW",
        created_at: text(row.created_at),
        last_contacted_at: text(row.last_contacted_at),
        application_id: text(row.application_id),
      })),
      logs: logs.rows.map((row) => ({
        id: str(row.id),
        channel: text(row.channel) ?? "UNKNOWN",
        direction: text(row.direction) ?? "OUTBOUND",
        recipient: str(row.recipient),
        subject: text(row.subject),
        delivered: row.delivered === true,
        read_at: text(row.read_at),
        error_message: text(row.error_message),
        created_at: text(row.created_at),
        prospect_id: text(row.prospect_id),
        application_id: text(row.application_id),
        candidate: text(embedded(row, "applications").full_name),
      })),
      interviews: interviews.rows.map((row) => {
        const application = embedded(row, "applications");
        return {
          id: str(row.id),
          status: text(row.status) ?? "UNKNOWN",
          scheduled_at: text(row.scheduled_at),
          created_at: text(row.created_at),
          interviewer: text(embedded(row, "user_profiles").full_name),
          candidate: text(application.full_name),
          opening: text(embedded(application, "job_openings").title),
          application_id: text(row.application_id),
          duration_minutes: num(row.duration_minutes),
          meeting_link: text(row.meeting_link),
          application_created_at: text(application.created_at),
        };
      }),
    },
    error: null,
  };
}

export type AnalyticsRead =
  | { report: AnalyticsReport; error: null }
  | { report: null; error: string };

/* --------------------------------------------------------- form & profile -- */

const FORM_APPLICATION_SELECT =
  "id, form_answers, cv_file_path, processing_consent_at, talent_pool_consent_at, notice_version, " +
  "stage, full_name, created_at, job_openings ( title )";

const PERSON_PROFILE_SELECT =
  "id, legal_name, date_of_birth, gender, nationality, marital_status, children_count, created_at";

/** A profile column and the registry key its non-null value fills. */
const PROFILE_COLUMNS = [
  ["legal_name", "legal_name"],
  ["date_of_birth", "date_of_birth"],
  ["gender", "gender"],
  ["nationality", "nationality"],
  ["marital_status", "marital_status"],
  ["children_count", "children_count"],
] as const;

/**
 * Collection tables whose presence fills a registry key.
 *
 * The two tier-3 collections are listed with the grant that opens them: a
 * caller without the grant does not read the table at all, because "somebody
 * has dependants recorded" is already a fact about a family.
 */
const PERSON_COLLECTIONS: { table: string; key: string; grant: string | null }[] = [
  { table: "person_education", key: "education", grant: null },
  { table: "person_languages", key: "languages", grant: null },
  { table: "person_skills", key: "skills", grant: null },
  { table: "person_certifications", key: "certifications", grant: null },
  { table: "person_dependants", key: "dependants", grant: "candidates.view_family_data" },
  {
    table: "person_emergency_contacts",
    key: "emergency_contacts",
    grant: "candidates.view_emergency_contacts",
  },
];

/** Single-row tier-3 tables: a row with any value fills the key that names its group. */
const PERSON_TIER3: { table: string; key: string; grant: string; columns: string }[] = [
  {
    table: "person_health",
    key: "disability_status",
    grant: "candidates.view_health_data",
    columns:
      "person_id, disability_status, accommodations, chronic_conditions, allergies, dietary_restrictions, blood_type, health_insurance",
  },
  {
    table: "person_family_details",
    key: "partner_name",
    grant: "candidates.view_family_data",
    columns:
      "person_id, partner_name, partner_occupation, partner_contact, anniversary_date, household_composition, family_planning",
  },
];

export interface FormProfileRows {
  applications: FormProfileApplicationRow[];
  profiles: FormProfilePersonRow[];
  attachments: Record<string, number>;
  /** Every form-file row, claimed or not, so abandonment can be counted. */
  files: FormFileRow[];
  employment: FormProfileEmploymentRow[];
  orphanWindowHours: number;
  canViewDemographics: boolean;
  generatedAt: string;
  context: ReadContext;
}

export type FormProfileRowsRead =
  | {
      rows: FormProfileRows;
      error: null;
      floored: {
        applications: boolean;
        profiles: boolean;
        files: boolean;
        collections: boolean;
      };
    }
  | { rows: null; error: string; floored?: undefined };

export type FormProfileRead =
  | {
      report: FormProfileReport;
      error: null;
      floored: {
        applications: boolean;
        profiles: boolean;
        files: boolean;
        collections: boolean;
      };
    }
  | { report: null; error: string; floored?: undefined };

/** Whether the person store is cut by the window alongside the applications. */
export interface FormProfileReadOptions {
  /** Cut the person store by the same window; the analytics section does not. */
  profilesInWindow?: boolean;
}

/**
 * The form and person rows behind the new reporting section.
 *
 * Applications are cut by the same window as every other card; the person
 * store is not, because profile coverage describes the base as it stands, not
 * a cohort of arrivals — the page says so next to the figures. The row-level
 * "every person profile" list opts into the window, because a downloadable
 * list is a set of arrivals and the reader has to be able to narrow it.
 * Collection reads select only `person_id`: the question is whether a group is
 * filled, never what it says, so no tier-1 value passes through this seam either.
 */
export async function readFormProfileRows(
  window: AnalyticsWindow,
  options: FormProfileReadOptions = {}
): Promise<FormProfileRowsRead> {
  const { context, cutoff } = await contextFor(window);
  const restClient = await createServerRestClient();

  const [family, health, emergency] = await Promise.all([
    hasPermissionForUser("candidates.view_family_data"),
    hasPermissionForUser("candidates.view_health_data"),
    hasPermissionForUser("candidates.view_emergency_contacts"),
  ]);
  const held: Record<string, boolean> = {
    "candidates.view_family_data": family,
    "candidates.view_health_data": health,
    "candidates.view_emergency_contacts": emergency,
  };
  const allowed = (grant: string | null) => grant === null || held[grant] === true;

  const scoped = <T,>(table: string, columns: string, order: string, limit: number) => {
    let query = restClient.from(table).select(columns);
    if (cutoff) query = query.gte(order, cutoff);
    return read<T>(query.order(order, { ascending: false }).limit(limit), limit, table);
  };

  const applicationsRead = scoped<Raw>(
    "applications",
    FORM_APPLICATION_SELECT,
    "created_at",
    LIMITS.applications
  );
  const filesRead = scoped<Raw>(
    "application_form_files",
    "application_id, field_key, uploaded_at",
    "uploaded_at",
    LIMITS.formFiles
  );
  let profileQuery = restClient.from("person_profiles").select(PERSON_PROFILE_SELECT);
  if (options.profilesInWindow && cutoff) profileQuery = profileQuery.gte("created_at", cutoff);
  const profilesRead = read<Raw>(
    profileQuery.order("created_at", { ascending: false }).limit(LIMITS.persons),
    LIMITS.persons,
    "person_profiles"
  );
  /* Employment carries the dates the experience roll-up needs, so it is read
   * here rather than through the bare `person_id` collection queries: a second
   * read of one table with a different column list is how the coverage count
   * and the experience count start disagreeing. */
  const employmentRead = read<Raw>(
    restClient
      .from("person_employment")
      .select("person_id, start_year, start_month, end_year, end_month, ongoing")
      .limit(LIMITS.personEntries),
    LIMITS.personEntries,
    "person_employment"
  );

  const collections = PERSON_COLLECTIONS.filter((entry) => allowed(entry.grant)).map((entry) => ({
    entry,
    promise: read<Raw>(
      restClient.from(entry.table).select("person_id").limit(LIMITS.personEntries),
      LIMITS.personEntries,
      entry.table
    ),
  }));
  const tier3 = PERSON_TIER3.filter((entry) => allowed(entry.grant)).map((entry) => ({
    entry,
    promise: read<Raw>(
      restClient.from(entry.table).select(entry.columns).limit(LIMITS.persons),
      LIMITS.persons,
      entry.table
    ),
  }));

  const [applications, files, profiles, employment] = await Promise.all([
    applicationsRead,
    filesRead,
    profilesRead,
    employmentRead,
  ]);
  const collectionResults = await Promise.all(collections.map((entry) => entry.promise));
  const tier3Results = await Promise.all(tier3.map((entry) => entry.promise));

  const failed =
    applications.error ??
    files.error ??
    profiles.error ??
    employment.error ??
    collectionResults.find((result) => result.error)?.error ??
    tier3Results.find((result) => result.error)?.error;
  if (failed) return { rows: null, error: failed };

  const filled = new Map<string, Set<string>>();
  const mark = (personId: string, key: string) => {
    if (!personId) return;
    const keys = filled.get(personId) ?? new Set<string>();
    keys.add(key);
    filled.set(personId, keys);
  };

  collectionResults.forEach((result, index) => {
    const key = collections[index].entry.key;
    for (const row of result.rows) mark(str(row.person_id), key);
  });

  const employmentOut: FormProfileEmploymentRow[] = [];
  for (const row of employment.rows) {
    const personId = str(row.person_id);
    mark(personId, "employment");
    const startYear = num(row.start_year);
    if (startYear === null) continue;
    employmentOut.push({
      person_id: personId,
      // Never printed by the aggregate: the employer name only reaches a
      // caveat inside `computeCareerIndicators`, which this report does not lift.
      employer: "",
      startYear,
      startMonth: num(row.start_month),
      endYear: num(row.end_year),
      endMonth: num(row.end_month),
      ongoing: row.ongoing === true,
    });
  }

  tier3Results.forEach((result, index) => {
    const { key } = tier3[index].entry;
    for (const row of result.rows) {
      const hasValue = Object.entries(row).some(
        ([column, value]) => column !== "person_id" && value !== null && value !== ""
      );
      if (hasValue) mark(str(row.person_id), key);
    }
  });

  const profilesOut: FormProfilePersonRow[] = profiles.rows.map((row) => {
    const id = str(row.id);
    const keys = filled.get(id) ?? new Set<string>();
    for (const [column, key] of PROFILE_COLUMNS) {
      const value = row[column];
      if (value !== null && value !== undefined && value !== "") keys.add(key);
    }
    filled.set(id, keys);
    return {
      id,
      filled: [...keys],
      date_of_birth: text(row.date_of_birth),
      gender: text(row.gender),
      nationality: text(row.nationality),
      marital_status: text(row.marital_status),
      children_count: num(row.children_count),
      legal_name: text(row.legal_name),
      created_at: text(row.created_at),
    };
  });

  const filesOut: FormFileRow[] = files.rows.map((row) => ({
    application_id: text(row.application_id),
    field_key: text(row.field_key),
    uploaded_at: text(row.uploaded_at),
  }));

  const attachments: Record<string, number> = {};
  for (const row of filesOut) {
    if (row.application_id) {
      attachments[row.application_id] = (attachments[row.application_id] ?? 0) + 1;
    }
  }

  const applicationsOut: FormProfileApplicationRow[] = applications.rows.map((row) => ({
    id: str(row.id),
    snapshot: parseSnapshot(row.form_answers),
    has_cv: text(row.cv_file_path) !== null,
    consent: {
      processing: text(row.processing_consent_at) !== null,
      talent_pool: text(row.talent_pool_consent_at) !== null,
      notice_version: text(row.notice_version),
    },
    candidate: text(row.full_name),
    opening: text(embedded(row, "job_openings").title),
    stage: text(row.stage),
    created_at: text(row.created_at),
  }));

  const collectionsFloored = collectionResults.some((result) => result.truncated);

  return {
    rows: {
      applications: applicationsOut,
      profiles: profilesOut,
      attachments,
      files: filesOut,
      employment: employmentOut,
      orphanWindowHours: FORM_LIMITS.orphan_upload_window_hours,
      canViewDemographics: family,
      generatedAt: context.generatedAt,
      context,
    },
    error: null,
    floored: {
      applications: applications.truncated,
      profiles: profiles.truncated,
      files: files.truncated,
      collections: collectionsFloored || employment.truncated || tier3Results.some((result) => result.truncated),
    },
  };
}

/** One report object from one row read, so a row list and the page cannot disagree. */
function reportFromRows(rows: FormProfileRows): FormProfileReport {
  return buildFormProfileReport({
    applications: rows.applications,
    profiles: rows.profiles,
    attachments: rows.attachments,
    files: rows.files,
    employment: rows.employment,
    orphanWindowHours: rows.orphanWindowHours,
    canViewDemographics: rows.canViewDemographics,
    generatedAt: rows.generatedAt,
  });
}

/** The aggregate section, built from the rows the drill lists. */
export async function readFormProfileReport(window: AnalyticsWindow): Promise<FormProfileRead> {
  const read = await readFormProfileRows(window);
  if (!read.rows) return { report: null, error: read.error };

  return {
    report: reportFromRows(read.rows),
    error: null,
    floored: read.floored,
  };
}

/** The aggregate report, built from the shared row read. */
export async function readAnalyticsReport(window: AnalyticsWindow): Promise<AnalyticsRead> {
  const [read, forms] = await Promise.all([readAnalyticsRows(window), readFormProfileReport(window)]);
  if (!read.rows) return { report: null, error: read.error };
  if (!forms.report) return { report: null, error: forms.error };

  const { rows } = read;
  const { context } = rows;
  const limitations: string[] = [];
  if (rows.floored.attempts) limitations.push(floor(LIMITS.attempts, "assessment attempts"));
  if (rows.floored.prospects) limitations.push(floor(LIMITS.prospects, "sourced prospects"));
  if (rows.floored.logs) limitations.push(floor(LIMITS.logs, "messages"));
  if (rows.floored.interviews) limitations.push(floor(LIMITS.interviews, "interview panels"));
  if (forms.floored.applications) limitations.push(floor(LIMITS.applications, "applications"));
  if (forms.floored.files) limitations.push(floor(LIMITS.formFiles, "form attachments"));
  if (forms.floored.profiles) limitations.push(floor(LIMITS.persons, "person profiles"));
  if (forms.floored.collections) {
    limitations.push(
      `Only the newest ${LIMITS.personEntries.toLocaleString()} rows of each profile collection were read, so the coverage figures are a floor, not a total.`
    );
  }
  if (context.scoresHidden) {
    limitations.push(
      "Test scores are withheld from your account by the score-masking setting, so the score spread is not shown."
    );
  }
  limitations.push(
    "How long anyone sits in a pipeline stage cannot be measured: a stage move overwrites the row and only a hire keeps its date."
  );

  const report = buildAnalyticsReport({
    window,
    timeZone: context.timeZone,
    generatedAt: context.generatedAt,
    complete:
      !Object.values(rows.floored).some(Boolean) &&
      !Object.values(forms.floored).some(Boolean),
    scoresHidden: context.scoresHidden,
    limitations,
    attempts: rows.attempts,
    prospects: rows.prospects,
    logs: rows.logs,
    interviews: rows.interviews,
    formProfile: forms.report,
  });

  return { report, error: null };
}

/* ----------------------------------------------------------- row reports -- */

export type RowReportRead =
  | {
      definition: ReportDefinition;
      sheet: ExportSheet;
      limitations: string[];
      timeZone: string;
      /** "90 days" — what the page says this list is cut by. */
      scope: string;
      generatedAt: string;
      scoresHidden: boolean;
      /** The form the list was narrowed to, when a filter was applied. */
      formName: string | null;
      error: null;
    }
  | { error: string; sheet?: undefined };

/** What may narrow a row report. Only the two form reports read `formId`. */
export interface RowReportFilters {
  /** A form uuid, already validated by the caller; `null` is the whole list. */
  formId?: string | null;
}

/**
 * One row-level list, ready for the page to draw and the route to export.
 *
 * `formId` narrows the two form reports only: a form is matched by the id its
 * snapshot recorded, so the list holds the applications that actually filed
 * against it, including ones filed before a later edit or after a retirement. The
 * other seven reports ignore it and say so by returning the whole window.
 */
export async function readRowReport(
  id: ReportId,
  window: AnalyticsWindow,
  filters: RowReportFilters = {}
): Promise<RowReportRead> {
  const definition = reportDefinition(id);
  if (!definition) return refusal("That report does not exist.");

  const { context, cutoff } = await contextFor(window);
  const restClient = await createServerRestClient();
  const scoped = <T,>(columns: string, limit: number, table: string, order = "created_at") => {
    let query = restClient.from(table).select(columns);
    if (cutoff) query = query.gte(order, cutoff);
    return read<T>(query.order(order, { ascending: false }).limit(limit), limit, table);
  };

  /* The filter's name is resolved once, before either form report reads: the
   * scope line and the limitation both need it, and a form id that names no form
   * is a refusal rather than a silently empty list. */
  const formId =
    filters.formId && (id === "application_forms" || id === "form_questions")
      ? filters.formId
      : null;
  let formName: string | null = null;
  if (formId) {
    const formRow = await restClient
      .from("application_forms")
      .select("name")
      .eq("id", formId)
      .maybeSingle();
    if (formRow.error) return refusal(`The form could not be read: ${formRow.error.message}`);
    if (!formRow.data) return refusal("That form no longer exists, so the list cannot be narrowed to it.");
    formName = text((formRow.data as { name: string }).name) ?? "";
  }
  const narrowed = formId
    ? {
        scope: `${context.scope} · only “${formName}”`,
        limitation: `Only applications whose filed form was “${formName}” are in this list; applications filed against other forms share the window but not these rows.`,
        formName,
      }
    : undefined;
  const matchesForm = (snapshot: ReturnType<typeof parseSnapshot>) =>
    formId === null || snapshot?.forms.some((form) => form.id === formId) === true;

  if (id === "pipeline") {
    const result = await scoped<Raw>(
      "full_name, email, phone, stage, source, ai_match_score, created_at, updated_at, hired_at, rejection_reason, archived_at, job_openings ( title )",
      LIMITS.applications,
      "applications"
    );
    if (result.error) return refusal(result.error);
    const rows: PipelineRow[] = result.rows.map((row) => ({
      full_name: str(row.full_name),
      email: text(row.email),
      phone: text(row.phone),
      opening: text(embedded(row, "job_openings").title),
      stage: text(row.stage) ?? "NEW",
      source: text(row.source) ?? "CAREER_SITE",
      ai_match_score: num(row.ai_match_score),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
      hired_at: text(row.hired_at),
      rejection_reason: text(row.rejection_reason),
      archived_at: text(row.archived_at),
    }));
    return deliver(
      definition,
      pipelineSheet(rows, context),
      context,
      result.truncated,
      LIMITS.applications,
      "applications"
    );
  }

  if (id === "assessments") {
    const result = await scoped<Raw>(
      "status, created_at, started_at, submitted_at, expires_at, total_score, max_score, applications ( full_name, job_openings ( title ) ), assessment_templates ( name )",
      LIMITS.attempts,
      "candidate_attempts"
    );
    if (result.error) return refusal(result.error);
    const rows: AssessmentRow[] = result.rows.map((row) => {
      const application = embedded(row, "applications");
      return {
        full_name: text(application.full_name),
        opening: text(embedded(application, "job_openings").title),
        suite: text(embedded(row, "assessment_templates").name),
        status: str(row.status),
        invited_at: text(row.created_at),
        started_at: text(row.started_at),
        submitted_at: text(row.submitted_at),
        expires_at: text(row.expires_at),
        total_score: num(row.total_score),
        max_score: num(row.max_score),
      };
    });
    return deliver(
      definition,
      assessmentSheet(rows, context),
      context,
      result.truncated,
      LIMITS.attempts,
      "assessment invites"
    );
  }

  if (id === "sourcing") {
    const [prospects, messages] = await Promise.all([
      scoped<Raw>(
        "id, full_name, headline, company, location, email, origin, stage, created_at, last_contacted_at, application_id, profile_source",
        LIMITS.prospects,
        "sourced_prospects"
      ),
      scoped<Raw>("prospect_id, created_at", LIMITS.logs, "communication_logs"),
    ]);
    if (prospects.error) return refusal(prospects.error);
    if (messages.error) return refusal(messages.error);

    const tally = new Map<string, number>();
    for (const row of messages.rows) {
      const prospectId = text(row.prospect_id);
      if (!prospectId) continue;
      tally.set(prospectId, (tally.get(prospectId) ?? 0) + 1);
    }

    const rows: SourcedRow[] = prospects.rows.map((row) => ({
      full_name: str(row.full_name),
      headline: text(row.headline),
      company: text(row.company),
      location: text(row.location),
      email: text(row.email),
      origin: text(row.origin) ?? "LINKEDIN",
      stage: text(row.stage) ?? "NEW",
      created_at: text(row.created_at),
      last_contacted_at: text(row.last_contacted_at),
      application_id: text(row.application_id),
      profile_source: text(row.profile_source),
      messages: tally.get(str(row.id)) ?? 0,
    }));
    return deliver(
      definition,
      sourcingSheet(rows, context),
      context,
      prospects.truncated || messages.truncated,
      LIMITS.prospects,
      "prospects"
    );
  }

  if (id === "messages") {
    const result = await scoped<Raw>(
      "channel, direction, recipient, subject, delivered, read_at, error_message, created_at, applications ( full_name, job_openings ( title ) )",
      LIMITS.logs,
      "communication_logs"
    );
    if (result.error) return refusal(result.error);
    const rows: MessageRow[] = result.rows.map((row) => {
      const application = embedded(row, "applications");
      return {
        created_at: text(row.created_at),
        channel: text(row.channel) ?? "UNKNOWN",
        direction: text(row.direction) ?? "OUTBOUND",
        recipient: str(row.recipient),
        subject: text(row.subject),
        delivered: row.delivered === true,
        read_at: text(row.read_at),
        error_message: text(row.error_message),
        full_name: text(application.full_name),
        opening: text(embedded(application, "job_openings").title),
      };
    });
    /* The message body is deliberately not read here: the Outbox page owns the
     * copy, and a downloadable file that pasted every body into a column would
     * be a second PII export nobody asked for. */
    return deliver(
      definition,
      messageSheet(rows, context),
      context,
      result.truncated,
      LIMITS.logs,
      "messages"
    );
  }

  if (id === "application_forms") {
    const forms = await readFormProfileRows(window);
    if (!forms.rows) return refusal(forms.error);
    const rows: ApplicationFormRow[] = forms.rows.applications
      .filter((application) => matchesForm(application.snapshot))
      .map((application) => {
        const counts = formAnswerCounts(application.snapshot);
        return {
          candidate: application.candidate ?? "",
          opening: application.opening ?? null,
          stage: application.stage ?? "NEW",
          applied_at: application.created_at ?? null,
          form: snapshotLabel(application.snapshot),
          asked: counts?.asked ?? null,
          answered: counts?.answered ?? null,
          attachments: forms.rows.attachments[application.id] ?? 0,
          cv: application.has_cv,
          processing_consent: application.consent.processing,
          talent_pool_consent: application.consent.talent_pool,
          notice_version: application.consent.notice_version,
        };
      });
    return deliver(
      definition,
      applicationFormSheet(rows, context),
      context,
      forms.floored.applications || forms.floored.files,
      LIMITS.applications,
      "applications",
      narrowed
    );
  }

  if (id === "form_questions") {
    const forms = await readFormProfileRows(window);
    if (!forms.rows) return refusal(forms.error);
    /* A question list narrowed to one form counts the applications that filed
     * it, not the whole window: the sheet is built from the same snapshot
     * predicate, so its "Asked" column and the row count agree. */
    const report = reportFromRows(
      formId
        ? {
            ...forms.rows,
            applications: forms.rows.applications.filter((application) =>
              matchesForm(application.snapshot)
            ),
          }
        : forms.rows
    );
    return deliver(
      definition,
      questionSheet(report.questions, context),
      context,
      forms.floored.applications,
      LIMITS.applications,
      "applications",
      narrowed
    );
  }

  if (id === "unclaimed_uploads") {
    const forms = await readFormProfileRows(window);
    if (!forms.rows) return refusal(forms.error);
    const report = reportFromRows(forms.rows);
    return deliver(
      definition,
      unclaimedSheet(report.completion.fields, context),
      context,
      forms.floored.files,
      LIMITS.formFiles,
      "form-file rows"
    );
  }

  if (id === "person_profiles") {
    const forms = await readFormProfileRows(window, { profilesInWindow: true });
    if (!forms.rows) return refusal(forms.error);

    const employmentByPerson = new Map<string, EmploymentRow[]>();
    for (const row of forms.rows.employment) {
      const roles = employmentByPerson.get(row.person_id);
      if (roles) roles.push(row);
      else employmentByPerson.set(row.person_id, [row]);
    }
    const at = new Date(forms.rows.generatedAt);

    const rows: ProfileRow[] = forms.rows.profiles.map((profile) => {
      const roles = employmentByPerson.get(profile.id) ?? [];
      const career = roles.length === 0 ? null : computeCareerIndicators(roles, at);
      return {
        full_name: profile.legal_name ?? "",
        added_at: profile.created_at ?? null,
        identity_complete: identityComplete(profile.filled),
        /* Labels, not keys: a key such as `gender` would say which field was
         * filled, and the group label says only that the group was. */
        groups: exportableGroups(profile.filled),
        total_experience: monthsLabel(career?.totalMonths ?? null),
        roles: roles.length,
        longest_role: monthsLabel(career?.longestRoleMonths ?? null),
        longest_gap: monthsLabel(career?.longestGapMonths ?? null),
      };
    });
    return deliver(
      definition,
      profileSheet(rows, context),
      context,
      forms.floored.profiles || forms.floored.collections,
      LIMITS.persons,
      "person profiles"
    );
  }

  const panels = await scoped<Raw>(
    "scheduled_at, status, duration_minutes, meeting_link, calendar_provider, created_at, applications ( full_name, created_at, job_openings ( title ) ), user_profiles!interview_schedules_interviewer_profile_id_fkey ( full_name )",
    LIMITS.interviews,
    "interview_schedules",
    "scheduled_at"
  );
  if (panels.error) return refusal(panels.error);
  const rows: PanelRow[] = panels.rows.map((row) => {
    const application = embedded(row, "applications");
    return {
      scheduled_at: text(row.scheduled_at),
      full_name: text(application.full_name),
      opening: text(embedded(application, "job_openings").title),
      interviewer: text(embedded(row, "user_profiles").full_name),
      status: str(row.status),
      duration_minutes: num(row.duration_minutes),
      created_at: text(row.created_at),
      application_created_at: text(application.created_at),
      meeting_link: text(row.meeting_link),
      calendar_provider: text(row.calendar_provider),
    };
  });
  return deliver(
    definition,
    panelSheet(rows, context),
    context,
    panels.truncated,
    LIMITS.interviews,
    "interview panels"
  );
}

/* ------------------------------------------------------------- documents -- */

/** The same report the page shows, as the file the download route hands back. */
export async function buildReportDocument(
  id: "analytics" | ReportId,
  window: AnalyticsWindow,
  exportedBy: string,
  formId: string | null = null
): Promise<{ document: ExportDocument } | { error: string }> {
  const baseName = `sharm-dreams-${id}-${window}-${new Date().toISOString().slice(0, 10)}`;

  if (id === "analytics") {
    const { report, error } = await readAnalyticsReport(window);
    if (error || !report) return { error: error ?? "The report could not be read." };
    return {
      document: analyticsDocument(report, {
        scope: report.windowLabel,
        timeZone: report.timeZone,
        generatedAt: report.generatedAt,
        scoresHidden: report.scoresHidden,
        exportedBy,
        baseName,
      }),
    };
  }

  const result = await readRowReport(id, window, { formId });
  if (result.error || !result.sheet) return { error: result.error };

  return {
    document: rowReportDocument(result.definition, result.sheet, {
      scope: result.scope,
      timeZone: result.timeZone,
      generatedAt: result.generatedAt,
      scoresHidden: result.scoresHidden,
      exportedBy,
      baseName,
    }, result.limitations),
  };
}

/* ------------------------------------------------------ candidate export -- */

/** The console's filters, plus which of its views is open. */
export interface CandidateExportFilters extends CandidateListFilters {
  archived: boolean;
  /** The grading queue: only candidates whose attempt is still unscored. */
  ungraded: boolean;
  /**
   * The company rail, as the toolbar holds it.
   *
   * A uuid, or `null` — `candidateFilters` drops anything else. Not passed to
   * `filterCandidates`: the database narrows the rows with it, and the shared
   * predicate has no company column to compare against on the JS side.
   */
  company: string | null;
}

/** Every application the console is filtered to, not the 50 rows it loaded. */
const CANDIDATE_EXPORT_SELECT = (ungraded: boolean, company: string | null) =>
  "full_name, email, phone, tracking_code, stage, source, ai_match_score, created_at, updated_at, hired_at, rejection_reason, archived_at, " +
  // `applications` carries no company of its own, so the rail reaches one through
  // the opening — and only `!inner` makes that filter move candidate rows rather
  // than trim an array hanging off them. Probed on the live pool: without it every
  // application of the group survives a single company's predicate.
  `${company ? "job_openings!inner" : "job_openings"} ( title, tenant_id, tenants_and_companies ( name ) ), ` +
  // `!inner` is what makes the attempt status filter the *candidate* rows rather
  // than only the array hanging off them. Same `!inner` + status + live-rows
  // predicate the page and the Bell read, so a download from the grading queue
  // holds the queue — the columns differ because this file also quotes the marks
  // ceiling and when the attempt was opened.
  (ungraded
    ? "candidate_attempts!inner ( status, total_score, max_score, created_at )"
    : "candidate_attempts ( status, total_score, max_score, created_at )") +
  ", interview_schedules ( scheduled_at, status )";

const lower = (value: string): string => value.replace(/_/g, " ").toLowerCase();

/** The sentence that tells a reader which applications their file holds. */
function candidateScope(filters: CandidateExportFilters, companyName: string | null): string {
  const parts = [
    filters.ungraded
      ? "Applications whose assessment is submitted and still ungraded"
      : filters.archived
        ? "Filed-away applications"
        : "Live pipeline applications",
  ];
  if (filters.stage) parts.push(`stage ${lower(filters.stage)}`);
  if (filters.source) parts.push(`source ${lower(filters.source)}`);
  if (filters.company) parts.push(`company ${companyName ?? filters.company}`);
  const q = (filters.query ?? "").trim();
  if (q) parts.push(`matching "${q}"`);
  parts.push(candidateSortLabel(filters.sort));
  return parts.join(", ");
}

/** The most recent attempt, because PostgREST does not order embedded rows. */
function newestAttempt(row: Raw): Raw | null {
  const attempts = (Array.isArray(row.candidate_attempts)
    ? row.candidate_attempts
    : [row.candidate_attempts]
  ).filter(Boolean) as Raw[];
  if (attempts.length === 0) return null;
  return attempts.sort(
    (a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  )[0];
}

/** The soonest slot still on the calendar, ignoring a panel already cancelled. */
function nextPanel(row: Raw, now: number): string | null {
  const booked = (Array.isArray(row.interview_schedules)
    ? row.interview_schedules
    : [row.interview_schedules]
  )
    .filter(Boolean)
    .map((value) => value as Raw)
    .filter((panel) => text(panel.status) !== "CANCELLED")
    .map((panel) => text(panel.scheduled_at))
    .filter((at): at is string => at !== null && Date.parse(at) >= now)
    .sort((a, b) => a.localeCompare(b));
  return booked[0] ?? null;
}

/** The company the opening sits under, two embeds deep. */
function companyNameOf(row: Raw): string | null {
  return text(embedded(embedded(row, "job_openings"), "tenants_and_companies").name);
}

function toCandidateRow(row: Raw, scoresHidden: boolean): CandidateListRow {
  const attempt = newestAttempt(row);
  return {
    full_name: str(row.full_name),
    tracking_code: str(row.tracking_code),
    email: str(row.email),
    phone: text(row.phone),
    job_title: text(embedded(row, "job_openings").title),
    company_name: companyNameOf(row),
    stage: text(row.stage) ?? "NEW",
    source: text(row.source) ?? "CAREER_SITE",
    /* Masked before the search and the sort, so "highest AI fit" cannot order
     * rows by a number this account is not allowed to read. */
    ai_match_score: scoresHidden ? null : num(row.ai_match_score),
    attempt_status: text(attempt?.status),
    attempt_score: scoresHidden ? null : num(attempt?.total_score),
    attempt_max: scoresHidden ? null : num(attempt?.max_score),
    next_panel_at: nextPanel(row, Date.now()),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    hired_at: text(row.hired_at),
    rejection_reason: text(row.rejection_reason),
    archived_at: text(row.archived_at),
  };
}

/**
 * The candidates console as a file.
 *
 * Stage, source, the company rail, the archive view and the grading queue go
 * into SQL because they are exact matches. The free text does not: `ILIKE` reads
 * the `_` and `%` in a real name as wildcards, so the search runs through the
 * same predicate the table uses — which is how a download answers the question on
 * the screen instead of a near copy of it.
 */
export async function buildCandidateExport(
  filters: CandidateExportFilters,
  exportedBy: string
): Promise<{ document: ExportDocument } | { error: string }> {
  const [timeZone, scoresHidden] = await Promise.all([
    getOrganisationTimeZone(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const restClient = await createServerRestClient();

  /* The rail is quoted by name in the file's own "Covers" line, so it is looked
   * up before anything is read — and an id no company carries is refused rather
   * than answered with an empty spreadsheet that implies a real group has nobody
   * in it. The same refusal the chat makes on the same id. */
  let companyName: string | null = null;
  if (filters.company) {
    const one = await restClient
      .from("tenants_and_companies")
      .select("name")
      .eq("id", filters.company)
      .maybeSingle();
    if (one.error) return { error: `That company could not be read: ${one.error.message}` };
    if (!one.data) {
      return { error: "No company carries that id, so there is nothing to download under it." };
    }
    companyName = (one.data as { name: string }).name;
  }

  let query = restClient
    .from("applications")
    .select(CANDIDATE_EXPORT_SELECT(filters.ungraded, filters.company));
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.company) query = query.eq("job_openings.tenant_id", filters.company);
  if (filters.ungraded) query = query.eq(UNGRADED_ATTEMPT_FILTER, UNSCORED_ATTEMPT_STATUS);
  // The queue is by definition live records — a filed-away candidate is not work
  // waiting on a person — so asking for both views cannot quietly cancel the
  // filter the screen is showing.
  query =
    filters.archived && !filters.ungraded
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);

  const result = await read<Raw>(
    query.order("created_at", { ascending: false }).limit(LIMITS.applications),
    LIMITS.applications,
    "applications"
  );
  if (result.error) return { error: result.error };

  const rows = result.rows.map((row) => toCandidateRow(row, scoresHidden));
  const kept = sortCandidates(filterCandidates(rows, filters), filters.sort);

  const limitations = [...CANDIDATE_LIST.caveats];
  if (scoresHidden) {
    limitations.push(
      "Score columns are left out of this file: the score-masking setting withholds test and AI scores from your account."
    );
  }
  if (result.truncated) {
    limitations.push(floor(LIMITS.applications, "applications", "matching these filters"));
  }

  const generatedAt = new Date().toISOString();
  const view = filters.ungraded ? "grading-queue" : filters.archived ? "archive" : "pipeline";
  return {
    document: rowReportDocument(
      CANDIDATE_LIST,
      candidateListSheet(kept, { timeZone, scoresHidden }),
      {
        scope: candidateScope(filters, companyName),
        timeZone,
        generatedAt,
        scoresHidden,
        exportedBy,
        baseName: `sharm-dreams-candidates-${view}-${generatedAt.slice(0, 10)}`,
      },
      limitations
    ),
  };
}

/* ------------------------------------------------------------- internals -- */

type ReadContext = Omit<DocumentContext, "exportedBy" | "baseName">;
function refusal(error: string): RowReportRead {
  return { error };
}

/**
 * The rows plus every reason they are not the whole picture.
 *
 * The report's own caveats lead the list, because a reader who opens the Excel
 * file needs them before they need the row budget. `extra` is how a narrowed
 * list says it is narrowed: the scope line names the form and the limitation
 * sits with the budget line, so a reader never mistakes a slice for the window.
 */
function deliver(
  definition: ReportDefinition,
  sheet: ExportSheet,
  context: ReadContext,
  truncated: boolean,
  limit: number,
  what: string,
  extra: { scope?: string; limitation?: string; formName?: string | null } = {}
): RowReportRead {
  const limitations = [...definition.caveats];
  if (context.scoresHidden) {
    limitations.push(
      "Score columns are left out of this report: the score-masking setting withholds test and AI scores from your account."
    );
  }
  if (truncated) limitations.push(floor(limit, what));
  if (extra.limitation) limitations.push(extra.limitation);

  return {
    definition,
    sheet,
    limitations,
    timeZone: context.timeZone,
    scope: extra.scope ?? context.scope,
    generatedAt: context.generatedAt,
    scoresHidden: context.scoresHidden,
    formName: extra.formName ?? null,
    error: null,
  };
}
