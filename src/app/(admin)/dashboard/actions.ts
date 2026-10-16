"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { FIT_BUCKETS, bucketBounds } from "@/modules/analytics/domain/fitBuckets";
import { BOARD_LIMIT } from "@/app/(admin)/dashboard/board-model";
import { isApplicationSource, isPipelineStage } from "@/modules/candidates/domain/listFilters";
import type {
  ApplicationStage,
  ApplicationSource,
  ChannelEffectiveness,
  DashboardAnalytics,
  DashboardCandidate,
  DashboardRoleRow,
  DashboardWaitingRow,
  FitScoreBucket,
  PipelineFunnelStep,
} from "@/types";

const STAGES: ApplicationStage[] = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
];

/** Everything the pipeline is still holding, i.e. not a closed outcome. */
const NON_TERMINAL_STAGES: ApplicationStage[] = STAGES.filter(
  (stage) => stage !== "HIRED" && stage !== "REJECTED"
);

interface ApplicationJoin {
  id: string;
  full_name: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  ai_match_score: number | null;
  created_at: string | null;
  hired_at: string | null;
  job_id: string;
  job_openings?: JobShape | null;
}

interface JobShape {
  id?: string;
  title?: string;
  department?: string;
  status?: string;
  closing_at?: string | null;
}

interface JobRow {
  id: string;
  title: string;
  department: string;
  status: string;
  closing_at: string | null;
}

interface AttemptJoin {
  application_id: string | null;
  total_score: number | null;
}

/** PostgREST returns one-to-one embeds as an object, but arrays are possible. */
function one<T>(joined: unknown): T | null {
  const row = Array.isArray(joined) ? joined[0] : joined;
  return (row as T) ?? null;
}

/** Whole days between an ISO stamp and `now`, floored at zero. */
function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

