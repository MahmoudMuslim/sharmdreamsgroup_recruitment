"use server";

import { revalidatePath } from "next/cache";
import type { RestClient } from "@/lib/rest/client";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { hasAiProvider } from "@/lib/config.server";
import { recordActivity, withActivityContext } from "@/modules/activity/application/record";
import { changePhrase, changedFields } from "@/modules/activity/domain/trail";
import {
  generateAssessmentQuestions,
  type SuiteAuthoringContext,
} from "@/modules/screening/infrastructure/openRouterEngine";
import {
  MAX_DRAFTS_PER_RUN,
  DIFFICULTIES,
  asReviewedDraft,
  draftForRow,
  normaliseOutputs,
  reviewDrafts,
  type AuthoringBrief,
  type Difficulty,
  type GeneratedQuestion,
} from "@/modules/assessment/domain/aiAuthoring";
import {
  SITUATIONAL_WRITE_REFUSAL,
  isMissingQuestionTypeError,
  judgmentStoredOptions,
  readJudgmentDraft,
  type JudgmentDraft,
} from "@/modules/assessment/domain/situational";
import {
  RUBRIC_WEIGHT_TOTAL,
  isRubricType,
  readRubricDraft,
  rubricCriteriaOf,
  type RubricDraftRow,
} from "@/modules/assessment/domain/rubric";
import { resolveSkillTags } from "@/modules/assessment/domain/skillTags";
import type { QuestionConfig, QuestionType, RubricCriterion } from "@/types";

/**
 * Per-question authoring.
 *
 * The suite editor created the shell but could not touch its questions, which
 * left the seeded suites unmodifiable — the only way to change a question was a
 * migration. These actions make the whole suite editable from the UI.
 *
 * Two rules protect candidate work, because an attempt's "paper" stores question
 * *ids*:
 *   1. Editing content is safe — the id is unchanged, so the paper still
 *      resolves, though in-flight attempts will see the new wording.
 *   2. Deleting is refused once any candidate has actually answered, otherwise
 *      their graded work would silently disappear.
 */

export interface QuestionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const QUESTION_TYPES: QuestionType[] = [
  "MULTIPLE_CHOICE",
  "CASE_STUDY",
  "EXCEL_MODEL",
  "VIDEO_PITCH",
  "SITUATIONAL_JUDGMENT",
];

export interface ChoiceDraft {
  text: string;
  is_correct: boolean;
  /**
   * SITUATIONAL_JUDGMENT only: how effective the response is, 0–100.
   *
   * Ignored for a quiz, where `is_correct` is the whole answer key. A scene
   * carries no correct option at all — its ranking lives in these percentages.
   */
  score?: number | null;
}

export interface QuestionDraft {
  id: string | null;
  template_id: string;
  question_type: QuestionType;
  title: string;
  prompt: string;
  instructions: string;
  points: number;
  position: number;
  time_limit_minutes: number | null;
  shuffle_options: boolean;
  /** MULTIPLE_CHOICE and SITUATIONAL_JUDGMENT. */
  options: ChoiceDraft[];
  /** CASE_STUDY only. */
  context: string;
  min_words: number | null;
  /** VIDEO_PITCH only. */
  min_duration_seconds: number | null;
  max_duration_seconds: number | null;
  /**
   * CASE_STUDY and VIDEO_PITCH: the marking scheme, one row per criterion.
   *
   * Absent means the caller does not read the marking scheme and must not
   * destroy it; an array with nothing named or weighted in it is an author
   * emptying the panel, which retires the rubric.
   */
  rubric?: RubricDraftRow[] | null;
  /**
   * EXCEL_MODEL carries a spreadsheet definition that no simple form can
   * represent. When editing, the caller sends the original config back
   * untouched so the editor never silently destroys it.
   */
  preserve_config: QuestionConfig | null;
}

async function requireAssessmentEditor(): Promise<string | null> {
  if (await hasPermissionForUser("assessments.create")) return null;
  return "You need the Create assessments permission.";
}

