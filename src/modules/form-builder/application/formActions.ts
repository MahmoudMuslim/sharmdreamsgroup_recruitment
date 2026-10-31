"use server";

/**
 * Every read and write the two `/forms` pages make (spec §6, plan Task 8): the
 * board at `/forms` and one form's page at `/forms/[id]`.
 *
 * The rules live in the domain modules and this file only moves rows: `draftIssues`
 * refuses a layout before it is written, `resolveLayout` composes what an opening
 * would actually ask, and `identityIssues` decides whether that composition may be
 * published. A second copy of any of those checks here would be a second answer to
 * the same question, and the first form that drifts is the one that stops asking
 * for a CV.
 *
 * A layout save is **not** one transaction — PostgREST exposes no multi-statement
 * write. It is an optimistic version claim followed by an upsert of the whole set
 * and a delete of the keys that left, which is why the claim happens first: two
 * recruiters saving at once cannot both win, and the loser is told the version on
 * screen rather than silently overwriting the winner. A failure after the claim
 * is reported as a partial write, in those words, because pretending the two
 * halves moved together would be the one lie this screen cannot afford.
 *
 * `application_form_files` is not touched here; the ledger is written by the
 * public upload door and read by erasure. The retention sweep's orphan pass is
 * the only place an unclaimed row is removed.
 */

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth/session";
import { hasAiProvider } from "@/lib/config.server";
import { createServerRestClient } from "@/lib/data-api/server";
import { readOpeningTitleAndStatus } from "@/infrastructure/repositories/jobOpening";
import { recordActivity, withActivityContext } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  draftFormFields,
  reviewNote,
  type FormDraftReview,
} from "@/modules/form-builder/infrastructure/formAuthoring";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import {
  draftIssues,
  type FieldDraft,
  type DraftIssue,
} from "@/modules/form-builder/domain/draftIssues";
import {
  identityIssues,
  type IdentityIssue,
} from "@/modules/form-builder/domain/identityIssues";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import { copyName, nameProblem } from "@/modules/form-builder/domain/formNaming";
import {
  tallyFormUsage,
  USAGE_APPLICATIONS,
  type FormUsage,
  type UsageRow,
} from "@/modules/form-builder/domain/formUsage";
import { parseSnapshot } from "@/modules/form-builder/domain/snapshot";
import {
  resolveLayout,
  type AssignmentRow,
  type FieldRow,
  type FormRow,
  type LayoutViolation,
} from "@/modules/form-builder/domain/resolveLayout";
import type { FieldType } from "@/modules/form-builder/domain/field-types";

/** The console's row for one form, without its fields. */
export interface FormSummary {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  status: "DRAFT" | "PUBLISHED";
  version: number;
  globalPosition: number;
  fieldCount: number;
  /** The openings that ask it; always empty for a global form. */
  assignedJobs: { id: string; title: string; status: string }[];
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * The usage figures one board or editor read carries.
 *
 * `basis` is the answer the screen has to print: `"view"` means `045_form_usage.sql`
 * is applied and the numbers are exact aggregates over every application; `"read"`
 * means the view is absent and they are a count over the newest bounded window,
 * whose `capped` flag turns every figure into a floor rather than a total.
 */
export interface FormUsageRead {
  basis: "view" | "read";
  /** How many rows the figures were counted from — forms for the view, applications for the read. */
  read: number;
  capped: boolean;
  byForm: Record<string, FormUsage>;
}

/** The board's read (`/forms`): every form and the openings one may be assigned to. */
export interface FormsBoardData {
  /** False on a database where `044_application_forms.sql` has never run, or if the read failed; `note` says which. */
  available: boolean;
  note?: string;
  canWrite: boolean;
  forms: FormSummary[];
  jobs: { id: string; title: string; status: string }[];
  /** True when the forms read filled its window, so the board says what it left out. */
  formsAtCap: boolean;
  /** True when the openings read filled its window, which also bounds the assignment labels. */
  jobsAtCap: boolean;
  /** `null` when the usage read itself failed; the board still draws without it. */
  usage: FormUsageRead | null;
  /** Why `usage` is null, in the console's own words. */
  usageNote: string | null;
}

/** The editor page's read (`/forms/[id]`): this one form, its layout, and the openings. */
export interface FormsEditorData {
  available: boolean;
  note?: string;
  canWrite: boolean;
  /** `null` when the id names no form here, which is the page's own 404. */
  form: FormSummary | null;
  fields: FieldDraft[];
  jobs: { id: string; title: string; status: string }[];
  usage: FormUsageRead | null;
  usageNote: string | null;
}

/** What the editor component is handed: the read with the page's two questions —
 *  the tables that are not here and the row that is not here — already answered. */
export interface FormEditorProps {
  canWrite: boolean;
  form: FormSummary;
  fields: FieldDraft[];
  jobs: FormsEditorData["jobs"];
  usage: FormsEditorData["usage"];
  usageNote: FormsEditorData["usageNote"];
}

export interface FormMutation {
  ok: boolean;
  error?: string;
  /** Every refusal in one save, so the console can print them as a list. */
  issues?: string[];
  /** The version the form now carries after a save or publish. */
  version?: number;
  id?: string;
  /** What was drafted or refused, in the console's own words, after an AI run. */
  note?: string;
}

const FORM_COLUMNS =
  "id, name, description, is_global, status, version, global_position, archived_at, updated_at";
const FIELD_COLUMNS =
  "id, form_id, key, type, label, help_text, placeholder, required, config, system_key, position";
const COMPOSITION_FORM_COLUMNS =
  "id, name, is_global, global_position, status, archived_at, version";

/** One page of forms the console lists; the plan bounds the read at 200. */
const FORM_LIST_LIMIT = 200;
/** One console read of the openings a form may be assigned to. */
const JOB_LIST_LIMIT = 500;

const MISSING_TABLES =
  "The form tables are not on this database yet (migration 044_application_forms.sql). Nothing was written and nothing was read.";

const NOT_THERE = "That form no longer exists.";
const RETIRED = "That form is retired, so it can no longer be edited or assigned.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Client = Awaited<ReturnType<typeof createServerRestClient>>;

interface FormDbRow {
  id: string;
  name: string;
  description: string | null;
  is_global: boolean;
  status: "DRAFT" | "PUBLISHED";
  version: number;
  global_position: number;
  archived_at: string | null;
  updated_at: string;
}

interface FieldDbRow {
  id: string;
  form_id: string;
  key: string;
  type: string;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  required: boolean;
  config: Record<string, unknown> | null;
  system_key: string | null;
  position: number;
}

interface AssignmentDbRow {
  job_id: string;
  form_id: string;
  position: number;
}

function toFormRow(row: FormDbRow): FormRow {
  return {
    id: row.id,
    name: row.name,
    isGlobal: row.is_global,
    globalPosition: row.global_position,
    status: row.status,
    archivedAt: row.archived_at,
    version: row.version,
  };
}

function toFieldRow(row: FieldDbRow): FieldRow {
  return {
    id: row.id,
    formId: row.form_id,
    key: row.key,
    type: row.type as FieldType,
    label: row.label,
    helpText: row.help_text,
    placeholder: row.placeholder,
    required: row.required,
    config: row.config ?? {},
    systemKey: row.system_key,
    position: row.position,
  };
}

function toDraft(row: FieldDbRow): FieldDraft {
  return {
    key: row.key,
    type: row.type as FieldType,
    label: row.label,
    helpText: row.help_text,
    placeholder: row.placeholder,
    required: row.required,
    config: row.config ?? {},
    systemKey: row.system_key,
  };
}

function refusal(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error) ? MISSING_TABLES : error.message ?? "The write did not land.";
}

