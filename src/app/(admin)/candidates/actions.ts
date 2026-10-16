"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import {
  CANDIDATE_COUNT_SCAN_LIMIT,
  CANDIDATE_ROW_LIMIT,
  GRADING_QUEUE_LIMIT,
  UNSCORED_ATTEMPT_STATUS,
  UNGRADED_ATTEMPT_EMBED,
  UNGRADED_ATTEMPT_FILTER,
  tallyCandidates,
  type CandidateTally,
} from "@/modules/candidates/domain/listFilters";
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

/**
 * The candidate table, newest first.
 *
 * Two views, never mixed: the live pipeline, and the archive the filing door
 * emptied. An archived row keeps every answer, notice and score it ever had —
 * it is hidden from staff reads, not deleted — so it appears only when the
 * recruiter asks for it and restores from there.
 *
 * The two rail filters are pushed into the query, not applied to whatever the
 * page happened to load: that is what lets a chip's number and the rows under it
 * be the same set, and what the download already does with the same parameters.
 * The PostgREST builder accumulates, so each `.eq` narrows the one query.
 */
export async function getCandidateList(
  archived = false,
  stage: string | null = null,
  source: string | null = null
): Promise<CandidateRow[]> {
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const base = supabase.from("applications").select(CANDIDATE_SELECT);
  const read = archived ? base.not("archived_at", "is", null) : base.is("archived_at", null);
  if (stage) read.eq("stage", stage);
  if (source) read.eq("source", source);
  const { data, error } = await read
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_ROW_LIMIT);

  if (error) console.error("[candidates] list query failed:", error.message);

  return (data ?? []).map((row) => flattenCandidate(row as CandidateJoin, masked));
}

/**
 * How many applications sit behind the view, by stage and channel.
 *
 * The rails quote these so a chip is the size of the stage rather than the size
 * of the rows the table loaded, and so the attention feed's "waiting in New" and
 * the New chip are the same query on the same table. Two columns, no embeds,
 * newest first: `truncated` in the result is the page's cue to say the counts
 * stop being exact at the scan ceiling.
 */
export async function getCandidateTally(archived = false): Promise<CandidateTally> {
  const supabase = await createSupabaseServerClient();
  const base = supabase.from("applications").select("stage, source");
  const read = archived ? base.not("archived_at", "is", null) : base.is("archived_at", null);
  const { data, error } = await read
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_COUNT_SCAN_LIMIT);

  if (error) console.error("[candidates] rail counts failed:", error.message);

  const rows = (data ?? []) as { stage: string; source: string }[];
  const tally = tallyCandidates(rows);
  return { ...tally, truncated: rows.length >= CANDIDATE_COUNT_SCAN_LIMIT };
}

/**
 * Live applications carrying an ungraded attempt.
 *
 * The embed is `!inner` so the status filter restricts the *candidate* rows
 * rather than only the array attached to them — which is what lets the attention
 * feed count the same set this page lists. A filed-away candidate is left out:
 * the queue is work waiting on a person, and an archived record is not.
 */
const UNGRADED_SELECT = `*, job_openings(title), ${UNGRADED_ATTEMPT_EMBED}, interview_schedules(${INTERVIEW_SELECT})`;

/**
 * The grading queue: every candidate whose assessment is still sitting in
 * Submitted — the state the grading engine leaves an attempt in when it never
 * finished scoring it.
 *
 * The Bell counts this set and links here, so the number a recruiter clicks is
 * the number of rows they land on — not a nearby pipeline stage. Newest first
 * like the pipeline, and bounded, because a queue this long means grading is
 * down rather than busy. The rails narrow it the same way they narrow the
 * pipeline, so a chip inside the queue still counts rows the queue holds.
 */
export async function getUngradedAssessmentQueue(
  stage: string | null = null,
  source: string | null = null,
  limit = GRADING_QUEUE_LIMIT
): Promise<CandidateRow[]> {
  const [supabase, masked] = await Promise.all([
    createSupabaseServerClient(),
    scoresAreMaskedForCurrentUser(),
  ]);
  const read = supabase
    .from("applications")
    .select(UNGRADED_SELECT)
    .is("archived_at", null)
    .eq(UNGRADED_ATTEMPT_FILTER, UNSCORED_ATTEMPT_STATUS);
  if (stage) read.eq("stage", stage);
  if (source) read.eq("source", source);
  const { data, error } = await read
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) console.error("[candidates] grading queue read failed:", error.message);

  return (data ?? []).map((row) => flattenCandidate(row as CandidateJoin, masked));
}

/**
 * The one application a deep link points at, by id or tracking code.
 *
 * The table loads only the newest rows its rails query returns, so a link from a job
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

/** How much of the live pipeline AI screening can read. */
export interface CvCoverage {
  /** Live applications this recruiter can see. */
  total: number;
  /** Of those, the ones holding CV text the screening engine can score. */
  withText: number;
  /** CV file stored, text never read out of it — the dossier's read door fixes these. */
  fileNotRead: number;
  /** Nothing on file to read at all. */
  noCv: number;
}

/**
 * CV coverage across the live pipeline.
 *
 * Screening scores the text on `applications.cv_text`, so a record whose text
 * never landed is scored from a re-read of the file at best, and one with no CV
 * at all is not screened whatever the page promises. Every writer stores null
 * when there is no text — `finalCvText || null` on the career site, the sourcing
 * conversion, and the read door, which refuses a shorter text than the engine
 * would accept — so a null column really does mean "nothing has been read".
 *
 * Three head counts, no rows: the summary line under the table quotes these
 * instead of claiming parsing runs on every application.
 */
export async function getCvCoverage(): Promise<CvCoverage> {
  const supabase = await createSupabaseServerClient();
  const live = () =>
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null);

  const [total, unread, fromFile] = await Promise.all([
    live(),
    live().is("cv_text", null),
    live().is("cv_text", null).not("cv_file_path", "is", null),
  ]);

  for (const query of [total, unread, fromFile]) {
    if (query.error) console.error("[candidates] CV coverage count failed:", query.error.message);
  }

  const noCv = unread.count ?? 0;
  const fileNotRead = fromFile.count ?? 0;
  return {
    total: total.count ?? 0,
    withText: Math.max(0, (total.count ?? 0) - noCv),
    fileNotRead,
    noCv: Math.max(0, noCv - fileNotRead),
  };
}