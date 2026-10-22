"use server";

import { revalidatePath } from "next/cache";
import type { RestClient } from "@/lib/rest/client";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import {
  parseGateRows,
  type GateOption,
  type GateQuestion,
} from "@/modules/careers/gate-questions";
import type { QuestionConfig, QuestionType } from "@/types";
import {
  SHARED_SCOPE,
  bankGateQuestions,
  bankPlaceKey,
  type BankPlaceRow,
  type BankQuestion,
  type BankStore,
  type SuiteQuestionRow,
} from "@/modules/questions/bank";
import {
  deleteQuestion,
  saveQuestion,
  type ChoiceDraft,
  type QuestionDraft,
  type QuestionResult,
} from "@/app/(admin)/assessments/question-actions";

/**
 * The global question bank: every question the portal stores, read in one pass,
 * written by the rules that keep a candidate's form and a candidate's paper intact.
 *
 * Two tables hold authored questions — `application_gate_questions`, the no-points
 * questions on the public apply form, and `assessment_questions`, the marked
 * questions inside a test suite. This page is the console for the first and the
 * view across both, so a recruiter who wrote a good question once can find it,
 * rewrite it, reorder it, retire it and put it to work on another role or suite.
 *
 * It owns no third table, and that is the point. A bank that kept its own copies
 * would hold questions no form and no suite asks, and the recruiter would be
 * maintaining two of everything by hand; every write here goes to a real row in one
 * of the two stores, under the validation and the change trail that store already
 * has.
 *
 * Raw rows travel to the browser — including a suite question's `config`, which is
 * where its answer set, its case-study brief and a spreadsheet model's grid live.
 * That is the same payload `/assessments` already ships, and it has to be: the
 * editor this page opens is the suite's own, and an editor that could not see the
 * answer set could not edit it.
 */

const GATE_COLUMNS = "id, job_id, question, help_text, options, position, is_active";
const SUITE_COLUMNS =
  "id, template_id, question_type, title, prompt, instructions, config, points, position, time_limit_minutes, shuffle_options";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A form question turned into a quiz carries the suite table's own default mark. */
const COPIED_QUIZ_POINTS = 10;

const NOT_THERE = "That question no longer exists.";

const UNUSABLE_ANSWERS =
  "That question's answers could not be read — fewer than two of them are answers a candidate could pick.";

const NO_SINGLE_RIGHT_OPTION =
  "This question accepts more than one answer, and a quiz is scored by picking the single right option, so there is nothing here to mark correct.";

const NOT_A_CHOICE_QUESTION =
  "This asks for a written answer, a spreadsheet or a video. The apply form gates an application by which option was picked, so there is no answer here to mark as ruling someone out.";

const QUIZ_WITHOUT_ONE_RIGHT_ANSWER =
  "This quiz's answers do not leave exactly one to accept, so the apply form could not score it.";

/** A copy aimed back at the place that already asks the question. */
const ALREADY_THERE =
  "That question is already asked there, so a copy would only ask the candidate the same thing twice.";

/** Where a question is asked — one role, or every role. */
function gateScope(jobId: string | null): string {
  return jobId ? "on one role" : "on every role";
}

export interface BankData {
  /** Every apply-form question, in the order its own group is asked. */
  gate: GateQuestion[];
  /** Every suite question, with the columns its editor writes. */
  suite: SuiteQuestionRow[];
  /** Roles, suites and the shared scope — every place a question is asked. */
  places: BankPlaceRow[];
  /** Whether the recruiter may write in each store, so the board offers real writes only. */
  can: { form: boolean; suites: boolean };
}

