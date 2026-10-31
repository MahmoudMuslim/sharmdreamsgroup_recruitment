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

/** One step: the heading that opened it, and the questions filed under it. */
export interface StepOf<T> {
  heading: T | null;
  fields: T[];
}

/**
 * The one step rule, shared by the resolved layout and the editor's step strip.
 *
 * A `section_heading` opens a step; everything after it belongs to that step
 * until the next heading. Rows before a form's first heading (or a form with no
 * heading at all) sit in a `null`-heading step. The heading row itself is not a
 * question, so it names the step and does not appear in its `fields`.
 */
export function splitIntoSteps<T extends { type: FieldType }>(
  rows: readonly T[],
): StepOf<T>[] {
  const steps: StepOf<T>[] = [];
  let current: StepOf<T> | null = null;

  for (const row of rows) {
    if (row.type === "section_heading") {
      current = { heading: row, fields: [] };
      steps.push(current);
      continue;
    }
    if (!current) {
      current = { heading: null, fields: [] };
      steps.push(current);
    }
    current.fields.push(row);
  }

  return steps;
}

function stepsForForm(form: FormRow, rows: readonly FieldRow[]): ResolvedStep[] {
  return splitIntoSteps(rows).map((step) => ({
    heading: step.heading ? { field: step.heading, form } : null,
    fields: step.fields.map((field) => ({ field, form })),
  }));
}

/**
 * Where a previewed, unassigned form sits among the forms an opening assigns.
 *
 * Below every position the console writes — `assignFormToJob` numbers the run
 * from 0 — so the draft composes at the head of the assigned run, the slot
 * assigning it first would give it, without the read inventing an order the
 * recruiter has not chosen.
 */
const FIRST_PREVIEWED_SLOT = -1;

export function resolveLayout(input: {
  forms: readonly FormRow[];
  fieldsByForm: Readonly<Record<string, readonly FieldRow[]>>;
  assignments: readonly AssignmentRow[];
  jobId: string;
  /**
   * The recruiter's preview (spec §6): the one form being written joins the walk
   * even though it is still a draft and no opening asks it yet, so the author can
   * see the application their page will become.
   *
   * It is an exception to the *status* and nothing else. A retired form joins
   * nothing — retirement is not a question of publishing. Its key, its binding,
   * its ceilings and the step it walks are decided by the same lines that decide
   * them for an applicant, because a preview that flatters the draft is worse
   * than no preview: the recruiter would only meet the collision on the opening.
   */
  includeFormId?: string;
}): ResolvedLayout {
  const preview =
    input.includeFormId === undefined
      ? undefined
      : input.forms.find(
          (form) => form.id === input.includeFormId && form.archivedAt === null,
        );

  const published = input.forms.filter(
    (form) =>
      (form.status === "PUBLISHED" && form.archivedAt === null) ||
      (preview !== undefined && form.id === preview.id),
  );
  const byId = new Map(published.map((form) => [form.id, form]));

  const globals = published
    .filter((form) => form.isGlobal)
    .sort((a, b) => a.globalPosition - b.globalPosition || a.id.localeCompare(b.id));

  const assigned: { form: FormRow; position: number }[] = [];
  const seenAssigned = new Set<string>();
  if (preview !== undefined && !preview.isGlobal) {
    seenAssigned.add(preview.id);
    assigned.push({ form: preview, position: FIRST_PREVIEWED_SLOT });
  }
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
