/**
 * Every way an authored layout can break the identity contract (spec §4, §4.1).
 *
 * The fixed wizard has eight hard-coded rules; a builder that lets a recruiter
 * author the same questions has to state them as one check, or the first form
 * someone publishes is the one that stops collecting a CV. Publish, assignment
 * and submit all call this, so "you cannot publish that" and "this application
 * cannot be filed" are the same sentence about the same layout.
 *
 * Two rules deserve their shape spelled out:
 *
 * - `cv` and `about` are alternatives, not two requirements. Today's door takes
 *   a CV **or** pasted text (`actions.ts:396`), and the shipped "Personal
 *   details" form binds both and marks neither required — so when both exist,
 *   neither is individually forced; submit refuses an application with neither
 *   answer. When only one exists, it must be required, because it is the form's
 *   only way to ask.
 * - the heading rule is per form, not per layout. A form with no headings is
 *   legal and renders as one step named after the form, so a heading-less global
 *   form must not turn the next form's first heading into an orphan rule for
 *   fields it owns.
 *
 * Duplicate `key`s and duplicate `system_key`s across forms are
 * `resolveLayout`'s violations, not this module's; counting `name`/`email`
 * here is the contract's own "exactly one", and the optional system keys get an
 * at-most-one guard so two CV fields are refused with a sentence about the CV.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import {
  personField,
  type PersonField,
} from "@/modules/candidates/domain/person-fields";
import { noticeFor } from "@/modules/candidates/domain/person-notice";
import type { ResolvedField } from "./resolveLayout";
import type { FieldType } from "./field-types";

export type IdentityIssueKind =
  | "name-count"
  | "name-required"
  | "email-count"
  | "email-required"
  | "missing-cv-or-about"
  | "cv-or-about-required"
  | "duplicate-system"
  | "type-mismatch"
  | "unknown-person-key"
  | "person-type-mismatch"
  | "list-not-multi"
  | "unboundable-type"
  | "consent-required"
  | "heading-bound"
  | "orphan-before-heading";

export interface IdentityIssue {
  /** The offending field's `key`; `*` when the issue is about the layout as a whole. */
  fieldKey: string;
  kind: IdentityIssueKind;
  /** Recruiter-facing, and phrased to name the field by its label. */
  message: string;
}

/**
 * The seven system keys and the one type each may carry (spec §4).
 *
 * Exported because the binding picker offers an application fact only at the
 * type this table declares — one table, so the picker cannot offer a pairing
 * that publish would refuse.
 */
export const PINNED_TYPE: Record<string, FieldType> = {
  name: "short_text",
  email: "email",
  phone: "phone",
  about: "long_text",
  cv: "file",
  linkedin: "url",
  photo: "photo",
};

/**
 * The registry's seven `input` values and the field type that carries each one
 * (§4.1). Exported because the builder's binding picker offers a key only at
 * the type this map declares — one table, so the picker cannot offer what the
 * writer and the publish check would refuse.
 */
export const INPUT_TO_TYPE: Record<PersonField["input"], FieldType> = {
  text: "short_text",
  textarea: "long_text",
  date: "date",
  number: "number",
  select: "select",
  photo: "photo",
  list: "multi_select",
};

/**
 * Types the registry cannot store, so no `person:` binding can land on one.
 * Exported for the picker, which greys every one of them out rather than
 * letting an author choose a binding publish will refuse.
 */
export const UNBINDABLE_TYPES: ReadonlySet<FieldType> = new Set(["time", "percentage", "duration", "geolocation"]);

function exactlyOne(
  issues: IdentityIssue[],
  systemKey: "name" | "email",
  fields: readonly ResolvedField[],
): void {
  if (fields.length !== 1) {
    issues.push({
      fieldKey: "*",
      kind: systemKey === "name" ? "name-count" : "email-count",
      message:
        systemKey === "name"
          ? `An application needs exactly one field bound to the candidate's name; this layout has ${fields.length}.`
          : `An application needs exactly one field bound to the candidate's email; this layout has ${fields.length}.`,
    });
    return;
  }
  const only = fields[0];
  if (!only.field.required) {
    issues.push({
      fieldKey: only.field.key,
      kind: systemKey === "name" ? "name-required" : "email-required",
      message: `"${only.field.label}" must be required — every application needs the candidate's ${systemKey}.`,
    });
  }
}