export async function getQuestionBankData(): Promise<BankData> {
  await requireStaff("/questions");
  const restClient = await createServerRestClient();

  const [canForm, canSuites, gateResult, suiteResult, templateResult, openingResult] =
    await Promise.all([
      hasPermissionForUser("jobs.manage"),
      hasPermissionForUser("assessments.create"),
      restClient.from("application_gate_questions").select(GATE_COLUMNS).order("position"),
      restClient.from("assessment_questions").select(SUITE_COLUMNS).order("position"),
      restClient.from("assessment_templates").select("id, name, is_active").order("name"),
      // Every opening, not only the published ones: a question outlives the role it was
      // written for, and the board has to name that role rather than print a uuid.
      restClient.from("job_openings").select("id, title, status").order("title"),
    ]);

  const places: BankPlaceRow[] = [
    { key: bankPlaceKey("gate", SHARED_SCOPE), label: "Every published role", isOpen: true },
  ];

  for (const job of (openingResult.data ?? []) as {
    id: string;
    title: string;
    status: string;
  }[]) {
    places.push({
      key: bankPlaceKey("gate", job.id),
      label: job.title,
      isOpen: job.status === "PUBLISHED",
    });
  }

  for (const suite of (templateResult.data ?? []) as {
    id: string;
    name: string;
    is_active: boolean;
  }[]) {
    places.push({
      key: bankPlaceKey("suite", suite.id),
      label: suite.name,
      isOpen: suite.is_active === true,
    });
  }

  return {
    gate: parseGateRows((gateResult.data ?? []) as unknown as Record<string, unknown>[]),
    suite: ((suiteResult.data ?? []) as unknown as (SuiteQuestionRow & {
      config: QuestionConfig | null;
    })[]).map((row) => ({ ...row, config: row.config ?? {} })),
    places,
    can: { form: canForm, suites: canSuites },
  };
}

/**
 * The apply-form console's own read, for the assistant's `list_gate_questions`.
 *
 * The bank reads the same rows and needs the raw ones; the chat tool was written
 * against this shape, so it keeps it rather than learning to project.
 */
export interface GateConsoleData {
  questions: GateQuestion[];
  jobs: { id: string; title: string }[];
}

