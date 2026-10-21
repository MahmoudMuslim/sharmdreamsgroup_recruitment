import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { createRestClient } from "@/lib/rest/client";
import { createAuthShim } from "@/lib/rest/auth-shim";

/**
 * The one seam. 129 call sites construct this per request; none of them knows
 * that PostgREST is now ours. Returns the same `{ from, rpc, auth }` shape the
 * supabase-js client did, which is why the port is a re-point rather than a
 * rewrite (spec §6).
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("SUPABASE_REST_BASE is not set. Locally: http://localhost:54321/rest/v1");
  }
  return {
    ...createRestClient({ baseUrl: base, token }),
    auth: createAuthShim((name) => jar.get(name)?.value),
  };
}
