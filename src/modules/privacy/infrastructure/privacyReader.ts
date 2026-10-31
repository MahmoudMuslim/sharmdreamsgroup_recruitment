import "server-only";

import type { createServerRestClient } from "@/lib/data-api/server";

import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";

import {
  RETENTION_DEFAULT_MONTHS,
  RETENTION_WARNING_DAYS,
  TALENT_POOL_DEFAULT_MONTHS,
  PRIVACY_READ_LIMIT,
  PRIVACY_SCHEMA_NOTE,
  isPrivacyRequestKind,
  isPrivacyRequestState,
  planRetention,
  readMonths,
  readWarningDays,
  type PrivacyRequestKind,
  type PrivacyRequestState,
  type RetentionDecision,
  type RetentionRow,
} from "@/modules/privacy/domain/privacy";

import { getBoolSetting, getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";

/**
 * What the privacy desk and the retention sweep read.
 *
 * Two rows, two questions, and one rule about the answer: a missing table is a
 * sentence, not an empty list. A desk showing "no requests" because 041 is not
 * applied would be telling staff that nobody has asked, which is a different
 * claim from "this database cannot record the question yet".
 *
 * The retention view is read through whichever client the caller hands over —
 * a recruiter's own session for the console, the service role for the nightly
 * sweep — so `security_invoker` on the view still decides what that caller may
 * see. Nothing here writes.
 */

/**
 * The narrow slice of the REST client both halves use.
 *
 * The console holds a session-scoped client and the cron a service-scoped one;
 * both answer `from`, and neither is the other's type, so the reader asks for the
 * one method it actually calls.
 */
export type PrivacyRestClient = Pick<
  Awaited<ReturnType<typeof createServerRestClient>>,
  "from"
>;

const REQUEST_SELECT =
  "id, kind, email, note, state, application_id, verified_at, decided_at, executed_at, " +
  "created_at, updated_at, " +
  "verifier:user_profiles!privacy_requests_verified_by_fkey ( full_name ), " +
  "decider:user_profiles!privacy_requests_decided_by_fkey ( full_name )";

const RETENTION_SELECT =
  "application_id, stage, last_activity_at, pool_granted_at, open_assessments, " +
  "open_interviews, erased_at, retention_warned_at, archived_at";

/** How many applications are named in one `in()` filter. */
const ID_CHUNK = 100;

export interface PrivacyRequestRow {
  id: string;
  kind: PrivacyRequestKind;
  email: string;
  note: string | null;
  state: PrivacyRequestState;
  applicationId: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PrivacyRequestCounts = Record<PrivacyRequestState, number>;

export interface RetentionReview extends RetentionDecision {
  stage: string;
  lastActivityAt: string | null;
  poolGrantedAt: string | null;
  warnedAt: string | null;
  archived: boolean;
  /** The person, for the desk to recognise the row — blank once erased. */
  fullName: string;
  email: string | null;
}

export interface PrivacySettings {
  enabled: boolean;
  months: number;
  talentPoolMonths: number;
  warningDays: number;
}

export interface PrivacyRequestsRead {
  rows: PrivacyRequestRow[];
  counts: PrivacyRequestCounts;
  available: boolean;
  note: string | null;
  capped: boolean;
  limit: number;
}

export interface RetentionCandidateRow extends RetentionRow {
  poolGrantedAt: string | null;
  warnedAt: string | null;
  archived: boolean;
}

export interface RetentionRead {
  rows: RetentionCandidateRow[];
  available: boolean;
  note: string | null;
  capped: boolean;
  limit: number;
}

export interface PrivacyDesk {
  requests: PrivacyRequestsRead;
  retention: RetentionReview[];
  retentionNote: string | null;
  retentionCapped: boolean;
  retentionLimit: number;
  counts: { due: number; warning: number; held: number };
  settings: PrivacySettings;
  role: string;
}

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function text(value: unknown): string | null {
  return value == null ? null : String(value);
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function reason(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error)
    ? PRIVACY_SCHEMA_NOTE
    : `The privacy desk could not be read: ${error.message ?? "the database did not answer"}.`;
}

/**
 * The four keys the Settings console renders, named in the file that reads them.
 *
 * `privacy.retention_enabled` ships off on purpose: the sweep is destructive and
 * a default of "on" would mean installing this slice starts a countdown on every
 * old record before anybody has read the console.
 */
const RETENTION_ENABLED_KEY = "privacy.retention_enabled";
const RETENTION_MONTHS_KEY = "privacy.retention_months";
const TALENT_POOL_MONTHS_KEY = "privacy.talent_pool_months";
const WARNING_DAYS_KEY = "privacy.warning_days";

/** The settings the sweep and the desk both obey. */
export async function readPrivacySettings(): Promise<PrivacySettings> {
  const [enabled, months, poolMonths, warningDays] = await Promise.all([
    getBoolSetting(RETENTION_ENABLED_KEY, false),
    getNumberSetting(RETENTION_MONTHS_KEY, RETENTION_DEFAULT_MONTHS),
    getNumberSetting(TALENT_POOL_MONTHS_KEY, TALENT_POOL_DEFAULT_MONTHS),
    getNumberSetting(WARNING_DAYS_KEY, RETENTION_WARNING_DAYS),
  ]);

  return {
    enabled,
    months: readMonths(months, RETENTION_DEFAULT_MONTHS),
    talentPoolMonths: readMonths(poolMonths, TALENT_POOL_DEFAULT_MONTHS),
    warningDays: readWarningDays(warningDays, RETENTION_WARNING_DAYS),
  };
}

function emptyCounts(): PrivacyRequestCounts {
  return { RECEIVED: 0, VERIFIED: 0, APPROVED: 0, EXECUTED: 0, DECLINED: 0 };
}

function toRequest(raw: Record<string, unknown>): PrivacyRequestRow {
  const verifier = nested<{ full_name?: string }>(raw.verifier);
  const decider = nested<{ full_name?: string }>(raw.decider);
  return {
    id: String(raw.id),
    kind: isPrivacyRequestKind(raw.kind) ? raw.kind : "access",
    email: String(raw.email ?? ""),
    note: text(raw.note),
    state: isPrivacyRequestState(raw.state) ? raw.state : "RECEIVED",
    applicationId: text(raw.application_id),
    verifiedAt: text(raw.verified_at),
    verifiedByName: verifier?.full_name ?? null,
    decidedAt: text(raw.decided_at),
    decidedByName: decider?.full_name ?? null,
    executedAt: text(raw.executed_at),
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  };
}

/**
 * The request book, newest first.
 *
 * One more than the limit is read so a full page can say it stopped rather than
 * implying the count is every request ever filed. Counts are of the rows read,
 * which is why the note says so when the read was capped.
 */
export async function readPrivacyRequests(
  restClient: PrivacyRestClient
): Promise<PrivacyRequestsRead> {
  const { data, error } = await restClient
    .from("privacy_requests")
    .select(REQUEST_SELECT)
    .order("created_at", { ascending: false })
    .limit(PRIVACY_READ_LIMIT + 1);

  if (error) {
    return {
      rows: [],
      counts: emptyCounts(),
      available: false,
      note: reason(error),
      capped: false,
      limit: PRIVACY_READ_LIMIT,
    };
  }

  const all = ((data ?? []) as Record<string, unknown>[]).map(toRequest);
  const capped = all.length > PRIVACY_READ_LIMIT;
  const rows = capped ? all.slice(0, PRIVACY_READ_LIMIT) : all;
  const counts = emptyCounts();
  for (const row of rows) counts[row.state] += 1;

  return {
    rows,
    counts,
    available: true,
    note: capped
      ? `Only the newest ${PRIVACY_READ_LIMIT} requests are shown; the counts are of those rows.`
      : null,
    capped,
    limit: PRIVACY_READ_LIMIT,
  };
}

/** The applications whose retention window is being weighed, oldest first. */
export async function readRetentionCandidates(
  restClient: PrivacyRestClient,
  options: { limit?: number; includeErased?: boolean } = {}
): Promise<RetentionRead> {
  const limit = Math.min(Math.max(options.limit ?? PRIVACY_READ_LIMIT, 1), PRIVACY_READ_LIMIT);

  let query = restClient
    .from("application_retention")
    .select(RETENTION_SELECT)
    .order("last_activity_at", { ascending: true })
    .limit(limit + 1);

  // Erased rows stay in the view as proof they were erased, but they are not
  // candidates for erasing again — re-running the function on them is a no-op
  // that would still write a trail row every night.
  if (!options.includeErased) query = query.is("erased_at", null);

  const { data, error } = await query;

  if (error) {
    return {
      rows: [],
      available: false,
      note: reason(error),
      capped: false,
      limit,
    };
  }

  const all = ((data ?? []) as Record<string, unknown>[]).map((raw) => ({
    applicationId: String(raw.application_id),
    lastActivityAt: text(raw.last_activity_at),
    stage: String(raw.stage ?? "NEW"),
    openAssessments: count(raw.open_assessments),
    openInterviews: count(raw.open_interviews),
    poolGrantedAt: text(raw.pool_granted_at),
    warnedAt: text(raw.retention_warned_at),
    archived: raw.archived_at != null,
  }));

  const capped = all.length > limit;
  return {
    rows: capped ? all.slice(0, limit) : all,
    available: true,
    note: capped
      ? `Only the ${limit} oldest records are shown; the counts are of those rows.`
      : null,
    capped,
    limit,
  };
}

/**
 * The people behind the retention rows, read in bounded chunks.
 *
 * Shared with the sweep because both need the same two facts from the same row:
 * the desk prints a name so a recruiter recognises the record, and the sweep
 * needs the address to mail the warning to. Neither question belongs in the
 * retention view, whose whole point is that it can be read without selecting
 * anybody's identity.
 */
export async function readRetentionContacts(
  restClient: PrivacyRestClient,
  rows: readonly { applicationId: string }[]
): Promise<Map<string, { fullName: string; email: string | null }>> {
  const names = new Map<string, { fullName: string; email: string | null }>();
  const ids = rows.map((row) => row.applicationId);

  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const { data, error } = await restClient
      .from("applications")
      .select("id, full_name, email")
      .in("id", chunk);

    if (error) continue;
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      names.set(String(raw.id), {
        fullName: String(raw.full_name ?? "Unknown candidate"),
        email: text(raw.email),
      });
    }
  }

  return names;
}