export async function getGateConsoleData(): Promise<GateConsoleData> {
  const restClient = await createServerRestClient();

  const [questions, jobs] = await Promise.all([
    restClient.from("application_gate_questions").select(GATE_COLUMNS).order("position"),
    restClient
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

/* -------------------------------------------------------------------------- */
/* Moving a question between the places a form is asked                          */
/* -------------------------------------------------------------------------- */

export interface BankPlaceRequest {
  store: BankStore;
  id: string;
  /** A job id, or `shared` for every published role. */
  placeKey: string;
}

export interface BankPlaceResult {
  ok: boolean;
  error?: string;
  /** Where it landed, printed as the notice. */
  moved?: string;
}

/**
 * Ask an apply-form question on another role, or on every role at once.
 *
 * This is the board's drop. `job_id` is a column on the question's own row, so
 * moving one between roles is a real move and nothing else changes: an application
 * already answered it in text, and the answer is scored against the questions that
 * were asked, not against a link to this row.
 *
 * A suite question is refused here. Its place is `template_id`, and re-pointing it
 * would take the question out of the paper of everyone who already sat that suite —
 * the report reads the suite as it stands now — so the board copies it instead.
 *
 * Only two ids travel. The wording is read back from the database, as every write
 * on this page does, and the row keeps everything else it holds.
 */
export async function moveBankQuestionToPlace(
  request: BankPlaceRequest
): Promise<BankPlaceResult> {
  if (request.store !== "gate") {
    return {
      ok: false,
      error:
        "A test question cannot be moved out of its suite — a candidate's saved paper is answered against the suite it was sat in. Copy it into the other suite instead.",
    };
  }

  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };
  const { restClient } = guard;

  if (!UUID_PATTERN.test(request.id)) return { ok: false, error: NOT_THERE };

  const toShared = request.placeKey === SHARED_SCOPE;
  if (!toShared && !UUID_PATTERN.test(request.placeKey)) {
    return { ok: false, error: "Choose one of the open roles, or ask it for every role." };
  }

  const current = await readGateRow(restClient, request.id);
  if (!current) return { ok: false, error: NOT_THERE };
  if ((current.job_id ?? SHARED_SCOPE) === request.placeKey) return { ok: true };

  let target = "every published role";

  // The same destination the copy refuses: a question parked on a closed role is
  // asked by nobody, so dragging one there would be a way to switch it off without
  // saying so.
  if (!toShared) {
    const place = await readFormPlace(restClient, request.placeKey);
    if (!place.ok) return { ok: false, error: place.error };
    target = `the “${place.label}” apply form`;
  }

  const { error } = await restClient
    .from("application_gate_questions")
    .update({
      job_id: toShared ? null : request.placeKey,
      // It joins at the end of the group it is now asked in, so the role's own
      // order is untouched and the question the recruiter moved is the last thing
      // an applicant answers.
      position: await nextGatePosition(restClient, toShared ? null : request.placeKey),
    })
    .eq("id", request.id);
  if (error) return { ok: false, error: describeWriteError(error) };

  await recordActivity({
    area: "gate questions",
    action: "gate_move_place",
    entity: "gate question",
    entityId: request.id,
    summary: `Moved the gate question “${current.question}” ${gateScope(current.job_id)} → ${target}`,
    detail: {
      from_job_id: current.job_id,
      to_place: toShared ? SHARED_SCOPE : request.placeKey,
      is_active: current.is_active,
    },
  });

  revalidatePath("/questions");
  return { ok: true, moved: `Now asked ${target}.` };
}


/* -------------------------------------------------------------------------- */
/* Authoring the apply form's questions                                         */
/* -------------------------------------------------------------------------- */

/**
 * The apply-form half of the bank is the whole viability-gate console.
 *
 * These writers were the `apply-questions` page's own, and they keep their rules
 * word for word: `jobs.manage` rather than a platform setting, because these
 * questions are a property of a role — who can be considered for it — so the
 * people who publish a role are the people who gate it. It is also the key the
 * storage policy on the table enforces, which is why the UI can never offer a
 * write the database would refuse.
 */

const MAX_OPTIONS = 12;

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

/** The question as the trail must name it, plus the row it belongs to. */
interface GateRow {
  question: string;
  job_id: string | null;
  is_active: boolean;
  position: number;
}

/** Staff session + `jobs.manage`, or the message explaining which is missing. */
async function requireGateEditor(): Promise<
  { restClient: Awaited<ReturnType<typeof createServerRestClient>> } | { error: string }
> {
  await requireStaff("/questions");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { error: "You need the Manage jobs permission to edit these questions." };
  }
  return { restClient: await createServerRestClient() };
}

async function readGateRow(
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  questionId: string
): Promise<GateRow | null> {
  const { data } = await restClient
    .from("application_gate_questions")
    .select("id, question, job_id, is_active, position")
    .eq("id", questionId)
    .maybeSingle();
  return (data as unknown as GateRow | null) ?? null;
}

function optionCount(options: unknown): number {
  return Array.isArray(options) ? options.length : 0;
}

function acceptedCount(options: unknown): number {
  return Array.isArray(options)
    ? options.filter((option) => (option as GateOption).passes === true).length
    : 0;
}

/** The next free place in one scope group: after the last question asked there. */
async function nextGatePosition(
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  jobId: string | null
): Promise<number> {
  const base = restClient
    .from("application_gate_questions")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);

  const { data } = jobId ? await base.eq("job_id", jobId) : await base.is("job_id", null);
  const last = (data as unknown as { position: number }[] ?? [])[0]?.position;
  return Number.isFinite(last) ? (last as number) + 1 : 0;
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
  const { restClient } = guard;

  const built = columnsFrom(draft);
  if (!built.ok) return { ok: false, error: built.error };
  const { columns } = built;

  if (draft.id) {
    if (!UUID_PATTERN.test(draft.id)) return { ok: false, error: "That question no longer exists." };

    const before = await readGateRow(restClient, draft.id);
    if (!before) return { ok: false, error: "That question no longer exists." };

    const { data, error } = await restClient
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

    revalidatePath("/questions");
    return { ok: true, id: data.id };
  }

  // A new question goes to the end of its own group, so adding one never
  // reshuffles the form a candidate is halfway through.
  const position = await nextGatePosition(
    restClient,
    draft.job_id && UUID_PATTERN.test(draft.job_id) ? draft.job_id : null
  );

  const { data, error } = await restClient
    .from("application_gate_questions")
    .insert({ ...columns, position })
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
      position,
    },
  });

  revalidatePath("/questions");
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
  const { restClient } = guard;

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const { data: currentRow } = await restClient
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
  const base = restClient.from("application_gate_questions").select("id, position, question");
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
    const { error } = await restClient
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

  revalidatePath("/questions");
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

  const row = await readGateRow(guard.restClient, questionId);
  if (!row) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.restClient
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

  revalidatePath("/questions");
  return { ok: true };
}

