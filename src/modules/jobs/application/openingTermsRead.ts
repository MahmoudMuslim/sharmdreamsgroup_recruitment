import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import { GRID_ROW_LIMIT } from "@/modules/jobs/domain/hireable";
import {
  OPENING_TERMS_SCHEMA_NOTE,
  isExperienceLevel,
  isMissingSchemaError,
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

/** Both doors into the column share one reading of what a failure means. */
function readTerms(
  data: unknown,
  error: { code?: string | null; message?: string | null } | null
): OpeningTermsRead {
  if (error) {
    return {
      experienceById: new Map(),
      available: false,
      note: isMissingSchemaError(error)
        ? OPENING_TERMS_SCHEMA_NOTE
        : `Seniority levels could not be read: ${error.message}.`,
    };
  }

  const experienceById = new Map<string, ExperienceLevel>();
  for (const row of (data ?? []) as {
    id: string;
    experience_level: string | null;
  }[]) {
    if (typeof row.experience_level === "string" && isExperienceLevel(row.experience_level)) {
      experienceById.set(String(row.id), row.experience_level);
    }
  }
  return { experienceById, available: true, note: null };
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

  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .in("id", ids);

  return readTerms(data, error);
}

/**
 * The seniority level for the openings the grid holds.
 *
 * Read apart from the grid's own row read, the same way the headcount target
 * is: the column arrives with its own ALTER (migration 033), and on a database
 * where that file has not run naming it in the main `select` would 400 the entire
 * openings page — including the applicants, the rails and the positions picker,
 * none of which need it. Isolated here, a missing column costs only the level,
 * and the note says which migration is missing.
 *
 * The read takes the newest `GRID_ROW_LIMIT` openings in the grid's order and
 * is matched back by id, so a row the two reads disagree about is reported as
 * "no level recorded" rather than mismatched onto another opening.
 */
export async function getOpeningsTerms(restClient: StaffClient): Promise<OpeningTermsRead> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id, experience_level")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, GRID_ROW_LIMIT - 1);

  return readTerms(data, error);
}