export function identityIssues(fields: readonly ResolvedField[]): IdentityIssue[] {
  const issues: IdentityIssue[] = [];

  // Headings are not answers; the heading rules run in their own pass below.
  const answerable = fields.filter((f) => f.field.type !== "section_heading");

  const bySystem = new Map<string, ResolvedField[]>();
  for (const f of answerable) {
    const systemKey = f.field.systemKey;
    if (!systemKey || systemKey.startsWith("person:")) continue;
    const arr = bySystem.get(systemKey) ?? [];
    arr.push(f);
    bySystem.set(systemKey, arr);
  }

  exactlyOne(issues, "name", bySystem.get("name") ?? []);
  exactlyOne(issues, "email", bySystem.get("email") ?? []);

  // At most one `cv`, one `about`, and one of each optional identity field.
  for (const [systemKey, bound] of bySystem) {
    if (systemKey === "name" || systemKey === "email") continue;
    if (bound.length > 1) {
      issues.push({
        fieldKey: bound[1].field.key,
        kind: "duplicate-system",
        message: `Only one field may write "${systemKey}" across the whole application, and this is the second.`,
      });
    }
  }

  const cvFields = bySystem.get("cv") ?? [];
  const aboutFields = bySystem.get("about") ?? [];
  if (cvFields.length === 0 && aboutFields.length === 0) {
    issues.push({
      fieldKey: "*",
      kind: "missing-cv-or-about",
      message:
        "Add a CV field or an About-you field — an application must ask for one of the two, or a candidate cannot send anything to review.",
    });
  } else if (cvFields.length === 0 || aboutFields.length === 0) {
    const only = cvFields.length === 1 ? cvFields[0] : aboutFields.length === 1 ? aboutFields[0] : null;
    if (only && !only.field.required) {
      issues.push({
        fieldKey: only.field.key,
        kind: "cv-or-about-required",
        message: `"${only.field.label}" must be required — it is the form's only field that asks for a CV or a description.`,
      });
    }
  }

  // The seven pinned keys, each at the one type that knows how to write it.
  for (const [systemKey, bound] of bySystem) {
    const pinned = PINNED_TYPE[systemKey];
    if (!pinned) continue;
    for (const f of bound) {
      if (f.field.type !== pinned) {
        issues.push({
          fieldKey: f.field.key,
          kind: "type-mismatch",
          message: `"${f.field.label}" is a ${f.field.type} field, but "${systemKey}" has to be ${pinned}.`,
        });
      }
    }
  }

  // `person:` bindings: a registry key, the type the registry declares, a
  // multi_select for a collection, and no `required` on anything consent-gated.
  for (const f of answerable) {
    const systemKey = f.field.systemKey;
    if (!systemKey || !systemKey.startsWith("person:")) continue;
    const registryKey = systemKey.slice("person:".length);

    if (UNBINDABLE_TYPES.has(f.field.type)) {
      issues.push({
        fieldKey: f.field.key,
        kind: "unboundable-type",
        message: `"${f.field.label}" is a ${f.field.type} field; the profile has no ${f.field.type} field for it to write, so it cannot be bound to a person fact.`,
      });
      continue;
    }

    const reg = personField(registryKey);
    if (!reg) {
      issues.push({
        fieldKey: f.field.key,
        kind: "unknown-person-key",
        message: `"${f.field.label}" writes to the profile field "${registryKey}", but the profile has no such field.`,
      });
      continue;
    }

    const expected = INPUT_TO_TYPE[reg.input];
    if (f.field.type !== expected) {
      issues.push(
        reg.input === "list"
          ? {
              fieldKey: f.field.key,
              kind: "list-not-multi",
              message: `"${f.field.label}" fills the profile's ${registryKey} list, so it has to be a multi_select field.`,
            }
          : {
              fieldKey: f.field.key,
              kind: "person-type-mismatch",
              message: `"${f.field.label}" is a ${f.field.type} field, but the profile stores "${registryKey}" as ${expected}.`,
            },
      );
    }

    if (f.field.required && reg.tier === 3) {
      issues.push({
        fieldKey: f.field.key,
        kind: "consent-required",
        message: `"${f.field.label}" asks for "${noticeFor(reg.group).title}" facts, which must stay optional — a candidate has to be able to decline and still apply.`,
      });
    }
  }

  // No heading may bind; and within a form that has headings, nothing answerable
  // may sit above the first one, where it would land in an untitled step.
  const headedForms = new Set(
    fields.filter((f) => f.field.type === "section_heading").map((f) => f.form.id),
  );
  let currentFormId: string | null = null;
  let seenHeading = false;
  for (const f of fields) {
    if (f.form.id !== currentFormId) {
      currentFormId = f.form.id;
      seenHeading = false;
    }
    if (f.field.type === "section_heading") {
      if (f.field.systemKey) {
        issues.push({
          fieldKey: f.field.key,
          kind: "heading-bound",
          message: `"${f.field.label}" is a section heading; headings cannot be bound to a candidate field.`,
        });
      }
      seenHeading = true;
      continue;
    }
    if (headedForms.has(f.form.id) && !seenHeading) {
      issues.push({
        fieldKey: f.field.key,
        kind: "orphan-before-heading",
        message: `"${f.field.label}" comes before the first section heading, so it would sit in a step with no title.`,
      });
    }
  }

  return issues;
}
