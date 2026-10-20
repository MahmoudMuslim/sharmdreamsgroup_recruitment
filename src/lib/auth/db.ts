import { Pool } from "pg";

/**
 * One pool for the whole process. This is a change of shape, not of behaviour:
 * on Vercel every request got a cold connection, and on a persistent container
 * the pool is reused — which is the point of leaving serverless (spec §9).
 *
 * Guarded as a module global so hot reloads during `next dev` do not open a new
 * pool per edit. The existing process-global singletons in src/lib/supabase/
 * anon.ts:5 and service.ts:5 follow the same convention.
 */
let pool: Pool | null = null;

export function getAuthPool(): Pool {
  if (pool) return pool;
  const url = process.env.AUTH_DB_URL;
  if (!url) {
    throw new Error(
      "AUTH_DB_URL is not set. Add it to .env.local pointing at the local stack — see docker/.env.example."
    );
  }
  pool = new Pool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // No `ssl` option at all. TLS here is the connection string's business
    // (`?sslmode=…`), and a default of `{ rejectUnauthorized: false }` would
    // silently turn certificate verification off the first time this points at
    // anything other than loopback — which is exactly what KVM2 will be.
  });
  return pool;
}