/**
 * Both `/forms` pages read the rows a write here changes — the board's list and the
 * form's own page — so both are invalidated together. A literal path covers the
 * board; the dynamic pattern with `"page"` covers every form's page, because
 * `revalidatePath("/forms")` alone reaches only that one page.
 */
function revalidateForms() {
  revalidatePath("/forms");
  revalidatePath("/forms/[id]", "page");
}

async function formEditor(): Promise<
  { ok: true; client: Client } | { ok: false; error: string }
> {
  await requireStaff("/forms");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return {
      ok: false,
      error: "You need the Manage jobs permission to build application forms.",
    };
  }
  const client = await createServerRestClient();
  // Probe before a specific row is read: on a database without 044 every
  // `readForm` answers "no such row", which would turn an unapplied migration
  // into "that form no longer exists" at every door.
  const probe = await client.from("application_forms").select("id", { head: true }).limit(1);
  if (probe.error) return { ok: false, error: refusal(probe.error) };
  return { ok: true, client };
}

async function readForm(client: Client, formId: string): Promise<FormDbRow | null> {
  const { data } = await client
    .from("application_forms")
    .select(FORM_COLUMNS)
    .eq("id", formId)
    .maybeSingle();
  return (data as unknown as FormDbRow | null) ?? null;
}

