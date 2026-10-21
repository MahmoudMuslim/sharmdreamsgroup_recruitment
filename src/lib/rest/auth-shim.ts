import "server-only";
import { verifySessionToken, type Claims } from "@/lib/auth/token";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export interface ShimUser { id: string; email: string | null; role: string; }

/**
 * supabase-js's `auth` surface, reduced to what this repo actually calls and
 * re-implemented over our own token. There is no session to refresh, because a
 * session is now a signed cookie with an expiry and nothing else (spec §6).
 *
 * "A session" means one thing across the four layers that read the cookie: the
 * proxy (`guard.ts`, which nulls the claims unless `verified.role` is
 * `authenticated`), the per-request staff read (`session.ts`, `claims.role !==
 * "authenticated"`), this shim (`user()`, same test), and the REST transport
 * (`src/lib/data-api/server.ts`, which forwards the bearer only when the verified
 * role is `authenticated` and forwards `null` otherwise). Each of the four
 * requires `authenticated`, so a `service_role` or `anon` bearer in a session
 * cookie is refused everywhere rather than being a sign-in for the call sites
 * behind the guard — including at the transport, which is what decides the
 * Postgres role and would otherwise honour such a jar on a path the proxy does
 * not gate. `admin` is NOT hosted here — the Team console reaches `authAdmin`
 * through the service client, which is a different handle no page-level call
 * touches.
 */
export function createAuthShim(readCookie: (name: string) => string | undefined) {
  async function claims(): Promise<Claims | null> {
    return verifySessionToken(readCookie(SESSION_COOKIE));
  }
  const user = async (): Promise<ShimUser | null> => {
    const c = await claims();
    if (!c || c.role !== "authenticated") return null;
    return { id: c.sub, email: null, role: c.role };
  };
  return {
    async getUser(_jwt?: string) {
      return { data: { user: await user() }, error: null };
    },
    async getSession() {
      const u = await user();
      const c = await claims();
      return {
        data: { session: u ? { user: u, access_token: c ? `${c.iat}` : null } : null },
        error: null,
      };
    },
    async signOut() {
      return { data: { url: null }, error: null };
    },
  };
}

export type AuthShim = ReturnType<typeof createAuthShim>;
