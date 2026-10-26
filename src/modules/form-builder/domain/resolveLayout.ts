/**
 * The one function that decides what an opening asks (spec §2).
 *
 * The apply page, the submit action, the builder's conflict check and the
 * assignment door all call this, so none of them can disagree. Order is
 * decision 3 and nothing else: global forms by `global_position`, then the
 * opening's assigned forms by assignment `position` then form name, each form's
 * fields by `position` then key. Every tie ends at an id so two runs of the same
 * read cannot disagree.
 *
 * A resolved step is a heading and the fields under it. A form with no heading
 * yields one step named after the form (`heading: null`); fields before the
 * first heading of a form that has headings also sit in a `null`-heading step,
 * and `identityIssues` names them — this module only orders what is there.
 *
 * `violations` is never swallowed: the apply page falls back to the built-in
 * wizard, the submit action refuses, and the console prints the sentence.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import { LIMITS } from "./limits";
import type { FieldType } from "./field-types";

export interface FormRow {
  id: string;
  name: string;
  isGlobal: boolean;
  globalPosition: number;
  status: "DRAFT" | "PUBLISHED";
  archivedAt: string | null;
  version: number;
}

export interface FieldRow {
  id: string;
  formId: string;
  key: string;
  type: FieldType;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  required: boolean;
  config: Record<string, unknown>;
  systemKey: string | null;
  position: number;
}

export interface AssignmentRow {
  jobId: string;
  formId: string;
  position: number;
}

export interface ResolvedField {
  field: FieldRow;
  form: FormRow;
}

export interface ResolvedStep {
  /** `null` when the fields have no heading above them. */
  heading: ResolvedField | null;
  fields: ResolvedField[];
}

export type LayoutViolation =
  | { kind: "duplicate_key"; key: string; firstForm: string; secondForm: string }
  | { kind: "duplicate_system"; systemKey: string; firstForm: string; secondForm: string }
  | { kind: "identity_issue"; issue: string }
  | { kind: "ceiling"; ceiling: keyof typeof LIMITS; actual: number };

export interface ResolvedLayout {
  steps: ResolvedStep[];
  fields: ResolvedField[];
  violations: LayoutViolation[];
}

function byFieldOrder(a: FieldRow, b: FieldRow): number {
  return a.position - b.position || a.key.localeCompare(b.key) || a.id.localeCompare(b.id);
}

function stepsForForm(form: FormRow, rows: readonly FieldRow[]): ResolvedStep[] {
  const steps: ResolvedStep[] = [];
  let current: ResolvedStep | null = null;

  for (const field of rows) {
    const resolved: ResolvedField = { field, form };
    if (field.type === "section_heading") {
      current = { heading: resolved, fields: [] };
      steps.push(current);
      continue;
    }
    if (!current) {
      current = { heading: null, fields: [] };
      steps.push(current);
    }
    current.fields.push(resolved);
  }

  return steps;
}

export function resolveLayout(input: {
  forms: readonly FormRow[];
  fieldsByForm: Readonly<Record<string, readonly FieldRow[]>>;
  assignments: readonly AssignmentRow[];
  jobId: string;
}): ResolvedLayout {
  const published = input.forms.filter(
    (form) => form.status === "PUBLISHED" && form.archivedAt === null,
  );
  const byId = new Map(published.map((form) => [form.id, form]));

  const globals = published
    .filter((form) => form.isGlobal)
    .sort((a, b) => a.globalPosition - b.globalPosition || a.id.localeCompare(b.id));

  const assigned: { form: FormRow; position: number }[] = [];
  const seenAssigned = new Set<string>();
  for (const assignment of input.assignments) {
    if (assignment.jobId !== input.jobId || seenAssigned.has(assignment.formId)) continue;
    const form = byId.get(assignment.formId);
    if (!form || form.isGlobal) continue;
    seenAssigned.add(form.id);
    assigned.push({ form, position: assignment.position });
  }
  assigned.sort(
    (a, b) =>
      a.position - b.position ||
      a.form.name.localeCompare(b.form.name) ||
      a.form.id.localeCompare(b.form.id),
  );

  const ordered = [...globals, ...assigned.map((entry) => entry.form)];

  const violations: LayoutViolation[] = [];
  const steps: ResolvedStep[] = [];
  const fields: ResolvedField[] = [];

  const keyOwner = new Map<string, string>();
  const systemOwner = new Map<string, string>();

  for (const form of ordered) {
    const rows = [...(input.fieldsByForm[form.id] ?? [])].sort(byFieldOrder);
    for (const row of rows) {
      const duplicatedKey = keyOwner.get(row.key);
      if (duplicatedKey !== undefined) {
        violations.push({
          kind: "duplicate_key",
          key: row.key,
          firstForm: duplicatedKey,
          secondForm: form.name,
        });
      } else {
        keyOwner.set(row.key, form.name);
      }

      if (row.systemKey !== null) {
        const duplicatedSystem = systemOwner.get(row.systemKey);
        if (duplicatedSystem !== undefined) {
          violations.push({
            kind: "duplicate_system",
            systemKey: row.systemKey,
            firstForm: duplicatedSystem,
            secondForm: form.name,
          });
        } else {
          systemOwner.set(row.systemKey, form.name);
        }
      }

      fields.push({ field: row, form });
    }
    steps.push(...stepsForForm(form, rows));
  }

  if (globals.length > LIMITS.global_forms) {
    violations.push({ kind: "ceiling", ceiling: "global_forms", actual: globals.length });
  }
  if (assigned.length > LIMITS.forms_assigned_per_opening) {
    violations.push({
      kind: "ceiling",
      ceiling: "forms_assigned_per_opening",
      actual: assigned.length,
    });
  }
  if (fields.length > LIMITS.resolved_fields_per_application) {
    violations.push({
      kind: "ceiling",
      ceiling: "resolved_fields_per_application",
      actual: fields.length,
    });
  }

  return { steps, fields, violations };
}
