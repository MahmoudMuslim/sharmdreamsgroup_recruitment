/**
 * What the editor refuses *before* it writes (spec §6 "Editing model").
 *
 * These are the questions an author answers while the form is still a draft:
 * a select with nothing to pick, a range whose floor is above its ceiling, a
 * file field that accepts no kind, two fields with one key, a ceiling blown.
 * The identity contract is deliberately **not** here — a draft may be missing
 * its name and email, and `identityIssues` is what publish runs when the
 * layout is composed across every form an application will be asked.
 *
 * One exception bridges the two: a `person:` binding is checked at save because
 * the relation is wrong the moment it is written — a key the registry does not
 * carry, a type the registry does not store, a `list` key on anything but a
 * multi_select, or a Tier-3 question marked required. Publish would catch it
 * too, but an author should not have to publish to learn they cannot bind a
 * date of birth to a video.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import { personField } from "@/modules/candidates/domain/person-fields";
import {
  DURATION_UNITS,
  FIELD_TYPES,
  KINDS,
  type FieldType,
} from "./field-types";
import { INPUT_TO_TYPE, UNBINDABLE_TYPES } from "./identityIssues";
import { LIMITS } from "./limits";
import { ALWAYS_FULL_TYPES, FIELD_WIDTHS } from "./rowLayout";

/** One editable field as the console holds it — no id, because a save replaces the set. */
export interface FieldDraft {
  key: string;
  type: FieldType;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  required: boolean;
  config: Record<string, unknown>;
  systemKey: string | null;
}

