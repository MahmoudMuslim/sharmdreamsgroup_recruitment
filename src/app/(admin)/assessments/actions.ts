"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { supabaseConfig } from "@/lib/config";
import { getFileStore } from "@/lib/files/store";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import type { QuestionType } from "@/types";
import {
  changedCellsOf,
  countWords,
  type AttemptAnswer,
  type AttemptAnswers,
} from "@/modules/assessment/domain/attemptAnswers";
import { readAttemptBenchmark } from "@/modules/assessment/application/attemptBenchmark";
import { LINKS_LIMIT, type IssuedLink } from "@/modules/assessment/domain/issuedLinks";
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
    // The two embeds are annotated locally because our builder answers rows as
    // they come back from PostgREST (`any`), while the vendor's client parsed
    // the select string at the type level and typed each embed as an array.
    // Without the annotation `questions.reduce((sum, question) => …)` has no
    // contextual type for its parameters and `noImplicitAny` refuses it.
    const questions: { points: number | null }[] = row.assessment_questions ?? [];
    const attempts: { status: string }[] = row.candidate_attempts ?? [];
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
    .is("archived_at", null)
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

/* -------------------------------------------------------------------------- */
/* Issued links                                                               */
/* -------------------------------------------------------------------------- */

/** PostgREST returns a to-one embed as an object or as a one-row array. */
function one<T extends object>(value: T | T[] | null | undefined): T | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row ?? null;
}

interface LinkApplication {
  full_name?: string;
  job_openings?: { title?: string } | { title?: string }[] | null;
}

interface LinkTemplate {
  name?: string;
  assessment_questions?: { id?: string }[];
}

interface AttemptLinkJoin {
  id: string;
  application_id: string;
  template_id: string;
  status: string;
  time_limit_minutes: number | null;
  created_at: string;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  total_score: number | null;
  max_score: number | null;
  integrity_flags: number | null;
  applications?: LinkApplication | LinkApplication[] | null;
  assessment_templates?: LinkTemplate | LinkTemplate[] | null;
  candidate_responses?: { id?: string }[] | null;
}

/**
 * The live filter of the links board, written once so the rows and their count
 * cannot drift apart.
 *
 * `applications!inner` is what makes the archive exclusion a filter on the
 * *attempt* rows rather than a decoration on them — the same reason the grading
 * queue uses it. A filed-away candidate is left out deliberately: every other
 * staff surface hides them, and a board that listed their links would be a door
 * pointing at a record nobody can open.
 */
const LIVE_LINKS_FILTER = "applications.archived_at";

/**
 * The window, and the whole count behind it in the same response.
 *
 * `count: "exact"` reports every row the filter matches, not the slice the limit
 * carries, so the board can say how many links are on file without a second
 * query the first could already answer.
 */
function linksWindow(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  return supabase
    .from("candidate_attempts")
    .select(
      `id, application_id, template_id, status, time_limit_minutes, created_at, started_at, expires_at, submitted_at, total_score, max_score, integrity_flags,
       applications!inner(full_name, archived_at, job_openings(title)),
       assessment_templates(name, assessment_questions(id)),
       candidate_responses(id)`,
      { count: "exact" }
    )
    .is(LIVE_LINKS_FILTER, null)
    .order("created_at", { ascending: false });
}

export interface IssuedLinksRead {
  rows: IssuedLink[];
  /** Every live link on file, including the ones this window does not carry. */
  total: number;
  scores_masked: boolean;
}

/**
 * Every link a candidate has been sent, newest first.
 *
 * The suite cards count these and the candidate dossier lists one person's, but
 * nothing in the portal used to put them together, so the question "who holds a
 * test right now, and what did they put in it?" had no screen to answer it.
 *
 * The answer counts come from the `candidate_responses` rows rather than from
 * `status`, because the two disagree in both directions: a link revoked after a
 * submission keeps the work that was done, and a submitted attempt whose
 * candidate typed nothing still has rows.
 */
export async function getIssuedLinks(): Promise<IssuedLinksRead> {
  await requireStaff("/assessments");
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  const { data, error, count } = await linksWindow(supabase).limit(LINKS_LIMIT);
  if (error) throw error;

  const rows = ((data ?? []) as unknown as AttemptLinkJoin[]).map((row) => {
    const application = one(row.applications ?? null);
    const template = one(row.assessment_templates ?? null);
    return {
      id: row.id,
      application_id: row.application_id,
      candidate_name: application?.full_name ?? "Candidate",
      job_title: one(application?.job_openings ?? null)?.title ?? null,
      template_id: row.template_id,
      template_name: template?.name ?? "Assessment",
      status: row.status,
      time_limit_minutes: row.time_limit_minutes ?? 0,
      issued_at: row.created_at,
      started_at: row.started_at ?? null,
      expires_at: row.expires_at ?? null,
      submitted_at: row.submitted_at ?? null,
      score: masked || row.total_score === null ? null : Number(row.total_score),
      max_score: masked || row.max_score === null ? null : Number(row.max_score),
      answers: (row.candidate_responses ?? []).length,
      questions: (template?.assessment_questions ?? []).length,
      integrity_flags: row.integrity_flags ?? 0,
    } satisfies IssuedLink;
  });

  // PostgREST reports the total the filter matched, not the slice the limit
  // carried — which is the number the note under the board is allowed to print.
  return { rows, total: count ?? rows.length, scores_masked: masked };
}

