import { cookies } from "next/headers";
import { mintSessionToken } from "@/lib/auth/token";

/** The one cookie name for a staff session, and the signed bearer stored under
 * it. httpOnly, so no script on any page can read it.
 *
 * Task 12's writer, Task 13's proxy and Task 15's browser proof all read the
 * name from here; a literal repeated in five files is how a cookie gets
 * renamed in four of them. */
export const SESSION_COOKIE = "sdg_session";

/** When this browser last touched a staff page. Read by the proxy's idle timeout. */
export const LAST_ACTIVE_COOKIE = "sdg_staff_last_active";

/**
 * Session lifetime in seconds, used for the bearer's `exp` and the cookie's
 * `maxAge` together.
 *
 * They must be equal: a cookie that outlives its bearer reads as "signed in"
 * while every query 401s, and a bearer that outlives its cookie is unreachable.
 * One hour rather than Task 8's 15-minute default because the proxy re-mints on
 * every staff request (Task 13), so this is the ceiling on an *idle* gap, not on
 * a session's length — the idle ceiling staff can actually configure is
 * `security.session_timeout_minutes`, whose seeded default is 480. A 15-minute
 * bearer would silently sign out an unread dashboard tab every quarter-hour
 * regardless of that setting.
 */
const SESSION_TTL_SECONDS = 3600;

function cookieAttributes() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    // Locally this is http://localhost and the flag would make the cookie
    // unsendable; production terminates TLS at the gateway (Plan 2) and sets it.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  jar.set(SESSION_COOKIE, token, cookieAttributes());
  // Stamp activity at the door so the first portal request after sign-in is not
  // itself judged as an idle one.
  jar.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes());
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LAST_ACTIVE_COOKIE);
}
