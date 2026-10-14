"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { tasksOf, type ChecklistTask } from "./checklist";

export interface OnboardingRow {
  id: string;
  application_id: string;
  candidate_name: string;
  job_title: string | null;
  company_name: string | null;
  progress: number;
  checklist_total: number;
  checklist_done: number;
  skill_gap_count: number;
  tasks: ChecklistTask[];
  /** When the hire started — the reference every task's due offset counts from. */
  hired_at: string | null;
}

export interface OnboardingSummary {
  active: number;
  avg_progress: number;
  /** Tasks across every plan where the hire's skill level is below the role's. */
  open_skill_gaps: number;
}

export interface OnboardingData {
  plans: OnboardingRow[];
  summary: OnboardingSummary;
  /** Hires without a generated plan yet. */
  unplanned: { id: string; full_name: string; job_title: string | null }[];
}

export async function getOnboardingData(): Promise<OnboardingData> {
  await requireStaff("/onboarding");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("onboarding_plans")
    .select(
      "id, application_id, progress, checklist, skill_gaps, applications(full_name, hired_at, job_openings(title, tenants_and_companies(name)))"
    )
    .order("created_at", { ascending: false });

  const plans: OnboardingRow[] = (data ?? []).map((row) => {
    const application = Array.isArray(row.applications)
      ? row.applications[0]
      : row.applications;
    const job = application?.job_openings as { title?: string; tenants_and_companies?: { name?: string } | { name?: string }[] } | null;
    const company = Array.isArray(job?.tenants_and_companies)
      ? job.tenants_and_companies[0]
      : job?.tenants_and_companies;

    const tasks = tasksOf(row.checklist);
    const gaps = Array.isArray(row.skill_gaps) ? row.skill_gaps : [];

    return {
      id: row.id,
      application_id: row.application_id,
      candidate_name: application?.full_name ?? "Unknown",
      job_title: job?.title ?? null,
      company_name: company?.name ?? null,
      progress: Number(row.progress ?? 0),
      checklist_total: tasks.length,
      checklist_done: tasks.filter((task) => task.completed).length,
      skill_gap_count: gaps.length,
      tasks,
      hired_at: application?.hired_at ?? null,
    };
  });

  // Recent hires with no plan yet, so the recruiter can generate one.
  const { data: hired } = await supabase
    .from("applications")
    .select("id, full_name, job_openings(title)")
    .eq("stage", "HIRED")
    .is("archived_at", null)
    .order("hired_at", { ascending: false })
    .limit(10);

  interface HiredRow {
  id: string;
  full_name: string;
  job_openings?: { title?: string } | { title?: string }[] | null;
}

  const plannedIds = new Set(plans.map((p) => p.application_id));
  const unplanned = ((hired ?? []) as HiredRow[])
    .filter((row) => !plannedIds.has(row.id))
    .map((row) => {
      const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
      return { id: row.id, full_name: row.full_name, job_title: job?.title ?? null };
    });

  const withProgress = plans.filter((p) => p.progress > 0);
  const summary: OnboardingSummary = {
    active: plans.length,
    avg_progress:
      withProgress.length === 0
        ? 0
        : Math.round(
            withProgress.reduce((sum, p) => sum + p.progress, 0) / withProgress.length
          ),
    open_skill_gaps: plans.reduce((sum, p) => sum + p.skill_gap_count, 0),
  };

  return { plans, summary, unplanned };
}