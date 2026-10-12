"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INTERVIEW_SELECT, toInterviewRecord, type InterviewRecord } from "./interviews-model";
import type { Application } from "@/types";

/** An application joined with its parent job opening (one-to-one via `job_id`). */
export type CandidateRow = Application & {
  job_title: string | null;
  /** Present only when an assessment has been assigned to this candidate. */
  attempt_token: string | null;
  attempt_status: string | null;
  /** Every interview booked for this candidate, soonest first. */
  interviews: InterviewRecord[];
};

export async function getCandidateList(): Promise<CandidateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("applications")
    .select(
      `*, job_openings(title), candidate_attempts(access_token, status), interview_schedules(${INTERVIEW_SELECT})`
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) console.error("[candidates] list query failed:", error.message);

  return (data ?? []).map(
    (
      row: Application & {
        job_openings?: { title?: string } | { title?: string }[] | null;
        candidate_attempts?: { access_token: string; status: string } | { access_token: string; status: string }[] | null;
        interview_schedules?: Record<string, unknown>[] | null;
      }
    ) => {
      const joined = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
      const attempt = Array.isArray(row.candidate_attempts)
        ? row.candidate_attempts[0]
        : row.candidate_attempts;
      const booked = [...(row.interview_schedules ?? [])]
        .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
        .map(toInterviewRecord);
      return {
        ...row,
        job_title: joined?.title ?? null,
        attempt_token: attempt?.access_token ?? null,
        attempt_status: attempt?.status ?? null,
        interviews: booked,
      };
    }
  );
}