/**
 * The sentence a refused question write is shown.
 *
 * Postgres reports a missing enum label as 22P02 with nothing the author can
 * act on, so a write naming SITUATIONAL_JUDGMENT while 034 is unapplied is
 * answered with the migration that would make it work. Every other error is the
 * database's own message, unchanged.
 */
function questionWriteError(error: { code?: string | null; message: string }): string {
  return isMissingQuestionTypeError(error) ? SITUATIONAL_WRITE_REFUSAL : error.message;
}

/** What a draft means for the question's marking scheme. */
type RubricChange =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "set"; criteria: RubricCriterion[] }
  | { kind: "refuse"; error: string };

/**
 * Whether a draft row is a criterion at all.
 *
 * Mirrors the rows `readRubricDraft` drops, so "the panel is empty" and "the
 * panel has criteria in it" cannot disagree with the validator that reads them.
 */
function rubricRowIsUsed(row: RubricDraftRow | null | undefined): boolean {
  if (!row) return false;
  if (typeof row.label === "string" && row.label.trim().length > 0) return true;
  return (
    typeof row.weight === "number" &&
    Number.isInteger(row.weight) &&
    row.weight >= 1 &&
    row.weight <= RUBRIC_WEIGHT_TOTAL
  );
}

/**
 * What the draft means for the question's marking scheme.
 *
 * Three states arrive as one absent key otherwise: a caller that has no rubric
 * panel (an Excel config, an older draft) must not destroy criteria it never
 * read, while an author who emptied the panel means the criteria to go.
 */
function resolveRubricChange(draft: QuestionDraft): RubricChange {
  if (!isRubricType(draft.question_type) || !Array.isArray(draft.rubric)) {
    return { kind: "keep" };
  }
  if (!draft.rubric.some(rubricRowIsUsed)) return { kind: "clear" };

  const read = readRubricDraft(draft.rubric);
  return read.ok ? { kind: "set", criteria: read.criteria } : { kind: "refuse", error: read.error };
}

/** Store or retire the marking scheme on a config this form is rebuilding. */
function applyRubricChange(config: QuestionConfig, rubric: RubricChange): void {
  if (rubric.kind === "clear") delete config.rubric;
  else if (rubric.kind === "set") config.rubric = rubric.criteria;
}

/**
 * Builds the type-specific config, preserving anything this form cannot edit.
 *
 * `judgment` carries the responses a scene already had validated, because
 * `buildConfig` cannot return a refusal — `saveQuestion` reads them first and
 * only calls this once they are markable. `rubric` is resolved the same way: an
 * invalid scheme is refused by the caller, so the config builder only stores
 * what has already passed.
 */
function buildConfig(
  draft: QuestionDraft,
  judgment: JudgmentDraft[] = [],
  rubric: RubricChange = { kind: "keep" },
  preserve: QuestionConfig | null = draft.preserve_config
): QuestionConfig {
  switch (draft.question_type) {
    case "MULTIPLE_CHOICE": {
      const options = draft.options
        .filter((option) => option.text.trim().length > 0)
        .map((option, index) => ({
          // Labels are the stable handle the option shuffle orders by, so they
          // must stay unique even when the wording changes.
          label: `OPT_${index + 1}`,
          text: option.text.trim(),
          is_correct: option.is_correct,
        }));
      const config: QuestionConfig = { ...(preserve ?? {}), options };
      delete config.rubric;
      return config;
    }

    case "SITUATIONAL_JUDGMENT": {
      const config: QuestionConfig = {
        ...(preserve ?? {}),
        options: judgmentStoredOptions(judgment),
      };
      delete config.rubric;
      return config;
    }

    case "CASE_STUDY": {
      const config: QuestionConfig = { ...(preserve ?? {}) };
      config.context = draft.context.trim() || undefined;
      if (draft.min_words && draft.min_words > 0) config.min_words = draft.min_words;
      else delete config.min_words;
      applyRubricChange(config, rubric);
      return config;
    }

    case "VIDEO_PITCH": {
      const config: QuestionConfig = { ...(preserve ?? {}) };
      if (draft.max_duration_seconds && draft.max_duration_seconds > 0) {
        config.max_duration_seconds = draft.max_duration_seconds;
      } else {
        delete config.max_duration_seconds;
      }
      if (draft.min_duration_seconds && draft.min_duration_seconds > 0) {
        config.min_duration_seconds = draft.min_duration_seconds;
      } else {
        delete config.min_duration_seconds;
      }
      applyRubricChange(config, rubric);
      return config;
    }

    // EXCEL_MODEL is not editable through this form; keep the original bytes.
    case "EXCEL_MODEL":
    default:
      return preserve ?? {};
  }
}

