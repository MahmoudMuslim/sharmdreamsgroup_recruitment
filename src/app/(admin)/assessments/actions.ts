"use server";

import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { storageConfig } from "@/lib/config";
import { getFileStore } from "@/lib/files/store";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { blindMarkingEnabled } from "@/modules/settings/application/blindMarking";
import { blindHandle, isIdentityBlind } from "@/modules/assessment/domain/blindMarking";
import type { QuestionType } from "@/types";
import {
  changedCellsOf,
  countWords,
  type AttemptAnswer,
  type AttemptAnswers,
} from "@/modules/assessment/domain/attemptAnswers";
import { readJudgmentScore } from "@/modules/assessment/domain/situational";
import { readAttemptBenchmark } from "@/modules/assessment/application/attemptBenchmark";
import {
  readTemplateItemStats,
  type TemplateItemStats,
} from "@/modules/assessment/application/templateItemStats";
import {
  readQuestionTypeAvailability,
  type QuestionTypeAvailability,
} from "@/modules/assessment/application/questionTypeAvailability";
import { LINKS_LIMIT, type IssuedLink } from "@/modules/assessment/domain/issuedLinks";
import type { EditableQuestion } from "./QuestionEditorDrawer";
import { readFollowUpAvailability } from "@/modules/assessment/application/followUpAvailability";
import { readFollowUpRule } from "@/modules/assessment/domain/followUp";
import { comparisonPaper, comparisonSelectionIssue, type AttemptComparison } from "@/modules/assessment/domain/comparison";

export interface TemplateSummary {
  id: string;
  /** Owning company, so a second-test picker can stay inside it. */
  tenant_id: string;
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
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("assessment_templates")
    .select(
      "id, tenant_id, name, description, role_family, time_limit_minutes, is_active, randomize_questions, randomize_options, block_copy_paste, assessment_questions(points, question_type), candidate_attempts(id, status)"
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
      tenant_id: row.tenant_id,
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
  const restClient = await createServerRestClient();

  const { data } = await restClient
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
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("assessment_templates")
    .select("id, name, description, role_family, time_limit_minutes, is_active")
    .eq("id", templateId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: questions } = await restClient
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
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
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

/**
 * Whether this database's `question_type` enum knows the situational judgment
 * label yet.
 *
 * The builder page asks once per render and hands the answer to the question
 * editor, which hides the type from both the type picker and the AI draft
 * checklist while migration 034 is unapplied. Offering a type the enum would
 * refuse turns a save into a 22P02 message about Postgres internals.
 */
export async function getQuestionTypeAvailability(): Promise<QuestionTypeAvailability> {
  await requireStaff("/assessments");
  return readQuestionTypeAvailability(await createServerRestClient());
}

/* -------------------------------------------------------------------------- */
/* Second-test rules                                                          */
/* -------------------------------------------------------------------------- */

/** One suite's rule, resolved against the suite it names. */
export interface SuiteFollowUp {
  target_id: string;
  target_name: string;
  min_percent: number;
  max_percent: number;
  /**
   * False when the target is not in the reader's suite list — deleted under a
   * rule the database did not yet cascade, or owned by a company this reader
   * cannot see. The router refuses such a target, so the card must not call it
   * "paused", which would promise a resume would fix it.
   */
  target_exists: boolean;
  /** The target is paused, so the router would skip it rather than issue it. */
  target_active: boolean;
  /** The target has no questions, so the router would skip it as an empty test. */
  target_questions: number;
}

/** A suite a rule could name, with the two facts a picker should warn about. */
export interface FollowUpSuiteOption {
  id: string;
  name: string;
  tenant_id: string;
  is_active: boolean;
  question_count: number;
}

export interface FollowUpRulesRead {
  /** The rule columns exist, so the editor may show them. */
  rules_available: boolean;
  /** The attempt link exists, so a saved rule can actually issue a link. */
  routing_available: boolean;
  /** Why the rule cannot be shown or will not route; null when it can do both. */
  note: string | null;
  /** Keyed by the suite that owns the rule. */
  byTemplate: Record<string, SuiteFollowUp>;
  /** Every suite, for the second-test picker. Empty when the columns are missing. */
  suites: FollowUpSuiteOption[];
}

/**
 * The second-test rules, read separately from the suite list.
 *
 * `getTemplates` must keep working while 035 is unapplied, and a select that
 * names a missing column refuses the whole query — so this read probes first
 * and answers "not on this database" instead of turning the builder page into
 * a Postgres error. Once the columns exist, one read carries every rule and the
 * target's own facts, so a card can say "paused, so nothing is issued" without
 * a query per suite.
 */
export async function getFollowUpRules(): Promise<FollowUpRulesRead> {
  await requireStaff("/assessments");
  const restClient = await createServerRestClient();
  const availability = await readFollowUpAvailability(restClient);

  if (!availability.rules) {
    return {
      rules_available: false,
      routing_available: availability.routing,
      note: availability.note,
      byTemplate: {},
      suites: [],
    };
  }

  const { data, error } = await restClient
    .from("assessment_templates")
    .select(
      "id, tenant_id, name, is_active, follow_up_template_id, follow_up_min_percent, follow_up_max_percent, assessment_questions(id)"
    )
    .order("name");

  if (error) {
    return {
      rules_available: true,
      routing_available: availability.routing,
      note: `Second-test rules could not be read: ${error.message}`,
      byTemplate: {},
      suites: [],
    };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    tenant_id: string;
    name: string;
    is_active: boolean | null;
    follow_up_template_id?: string | null;
    follow_up_min_percent?: number | string | null;
    follow_up_max_percent?: number | string | null;
    assessment_questions?: { id?: string }[] | null;
  }[];

  const suites: FollowUpSuiteOption[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    tenant_id: row.tenant_id,
    is_active: row.is_active !== false,
    question_count: (row.assessment_questions ?? []).length,
  }));
  const byId = new Map(suites.map((suite) => [suite.id, suite]));

