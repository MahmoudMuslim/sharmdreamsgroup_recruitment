"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { hasAiProvider } from "@/lib/config.server";
import {
  UNGRADED_ATTEMPT_EMBED,
  UNGRADED_ATTEMPT_FILTER,
  UNSCORED_ATTEMPT_STATUS,
} from "@/modules/candidates/domain/listFilters";
import {
  agendaWindow,
  AGENDA_APPLICATION_EMBED,
  AGENDA_FUTURE_DAYS,
  PENDING_INTERVIEW_STATUS,
} from "@/app/(admin)/interviews/agenda-model";
import {
  DELIVERED_LOG_CHANNELS,
  type QueueStatus,
} from "@/app/(admin)/whatsapp/outbox-model";
import { getAiAutomationSettings } from "@/modules/screening/application/screen-application";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

/* -------------------------------------------------------------------------- */
/* Shared                                                     types           */
/* -------------------------------------------------------------------------- */

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface PortalSearchResult {
  ok: boolean;
  error?: string;
  candidates: SearchHit[];
  jobs: SearchHit[];
  prospects: SearchHit[];
}

export interface StaffAlert {
  id: string;
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: "info" | "warn" | "danger";
}

export interface StaffAlertsResult {
  ok: boolean;
  error?: string;
  alerts: StaffAlert[];
}

/** Rows per record type — enough to scan, small enough to stay a dropdown. */
const HIT_LIMIT = 5;

/**
 * Strips the characters PostgREST reads as filter syntax.
 *
 * A comma or parenthesis would end the `or=(…)` arm early and let the rest of
 * the term be parsed as a filter, and `%` / `_` are ilike wildcards — a user
 * typing an underscore would otherwise match every record that has one anywhere.
 */
