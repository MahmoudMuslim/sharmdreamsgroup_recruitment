import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { verifySessionToken } from "@/lib/auth/token";
import { createRestClient } from "@/lib/rest/client";
import { createAuthShim } from "@/lib/rest/auth-shim";

/**
 * The one seam. 127 call sites construct this per request; none of them knows
 * that PostgREST is now ours. Returns the same `{ from, rpc, auth }` shape the
 * supabase-js client did, which is why the port is a re-point rather than a
 * rewrite (spec §6).
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  const bearer = jar.get(SESSION_COOKIE)?.value ?? null;
  // The bearer is what decides the Postgres role `authenticator` switches into,
  // so forwarding it unchecked made this the one consumer of the session cookie
  // that did not look at the claims: a jar carrying `service_role` (which
  // `bypassrls` — see docker/db/initdb/00-roles.sql) would have been honoured on
  // any non-staff path, where the proxy only refuses roles other than
  // `authenticated` for staff pages. Minting one needs AUTH_JWT_SECRET and the
  // cookie is httpOnly, so this is defence in depth, not a live hole; it costs
  // one local HMAC verify.
  //
  // Anything that is not a verified `authenticated` bearer is forwarded as
  // `null`, i.e. the request runs as `anon` and RLS answers it — the same answer
  // a visitor with no cookie at all gets. An expired session therefore stops
  // being a 401 from PostgREST and becomes an anonymous read; every staff path
  // is bounced by the proxy before a page reaches here.
  const claims = bearer ? await verifySessionToken(bearer) : null;
  const token = claims?.role === "authenticated" ? bearer : null;
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("SUPABASE_REST_BASE is not set. Locally: http://localhost:54321/rest/v1");
  }
  return {
    ...createRestClient({ baseUrl: base, token }),
    auth: createAuthShim((name) => jar.get(name)?.value),
  };
}
