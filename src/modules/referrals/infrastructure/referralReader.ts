import "server-only";

import type { createServerRestClient } from "@/lib/data-api/server";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  REFERRAL_READ_LIMIT,
  REFERRAL_SCHEMA_NOTE,
  isBonusState,
  referralCounts,
  referralLeaderboard,
  referralProgress,
  seesAllReferrals,
  type BonusState,
  type LeaderboardEntry,
  type ReferralCounts,
  type ReferralProgress,
} from "@/modules/referrals/domain/referral";

/**
 * The referral book, read in one query per question the board asks.
 *
 * Three things are embedded rather than looked up per row because the board prints
 * them on every line: the role a claim is against, the person who made it, and the
 * application whose stage is the claim's progress. The stage is read here and never
 * copied onto the claim — a stage move made from the candidates page therefore
 * changes what this board shows without a second writer having to know referrals
 * exist.
 *
 * `referrer` and `decider` are the same table embedded twice, so both name the
 * foreign key constraint explicitly. Without the hint PostgREST cannot tell which
 * of the two links a `user_profiles(...)` embed means.
 *
 * The visitor's own code is read beside the list, not with it: a database without
 * migration 040 has neither the table nor the column, and one failed select would
 * otherwise cost the board its honest "not applied" answer.
 */

export const REFERRAL_SELECT =
  "id, tenant_id, job_id, application_id, email, full_name, referrer_profile_id, " +
  "note, bonus_state, bonus_note, bonus_decided_by, bonus_decided_at, " +
  "created_at, updated_at, " +
  "job_openings ( title, status, location ), " +
  "referrer:user_profiles!referrals_referrer_profile_id_fkey ( full_name, email, referral_code ), " +
  "applications ( stage, tracking_code ), " +
  "decider:user_profiles!referrals_bonus_decided_by_fkey ( full_name )";

/** The jobs a hand entry can file against, and the staff a claim can be moved to. */
const REFERRAL_PICKER_LIMIT = 200;

type RestClient = Awaited<ReturnType<typeof createServerRestClient>>;

export interface ReferralRow {
  id: string;
  tenantId: string | null;
  jobId: string;
  jobTitle: string;
  jobStatus: string | null;
  jobLocation: string | null;
  applicationId: string | null;
  email: string;
  fullName: string | null;
  referrerProfileId: string;
  referrerName: string;
  referrerEmail: string | null;
  note: string | null;
  bonusState: BonusState;
  bonusNote: string | null;
  bonusDecidedByName: string | null;
  bonusDecidedAt: string | null;
  createdAt: string;
  /** The linked application's stage, or null when nobody has applied yet. */
  stage: string | null;
  progress: ReferralProgress;
}

export interface ReferralBoard {
  rows: ReferralRow[];
  counts: ReferralCounts;
  leaderboard: LeaderboardEntry[];
  /** False when the query itself failed or the table is absent. */
  available: boolean;
  note: string | null;
  /** True when the read stopped at the limit; the counts are of the rows shown. */
  capped: boolean;
  limit: number;
}

export interface ReferralJobOption {
  id: string;
  title: string;
  status: string;
}

export interface ReferralPersonOption {
  id: string;
  name: string;
  role: string;
}

export interface ReferralDesk {
  board: ReferralBoard;
  /** The signed-in reader's durable code, or null while the column is absent. */
  myCode: string | null;
  codeNote: string | null;
  jobs: ReferralJobOption[];
  staff: ReferralPersonOption[];
  role: string;
  profileId: string;
}

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function reason(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error)
    ? REFERRAL_SCHEMA_NOTE
    : `The referral book could not be read: ${error.message ?? "the database did not answer"}.`;
}

function toRow(raw: Record<string, unknown>): ReferralRow {
  const job = nested<{ title?: string; status?: string; location?: string }>(raw.job_openings);
  const referrer = nested<{ full_name?: string; email?: string }>(raw.referrer);
  const application = nested<{ stage?: string; tracking_code?: string }>(raw.applications);
  const decider = nested<{ full_name?: string }>(raw.decider);
  const stage = application?.stage == null ? null : String(application.stage);

  return {
    id: String(raw.id),
    tenantId: raw.tenant_id == null ? null : String(raw.tenant_id),
    jobId: String(raw.job_id),
    jobTitle: job?.title ?? "A role that no longer exists",
    jobStatus: job?.status ?? null,
    jobLocation: job?.location ?? null,
    applicationId: raw.application_id == null ? null : String(raw.application_id),
    email: String(raw.email),
    fullName: raw.full_name == null ? null : String(raw.full_name),
    referrerProfileId: String(raw.referrer_profile_id),
    referrerName: referrer?.full_name ?? "A former staff member",
    referrerEmail: referrer?.email ?? null,
    note: raw.note == null ? null : String(raw.note),
    bonusState: isBonusState(raw.bonus_state) ? raw.bonus_state : "NONE",
    bonusNote: raw.bonus_note == null ? null : String(raw.bonus_note),
    bonusDecidedByName: decider?.full_name ?? null,
    bonusDecidedAt: raw.bonus_decided_at == null ? null : String(raw.bonus_decided_at),
    createdAt: String(raw.created_at),
    stage,
    progress: referralProgress(stage),
  };
}