async function nextGlobalPosition(client: Client): Promise<number> {
  const { data } = await client
    .from("application_forms")
    .select("global_position")
    .eq("is_global", true)
    .order("global_position", { ascending: false })
    .limit(1);
  const last = (data as unknown as { global_position: number }[] | null)?.[0]?.global_position;
  return Number.isFinite(last) ? (last as number) + 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* The two reads the two pages make                                             */
/* -------------------------------------------------------------------------- */

interface FormUsageViewRow {
  form_id: string;
  applications: number | string;
  latest_at: string | null;
}

/**
 * How many applications named each form — the board's usage figures.
 *
 * Two reads, one answer. On a database where `db/migrations/045_form_usage.sql` has
 * been run the view aggregates the whole table, so the figures are exact within the
 * reader's own row policies and the board says "usage view (migration 045)". On a
 * database where that file has never run the read falls back to the newest
 * `USAGE_APPLICATIONS` applications and counts what their snapshots recorded; every
 * figure is then a **floor, not a total**, and the board prints the ceiling it
 * counted from.
 *
 * Only a missing schema falls through: a view that exists and refuses is a real
 * error, and answering it with a different number would hide the refusal. A failed
 * usage read never fails the board — `usage: null` and a `usageNote` say so while
 * the forms themselves still draw.
 *
 * The snapshot is the source of truth for both halves: a form is counted because
 * an application filed against it, not because an opening asks it today.
 */
async function readFormUsage(
  client: Client,
): Promise<{ usage: FormUsageRead | null; note: string | null }> {
  const viewRead = await client
    .from("form_usage")
    .select("form_id, applications, latest_at")
    .limit(FORM_LIST_LIMIT);

  if (!viewRead.error) {
    const byForm: Record<string, FormUsage> = {};
    for (const row of (viewRead.data ?? []) as FormUsageViewRow[]) {
      const applications = Number(row.applications);
      byForm[row.form_id] = {
        applications: Number.isFinite(applications) ? applications : 0,
        latestAt: row.latest_at,
      };
    }
    return {
      usage: { basis: "view", read: Object.keys(byForm).length, capped: false, byForm },
      note: null,
    };
  }

  if (!isMissingSchemaError(viewRead.error)) {
    return {
      usage: null,
      note: `The usage view could not be read: ${viewRead.error.message}. The forms below are unaffected.`,
    };
  }

  const applicationRead = await client
    .from("applications")
    .select("form_answers, created_at")
    .order("created_at", { ascending: false })
    .limit(USAGE_APPLICATIONS);

  if (applicationRead.error) {
    return {
      usage: null,
      note: `The applications could not be read, so no usage figure is drawn: ${applicationRead.error.message}`,
    };
  }

  const rows: UsageRow[] = (
    (applicationRead.data ?? []) as { form_answers: unknown; created_at: string | null }[]
  ).map((row) => ({
    formIds: parseSnapshot(row.form_answers)?.forms.map((form) => form.id) ?? [],
    createdAt: row.created_at,
  }));
  const tally = tallyFormUsage(rows);

  return {
    usage: { basis: "read", read: tally.read, capped: tally.capped, byForm: tally.byForm },
    note: null,
  };
}

/**
 * The board (`/forms`): every form with its field count and the openings that ask
 * it, plus the openings a form may be assigned to.
 *
 * No layout is read here — the counts come from a projection of `form_id` alone,
 * so a board of two hundred forms does not ship two hundred sets of labels to a
 * browser that shows one of them. Both reads are bounded: 200 forms, the
 * projection at the whole-estate ceiling (200 forms × 40 fields), 500 openings.
 */
export async function listForms(): Promise<FormsBoardData> {
  await requireStaff("/forms");
  const client = await createServerRestClient();
  const canWrite = await hasPermissionForUser("jobs.manage");

  const [formsResult, countResult, assignmentsResult, jobsResult, usageRead] = await Promise.all([
    client
      .from("application_forms")
      .select(FORM_COLUMNS)
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("is_global", { ascending: false })
      .order("global_position", { ascending: true })
      .order("name", { ascending: true })
      .limit(FORM_LIST_LIMIT),
    client
      .from("application_form_fields")
      .select("form_id")
      .limit(FORM_LIST_LIMIT * LIMITS.fields_per_form),
    client
      .from("job_application_forms")
      .select("job_id, form_id, position")
      .limit(FORM_LIST_LIMIT * LIMITS.forms_assigned_per_opening),
    client
      .from("job_openings")
      .select("id, title, status")
      .order("title", { ascending: true })
      .limit(JOB_LIST_LIMIT),
    readFormUsage(client),
  ]);

  if (formsResult.error && isMissingSchemaError(formsResult.error)) {
    return {
      available: false,
      note: MISSING_TABLES,
      canWrite,
      forms: [],
      jobs: [],
      formsAtCap: false,
      jobsAtCap: false,
      usage: null,
      usageNote: null,
    };
  }
  if (formsResult.error) {
    return {
      available: false,
      note: `The form list could not be read: ${formsResult.error.message}. Nothing was written.`,
      canWrite,
      forms: [],
      jobs: [],
      formsAtCap: false,
      jobsAtCap: false,
      usage: null,
      usageNote: null,
    };
  }

  const formRows = (formsResult.data ?? []) as FormDbRow[];
  const fieldCounts = new Map<string, number>();
  for (const row of (countResult.data ?? []) as { form_id: string }[]) {
    fieldCounts.set(row.form_id, (fieldCounts.get(row.form_id) ?? 0) + 1);
  }

  const jobs = (jobsResult.data ?? []) as { id: string; title: string; status: string }[];
  const jobById = new Map(jobs.map((job) => [job.id, job]));

  const assignedByForm = new Map<string, { id: string; title: string; status: string }[]>();
  for (const row of (assignmentsResult.data ?? []) as AssignmentDbRow[]) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    const list = assignedByForm.get(row.form_id) ?? [];
    list.push(job);
    assignedByForm.set(row.form_id, list);
  }

  const forms: FormSummary[] = formRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isGlobal: row.is_global,
    status: row.status,
    version: row.version,
    globalPosition: row.global_position,
    fieldCount: fieldCounts.get(row.id) ?? 0,
    assignedJobs: (assignedByForm.get(row.id) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }));

  return {
    available: true,
    canWrite,
    forms,
    jobs,
    formsAtCap: formRows.length >= FORM_LIST_LIMIT,
    jobsAtCap: jobs.length >= JOB_LIST_LIMIT,
    usage: usageRead.usage,
    usageNote: usageRead.note,
  };
}

/**
 * One form's own page (`/forms/[id]`): its row, its fields in authored order and
 * the openings it is asked on — nothing about any other form.
 *
 * `jobs` is the whole bounded opening list rather than this form's assignments,
 * because the assign picker has to offer what the form is *not* on. A retired form
 * reads the same as a live one: its layout stays on screen, the write doors are the
 * ones that refuse.
 */
