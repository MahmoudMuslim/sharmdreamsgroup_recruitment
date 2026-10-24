import "server-only";

import type { createServerRestClient } from "@/lib/data-api/server";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  NOTES_SCHEMA_NOTE,
  type InterviewNote,
  type InterviewNotesLayer,
} from "@/modules/interviews/domain/interviewNotes";

/**
 * The panel's written accounts, read beside the agenda rather than inside it.
 *
 * `interview_schedules` is selected by the agenda, the candidate page's booking
 * panel and the profile drawer through one shared column list, and the scorecards
 * already ride their own query for the same reason: a select that names a table this
 * database does not have fails whole, so reading notes inside the agenda's row read
 * would cost a recruiter their calendar while migration 038 sits unapplied. Read
 * here, a missing table costs the notes and answers "this database predates them"
 * instead of nothing at all.
 *
 * The author's name is embedded rather than looked up per row because the desk prints
 * it on every card: one query that arrives with the name is one that cannot be made to
 * show a note whose writer the screen has to guess at.
 */

export type { InterviewNote, InterviewNotesLayer } from "@/modules/interviews/domain/interviewNotes";

export const NOTES_SELECT =
  "interview_id, author_profile_id, body, created_at, updated_at, user_profiles ( full_name )";

type RestClient = Awaited<ReturnType<typeof createServerRestClient>>;

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function toNote(row: Record<string, unknown>): InterviewNote {
  const author = nested<{ full_name?: string }>(row.user_profiles);
  return {
    interviewId: String(row.interview_id),
    authorProfileId: String(row.author_profile_id),
    authorName: author?.full_name ?? null,
    body: String(row.body),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function why(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error)
    ? NOTES_SCHEMA_NOTE
    : `The notes could not be read: ${error.message ?? "the database did not answer"}.`;
}

/**
 * Reads every interviewer's account of the panels named.
 *
 * An empty list still probes: a calendar with nothing booked must be able to say
 * whether notes exist at all, otherwise an empty week would silently claim the desk
 * works. Ordered by `updated_at` so the desk shows the most recent writing last,
 * which is the order a panel's opinions are read in.
 */
export async function readInterviewNotesLayer(
  restClient: RestClient,
  interviewIds: readonly string[]
): Promise<InterviewNotesLayer> {
  const ids = [...new Set(interviewIds.filter((id) => typeof id === "string" && id.length > 0))];

  const query = restClient.from("interview_notes").select(NOTES_SELECT);
  const { data, error } = await (ids.length > 0
    ? query.in("interview_id", ids).order("updated_at", { ascending: true })
    : query.limit(1));

  if (error) return { notes: [], available: false, note: why(error) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return { notes: rows.map(toNote), available: true, note: null };
}
