/**
 * The words an opening now uses to say how senior it is and where it is done.
 *
 * Both lists are closed and live here rather than in the form or the action:
 * the drawer offers them as pickers, the jobs action validates against them,
 * the public board labels them in four languages, and the assistant quotes them
 * back to a model that has to choose one. One list means a value the form can
 * produce is a value every other door can read.
 *
 * Employment types used to be four values duplicated between the server action
 * and its form. Remote and Hybrid join them on the spec's own reading — they are
 * listed as job types, and the careers board's Job type facet reads this column
 * — so the duplicate lists are replaced by this module rather than extended in
 * two places that could drift.
 *
 * Experience level is nullable and separate from the title on purpose: an
 * opening created before anyone was asked has no level, and "not recorded" is a
 * fact the screens repeat. It is never defaulted to a middle tier.
 */

export const EMPLOYMENT_TYPES = [
  { value: "FULL_TIME", label: "Full time" },
  { value: "PART_TIME", label: "Part time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERNSHIP", label: "Internship" },
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];

export const EMPLOYMENT_TYPE_VALUES: readonly EmploymentType[] = EMPLOYMENT_TYPES.map(
  (type) => type.value
);

/** English labels, keyed by the stored code. The board adds other languages. */
export const EMPLOYMENT_LABELS: Record<string, string> = Object.fromEntries(
  EMPLOYMENT_TYPES.map((type) => [type.value, type.label])
);

export function isEmploymentType(value: string): value is EmploymentType {
  return (EMPLOYMENT_TYPE_VALUES as readonly string[]).includes(value);
}

export const EXPERIENCE_LEVELS = [
  { value: "JUNIOR", label: "Junior" },
  { value: "MID", label: "Mid" },
  { value: "SENIOR", label: "Senior" },
  { value: "LEAD", label: "Lead" },
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["value"];

export const EXPERIENCE_LEVEL_VALUES: readonly ExperienceLevel[] = EXPERIENCE_LEVELS.map(
  (level) => level.value
);

export const EXPERIENCE_LABELS: Record<string, string> = Object.fromEntries(
  EXPERIENCE_LEVELS.map((level) => [level.value, level.label])
);

export function isExperienceLevel(value: string): value is ExperienceLevel {
  return (EXPERIENCE_LEVEL_VALUES as readonly string[]).includes(value);
}

/** A stored code as words, with an unknown code humanized rather than dropped. */
export function experienceLabel(level: string): string {
  const known = EXPERIENCE_LABELS[level];
  if (known) return known;
  return level
    .toLowerCase()
    .split("_")
    .join(" ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export type ExperienceRead =
  | { ok: true; level: ExperienceLevel | null }
  | { ok: false; error: string };

/**
 * What a submitted level means: a code, a deliberate blank, or a refusal.
 *
 * Blank and absent both mean "no level recorded", which is the same thing the
 * column stores for an opening nobody has asked about yet. The comparison is
 * case-insensitive because a chat may send the label a person spoke ("mid")
 * rather than the stored code, and turning that away would refuse a value the
 * portal itself printed.
 */
export function readExperienceLevel(value: unknown): ExperienceRead {
  if (value === undefined || value === null) return { ok: true, level: null };
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `Experience level must be one of: ${EXPERIENCE_LEVEL_VALUES.join(", ")}.`,
    };
  }
  const level = value.trim().toUpperCase();
  if (!level) return { ok: true, level: null };
  if (!isExperienceLevel(level)) {
    return {
      ok: false,
      error: `Experience level must be one of: ${EXPERIENCE_LEVEL_VALUES.join(", ")}.`,
    };
  }
  return { ok: true, level };
}

/**
 * The file that adds both vocabularies to the database. Applied on this database,
 * so `job_openings` carries `experience_level` and the six-value employment-type
 * check, and the screens read both.
 */
export const OPENING_TERMS_MIGRATION = "db/migrations/033_opening_terms.sql";

/**
 * What the grid and the public board say where the read failed.
 *
 * This prints only after a probe reports a missing schema, so on a database that
 * has the column it never reaches a screen; the wording names the file and states
 * no fact about a database it has not measured.
 */
export const OPENING_TERMS_SCHEMA_NOTE =
  "Seniority levels and the Remote and Hybrid job types could not be read here: db/migrations/033_opening_terms.sql has never run on this database, so job_openings holds neither experience_level nor the wider employment-type list.";

/** What a write naming a seniority level is told where the column is absent. */
export const EXPERIENCE_WRITE_REFUSAL =
  "This opening's seniority could not be saved: db/migrations/033_opening_terms.sql has never run on this database, so job_openings has no experience_level column. Save the rest of the opening and record the level once the column is there.";

/** What a write choosing Remote or Hybrid is told where the old check still holds. */
export const EMPLOYMENT_WRITE_REFUSAL =
  "Remote and Hybrid were refused on this write: db/migrations/033_opening_terms.sql has never run on this database, so the older four-value employment-type check still stands and names only Full time, Part time, Contract and Internship.";

/**
 * Whether an error means the schema this feature needs is absent.
 *
 * Four codes say it: a missing column or table (42703/42P01), and PostgREST's
 * two ways of reporting a schema cache that has not caught up (PGRST204/205).
 * The message check catches the local REST shim's own wording. A constraint
 * violation (23514) is deliberately not here: the schema exists and the value
 * is what the database refused.
 */
export function isMissingSchemaError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}
