/**
 * How many applications a form has been asked on (`/forms`, spec §6).
 *
 * The figure is a **count over rows a caller already read**, never a read of its
 * own: the board reads a bounded window once and this module turns it into one
 * number per form. That is why there is nothing async here and nothing imported —
 * a tally that could go to the database would be a second answer to "which
 * applications named this form", and the two would drift the day one of them
 * changed its window.
 *
 * A form is counted by the ids its snapshot recorded, not by the assignments the
 * opening carries today. A candidate who filed against a form that has since been
 * unassigned still filed against it, and a form that was assigned last week did not
 * ask anyone before it was.
 *
 * One application is one application even if a malformed snapshot names the same
 * form twice, so each row's ids are de-duplicated before they are counted. A row
 * that names no form — a legacy application, or a snapshot the parser dropped —
 * counts toward the window it was read from and toward no form at all.
 *
 * `capped` is exact at the ceiling, not one past it: a read of exactly `limit`
 * rows cannot know whether a `limit + 1`th existed, so it must not print its
 * figure as a total. The board says "floor, not a total" in those words.
 */

/** The smallest thing a caller must know about a row: which forms it named, and when. */
export interface UsageRow {
  formIds: readonly string[];
  createdAt: string | null;
}

/** One form's figure: how many applications named it, and the newest of them. */
export interface FormUsage {
  applications: number;
  latestAt: string | null;
}

export interface FormUsageTally {
  /** Keyed by form id; a form nobody named is absent rather than zero. */
  byForm: Record<string, FormUsage>;
  /** How many rows the tally was handed, so the caller can say what it read. */
  read: number;
  /** True when the read filled its window, so every figure here is a floor. */
  capped: boolean;
}

/**
 * The bounded fallback read's ceiling. It is the form builder's own number rather
 * than an analytics limit because it bounds one board read, not a report: the
 * newest 500 applications are enough to answer "is this form in use", and the
 * board says so when the window is full.
 */
export const USAGE_APPLICATIONS = 500;

function isNewer(candidate: string, current: string | null): boolean {
  if (current === null) return true;
  const next = Date.parse(candidate);
  const held = Date.parse(current);
  // An unparseable date never displaces one that parsed; the caller's own order
  // (newest-first from the database) has already put the honest row first.
  if (!Number.isFinite(next)) return false;
  if (!Number.isFinite(held)) return true;
  return next > held;
}

/**
 * Count the rows per form. `limit` defaults to the read's own ceiling so a caller
 * that forgets it still gets the sentence the board prints.
 */
export function tallyFormUsage(
  rows: readonly UsageRow[],
  limit: number = USAGE_APPLICATIONS,
): FormUsageTally {
  const byForm: Record<string, FormUsage> = {};

  for (const row of rows) {
    for (const formId of new Set(row.formIds)) {
      if (formId === "") continue;
      const held = byForm[formId];
      if (!held) {
        byForm[formId] = { applications: 1, latestAt: row.createdAt };
        continue;
      }
      held.applications += 1;
      if (row.createdAt !== null && isNewer(row.createdAt, held.latestAt)) {
        held.latestAt = row.createdAt;
      }
    }
  }

  return { byForm, read: rows.length, capped: rows.length >= limit };
}
