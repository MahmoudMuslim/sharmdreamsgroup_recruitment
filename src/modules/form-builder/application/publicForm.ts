/**
 * The public read of a job's application form (spec §5, plan Task 10).
 *
 * Two things happen here and they must not blur: `resolveFormForJob` reads the
 * published layout for one opening with the service role — one request-time
 * composition, never a cached page read — and `project` turns that layout into
 * the only shape a candidate's browser is allowed to see.
 *
 * The projection is the security boundary. `system_key`, a field's whole
 * `config`, and every registry key stay on this side of it: the browser is told
 * *this step needs a box*, never *this field writes your diagnosis*
 * (spec §5). `accept` is derived from the closed `kinds` vocabulary and
 * `maxBytes` from `LIMITS`, so neither can be widened by an authored config or
 * a request body.
 *
 * `resolveFormForJob` degrades rather than throws. Every branch that cannot
 * produce an honest layout returns `{ fallback: "wizard" }`, which is spec §9's
 * one rule — degrade the page, never the record. The apply page renders
 * today's `ApplyWizard` on that value; the submit door refuses instead.
 */

import { getServiceRestClient } from "@/lib/data-api/service";
import {
  consentPurposeFor,
  type PersonFieldGroup,
} from "@/modules/candidates/domain/person-fields";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  DURATION_UNITS,
  KINDS,
  kindRules,
  type DurationUnit,
  type FieldType,
  type Kind,
} from "@/modules/form-builder/domain/field-types";
import { identityIssues } from "@/modules/form-builder/domain/identityIssues";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import {
  resolveLayout,
  type FieldRow,
  type FormRow,
  type LayoutViolation,
  type ResolvedField,
  type ResolvedLayout,
} from "@/modules/form-builder/domain/resolveLayout";
import { widthOf, type FieldWidth } from "@/modules/form-builder/domain/rowLayout";

/** What a step may carry. No `system_key`, no `config`, no registry key. */
export interface PublicField {
  key: string;
  label: string;
  help: string | null;
  placeholder: string | null;
  type: FieldType;
  required: boolean;
  /**
   * How wide the question is, derived from its config by the one layout module.
   * Always one of the three, so the browser needs none of the author's config.
   */
  width: FieldWidth;
  /** Offered labels, for the three choice types only. */
  options?: readonly string[];
  /** The derived MIME list for `file`/`photo`, never an author-typed string. */
  accept?: string;
  /** The byte ceiling the upload door enforces, resolved server-side. */
  maxBytes?: number;
  /** The closed units a `duration` field offers, in the author's order. */
  units?: readonly DurationUnit[];
}

export interface PublicStep {
  heading: string | null;
  fields: PublicField[];
  /**
   * The consent purposes any field on this step is bound to. The browser learns
   * that this step needs a box — never which field caused it (spec §5).
   */
  consentGroups: PersonFieldGroup[];
}

export interface PublicForm {
  steps: PublicStep[];
  /** The consent purposes the layout asks for, in first-asked order. */
  consentGroups: PersonFieldGroup[];
}

/**
 * Why a role fell back to the built-in wizard (spec §9).
 *
 * The page treats all three the same — degrade the page — but the submit door
 * does not: `no-layout` is the one state whose record is still today's
 * application and therefore the one state the legacy path may file. A broken
 * or unreadable layout is a refusal, never a quiet rewrite of what the
 * candidate was asked.
 */
export type FallbackCause = "no-layout" | "broken" | "unavailable";

