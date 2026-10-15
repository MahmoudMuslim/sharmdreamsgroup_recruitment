"use server";

import { requireStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ANALYTICS_WINDOWS,
  buildAnalyticsReport,
  reportToCsv,
  windowCutoff,
  type AnalyticsReport,
  type AnalyticsWindow,
} from "@/modules/analytics/domain/report";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";

/**
 * Reads are bounded and newest-first, because an analytics page must cost the
 * same regardless of how long the company has been hiring. A window that
 * overflows its budget still renders — the report carries a `limitations` line
 * saying the counts are a floor — but a read that *fails* refuses the whole
 * report instead of showing zero where an unknown belongs.
 */
const ATTEMPT_LIMIT = 5000;
const PROSPECT_LIMIT = 3000;
const LOG_LIMIT = 5000;
const INTERVIEW_LIMIT = 3000;

const VIEW_DENIED = "This report needs the View analytics permission.";
const EXPORT_DENIED = "Downloading this report needs the Export analytics permission.";

export interface AnalyticsResult {
  ok: boolean;
  report?: AnalyticsReport;
  error?: string;
}

export interface AnalyticsExport {
  ok: boolean;
  csv?: string;
  fileName?: string;
  error?: string;
}

/** A window key arrives from a client component, so its shape is checked. */
function safeWindow(value: unknown): AnalyticsWindow {
  return ANALYTICS_WINDOWS.some((option) => option.key === value)
    ? (value as AnalyticsWindow)
    : "90";
}

async function read(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  limit: number,
  label: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null; truncated: boolean }> {
  const result = await query;
  if (result.error) {
    return { rows: [], error: `${label} could not be read: ${result.error.message}`, truncated: false };
  }
  const rows = (result.data ?? []) as Record<string, unknown>[];
  return { rows, error: null, truncated: rows.length >= limit };
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Nested embeds come back as an object, or an array of one on some clients. */
function embedded(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] ?? {}) as Record<string, unknown>;
  return (value ?? {}) as Record<string, unknown>;
}

async function assemble(
  value: unknown
): Promise<{ report: AnalyticsReport; error: null } | { report: null; error: string }> {
  const window = safeWindow(value);
  const supabase = await createSupabaseServerClient();
  const [timeZone, scoresHidden] = await Promise.all([
    getOrganisationTimeZone(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const generatedAt = new Date().toISOString();
  const cutoff = windowCutoff(window, new Date());

  let attemptsQuery = supabase
    .from("candidate_attempts")
    .select("status, created_at, started_at, submitted_at, total_score, max_score");
  let prospectsQuery = supabase
    .from("sourced_prospects")
    .select("id, stage, created_at, application_id");
  let logsQuery = supabase
    .from("communication_logs")
    .select("channel, delivered, read_at, created_at, prospect_id");
  let interviewsQuery = supabase
    .from("interview_schedules")
    .select("status, scheduled_at, created_at, applications ( created_at ), user_profiles ( full_name )");

  if (cutoff) {
    attemptsQuery = attemptsQuery.gte("created_at", cutoff);
    prospectsQuery = prospectsQuery.gte("created_at", cutoff);
    logsQuery = logsQuery.gte("created_at", cutoff);
    interviewsQuery = interviewsQuery.gte("created_at", cutoff);
  }

  const [attempts, prospects, logs, interviews] = await Promise.all([
    read(
      attemptsQuery.order("created_at", { ascending: false }).limit(ATTEMPT_LIMIT),
      ATTEMPT_LIMIT,
      "Assessment attempts"
    ),
    read(
      prospectsQuery.order("created_at", { ascending: false }).limit(PROSPECT_LIMIT),
      PROSPECT_LIMIT,
      "Sourced prospects"
    ),
    read(
      logsQuery.order("created_at", { ascending: false }).limit(LOG_LIMIT),
      LOG_LIMIT,
      "Message history"
    ),
    read(
      interviewsQuery.order("created_at", { ascending: false }).limit(INTERVIEW_LIMIT),
      INTERVIEW_LIMIT,
      "Interview panels"
    ),
  ]);

  const failed = [attempts, prospects, logs, interviews].find((result) => result.error);
  if (failed) return { report: null, error: failed.error as string };

  const limitations: string[] = [];
  if (attempts.truncated) {
    limitations.push(
      `Only the newest ${ATTEMPT_LIMIT.toLocaleString()} assessment attempts in this window were counted, so the assessment figures are a floor.`
    );
  }
  if (prospects.truncated) {
    limitations.push(
      `Only the newest ${PROSPECT_LIMIT.toLocaleString()} sourced prospects in this window were counted.`
    );
  }
  if (logs.truncated) {
    limitations.push(
      `Only the newest ${LOG_LIMIT.toLocaleString()} messages in this window were counted, so delivery figures are a floor.`
    );
  }
  if (interviews.truncated) {
    limitations.push(
      `Only the newest ${INTERVIEW_LIMIT.toLocaleString()} interview panels in this window were counted.`
    );
  }
  if (scoresHidden) {
    limitations.push(
      "Test scores are withheld from your account by the score-masking setting, so the score spread is not shown."
    );
  }
  limitations.push(
    "How long anyone sits in a pipeline stage cannot be measured: a stage move overwrites the row and only a hire keeps its date."
  );

  const report = buildAnalyticsReport({
    window,
    timeZone,
    generatedAt,
    complete: ![attempts, prospects, logs, interviews].some((result) => result.truncated),
    scoresHidden,
    limitations,
    attempts: attempts.rows.map((row) => ({
      status: text(row.status) ?? "",
      created_at: text(row.created_at),
      started_at: text(row.started_at),
      submitted_at: text(row.submitted_at),
      total_score: num(row.total_score),
      max_score: num(row.max_score),
    })),
    prospects: prospects.rows.map((row) => ({
      id: text(row.id) ?? "",
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
      status: text(row.status) ?? "",
      scheduled_at: text(row.scheduled_at),
      created_at: text(row.created_at),
      interviewer: text(embedded(row, "user_profiles").full_name),
      application_created_at: text(embedded(row, "applications").created_at),
    })),
  });

  return { report, error: null };
}

/**
 * The report for one window.
 *
 * The page calls this during its own render, and the view calls it again when
 * the window changes. Both paths re-check the permission rather than trusting
 * that the caller is the page — a server action is a public endpoint.
 */
export async function getAnalyticsReport(value: unknown): Promise<AnalyticsResult> {
  await requireStaff("/analytics");

  if (!(await hasPermissionForUser("analytics.view"))) {
    return { ok: false, error: VIEW_DENIED };
  }

  const { report, error } = await assemble(value);
  return report
    ? { ok: true, report }
    : { ok: false, error: error ?? "The report could not be built." };
}

/**
 * The same figures as a CSV, behind `analytics.export`.
 *
 * Re-runs the read rather than shipping the browser's copy back, so the grant
 * decides what leaves the building and not merely which button is drawn.
 */
export async function exportAnalyticsReport(value: unknown): Promise<AnalyticsExport> {
  await requireStaff("/analytics");

  const [allowed, { report, error }] = [
    await hasPermissionForUser("analytics.export"),
    await assemble(value),
  ];

  if (!allowed) return { ok: false, error: EXPORT_DENIED };
  if (error || !report) return { ok: false, error: error ?? "The report could not be rebuilt." };

  const day = report.generatedAt.slice(0, 10);
  return {
    ok: true,
    csv: reportToCsv(report),
    fileName: `sharm-dreams-analytics-${report.window}-${day}.csv`,
  };
}
