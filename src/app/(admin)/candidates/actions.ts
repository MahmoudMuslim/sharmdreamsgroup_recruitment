"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { INTERVIEW_SELECT, toInterviewRecord, type InterviewRecord } from "./interviews-model";
import type { Application } from "@/types";

/** An application joined with its parent job opening (one-to-one via `job_id`). */
export type CandidateRow = Application & {
  job_title: string | null;
  /** Present only when an assessment has been assigned to this candidate. */
  attempt_token: string | null;
  attempt_status: string | null;
  /** Null until the attempt is graded, or while the caller's scores are masked. */
  attempt_score: number | null;
  /** Every interview booked for this candidate, soonest first. */
  interviews: InterviewRecord[];
  /** True when `security.mask_scores_for_reviewers` hid the two scores above. */
  scores_masked: boolean;
  /** A score exists, even when the caller is not allowed to read its value. */
  screened: boolean;
};

/** One `applications` row with its embeds, before they are flattened. */
type CandidateJoin = Application & {
  job_openings?: { title?: string } | { title?: string }[] | null;
  candidate_attempts?:
    | { access_token: string; status: string; total_score: number | null }
    | { access_token: string; status: string; total_score: number | null }[]
    | null;
  interview_schedules?: Record<string, unknown>[] | null;
};

const CANDIDATE_SELECT = `*, job_openings(title), candidate_attempts(access_token, status, total_score), interview_schedules(${INTERVIEW_SELECT})`;

function flattenCandidate(row: CandidateJoin, masked: boolean): CandidateRow {
  const joined = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const attempt = Array.isArray(row.candidate_attempts)
    ? row.candidate_attempts[0]
    : row.candidate_attempts;
  const booked = [...(row.interview_schedules ?? [])]
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .map(toInterviewRecord);
  return {
    ...row,
    ai_match_score: masked ? null : row.ai_match_score ?? null,
    job_title: joined?.title ?? null,
    attempt_token: attempt?.access_token ?? null,
    attempt_status: attempt?.status ?? null,
    attempt_score: masked ? null : attempt?.total_score ?? null,
    interviews: booked,
    scores_masked: masked,
    screened: row.ai_match_score !== null && row.ai_match_score !== undefined,
  };
}

export async function getCandidateList(): Promise<CandidateRow[]> {
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const { data, error } = await supabase
    .from("applications")
    .select(CANDIDATE_SELECT)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) console.error("[candidates] list query failed:", error.message);

  return (data ?? []).map((row) => flattenCandidate(row as CandidateJoin, masked));
}

/**
 * The one application a deep link points at, by id or tracking code.
 *
 * The table only ever loads the newest 50 applications, so a link from a job
 * opening, the interview agenda or the assistant can name a candidate that the
 * list does not contain. Resolving it here means the profile opens whatever its
 * age, instead of the recruiter landing on an unfiltered table.
 */
export async function getCandidateByRef(input: {
  id?: string;
  trackingCode?: string;
}): Promise<CandidateRow | null> {
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id ?? "")
    ? input.id
    : null;
  // Tracking codes are `SDG-XXXXXXXX`; this charset rules out the ILIKE
  // wildcards a hand-edited URL could otherwise smuggle in.
  const code = /^[A-Za-z0-9-]{4,40}$/.test((input.trackingCode ?? "").trim())
    ? (input.trackingCode ?? "").trim()
    : null;
  if (!id && !code) return null;

  const supabase = await createSupabaseServerClient();
  const masked = await scoresAreMaskedForCurrentUser();
  const base = supabase.from("applications").select(CANDIDATE_SELECT);
  const { data, error } = await (id
    ? base.eq("id", id)
    : base.ilike("tracking_code", code ?? "")
  ).limit(1);

  if (error) console.error("[candidates] deep link lookup failed:", error.message);

  const row = (data ?? [])[0] as CandidateJoin | undefined;
  return row ? flattenCandidate(row, masked) : null;
}