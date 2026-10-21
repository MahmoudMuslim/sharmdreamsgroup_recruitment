import { NextResponse, type NextRequest } from "next/server";
import { createRestClient } from "@/lib/rest/client";
import { verifySessionToken } from "@/lib/auth/token";
import {
  LAST_ACTIVE_COOKIE,
  SESSION_COOKIE,
  clearSession,
  writeSession,
} from "@/lib/auth/cookies";
import { loginSearch } from "@/lib/auth/login-target";
import { isStaffPath } from "@/lib/auth/staffRoutes";
import { coerceNumber } from "@/modules/settings/infrastructure/settingsReader";

const STAFF_ROLES = new Set(["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"]);

/**
 * `security.session_timeout_minutes` fallback, matching the seeded row.
 *
 * Used only when the read fails or the row is unreadable, so a database hiccup
 * leaves the timeout at the value the platform ships with rather than signing
 * every recruiter out on a short window.
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 480;

/**
 * How long the proxy remembers the idle window between requests.
 *
 * `readGlobalSettings` is cached for the render, but the proxy runs outside it
 * and cannot use `"use cache"`, and one portal click fires this file once per
 * matched request. Without a memo the same GLOBAL row was read on every one of
 * them. A saved timeout therefore takes up to a minute to bite here — the bound
 * the cached render reads already accept.
 */
const TIMEOUT_MEMO_MS = 60_000;

let timeoutMemo: { minutes: number; readAt: number } | null = null;

function restBaseUrl(): string {
  const base = process.env.REST_BASE_URL;
  if (!base) throw new Error("[guard] REST_BASE_URL is not set.");
  return base;
}

/**
 * The configured idle window in minutes.
 *
 * `app_settings_read` grants SELECT to `is_staff()`, and this only runs for a
 * bearer whose role claim is `authenticated`, so the read is made with that
 * same bearer — no service token is minted for a request that has not earned one.
 */
async function getSessionTimeoutMinutes(token: string): Promise<number> {
  const now = Date.now();
  if (timeoutMemo && now - timeoutMemo.readAt < TIMEOUT_MEMO_MS) return timeoutMemo.minutes;

  const api = createRestClient({ baseUrl: restBaseUrl(), token });
  const { data, error } = await api
    .from("app_settings")
    .select("value")
    .eq("scope", "GLOBAL")
    .eq("key", "security.session_timeout_minutes")
    .maybeSingle();

  const minutes = coerceNumber(data?.value, DEFAULT_SESSION_TIMEOUT_MINUTES);
  // A read that failed is not remembered, so a database hiccup cannot pin the
  // shipped default for the next minute.
  if (!error) timeoutMemo = { minutes, readAt: now };
  return minutes;
}

/**
 * How long the proxy remembers a bearer's profile role between requests.
 *
 * The proxy runs outside the RSC render, so the React `cache()` around
 * `getSessionUser` never spans it: the guard paid its own `user_profiles` round
 * trip on every staff-path click while the page render paid a second. The verdict
 * is memoized per auth user for the same bound the idle-window read already
 * accepts. It decides only the coarse candidate bounce; the authoritative gate is
 * `requireStaff`, which reads the role fresh through RLS on every render, so a
 * demotion landing mid-window is still refused at the page and at the row.
 */
const ROLE_MEMO_MS = 60_000;
const ROLE_MEMO_MAX = 512;
const roleMemo = new Map<string, { role: string | null; readAt: number }>();

function rememberRole(sub: string, role: string | null, now: number): void {
  // A process-lifetime Map keyed by every session's `sub` needs a bound. Drop the
  // entries already past their window, then the single oldest, so the memo cannot
  // grow without limit while the portal is up.
  if (roleMemo.size >= ROLE_MEMO_MAX) {
    for (const [key, entry] of roleMemo) {
      if (now - entry.readAt >= ROLE_MEMO_MS) roleMemo.delete(key);
      if (roleMemo.size < ROLE_MEMO_MAX) break;
    }
    if (roleMemo.size >= ROLE_MEMO_MAX) {
      const oldest = roleMemo.keys().next().value;
      if (oldest !== undefined) roleMemo.delete(oldest);
    }
  }
  roleMemo.set(sub, { role, readAt: now });
}

