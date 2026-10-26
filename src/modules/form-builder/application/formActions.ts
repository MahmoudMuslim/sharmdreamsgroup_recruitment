"use server";

/**
 * Every read and write the `/forms` console makes (spec §6, plan Task 8).
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
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
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

export interface FormsConsoleData {
  /** False while `044_application_forms.sql` is unapplied; the page says so. */
  available: boolean;
  note?: string;
  canWrite: boolean;
  forms: FormSummary[];
  /** The form the console opens, with the ordered drafts its editor holds. */
  selected: { form: FormSummary; fields: FieldDraft[] } | null;
  jobs: { id: string; title: string; status: string }[];
}

export interface FormMutation {
  ok: boolean;
  error?: string;
  /** Every refusal in one save, so the console can print them as a list. */
  issues?: string[];
  /** The version the form now carries after a save or publish. */
  version?: number;
  id?: string;
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
/* The console's read                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every form, plus the one the console opens.
 *
 * The selected form's fields are read on their own, in their authored order; the
 * other forms contribute a count from a projection of `form_id` alone, so opening
 * the console does not ship every layout's labels to a browser that will never
 * show them. Both reads are bounded: 200 forms, and the field-count projection at
 * the whole-estate ceiling (200 forms × 40 fields).
 */
export async function listForms(selectedId: string | null): Promise<FormsConsoleData> {
  await requireStaff("/forms");
  const client = await createServerRestClient();
  const canWrite = await hasPermissionForUser("jobs.manage");

  const [formsResult, countResult, assignmentsResult, jobsResult] = await Promise.all([
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
  ]);

  if (formsResult.error && isMissingSchemaError(formsResult.error)) {
    return {
      available: false,
      note: MISSING_TABLES,
      canWrite,
      forms: [],
      selected: null,
      jobs: [],
    };
  }
  if (formsResult.error) {
    return {
      available: true,
      note: `The form list could not be read: ${formsResult.error.message}`,
      canWrite,
      forms: [],
      selected: null,
      jobs: [],
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

  // With no id asked for, the console opens the first active form rather than an
  // empty right-hand pane; a retired form is only opened when it is named.
  const summary = selectedId
    ? forms.find((form) => form.id === selectedId) ?? null
    : forms.find((form) => form.archivedAt === null) ?? forms[0] ?? null;
  let selected: FormsConsoleData["selected"] = null;

  if (summary) {
    const { data } = await client
      .from("application_form_fields")
      .select(FIELD_COLUMNS)
      .eq("form_id", summary.id)
      .order("position", { ascending: true })
      .order("key", { ascending: true });
    selected = {
      form: summary,
      fields: ((data ?? []) as FieldDbRow[]).map(toDraft),
    };
  }

  return {
    available: true,
    canWrite,
    forms,
    selected,
    jobs,
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
  if (name.length < 2 || name.length > 120) {
    return { ok: false, error: "A form's name is 2–120 characters." };
  }
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

  revalidatePath("/forms");
  return { ok: true, id: created.id, version: created.version };
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
  if (name.length < 2 || name.length > 120) {
    return { ok: false, error: "A form's name is 2–120 characters." };
  }
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

  revalidatePath("/forms");
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

  revalidatePath("/forms");
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

  revalidatePath("/forms");
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

  const { data: job } = await client
    .from("job_openings")
    .select("id, title, status")
    .eq("id", jobId)
    .maybeSingle();
  const opening = job as { id: string; title: string; status: string } | null;
  if (!opening) {
    return { ok: false, error: "That opening no longer exists — pick a current one." };
  }

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

  revalidatePath("/forms");
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
    client.from("job_openings").select("id, title").eq("id", jobId).maybeSingle(),
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

  const title = (job.data as { title?: string } | null)?.title ?? "an opening";

  await recordActivity({
    area: "forms",
    action: "form_unassign",
    entity: "application form",
    entityId: formId,
    summary: `Removed “${form.name}” from “${title}”`,
    detail: { job_id: jobId, version: form.version },
  });

  revalidatePath("/forms");
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

  revalidatePath("/forms");
  return { ok: true, version: before.version };
}
