/**
 * The one rule for an application form's name.
 *
 * 044 holds the ceiling that actually refuses a row —
 * `check (char_length(btrim(name)) between 2 and 120)` — and the numbers here are
 * the guard the staff doors run first, so a recruiter reads a sentence instead of
 * a database error. A guard wider than its own CHECK would refuse nothing and
 * store nothing, so `prove-form-builder.mjs` reads 044's pair and requires these
 * to be it; the ceiling has no other home, and no door writes its own copy.
 *
 * `copyName` is the naming half of the copy door. The suffix survives the clamp,
 * because a copy that prints its source's exact name is a form no recruiter can
 * tell from the original — and the composed name is one `nameProblem` accepts, so
 * a copy of a form at the ceiling is still a saveable row.
 *
 * Pure module — no imports, nothing async, no database.
 */

export const FORM_NAME_MIN = 2;
export const FORM_NAME_MAX = 120;
export const COPY_SUFFIX = " (copy)";

/** The sentence a refused name prints, or `null` when 044 would take the row. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < FORM_NAME_MIN || trimmed.length > FORM_NAME_MAX) {
    return `A form's name is ${FORM_NAME_MIN}–${FORM_NAME_MAX} characters.`;
  }
  return null;
}

/** The source's name with the copy's suffix, kept inside the ceiling. */
export function copyName(sourceName: string): string {
  const room = FORM_NAME_MAX - COPY_SUFFIX.length;
  const base = sourceName.trim();
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${clipped}${COPY_SUFFIX}`;
}
