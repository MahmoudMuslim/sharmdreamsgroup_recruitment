"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { parseGateRows, type GateOption, type GateQuestion } from "@/modules/careers/gate-questions";

/**
 * Authoring console for the viability questions on the public apply form.
 *
 * Gated on `jobs.manage` rather than a platform setting: these questions are a
 * property of a role (who can be considered for it), so the people who can
 * publish a role are the people who should be able to gate it. The same key is
 * what the storage policy on the table enforces, so the UI can never offer a
 * write the database would refuse.
 */

const COLUMNS = "id, job_id, question, help_text, options, position, is_active";

export interface GateConsoleData {
  questions: GateQuestion[];
  jobs: { id: string; title: string }[];
}

export interface GateDraft {
  id: string | null;
  /** Null asks the question for every published role. */
  job_id: string | null;
  question: string;
  help_text: string;
  options: GateOption[];
  is_active: boolean;
  position: number;
}

export interface GateResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPTIONS = 12;

/** Staff session + `jobs.manage`, or the message explaining which is missing. */
async function requireGateEditor(): Promise<
  { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> } | { error: string }
> {
  await requireStaff("/apply-questions");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { error: "You need the Manage jobs permission to edit these questions." };
  }
  return { supabase: await createSupabaseServerClient() };
}

export async function getGateConsoleData(): Promise<GateConsoleData> {
  const supabase = await createSupabaseServerClient();

  const [questions, jobs] = await Promise.all([
    supabase.from("application_gate_questions").select(COLUMNS).order("position", { ascending: true }),
    supabase
      .from("job_openings")
      .select("id, title")
      .eq("status", "PUBLISHED")
      .order("title", { ascending: true }),
  ]);

  return {
    questions: parseGateRows((questions.data ?? []) as unknown as Record<string, unknown>[]),
    jobs: (jobs.data ?? []) as { id: string; title: string }[],
  };
}

/**
 * Turns a draft into the columns the table stores, or explains what is wrong.
 *
 * The rules are the ones scoring depends on, not cosmetics: two options with the
 * same label make "which answer did they pick" ambiguous, and a question with no
 * acceptable answer rejects every applicant who is asked it — which is never what
 * a recruiter means.
 */
function columnsFrom(
  draft: GateDraft
): { ok: true; columns: Record<string, unknown> } | { ok: false; error: string } {
  const question = draft.question.trim();
  if (question.length < 3) return { ok: false, error: "Write the question in at least a few words." };
  if (question.length > 400) return { ok: false, error: "A question must be 400 characters or fewer." };

  const helpText = draft.help_text.trim();
  if (helpText.length > 400) {
    return { ok: false, error: "The guidance under a question must be 400 characters or fewer." };
  }

  const options: GateOption[] = [];
  const seen = new Set<string>();

  for (const option of draft.options) {
    const label = option.label.trim();
    if (!label) return { ok: false, error: "Every answer needs a label, or remove the blank one." };
    if (label.length > 120) return { ok: false, error: `“${label}” is too long — keep answers under 120 characters.` };

    const key = label.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `“${label}” is offered twice. Two identical answers cannot be scored apart.` };
    }
    seen.add(key);
    options.push({ label, passes: option.passes === true });
  }

  if (options.length < 2) {
    return { ok: false, error: "Offer at least two answers — a question with one choice is not a question." };
  }
  if (options.length > MAX_OPTIONS) {
    return { ok: false, error: `Keep it to ${MAX_OPTIONS} answers or fewer.` };
  }
  if (!options.some((option) => option.passes)) {
    return {
      ok: false,
      error: "Mark at least one answer as accepted. Otherwise every application is rejected the moment it arrives.",
    };
  }

  if (draft.job_id && !UUID_PATTERN.test(draft.job_id)) {
    return { ok: false, error: "Choose one of the open roles, or ask it for every role." };
  }

  return {
    ok: true,
    columns: {
      job_id: draft.job_id || null,
      question,
      help_text: helpText || null,
      options,
      position: Number.isInteger(draft.position) && draft.position >= 0 ? draft.position : 0,
      is_active: draft.is_active,
    },
  };
}

