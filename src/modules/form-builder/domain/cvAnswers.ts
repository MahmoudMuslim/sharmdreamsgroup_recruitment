/**
 * What a CV may be allowed to type into an authored form.
 *
 * Both halves of the door are here and both are pure, so the whole exchange can
 * be proved without a model in the room. `cvAskList` decides which questions are
 * worth asking a CV about; `acceptCvAnswers` decides which of the answers that
 * come back may reach the candidate's page.
 *
 * The rule underneath is that the form's own normaliser is the only judge: a
 * value the candidate would be refused for typing is refused here too, and
 * dropped in silence. Autofill is a courtesy — a wrong word in a box the
 * candidate has to check is worse than the blank it replaced, and an empty
 * answer is the worst of all, because it reads as an answer until `required`
 * refuses it at the next step.
 *
 * What never crosses into the ask list is the author's settings. The model is
 * told the question and the shape of its answer, and nothing else: no `config`,
 * no registry key, no `system_key`, no binding, no width. The shape is included
 * only because the normaliser needs it — the options a choice field offers, the
 * units a duration accepts, the parts of an address — so that a proposed answer
 * can be checked against the field as authored rather than against a guess.
 */
import {
  DURATION_UNITS,
  normaliseAnswer,
  type DurationUnit,
  type FieldType,
  type NormalisedValue,
} from "./field-types";
import { LIMITS } from "./limits";

/**
 * The questions a CV cannot answer.
 *
 * `section_heading` asks nothing. `file` and `photo` are answered by bytes the
 * candidate chooses, not by text read out of another file. `checkbox` is a
 * declaration — often a consent, and one a model cannot make for anybody.
 * `geolocation` is a point on a map, and a CV prints a street, not coordinates.
 *
 * Exported because the wizard asks the same question of the fields on screen: it
 * may not count a heading as a blank a CV owes it an answer to. The browser is
 * shown the field types, so this reads from what it already has.
 */
export const NEVER_ASKED_TYPES: readonly FieldType[] = [
  "section_heading",
  "file",
  "photo",
  "checkbox",
  "geolocation",
];

const ADDRESS_PARTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;

/** A field of the resolved layout, narrowed to what this door needs. */
export interface CvAnswerField {
  key: string;
  type: FieldType;
  label: string;
  help?: string | null;
  config?: Record<string, unknown> | null;
}

/** One question as the model is allowed to see it. */
export interface CvAsk {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  /** The offered labels, for the three choice types. */
  options?: readonly string[];
  /** The closed units a `duration` field accepts. */
  units?: readonly DurationUnit[];
  /** The parts an `address` field is built from. */
  parts?: readonly string[];
  maxLength?: number;
  min?: string | number;
  max?: string | number;
}

/** An answer that reached the browser, in the shape the field's own input holds. */
export type CvAnswer = NormalisedValue | Record<string, string>;