export async function formEditorData(formId: string): Promise<FormsEditorData> {
  await requireStaff("/forms");
  const client = await createServerRestClient();
  const canWrite = await hasPermissionForUser("jobs.manage");

  const [formResult, fieldsResult, assignmentsResult, jobsResult, usageRead] = await Promise.all([
    client.from("application_forms").select(FORM_COLUMNS).eq("id", formId).maybeSingle(),
    client
      .from("application_form_fields")
      .select(FIELD_COLUMNS)
      .eq("form_id", formId)
      .order("position", { ascending: true })
      .order("key", { ascending: true }),
    client.from("job_application_forms").select("job_id, form_id, position").eq("form_id", formId),
    client
      .from("job_openings")
      .select("id, title, status")
      .order("title", { ascending: true })
      .limit(JOB_LIST_LIMIT),
    readFormUsage(client),
  ]);

  if (formResult.error && isMissingSchemaError(formResult.error)) {
    return {
      available: false,
      note: MISSING_TABLES,
      canWrite,
      form: null,
      fields: [],
      jobs: [],
      usage: null,
      usageNote: null,
    };
  }
  if (formResult.error) {
    return {
      available: false,
      note: `This form could not be read: ${formResult.error.message}. Nothing was written.`,
      canWrite,
      form: null,
      fields: [],
      jobs: [],
      usage: null,
      usageNote: null,
    };
  }

  const row = formResult.data as unknown as FormDbRow | null;
  if (!row) {
    return {
      available: true,
      canWrite,
      form: null,
      fields: [],
      jobs: [],
      usage: null,
      usageNote: null,
    };
  }

  const jobs = (jobsResult.data ?? []) as { id: string; title: string; status: string }[];
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const assignedJobs = ((assignmentsResult.data ?? []) as AssignmentDbRow[])
    .map((entry) => jobById.get(entry.job_id))
    .filter((job): job is { id: string; title: string; status: string } => Boolean(job))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    available: true,
    canWrite,
    form: {
      id: row.id,
      name: row.name,
      description: row.description,
      isGlobal: row.is_global,
      status: row.status,
      version: row.version,
      globalPosition: row.global_position,
      fieldCount: ((fieldsResult.data ?? []) as FieldDbRow[]).length,
      assignedJobs,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    },
    fields: ((fieldsResult.data ?? []) as FieldDbRow[]).map(toDraft),
    jobs,
    usage: usageRead.usage,
    usageNote: usageRead.note,
  };
}

/* -------------------------------------------------------------------------- */
/* Creating and describing a form                                               */
/* -------------------------------------------------------------------------- */

export async function createForm(input: {
  name: string;
  description: string | null;
  isGlobal: boolean;
}): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  const name = input.name.trim();
  const naming = nameProblem(name);
  if (naming) return { ok: false, error: naming };
  const description = (input.description ?? "").trim();
  if (description.length > 2000) {
    return { ok: false, error: "A form's description is 2,000 characters or fewer." };
  }

  const { data, error } = await client
    .from("application_forms")
    .insert({
      name,
      description: description || null,
      is_global: input.isGlobal === true,
      global_position: input.isGlobal ? await nextGlobalPosition(client) : 0,
    })
    .select("id, version")
    .single();

  if (error) return { ok: false, error: refusal(error) };
  const created = data as unknown as { id: string; version: number };

  await recordActivity({
    area: "forms",
    action: "form_create",
    entity: "application form",
    entityId: created.id,
    summary: `Created the application form “${name}”, ${
      input.isGlobal ? "asked on every open role" : "assigned to openings by hand"
    }`,
    detail: { is_global: input.isGlobal === true, version: created.version },
  });

  revalidateForms();
  return { ok: true, id: created.id, version: created.version };
}

/**
 * Copy a form: its name with the copy's suffix, its questions in their order, and
 * nothing else.
 *
 * The copy is a DRAFT that no opening asks — `is_global: false` and no row written
 * to `job_application_forms` — because a duplicate that arrives already hiring puts
 * a second set of questions in front of every applicant the original was assigned
 * to, before anyone has read the difference between them. The fields go through
 * `layoutRows`, the builder a save uses, so the width, the candidate binding and
 * the order of every question carry rather than being re-derived.
 *
 * The keys carry too, which is what makes a copy assigned beside its original a
 * Publish refusal rather than a special case here: `resolveLayout` is the one
 * composition authority and two forms holding one key is its call, not this
 * function's. A copy whose fields failed to store is reported as the partial write
 * it is — the form row is real, editable, and says what it is missing.
 */
export async function duplicateForm(formId: string): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(formId)) return { ok: false, error: NOT_THERE };
  const before = await readForm(client, formId);
  if (!before) return { ok: false, error: NOT_THERE };
  if (before.archived_at) return { ok: false, error: RETIRED };

  const name = copyName(before.name);
  const naming = nameProblem(name);
  if (naming) return { ok: false, error: naming };

  const { data: fieldRows } = await client
    .from("application_form_fields")
    .select(FIELD_COLUMNS)
    .eq("form_id", formId)
    .order("position", { ascending: true })
    .order("key", { ascending: true });
  const drafts = ((fieldRows ?? []) as FieldDbRow[]).map(toDraft);

  const { data, error } = await client
    .from("application_forms")
    .insert({
      name,
      description: before.description,
      is_global: false,
      global_position: 0,
    })
    .select("id, version")
    .single();
  if (error) return { ok: false, error: refusal(error) };
  const copy = data as unknown as { id: string; version: number };

  let incomplete: string | null = null;
  if (drafts.length > 0) {
    const { error: fieldsError } = await client
      .from("application_form_fields")
      .insert(layoutRows(copy.id, drafts));
    if (fieldsError) {
      incomplete = refusal(fieldsError);
    }
  }

  const count = `${drafts.length} question${drafts.length === 1 ? "" : "s"}`;
  await recordActivity({
    area: "forms",
    action: "form_duplicate",
    entity: "application form",
    entityId: copy.id,
    summary: incomplete
      ? `Copied “${before.name}” to “${name}”, but its ${count} did not store — ${incomplete}`
      : `Copied the application form “${before.name}” to “${name}” with ${count}, asked on no opening yet`,
    detail: {
      source_id: formId,
      source_name: before.name,
      source_version: before.version,
      source_is_global: before.is_global,
      fields: drafts.length,
      incomplete,
      version: copy.version,
    },
  });

  revalidateForms();
  return {
    ok: true,
    id: copy.id,
    version: copy.version,
    note: incomplete
      ? `“${name}” exists, but its ${count} did not store (${incomplete}). Open it and save the layout again.`
      : `“${name}” is a draft with ${count}, asked on no opening yet.`,
  };
}