/** Creates or updates a question; `id` decides which. */
export async function saveGateQuestion(draft: GateDraft): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };
  const { supabase } = guard;

  const built = columnsFrom(draft);
  if (!built.ok) return { ok: false, error: built.error };
  const { columns } = built;

  if (draft.id) {
    if (!UUID_PATTERN.test(draft.id)) return { ok: false, error: "That question no longer exists." };

    const { data, error } = await supabase
      .from("application_gate_questions")
      .update(columns)
      .eq("id", draft.id)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: describeWriteError(error) };
    if (!data) return { ok: false, error: "That question was deleted while you were editing it." };

    revalidatePath("/apply-questions");
    return { ok: true, id: data.id };
  }

  // A new question goes to the end of its own group, so adding one never
  // reshuffles the form a candidate is halfway through.
  const scopeCount = supabase
    .from("application_gate_questions")
    .select("id", { count: "exact", head: true });

  const { count } = draft.job_id
    ? await scopeCount.eq("job_id", draft.job_id)
    : await scopeCount.is("job_id", null);

  const { data, error } = await supabase
    .from("application_gate_questions")
    .insert({ ...columns, position: count ?? 0 })
    .select("id")
    .single();

  if (error) return { ok: false, error: describeWriteError(error) };

  revalidatePath("/apply-questions");
  return { ok: true, id: data?.id };
}

/**
 * Reorders within one scope group.
 *
 * Swapping two `position` values rather than renumbering the group keeps this to
 * two writes and leaves the rest of the rows' `updated_at` alone.
 */
export async function moveGateQuestion(
  questionId: string,
  direction: "up" | "down"
): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };
  const { supabase } = guard;

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const { data: currentRow } = await supabase
    .from("application_gate_questions")
    .select("id, job_id, position")
    .eq("id", questionId)
    .maybeSingle();

  if (!currentRow) return { ok: false, error: "That question no longer exists." };

  const current = currentRow as unknown as {
    id: string;
    job_id: string | null;
    position: number;
  };

  // The same group only: a role's question is never swapped with a shared one.
  const base = supabase.from("application_gate_questions").select("id, position");
  const scope = current.job_id ? base.eq("job_id", current.job_id) : base.is("job_id", null);

  const { data: neighbourRows } =
    direction === "up"
      ? await scope.lt("position", current.position).order("position", { ascending: false }).limit(1)
      : await scope.gt("position", current.position).order("position", { ascending: true }).limit(1);

  const neighbour = ((neighbourRows ?? []) as unknown as { id: string; position: number }[])[0];
  if (!neighbour) return { ok: false, error: "Nothing to move it past." };

  const swaps: [string, number][] = [
    [questionId, neighbour.position],
    [neighbour.id, current.position],
  ];

  for (const [id, position] of swaps) {
    const { error } = await supabase
      .from("application_gate_questions")
      .update({ position })
      .eq("id", id);
    if (error) return { ok: false, error: describeWriteError(error) };
  }

  revalidatePath("/apply-questions");
  return { ok: true };
}

/**
 * Switches a question off rather than deleting it.
 *
 * Deletion is also offered, but the safe default for something candidates have
 * already answered is to stop asking it while leaving the row — and the answers
 * stored against it — intact.
 */
export async function setGateQuestionActive(
  questionId: string,
  active: boolean
): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.supabase
    .from("application_gate_questions")
    .update({ is_active: active })
    .eq("id", questionId);

  if (error) return { ok: false, error: describeWriteError(error) };

  revalidatePath("/apply-questions");
  return { ok: true };
}

/** Removes a question. Applications already carry its answer as text. */
export async function deleteGateQuestion(questionId: string): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.supabase
    .from("application_gate_questions")
    .delete()
    .eq("id", questionId);

  if (error) return { ok: false, error: describeWriteError(error) };

  revalidatePath("/apply-questions");
  return { ok: true };
}

/** The two constraint errors this table can raise, in recruiter language. */
function describeWriteError(error: { code?: string; message: string }): string {
  if (error.code === "23503") {
    return "That role no longer exists — pick one of the current openings.";
  }
  if (error.code === "23514") {
    return "The answers could not be stored — each one needs a label and a yes or no.";
  }
  return error.message;
}
