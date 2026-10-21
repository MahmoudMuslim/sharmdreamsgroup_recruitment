import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { createRestClient } from "@/lib/rest/client";
import { mintServiceToken } from "@/lib/auth/token";

/**
 * Service-role access. BYPASSES Row Level Security via `bypassrls` — the local
 * `service_role` has the `bypassrls` attribute (01-roles.sql), and PostgREST
 * maps this bearer's `role` claim onto that database role.
 *
 * The bearer is a short-lived token signed here with `AUTH_JWT_SECRET`, so no
 * long-lived secret leaves the process.
 *
 * `auth` is the ONE surface still pointed at the vendor: GoTrue's admin API has
 * no local equivalent until Task 14 writes `authAdmin()` over the ported
 * `auth.users` (Task 4). Every `.from()`/`.rpc()` on this object is local.
 */
let serviceAuth: ReturnType<typeof createClient>["auth"] | null = null;

export function getSupabaseServiceClient() {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
  }
  serviceAuth ??= createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey!).auth;
  return {
    // Lazy bearer, so the factory stays synchronous AND no bearer can outlive
    // its own expiry: the token is minted per request, not per module.
    ...createRestClient({ baseUrl: base, token: () => mintServiceToken(60) }),
    auth: serviceAuth,
  };
}
