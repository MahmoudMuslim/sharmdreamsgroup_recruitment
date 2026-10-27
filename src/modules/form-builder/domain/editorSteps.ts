/**
 * The step strip on a form's own page (`/forms/[id]`, spec §6).
 *
 * A chip has to describe the step the applicant actually gets, so the split is
 * `splitIntoSteps` — the same rule `resolveLayout` composes the wizard with — and
 * the consent group is named once, on the first step that needs it, the way
 * `project` does it. Nothing here reads the database or the layout of the other
 * forms: the strip is the recruiter's canvas, and the walk that joins every
 * global form before it is the editor's caption, not a promise.
 *
 * The group is read through `personField`, never `consentPurposeFor`: the latter
 * throws on a key the registry does not carry, and a draft binding can be
 * mid-edit — the live issues list names that row.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import {
  PERSON_GROUP_LABELS,
  personField,
  type PersonFieldGroup,
} from "@/modules/candidates/domain/person-fields";
import type { FieldDraft } from "./draftIssues";
import { splitIntoSteps } from "./resolveLayout";

/** One chip: a step of the walk, read off the canvas rows in their order. */
export interface StepView {
  /** The row the chip selects and scrolls to — the heading, else the step's first question. */
  focusIndex: number | null;
  /** The canvas rows this step holds, so the lit chip follows the selection. */
  rowStart: number;
  rowEnd: number;
  name: string;
  /** False for a step with no heading above it — the rows the identity check calls orphans. */
  headed: boolean;
  questionCount: number;
  requiredCount: number;
  groups: PersonFieldGroup[];
}

export function stepsOfCanvas(
  rows: readonly FieldDraft[],
  formName: string,
): StepView[] {
  const headed = rows.some((row) => row.type === "section_heading");
  const steps = splitIntoSteps(rows.map((row, index) => ({ ...row, index })));
  const alreadyAsked = new Set<PersonFieldGroup>();

  return steps.map((step) => {
    const groups: PersonFieldGroup[] = [];
    for (const row of step.fields) {
      const key = row.systemKey;
      if (!key?.startsWith("person:")) continue;
      const registry = personField(key.slice("person:".length));
      if (!registry || alreadyAsked.has(registry.group)) continue;
      alreadyAsked.add(registry.group);
      groups.push(registry.group);
    }
    const first = step.fields[0] ?? null;
    const last = step.fields[step.fields.length - 1] ?? null;
    return {
      focusIndex: step.heading?.index ?? first?.index ?? null,
      rowStart: step.heading?.index ?? first?.index ?? 0,
      rowEnd: last?.index ?? step.heading?.index ?? 0,
      name: step.heading
        ? step.heading.label.trim() || `Untitled heading (${step.heading.key})`
        : headed
          ? "Before the first heading"
          : formName.trim() || "This form",
      headed: step.heading !== null,
      questionCount: step.fields.length,
      requiredCount: step.fields.filter((row) => row.required).length,
      groups,
    };
  });
}

/** What a chip says when the pointer rests on it. */
export function stepTitle(step: StepView, index: number): string {
  const questions =
    step.questionCount === 0
      ? "no questions yet"
      : `${step.questionCount} question${step.questionCount === 1 ? "" : "s"}` +
        (step.requiredCount > 0 ? `, ${step.requiredCount} required` : "");
  const consent =
    step.groups.length === 0
      ? ""
      : ` — asks consent for ${step.groups.map((group) => PERSON_GROUP_LABELS[group]).join(", ")}`;
  return `Step ${index + 1}: ${step.name} — ${questions}${consent}`;
}
