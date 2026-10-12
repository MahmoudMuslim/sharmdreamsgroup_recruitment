"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import type { QuestionConfig, QuestionType } from "@/types";

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
];

export interface ChoiceDraft {
  text: string;
  is_correct: boolean;
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
  /** MULTIPLE_CHOICE only. */
  options: ChoiceDraft[];
  /** CASE_STUDY only. */
  context: string;
  min_words: number | null;
  /** VIDEO_PITCH only. */
  min_duration_seconds: number | null;
  max_duration_seconds: number | null;
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

/** Builds the type-specific config, preserving anything this form cannot edit. */
function buildConfig(draft: QuestionDraft): QuestionConfig {
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
      return { ...(draft.preserve_config ?? {}), options };
    }

    case "CASE_STUDY": {
      const config: QuestionConfig = { ...(draft.preserve_config ?? {}) };
      config.context = draft.context.trim() || undefined;
      if (draft.min_words && draft.min_words > 0) config.min_words = draft.min_words;
      else delete config.min_words;
      return config;
    }

    case "VIDEO_PITCH": {
      const config: QuestionConfig = { ...(draft.preserve_config ?? {}) };
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
      return config;
    }

    // EXCEL_MODEL is not editable through this form; keep the original bytes.
    case "EXCEL_MODEL":
    default:
      return draft.preserve_config ?? {};
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
  supabase: SupabaseClient,
  templateId: string
): Promise<string | null> {
  const { data, error } = await supabase
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
    const { error: updateError } = await supabase
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

  const supabase = await createSupabaseServerClient();

  // Confirm the template exists so a typo cannot create an orphan question.
  const { data: template } = await supabase
    .from("assessment_templates")
    .select("id")
    .eq("id", draft.template_id)
    .maybeSingle();
  if (!template) return { ok: false, error: "That assessment suite no longer exists." };

  const limit = Number(draft.time_limit_minutes);
  const row = {
    template_id: draft.template_id,
    question_type: draft.question_type,
    title,
    prompt,
    instructions: draft.instructions.trim() || null,
    config: buildConfig(draft) as Record<string, unknown>,
    points,
    position: draft.position,
    time_limit_minutes:
      Number.isFinite(limit) && limit > 0 && limit <= 480 ? Math.round(limit) : null,
    shuffle_options: draft.question_type === "MULTIPLE_CHOICE" ? draft.shuffle_options : false,
  };

  if (draft.id === null) {
    const { data, error } = await supabase
      .from("assessment_questions")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    const renumberError = await renumberSuite(supabase, draft.template_id);
    if (renumberError) return { ok: false, error: renumberError };

    revalidatePath("/assessments");
    return { ok: true, id: data?.id };
  }

  // Editing must not move a question to a different suite.
  const { error } = await supabase
    .from("assessment_questions")
    .update(row)
    .eq("id", draft.id)
    .eq("template_id", draft.template_id);

  if (error) return { ok: false, error: error.message };

  const renumberError = await renumberSuite(supabase, draft.template_id);
  if (renumberError) return { ok: false, error: renumberError };

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

  const supabase = await createSupabaseServerClient();

  // A response means a candidate actually did the work. Deleting the question
  // would leave that response pointing at nothing and quietly drop it from
  // grading, so the delete is refused rather than performed and hidden.
  const { data: responses } = await supabase
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

  const { error } = await supabase
    .from("assessment_questions")
    .delete()
    .eq("id", questionId)
    .eq("template_id", templateId);

  if (error) return { ok: false, error: error.message };

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

  const supabase = await createSupabaseServerClient();

  const { data: questions, error } = await supabase
    .from("assessment_questions")
    .select("id, position")
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

  const { error: firstError } = await supabase
    .from("assessment_questions")
    .update({ position: swapWith })
    .eq("id", target.id);
  if (firstError) return { ok: false, error: firstError.message };

  const { error: secondError } = await supabase
    .from("assessment_questions")
    .update({ position: index })
    .eq("id", neighbour.id);
  if (secondError) return { ok: false, error: secondError.message };

  const renumberError = await renumberSuite(supabase, templateId);
  if (renumberError) return { ok: false, error: renumberError };

  revalidatePath("/assessments");
  return { ok: true, id: questionId };
}