import { NextResponse } from "next/server";
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
 * The bearer's lifetime in seconds, used for its `exp` and for the
 * `sdg_session` cookie's `maxAge` together.
 *
 * Those two must be equal: a cookie that outlives its bearer reads as "signed
 * in" while every query 401s, and a bearer that outlives its cookie is
 * unreachable.
 *
 * The value is 24 hours because `security.session_timeout_minutes` is
 * operator-configurable from 15 to 1440 minutes
 * (`src/modules/settings/domain/schema.ts:235-236`, seeded at 480), and the
 * idle timeout is enforced by Task 13's proxy by comparing that window against
 * `sdg_staff_last_active`. A one-hour bearer would sign an unread dashboard tab
 * out at 60 minutes on an 8-hour setting: the bearer's expiry becomes the de
 * facto timeout and the setting stops meaning anything. At 86_400 the bearer
 * lives exactly as long as the longest window staff can configure, so the idle
 * check always bites first or at the same instant. Task 8's 15-minute default
 * would be worse still, silently signing an idle tab out every quarter-hour
 * regardless of any setting.
 *
 * This is a ceiling on an *idle* gap, not on a session's length — Task 13
 * re-mints the bearer on every staff request, so an active staff member never
 * sees it.
 */
const SESSION_TTL_SECONDS = 86_400;

/**
 * The idle stamp lives 30 days, deliberately longer than the bearer it
 * accompanies.
 *
 * That is counter-intuitive after the rule above, but the proxy reads the stamp
 * as `Number(request.cookies.get(LAST_ACTIVE_COOKIE)?.value)` and skips the
 * idle branch entirely when the result is not finite
 * (`guardRequest`'s `Number.isFinite(lastActive)` guard), so an *absent* stamp
 * reads as "active". A stamp that expired before its session would therefore
 * disable the timeout instead of enforcing it. 30 days is what the `writeSession`
 * call at the end of `guardRequest` already writes for this same cookie name, so
 * the two writers agree — `startSession` and `writeSession` below share this
 * `LAST_ACTIVE_TTL_SECONDS`, and the proxy imports `LAST_ACTIVE_COOKIE` rather
 * than carrying its own `sdg_staff_last_active` string literal.
 */
const LAST_ACTIVE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The attributes the two writes share — only the lifetime differs per cookie. */
function cookieAttributes(maxAge: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    // Locally this is http://localhost and the flag would make the cookie
    // unsendable; production terminates TLS at the gateway (Plan 2) and sets it.
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  jar.set(SESSION_COOKIE, token, cookieAttributes(SESSION_TTL_SECONDS));
  // Stamp activity at the door so the first portal request after sign-in is not
  // itself judged as an idle one.
  jar.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes(LAST_ACTIVE_TTL_SECONDS));
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LAST_ACTIVE_COOKIE);
}

/** Set the bearer and stamp activity on a response the proxy is about to return. */
export async function writeSession(
  response: NextResponse,
  userId: string,
): Promise<void> {
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  response.cookies.set(SESSION_COOKIE, token, cookieAttributes(SESSION_TTL_SECONDS));
  response.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes(LAST_ACTIVE_TTL_SECONDS));
}

/** Drop both, on any response — including the redirect the idle timeout returns. */
export function clearSession(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(LAST_ACTIVE_COOKIE);
}
