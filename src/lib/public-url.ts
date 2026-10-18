import "server-only";

import { headers } from "next/headers";

import { appConfig } from "./config";

/**
 * The origin a candidate-facing link has to carry.
 *
 * `APP_URL` is the only honest source of this on a deployed site, but it is a
 * copy of the truth kept in a file nobody opens again: a stale value here is
 * what sent applicants a `localhost` test link while the portal they signed in
 * on was somewhere else entirely. So on a development machine, where the app
 * moves ports as often as the person working on it does, the request already
 * being served is asked what host it arrived on and that answer wins.
 *
 * Two conditions keep that safe, and both matter. The request is only asked in
 * development, so the `Host` header — which the caller controls — can never
 * steer a link on a deployed site. And a loopback configured URL is what marks
 * "this is a machine on the same desk": a site that sets `APP_URL` properly is
 * answered from the env alone, and one deployed without it keeps its localhost
 * value rather than taking its origin from whoever knocked. That deployment
 * still mails a link no candidate can open, and this helper does not try to
 * notice on the recruiter's behalf — the fix there is to set `APP_URL`, which is
 * the one value nobody else can state correctly.
 *
 * Every link is rendered when the recruiter clicks, never when a queue drains,
 * so this is always called inside a request and no fallback host is needed for
 * a background job. If a call ever lands outside one, the configured URL is
 * returned unchanged rather than a guess.
 */
/** Hostnames that mean "this machine", in any spelling a developer used. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export async function publicBaseUrl(): Promise<string> {
  const configured = appConfig.url.replace(/\/+$/, "");
  if (!isLoopbackUrl(configured)) return configured;

  if (process.env.NODE_ENV === "production") return configured;

  return (await requestOrigin()) ?? configured;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** The host this very request came in on, or null outside a request. */
async function requestOrigin(): Promise<string | null> {
  let host: string | null;
  let forwardedProto: string | null;

  try {
    const bag = await headers();
    host = bag.get("host");
    forwardedProto = bag.get("x-forwarded-proto");
  } catch {
    return null;
  }

  if (!host) return null;

  // A proxy may list several protocols for the hops it saw; the first is the one
  // the candidate's browser was handed.
  const proto = forwardedProto?.split(",")[0]?.trim();
  return `${proto === "https" || proto === "http" ? proto : "http"}://${host}`;
}

/** The `/test/<token>` page a candidate is pointed at. */
export async function assessmentUrl(accessToken: string): Promise<string> {
  return `${await publicBaseUrl()}/test/${accessToken}`;
}