/**
 * Draft a form's questions from a recruiter's brief, and store them as a DRAFT.
 *
 * The model is the only untrusted quarter here: it is handed a brief, and
 * `formAuthoring` judges everything it offers through `draftIssues` before it
 * reaches this function. What this function adds is the write — a new form with
 * the system fields pre-placed, left DRAFT and unassigned, so publishing stays
 * the human door spec §7 relies on.
 *
 * Both writes carry the AI context, so the trail says a model drafted the
 * questions and names the recruiter it drafted them for; the publish that
 * follows is a person's own act. A refusal with nothing kept creates no form at
 * all — an empty draft on the list would be a question nobody asked.
 */
export async function draftWithAI(input: {
  name: string;
  description: string | null;
  isGlobal: boolean;
  prompt: string;
}): Promise<FormMutation> {
  const staff = await requireStaff("/forms");
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!hasAiProvider()) {
    return { ok: false, error: "No AI provider key is configured, so nothing can be drafted." };
  }

  const prompt = (input.prompt ?? "").trim();
  if (prompt.length < 20) {
    return {
      ok: false,
      error: "Describe the role and what the form should ask — at least 20 characters.",
    };
  }

  let review: FormDraftReview;
  try {
    review = await draftFormFields(prompt);
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "The model did not return any questions.",
    };
  }

  if (review.kept === 0) {
    return {
      ok: false,
      error: review.dropped[0] ?? "The model returned no questions.",
      issues: review.dropped,
    };
  }

  const written = await withActivityContext(
    {
      actorKind: "AI",
      actorLabel: "AI form drafting",
      actorId: staff.profileId,
      companyId: staff.tenantId,
      via: "console",
    },
    async (): Promise<FormMutation> => {
      const form = await createForm({
        name: input.name,
        description: input.description,
        isGlobal: input.isGlobal,
      });
      if (!form.ok || !form.id || form.version === undefined) return form;

      const layout = await saveFormLayout(form.id, review.fields, form.version);
      if (!layout.ok) {
        // The form exists empty. Saying so is the only way the recruiter can
        // find it: a silent failure would leave a nameless draft on the list.
        return {
          ok: false,
          error: `The draft form was created, but its questions did not store: ${
            layout.error ?? "the save did not land."
          } Open it from the list and save again, or retire it.`,
          issues: layout.issues,
          id: form.id,
          version: form.version,
        };
      }
      return { ok: true, id: form.id, version: layout.version };
    },
  );

  if (!written.ok) return written;

  return {
    ...written,
    issues: review.dropped.length > 0 ? review.dropped : undefined,
    note: reviewNote(review),
  };
}

