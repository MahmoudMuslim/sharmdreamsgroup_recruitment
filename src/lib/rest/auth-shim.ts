import "server-only";
import { verifySessionToken, type Claims } from "@/lib/auth/token";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export interface ShimUser { id: string; email: string | null; role: string; }

/**
 * supabase-js's `auth` surface, reduced to what this repo actually calls and
 * re-implemented over our own token. There is no session to refresh, because a
 * session is now a signed cookie with an expiry and nothing else (spec §6).
 */
export function createAuthShim(readCookie: (name: string) => string | undefined) {
  async function claims(): Promise<Claims | null> {
    return verifySessionToken(readCookie(SESSION_COOKIE));
  }
  const user = async (): Promise<ShimUser | null> => {
    const c = await claims();
    if (!c || c.role === "anon") return null;
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