/**
 * The whole book this reader may see.
 *
 * A hiring manager's read is narrowed in the query, not after it: RLS already
 * refuses the other rows, and filtering here keeps the limit measuring the rows the
 * reader is actually shown rather than a company-wide cap they can never reach the
 * end of. Recruiters and the owner read every claim.
 */
export async function readReferralBoard(
  restClient: RestClient,
  viewer: { profileId: string; role: string }
): Promise<ReferralBoard> {
  const seesAll = seesAllReferrals(viewer.role);

  const base = restClient
    .from("referrals")
    .select(REFERRAL_SELECT)
    .order("created_at", { ascending: false })
    // One more than the limit, so a full slice can say it stopped rather than
    // claiming the count is the whole book.
    .limit(REFERRAL_READ_LIMIT + 1);

  const { data, error } = await (seesAll
    ? base
    : base.eq("referrer_profile_id", viewer.profileId));

  if (error) {
    return {
      rows: [],
      counts: referralCounts([]),
      leaderboard: [],
      available: false,
      note: reason(error),
      capped: false,
      limit: REFERRAL_READ_LIMIT,
    };
  }

  const all = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  const capped = all.length > REFERRAL_READ_LIMIT;
  const rows = capped ? all.slice(0, REFERRAL_READ_LIMIT) : all;

  return {
    rows,
    counts: referralCounts(rows),
    leaderboard: referralLeaderboard(
      rows.map((row) => ({
        profileId: row.referrerProfileId,
        name: row.referrerName,
        stage: row.stage,
        bonusState: row.bonusState,
      }))
    ),
    available: true,
    note: capped
      ? `Only the newest ${REFERRAL_READ_LIMIT} referrals are shown; the counts above are of those rows.`
      : null,
    capped,
    limit: REFERRAL_READ_LIMIT,
  };
}

/** The signed-in person's own durable code, or the reason there is none to show. */
export async function readMyReferralCode(
  restClient: RestClient,
  profileId: string
): Promise<{ code: string | null; note: string | null }> {
  const { data, error } = await restClient
    .from("user_profiles")
    .select("referral_code")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    return {
      code: null,
      note: isMissingSchemaError(error)
        ? REFERRAL_SCHEMA_NOTE
        : `Your referral code could not be read: ${error.message}`,
    };
  }

  const code = (data as Record<string, unknown> | null)?.referral_code;
  return { code: typeof code === "string" && code.length > 0 ? code : null, note: null };
}

/**
 * The two pickers the desk needs, read in the render rather than on first click.
 *
 * The role list is every opening, including a paused or closed one: a referral is
 * often filed before a role is published, and the board prints the status beside
 * it so nobody mistakes a closed role for a live vacancy. The person list is staff
 * only, because a claim can only be moved to somebody who can make one.
 */
export async function readReferralPickers(
  restClient: RestClient
): Promise<{ jobs: ReferralJobOption[]; staff: ReferralPersonOption[] }> {
  const [jobs, staff] = await Promise.all([
    restClient
      .from("job_openings")
      .select("id, title, status")
      .order("title", { ascending: true })
      .limit(REFERRAL_PICKER_LIMIT),
    restClient
      .from("user_profiles")
      .select("id, full_name, role")
      .in("role", ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"])
      .order("full_name", { ascending: true })
      .limit(REFERRAL_PICKER_LIMIT),
  ]);

  return {
    jobs: ((jobs.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
    })),
    staff: ((staff.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.full_name),
      role: String(row.role),
    })),
  };
}

/** Everything the desk renders, from one round trip rather than a client waterfall. */
export async function readReferralDesk(
  restClient: RestClient,
  viewer: { profileId: string; role: string }
): Promise<ReferralDesk> {
  const [board, mine, pickers] = await Promise.all([
    readReferralBoard(restClient, viewer),
    readMyReferralCode(restClient, viewer.profileId),
    readReferralPickers(restClient),
  ]);

  return {
    board,
    myCode: mine.code,
    codeNote: mine.note,
    jobs: pickers.jobs,
    staff: pickers.staff,
    role: viewer.role,
    profileId: viewer.profileId,
  };
}