/* -------------------------------------------------------------------------- */
/* The answers themselves                                                      */
/* -------------------------------------------------------------------------- */

const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuestionRow {
  id: string;
  title: string;
  prompt: string;
  instructions: string | null;
  question_type: string;
  config: {
    options?: { label?: string; text?: string; is_correct?: boolean }[];
    expected_outputs?: { cell?: string; description?: string; formula_hint?: string }[];
    initial_sheet?: { data?: (string | number | null)[][] };
    context?: string;
    min_words?: number;
  } | null;
  points: number;
  position: number;
}

interface ResponseRow {
  question_id: string;
  answer_text: string | null;
  spreadsheet_state: Record<string, { value?: string | number | null }> | null;
  video_path: string | null;
  video_duration_seconds: number | null;
  transcript: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string | null;
  ai_evaluation: {
    rationale?: string;
    strengths?: string[];
    improvements?: string[];
    graded_by?: string;
  } | null;
}

/**
 * One candidate's whole paper: every question, and whatever they put in it.
 *
 * Addressed by attempt id, never by the access token — the token is the
 * candidate's start link, it belongs in nobody's URL, log or chat transcript, and
 * the board already carries the id on every row.
 *
 * The suite is read as it stands now rather than as a frozen copy, because
 * `deleteQuestion` refuses once answers exist: the questions that were asked are
 * still here, and any added since are listed after them. Answers come back whole —
 * the grading report clips each one to an excerpt, which is enough to mark a paper
 * and not enough to read it — and marks follow the same masking rule as every
 * other staff surface, so a reviewer whose scores are withheld sees the work but
 * not the points.
 */
