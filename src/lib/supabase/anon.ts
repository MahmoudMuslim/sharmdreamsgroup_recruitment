import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

let anonClient: SupabaseClient | null = null;

/**
 * Anonymous (anon-key) Supabase client for public, cacheable reads.
 *
 * This is deliberately NOT `createSupabaseServerClient`. That one binds to the
 * incoming request's cookies, which marks the caller as request-time under
 * `cacheComponents: true` — it cannot be prerendered or cached, so every
 * visitor to a public page would trigger a fresh server render and a DB round
 * trip.
 *
 * The anon key carries no identity, so its result depends only on the query.
 * Row Level Security decides what it may see, and for published job openings
 * that is deliberately the same for everyone:
 *
 *   jobs_public_read → status = 'PUBLISHED' OR is_staff()
 *
 * `is_staff()` is false for anon, so an anonymous read can only ever return
 * PUBLISHED rows. Drafts stay hidden, and passing this client to a session-free
 * page therefore cannot leak anything a signed-out visitor could not already
 * see by loading the page themselves.
 *
 * Never import from client components — the anon key is public by design, but
 * the instance is server-scoped so the two are not confused.
 */
export function getSupabaseAnonClient(): SupabaseClient {
  if (!anonClient) {
    // During build without credentials, return a mock client that throws on use
    if (!supabaseConfig.url || !supabaseConfig.anonKey) {
      const mockClient = {
        from: () => ({
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
        storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: { message: "No credentials" } }) }) },
      } as unknown as SupabaseClient;
      return mockClient;
    }
    anonClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return anonClient;
}