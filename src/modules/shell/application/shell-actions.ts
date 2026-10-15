"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser, isStaff } from "@/lib/auth/session";

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

/** How far back the attention feed counts activity as still "needs you". */
const RECENT_WINDOW_DAYS = 7;

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

function recentCutoff(): string {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
      // `?c=` is the tracking-code deep link the candidate page already honours,
      // so the row opens exactly this applicant rather than the whole list.
      href: `/candidates?c=${encodeURIComponent(hit.tracking_code)}`,
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
 * This is deliberately not an inbox: nothing here is stored, acknowledged or
 * delivered. Each row is a live count of records that are waiting on a person
 * right now, and it links to the page where that work is actually done.
 */
export async function getStaffAlerts(): Promise<StaffAlertsResult> {
  const actor = await staffActor();
  if ("error" in actor) return { ok: false, error: actor.error, alerts: [] };

  const supabase = await createSupabaseServerClient();
  const since = recentCutoff();
  const now = new Date().toISOString();

  const [newApplications, ungraded, upcoming, failedSends, parkedJobs] =
    await Promise.all([
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("stage", "NEW")
        .is("archived_at", null)
        .gte("created_at", since),
      supabase
        .from("candidate_attempts")
        .select("id", { count: "exact", head: true })
        .eq("status", "SUBMITTED"),
      supabase
        .from("interview_schedules")
        .select("id", { count: "exact", head: true })
        .eq("status", "SCHEDULED")
        .gte("scheduled_at", now),
      supabase
        .from("communication_logs")
        .select("id", { count: "exact", head: true })
        .eq("direction", "OUTBOUND")
        .eq("delivered", false)
        .in("channel", ["WHATSAPP", "EMAIL"])
        .gte("created_at", since),
      supabase
        .from("scheduled_whatsapp_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "FAILED"),
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

  const alerts: StaffAlert[] = [
    {
      id: "new-applications",
      label: "Applications waiting in New",
      detail: `Filed in the last ${RECENT_WINDOW_DAYS} days`,
      count: newCount,
      href: "/candidates?stage=NEW",
      tone: "info",
    },
    {
      id: "ungraded",
      label: "Assessments submitted, not graded",
      detail: "Open the Assessment stage to run AI screening",
      count: ungradedCount,
      href: "/candidates?stage=ASSESSMENT",
      tone: "info",
    },
    {
      id: "upcoming-interviews",
      label: "Interviews still on the calendar",
      detail: "Scheduled from now onwards",
      count: upcomingCount,
      href: "/interviews",
      tone: "info",
    },
    {
      id: "failed-sends",
      label: "Messages that did not reach the candidate",
      detail: `Outbound WhatsApp and email undelivered for ${RECENT_WINDOW_DAYS} days`,
      count: failedCount,
      href: "/whatsapp",
      tone: "danger",
    },
    {
      id: "parked-jobs",
      label: "Queued alerts parked after retries",
      detail: "The dispatcher gave up on these",
      count: parkedCount,
      href: "/whatsapp",
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