export async function getAttemptAnswers(attemptId: string): Promise<AttemptAnswers | null> {
  await requireStaff("/assessments");
  if (!ATTEMPT_ID.test(attemptId ?? "")) return null;

  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const files = await getFileStore();

  const { data: found } = await supabase
    .from("candidate_attempts")
    .select(
      `id, application_id, template_id, status, time_limit_minutes, started_at, expires_at, submitted_at, total_score, max_score, integrity_flags, question_order, option_order,
       assessment_templates(name),
       applications(full_name, job_openings(title))`
    )
    .eq("id", attemptId)
    .maybeSingle();

  const attempt = found as unknown as {
    id: string;
    application_id: string;
    template_id: string;
    status: string;
    time_limit_minutes: number | null;
    started_at: string | null;
    expires_at: string | null;
    submitted_at: string | null;
    total_score: number | null;
    max_score: number | null;
    integrity_flags: number | null;
    question_order: string[] | null;
    option_order: Record<string, string[]> | null;
    assessment_templates?: { name?: string } | { name?: string }[] | null;
    applications?: LinkApplication | LinkApplication[] | null;
  } | null;

  if (!attempt) return null;

  const [{ data: questionRows }, { data: responseRows }, benchmark] = await Promise.all([
    supabase
      .from("assessment_questions")
      .select("id, title, prompt, instructions, question_type, config, points, position")
      .eq("template_id", attempt.template_id)
      .order("position"),
    supabase
      .from("candidate_responses")
      .select(
        "question_id, answer_text, spreadsheet_state, video_path, video_duration_seconds, transcript, score, max_score, updated_at, ai_evaluation"
      )
      .eq("attempt_id", attempt.id),
    // Not counted at all when this reviewer's marks are withheld: a percentile
    // is a claim about other candidates' marks, which is the thing the setting
    // exists to hide.
    masked ? Promise.resolve(null) : readAttemptBenchmark(supabase, attempt),
  ]);

  const questions = (questionRows ?? []) as unknown as QuestionRow[];
  const byId = new Map(questions.map((question) => [question.id, question]));

  // The runner deals and stores the paper per attempt, so read it back in the
  // order this candidate saw it. Anything the dealt order does not name — a
  // question added after the link went out — is appended in suite order.
  const dealt = (Array.isArray(attempt.question_order) ? attempt.question_order : [])
    .map((id) => byId.get(id))
    .filter((question): question is QuestionRow => Boolean(question));
  const dealtIds = new Set(dealt.map((question) => question.id));
  const ordered = [
    ...dealt,
    ...questions.filter((question) => !dealtIds.has(question.id)),
  ];

  const responses = new Map(
    ((responseRows ?? []) as unknown as ResponseRow[]).map((row) => [row.question_id, row])
  );
  const optionOrder = attempt.option_order ?? {};

  const answers: AttemptAnswer[] = [];
  for (const question of ordered) {
    const response = responses.get(question.id) ?? null;
    const config = question.config ?? {};

    const options = (config.options ?? []).map((option) => ({
      label: option.label ?? "",
      text: option.text ?? "",
      correct: option.is_correct === true,
      chosen: false,
    }));
    // Options were shuffled for this candidate; the stored handles are not what
    // they saw, so the paper's own order is applied before the answer is marked.
    const seen = optionOrder[question.id];
    const arranged =
      Array.isArray(seen) && seen.length > 0
        ? [...options].sort(
            (a, b) =>
              (seen.indexOf(a.label) < 0 ? seen.length : seen.indexOf(a.label)) -
              (seen.indexOf(b.label) < 0 ? seen.length : seen.indexOf(b.label))
          )
        : options;
    const chosenLabel =
      question.question_type === "MULTIPLE_CHOICE" ? (response?.answer_text ?? null) : null;
    for (const option of arranged) {
      if (chosenLabel !== null && option.label === chosenLabel) option.chosen = true;
    }

    const typed = (response?.answer_text ?? "").trim();
    const cells =
      question.question_type === "EXCEL_MODEL"
        ? changedCellsOf(response?.spreadsheet_state, config.initial_sheet?.data)
        : [];

    let videoUrl: string | null = null;
    if (response?.video_path) {
      const { url } = await files.signedUrl({
        bucket: supabaseConfig.buckets.candidateVideos,
        path: response.video_path,
        seconds: 60 * 60,
      });
      videoUrl = url ?? null;
    }

    answers.push({
      question_id: question.id,
      title: question.title,
      prompt: question.prompt,
      instructions: question.instructions ?? null,
      question_type: question.question_type,
      points: Number(question.points ?? 0),
      answered: Boolean(response),
      // A quiz pick is expressed through `options` and `chosen_text` below, so the
      // stored handle is not repeated here as if it were something a person typed.
      answer_text: question.question_type === "MULTIPLE_CHOICE" ? null : typed || null,
      options: arranged,
      chosen_text: arranged.find((option) => option.chosen)?.text ?? null,
      correct_text: arranged.find((option) => option.correct)?.text ?? null,
      cells,
      expected: (config.expected_outputs ?? []).map((output) => ({
        ref: output.cell ?? "",
        description: output.description ?? "",
        formula_hint: output.formula_hint ?? null,
      })),
      context: config.context ?? null,
      min_words: config.min_words ?? null,
      words: question.question_type === "CASE_STUDY" ? countWords(typed || null) : null,
      video_url: videoUrl,
      duration_seconds: response?.video_duration_seconds ?? null,
      transcript: response?.transcript ?? null,
      score: masked || response?.score === null || response === null
        ? null
        : Number(response.score),
      max_score: masked ? null : Number(response?.max_score ?? question.points ?? 0),
      // Only a scored row has a verdict to attribute, and the engine's own rows
      // never carry `graded_by`, so anything else is the AI's.
      awarded_by:
        response?.score === null || response === null
          ? null
          : response.ai_evaluation?.graded_by === "STAFF"
            ? "STAFF"
            : "AI",
      rationale: response?.ai_evaluation?.rationale ?? null,
      strengths: response?.ai_evaluation?.strengths ?? [],
      improvements: response?.ai_evaluation?.improvements ?? [],
      saved_at: response?.updated_at ?? null,
    });
  }

  const application = one(attempt.applications ?? null);

  return {
    attempt_id: attempt.id,
    application_id: attempt.application_id,
    candidate_name: application?.full_name ?? "Candidate",
    job_title: one(application?.job_openings ?? null)?.title ?? null,
    template_name: one(attempt.assessment_templates ?? null)?.name ?? "Assessment",
    status: attempt.status,
    scores_masked: masked,
    answered: answers.filter((answer) => answer.answered).length,
    questions: answers.length,
    score:
      masked || attempt.total_score === null ? null : Number(attempt.total_score),
    max_score: masked || attempt.max_score === null ? null : Number(attempt.max_score),
    benchmark,
    time_limit_minutes: attempt.time_limit_minutes ?? 0,
    started_at: attempt.started_at ?? null,
    expires_at: attempt.expires_at ?? null,
    submitted_at: attempt.submitted_at ?? null,
    integrity_flags: attempt.integrity_flags ?? 0,
    dealt_from_order: dealt.length > 0,
    answers,
  };
}