/** Name, description and scope. A layout change is `saveFormLayout`'s write. */
export async function saveFormMeta(
  formId: string,
  input: { name: string; description: string | null; isGlobal: boolean },
): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(formId)) return { ok: false, error: NOT_THERE };
  const before = await readForm(client, formId);
  if (!before) return { ok: false, error: NOT_THERE };
  if (before.archived_at) return { ok: false, error: RETIRED };

  const name = input.name.trim();
  const naming = nameProblem(name);
  if (naming) return { ok: false, error: naming };
  const description = (input.description ?? "").trim();
  if (description.length > 2000) {
    return { ok: false, error: "A form's description is 2,000 characters or fewer." };
  }

  const isGlobal = input.isGlobal === true;
  const { error } = await client
    .from("application_forms")
    .update({
      name,
      description: description || null,
      is_global: isGlobal,
      // A form that becomes global joins the end of the global order rather than
      // stealing a place it never held; a form that stops being global keeps the
      // number, which nobody reads for a non-global form.
      ...(isGlobal && !before.is_global
        ? { global_position: await nextGlobalPosition(client) }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", formId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: refusal(error) };

  await recordActivity({
    area: "forms",
    action: "form_edit",
    entity: "application form",
    entityId: formId,
    summary: `Updated the application form “${name}”${
      before.is_global !== isGlobal
        ? isGlobal
          ? " — now asked on every open role"
          : " — now asked only where it is assigned"
        : ""
    }`,
    detail: {
      previous_name: before.name,
      was_global: before.is_global,
      is_global: isGlobal,
      version: before.version,
    },
  });

  revalidateForms();
  return { ok: true, version: before.version };
}

/* -------------------------------------------------------------------------- */
/* The layout                                                                   */
/* -------------------------------------------------------------------------- */

function layoutRows(formId: string, fields: readonly FieldDraft[]) {
  return fields.map((field, position) => ({
    form_id: formId,
    key: field.key.trim(),
    type: field.type,
    label: field.label.trim(),
    help_text: field.helpText?.trim() || null,
    placeholder: field.placeholder?.trim() || null,
    required: field.required === true,
    config: field.config ?? {},
    system_key: field.systemKey || null,
    position,
  }));
}

/**
 * Replace the whole ordered field set, at the version the editor was opened on.
 *
 * The claim happens before any field is written, so a stale editor can never
 * interleave its rows with a colleague's. `expectedVersion` is the value the
 * console printed; a save that loses names both numbers rather than guessing
 * which one the recruiter meant.
 */
export async function saveFormLayout(
  formId: string,
  fields: readonly FieldDraft[],
  expectedVersion: number,
): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(formId)) return { ok: false, error: NOT_THERE };
  const before = await readForm(client, formId);
  if (!before) return { ok: false, error: NOT_THERE };
  if (before.archived_at) return { ok: false, error: RETIRED };

  const issues: DraftIssue[] = draftIssues(fields);
  if (issues.length > 0) {
    return {
      ok: false,
      error: "This layout cannot be saved yet.",
      issues: issues.map((issue) => issue.message),
    };
  }

  if (before.version !== expectedVersion) {
    return {
      ok: false,
      error: `This form was opened at version ${expectedVersion} and is now at version ${before.version} — someone else saved it. Reload it, check their change, and save again.`,
    };
  }

  const { data: existingRows } = await client
    .from("application_form_fields")
    .select("key")
    .eq("form_id", formId);
  const existingKeys = ((existingRows ?? []) as { key: string }[]).map((row) => row.key);

  const nextVersion = expectedVersion + 1;
  const { data: claimed, error: claimError } = await client
    .from("application_forms")
    .update({ version: nextVersion, updated_at: new Date().toISOString() })
    .eq("id", formId)
    .eq("version", expectedVersion)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) return { ok: false, error: refusal(claimError) };
  if (!claimed) {
    const current = await readForm(client, formId);
    if (!current) return { ok: false, error: NOT_THERE };
    if (current.archived_at) return { ok: false, error: RETIRED };
    return {
      ok: false,
      error: `This form is now at version ${current.version} — someone else saved it while you were editing. Reload it before saving again.`,
    };
  }

  const partial = (step: string) =>
    `The form's version moved to ${nextVersion}, but ${step} did not finish. Reload the form and check its fields before saving again.`;

  if (fields.length > 0) {
    const { error } = await client
      .from("application_form_fields")
      .upsert(layoutRows(formId, fields), { onConflict: "form_id,key" });
    if (error) return { ok: false, error: partial(`storing the fields failed (${refusal(error)})`) };
  }

  const kept = new Set(fields.map((field) => field.key.trim()));
  const removed = existingKeys.filter((key) => !kept.has(key));
  if (removed.length > 0) {
    const { error } = await client
      .from("application_form_fields")
      .delete()
      .eq("form_id", formId)
      .in("key", removed);
    if (error) return { ok: false, error: partial(`removing ${removed.length} deleted field${removed.length === 1 ? "" : "s"} failed (${refusal(error)})`) };
  }

  await recordActivity({
    area: "forms",
    action: "form_save_layout",
    entity: "application form",
    entityId: formId,
    summary: `Saved ${fields.length} field${fields.length === 1 ? "" : "s"} to “${before.name}” as version ${nextVersion}`,
    detail: {
      fields: fields.length,
      headings: fields.filter((field) => field.type === "section_heading").length,
      removed: removed.length,
      previous_version: expectedVersion,
      version: nextVersion,
    },
  });

  revalidateForms();
  return { ok: true, version: nextVersion };
}

/* -------------------------------------------------------------------------- */
/* Publish                                                                      */
/* -------------------------------------------------------------------------- */

interface Composition {
  forms: FormRow[];
  fieldsByForm: Record<string, FieldRow[]>;
  assignments: AssignmentRow[];
  /** True when the bounded reads stopped short of the whole estate. */
  truncated: boolean;
}

/**
 * Read everything a composition could touch: the forms, every field, and every
 * assignment. All three reads are bounded, and a bound that was actually hit is
 * reported rather than passing half a layout off as the whole one.
 */
async function readComposition(
  client: Client,
): Promise<{ ok: true; composition: Composition } | { ok: false; error: string }> {
  const fieldCeiling = FORM_LIST_LIMIT * LIMITS.fields_per_form;
  const assignmentCeiling = FORM_LIST_LIMIT * LIMITS.forms_assigned_per_opening;

  const [formsResult, fieldsResult, assignmentsResult] = await Promise.all([
    client
      .from("application_forms")
      .select(COMPOSITION_FORM_COLUMNS)
      .limit(FORM_LIST_LIMIT),
    client
      .from("application_form_fields")
      .select(FIELD_COLUMNS, { count: "exact" })
      .limit(fieldCeiling),
    client
      .from("job_application_forms")
      .select("job_id, form_id, position", { count: "exact" })
      .limit(assignmentCeiling),
  ]);

  const error = formsResult.error ?? fieldsResult.error ?? assignmentsResult.error;
  if (error) return { ok: false, error: refusal(error) };

  const formRows = (formsResult.data ?? []) as FormDbRow[];
  const fieldRows = (fieldsResult.data ?? []) as FieldDbRow[];
  const assignmentRows = (assignmentsResult.data ?? []) as AssignmentDbRow[];

  const fieldsByForm: Record<string, FieldRow[]> = {};
  for (const row of fieldRows) {
    const list = fieldsByForm[row.form_id] ?? [];
    list.push(toFieldRow(row));
    fieldsByForm[row.form_id] = list;
  }

  return {
    ok: true,
    composition: {
      forms: formRows.map(toFormRow),
      fieldsByForm,
      assignments: assignmentRows.map((row) => ({
        jobId: row.job_id,
        formId: row.form_id,
        position: row.position,
      })),
      truncated:
        (fieldsResult.count !== null && fieldsResult.count > fieldRows.length) ||
        (assignmentsResult.count !== null && assignmentRows.length < assignmentsResult.count),
    },
  };
}

