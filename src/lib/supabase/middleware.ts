import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/config";
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

/** When the staff member last touched a recruiter portal page. */
const LAST_ACTIVE_COOKIE = "sdg_staff_last_active";

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

/**
 * The configured idle window in minutes.
 *
 * Read with the caller's own client: `app_settings_read` grants SELECT to
 * `is_staff()`, and this branch only runs for a session that has already been
 * confirmed to hold a staff role.
 */
async function getSessionTimeoutMinutes(supabase: SupabaseClient): Promise<number> {
  const now = Date.now();
  if (timeoutMemo && now - timeoutMemo.readAt < TIMEOUT_MEMO_MS) return timeoutMemo.minutes;

  const { data, error } = await supabase
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
 * Whether this browser carries a Supabase session cookie at all.
 *
 * `getUser()` is a network call to the auth service, and for a visitor with an
 * empty jar its only possible answer is "nobody is signed in" — which the jar
 * already says for free. Public page views are the bulk of the traffic, so this
 * is the round trip they no longer pay. A request that does carry a cookie is
 * verified exactly as before.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name, value }) => name.startsWith("sb-") && value.length > 0);
}

/**
 * Refreshes the Supabase auth cookie on every matched request so downstream
 * Server Components read a valid JWT (RLS then scopes queries per user).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Important: getUser() revalidates the token with the auth server. With no
  // session cookie in the jar there is no token to revalidate.
  let user: User | null = null;
  if (hasSessionCookie(request)) {
    user = (await supabase.auth.getUser()).data.user;
  }

  const { pathname, search } = request.nextUrl;
  /** Where to come back to: the page and the view it was showing. */
  const wanted = pathname + search;

  if (isStaffPath(pathname) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = loginSearch(wanted);
    return NextResponse.redirect(loginUrl);
  }

  // A signed-in candidate must never see recruiter analytics.
  if (user && isStaffPath(pathname)) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (profile && !STAFF_ROLES.has(profile.role)) {
      const portalUrl = request.nextUrl.clone();
      portalUrl.pathname = "/portal";
      portalUrl.search = "?denied=staff-only";
      return NextResponse.redirect(portalUrl);
    }

    // Settings → Security → Session timeout. A staff session that has not touched
    // the portal for longer than the window is dropped here rather than in a
    // client timer, so closing a tab or locking a machine cannot keep it alive.
    const timeoutMinutes = await getSessionTimeoutMinutes(supabase);
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
      for (const { name } of request.cookies.getAll()) {
        if (name.startsWith("sb-")) signedOut.cookies.delete(name);
      }
      signedOut.cookies.delete(LAST_ACTIVE_COOKIE);
      return signedOut;
    }

    response.cookies.set(LAST_ACTIVE_COOKIE, String(now), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Longer than the longest configurable window so an absent cookie never
      // reads as "active" for a session that has actually idled out.
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  return response;
}