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

  const api = createRestClient({ baseUrl: restBaseUrl(), token: bearer });

  // A signed-in candidate must never see recruiter analytics.
  //
  // `error` is logged, not branched on: "row missing" and "read refused" must
  // both fall through to the page-level `requireStaff` (difference #3), but
  // `createRestClient` answers an unreachable gateway with
  // `{ data: null, error }` rather than a throw, so a logged error is the only
  // trace this gate's failure mode leaves. Silence here reads as "no candidate
  // got in", and the bounce would have stopped enforcing without anyone seeing.
  const { data: profile, error: profileError } = await api
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", claims.sub)
    .maybeSingle();
  if (profileError) {
    console.warn("[guard] staff role read failed; falling through to requireStaff", profileError.message);
  }

  if (profile && !STAFF_ROLES.has(profile.role)) {
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