/**
 * The profile's role, memoized per auth user, or `null` for "no row or unreadable".
 *
 * A failed read is returned as `null` and NOT remembered — pinning "not staff"
 * for a minute on a gateway blip would bounce a recruiter whose own page would
 * admit them, the same reason the timeout memo refuses to remember an error. Both
 * `null` outcomes (refused read, missing row) fall through to `requireStaff`,
 * which is fresh and RLS-gated.
 */
async function getStaffRole(token: string, sub: string): Promise<string | null> {
  const now = Date.now();
  const hit = roleMemo.get(sub);
  if (hit && now - hit.readAt < ROLE_MEMO_MS) return hit.role;

  const api = createRestClient({ baseUrl: restBaseUrl(), token });
  const { data, error } = await api
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", sub)
    .maybeSingle();

  if (error) {
    console.warn("[guard] staff role read failed; falling through to requireStaff", error.message);
    return null;
  }
  const role = (data?.role as string | undefined) ?? null;
  // `createRestClient` answers an unreachable gateway with `{ data: null, error }`
  // rather than a throw, so this logged warning is the only trace the bounce
  // failure mode leaves; silence would read as "no candidate got in".
  rememberRole(sub, role, now);
  return role;
}

export async function guardRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const wanted = pathname + search;

  const bearer = request.cookies.get(SESSION_COOKIE)?.value;
  // Local HMAC verify — this replaced a network call to the auth service.
  const verified = bearer ? await verifySessionToken(bearer) : null;
  // A signature that checks is not yet a session. `role` only picks which
  // Postgres role `authenticator` switches into, and the RLS predicates key off
  // `auth.uid()` and `is_staff()` — measured in Task 8's review, an `anon`-role
  // token carrying a staff `sub` reads the same rows as an `authenticated` one,
  // while a `service_role` token reaches `jobs` outright, where a staff token is
  // refused with 403. This app mints `authenticated` at sign-in and nothing else,
  // so any other role on a request is a hand-made jar and is dropped exactly like
  // an expired one. Task 16's cron token never reaches this code path.
  const claims = verified?.role === "authenticated" ? verified : null;

  if (isStaffPath(pathname) && !claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = loginSearch(wanted);
    return NextResponse.redirect(loginUrl);
  }

  // `!bearer` cannot be true when `claims` is set — the compiler just cannot see
  // the link, and this is the one place worth spelling it out rather than using a
  // non-null assertion, because a stale bearer is exactly what a 401 looks like.
  if (!claims || !bearer || !isStaffPath(pathname)) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  // A signed-in candidate must never see recruiter analytics. The role is
  // memoized per auth user above; a `null` (no row or a failed read) falls
  // through to the page-level `requireStaff`, the authoritative fresh gate.
  const role = await getStaffRole(bearer, claims.sub);

  if (role && !STAFF_ROLES.has(role)) {
    const portalUrl = request.nextUrl.clone();
    portalUrl.pathname = "/portal";
    portalUrl.search = "?denied=staff-only";
    return NextResponse.redirect(portalUrl);
  }

  // Settings → Security → Session timeout. A staff session that has not touched
  // the portal for longer than the window is dropped here rather than in a
  // client timer, so closing a tab or locking a machine cannot keep it alive.
  const timeoutMinutes = await getSessionTimeoutMinutes(bearer);
  const now = Date.now();
  const lastActive = Number(request.cookies.get(LAST_ACTIVE_COOKIE)?.value);

  if (
    timeoutMinutes > 0 &&
    Number.isFinite(lastActive) &&
    lastActive > 0 &&
    now - lastActive > timeoutMinutes * 60_000
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = loginSearch(wanted, "idle");
    const signedOut = NextResponse.redirect(loginUrl);
    // Clearing the cookies is a local sign-out: this browser loses the session
    // while any other device the staff member uses keeps theirs.
    clearSession(signedOut);
    return signedOut;
  }

  const response = NextResponse.next({ request: { headers: request.headers } });
  await writeSession(response, claims.sub);
  return response;
}