function configOf(field: CvAnswerField): Record<string, unknown> {
  return field.config ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The options a choice field really offers, or null when it offers none worth asking. */
function offeredOptions(config: Record<string, unknown>): string[] | null {
  const raw = config.options;
  if (!Array.isArray(raw) || raw.some((option) => typeof option !== "string")) return null;
  const options = (raw as string[]).map((option) => option.trim()).filter((option) => option.length > 0);
  if (options.length < 2 || options.length > LIMITS.options_per_choice_field) return null;
  return options;
}

function offeredUnits(config: Record<string, unknown>): DurationUnit[] {
  const raw = config.units;
  if (!Array.isArray(raw)) return [...DURATION_UNITS];
  const units = raw.filter(
    (unit): unit is DurationUnit => (DURATION_UNITS as readonly string[]).includes(String(unit)),
  );
  return units.length > 0 ? units : [...DURATION_UNITS];
}

function offeredParts(config: Record<string, unknown>): string[] {
  const raw = config.components;
  if (!Array.isArray(raw)) return [...ADDRESS_PARTS];
  const parts = raw.filter(
    (part): part is (typeof ADDRESS_PARTS)[number] =>
      (ADDRESS_PARTS as readonly string[]).includes(String(part)),
  );
  return parts.length > 0 ? parts : [...ADDRESS_PARTS];
}

function bound(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/**
 * The questions this form is worth reading a CV for, in the order it asks them.
 *
 * `skip` carries the keys the candidate has already answered: the door never
 * spends a token re-deriving something they typed, and the wizard re-checks the
 * same set when the answers land, because a candidate can answer while the model
 * is still thinking.
 */
export function cvAskList(
  fields: readonly CvAnswerField[],
  skip: readonly string[] = [],
): CvAsk[] {
  const answered = new Set(skip);
  const asks: CvAsk[] = [];

  for (const field of fields ?? []) {
    if (!field?.key || NEVER_ASKED_TYPES.includes(field.type)) continue;
    if (answered.has(field.key)) continue;

    const config = configOf(field);
    const isChoice =
      field.type === "select" || field.type === "radio" || field.type === "multi_select";
    // A choice field the author left optionless refuses every answer its own
    // normaliser can see, so asking about it could only ever produce a blank.
    if (isChoice && !offeredOptions(config)) continue;

    const ask: CvAsk = { key: field.key, type: field.type, label: field.label };
    if (typeof field.help === "string" && field.help.trim()) ask.help = field.help.trim();
    if (isChoice) ask.options = offeredOptions(config)!;
    if (field.type === "duration") ask.units = offeredUnits(config);
    if (field.type === "address") ask.parts = offeredParts(config);
    if (field.type === "short_text" || field.type === "long_text") {
      const maxLength = bound(config.maxLength);
      if (typeof maxLength === "number") ask.maxLength = maxLength;
    }

    const min = bound(config.min);
    const max = bound(config.max);
    if (min !== undefined) ask.min = min;
    if (max !== undefined) ask.max = max;

    asks.push(ask);
  }

  return asks;
}

/**
 * Whether a normalised answer says anything at all.
 *
 * A blank is refused rather than filed: `""` in a text box, `[]` in a multi
 * select, an address with no parts left after trimming. The wizard calls a
 * defined answer "answered", so a blank would clear the step's own check and
 * then be refused at the door as a missing answer.
 */
function isEmptyAnswer(type: FieldType, value: NormalisedValue): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return false;
  return value.trim().length === 0;
}

/** The address as its input holds it — the parts, not the snapshot's joined line. */
function addressParts(config: Record<string, unknown>, proposed: unknown): Record<string, string> {
  const source = isRecord(proposed) ? proposed : {};
  const parts: Record<string, string> = {};
  for (const part of offeredParts(config)) {
    const raw = source[part];
    if (typeof raw === "string" && raw.trim()) parts[part] = raw.trim();
  }
  return parts;
}

/**
 * The answers that may be written into the form, keyed as the form keys them.
 *
 * Everything the model proposes is refused unless the authored field itself
 * accepts it: a key the form never asked about is refused without a look, a type
 * in `NEVER_ASKED_TYPES` is refused even though `normaliseAnswer` would happily
 * take the file name a CV printed, and a value that fails the field's own bounds
 * is dropped. Whatever survives is stored normalised — the trimmed name, the
 * lower-cased email, the number at the field's decimals — so what the candidate
 * reads in the box is exactly what the record will hold.
 *
 * `address` is the one field kept in its input shape rather than its normalised
 * one: the normaliser returns the joined line the snapshot stores, and an
 * address box edits parts.
 */
export function acceptCvAnswers(
  fields: readonly CvAnswerField[],
  proposals: unknown,
): Record<string, CvAnswer> {
  const answers: Record<string, CvAnswer> = {};
  if (!isRecord(proposals)) return answers;

  for (const field of fields ?? []) {
    if (!field?.key || NEVER_ASKED_TYPES.includes(field.type)) continue;
    if (!Object.prototype.hasOwnProperty.call(proposals, field.key)) continue;

    const config = configOf(field);
    const proposed = proposals[field.key];
    const normalised = normaliseAnswer(field.type, config, proposed);
    if (!normalised.ok) continue;
    if (isEmptyAnswer(field.type, normalised.value)) continue;

    answers[field.key] =
      field.type === "address" ? addressParts(config, proposed) : normalised.value;
  }

  return answers;
}
