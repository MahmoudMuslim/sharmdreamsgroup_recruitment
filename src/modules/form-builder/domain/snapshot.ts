/**
 * `applications.form_answers` — what the candidate answered, as the form asked
 * it (spec §1.5).
 *
 * The snapshot is written once at submit and never rewritten. That is the whole
 * point: a form can be edited, retired or deleted afterwards, and the
 * application still renders the questions it was actually filed against. It is
 * an object rather than a bare array because the answer set has to carry the
 * forms and their versions — without them, "edits go live" would silently
 * rewrite what an old application says it was asked.
 *
 * A file or photo answer stores the sanitised **filename**, never the storage
 * path: the bytes are in `application_form_files`, and the snapshot is a record
 * of the question, not a second pointer to the object.
 *
 * `parseSnapshot` drops a malformed entry instead of guessing at it, following
 * `parseGateAnswers`: a duration pair truncated to `{value}` or a location
 * truncated to `{lat}` is a broken answer, and a half answer rendered as a
 * whole one is worse than a gap. The value shape is checked against the entry's
 * own type, so a string in a `duration` slot is dropped the same way.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import { LIMITS } from "./limits";
import {
  DURATION_UNITS,
  FIELD_TYPES,
  sanitiseFileName,
  type FieldType,
} from "./field-types";
import type { ResolvedField } from "./resolveLayout";

export interface SnapshotField {
  key: string;
  label: string;
  type: FieldType;
  value: unknown;
  systemKey: string | null;
}

export interface SnapshotForm {
  id: string;
  name: string;
  version: number;
}

export interface Snapshot {
  fields: SnapshotField[];
  forms: SnapshotForm[];
  resolvedAt: string;
}

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);
const DURATION_UNIT_SET = new Set<string>(DURATION_UNITS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The name a `file`/`photo` answer is recorded under. Accepts the normalised
 * string or the upload descriptor the browser sends, and keeps only the leaf.
 */
function fileNameOf(raw: unknown): string | null {
  const name =
    typeof raw === "string"
      ? raw
      : isRecord(raw) && typeof raw.name === "string"
        ? raw.name
        : null;
  if (name === null) return null;
  return sanitiseFileName(name) || null;
}

function encodeValue(type: FieldType, raw: unknown): unknown {
  if (type === "section_heading") return null;
  if (type === "file" || type === "photo") return fileNameOf(raw);
  return raw === undefined ? null : raw;
}

/**
 * The snapshot for one submission. `resolvedAt` is passed in rather than read
 * from the clock so the caller owns the timestamp and a proof can pin it.
 */
export function encodeSnapshot(
  fields: readonly ResolvedField[],
  answers: Readonly<Record<string, unknown>>,
  resolvedAt: string,
): Snapshot {
  const forms: SnapshotForm[] = [];
  const seenForms = new Set<string>();
  const snapshotFields: SnapshotField[] = [];

  for (const { field, form } of fields) {
    if (!seenForms.has(form.id)) {
      seenForms.add(form.id);
      forms.push({ id: form.id, name: form.name, version: form.version });
    }
    snapshotFields.push({
      key: field.key,
      label: field.label,
      type: field.type,
      value: encodeValue(field.type, answers[field.key]),
      systemKey: field.systemKey,
    });
  }

  return {
    fields: snapshotFields.slice(0, LIMITS.form_answers_entries),
    forms,
    resolvedAt,
  };
}

type ParsedValue = { ok: true; value: unknown } | { ok: false };

function isDurationValue(raw: unknown): raw is { value: number; unit: string } {
  return (
    isRecord(raw) &&
    typeof raw.value === "number" &&
    Number.isFinite(raw.value) &&
    typeof raw.unit === "string" &&
    DURATION_UNIT_SET.has(raw.unit)
  );
}

function isGeoValue(raw: unknown): raw is { lat: number; lng: number } {
  return (
    isRecord(raw) &&
    typeof raw.lat === "number" &&
    Number.isFinite(raw.lat) &&
    typeof raw.lng === "number" &&
    Number.isFinite(raw.lng)
  );
}

/** Shape-check the stored value against the entry's type; `null` is a blank answer. */
function parseValue(type: FieldType, raw: unknown): ParsedValue {
  if (type === "section_heading") {
    return raw === null ? { ok: true, value: null } : { ok: false };
  }
  if (raw === null) return { ok: true, value: null };
  if (type === "duration") {
    return isDurationValue(raw) ? { ok: true, value: { value: raw.value, unit: raw.unit } } : { ok: false };
  }
  if (type === "geolocation") {
    return isGeoValue(raw) ? { ok: true, value: { lat: raw.lat, lng: raw.lng } } : { ok: false };
  }
  if (type === "multi_select") {
    return Array.isArray(raw) && raw.every((item) => typeof item === "string")
      ? { ok: true, value: [...raw] }
      : { ok: false };
  }
  return typeof raw === "string" ? { ok: true, value: raw } : { ok: false };
}

function parseField(entry: unknown): SnapshotField | null {
  if (!isRecord(entry)) return null;
  const { key, label, type, systemKey } = entry;
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof label !== "string" || label.trim().length === 0) return null;
  if (typeof type !== "string" || !FIELD_TYPE_SET.has(type)) return null;
  if (!(systemKey === null || typeof systemKey === "string")) return null;
  if (!("value" in entry)) return null;

  const parsed = parseValue(type as FieldType, entry.value);
  if (!parsed.ok) return null;

  return {
    key,
    label,
    type: type as FieldType,
    value: parsed.value,
    systemKey,
  };
}

function parseForm(entry: unknown): SnapshotForm | null {
  if (!isRecord(entry)) return null;
  const { id, name, version } = entry;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
  return { id, name, version };
}

/**
 * Read a stored snapshot back. `null` means there is nothing to render — the
 * callers fall back to the four fixed columns of a pre-044 application. A
 * malformed individual entry is dropped, not repaired.
 */
export function parseSnapshot(
  json: unknown,
): { fields: SnapshotField[]; forms: SnapshotForm[] } | null {
  if (!isRecord(json) || !Array.isArray(json.fields)) return null;

  const fields: SnapshotField[] = [];
  for (const entry of json.fields) {
    const parsed = parseField(entry);
    if (parsed) fields.push(parsed);
  }

  const forms: SnapshotForm[] = [];
  if (Array.isArray(json.forms)) {
    for (const entry of json.forms) {
      const parsed = parseForm(entry);
      if (parsed) forms.push(parsed);
    }
  }

  return { fields, forms };
}
