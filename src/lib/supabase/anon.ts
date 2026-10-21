import { createRestClient, type RestClient } from "@/lib/rest/client";

let anonClient: RestClient | null = null;

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
 *
 * Dated change (Task 11): this client is now our PostgREST transport with
 * `token: null`, and the credential-free mock it used to fall back to is gone.
 * Without the vendor there is no "no credentials" state worth supporting — the
 * base URL is a local container — so a misconfigured runtime fails loudly here.
 *
 * Which is also why no route may reach it during `next build`. The image is
 * built with no database and no secrets by design (`.dockerignore` excludes
 * `.env*` so nothing can be baked into a layer), and a `use cache` scope that is
 * reachable from a prerendered route is *executed* in the build's cache-warming
 * phase whatever its `cacheLife` — expiry only decides what gets baked. So the
 * page that reads it has to stop prerendering first, with `await connection()`
 * (`connection.md`), which is what `/careers` does and what `/careers/[id]` gets
 * from reading `params`. Do not remove one of those and expect the build to
 * notice: it fails here, in the image, not locally where the stack is running.
 *
 * The service client (`src/lib/supabase/service.ts`) is the opposite case, and
 * the difference is what each does with a failed read: `readGlobalSettings`
 * answers with an empty Map and every caller falls back to shipped defaults, so
 * its `cacheLife("minutes")` can stay inside prerenders and the shells build.
 * Public reads cannot do that — an empty job list is a careers board that says
 * the group is not hiring, and a null job is a 404 on a live opening.
 */
export function getSupabaseAnonClient(): RestClient {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
  }
  anonClient ??= createRestClient({ baseUrl: base, token: null });
  return anonClient;
}