function filterTerm(raw: string): string {
  return raw
    .replace(/[%,()]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Resolves the session and refuses anyone who is not staff.
 *
 * An action cannot `redirect()` the way a page guard does, so a missing or
 * non-staff session comes back as a readable error the panel renders instead.
 */
async function staffActor() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has ended. Sign in again to search." } as const;
  if (!isStaff(user.role)) return { error: "Only recruiter accounts can use the portal search." } as const;
  return { user } as const;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

interface ApplicationHitRow {
  id: string;
  full_name: string;
  email: string;
  tracking_code: string;
  stage: string;
  job_openings?: { title?: string } | { title?: string }[] | null;
}

interface JobHitRow {
  id: string;
  title: string;
  department: string;
  status: string;
}

interface ProspectHitRow {
  id: string;
  full_name: string;
  email: string | null;
  company: string | null;
  stage: string;
}

/** Pulls the joined opening's title out of whichever shape PostgREST returned. */
function joinText<T extends object>(
  value: T | T[] | null | undefined,
  pick: (row: T) => string | null | undefined
): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return null;
  const text = pick(row);
  return text && text.length > 0 ? text : null;
}

/**
 * One box, three record types, all through the session's RLS.
 *
 * Nothing is cached here: the recruiter's view of the pipeline changes as
 * colleagues move stages, and a stale dropdown is worse than a short wait.
 */
export async function searchPortal(term: string): Promise<PortalSearchResult> {
  const empty: PortalSearchResult = { ok: true, candidates: [], jobs: [], prospects: [] };
  const actor = await staffActor();
  if ("error" in actor) return { ...empty, ok: false, error: actor.error };

  const query = filterTerm(term ?? "");
  if (query.length < 2) return empty;

  const like = `%${query}%`;
  const supabase = await createSupabaseServerClient();

  const [candidatesResult, jobsResult, prospectsResult] = await Promise.all([
    supabase
      .from("applications")
      .select("id, full_name, email, tracking_code, stage, job_openings(title)")
      .is("archived_at", null)
      .or(
        `full_name.ilike.${like},email.ilike.${like},tracking_code.ilike.${like}`
      )
      .order("created_at", { ascending: false })
      .limit(HIT_LIMIT),
    supabase
      .from("job_openings")
      .select("id, title, department, status")
      .or(`title.ilike.${like},department.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(HIT_LIMIT),
    supabase
      .from("sourced_prospects")
      .select("id, full_name, email, company, stage")
      .or(`full_name.ilike.${like},email.ilike.${like},company.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(HIT_LIMIT),
  ]);

  const error =
    candidatesResult.error ?? jobsResult.error ?? prospectsResult.error ?? null;
  if (error) {
    return { ...empty, ok: false, error: `Search failed: ${error.message}` };
  }

  const candidates: SearchHit[] = (candidatesResult.data ?? []).map((row) => {
    const hit = row as ApplicationHitRow;
    const opening = joinText(hit.job_openings, (job) => job.title);
    return {
      id: hit.id,
      title: hit.full_name,
      subtitle: `${hit.stage}${opening ? ` · ${opening}` : ""} · ${hit.tracking_code}`,
      // The row's own id, so the hit lands on that person's profile page — which
      // is keyed by their address and lists every opening they hold.
      href: `/candidates/${hit.id}`,
    };
  });

  const jobs: SearchHit[] = (jobsResult.data ?? []).map((row) => {
    const hit = row as JobHitRow;
    return {
      id: hit.id,
      title: hit.title,
      subtitle: `${hit.department} · ${hit.status.toLowerCase().replace("_", " ")}`,
      href: `/jobs?job=${encodeURIComponent(hit.id)}`,
    };
  });

  const prospects: SearchHit[] = (prospectsResult.data ?? []).map((row) => {
    const hit = row as ProspectHitRow;
    return {
      id: hit.id,
      title: hit.full_name,
      subtitle: [hit.company, hit.email, hit.stage.toLowerCase()]
        .filter(Boolean)
        .join(" · "),
      href: `/sourcing?prospect=${encodeURIComponent(hit.id)}`,
    };
  });

  return { ok: true, candidates, jobs, prospects };
}

/* -------------------------------------------------------------------------- */
/* Attention feed                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Counts over the tables a recruiter is responsible for.
 *
 * Nothing here is stored on the server: each row is a live count of records
 * waiting on a person right now, and it links to the page where that work is
 * done. Read all and Clear all quiet the list in this browser only, at the
 * number the recruiter was shown — `src/lib/alert-ack.ts` explains why an ack
 * cannot live in the database.
 */
export async function getStaffAlerts(): Promise<StaffAlertsResult> {
  const actor = await staffActor();
  if ("error" in actor) return { ok: false, error: actor.error, alerts: [] };

  const supabase = await createSupabaseServerClient();
  // One instant for the interview row and the page it links to: the agenda slices
  // the same window this count is measured against.
  const agenda = agendaWindow();

  const [newApplications, ungraded, upcoming, failedSends, parkedJobs] =
    await Promise.all([
      // Counted over the same two columns the candidates page filters on for
      // `?stage=NEW`, and with the same head-count shape as its rail: the number
      // on this row is the number on the New chip, not a recent slice of it. A
      // 7-day window here used to promise "waiting" while hiding every older
      // application still sitting in New — a stale lead is still a lead.
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("stage", "NEW")
        .is("archived_at", null),
      // Counted over `applications` with the same `!inner` embed the candidates
      // page reads for `?ungraded=1`, so the number on this row is the number of
      // rows the recruiter lands on. Counting `candidate_attempts` directly — the
      // old query — measured attempts on filed-away records too, and the page it
      // linked to was filtered by pipeline stage, which is a different set again.
      supabase
        .from("applications")
        .select(`id, ${UNGRADED_ATTEMPT_EMBED}`, { count: "exact", head: true })
        .is("archived_at", null)
        .eq(UNGRADED_ATTEMPT_FILTER, UNSCORED_ATTEMPT_STATUS),
      // `SCHEDULED` inside [now, now + the agenda's horizon] — exactly the slice
      // the landing view shows once the alert's own `?range=upcoming&status=`
      // rails are applied. Before this the count had no horizon and the widest
      // range on the page stopped at 30 days, so a panel booked for next quarter
      // was counted here and unshowable there. The `!inner` embed matches the one
      // requirement the agenda applies before it lists a row: a candidate this
      // recruiter can open.
      supabase
        .from("interview_schedules")
        .select(`id, ${AGENDA_APPLICATION_EMBED}`, { count: "exact", head: true })
        .eq("status", PENDING_INTERVIEW_STATUS)
        .gte("scheduled_at", agenda.now)
        .lte("scheduled_at", agenda.future),
      // Every send the channel refused, over the whole log rather than a 7-day
      // slice: a message that never reached a candidate is still a message that
      // never reached them a month later. `?failed=1` reads this exact predicate
      // per channel, so the number here is the number of rows on screen.
      supabase
        .from("communication_logs")
        .select("id", { count: "exact", head: true })
        .eq("direction", "OUTBOUND")
        .eq("delivered", false)
        .in("channel", [...DELIVERED_LOG_CHANNELS]),
      supabase
        .from("scheduled_whatsapp_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "FAILED" satisfies QueueStatus),
    ]);

  const results = [newApplications, ungraded, upcoming, failedSends, parkedJobs];
  const failure = results.find((result) => result.error);
  if (failure?.error) {
    return {
      ok: false,
      error: `Attention feed unavailable: ${failure.error.message}`,
      alerts: [],
    };
  }

  const [newCount, ungradedCount, upcomingCount, failedCount, parkedCount] =
    results.map((result) => result.count ?? 0);

  // Exactly the gates the Integrity report applies to its own two controls, asked
  // here so this feed never points at something the reader cannot open.
  const [mayGrade, scoresMasked, automation] = await Promise.all([
    hasPermissionForUser("assessments.grade"),
    scoresAreMaskedForCurrentUser(),
    getAiAutomationSettings(),
  ]);
  const mayAwardMarks = mayGrade && !scoresMasked;
  // The retry button is rendered only when the engine can actually run, so a
  // reader whose AI grading is switched off must not be promised a pass.
  const mayRetryGrading = mayGrade && automation.aiEnabled && hasAiProvider();
  const gradingHint = [
    mayRetryGrading ? "ask the AI to grade the open answers again" : null,
    mayAwardMarks ? "award the marks yourself" : null,
  ].filter(Boolean);

  const alerts: StaffAlert[] = [
    {
      id: "new-applications",
      label: "Applications waiting in New",
      // Names the door it opens rather than a window the query no longer applies:
      // the page's New chip runs the same count, so clicking through lands on the
      // rows this number described, newest first.
      detail: "The pipeline lists them under its New chip, which counts the same query",
      count: newCount,
      href: "/candidates?stage=NEW",
      tone: "info",
    },
    {
      id: "ungraded",
      label: "Assessments submitted, not graded",
      // One row per candidate counted here: the count and this link are the same
      // query, the candidates page read through its `!inner` attempt filter. What
      // a recruiter can do about it depends on them, not the queue, so the hint
      // lists only the doors this reader would actually find open on the report.
      detail: gradingHint.length
        ? `Each is a candidate still sitting in Submitted. From their Integrity report, ${gradingHint.join(" or ")}`
        : "Each is a candidate still sitting in Submitted. The AI grades on submit, so a queue here means grading never finished",
      count: ungradedCount,
      href: "/candidates?ungraded=1",
      tone: "info",
    },
    {
      id: "upcoming-interviews",
      label: "Interviews still on the calendar",
      // Names the window the number is bounded by, so a recruiter who expects the
      // whole diary is not surprised by the agenda's shorter reach.
      detail: `Awaiting an outcome in the next ${AGENDA_FUTURE_DAYS} days — the agenda reads no further`,
      count: upcomingCount,
      href: "/interviews?range=upcoming&status=SCHEDULED",
      tone: "info",
    },
    {
      id: "failed-sends",
      label: "Messages that did not reach the candidate",
      // Channel-scoped and no longer windowed: an `IN_APP` notice is written to an
      // inbox rather than relayed, so it can never belong here, and a refusal from
      // last month is still a refusal. `?failed=1` opens the delivery log and the
      // email panel on exactly these rows.
      detail:
        "WhatsApp and email the channel refused — a parked alert appears here too, as its final failure",
      count: failedCount,
      href: "/whatsapp?failed=1",
      tone: "danger",
    },
    {
      id: "parked-jobs",
      label: "Queued alerts parked after retries",
      // A different table and a different verb: these still have a queue row a
      // person can re-arm, which is why the same incident also sits in the count
      // above. The outbox says so on both lists, so the feed is never read as
      // twice the work it is.
      detail: "The dispatcher gave up on these — retrying re-arms the same job",
      count: parkedCount,
      href: "/whatsapp?bucket=FAILED",
      tone: "warn",
    },
  ];

  return { ok: true, alerts };
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

export interface MyProfile {
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  locale: string;
  company: string | null;
  since: string | null;
}

export interface MyProfileResult {
  ok: boolean;
  error?: string;
  profile?: MyProfile;
}

/**
 * The signed-in recruiter's own record, plus the company it belongs to.
 *
 * Read with the session client: RLS already limits `user_profiles` to the
 * caller's row and staff-visible rows, so no filter is added here.
 */
export async function getMyProfile(): Promise<MyProfileResult> {
  const actor = await staffActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const supabase = await createSupabaseServerClient();

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("full_name, email, phone, role, locale, created_at, tenant_id")
    .eq("auth_user_id", actor.user.authUserId)
    .maybeSingle();

  if (error) return { ok: false, error: `Profile could not be read: ${error.message}` };
  if (!profile) return { ok: false, error: "No profile row is linked to this sign-in." };

  const tenantId = profile.tenant_id as string | null;
  let company: string | null = null;

  if (tenantId) {
    const { data: tenant } = await supabase
      .from("tenants_and_companies")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();
    company = tenant?.name ?? null;
  }

  return {
    ok: true,
    profile: {
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone ?? null,
      role: profile.role,
      locale: profile.locale,
      company,
      since: (profile.created_at as string | null) ?? null,
    },
  };
}