/** Removes a question. Applications already carry its answer as text. */
export async function deleteGateQuestion(questionId: string): Promise<GateResult> {
  const guard = await requireGateEditor();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (!UUID_PATTERN.test(questionId)) return { ok: false, error: "That question no longer exists." };

  const row = await readGateRow(guard.restClient, questionId);
  if (!row) return { ok: false, error: "That question no longer exists." };

  const { error } = await guard.restClient
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

  revalidatePath("/questions");
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

/* -------------------------------------------------------------------------- */
/* Deleting a test question, from the bank                                      */
/* -------------------------------------------------------------------------- */

/**
 * Remove a suite question through the action that owns the suite.
 *
 * That action is the one that refuses once a candidate has answered the question —
 * deleting it would leave their work pointing at nothing and quietly drop it from
 * grading — so the bank calls it rather than issuing its own delete. This only adds
 * the revalidation of the page the recruiter is standing on.
 */
export async function deleteBankSuiteQuestion(
  questionId: string,
  templateId: string
): Promise<QuestionResult> {
  await requireStaff("/questions");
  const result = await deleteQuestion(questionId, templateId);
  if (result.ok) revalidatePath("/questions");
  return result;
}

/* -------------------------------------------------------------------------- */
/* Copying one question onto another surface                                    */
/* -------------------------------------------------------------------------- */

export interface BankCopyRequest {
  /** Which store the question came from, so a uuid never has to be guessed at. */
  store: BankStore;
  id: string;
  /** Which store the copy lands in. */
  target: BankStore;
  /** A job id, `shared` for every published role, or a template id. */
  placeKey: string;
}

export interface BankCopyResult {
  ok: boolean;
  error?: string;
  /**
   * What landed, and where.
   *
   * Printed as the notice, because a copy that answers only "saved" leaves a
   * recruiter hunting through the board for the row they just made.
   */
  landed?: string;
}

/** A destination the portal will actually use, or the sentence explaining why not. */
type Place = { ok: true; label: string } | { ok: false; error: string };

/**
 * Copy a question onto another role's apply form, or into another test suite.
 *
 * The client sends four ids and no wording at all. Every word of the copy is read
 * back out of the database here, so a board that has been open since a colleague
 * edited the question cannot write the stale text, and what the recruiter read on
 * the row is what lands.
 *
 * The write then goes to whichever action owns the destination —
 * `saveGateQuestion` or `saveQuestion` — rather than to an insert of my own. Those
 * two carry the permission check, the field validation, the change-trail row and
 * the revalidation of their own console; a bank that wrote its own row would need a
 * second copy of all four, which is how a copy starts passing checks the real
 * console would have failed.
 */
export async function copyBankQuestion(request: BankCopyRequest): Promise<BankCopyResult> {
  await requireStaff("/questions");

  if (!UUID_PATTERN.test(request.id)) return { ok: false, error: NOT_THERE };

  const restClient = await createServerRestClient();
  const toForm = request.target === "gate";

  const place: Place = toForm
    ? request.placeKey === SHARED_SCOPE
      ? { ok: true, label: "every published role" }
      : await readFormPlace(restClient, request.placeKey)
    : await readSuitePlace(restClient, request.placeKey);
  if (!place.ok) return { ok: false, error: place.error };

  const formScope =
    request.placeKey === SHARED_SCOPE
      ? "every published role"
      : `the “${place.label}” apply form`;

  if (request.store === "gate") {
    const source = await readGateSource(restClient, request.id);
    if (!source.ok) return { ok: false, error: source.error };

    if (!toForm) {
      if (source.question.acceptedCount !== 1) return { ok: false, error: NO_SINGLE_RIGHT_OPTION };
      return ontoSuiteFromForm(source.question, restClient, request.placeKey, place.label);
    }
    if ((source.jobId ?? SHARED_SCOPE) === request.placeKey) {
      return { ok: false, error: ALREADY_THERE };
    }
    return ontoForm(source.question, request.placeKey, formScope);
  }

  const source = await readSuiteSource(restClient, request.id);
  if (!source.ok) return { ok: false, error: source.error };

  if (toForm) return ontoFormFromQuiz(source.row, request.placeKey, formScope);
  if (source.row.template_id === request.placeKey) return { ok: false, error: ALREADY_THERE };
  return ontoSuiteFromSuite(source.row, restClient, request.placeKey, place.label);
}

/** A role the copy can land on: it has to exist and be published, or nobody would be asked it. */
async function readFormPlace(restClient: RestClient, jobId: string): Promise<Place> {
  if (!UUID_PATTERN.test(jobId)) {
    return { ok: false, error: "Choose one of the open roles, or ask it for every role." };
  }

  const { data } = await restClient
    .from("job_openings")
    .select("id, title, status")
    .eq("id", jobId)
    .maybeSingle();

  const job = data as { title: string; status: string } | null;
  if (!job) return { ok: false, error: "That role no longer exists — pick one of the current openings." };
  if (job.status !== "PUBLISHED") {
    return {
      ok: false,
      error: `“${job.title}” is not published, so nobody would be asked the copy. Publish the role first, or pick another one.`,
    };
  }
  return { ok: true, label: job.title };
}

/** A suite the copy can land in: it has to exist and not be paused, or no candidate could sit it. */
async function readSuitePlace(restClient: RestClient, templateId: string): Promise<Place> {
  if (!UUID_PATTERN.test(templateId)) {
    return { ok: false, error: "Choose the suite to copy it into." };
  }

  const { data } = await restClient
    .from("assessment_templates")
    .select("id, name, is_active")
    .eq("id", templateId)
    .maybeSingle();

  const suite = data as { name: string; is_active: boolean } | null;
  if (!suite) return { ok: false, error: "That assessment suite no longer exists." };
  if (!suite.is_active) {
    return {
      ok: false,
      error: `“${suite.name}” is paused, so no new candidate could sit the copy. Resume the suite first, or pick another one.`,
    };
  }
  return { ok: true, label: suite.name };
}

async function readGateSource(
  restClient: RestClient,
  id: string
): Promise<
  { ok: true; question: BankQuestion; jobId: string | null } | { ok: false; error: string }
> {
  const { data } = await restClient
    .from("application_gate_questions")
    .select(GATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, error: NOT_THERE };

  // The place is not projected here: the copy needs the question's own wording and
  // answer set, and which role asks it is decided by the destination just read.
  const [question] = bankGateQuestions(
    parseGateRows([data] as unknown as Record<string, unknown>[]),
    () => null
  );
  if (!question) return { ok: false, error: UNUSABLE_ANSWERS };

  return { ok: true, question, jobId: (data as unknown as { job_id: string | null }).job_id };
}

/** A stored suite question, with the `config` the browser never sees. */
interface SuiteSourceRow {
  id: string;
  template_id: string;
  question_type: QuestionType;
  title: string;
  prompt: string;
  instructions: string | null;
  config: QuestionConfig | null;
  points: number;
  time_limit_minutes: number | null;
  shuffle_options: boolean;
}

async function readSuiteSource(
  restClient: RestClient,
  id: string
): Promise<{ ok: true; row: SuiteSourceRow } | { ok: false; error: string }> {
  const { data } = await restClient
    .from("assessment_questions")
    .select(SUITE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, error: NOT_THERE };
  return { ok: true, row: data as unknown as SuiteSourceRow };
}

/** Where the next question of a suite lands: at the end, after whatever is there now. */
async function nextPosition(restClient: RestClient, templateId: string): Promise<number> {
  const { count } = await restClient
    .from("assessment_questions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);
  return count ?? 0;
}

/** A quiz's answer set, in the suite editor's own draft shape. */
function choiceDrafts(config: QuestionConfig | null): ChoiceDraft[] {
  return (config?.options ?? []).map((option) => ({
    text: option.text,
    is_correct: option.is_correct,
  }));
}

async function resultOf(
  write: { ok: boolean; error?: string },
  landed: string
): Promise<BankCopyResult> {
  if (!write.ok) return { ok: false, error: write.error ?? "The copy could not be saved." };
  revalidatePath("/questions");
  return { ok: true, landed };
}

const EMPTY_QUESTION_DRAFT: QuestionDraft = {
  id: null,
  template_id: "",
  question_type: "MULTIPLE_CHOICE",
  title: "",
  prompt: "",
  instructions: "",
  points: COPIED_QUIZ_POINTS,
  position: 0,
  time_limit_minutes: null,
  shuffle_options: false,
  options: [],
  context: "",
  min_words: null,
  min_duration_seconds: null,
  max_duration_seconds: null,
  preserve_config: null,
};

/* ---- the four mappings ---- */

/** Apply form → apply form: the same words, the same answers, another role. */
async function ontoForm(
  source: BankQuestion,
  placeKey: string,
  scopeWords: string
): Promise<BankCopyResult> {
  const draft: GateDraft = {
    id: null,
    job_id: placeKey === SHARED_SCOPE ? null : placeKey,
    question: source.text,
    help_text: source.guidance,
    options: source.answers.map((answer) => ({ label: answer.text, passes: answer.accepted })),
    // A copy arrives switched on: the reason for copying it was to start asking it.
    is_active: true,
    position: 0,
  };
  return resultOf(await saveGateQuestion(draft), `Copied onto ${scopeWords}.`);
}

/** Apply form → suite: the one accepted answer becomes the one right option. */
async function ontoSuiteFromForm(
  source: BankQuestion,
  restClient: RestClient,
  templateId: string,
  suiteLabel: string
): Promise<BankCopyResult> {
  const draft: QuestionDraft = {
    ...EMPTY_QUESTION_DRAFT,
    template_id: templateId,
    question_type: "MULTIPLE_CHOICE",
    title: source.text,
    prompt: source.text,
    instructions: source.guidance,
    points: COPIED_QUIZ_POINTS,
    position: await nextPosition(restClient, templateId),
    options: source.answers.map((answer) => ({ text: answer.text, is_correct: answer.accepted })),
  };

  return resultOf(
    await saveQuestion(draft),
    `Copied into “${suiteLabel}” as a quiz question worth ${COPIED_QUIZ_POINTS} marks.`
  );
}

/** Suite → suite: the same kind, marks, guidance and answer set, another suite. */
async function ontoSuiteFromSuite(
  row: SuiteSourceRow,
  restClient: RestClient,
  templateId: string,
  suiteLabel: string
): Promise<BankCopyResult> {
  const config = row.config ?? {};
  const draft: QuestionDraft = {
    ...EMPTY_QUESTION_DRAFT,
    template_id: templateId,
    question_type: row.question_type,
    title: row.title,
    prompt: row.prompt,
    instructions: row.instructions ?? "",
    points: row.points,
    position: await nextPosition(restClient, templateId),
    time_limit_minutes: row.time_limit_minutes,
    shuffle_options: row.shuffle_options,
    options: choiceDrafts(row.config),
    context: config.context ?? "",
    min_words: config.min_words ?? null,
    min_duration_seconds: config.min_duration_seconds ?? null,
    max_duration_seconds: config.max_duration_seconds ?? null,
    // The editor cannot represent an initial spreadsheet grid or its expected outputs,
    // so the bytes travel through and `buildConfig` hands them straight back.
    preserve_config: config,
  };

  return resultOf(
    await saveQuestion(draft),
    `Copied into “${suiteLabel}” with the same answers and the same ${row.points} marks.`
  );
}

/** Quiz → apply form: the right option becomes the answer that keeps an application in the running. */
async function ontoFormFromQuiz(
  row: SuiteSourceRow,
  placeKey: string,
  scopeWords: string
): Promise<BankCopyResult> {
  if (row.question_type !== "MULTIPLE_CHOICE") {
    return { ok: false, error: NOT_A_CHOICE_QUESTION };
  }

  const options = choiceDrafts(row.config);
  if (options.filter((option) => option.is_correct).length !== 1) {
    return { ok: false, error: QUIZ_WITHOUT_ONE_RIGHT_ANSWER };
  }

  const draft: GateDraft = {
    id: null,
    job_id: placeKey === SHARED_SCOPE ? null : placeKey,
    question: row.prompt,
    help_text: row.instructions ?? "",
    options: options.map((option) => ({ label: option.text, passes: option.is_correct })),
    is_active: true,
    position: 0,
  };

  return resultOf(await saveGateQuestion(draft), `Copied onto ${scopeWords}.`);
}
