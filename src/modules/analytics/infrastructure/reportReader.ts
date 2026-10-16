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

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import {
  CANDIDATE_LIST,
  analyticsDocument,
  assessmentSheet,
  candidateListSheet,
  messageSheet,
  panelSheet,
  pipelineSheet,
  reportDefinition,
  rowReportDocument,
  sourcingSheet,
  type AssessmentRow,
  type CandidateListRow,
  type DocumentContext,
  type MessageRow,
  type PanelRow,
  type PipelineRow,
  type ReportDefinition,
  type ReportId,
  type SourcedRow,
} from "@/modules/analytics/domain/documents";
import type { ExportDocument, ExportSheet } from "@/modules/analytics/domain/exportDocument";
import {
  candidateSortLabel,
  filterCandidates,
  sortCandidates,
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
  const supabase = await createSupabaseServerClient();

  const scoped = <T,>(table: string, columns: string, limit: number) => {
    let query = supabase.from(table).select(columns);
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
        "applications ( created_at, job_openings ( title ) ), user_profiles ( full_name )",
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

/** The aggregate report, built from the shared row read. */
export async function readAnalyticsReport(window: AnalyticsWindow): Promise<AnalyticsRead> {
  const read = await readAnalyticsRows(window);
  if (!read.rows) return { report: null, error: read.error };

  const { rows } = read;
  const { context } = rows;
  const limitations: string[] = [];
  if (rows.floored.attempts) limitations.push(floor(LIMITS.attempts, "assessment attempts"));
  if (rows.floored.prospects) limitations.push(floor(LIMITS.prospects, "sourced prospects"));
  if (rows.floored.logs) limitations.push(floor(LIMITS.logs, "messages"));
  if (rows.floored.interviews) limitations.push(floor(LIMITS.interviews, "interview panels"));
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
    complete: !Object.values(rows.floored).some(Boolean),
    scoresHidden: context.scoresHidden,
    limitations,
    attempts: rows.attempts,
    prospects: rows.prospects,
    logs: rows.logs,
    interviews: rows.interviews,
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
      error: null;
    }
  | { error: string; sheet?: undefined };

/** One row-level list, ready for the page to draw and the route to export. */
export async function readRowReport(
  id: ReportId,
  window: AnalyticsWindow
): Promise<RowReportRead> {
  const definition = reportDefinition(id);
  if (!definition) return refusal("That report does not exist.");

  const { context, cutoff } = await contextFor(window);
  const supabase = await createSupabaseServerClient();
  const scoped = <T,>(columns: string, limit: number, table: string, order = "created_at") => {
    let query = supabase.from(table).select(columns);
    if (cutoff) query = query.gte(order, cutoff);
    return read<T>(query.order(order, { ascending: false }).limit(limit), limit, table);
  };

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

  const panels = await scoped<Raw>(
    "scheduled_at, status, duration_minutes, meeting_link, calendar_provider, created_at, applications ( full_name, created_at, job_openings ( title ) ), user_profiles ( full_name )",
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
  exportedBy: string
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

  const result = await readRowReport(id, window);
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

/** The console's filters, plus which of its two views is open. */
export interface CandidateExportFilters extends CandidateListFilters {
  archived: boolean;
}

/** Every application the console is filtered to, not the 50 rows it loaded. */
const CANDIDATE_EXPORT_SELECT =
  "full_name, email, phone, tracking_code, stage, source, ai_match_score, created_at, updated_at, hired_at, rejection_reason, archived_at, " +
  "job_openings ( title ), candidate_attempts ( status, total_score, max_score, created_at ), interview_schedules ( scheduled_at, status )";

const lower = (value: string): string => value.replace(/_/g, " ").toLowerCase();

/** The sentence that tells a reader which applications their file holds. */
function candidateScope(filters: CandidateExportFilters): string {
  const parts = [filters.archived ? "Filed-away applications" : "Live pipeline applications"];
  if (filters.stage) parts.push(`stage ${lower(filters.stage)}`);
  if (filters.source) parts.push(`source ${lower(filters.source)}`);
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

function toCandidateRow(row: Raw, scoresHidden: boolean): CandidateListRow {
  const attempt = newestAttempt(row);
  return {
    full_name: str(row.full_name),
    tracking_code: str(row.tracking_code),
    email: str(row.email),
    phone: text(row.phone),
    job_title: text(embedded(row, "job_openings").title),
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
 * Stage, source and the archive view go into SQL because they are exact enum
 * matches. The free text does not: `ILIKE` reads the `_` and `%` in a real name
 * as wildcards, so the search runs through the same predicate the table uses —
 * which is how a download answers the question on the screen instead of a near
 * copy of it.
 */
export async function buildCandidateExport(
  filters: CandidateExportFilters,
  exportedBy: string
): Promise<{ document: ExportDocument } | { error: string }> {
  const [timeZone, scoresHidden] = await Promise.all([
    getOrganisationTimeZone(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const supabase = await createSupabaseServerClient();

  let query = supabase.from("applications").select(CANDIDATE_EXPORT_SELECT);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.source) query = query.eq("source", filters.source);
  query = filters.archived
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
  return {
    document: rowReportDocument(
      CANDIDATE_LIST,
      candidateListSheet(kept, { timeZone, scoresHidden }),
      {
        scope: candidateScope(filters),
        timeZone,
        generatedAt,
        scoresHidden,
        exportedBy,
        baseName: `sharm-dreams-candidates-${filters.archived ? "archive" : "pipeline"}-${generatedAt.slice(0, 10)}`,
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
 * file needs them before they need the row budget.
 */
function deliver(
  definition: ReportDefinition,
  sheet: ExportSheet,
  context: ReadContext,
  truncated: boolean,
  limit: number,
  what: string
): RowReportRead {
  const limitations = [...definition.caveats];
  if (context.scoresHidden) {
    limitations.push(
      "Score columns are left out of this report: the score-masking setting withholds test and AI scores from your account."
    );
  }
  if (truncated) limitations.push(floor(limit, what));

  return {
    definition,
    sheet,
    limitations,
    timeZone: context.timeZone,
    scope: context.scope,
    generatedAt: context.generatedAt,
    scoresHidden: context.scoresHidden,
    error: null,
  };
}