export type FormResolution =
  | ResolvedLayout
  | { fallback: "wizard"; cause: FallbackCause; reason: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The console's own bound; a public read never composes a larger library. */
const FORM_CEILING = 200;
const FIELD_CEILING = FORM_CEILING * LIMITS.fields_per_form;
/** Enough rows to report an over-assigned opening rather than truncate it. */
const ASSIGNMENT_CEILING = LIMITS.forms_assigned_per_opening * 10;

const FORM_COLUMNS =
  "id, name, is_global, global_position, status, archived_at, version";
const FIELD_COLUMNS =
  "id, form_id, key, type, label, help_text, placeholder, required, config, system_key, position";

interface FormDbRow {
  id: string;
  name: string;
  is_global: boolean;
  global_position: number;
  status: "DRAFT" | "PUBLISHED";
  archived_at: string | null;
  version: number;
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

function violationSentence(violation: LayoutViolation): string {
  switch (violation.kind) {
    case "duplicate_key":
      return `The key "${violation.key}" is asked by both “${violation.firstForm}” and “${violation.secondForm}”.`;
    case "duplicate_system":
      return `Two forms both write "${violation.systemKey}" — “${violation.firstForm}” and “${violation.secondForm}”.`;
    case "identity_issue":
      return violation.issue;
    case "ceiling":
      return `The layout holds ${violation.actual} where the ceiling for ${String(violation.ceiling)} is ${String(LIMITS[violation.ceiling])}.`;
  }
}

/**
 * The published layout for one opening, or the fallback reason (spec §9).
 *
 * The job is re-checked as `PUBLISHED` here because this is a public door: a
 * draft or closed role must not hand out a form even if an assignment row
 * survived it. The reads are bounded and a bound that was actually hit is a
 * fallback, not a half-composed layout passed off as the whole one.
 */
export async function resolveFormForJob(jobId: string): Promise<FormResolution> {
  if (!UUID_PATTERN.test(jobId)) {
    return { fallback: "wizard", cause: "unavailable", reason: "That is not a role reference." };
  }

  let client: ReturnType<typeof getServiceRestClient>;
  try {
    client = getServiceRestClient();
  } catch (error) {
    console.error(
      "[forms] the public layout read has no REST client:",
      error instanceof Error ? error.message : error,
    );
    return { fallback: "wizard", cause: "unavailable", reason: "The application form is unavailable right now." };
  }

  const { data: job, error: jobError } = await client
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (jobError) {
    console.error("[forms] the role check was refused:", jobError.message);
    return { fallback: "wizard", cause: "unavailable", reason: "The application form is unavailable right now." };
  }
  if (!job) {
    return { fallback: "wizard", cause: "unavailable", reason: "This role is not accepting applications." };
  }

  const [formsResult, fieldsResult, assignmentsResult] = await Promise.all([
    client
      .from("application_forms")
      .select(FORM_COLUMNS, { count: "exact" })
      .eq("status", "PUBLISHED")
      .is("archived_at", null)
      .limit(FORM_CEILING),
    client
      .from("application_form_fields")
      .select(FIELD_COLUMNS, { count: "exact" })
      .limit(FIELD_CEILING),
    client
      .from("job_application_forms")
      .select("job_id, form_id, position", { count: "exact" })
      .eq("job_id", jobId)
      .limit(ASSIGNMENT_CEILING),
  ]);

  const error = formsResult.error ?? fieldsResult.error ?? assignmentsResult.error;
  if (error) {
    console.error("[forms] the public layout read was refused:", error.message);
    return {
      fallback: "wizard",
      // A missing table is 044 not applied: the opening still takes today's
      // application. Anything else is a read that failed under a published
      // library, and the submit door refuses rather than guess.
      cause: isMissingSchemaError(error) ? "no-layout" : "unavailable",
      reason: isMissingSchemaError(error)
        ? "The application form has not been published on this deployment yet."
        : "The application form is unavailable right now.",
    };
  }

  const formRows = (formsResult.data ?? []) as unknown as FormDbRow[];
  const fieldRows = (fieldsResult.data ?? []) as unknown as FieldDbRow[];
  const assignmentRows = (assignmentsResult.data ?? []) as unknown as AssignmentDbRow[];

  if (
    (formsResult.count ?? 0) > formRows.length ||
    (fieldsResult.count ?? 0) > fieldRows.length ||
    (assignmentsResult.count ?? 0) > assignmentRows.length
  ) {
    console.error(
      "[forms] the public layout read hit a bound:",
      `${formsResult.count ?? 0} forms, ${fieldsResult.count ?? 0} fields, ${assignmentsResult.count ?? 0} assignments`,
    );
    return { fallback: "wizard", cause: "broken", reason: "The form library is too large to compose for one role." };
  }

  const fieldsByForm: Record<string, FieldRow[]> = {};
  for (const row of fieldRows) {
    const list = fieldsByForm[row.form_id] ?? [];
    list.push(toFieldRow(row));
    fieldsByForm[row.form_id] = list;
  }

  const layout = resolveLayout({
    forms: formRows.map(toFormRow),
    fieldsByForm,
    assignments: assignmentRows.map((row) => ({
      jobId: row.job_id,
      formId: row.form_id,
      position: row.position,
    })),
    jobId,
  });

  if (layout.fields.length === 0) {
    return { fallback: "wizard", cause: "no-layout", reason: "No published form asks anything for this role yet." };
  }

  if (layout.violations.length > 0) {
    const reason = violationSentence(layout.violations[0]);
    console.error("[forms] the published layout for", jobId, "is broken:", reason);
    return { fallback: "wizard", cause: "broken", reason };
  }

  const issues = identityIssues(layout.fields);
  if (issues.length > 0) {
    console.error("[forms] the published layout for", jobId, "breaks the identity contract:", issues[0].message);
    return { fallback: "wizard", cause: "broken", reason: issues[0].message };
  }

  return layout;
}

function optionLabels(config: Record<string, unknown>): string[] | null {
  const raw = config.options;
  if (!Array.isArray(raw)) return null;
  const labels = raw
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  return labels.length > 0 ? labels : null;
}

function acceptedKinds(config: Record<string, unknown>): Kind[] {
  const raw = config.kinds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (kind): kind is Kind =>
      typeof kind === "string" && (KINDS as readonly string[]).includes(kind),
  );
}

function acceptFor(field: FieldRow): string {
  const kinds: readonly Kind[] = field.type === "photo" ? ["image"] : acceptedKinds(field.config);
  const mimes = new Set<string>();
  for (const kind of kinds) {
    for (const mime of kindRules(kind)?.acceptedMimes ?? []) mimes.add(mime);
  }
  return [...mimes].join(",");
}

function toPublicField({ field }: ResolvedField): PublicField {
  const base: PublicField = {
    key: field.key,
    label: field.label,
    help: field.helpText,
    placeholder: field.placeholder,
    type: field.type,
    required: field.required,
    width: widthOf(field),
  };

  if (field.type === "select" || field.type === "radio" || field.type === "multi_select") {
    const options = optionLabels(field.config);
    return options ? { ...base, options } : base;
  }

  if (field.type === "file" || field.type === "photo") {
    const accept = acceptFor(field);
    return {
      ...base,
      ...(accept ? { accept } : {}),
      maxBytes: field.type === "photo" ? LIMITS.photo_bytes : LIMITS.file_bytes,
    };
  }

  if (field.type === "duration") {
    const raw = field.config.units;
    const units = Array.isArray(raw)
      ? raw.filter(
          (unit): unit is DurationUnit =>
            typeof unit === "string" && (DURATION_UNITS as readonly string[]).includes(unit),
        )
      : [];
    return units.length > 0 ? { ...base, units } : base;
  }

  return base;
}

/**
 * The only shape the browser receives (spec §5).
 *
 * A step's heading is its `section_heading` label. A `null` heading means the
 * form has none — a headed form's orphaned leading fields are an identity
 * issue and never reach a resolved layout — so the step is named after its
 * form, exactly as spec §5 says. Consent groups are computed here, on the
 * server, by walking the bindings: the browser learns which step needs a box,
 * never which field caused it.
 */
export function project(layout: ResolvedLayout): PublicForm {
  const consentGroups: PersonFieldGroup[] = [];

  const stepGroups = layout.steps.map((step) => {
    const groups: PersonFieldGroup[] = [];
    for (const { field } of step.fields) {
      const systemKey = field.systemKey;
      if (!systemKey || !systemKey.startsWith("person:")) continue;
      const group = consentPurposeFor(systemKey.slice("person:".length));
      // A group is asked once, on the step that first needs it. Repeating the
      // box lower down would ask the same question twice for one layout.
      if (consentGroups.includes(group)) continue;
      consentGroups.push(group);
      groups.push(group);
    }
    return groups;
  });

  return {
    steps: layout.steps.map((step, index) => ({
      heading: step.heading
        ? step.heading.field.label
        : step.fields[0]?.form.name ?? null,
      fields: step.fields.map(toPublicField),
      consentGroups: stepGroups[index],
    })),
    consentGroups,
  };
}
