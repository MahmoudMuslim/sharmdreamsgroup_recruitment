"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ApplicationStage,
  ApplicationSource,
  ChannelEffectiveness,
  DashboardAnalytics,
  DashboardCandidate,
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

interface ApplicationJoin {
  id: string;
  full_name: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  ai_match_score: number | null;
  created_at: string | null;
  hired_at: string | null;
  job_openings?:
    | { title?: string; department?: string }
    | { title?: string; department?: string }[]
    | null;
}

interface AttemptJoin {
  application_id: string | null;
  total_score: number | null;
}

export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  const supabase = await createSupabaseServerClient();

  const [applicationsResult, attemptsResult, jobsResult] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, full_name, stage, source, ai_match_score, created_at, hired_at, job_openings(title, department)"
      ),
    supabase.from("candidate_attempts").select("application_id, total_score"),
    supabase.from("job_openings").select("id").eq("status", "PUBLISHED"),
  ]);

  const applications = (applicationsResult.data ?? []) as ApplicationJoin[];
  const attempts = (attemptsResult.data ?? []) as AttemptJoin[];
  const activeJobs = jobsResult.data?.length ?? 0;

  // --- Pipeline funnel -------------------------------------------------------
  const stageCounts = new Map<ApplicationStage, number>();
  for (const stage of STAGES) stageCounts.set(stage, 0);
  for (const app of applications) {
    stageCounts.set(app.stage, (stageCounts.get(app.stage) ?? 0) + 1);
  }

  const pipeline: PipelineFunnelStep[] = [];
  let previous = stageCounts.get("NEW") ?? 0;
  for (const stage of STAGES) {
    const count = stageCounts.get(stage) ?? 0;
    const isRejected = stage === "REJECTED";
    pipeline.push({
      stage,
      count,
      conversion_rate:
        stage === "NEW" ? 100 : previous === 0 ? 0 : Math.round((count / previous) * 100),
    });
    if (!isRejected) previous = count;
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

  const fit_distribution: FitScoreBucket[] = [
    { range: "0–49", count: scores.filter((s) => s < 50).length },
    { range: "50–79", count: scores.filter((s) => s >= 50 && s < 80).length },
    { range: "80–100", count: scores.filter((s) => s >= 80).length },
  ];

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
  // Every application, not just the ten best: the board filters and sorts
  // client-side, so a stage or channel click has to work on the full set.
  const scoreByApplication = new Map(attempts.map((a) => [a.application_id, a.total_score]));

  const candidates: DashboardCandidate[] = [...applications]
    .sort((a, b) => (b.ai_match_score ?? -1) - (a.ai_match_score ?? -1))
    .slice(0, 200)
    .map((app) => {
      const job = Array.isArray(app.job_openings) ? app.job_openings[0] : app.job_openings;
      return {
        application_id: app.id,
        full_name: app.full_name,
        job_title: job?.title ?? "",
        department: job?.department ?? "",
        match_score: app.ai_match_score ?? 0,
        stage: app.stage,
        source: app.source,
        applied_at: app.created_at,
        has_assessment: scoreByApplication.has(app.id),
        assessment_score: scoreByApplication.get(app.id) ?? null,
      };
    });

  return {
    total_applications: applications.length,
    active_jobs: activeJobs,
    hires_this_quarter: applications.filter((a) => a.stage === "HIRED").length,
    avg_time_to_hire_days: Math.round(avgTimeToHire),
    avg_fit_score: avgFitScore,
    scored_applications: scores.length,
    applications_last_14_days,
    pipeline,
    channels,
    fit_distribution,
    diversity: [],
    time_to_hire_trend,
    candidates,
  };
}