/**
 * Rewrites a suite's positions to a dense 0..n-1 sequence.
 *
 * Seeded suites shipped with 1-based positions, so without this the ordering
 * drifts every time a question is edited — one row normalised to 0 while its
 * neighbours stay at 1,2 leaves a permanent gap. Ordering is by `position`, so a
 * gap is harmless today, but a dense sequence means insert, move and edit all
 * agree on what "next" means.
 */
async function renumberSuite(
  restClient: RestClient,
  templateId: string
): Promise<string | null> {
  const { data, error } = await restClient
    .from("assessment_questions")
    .select("id, position")
    .eq("template_id", templateId)
    .order("position");

  if (error) return error.message;

  const ordered = [...(data ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  for (let i = 0; i < ordered.length; i += 1) {
    if ((ordered[i].position ?? 0) === i) continue;
    const { error: updateError } = await restClient
      .from("assessment_questions")
      .update({ position: i })
      .eq("id", ordered[i].id);
    if (updateError) return updateError.message;
  }

  return null;
}

export async function saveQuestion(draft: QuestionDraft): Promise<QuestionResult> {
  await requireStaff("/assessments");
  const denied = await requireAssessmentEditor();
  if (denied) return { ok: false, error: denied };

  if (!QUESTION_TYPES.includes(draft.question_type)) {
    return { ok: false, error: "Choose a valid question type." };
  }

  const title = draft.title.trim();
  if (!title) return { ok: false, error: "A question title is required." };

  const prompt = draft.prompt.trim();
  if (!prompt) return { ok: false, error: "A question prompt is required." };

  const points = Number(draft.points);
  if (!Number.isFinite(points) || points < 1 || points > 100) {
    return { ok: false, error: "Points must be between 1 and 100." };
  }

  if (!Number.isInteger(draft.position) || draft.position < 0) {
    return { ok: false, error: "Position must be a whole number of 0 or more." };
  }

  if (draft.question_type === "MULTIPLE_CHOICE") {
    const options = draft.options.filter((o) => o.text.trim().length > 0);
    if (options.length < 2) {
      return { ok: false, error: "A multiple-choice question needs at least two options." };
    }
    const correct = options.filter((o) => o.is_correct).length;
    if (correct !== 1) {
      return {
        ok: false,
        error: "Exactly one option must be marked correct.",
      };
    }
  }

  let judgment: JudgmentDraft[] = [];
  if (draft.question_type === "SITUATIONAL_JUDGMENT") {
    const read = readJudgmentDraft(
      draft.options.map((option) => ({ text: option.text, score: option.score ?? null }))
    );
    if (!read.ok) return { ok: false, error: read.error };
    judgment = read.options;
  }

  // The marking scheme is read before a client exists: a scheme that cannot add
  // up is answered with the sentence that says why, without a database round
  // trip. Its skill tags are a different question — they are claims about
  // catalogue rows, so they are resolved below, once there is a client to read.
  let rubric = resolveRubricChange(draft);
  if (rubric.kind === "refuse") return { ok: false, error: rubric.error };

  const restClient = await createServerRestClient();

  // A tag is a claim about a catalogue row, so it is resolved against the
  // catalogue before anything is written. An unknown or retired id is refused
  // with the criterion and the skill named; the stored name is always the
  // catalogue's own spelling, never the one a client sent.
  if (rubric.kind === "set") {
    const tagged = await resolveSkillTags(restClient, rubric.criteria);
    if (!tagged.ok) return { ok: false, error: tagged.error };
    rubric = { kind: "set", criteria: tagged.criteria };
  }

  // A preserved rubric arrives as stored config handed straight back, and it
  // reaches the row through the same spread as one typed in the panel. It must
  // pass the same catalogue check, or "preserve" would be a door around it.
  // A preserved row too malformed for `rubricCriteriaOf` (no readable label or
  // weight) never reaches a grading snapshot, so it is neither checked nor
  // rewritten here.
  let preserveConfig = draft.preserve_config;
  if (rubric.kind === "keep" && isRubricType(draft.question_type) && preserveConfig) {
    const preserved = rubricCriteriaOf(preserveConfig);
    if (preserved.length > 0) {
      const tagged = await resolveSkillTags(restClient, preserved);
      if (!tagged.ok) return { ok: false, error: tagged.error };

      // The catalogue owns the name. Rows without a tag keep every key they had.
      const names = new Map<string, string>();
      for (const criterion of tagged.criteria) {
        if (criterion.skill_id && criterion.skill_name) {
          names.set(criterion.skill_id, criterion.skill_name);
        }
      }
      const rows = (
        Array.isArray(preserveConfig.rubric) ? preserveConfig.rubric : []
      ) as unknown as RubricDraftRow[];
      preserveConfig = {
        ...preserveConfig,
        rubric: rows.map((row) => {
          if (!row || typeof row !== "object") return row as unknown as RubricCriterion;
          const skillId = typeof row.skill_id === "string" ? row.skill_id.trim() : "";
          const name = skillId ? names.get(skillId) : undefined;
          return name
            ? ({ ...row, skill_name: name } as unknown as RubricCriterion)
            : (row as unknown as RubricCriterion);
        }),
      };
    }
  }

  // Confirm the template exists so a typo cannot create an orphan question.
  const { data: template } = await restClient
    .from("assessment_templates")
    .select("id, name")
    .eq("id", draft.template_id)
    .maybeSingle();
  if (!template) return { ok: false, error: "That assessment suite no longer exists." };
  const suite = template.name;

  const limit = Number(draft.time_limit_minutes);
  const row = {
    template_id: draft.template_id,
    question_type: draft.question_type,
    title,
    prompt,
    instructions: draft.instructions.trim() || null,
    config: buildConfig(draft, judgment, rubric, preserveConfig) as Record<string, unknown>,
    points,
    position: draft.position,
    time_limit_minutes:
      Number.isFinite(limit) && limit > 0 && limit <= 480 ? Math.round(limit) : null,
    // A scene's responses are as order-sensitive as a quiz's — the most
    // effective one must not always sit in the same slot.
    shuffle_options:
      draft.question_type === "MULTIPLE_CHOICE" || draft.question_type === "SITUATIONAL_JUDGMENT"
        ? draft.shuffle_options
        : false,
  };

  if (draft.id === null) {
    const { data, error } = await restClient
      .from("assessment_questions")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: questionWriteError(error) };

    const renumberError = await renumberSuite(restClient, draft.template_id);
    if (renumberError) return { ok: false, error: renumberError };

    await recordActivity({
      area: "assessments",
      action: "question_create",
      entity: "assessment question",
      entityId: data?.id ?? null,
      summary: `Added the ${draft.question_type.toLowerCase().replace(/_/g, " ")} question “${title}” (${points} points) to “${suite}”`,
      detail: {
        suite,
        points,
        position: row.position,
        options: row.config?.options,
        time_limit_minutes: row.time_limit_minutes,
      },
    });

    revalidatePath("/assessments");
    return { ok: true, id: data?.id };
  }

  const { data: previous } = await restClient
    .from("assessment_questions")
    .select(
      "id, template_id, question_type, title, prompt, instructions, config, points, position, time_limit_minutes, shuffle_options"
    )
    .eq("id", draft.id)
    .maybeSingle();
  if (!previous) return { ok: false, error: "That question no longer exists." };

  // Editing must not move a question to a different suite.
  const { error } = await restClient
    .from("assessment_questions")
    .update(row)
    .eq("id", draft.id)
    .eq("template_id", draft.template_id);

  if (error) return { ok: false, error: questionWriteError(error) };

  const renumberError = await renumberSuite(restClient, draft.template_id);
  if (renumberError) return { ok: false, error: renumberError };

  const edits = changedFields(previous as Record<string, unknown>, row);
  await recordActivity({
    area: "assessments",
    action: "question_edit",
    entity: "assessment question",
    entityId: draft.id,
    summary: `Rewrote the question “${title}” in “${suite}” — ${changePhrase(edits)}${
      edits.points ? ", which changes what a sitting scores" : ""
    }`,
    detail: edits,
  });

  revalidatePath("/assessments");
  return { ok: true, id: draft.id };
}

export async function deleteQuestion(
  questionId: string,
  templateId: string
): Promise<QuestionResult> {
  await requireStaff("/assessments");
  const denied = await requireAssessmentEditor();
  if (denied) return { ok: false, error: denied };

  const restClient = await createServerRestClient();

  // A response means a candidate actually did the work. Deleting the question
  // would leave that response pointing at nothing and quietly drop it from
  // grading, so the delete is refused rather than performed and hidden.
  const { data: responses } = await restClient
    .from("candidate_responses")
    .select("id")
    .eq("question_id", questionId)
    .limit(1);

  if ((responses ?? []).length > 0) {
    return {
      ok: false,
      error:
        "A candidate has already answered this question, so deleting it would remove their work. Set its points to 0 or retire the suite instead.",
    };
  }

  const { data: removed } = await restClient
    .from("assessment_questions")
    .select("id, title, points, question_type")
    .eq("id", questionId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (!removed) return { ok: false, error: "That question is no longer in this suite." };

  const { error } = await restClient
    .from("assessment_questions")
    .delete()
    .eq("id", questionId)
    .eq("template_id", templateId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "question_delete",
    entity: "assessment question",
    entityId: questionId,
    summary: `Deleted the question “${removed.title}” (${removed.points} points) — no candidate had answered it`,
    detail: {
      title: removed.title,
      points: removed.points,
      question_type: removed.question_type,
      template_id: templateId,
    },
  });

  revalidatePath("/assessments");
  return { ok: true, id: questionId };
}

/**
 * Moves a question one slot up or down and renumbers the suite.
 *
 * Positions are rewritten as a dense 0..n-1 sequence so ordering stays stable
 * and free of gaps after several moves.
 */
export async function moveQuestion(
  questionId: string,
  templateId: string,
  direction: "up" | "down"
): Promise<QuestionResult> {
  await requireStaff("/assessments");
  const denied = await requireAssessmentEditor();
  if (denied) return { ok: false, error: denied };

  const restClient = await createServerRestClient();

  const { data: questions, error } = await restClient
    .from("assessment_questions")
    .select("id, position, title")
    .eq("template_id", templateId)
    .order("position");

  if (error) return { ok: false, error: error.message };

  const ordered = [...(questions ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  const index = ordered.findIndex((q) => q.id === questionId);
  if (index === -1) return { ok: false, error: "That question is no longer in this suite." };

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ordered.length) {
    // Already at the end — not an error, just nothing to do.
    return { ok: true, id: questionId };
  }

  // Exchange the two rows' positions.
  //
  // Note this must not be done by swapping the array entries first and then
  // reading `ordered[index]`/`ordered[swapWith]`: after a swap those slots hold
  // the opposite question, so each row gets written the position it already had
  // and the update is silently a no-op. Reading the pair by its original index
  // keeps "the question that was clicked" and "its neighbour" unambiguous.
  const target = ordered[index];
  const neighbour = ordered[swapWith];

  const { error: firstError } = await restClient
    .from("assessment_questions")
    .update({ position: swapWith })
    .eq("id", target.id);
  if (firstError) return { ok: false, error: firstError.message };

  const { error: secondError } = await restClient
    .from("assessment_questions")
    .update({ position: index })
    .eq("id", neighbour.id);
  if (secondError) return { ok: false, error: secondError.message };

  const renumberError = await renumberSuite(restClient, templateId);
  if (renumberError) return { ok: false, error: renumberError };

  await recordActivity({
    area: "assessments",
    action: "question_move",
    entity: "assessment question",
    entityId: questionId,
    summary: `Moved “${target.title}” ${direction} past “${neighbour.title}” in the suite — candidates see the paper in the new order`,
    detail: {
      from_position: index,
      to_position: swapWith,
      template_id: templateId,
    },
  });

  revalidatePath("/assessments");
  return { ok: true, id: questionId };
}

// ============================================================================
// AI authoring
// ============================================================================

/**
 * Drafts questions for a suite, and stores nothing.
 *
 * The split matters: a model's question is not a candidate's question until a
 * recruiter has read it and chosen to add it. So this call spends the model
 * request, runs the runner's own rules over what came back, and hands the result
 * to `addDraftedQuestions` — which is the only door into `assessment_questions`.
 */
export interface AuthoringInput {
  templateId: string;
  topic: string;
  types: QuestionType[];
  count: number;
  difficulty: Difficulty;
  pointsEach: number;
  notes: string;
}

export interface AuthoringResult extends QuestionResult {
  drafts?: GeneratedQuestion[];
  /** One sentence per draft refused, so a short run explains itself. */
  dropped?: string[];
  shortBy?: number;
  suite?: string;
  /** Which model answered, because the recruiter is entitled to know whose words these are. */
  model?: string;
}

export interface DraftWriteResult extends QuestionResult {
  created?: number;
  /**
   * Drafts the suite refused, each with its position in the list that was sent.
   *
   * The index is the only handle the review desk has: two drafts can carry the
   * same title, and a title is not something to parse a sentence back out of.
   */
  refused?: { index: number; title: string; reason: string }[];
  suite?: string;
}

const TOPIC_CAP = 400;
const NOTES_CAP = 600;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function readSuiteForAuthoring(
  restClient: RestClient,
  templateId: string
): Promise<SuiteAuthoringContext | null> {
  const { data, error } = await restClient
    .from("assessment_templates")
    .select("id, name, description, role_family, time_limit_minutes")
    .eq("id", templateId)
    .maybeSingle();
  if (error || !data) return null;

  const { data: questions } = await restClient
    .from("assessment_questions")
    .select("title")
    .eq("template_id", templateId)
    .order("position");

  return {
    name: data.name,
    description: data.description ?? "",
    roleFamily: data.role_family ?? "",
    timeLimitMinutes: data.time_limit_minutes ?? 60,
    existingTitles: (questions ?? []).map((row: { title: string }) => row.title),
  };
}

export async function draftQuestions(input: AuthoringInput): Promise<AuthoringResult> {
  await requireStaff("/assessments");
  const denied = await requireAssessmentEditor();
  if (denied) return { ok: false, error: denied };
  if (!hasAiProvider()) {
    return { ok: false, error: "No AI provider key is configured, so nothing can be drafted." };
  }

  const topic = (input.topic ?? "").trim().slice(0, TOPIC_CAP);
  if (topic.length < 4) {
    return { ok: false, error: "Say what the questions should test — a skill, a tool, a judgement." };
  }

  const types = (input.types ?? []).filter((type) => QUESTION_TYPES.includes(type));
  if (types.length === 0) {
    return { ok: false, error: "Tick at least one question type to draft." };
  }

  const brief: AuthoringBrief = {
    topic,
    types,
    count: clampInt(input.count, 1, MAX_DRAFTS_PER_RUN, 3),
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : "MID",
    pointsEach: clampInt(input.pointsEach, 1, 100, 10),
    notes: (input.notes ?? "").trim().slice(0, NOTES_CAP),
  };

  const restClient = await createServerRestClient();
  const suite = await readSuiteForAuthoring(restClient, input.templateId);
  if (!suite) return { ok: false, error: "That suite no longer exists." };

  let generated: Awaited<ReturnType<typeof generateAssessmentQuestions>>;
  try {
    generated = await generateAssessmentQuestions(brief, suite);
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "The model did not return any questions.",
    };
  }

  const review = reviewDrafts(generated.parsed, brief, suite.existingTitles);
  return {
    ok: true,
    drafts: review.drafts,
    dropped: review.dropped,
    shortBy: review.shortBy,
    suite: suite.name,
    model: generated.model,
  };
}

/**
 * Adds the drafts a recruiter chose, through the same writer the manual editor
 * uses, and records them as AI-drafted.
 *
 * The drafts come back from the browser, so nothing about them is trusted: the
 * grid and its required cells are rebuilt by the same pure functions that
 * reviewed them, and every row still passes `saveQuestion`, which refuses the
 * types, marks and answer keys the runner cannot handle.
 *
 * One refused draft does not stop the others — a recruiter who clicked "add all"
 * on six and gets four back is told which two, and why, rather than having the
 * whole batch rolled back for one bad cell reference.
 */
export async function addDraftedQuestions(
  templateId: string,
  drafts: GeneratedQuestion[]
): Promise<DraftWriteResult> {
  const staff = await requireStaff("/assessments");
  const denied = await requireAssessmentEditor();
  if (denied) return { ok: false, error: denied };

  const chosen = Array.isArray(drafts) ? drafts.slice(0, MAX_DRAFTS_PER_RUN) : [];
  if (chosen.length === 0) return { ok: false, error: "Nothing was chosen to add." };

  const restClient = await createServerRestClient();
  const suite = await readSuiteForAuthoring(restClient, templateId);
  if (!suite) return { ok: false, error: "That suite no longer exists." };

  let created = 0;
  const refused: { index: number; title: string; reason: string }[] = [];

  await withActivityContext(
    {
      actorKind: "AI",
      actorLabel: "AI question drafting",
      actorId: staff.profileId,
      companyId: staff.tenantId,
    },
    async () => {
      for (const [index, entry] of chosen.entries()) {
        // A draft comes back from the browser, so its shape is repaired before
        // anything reads it: `saveQuestion` calls `.trim()` on fields a review
        // always fills, and one missing string would throw this loop down — the
        // whole batch lost to a server error instead of refused one at a time.
        const draft = asReviewedDraft(entry);
        const label = draft.title || `Question ${index + 1}`;
        const { outputs, refused: cellRefusals } = normaliseOutputs(draft.outputs, draft.sheet);
        // A workbook can arrive here with every required cell refused — the sheet
        // was edited, or the desk's copy is stale. `saveQuestion` cannot see that,
        // because it does not read a spreadsheet, so the row would be stored with
        // nothing to grade.
        if (draft.question_type === "EXCEL_MODEL" && outputs.length === 0) {
          refused.push({
            index,
            title: label,
            reason:
              cellRefusals[0] ??
              "none of its required cells survived, so it would score nothing",
          });
          continue;
        }
        const result = await saveQuestion(
          draftForRow({ ...draft, outputs }, templateId, suite.existingTitles.length + index)
        );
        if (result.ok) created += 1;
        else {
          refused.push({
            index,
            title: label,
            reason: result.error ?? "the suite refused it",
          });
        }
      }
    }
  );

  if (created === 0) {
    return {
      ok: false,
      error:
        refused.length > 0
          ? `None of the drafts could be added. ${refused[0].title}: ${refused[0].reason}`
          : "None of the drafts could be added to the suite.",
      refused,
      suite: suite.name,
    };
  }

  return { ok: true, created, refused, suite: suite.name };
}