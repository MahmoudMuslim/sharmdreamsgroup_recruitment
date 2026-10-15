/**
 * Every read behind an exportable report, in one place.
 *
 * The page, the window switcher and the download route all come through here,
 * so a file that leaves the building is built from the same query as the screen
 * the recruiter was looking at. Two implementations of one report is how an
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
  analyticsDocument,
  assessmentSheet,
  messageSheet,
  panelSheet,
  pipelineSheet,
  reportDefinition,
  rowReportDocument,
  sourcingSheet,
  type AssessmentRow,
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
  buildAnalyticsReport,
  windowCutoff,
  windowLabel,
  type AnalyticsReport,
  type AnalyticsWindow,
} from "@/modules/analytics/domain/report";

/** Row budgets per table, shared by the aggregates and the row-level lists. */
const LIMITS = {
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

function floor(limit: number, what: string): string {
  return `Only the newest ${limit.toLocaleString()} ${what} in this window were read, so this report is a floor, not a total.`;
}

/** The window, the clock and the masking decision every report is stamped with. */
async function contextFor(
  window: AnalyticsWindow
): Promise<{ context: Omit<DocumentContext, "exportedBy" | "baseName">; cutoff: string | null }> {
  const [timeZone, scoresHidden] = await Promise.all([
    getOrganisationTimeZone(),
    scoresAreMaskedForCurrentUser(),
  ]);
  return {
    context: {
      window,
      windowLabel: windowLabel(window),
      timeZone,
      generatedAt: new Date().toISOString(),
      scoresHidden,
    },
    cutoff: windowCutoff(window, new Date()),
  };
}

/* ------------------------------------------------------------- analytics -- */

export type AnalyticsRead =
  | { report: AnalyticsReport; error: null }
  | { report: null; error: string };

/** The four newest-first reads behind every aggregate on the Analytics page. */
export async function readAnalyticsReport(window: AnalyticsWindow): Promise<AnalyticsRead> {
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
      "status, created_at, started_at, submitted_at, total_score, max_score",
      LIMITS.attempts
    ),
    scoped<Raw>("sourced_prospects", "id, stage, created_at, application_id", LIMITS.prospects),
    scoped<Raw>("communication_logs", "channel, delivered, read_at, created_at, prospect_id", LIMITS.logs),
    scoped<Raw>(
      "interview_schedules",
      "status, scheduled_at, created_at, applications ( created_at ), user_profiles ( full_name )",
      LIMITS.interviews
    ),
  ]);

  const failed = [attempts, prospects, logs, interviews].find((result) => result.error);
  if (failed) return { report: null, error: failed.error as string };

  const limitations: string[] = [];
  if (attempts.truncated) limitations.push(floor(LIMITS.attempts, "assessment attempts"));
  if (prospects.truncated) limitations.push(floor(LIMITS.prospects, "sourced prospects"));
  if (logs.truncated) limitations.push(floor(LIMITS.logs, "messages"));
  if (interviews.truncated) limitations.push(floor(LIMITS.interviews, "interview panels"));
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
    complete: ![attempts, prospects, logs, interviews].some((result) => result.truncated),
    scoresHidden: context.scoresHidden,
    limitations,
    attempts: attempts.rows.map((row) => ({
      status: str(row.status),
      created_at: text(row.created_at),
      started_at: text(row.started_at),
      submitted_at: text(row.submitted_at),
      total_score: num(row.total_score),
      max_score: num(row.max_score),
    })),
    prospects: prospects.rows.map((row) => ({
      id: str(row.id),
      stage: text(row.stage) ?? "NEW",
      created_at: text(row.created_at),
      application_id: text(row.application_id),
    })),
    logs: logs.rows.map((row) => ({
      channel: text(row.channel) ?? "UNKNOWN",
      delivered: row.delivered === true,
      read_at: text(row.read_at),
      created_at: text(row.created_at),
      prospect_id: text(row.prospect_id),
    })),
    interviews: interviews.rows.map((row) => ({
      status: str(row.status),
      scheduled_at: text(row.scheduled_at),
      created_at: text(row.created_at),
      interviewer: text(embedded(row, "user_profiles").full_name),
      application_created_at: text(embedded(row, "applications").created_at),
    })),
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
      windowLabel: string;
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
        window,
        windowLabel: report.windowLabel,
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
      window,
      windowLabel: result.windowLabel,
      timeZone: result.timeZone,
      generatedAt: result.generatedAt,
      scoresHidden: result.scoresHidden,
      exportedBy,
      baseName,
    }, result.limitations),
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
    windowLabel: context.windowLabel,
    generatedAt: context.generatedAt,
    scoresHidden: context.scoresHidden,
    error: null,
  };
}