/** The three ceilings `resolveLayout` can find; every other `LIMITS` key is not a layout count. */
const COMPOSITION_CEILINGS: Partial<Record<keyof typeof LIMITS, string>> = {
  forms_assigned_per_opening: `forms assigned to one opening`,
  global_forms: `global forms`,
  resolved_fields_per_application: `fields asked on one application`,
};

function violationSentence(violation: LayoutViolation): string {
  switch (violation.kind) {
    case "duplicate_key":
      return `The key "${violation.key}" is used in both “${violation.firstForm}” and “${violation.secondForm}”; a key is the snapshot's join key and has to be unique across everything one application asks.`;
    case "duplicate_system":
      return `“${violation.firstForm}” and “${violation.secondForm}” both write "${violation.systemKey}", so an application would carry two answers for it.`;
    case "ceiling": {
      const named = COMPOSITION_CEILINGS[violation.ceiling];
      return named
        ? `This layout would hold ${violation.actual} ${named}; the ceiling is ${LIMITS[violation.ceiling]}.`
        : `This layout exceeds the ${String(violation.ceiling)} ceiling with ${violation.actual}.`;
    }
    case "identity_issue":
      return violation.issue;
  }
}

/**
 * Publish, after proving the layout across every composition it will appear in.
 *
 * The passes are the compositions a candidate could actually be asked: once for
 * each opening the form is assigned to, and once on its own — with every global
 * form beside it, because a global form is never asked alone. A non-global form is
 * deliberately **not** made to carry the name and email fields by itself: the
 * seeded "Personal details" form is global, and a supplementary form that only
 * asks about skills is a legal shape. What the self pass proves is the shape an
 * opening would see if this form were the only one assigned.
 *
 * Every refusal names the opening it was found on, so "two fields share a key" is
 * not left for a recruiter to reproduce by hand.
 */
