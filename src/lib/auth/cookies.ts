import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mintSessionToken } from "@/lib/auth/token";
import { appConfig } from "@/lib/config";

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

/**
 * Whether to mark the cookies `Secure`.
 *
 * This replaced `secure: process.env.NODE_ENV === "production"`, which was wrong
 * in both directions and whose companion comment ("production terminates TLS at
 * the gateway, Plan 2") the stack disproves: `docker/app/Dockerfile` bakes
 * `NODE_ENV=production` into the runner image while nginx serves plain HTTP on
 * `127.0.0.1:${NGINX_PORT}`, so the flag went out over plaintext and survived
 * only because `localhost` is a trustworthy origin. On the LAN origin the same
 * compose file recommends (`APP_URL_PUBLIC`), a `Secure` cookie on plain HTTP is
 * dropped by the browser: sign-in answers `ok:true` and the portal bounces
 * straight back to `/login` with no server-side error.
 *
 * So the flag now follows the origin the stack actually advertises, and one
 * operator setting decides both: `appConfig.url` is what candidate links are
 * built from (`src/lib/config.ts:88`), and it is also what decides whether the
 * cookie may require TLS — a box that sets `APP_URL=https://…` gets `Secure`
 * without knowing the override below exists. `COOKIE_SECURE` wins when set to
 * `true`/`false` for the cases where the advertised origin and the transport
 * genuinely differ (a TLS-terminating proxy in front of a plain-HTTP `APP_URL`,
 * or a deliberate plaintext test host).
 */
function shouldMarkCookieSecure(): boolean {
  const flag = (process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  try {
    return new URL(appConfig.url).protocol === "https:";
  } catch {
    // An `APP_URL` with no parseable protocol cannot promise TLS, so it does not
    // get to set a flag that makes the cookie unsendable. `appConfig.url`
    // already falls back to `http://localhost:3000` when the variable is empty;
    // this is the malformed-value case (`localhost:3000`, a bare host).
    return false;
  }
}

/** The attributes the two writes share — only the lifetime differs per cookie. */
function cookieAttributes(maxAge: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldMarkCookieSecure(),
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