/**
 * Everything `/retention` renders, from one read of each list.
 *
 * The decisions come from `planRetention`, the same function the sweep calls, so
 * the date a console prints beside a row and the date the cron acts on are one
 * answer rather than two implementations that can drift apart.
 */
export async function readPrivacyDesk(
  restClient: PrivacyRestClient,
  viewer: { role: string }
): Promise<PrivacyDesk> {
  const [requests, candidates, settings] = await Promise.all([
    readPrivacyRequests(restClient),
    readRetentionCandidates(restClient),
    readPrivacySettings(),
  ]);

  const names = await readRetentionContacts(restClient, candidates.rows);
  const decisions = planRetention(candidates.rows, {
    months: settings.months,
    talentPoolMonths: settings.talentPoolMonths,
    warningDays: settings.warningDays,
    now: new Date(),
  });

  const retention: RetentionReview[] = decisions.map((decision, index) => {
    const row = candidates.rows[index];
    const person = names.get(decision.applicationId);
    return {
      ...decision,
      stage: row.stage,
      lastActivityAt: row.lastActivityAt,
      poolGrantedAt: row.poolGrantedAt,
      warnedAt: row.warnedAt,
      archived: row.archived,
      fullName: person?.fullName ?? "A record that could not be named",
      email: person?.email ?? null,
    };
  });

  const counts = { due: 0, warning: 0, held: 0 };
  for (const row of retention) {
    // A blocked row is held whatever its date says: a hired record or one with
    // live work is not "due" in any sense the sweep acts on, and counting it as
    // due would promise an erasure that can never come.
    if (row.blockedBy) counts.held += 1;
    else counts[row.status] += 1;
  }

  return {
    requests,
    retention,
    retentionNote: candidates.note,
    retentionCapped: candidates.capped,
    retentionLimit: candidates.limit,
    counts,
    settings,
    role: viewer.role,
  };
}