  const byTemplate: Record<string, SuiteFollowUp> = {};
  for (const row of rows) {
    const rule = readFollowUpRule(row);
    if (!rule) continue;
    const target = byId.get(rule.templateId);
    byTemplate[row.id] = {
      target_id: rule.templateId,
      target_name: target?.name ?? "a suite that is not visible",
      min_percent: rule.minPercent,
      max_percent: rule.maxPercent,
      target_exists: target !== undefined,
      target_active: target?.is_active ?? false,
      target_questions: target?.question_count ?? 0,
    };
  }

  return {
    rules_available: true,
    routing_available: availability.routing,
    note: availability.note,
    byTemplate,
    suites,
  };
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
  tracking_code?: string;
  job_id?: string;
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
function linksWindow(restClient: Awaited<ReturnType<typeof createServerRestClient>>) {
  return restClient
    .from("candidate_attempts")
    .select(
      `id, application_id, template_id, status, time_limit_minutes, created_at, started_at, expires_at, submitted_at, total_score, max_score, integrity_flags,
       applications!inner(full_name, tracking_code, job_id, archived_at, job_openings(title)),
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
  /** `security.blind_marking` — the rows below name ungraded papers by their code. */
  blind_marking: boolean;
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
  const [restClient, masked, blind] = await Promise.all([
    createServerRestClient(),
    scoresAreMaskedForCurrentUser(),
    blindMarkingEnabled(),
  ]);

  const { data, error, count } = await linksWindow(restClient).limit(LINKS_LIMIT);
  if (error) throw error;

  const rows = ((data ?? []) as unknown as AttemptLinkJoin[]).map((row) => {
    const application = one(row.applications ?? null);
    const template = one(row.assessment_templates ?? null);
    const identityBlind = isIdentityBlind(row.status, blind);
    return {
      id: row.id,
      application_id: row.application_id,
      // The handle replaces the name down to the row itself, so the browser is
      // never sent a name to hide — the same rule score masking follows.
      candidate_name: identityBlind
        ? blindHandle(application?.tracking_code)
        : (application?.full_name ?? "Candidate"),
      identity_blind: identityBlind,
      job_id: application?.job_id ?? null,
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
  return {
    rows,
    total: count ?? rows.length,
    scores_masked: masked,
    blind_marking: blind,
  };
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
    options?: { label?: string; text?: string; is_correct?: boolean; score?: number }[];
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
  return readAttemptAnswers(attemptId);
}

export async function getAttemptComparison(attemptIds: string[]): Promise<AttemptComparison> {
  await requireStaff("/assessments");
  if (!Array.isArray(attemptIds) || attemptIds.length < 2 || attemptIds.length > 4 ||
      attemptIds.some((id) => typeof id !== "string" || !ATTEMPT_ID.test(id)) ||
      new Set(attemptIds.map((id) => id.toLowerCase())).size !== attemptIds.length) {
    return { ok: false, error: "Choose two to four distinct assessment links." };
  }
  try {
    const results = await Promise.all(attemptIds.map((id) => readAttemptAnswers(id, true)));
    if (results.some((paper) => paper === null)) {
      return { ok: false, error: "One or more selected papers are no longer available to you." };
    }
    const papers = results.filter((paper) => paper !== null);
    const issue = comparisonSelectionIssue(papers.map((paper) => ({
      id: paper.attempt_id, application_id: paper.application_id,
      job_id: paper.job_id, template_id: paper.template_id,
    })));
    if (issue) return { ok: false, error: issue };
    return { ok: true, papers: papers.map(comparisonPaper) };
  } catch {
    return { ok: false, error: "The comparison could not be read. Please try again." };
  }
}

async function readAttemptAnswers(
  attemptId: string,
  comparison = false
): Promise<(AttemptAnswers & { job_id: string | null; template_id: string }) | null> {
  const [restClient, masked, blind] = await Promise.all([
    createServerRestClient(),
    scoresAreMaskedForCurrentUser(),
    blindMarkingEnabled(),
  ]);
  const files = await getFileStore();

  const query = restClient
    .from("candidate_attempts")
    .select(
      `id, application_id, template_id, status, time_limit_minutes, started_at, expires_at, submitted_at, total_score, max_score, integrity_flags, question_order, option_order,
       assessment_templates(name),
       applications${comparison ? "!inner" : ""}(full_name, tracking_code, job_id, job_openings(title))`
    )
    .eq("id", attemptId);
  if (comparison) query.is(LIVE_LINKS_FILTER, null);
  const { data: found, error: attemptError } = await query.maybeSingle();
  if (comparison && attemptError) throw attemptError;

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

  const [{ data: questionRows, error: questionError }, { data: responseRows, error: responseError }, benchmark] = await Promise.all([
    restClient
      .from("assessment_questions")
      .select("id, title, prompt, instructions, question_type, config, points, position")
      .eq("template_id", attempt.template_id)
      .order("position"),
    restClient
      .from("candidate_responses")
      .select(
        "question_id, answer_text, spreadsheet_state, video_path, video_duration_seconds, transcript, score, max_score, updated_at, ai_evaluation"
      )
      .eq("attempt_id", attempt.id),
    // Not counted at all when this reviewer's marks are withheld: a percentile
    // is a claim about other candidates' marks, which is the thing the setting
    // exists to hide.
    masked || comparison ? Promise.resolve(null) : readAttemptBenchmark(restClient, attempt),
  ]);
  if (comparison && questionError) throw questionError;
  if (comparison && responseError) throw responseError;

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
      // Only a judgment scene carries one; a quiz option's key is `correct`.
      score: readJudgmentScore(option.score),
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
      question.question_type === "MULTIPLE_CHOICE" ||
      question.question_type === "SITUATIONAL_JUDGMENT"
        ? (response?.answer_text ?? null)
        : null;
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
        bucket: storageConfig.buckets.candidateVideos,
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
      // A picked option or judgment response is expressed through `options` and
      // `chosen_text` below, so the stored handle is not repeated here as if it
      // were something a person typed.
      answer_text:
        question.question_type === "MULTIPLE_CHOICE" ||
        question.question_type === "SITUATIONAL_JUDGMENT"
          ? null
          : typed || null,
      options: arranged,
      chosen_text: arranged.find((option) => option.chosen)?.text ?? null,
      // A judgment scene has no right option to name — every response is scored
      // on a scale — so only a quiz points at a key here.
      correct_text:
        question.question_type === "MULTIPLE_CHOICE"
          ? (arranged.find((option) => option.correct)?.text ?? null)
          : null,
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
  const identityBlind = isIdentityBlind(attempt.status, blind);

  return {
    attempt_id: attempt.id,
    application_id: attempt.application_id,
    job_id: application?.job_id ?? null,
    template_id: attempt.template_id,
    // The whole paper reads blind, not just the header: the drawer is where a
    // reviewer goes through someone's answers, and a name at the top of it is
    // exactly the priming the switch exists to keep out of that reading.
    candidate_name: identityBlind
      ? blindHandle(application?.tracking_code)
      : (application?.full_name ?? "Candidate"),
    identity_blind: identityBlind,
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

/* -------------------------------------------------------------------------- */
/* Item statistics                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One suite's item table, or the reason it is not on screen.
 *
 * Three honest answers, one shape: a withheld claim, a suite with nothing to
 * measure, and a read that failed. All three print a sentence rather than an
 * empty table, because an empty table reads as "these questions do fine".
 */
export type ItemStatsResult =
  | { ok: true; stats: TemplateItemStats }
  | {
      ok: false;
      reason: "masked" | "empty" | "failed";
      error: string;
    };

/**
 * Difficulty and discrimination for every question in one suite.
 *
 * Loaded when the drawer opens, not with the grid: the figures need every graded
 * answer of every paper the suite produced, and fetching that for a dozen suites
 * to draw a dozen cards is the read the page has no reason to make.
 *
 * Refused outright while `security.mask_scores_for_reviewers` withholds marks from
 * this reviewer. Both figures are computed from other candidates' marks — a
 * difficulty is the mean of their answers and the gap is their papers ranked
 * against each other — so this is the setting's own subject matter, not a
 * neighbour of it.
 */
export async function getTemplateItemStats(templateId: string): Promise<ItemStatsResult> {
  await requireStaff("/assessments");
  if (!ATTEMPT_ID.test(templateId ?? "")) {
    return { ok: false, reason: "failed", error: "This suite could not be loaded. Please retry." };
  }

  const [restClient, masked] = await Promise.all([
    createServerRestClient(),
    scoresAreMaskedForCurrentUser(),
  ]);

  if (masked) {
    return {
      ok: false,
      reason: "masked",
      error:
        "Test scores are withheld from your account by the score-masking setting, so per-question difficulty and discrimination are not shown either.",
    };
  }

  try {
    const stats = await readTemplateItemStats(restClient, templateId);
    if (!stats) {
      return {
        ok: false,
        reason: "empty",
        error: "This suite has no questions, so there is nothing to measure yet.",
      };
    }
    return { ok: true, stats };
  } catch (cause) {
    console.error("[assessments] item statistics failed:", (cause as Error).message);
    return {
      ok: false,
      reason: "failed",
      error: "The graded answers for this suite could not be read. Please retry.",
    };
  }
}