export interface DraftIssue {
  /** The offending field's `key`, or `*` for a whole-form ceiling. */
  fieldKey: string;
  message: string;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{2,59}$/;
const LABEL_MAX = 200;
const CHOICE_TYPES: ReadonlySet<FieldType> = new Set(["select", "radio", "multi_select"]);
const KIND_TYPES: ReadonlySet<FieldType> = new Set(["file", "photo"]);
const RANGE_TYPES: ReadonlySet<FieldType> = new Set(["number", "percentage", "currency"]);
const ADDRESS_COMPONENTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;
const BARE_SYSTEM_KEYS: ReadonlySet<string> = new Set([
  "name",
  "email",
  "phone",
  "about",
  "cv",
  "photo",
  "linkedin",
]);

function usableOptions(config: Record<string, unknown>): { ok: boolean; reason: string; count: number } {
  const raw = config.options;
  if (!Array.isArray(raw)) return { ok: false, reason: "it has no answer list", count: 0 };
  if (raw.some((option) => typeof option !== "string")) {
    return { ok: false, reason: "one of its answers is not text", count: 0 };
  }
  const options = (raw as string[]).map((option) => option.trim()).filter(Boolean);
  if (options.length < 2) return { ok: false, reason: "it needs at least two answers to pick from", count: options.length };
  if (options.length > LIMITS.options_per_choice_field) {
    return {
      ok: false,
      reason: `it offers ${options.length} answers; the ceiling is ${LIMITS.options_per_choice_field}`,
      count: options.length,
    };
  }
  if (new Set(options).size !== options.length) {
    return { ok: false, reason: "it offers the same answer twice", count: options.length };
  }
  return { ok: true, reason: "", count: options.length };
}

function finiteConfig(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

export function draftIssues(fields: readonly FieldDraft[]): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (fields.length > LIMITS.fields_per_form) {
    issues.push({
      fieldKey: "*",
      message: `This form holds ${fields.length} fields; the ceiling is ${LIMITS.fields_per_form}.`,
    });
  }

  const headings = fields.filter((field) => field.type === "section_heading").length;
  if (headings > LIMITS.section_headings_per_form) {
    issues.push({
      fieldKey: "*",
      message: `This form holds ${headings} section headings; the ceiling is ${LIMITS.section_headings_per_form}.`,
    });
  }

  const seenKeys = new Map<string, number>();
  const firstSeen = new Map<string, string>();

  fields.forEach((field, index) => {
    const label = field.label.trim() || `Field ${index + 1}`;
    const named = `"${label}"`;

    if (!(FIELD_TYPES as readonly string[]).includes(field.type)) {
      issues.push({ fieldKey: field.key, message: `${named} is a ${String(field.type)} field, which this portal cannot store.` });
    }

    if (!KEY_PATTERN.test(field.key)) {
      issues.push({
        fieldKey: field.key,
        message: `${named} has the key "${field.key}"; a key is 3–60 lowercase letters, digits and underscores, starting with a letter.`,
      });
    }
    const duplicate = seenKeys.get(field.key);
    if (duplicate !== undefined) {
      issues.push({
        fieldKey: field.key,
        message: `${named} repeats the key "${field.key}" already used by ${firstSeen.get(field.key)}; a key is the snapshot's join key and has to be unique inside a form.`,
      });
    } else {
      seenKeys.set(field.key, index);
      firstSeen.set(field.key, label);
    }

    if (field.label.trim().length === 0 || field.label.trim().length > LABEL_MAX) {
      issues.push({ fieldKey: field.key, message: `${named} needs a label of 1–${LABEL_MAX} characters.` });
    }

    const config = field.config ?? {};

    if (CHOICE_TYPES.has(field.type)) {
      const offered = usableOptions(config);
      if (!offered.ok) {
        issues.push({ fieldKey: field.key, message: `${named} cannot be answered: ${offered.reason}.` });
      }
      if (field.type === "multi_select" && offered.count > 0) {
        const min = finiteConfig(config, "minSelections");
        const max = finiteConfig(config, "maxSelections");
        if (Number.isNaN(min) || Number.isNaN(max)) {
          issues.push({ fieldKey: field.key, message: `${named} has a selection limit that is not a number.` });
        } else if (min !== null && max !== null && min > max) {
          issues.push({
            fieldKey: field.key,
            message: `${named} asks for at least ${min} choice${min === 1 ? "" : "s"} and at most ${max}, so nothing can satisfy it.`,
          });
        }
      }
    }

    if (RANGE_TYPES.has(field.type)) {
      const min = finiteConfig(config, "min");
      const max = finiteConfig(config, "max");
      if (Number.isNaN(min) || Number.isNaN(max)) {
        issues.push({ fieldKey: field.key, message: `${named} has a range bound that is not a number.` });
      } else if (min !== null && max !== null && min > max) {
        issues.push({
          fieldKey: field.key,
          message: `${named} has a minimum of ${min} above its maximum of ${max}, so nothing can satisfy it.`,
        });
      }
    }

    if (KIND_TYPES.has(field.type)) {
      const kinds = config.kinds;
      if (!Array.isArray(kinds) || kinds.length === 0) {
        issues.push({ fieldKey: field.key, message: `${named} accepts no file kind, so a candidate cannot upload anything.` });
      } else {
        for (const kind of kinds) {
          if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
            issues.push({ fieldKey: field.key, message: `${named} names "${String(kind)}" as a file kind, which is not one of ${KINDS.join(", ")}.` });
            break;
          }
        }
      }
    }

    if (field.type === "address" && Array.isArray(config.components)) {
      if (config.components.length === 0) {
        issues.push({ fieldKey: field.key, message: `${named} asks for no part of the address.` });
      }
      for (const part of config.components) {
        if (typeof part !== "string" || !(ADDRESS_COMPONENTS as readonly string[]).includes(part)) {
          issues.push({ fieldKey: field.key, message: `${named} names "${String(part)}" as an address part, which this portal does not store.` });
          break;
        }
      }
    }

    if (field.type === "duration" && Array.isArray(config.units)) {
      if (config.units.length === 0) {
        issues.push({ fieldKey: field.key, message: `${named} offers no unit, so a duration cannot be written.` });
      }
      for (const unit of config.units) {
        if (typeof unit !== "string" || !(DURATION_UNITS as readonly string[]).includes(unit)) {
          issues.push({ fieldKey: field.key, message: `${named} offers "${String(unit)}" as a unit, which is not one of ${DURATION_UNITS.join(", ")}.` });
          break;
        }
      }
    }

    // The width is the one layout fact a field carries, and a bad value would
    // otherwise reach the browser as a column the author never picked.
    const width = config.width;
    if (width !== undefined && width !== null && width !== "") {
      if (typeof width !== "string" || !(FIELD_WIDTHS as readonly string[]).includes(width)) {
        issues.push({
          fieldKey: field.key,
          message: `${named} asks to be ${String(width)} wide; a field is full, half or third.`,
        });
      } else if (width !== "full" && ALWAYS_FULL_TYPES.has(field.type)) {
        issues.push({
          fieldKey: field.key,
          message: `${named} takes a whole row: a ${field.type} answer is not asked in half a line.`,
        });
      }
    }

    if (!field.systemKey) return;

    if (field.type === "section_heading") {
      issues.push({
        fieldKey: field.key,
        message: `${named} is a section heading, and a heading cannot be bound to a candidate field.`,
      });
      return;
    }

    if (!field.systemKey.startsWith("person:")) {
      if (!BARE_SYSTEM_KEYS.has(field.systemKey)) {
        issues.push({
          fieldKey: field.key,
          message: `${named} writes "${field.systemKey}", which is not one of the application's own fields.`,
        });
      }
      return;
    }

    if (UNBINDABLE_TYPES.has(field.type)) {
      issues.push({
        fieldKey: field.key,
        message: `${named} is a ${field.type} field, and the profile has no ${field.type} field for it to write.`,
      });
      return;
    }

    const registryKey = field.systemKey.slice("person:".length);
    const reg = personField(registryKey);
    if (!reg) {
      issues.push({
        fieldKey: field.key,
        message: `${named} writes to the profile field "${registryKey}", but the profile has no such field.`,
      });
      return;
    }

    const expected = INPUT_TO_TYPE[reg.input];
    if (field.type !== expected) {
      issues.push({
        fieldKey: field.key,
        message:
          reg.input === "list"
            ? `${named} fills the profile's ${registryKey} list, so it has to be a multi_select field.`
            : `${named} is a ${field.type} field, but the profile stores "${registryKey}" as ${expected}.`,
      });
    }

    if (field.required && reg.tier === 3) {
      issues.push({
        fieldKey: field.key,
        message: `${named} asks for a Tier-3 fact, which must stay optional so a candidate can decline and still apply.`,
      });
    }
  });

  return issues;
}
