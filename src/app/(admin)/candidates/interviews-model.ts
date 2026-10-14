/**
 * Shared shape for a booked interview.
 *
 * Lives outside the server-action module so both the candidate list query and
 * the scheduling actions map to one record, and the client panel can import the
 * type without reaching into a `"use server"` file.
 */

export interface InterviewRecord {
  id: string;
  application_id: string;
  scheduled_at: string;
  duration_minutes: number;
  meeting_link: string | null;
  status: string;
  interviewer_name: string | null;
}

/** Columns every interview query selects, including the joined interviewer. */
export const INTERVIEW_SELECT =
  "id, application_id, scheduled_at, duration_minutes, meeting_link, status, user_profiles ( full_name )";

/**
 * Flattens PostgREST's joined row.
 *
 * The embedded interviewer arrives as an object or a one-item array depending
 * on how the FK was resolved, so both are accepted — the same tolerance the
 * candidate list applies to its joins.
 */
export function toInterviewRecord(row: Record<string, unknown>): InterviewRecord {
  const joined = row.user_profiles as { full_name?: string } | { full_name?: string }[] | null;
  const profile = Array.isArray(joined) ? joined[0] : joined;
  return {
    id: String(row.id),
    application_id: String(row.application_id),
    scheduled_at: String(row.scheduled_at),
    duration_minutes: Number(row.duration_minutes),
    meeting_link: (row.meeting_link as string | null) ?? null,
    status: String(row.status ?? "SCHEDULED"),
    interviewer_name: profile?.full_name ?? null,
  };
}
