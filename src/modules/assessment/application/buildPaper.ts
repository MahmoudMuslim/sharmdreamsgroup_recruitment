"use server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { currentActivityContext, recordActivity } from "@/modules/activity/application/record";
import { APPLICATION_EMBED, attemptContext } from "@/modules/assessment/application/runner-trail";

/** Deterministic shuffle so a resumed attempt keeps the same paper. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const array = [...items];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let i = array.length - 1; i > 0; i -= 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    hash >>>= 0;
    const j = hash % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Builds the per-attempt paper: question order and multiple-choice option order.
 *
 * Stored once on the attempt so a candidate who refreshes, switches device or
 * resumes later still sees the same paper — randomisation must not let someone
 * retry their way to an easier set.
 */
export async function buildPaper(accessToken: string): Promise<{
  questionOrder: string[];
  optionOrder: Record<string, string[]>;
} | null> {
  const supabase = getSupabaseServiceClient();

  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select(`id, access_token, question_order, option_order, template_id, ${APPLICATION_EMBED}`)
    .eq("access_token", accessToken)
    .maybeSingle();

  if (!attempt) return null;

  if (Array.isArray(attempt.question_order) && attempt.question_order.length > 0) {
    return {
      questionOrder: attempt.question_order as string[],
      optionOrder: (attempt.option_order ?? {}) as Record<string, string[]>,
    };
  }

  const { data: template } = await supabase
    .from("assessment_templates")
    .select("randomize_questions, randomize_options")
    .eq("id", attempt.template_id)
    .maybeSingle();

  const { data: questions } = await supabase
    .from("assessment_questions")
    .select("id, position, shuffle_options, config")
    .eq("template_id", attempt.template_id)
    .order("position");

  if (!questions || questions.length === 0) return null;

  const ordered = template?.randomize_questions
    ? seededShuffle(
        questions.map((q) => q.id),
        accessToken
      )
    : questions.map((q) => q.id);

  const optionOrder: Record<string, string[]> = {};
  if (template?.randomize_options) {
    for (const question of questions) {
      if (!question.shuffle_options) continue;
      const config = question.config as { options?: { label: string }[] } | null;
      const options = config?.options ?? [];
      if (options.length < 2) continue;
      optionOrder[question.id] = seededShuffle(
        options.map((option) => option.label),
        `${accessToken}:${question.id}`
      );
    }
  }

  await supabase
    .from("candidate_attempts")
    .update({ question_order: ordered, option_order: optionOrder })
    .eq("id", attempt.id);

  // Only a shuffled paper is worth a row: the order exists to be provable, so
  // someone can be shown that this candidate saw a set nobody else saw.
  if (template?.randomize_questions || template?.randomize_options) {
    const { candidateName, jobTitle } = attemptContext(attempt);
    await recordActivity({
      actorKind: "SYSTEM",
      actorLabel: "Paper shuffler",
      via: currentActivityContext().via ?? "assessment runner",
      area: "assessments",
      action: "paper_dealt",
      entity: "attempt",
      entityId: attempt.id,
      summary: `Dealt ${candidateName} a shuffled paper for ${jobTitle} — ${ordered.length} questions${Object.keys(optionOrder).length ? `, ${Object.keys(optionOrder).length} with randomised options` : ""}`,
      detail: {
        questions: ordered.length,
        options_shuffled: Object.keys(optionOrder).length,
        randomize_questions: template?.randomize_questions === true,
        randomize_options: template?.randomize_options === true,
        note: "The order is stored on the attempt, so a refresh or another device shows the same paper.",
      },
    });
  }

  return { questionOrder: ordered, optionOrder };
}