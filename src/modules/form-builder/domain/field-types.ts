/**
 * The twenty-one field types, the closed `kinds` vocabulary, and the one
 * function that decides what an answer means (spec §3).
 *
 * `FIELD_TYPES` is the `application_form_fields.type` CHECK in 044, same names,
 * same order — a type the database accepts but this file does not name would
 * render nowhere, and a type this file names but the CHECK refuses would fail
 * at save. The proof greps both.
 *
 * `normaliseAnswer` returns the value the snapshot stores, not the value the
 * browser sent: `time` is `HH:MM` or nothing, `percentage` is a plain decimal
 * string with the unit left in the label, and `duration`/`geolocation` are the
 * only two object values in the system (§3). Every branch reads its bounds from
 * `LIMITS`; none inlines a ceiling.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import { LIMITS } from "./limits";

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "percentage",
  "currency",
  "date",
  "time",
  "datetime",
  "duration",
  "select",
  "radio",
  "multi_select",
  "checkbox",
  "file",
  "photo",
  "address",
  "geolocation",
  "section_heading",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** §3: a closed vocabulary, never an author-typed MIME string. */
export const KINDS = ["pdf", "doc", "sheet", "slides", "image", "audio", "video", "text"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * One accepted file signature. `-1` matches any byte, which is how a container
 * format states a four-byte size field (WebP, MP4) without us guessing it.
 */
export type MagicSignature = readonly number[];

export interface KindRule {
  acceptedMimes: readonly string[];
  /** At least one signature must match the head bytes. Empty = the format has no usable signature. */
  magicBytes: readonly MagicSignature[];
  maxBytes: number;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04] as const; // docx, xlsx, pptx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const; // legacy doc, xls, ppt
const PDF = [0x25, 0x50, 0x44, 0x46] as const; // %PDF
const JPEG = [0xff, 0xd8] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF_WEBP = [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x57, 0x45, 0x42, 0x50] as const;
const EBML = [0x1a, 0x45, 0xdf, 0xa3] as const; // webm
const FTYP = [-1, -1, -1, -1, 0x66, 0x74, 0x79, 0x70] as const; // mp4 / m4a
const MP3_ID3 = [0x49, 0x44, 0x33] as const;
const MP3_FRAME = [0xff, 0xfb] as const;

const KIND_RULES: Record<Kind, KindRule> = {
  pdf: {
    acceptedMimes: ["application/pdf"],
    magicBytes: [PDF],
    maxBytes: LIMITS.file_bytes,
  },
  doc: {
    acceptedMimes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    magicBytes: [OLE, ZIP],
    maxBytes: LIMITS.file_bytes,
  },
  sheet: {
    // CSV is the `text` kind; a sheet is a workbook with a signature we can read.
    acceptedMimes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    magicBytes: [OLE, ZIP],
    maxBytes: LIMITS.file_bytes,
  },
  slides: {
    acceptedMimes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    magicBytes: [OLE, ZIP],
    maxBytes: LIMITS.file_bytes,
  },
  image: {
    acceptedMimes: ["image/jpeg", "image/png", "image/webp"],
    magicBytes: [JPEG, PNG, RIFF_WEBP],
    maxBytes: LIMITS.file_bytes,
  },
  audio: {
    acceptedMimes: ["audio/webm", "audio/mpeg", "audio/mp4"],
    magicBytes: [EBML, MP3_ID3, MP3_FRAME, FTYP],
    maxBytes: LIMITS.file_bytes,
  },
  video: {
    acceptedMimes: ["video/webm", "video/mp4"],
    magicBytes: [EBML, FTYP],
    maxBytes: LIMITS.file_bytes,
  },
  text: {
    acceptedMimes: ["text/plain", "text/csv"],
    magicBytes: [], // plain text has no signature; type and size are the whole check
    maxBytes: LIMITS.file_bytes,
  },
};

/** One kind's rules, or `null` for a name outside the closed vocabulary. */
export function kindRules(kind: string): KindRule | null {
  return Object.prototype.hasOwnProperty.call(KIND_RULES, kind)
    ? KIND_RULES[kind as Kind]
    : null;
}

// ——— the four type-specific shapes ——————————————————————————————————————

/** The closed six, in the order §3 lists them. */
export const DURATION_UNITS = ["minutes", "hours", "days", "weeks", "months", "years"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

/**
 * What one unit is worth in minutes, so "45m" and "1h" compare as one answer.
 * A month is 30 days and a year is 365 — the conventional approximations, and
 * the only place those numbers exist.
 */
export const DURATION_MINUTES: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
  months: 43200,
  years: 525600,
};

export interface DurationValue {
  value: number;
  unit: DurationUnit;
}

export interface GeoValue {
  lat: number;
  lng: number;
}

export type NormalisedValue = string | string[] | DurationValue | GeoValue;

export type NormaliseResult =
  | { ok: true; value: NormalisedValue }
  | { ok: false; reason: string };

// ——— config readers ————————————————————————————————————————————————————

function configNumber(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clampInt(raw: number | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

function offeredOptions(config: Record<string, unknown>): string[] | null {
  const raw = config.options;
  if (!Array.isArray(raw)) return null;
  if (raw.some((option) => typeof option !== "string")) return null;
  const options = raw.map((option) => (option as string).trim()).filter((option) => option.length > 0);
  if (options.length < 2 || options.length > LIMITS.options_per_choice_field) return null;
  return options;
}

/**
 * A decimal the schema can compare: no exponent, no thousands separator, a
 * leading `-` allowed, at most `maxDp` fractional digits.
 */
function parseDecimal(
  value: unknown,
  maxDp: number,
): { number: number; dp: number } | { reason: string } {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^-?\d+(?:\.(\d+))?$/.exec(raw);
  if (!match) return { reason: "not a decimal number" };
  const dp = match[1]?.length ?? 0;
  if (dp > maxDp) return { reason: `more than ${maxDp} decimal${maxDp === 1 ? "" : "s"}` };
  const number = Number(raw);
  if (!Number.isFinite(number)) return { reason: "not a number" };
  return { number, dp };
}

/** A single path segment that can be shown and stored: no separators, no control bytes. */
function sanitiseFileName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? "";
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
}

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// ——— the normaliser ————————————————————————————————————————————————————

export function normaliseAnswer(
  type: FieldType,
  config: Record<string, unknown> | null | undefined,
  value: unknown,
): NormaliseResult {
  const cfg = config ?? {};

  switch (type) {
    case "short_text": {
      const text = String(value ?? "").trim();
      const max = clampInt(configNumber(cfg, "maxLength"), 300, 1, 300);
      if (text.length > max) return { ok: false, reason: `longer than ${max} characters` };
      return { ok: true, value: text };
    }

    case "long_text": {
      const text = String(value ?? "").trim();
      const max = clampInt(configNumber(cfg, "maxLength"), LIMITS.long_text_chars, 1, LIMITS.long_text_chars);
      if (text.length > max) return { ok: false, reason: `longer than ${max} characters` };
      return { ok: true, value: text };
    }

    case "email": {
      const text = String(value ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return { ok: false, reason: "not an email address" };
      return { ok: true, value: text };
    }

    case "phone": {
      const text = String(value ?? "").trim();
      if (!/^[0-9+ ]{7,20}$/.test(text)) return { ok: false, reason: "a phone is 7–20 digits, spaces and +" };
      return { ok: true, value: text };
    }

    case "url": {
      const text = String(value ?? "").trim();
      if (text.length > 500) return { ok: false, reason: "longer than 500 characters" };
      let parsed: URL;
      try {
        parsed = new URL(text);
      } catch {
        return { ok: false, reason: "not an absolute URL" };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, reason: "must start with http:// or https://" };
      }
      return { ok: true, value: text };
    }

    case "number": {
      const decimals = clampInt(configNumber(cfg, "decimals"), 2, 0, 2);
      const parsed = parseDecimal(value, decimals);
      if (!("number" in parsed)) return { ok: false, reason: parsed.reason };
      const min = configNumber(cfg, "min");
      const max = configNumber(cfg, "max");
      if (min !== null && parsed.number < min) return { ok: false, reason: `below the minimum ${min}` };
      if (max !== null && parsed.number > max) return { ok: false, reason: `above the maximum ${max}` };
      return { ok: true, value: parsed.number.toFixed(parsed.dp) };
    }

    case "percentage": {
      const decimals = clampInt(configNumber(cfg, "decimals"), LIMITS.percentage_decimals, 0, LIMITS.percentage_decimals);
      const parsed = parseDecimal(value, decimals);
      if (!("number" in parsed)) return { ok: false, reason: parsed.reason };
      const min = Math.max(LIMITS.percentage_min, configNumber(cfg, "min") ?? LIMITS.percentage_min);
      const max = Math.min(LIMITS.percentage_max, configNumber(cfg, "max") ?? LIMITS.percentage_max);
      if (min > max) return { ok: false, reason: "the field's range is empty" };
      if (parsed.number < min || parsed.number > max) {
        return { ok: false, reason: `outside ${min}–${max}` };
      }
      return { ok: true, value: parsed.number.toFixed(parsed.dp) };
    }

    case "currency": {
      const parsed = parseDecimal(value, 2);
      if (!("number" in parsed)) return { ok: false, reason: parsed.reason };
      const min = configNumber(cfg, "min");
      const max = configNumber(cfg, "max");
      if (min !== null && parsed.number < min) return { ok: false, reason: `below the minimum ${min}` };
      if (max !== null && parsed.number > max) return { ok: false, reason: `above the maximum ${max}` };
      return { ok: true, value: parsed.number.toFixed(parsed.dp) };
    }

    case "date": {
      const text = String(value ?? "").trim();
      if (!isCalendarDay(text)) return { ok: false, reason: "must be a real day written YYYY-MM-DD" };
      const min = cfg.min;
      const max = cfg.max;
      if (typeof min === "string" && min && text < min) return { ok: false, reason: `before ${min}` };
      if (typeof max === "string" && max && text > max) return { ok: false, reason: `after ${max}` };
      return { ok: true, value: text };
    }

    case "time": {
      const text = String(value ?? "").trim();
      if (!LIMITS.time_pattern.test(text)) {
        return { ok: false, reason: "must be HH:MM, 24-hour, no seconds, no AM/PM" };
      }
      return { ok: true, value: text };
    }

    case "datetime": {
      const text = String(value ?? "").trim();
      const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
      if (!rfc3339.test(text) || !isCalendarDay(text.slice(0, 10))) {
        return { ok: false, reason: "must be an RFC 3339 date-time with an offset" };
      }
      const moment = Date.parse(text);
      if (Number.isNaN(moment)) return { ok: false, reason: "not a real date-time" };
      const min = typeof cfg.min === "string" ? Date.parse(cfg.min) : NaN;
      const max = typeof cfg.max === "string" ? Date.parse(cfg.max) : NaN;
      if (!Number.isNaN(min) && moment < min) return { ok: false, reason: `before ${cfg.min as string}` };
      if (!Number.isNaN(max) && moment > max) return { ok: false, reason: `after ${cfg.max as string}` };
      return { ok: true, value: text };
    }

    case "duration": {
      const pair = (typeof value === "object" && value !== null ? value : {}) as {
        value?: unknown;
        unit?: unknown;
      };
      const n = Number(pair.value);
      if (!Number.isFinite(n) || n < LIMITS.duration_value_min || n > LIMITS.duration_value_max) {
        return { ok: false, reason: "value out of range" };
      }
      const unit = String(pair.unit);
      if (!(DURATION_UNITS as readonly string[]).includes(unit)) {
        return { ok: false, reason: "unit not in closed list" };
      }
      const offered = cfg.units;
      if (Array.isArray(offered) && !offered.includes(unit)) {
        return { ok: false, reason: "unit not offered by this field" };
      }
      return { ok: true, value: { value: n, unit: unit as DurationUnit } };
    }

    case "select":
    case "radio": {
      const options = offeredOptions(cfg);
      if (!options) return { ok: false, reason: "the field offers no options" };
      const text = String(value ?? "").trim();
      if (!options.includes(text)) return { ok: false, reason: "not one of the offered options" };
      return { ok: true, value: text };
    }

    case "multi_select": {
      const options = offeredOptions(cfg);
      if (!options) return { ok: false, reason: "the field offers no options" };
      if (!Array.isArray(value) || value.some((picked) => typeof picked !== "string")) {
        return { ok: false, reason: "expected a list of offered options" };
      }
      const picked: string[] = [];
      for (const entry of value as string[]) {
        const text = entry.trim();
        if (!options.includes(text)) return { ok: false, reason: "not one of the offered options" };
        if (!picked.includes(text)) picked.push(text);
      }
      const min = clampInt(configNumber(cfg, "minSelections"), 0, 0, options.length);
      const max = clampInt(configNumber(cfg, "maxSelections"), options.length, 0, options.length);
      if (picked.length < min) return { ok: false, reason: `pick at least ${min}` };
      if (picked.length > max) return { ok: false, reason: `pick at most ${max}` };
      return { ok: true, value: picked };
    }

    case "checkbox": {
      const truthy = value === true || value === "true";
      const falsy = value === false || value === "false" || value === null || value === undefined;
      if (!truthy && !falsy) return { ok: false, reason: "expected a tick or a blank" };
      if (!truthy && cfg.mustBeTrue === true) return { ok: false, reason: "this box must be ticked" };
      return { ok: true, value: truthy ? "true" : "false" };
    }

    case "file":
    case "photo": {
      const name =
        typeof value === "string"
          ? value
          : typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string"
            ? ((value as { name: string }).name)
            : null;
      if (name === null) return { ok: false, reason: "expected an uploaded file" };
      const leaf = sanitiseFileName(name);
      if (!leaf) return { ok: false, reason: "the file has no usable name" };
      return { ok: true, value: leaf };
    }

    case "address": {
      const components = ["line1", "line2", "city", "region", "postalCode", "country"] as const;
      const offered = Array.isArray(cfg.components)
        ? cfg.components.filter(
            (part): part is (typeof components)[number] =>
              typeof part === "string" && (components as readonly string[]).includes(part),
          )
        : [...components];
      if (offered.length === 0) return { ok: false, reason: "the field asks for no address parts" };
      if (typeof value !== "object" || value === null) return { ok: false, reason: "expected address parts" };
      const parts = offered
        .map((part) => {
          const raw = (value as Record<string, unknown>)[part];
          return typeof raw === "string" ? raw.trim() : "";
        })
        .filter((part) => part.length > 0);
      if (parts.length === 0) return { ok: false, reason: "the address is empty" };
      return { ok: true, value: parts.join(", ") };
    }

    case "geolocation": {
      const pair = (typeof value === "object" && value !== null ? value : {}) as { lat?: unknown; lng?: unknown };
      const lat = Number(pair.lat);
      const lng = Number(pair.lng);
      if (!Number.isFinite(lat) || lat < LIMITS.geolocation_lat_range[0] || lat > LIMITS.geolocation_lat_range[1]) {
        return { ok: false, reason: "lat out of range" };
      }
      if (!Number.isFinite(lng) || lng < LIMITS.geolocation_lng_range[0] || lng > LIMITS.geolocation_lng_range[1]) {
        return { ok: false, reason: "lng out of range" };
      }
      return {
        ok: true,
        value: {
          lat: Number(lat.toFixed(LIMITS.geolocation_dp)),
          lng: Number(lng.toFixed(LIMITS.geolocation_dp)),
        },
      };
    }

    case "section_heading":
      return { ok: false, reason: "a section heading is not answerable" };

    default:
      return { ok: false, reason: `unknown field type "${String(type)}"` };
  }
}