function spanDays(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  const [applicationsResult, attemptsResult, jobsResult] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, full_name, stage, source, ai_match_score, created_at, hired_at, job_id, job_openings(id, title, department, status, closing_at)"
      )
      .is("archived_at", null),
    supabase.from("candidate_attempts").select("application_id, total_score"),
    supabase
      .from("job_openings")
      .select("id, title, department, status, closing_at")
      .order("title"),
  ]);

  const applications = (applicationsResult.data ?? []) as ApplicationJoin[];
  const attempts = (attemptsResult.data ?? []) as AttemptJoin[];
  const jobs = (jobsResult.data ?? []) as JobRow[];
  const activeJobs = jobs.filter((job) => job.status === "PUBLISHED").length;
  const now = Date.now();

  // --- Pipeline funnel -------------------------------------------------------
  const stageCounts = new Map<ApplicationStage, number>();
  for (const stage of STAGES) stageCounts.set(stage, 0);
  for (const app of applications) {
    stageCounts.set(app.stage, (stageCounts.get(app.stage) ?? 0) + 1);
  }

  const pipeline: PipelineFunnelStep[] = [];
  let previous: { stage: ApplicationStage; count: number } | null = null;
  for (const stage of STAGES) {
    const count = stageCounts.get(stage) ?? 0;
    const isRejected = stage === "REJECTED";
    // Rejected closes applications at every stage, so the row listed before it
    // (Hired) is not a population it converted from — a ratio against it would
    // print 800% for five hires and forty rejections. It carries only its share.
    const against = isRejected ? null : previous;
    pipeline.push({
      stage,
      count,
      share_of_pipeline:
        applications.length === 0 ? 0 : Math.round((count / applications.length) * 100),
      vs_previous_stage:
        against && against.count > 0
          ? {
              stage: against.stage,
              count: against.count,
              percent: Math.round((count / against.count) * 100),
            }
          : null,
    });
    if (!isRejected) previous = { stage, count };
  }

  // --- Channel effectiveness -------------------------------------------------
  const bySource = new Map<ApplicationSource, { applications: number; hires: number }>();
  for (const app of applications) {
    const entry = bySource.get(app.source) ?? { applications: 0, hires: 0 };
    entry.applications += 1;
    if (app.stage === "HIRED") entry.hires += 1;
    bySource.set(app.source, entry);
  }

  const channels: ChannelEffectiveness[] = Array.from(bySource.entries())
    .map(([source, data]) => ({
      source,
      applications: data.applications,
      hires: data.hires,
      conversion_rate:
        data.applications === 0 ? 0 : Math.round((data.hires / data.applications) * 100),
    }))
    .sort((a, b) => b.applications - a.applications);

  // --- AI fit distribution ---------------------------------------------------
  const scores = applications
    .map((a) => a.ai_match_score)
    .filter((s): s is number => s !== null && s !== undefined);

  const fit_distribution: FitScoreBucket[] = FIT_BUCKETS.map((bucket) => ({
    range: bucket.range,
    count: scores.filter((s) => s >= bucket.min && (bucket.upper === null || s < bucket.upper))
      .length,
  }));

  const avgFitScore =
    scores.length === 0
      ? 0
      : Math.round(scores.reduce((total, s) => total + s, 0) / scores.length);

  // --- Application velocity (last 14 days) -----------------------------------
  const applications_last_14_days: { date: string; count: number }[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const iso = day.toISOString().slice(0, 10);
    applications_last_14_days.push({
      date: iso,
      count: applications.filter((a) => a.created_at?.startsWith(iso)).length,
    });
  }

  // --- Time to hire (based on hires recorded in the last 6 months) -----------
  const time_to_hire_trend: { month: string; avg_days: number }[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const monthStart = new Date();
    monthStart.setMonth(monthStart.getMonth() - offset, 1);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1, 1);

    const hired = applications.filter(
      (a) => a.hired_at && new Date(a.hired_at) >= monthStart && new Date(a.hired_at) < monthEnd
    );
    const durations = hired
      .map((a) => {
        const start = a.created_at ? new Date(a.created_at).getTime() : null;
        const end = a.hired_at ? new Date(a.hired_at).getTime() : null;
        return start !== null && end !== null ? Math.round((end - start) / 86_400_000) : null;
      })
      .filter((d): d is number => d !== null);

    time_to_hire_trend.push({
      month: monthStart.toLocaleString("en-US", { month: "short" }),
      avg_days:
        durations.length === 0
          ? 0
          : Math.round(durations.reduce((total, d) => total + d, 0) / durations.length),
    });
  }

  const avgTimeToHire =
    time_to_hire_trend.filter((p) => p.avg_days > 0).reduce((t, p) => t + p.avg_days, 0) /
    Math.max(time_to_hire_trend.filter((p) => p.avg_days > 0).length, 1);

  // --- Candidate board -------------------------------------------------------
  // The board filters and sorts in the browser, so it is shipped as much of the
  // pipeline as a panel can hold: `BOARD_LIMIT` rows, best-fitting first (or
  // newest-first when scores are masked). That is a cap, not the set — the
  // tiles above count every live application, and the view names the difference
  // rather than letting a stage rail look like a filter over the whole pipeline.
  const scoreByApplication = new Map(attempts.map((a) => [a.application_id, a.total_score]));

  const candidates: DashboardCandidate[] = [...applications]
    .sort((a, b) =>
      // Ranking by a hidden score would leak its order, so a masked caller gets
      // the board newest-first instead.
      masked
        ? String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
        : (b.ai_match_score ?? -1) - (a.ai_match_score ?? -1)
    )
    .slice(0, BOARD_LIMIT)
    .map((app) => {
      const job = one<JobShape>(app.job_openings);
      return {
        application_id: app.id,
        full_name: app.full_name,
        job_title: job?.title ?? "",
        department: job?.department ?? "",
        match_score: masked ? null : app.ai_match_score,
        stage: app.stage,
        source: app.source,
        applied_at: app.created_at,
        has_assessment: scoreByApplication.has(app.id),
        assessment_score: masked ? null : scoreByApplication.get(app.id) ?? null,
      };
    });

  // --- Role leaderboard ------------------------------------------------------
  // One row per opening, built from a map rather than a second query: the
  // applications already in memory carry the job id, so counting them here costs
  // nothing and still covers an opening the recruiter cannot list.
  const jobMeta = new Map<string, JobRow>();
  for (const job of jobs) jobMeta.set(job.id, job);

  const byJob = new Map<
    string,
    { applications: number; hires: number; scores: number[]; oldestWaitingDays: number | null }
  >();
  for (const app of applications) {
    if (!jobMeta.has(app.job_id)) {
      const joined = one<JobShape>(app.job_openings);
      jobMeta.set(app.job_id, {
        id: app.job_id,
        title: joined?.title ?? "Opening outside your data scope",
        department: joined?.department ?? "",
        status: joined?.status ?? "",
        closing_at: joined?.closing_at ?? null,
      });
    }

    const tally = byJob.get(app.job_id) ?? {
      applications: 0,
      hires: 0,
      scores: [] as number[],
      oldestWaitingDays: null as number | null,
    };
    tally.applications += 1;
    if (app.stage === "HIRED") tally.hires += 1;
    if (app.ai_match_score !== null && app.ai_match_score !== undefined) {
      tally.scores.push(app.ai_match_score);
    }
    if (NON_TERMINAL_STAGES.includes(app.stage)) {
      const waited = daysSince(app.created_at, now);
      if (waited !== null && (tally.oldestWaitingDays === null || waited > tally.oldestWaitingDays)) {
        tally.oldestWaitingDays = waited;
      }
    }
    byJob.set(app.job_id, tally);
  }

  const roles: DashboardRoleRow[] = Array.from(jobMeta.values())
    .map((job) => {
      const tally = byJob.get(job.id);
      const scored = tally?.scores ?? [];
      return {
        job_id: job.id,
        title: job.title,
        department: job.department,
        status: job.status,
        applications: tally?.applications ?? 0,
        hires: tally?.hires ?? 0,
        // A masked caller never sees the average, not even rounded into one
        // figure that would rank the roles for them.
        avg_fit:
          masked || scored.length === 0 ? null : Math.round(sum(scored) / scored.length),
        oldest_waiting_days: tally?.oldestWaitingDays ?? null,
        closing_at: job.closing_at,
      };
    })
    .sort((a, b) => b.applications - a.applications || a.title.localeCompare(b.title));

  // --- What is still waiting -------------------------------------------------
  const waitingApplications = applications.filter((app) =>
    NON_TERMINAL_STAGES.includes(app.stage)
  );

  const oldest_waiting: DashboardWaitingRow[] = [...waitingApplications]
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .slice(0, 6)
    .map((app) => ({
      application_id: app.id,
      full_name: app.full_name,
      job_title: one<JobShape>(app.job_openings)?.title ?? "",
      stage: app.stage,
      applied_at: app.created_at ?? "",
      waiting_days: daysSince(app.created_at, now) ?? 0,
      match_score: masked ? null : app.ai_match_score,
    }));

  return {
    total_applications: applications.length,
    active_jobs: activeJobs,
    hires_this_quarter: applications.filter((a) => a.stage === "HIRED").length,
    avg_time_to_hire_days: Math.round(avgTimeToHire),
    // A masked caller gets the count of scored applications, never the numbers
    // themselves — not even averaged into a single figure on the server.
    avg_fit_score: masked ? 0 : avgFitScore,
    scored_applications: scores.length,
    scores_masked: masked,
    applications_last_14_days,
    pipeline,
    channels,
    fit_distribution: masked
      ? fit_distribution.map((bucket) => ({ ...bucket, count: 0 }))
      : fit_distribution,
    diversity: [],
    time_to_hire_trend,
    candidates,
    roles,
    oldest_waiting,
    waiting_total: waitingApplications.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Drill-down                                                     actions     */
/* -------------------------------------------------------------------------- */

/** Rows one popup reads — enough to scan, small enough to stay a panel. */
const DRILL_LIMIT = 250;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which slice of the pipeline a dashboard control is asking about.
 *
 * The board under the charts only ships 200 rows, so a popup that names
 * "every NEW application" has to read them from the database rather than count
 * the rows the page happens to be holding.
 */
export type DashboardDrillScope =
  | { type: "all" }
  | { type: "stage"; stage: ApplicationStage }
  | { type: "source"; source: ApplicationSource }
  | { type: "bucket"; range: string }
  | { type: "day"; date: string }
  | { type: "role"; jobId: string }
  | { type: "scored" }
  | { type: "hires" }
  | { type: "time_to_hire" }
  | { type: "waiting" };

/** One application inside a popup: the board row, plus what a follow-up needs. */
export interface DashboardDrillRow {
  application_id: string;
  full_name: string;
  email: string;
  tracking_code: string;
  job_title: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  applied_at: string;
  /** Days since they applied, counted now — null once the stage is closed. */
  waiting_days: number | null;
  hired_at: string | null;
  days_to_hire: number | null;
  match_score: number | null;
  assessment_score: number | null;
  has_assessment: boolean;
}

export type DashboardDrillResult =
  | {
      ok: true;
      /** How many applications the scope matches, across the whole database. */
      total: number;
      shown: number;
      rows: DashboardDrillRow[];
      read_at: string;
    }
  | { ok: false; error: string };

interface DrillJoin {
  id: string;
  full_name: string;
  email: string;
  tracking_code: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  ai_match_score: number | null;
  created_at: string | null;
  hired_at: string | null;
  job_openings?: JobShape | null;
}

const BAD_SCOPE: DashboardDrillResult = {
  ok: false,
  error: "That control is not a dashboard filter, so nothing was read.",
};

/**
 * The applications behind one dashboard number, read live under the caller's
 * own RLS scope.
 *
 * Every figure on the board is an aggregate, and a recruiter clicking it wants
 * the names. This is the one read that answers that without trusting the 200
 * rows already in the browser: the total comes from the same count the chart
 * would be built from, and a caller whose role hides AI scores gets no scores
 * here either — including no score-ordered scope at all.
 */
export async function getDashboardDrilldown(
  scope: DashboardDrillScope
): Promise<DashboardDrillResult> {
  await requireStaff("/dashboard");
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  let query = supabase
    .from("applications")
    .select(
      "id, full_name, email, tracking_code, stage, source, ai_match_score, created_at, hired_at, job_openings(title)",
      { count: "exact" }
    )
    .is("archived_at", null);

  let orderColumn = "created_at";
  let orderAscending = false;
  /** Set when the scope is defined by a score the caller may not be shown. */
  let scoresRequired = false;

  switch (scope.type) {
    case "all":
      break;
    case "stage": {
      const stage = isPipelineStage(scope.stage);
      if (!stage) return BAD_SCOPE;
      query = query.eq("stage", stage);
      break;
    }
    case "source": {
      const source = isApplicationSource(scope.source);
      if (!source) return BAD_SCOPE;
      query = query.eq("source", source);
      break;
    }
    case "bucket": {
      const bounds = bucketBounds(scope.range);
      if (!bounds) return BAD_SCOPE;
      scoresRequired = true;
      query = query.not("ai_match_score", "is", null).gte("ai_match_score", bounds.min);
      if (bounds.upper !== null) query = query.lt("ai_match_score", bounds.upper);
      orderColumn = "ai_match_score";
      break;
    }
    case "scored":
      scoresRequired = true;
      query = query.not("ai_match_score", "is", null);
      orderColumn = "ai_match_score";
      break;
    case "day": {
      if (!DAY_PATTERN.test(scope.date)) return BAD_SCOPE;
      const start = Date.parse(`${scope.date}T00:00:00.000Z`);
      if (!Number.isFinite(start)) return BAD_SCOPE;
      query = query
        .gte("created_at", new Date(start).toISOString())
        .lt("created_at", new Date(start + 86_400_000).toISOString());
      break;
    }
    case "role":
      if (!UUID_PATTERN.test(scope.jobId)) return BAD_SCOPE;
      query = query.eq("job_id", scope.jobId);
      break;
    case "hires":
      query = query.eq("stage", "HIRED");
      orderColumn = "hired_at";
      break;
    case "time_to_hire":
      query = query.eq("stage", "HIRED").not("hired_at", "is", null);
      orderColumn = "hired_at";
      break;
    case "waiting":
      query = query.in("stage", NON_TERMINAL_STAGES);
      orderAscending = true;
      break;
    default:
      return BAD_SCOPE;
  }

  if (scoresRequired && masked) {
    return {
      ok: false,
      error:
        "Your role is not granted “View unmasked scores”, so the scored applications behind this figure are withheld.",
    };
  }

  const { data, count, error } = await query
    .order(orderColumn, { ascending: orderAscending, nullsFirst: false })
    .range(0, DRILL_LIMIT - 1);

  if (error) {
    console.error("[dashboard] drill-down query failed:", error.message);
    return { ok: false, error: "These applications could not be read. Please retry." };
  }

  const found = (data ?? []) as DrillJoin[];
  const ids = found.map((row) => row.id);

  const attemptsResult =
    ids.length === 0
      ? null
      : await supabase
          .from("candidate_attempts")
          .select("application_id, total_score")
          .in("application_id", ids);
  const scoreByApplication = new Map(
    ((attemptsResult?.data ?? []) as AttemptJoin[]).map((attempt) => [
      attempt.application_id,
      attempt.total_score,
    ])
  );

  const now = Date.now();

  return {
    ok: true,
    total: count ?? found.length,
    shown: found.length,
    read_at: new Date(now).toISOString(),
    rows: found.map((row) => ({
      application_id: row.id,
      full_name: row.full_name,
      email: row.email,
      tracking_code: row.tracking_code,
      job_title: one<JobShape>(row.job_openings)?.title ?? "",
      stage: row.stage,
      source: row.source,
      applied_at: row.created_at ?? "",
      waiting_days: NON_TERMINAL_STAGES.includes(row.stage)
        ? daysSince(row.created_at, now)
        : null,
      hired_at: row.hired_at,
      days_to_hire: spanDays(row.created_at, row.hired_at),
      match_score: masked ? null : row.ai_match_score,
      assessment_score: masked ? null : scoreByApplication.get(row.id) ?? null,
      has_assessment: scoreByApplication.has(row.id),
    })),
  };
}