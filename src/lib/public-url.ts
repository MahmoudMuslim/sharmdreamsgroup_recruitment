import "server-only";

import { networkInterfaces } from "node:os";

import { headers } from "next/headers";

import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";

import { appConfig } from "./config";

/**
 * The origin a candidate-facing link has to carry.
 *
 * "The host this server is on" is not one question. On a deployed site it is the
 * domain the portal answers on; on a recruiter's laptop it is `localhost`, which
 * is the one address guaranteed to be unreachable from the phone the link is
 * being sent to. So the answer is taken in the order of who is entitled to give
 * it:
 *
 * 1. The address stated in Settings → General → Public site address. Nobody but
 *    the group can say where the portal is published, and this is the only
 *    answer that survives a WhatsApp job drained by cron hours later, with no
 *    request left to ask.
 * 2. `APP_URL`, when it names a real host rather than this machine.
 * 3. The host this very request arrived on. A recruiter already browsing the
 *    deployed portal needs nothing told.
 * 4. On a development machine only, the LAN address this server listens on, so
 *    a link texted to a phone on the same network opens. It is a guess, and it
 *    is only made where the alternative is a `localhost` link that cannot work
 *    for anybody except the person who clicked it.
 *
 * Only step 4 is refused in production: a guess about which network adapter a
 * server happens to be plugged into has no business deciding where a deployed
 * portal lives.
 *
 * Step 3 is honoured everywhere, and that is a trade worth naming. The `Host`
 * header belongs to whoever knocked, so a forged one could put an attacker's
 * domain in front of a real access token — and that token is the whole
 * credential for sitting the test. It is asked last for exactly that reason: a
 * deployment that states its address in Settings or in `APP_URL` never consults
 * the request at all, and reaching step 3 means neither was stated, where the
 * alternative is a `localhost` link no candidate can open. Every caller is also
 * already behind a signed-in recruiter or the cron secret, so a forger has to be
 * authenticated to poison anything.
 */

/** The setting the group states its published address under. */
const PUBLIC_URL_KEY = "organisation.public_url";

/** Hostnames that mean "this machine", in any spelling a developer used. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Adapters that are a virtual switch rather than a network another device could
 * be on. Picking one of these would hand a candidate an address that resolves
 * nowhere outside this machine, which is the same failure as `localhost` with
 * extra confidence.
 */
const VIRTUAL_ADAPTERS = /docker|veth|vmware|virtualbox|loopback|tunnel|tap|^br-/i;

export async function publicBaseUrl(): Promise<string> {
  const configured = trimTrailingSlashes(appConfig.url);

  const stated = trimTrailingSlashes(await getStringSetting(PUBLIC_URL_KEY, ""));
  if (isHttpOrigin(stated)) return stated;

  if (!isLoopback(configured)) return configured;

  const origin = await requestOrigin();
  if (origin && !isLoopback(origin)) return origin;

  if (process.env.NODE_ENV !== "production") {
    const port = explicitPort(origin) ?? explicitPort(configured) ?? process.env.PORT ?? null;
    const lan = lanOrigin(port);
    if (lan) return lan;
    if (origin) return origin;
  }

  return configured;
}

function isLoopback(value: string): boolean {
  const host = parse(value)?.hostname;
  return host !== undefined && LOOPBACK_HOSTS.has(host);
}

/** An absolute http(s) origin, which is all a candidate's browser can be sent to. */
function isHttpOrigin(value: string): boolean {
  const url = parse(value);
  if (!url || !url.hostname) return false;
  return url.protocol === "http:" || url.protocol === "https:";
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/** The port an origin spells out, or null when it leans on its protocol's default. */
function explicitPort(value: string | null): string | null {
  if (!value) return null;
  return parse(value)?.port || null;
}

/**
 * This machine's address on the network it is actually plugged into.
 *
 * The first non-internal IPv4 wins, which on a laptop with one Wi-Fi adapter and
 * a pile of virtual switches is the Wi-Fi one. `node:os` reports adapters in no
 * guaranteed order, so a machine with two real networks may be answered with
 * either — which is exactly why step 1 exists and why this is never consulted on
 * a deployed site.
 */
function lanOrigin(port: string | null): string | null {
  if (!port) return null;

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_ADAPTERS.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return `http://${entry.address}:${port}`;
    }
  }

  return null;
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
