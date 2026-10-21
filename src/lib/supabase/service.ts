import { createRestClient } from "@/lib/rest/client";
import { mintServiceToken } from "@/lib/auth/token";
import { authAdmin } from "@/lib/auth/admin-users";

/**
 * Service-role access. BYPASSES Row Level Security via `bypassrls` — the local
 * `service_role` has the `bypassrls` attribute (01-roles.sql), and PostgREST
 * maps this bearer's `role` claim onto that database role.
 *
 * The bearer is a short-lived token signed here with `AUTH_JWT_SECRET`, so no
 * long-lived secret leaves the process.
 *
 * `auth.admin` is local too: it is `authAdmin`, four parameterised statements
 * over the `pg` pool (`src/lib/auth/db.ts`), because `auth` is deliberately
 * outside `PGRST_DB_SCHEMAS` so no HTTP route may reach `auth.users`. Nothing on
 * this object touches the vendor any more, which is also why
 * `SUPABASE_SERVICE_ROLE_KEY` stopped being a requirement here — that key only
 * ever fed the GoTrue admin handle these thirteen call sites used.
 */
export function getSupabaseServiceClient() {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
  }
  return {
    // Lazy bearer, so the factory stays synchronous AND no bearer can outlive
    // its own expiry: the token is minted per request, not per module.
    ...createRestClient({ baseUrl: base, token: () => mintServiceToken(60) }),
    auth: { admin: authAdmin },
  };
}