export async function publishForm(formId: string): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(formId)) return { ok: false, error: NOT_THERE };
  const before = await readForm(client, formId);
  if (!before) return { ok: false, error: NOT_THERE };
  if (before.archived_at) return { ok: false, error: RETIRED };

  const read = await readComposition(client);
  if (!read.ok) return { ok: false, error: read.error };
  const { composition } = read;

  if (composition.truncated) {
    return {
      ok: false,
      error:
        "This database holds more forms, fields or assignments than one publish pass can compose. The pass refuses rather than proving a partial layout.",
    };
  }

  const target = composition.forms.find((form) => form.id === formId);
  if (!target) return { ok: false, error: NOT_THERE };

  // The form is being published, so every pass has to see it the way an applicant
  // will: published, with the version this publish is about to write.
  const nextVersion = before.version + 1;
  const forms: FormRow[] = composition.forms.map((form) =>
    form.id === formId
      ? { ...form, status: "PUBLISHED", version: nextVersion, archivedAt: null }
      : form,
  );

  const assignedTo = composition.assignments.filter(
    (assignment) => assignment.formId === formId && !target.isGlobal,
  );
  const jobIds = [...new Set(assignedTo.map((assignment) => assignment.jobId))];
  const jobTitles = new Map<string, string>();
  for (let i = 0; i < jobIds.length; i += 50) {
    const chunk = jobIds.slice(i, i + 50);
    const { data } = await client.from("job_openings").select("id, title").in("id", chunk);
    for (const job of (data ?? []) as { id: string; title: string }[]) {
      jobTitles.set(job.id, job.title);
    }
  }

  const sentences = new Set<string>();

  const collect = (prefix: string, layout: ReturnType<typeof resolveLayout>) => {
    for (const violation of layout.violations) {
      sentences.add(`${prefix} ${violationSentence(violation)}`);
    }
    const found: IdentityIssue[] = identityIssues(layout.fields);
    for (const issue of found) {
      sentences.add(`${prefix} ${issue.message}`);
    }
  };

  for (const jobId of jobIds) {
    const layout = resolveLayout({
      forms,
      fieldsByForm: composition.fieldsByForm,
      assignments: composition.assignments,
      jobId,
    });
    collect(`On “${jobTitles.get(jobId) ?? "an opening"}”:`, layout);
  }

  const selfJob = "__publish_self__";
  const selfLayout = resolveLayout({
    forms,
    fieldsByForm: composition.fieldsByForm,
    assignments: target.isGlobal
      ? []
      : [{ jobId: selfJob, formId, position: Number.MAX_SAFE_INTEGER }],
    jobId: selfJob,
  });
  collect(
    target.isGlobal
      ? "With the other global forms:"
      : "On its own, with every global form:",
    selfLayout,
  );

  if (sentences.size > 0) {
    return {
      ok: false,
      error: `“${before.name}” cannot be published yet.`,
      issues: [...sentences],
    };
  }

  const { data: updated, error } = await client
    .from("application_forms")
    .update({
      status: "PUBLISHED",
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", formId)
    .eq("version", before.version)
    .is("archived_at", null)
    .select("version")
    .maybeSingle();

  if (error) return { ok: false, error: refusal(error) };
  if (!updated) {
    return {
      ok: false,
      error:
        "This form changed while it was being checked. Nothing was published; run publish again so the checks run on the layout that is actually there.",
    };
  }

  await recordActivity({
    area: "forms",
    action: "form_publish",
    entity: "application form",
    entityId: formId,
    summary: `Published “${before.name}” as version ${nextVersion}, after proving it on ${
      jobIds.length === 0
        ? "its own composition"
        : `${jobIds.length} assigned opening${jobIds.length === 1 ? "" : "s"} and its own`
    }`,
    detail: {
      version: nextVersion,
      previous_version: before.version,
      assigned_openings: jobIds.length,
      is_global: target.isGlobal,
    },
  });

  revalidateForms();
  return { ok: true, version: nextVersion };
}

/* -------------------------------------------------------------------------- */
/* Assignment                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Put a published form on one opening, after proving the composition it joins.
 *
 * A form's publish check proved it beside the globals; this proves it beside the
 * other forms already assigned here, which is the only place a duplicate key can
 * appear after both forms were each publishable on their own.
 */
export async function assignFormToJob(
  jobId: string,
  formId: string,
  position: number,
): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(formId)) {
    return { ok: false, error: "Choose an opening and a form." };
  }

  const form = await readForm(client, formId);
  if (!form) return { ok: false, error: NOT_THERE };
  if (form.archived_at) return { ok: false, error: RETIRED };
  if (form.is_global) {
    return {
      ok: false,
      error: `“${form.name}” is asked on every open role by definition, so it cannot be assigned to one opening.`,
    };
  }
  if (form.status !== "PUBLISHED") {
    return {
      ok: false,
      error: `“${form.name}” is still a draft. Publish it before assigning it to an opening.`,
    };
  }

  const found = await readOpeningTitleAndStatus(client, jobId);
  if (!found.ok) {
    return {
      ok: false,
      error: found.reason === "gone"
        ? "That opening no longer exists — pick a current one."
        : found.error,
    };
  }
  const opening = found.opening;

  const read = await readComposition(client);
  if (!read.ok) return { ok: false, error: read.error };
  const { composition } = read;
  if (composition.truncated) {
    return {
      ok: false,
      error:
        "This database holds more forms, fields or assignments than one check can compose, so the assignment was not written.",
    };
  }

  const existing = composition.assignments.filter(
    (assignment) => assignment.jobId === jobId && assignment.formId !== formId,
  );
  const nextPosition =
    Number.isInteger(position) && position >= 0
      ? position
      : existing.reduce((highest, assignment) => Math.max(highest, assignment.position + 1), 0);

  const wouldBe: AssignmentRow[] = [
    ...existing,
    { jobId, formId, position: nextPosition },
  ];

  const layout = resolveLayout({
    forms: composition.forms,
    fieldsByForm: composition.fieldsByForm,
    assignments: wouldBe,
    jobId,
  });

  if (layout.violations.length > 0) {
    return {
      ok: false,
      error: `“${form.name}” cannot join “${opening.title}” yet.`,
      issues: layout.violations.map(violationSentence),
    };
  }

  const { error } = await client
    .from("job_application_forms")
    .upsert(
      { job_id: jobId, form_id: formId, position: nextPosition },
      { onConflict: "job_id,form_id" },
    );

  if (error) return { ok: false, error: refusal(error) };

  await recordActivity({
    area: "forms",
    action: "form_assign",
    entity: "application form",
    entityId: formId,
    summary: `Assigned “${form.name}” to “${opening.title}” at position ${nextPosition}`,
    detail: { job_id: jobId, position: nextPosition, version: form.version },
  });

  revalidateForms();
  return { ok: true };
}

export async function unassignFormFromJob(
  jobId: string,
  formId: string,
): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(formId)) {
    return { ok: false, error: "Choose an opening and a form." };
  }

  const [form, job] = await Promise.all([
    readForm(client, formId),
    readOpeningTitleAndStatus(client, jobId),
  ]);
  if (!form) return { ok: false, error: NOT_THERE };

  const { data: removed, error } = await client
    .from("job_application_forms")
    .delete()
    .eq("job_id", jobId)
    .eq("form_id", formId)
    .select("form_id");

  if (error) return { ok: false, error: refusal(error) };
  if (!removed || (removed as unknown[]).length === 0) {
    return { ok: false, error: `“${form.name}” is not assigned to that opening.` };
  }

  const title = job.ok ? job.opening.title : "an opening";

  await recordActivity({
    area: "forms",
    action: "form_unassign",
    entity: "application form",
    entityId: formId,
    summary: `Removed “${form.name}” from “${title}”`,
    detail: { job_id: jobId, version: form.version },
  });

  revalidateForms();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Retirement                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * File a form away. It is never deleted: every application that answered it
 * carries the labels it answered in `form_answers`, and deleting the row would
 * break the only join the console could still offer.
 */
export async function retireForm(formId: string): Promise<FormMutation> {
  const guard = await formEditor();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { client } = guard;

  if (!UUID_PATTERN.test(formId)) return { ok: false, error: NOT_THERE };
  const before = await readForm(client, formId);
  if (!before) return { ok: false, error: NOT_THERE };
  if (before.archived_at) return { ok: true, version: before.version };

  const { error } = await client
    .from("application_forms")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", formId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: refusal(error) };

  await recordActivity({
    area: "forms",
    action: "form_retire",
    entity: "application form",
    entityId: formId,
    summary: `Retired “${before.name}” — applications already filed keep the questions they answered`,
    detail: { was_status: before.status, version: before.version },
  });

  revalidateForms();
  return { ok: true, version: before.version };
}
