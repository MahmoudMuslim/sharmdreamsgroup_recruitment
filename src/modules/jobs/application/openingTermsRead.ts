import "server-only";

import {
  readOpeningExperienceLevelWindow,
  readOpeningExperienceLevels,
  type OpeningExperienceRow,
} from "@/infrastructure/repositories/jobOpening";
import { createServerRestClient } from "@/lib/data-api/server";
import { GRID_ROW_LIMIT } from "@/modules/jobs/domain/hireable";
import {
  OPENING_TERMS_SCHEMA_NOTE,
  isExperienceLevel,
  type ExperienceLevel,
} from "@/modules/jobs/domain/openingTerms";

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/** What the read came back with: a level per opening, or the fact it could not be had. */
export interface OpeningTermsRead {
  /** `job_openings.id` → level. Absent for an opening with no level recorded. */
  experienceById: Map<string, ExperienceLevel>;
  /**
   * False when `experience_level` could not be read at all — the column is not
   * applied yet, or the request was refused. The grid says so rather than
   * showing every card as "no level recorded" when the truth is "not stored".
   */
  available: boolean;
  /** The sentence to show when it could not be read; null when it could. */
  note: string | null;
}

/** Both doors into the column share one reading of the rows it came back with. */
function termsFromRows(rows: OpeningExperienceRow[]): OpeningTermsRead {
  const experienceById = new Map<string, ExperienceLevel>();
  for (const row of rows) {
    if (typeof row.experience_level === "string" && isExperienceLevel(row.experience_level)) {
      experienceById.set(String(row.id), row.experience_level);
    }
  }
  return { experienceById, available: true, note: null };
}

/** … and one reading of what a failure means. */
function termsRefusal(failure: { missingSchema: boolean; error: string }): OpeningTermsRead {
  return {
    experienceById: new Map(),
    available: false,
    note: failure.missingSchema
      ? OPENING_TERMS_SCHEMA_NOTE
      : `Seniority levels could not be read: ${failure.error}.`,
  };
}

/**
 * The seniority levels for a set of openings already in hand.
 *
 * Used where the rows were chosen by a filter rather than by recency — the
 * assistant's company- or status-scoped reads — so the levels are asked for by
 * id and cannot silently describe a different window of openings.
 */
export async function getOpeningTermsByIds(
  restClient: StaffClient,
  ids: string[]
): Promise<OpeningTermsRead> {
  if (ids.length === 0) {
    return { experienceById: new Map(), available: true, note: null };
  }

  const read = await readOpeningExperienceLevels(restClient, ids);
  return read.ok ? termsFromRows(read.rows) : termsRefusal(read);
}

/**
 * The seniority level for the openings the grid holds.
 *
 * Asked as its own read, apart from the grid's row read, the same way the
 * headcount target is: a database that has not run the column's ALTER refuses a
 * read that names it, and isolating it means that costs the level alone rather
 * than the whole openings page. `readOpeningExperienceLevelWindow` carries why.
 *
 * The read takes the newest `GRID_ROW_LIMIT` openings in the grid's order and
 * is matched back by id, so a row the two reads disagree about is reported as
 * "no level recorded" rather than mismatched onto another opening.
 */
export async function getOpeningsTerms(restClient: StaffClient): Promise<OpeningTermsRead> {
  const read = await readOpeningExperienceLevelWindow(restClient, { limit: GRID_ROW_LIMIT });
  return read.ok ? termsFromRows(read.rows) : termsRefusal(read);
}
