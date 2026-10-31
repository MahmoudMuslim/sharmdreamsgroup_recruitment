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
  /** The id, not only the name: an editor has to pre-select who is on the panel. */
  interviewer_profile_id: string | null;
  interviewer_name: string | null;
}

/**
 * Columns every interview query selects, including the joined interviewer.
 *
 * The embed names its foreign key rather than just the table. `interview_notes`
 * and `interview_scorecards` each point at both a panel and a staff profile, so
 * a panel reaches a person by three paths and PostgREST answers a bare
 * `user_profiles (…)` with PGRST201 — a *refused* query. Every reader of this
 * list logs that and returns `[]`, which the recruiter sees as an empty pipeline.
 */
export const INTERVIEW_SELECT =
  "id, application_id, scheduled_at, duration_minutes, meeting_link, status, interviewer_profile_id, " +
  "user_profiles!interview_schedules_interviewer_profile_id_fkey ( full_name )";

/** The lengths the pickers offer, matching what the booking form suggests. */
export const DURATIONS = [30, 45, 60, 90] as const;

/**
 * The offered lengths, plus the one this row already holds.
 *
 * A `<select>` with no matching option shows its first entry while the row says
 * otherwise, so editing a two-hour panel would quietly resave it as half an hour
 * — a change nobody made and a trail row that claims someone did.
 */
export function durationOptions(current: number): number[] {
  const list: number[] = [...DURATIONS];
  if (!list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

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
    interviewer_profile_id: (row.interviewer_profile_id as string | null) ?? null,
    interviewer_name: profile?.full_name ?? null,
  };
}
