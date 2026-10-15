"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
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

/** The question as the trail must name it, plus the row it belongs to. */
interface GateRow {
  question: string;
  job_id: string | null;
  is_active: boolean;
  position: number;
}

async function readGateRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  questionId: string
): Promise<GateRow | null> {
  const { data } = await supabase
    .from("application_gate_questions")
    .select("id, question, job_id, is_active, position")
    .eq("id", questionId)
    .maybeSingle();
  return (data as unknown as GateRow | null) ?? null;
}

/** Where the question is asked — one role, or every role. */
function gateScope(jobId: string | null): string {
  return jobId ? "on one role" : "on every role";
}

function optionCount(options: unknown): number {
  return Array.isArray(options) ? options.length : 0;
}

function acceptedCount(options: unknown): number {
  return Array.isArray(options)
    ? options.filter((option) => (option as GateOption).passes === true).length
    : 0;
}

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

    const before = await readGateRow(supabase, draft.id);
    if (!before) return { ok: false, error: "That question no longer exists." };

    const { data, error } = await supabase
      .from("application_gate_questions")
      .update(columns)
      .eq("id", draft.id)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: describeWriteError(error) };
    if (!data) return { ok: false, error: "That question was deleted while you were editing it." };

    await recordActivity({
      area: "gate questions",
      action: "gate_edit",
      entity: "gate question",
      entityId: data.id,
      summary: `Rewrote the gate question “${columns.question}” — ${acceptedCount(columns.options)} of ${optionCount(columns.options)} answers let an applicant through${
        before.is_active !== columns.is_active ? `, ${columns.is_active ? "now asked" : "now switched off"}` : ""
      }`,
      detail: {
        previous_question: before.question,
        asked: gateScope(String(columns.job_id ?? "") || null),
        is_active: columns.is_active,
        position: columns.position,
      },
    });

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

  await recordActivity({
    area: "gate questions",
    action: "gate_create",
    entity: "gate question",
    entityId: data?.id ?? null,
    summary: `Added the gate question “${columns.question}” ${gateScope(String(columns.job_id ?? "") || null)}, accepted by ${acceptedCount(columns.options)} of ${optionCount(columns.options)} answers`,
    detail: {
      options: columns.options,
      is_active: columns.is_active,
      position: columns.position,
    },
  });

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
    .select("id, job_id, position, question")
    .eq("id", questionId)
    .maybeSingle();

  if (!currentRow) return { ok: false, error: "That question no longer exists." };

  const current = currentRow as unknown as {
    id: string;
    job_id: string | null;
    position: number;
    question: string;
  };

  // The same group only: a role's question is never swapped with a shared one.
  const base = supabase.from("application_gate_questions").select("id, position, question");
  const scope = current.job_id ? base.eq("job_id", current.job_id) : base.is("job_id", null);

  const { data: neighbourRows } =
    direction === "up"
      ? await scope.lt("position", current.position).order("position", { ascending: false }).limit(1)
      : await scope.gt("position", current.position).order("position", { ascending: true }).limit(1);

  const neighbour = ((neighbourRows ?? []) as unknown as {
    id: string;
    position: number;
    question: string;
  }[])[0];
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

  await recordActivity({
    area: "gate questions",
    action: "gate_reorder",
    entity: "gate question",
    entityId: questionId,
    summary: `Moved “${current.question}” ${direction} past “${neighbour.question}” on the apply form`,
    detail: {
      from_position: current.position,
      to_position: neighbour.position,
      job_id: current.job_id,
    },
  });

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

  const row = await readGateRow(guard.supabase, questionId);
  if (!row) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.supabase
    .from("application_gate_questions")
    .update({ is_active: active })
    .eq("id", questionId);

  if (error) return { ok: false, error: describeWriteError(error) };

  await recordActivity({
    area: "gate questions",
    action: "gate_active",
    entity: "gate question",
    entityId: questionId,
    summary: `${active ? "Started asking" : "Stopped asking"} the gate question “${row.question}” ${gateScope(row.job_id)}`,
    detail: { is_active: active, previous_is_active: row.is_active, job_id: row.job_id },
  });

  revalidatePath("/apply-questions");
  return { ok: true };
}

/** Removes a question. Applications already carry its answer as text. */
export async function deleteGateQuestion(questionId: string): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const row = await readGateRow(guard.supabase, questionId);
  if (!row) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.supabase
    .from("application_gate_questions")
    .delete()
    .eq("id", questionId);

  if (error) return { ok: false, error: describeWriteError(error) };

  await recordActivity({
    area: "gate questions",
    action: "gate_delete",
    entity: "gate question",
    entityId: questionId,
    summary: `Deleted the gate question “${row.question}” ${gateScope(row.job_id)} — applications already answered it keep their answer as text`,
    detail: { question: row.question, job_id: row.job_id, was_active: row.is_active },
  });

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
