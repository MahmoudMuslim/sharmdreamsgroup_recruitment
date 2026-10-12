"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import type { QuestionType } from "@/types";
import type { EditableQuestion } from "./QuestionEditorDrawer";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  is_active: boolean;
  question_count: number;
  total_points: number;
  /** How many candidates have been assigned this suite. */
  attempts: number;
  /** Suites with at least one completed run are marked as "live". */
  completed: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  block_copy_paste: boolean;
}

export async function getTemplates(): Promise<TemplateSummary[]> {
  await requireStaff("/assessments");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("assessment_templates")
    .select(
      "id, name, description, role_family, time_limit_minutes, is_active, randomize_questions, randomize_options, block_copy_paste, assessment_questions(points, question_type), candidate_attempts(id, status)"
    )
    .order("name");

  if (error) throw error;

  return (data ?? []).map((row) => {
    const questions = row.assessment_questions ?? [];
    const attempts = row.candidate_attempts ?? [];
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      role_family: row.role_family ?? "GENERAL",
      time_limit_minutes: row.time_limit_minutes ?? 60,
      is_active: row.is_active ?? true,
      question_count: questions.length,
      total_points: questions.reduce(
        (sum, question) => sum + (Number(question.points) || 0),
        0
      ),
      attempts: attempts.length,
      completed: attempts.filter((a) => a.status === "SUBMITTED" || a.status === "GRADED").length,
      randomize_questions: row.randomize_questions ?? false,
      randomize_options: row.randomize_options ?? false,
      block_copy_paste: row.block_copy_paste ?? true,
    };
  });
}

/** Minimal candidate list used by the "Assign" drawer. */
export interface AssignableCandidate {
  id: string;
  full_name: string;
  stage: string;
  job_title: string | null;
}

export async function getAssignableCandidates(): Promise<AssignableCandidate[]> {
  await requireStaff("/assessments");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("applications")
    .select("id, full_name, stage, job_openings(title)")
    .not("stage", "in", "(REJECTED,HIRED)")
    .order("created_at", { ascending: false })
    .limit(200);

  return ((data ?? []) as unknown[]).map((row) => {
    const application = row as {
      id: string;
      full_name: string;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
    };
    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    return {
      id: application.id,
      full_name: application.full_name,
      stage: application.stage,
      job_title: job?.title ?? null,
    };
  });
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  is_active: boolean;
  questions: {
    id: string;
    question_type: QuestionType;
    title: string;
    points: number;
    position: number;
  }[];
}

/** Full question breakdown for a single suite. */
export async function getTemplateDetail(templateId: string): Promise<TemplateDetail | null> {
  await requireStaff("/assessments");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("assessment_templates")
    .select("id, name, description, role_family, time_limit_minutes, is_active")
    .eq("id", templateId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: questions } = await supabase
    .from("assessment_questions")
    .select("id, question_type, title, points, position")
    .eq("template_id", templateId)
    .order("position");

  return {
    ...(data as Omit<TemplateDetail, "questions">),
    questions: (questions ?? []) as TemplateDetail["questions"],
  };
}

/**
 * Every question across every suite, grouped by template.
 *
 * Loaded in one pass so the grid's "Questions" drawer opens instantly instead
 * of fetching per click. Assessment content is small (tens of rows), unlike the
 * candidate tables.
 */
export async function getQuestionsForEditor(): Promise<
  Record<string, EditableQuestion[]>
> {
  await requireStaff("/assessments");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("assessment_questions")
    .select(
      "id, template_id, question_type, title, prompt, instructions, config, points, position, time_limit_minutes, shuffle_options"
    )
    .order("position");

  if (error) throw error;

  const grouped: Record<string, EditableQuestion[]> = {};

  for (const row of (data ?? []) as unknown as EditableQuestion[]) {
    (grouped[row.template_id] ??= []).push(row);
  }

  return grouped;
}