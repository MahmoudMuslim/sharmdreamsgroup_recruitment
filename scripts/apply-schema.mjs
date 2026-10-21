/*
 * Applies supabase/schema.sql to the configured project, as one script.
 *
 * It used to do three more things, and all three were reasons not to run it:
 * it applied supabase/seed.sql, so a real project collected demo applications;
 * it created three staff accounts whose passwords are written into this file;
 * and it upserted their user_profiles rows, overwriting the role and locale of
 * whoever already owned those addresses. The schema file now carries the
 * console's own reference rows, so this script does exactly what its name says
 * and nothing else.
 *
 *   demo rows      -> supabase/seed.sql, applied by hand when you want them
 *   staff accounts -> Settings -> Team in the running app, or npm run db:seed-local
 *
 * Usage:
 *   node scripts/apply-schema.mjs [file]      # default supabase/schema.sql
 *
 * The password is read from SB_DB, then SUPABASE_DB_PASSWORD from .env.local.
 * Aim it at another database with ZZ_DB_URL — that is how this script gets
 * proved on the throwaway instead of on the project.
 * Confirm the result with:
 *   node scripts/verify-schema.mjs supabase/schema.sql
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, "supabase", "schema.sql");

function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const ref = env.SUPABASE_PROJECT_REF;
const password = process.env.SB_DB || env.SUPABASE_DB_PASSWORD;
const POOLER = "aws-0-eu-west-1.pooler.supabase.com";

/* Same escape hatch verify-schema.mjs uses, so this script can be aimed at the
 * throwaway database instead of the project. */
const url = process.env.ZZ_DB_URL;
if (!url && (!ref || !password)) {
  console.error("Missing SUPABASE_PROJECT_REF or the database password in .env.local.");
  process.exit(1);
}

console.log(`Applying ${file}\nto ${url ? "the database in ZZ_DB_URL" : `project ${ref} via ${POOLER}`}…`);

const c = new Client(
  url
    ? { connectionString: url, connectionTimeoutMillis: 20000 }
    : {
        host: POOLER,
        port: 5432,
        user: `postgres.${ref}`,
        password,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000,
      }
);

/* Supabase ships supabase_vault; a vanilla image cannot create it. Same skip
 * apply-proof-schema.mjs makes, so one file can serve both targets. */
const SUPABASE_ONLY = /^create extension if not exists "supabase_vault".*$/m;

let sql = readFileSync(file, "utf8");
if (url && SUPABASE_ONLY.test(sql)) {
  sql = sql.replace(SUPABASE_ONLY, "-- (skipped: supabase_vault is hosted)");
  console.log("note: skipping the hosted-only supabase_vault statement");
}

try {
  await c.connect();
  await c.query(sql);
  const census = (
    await c.query(
      `select
         (select count(*) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
           where n.nspname = 'public' and cl.relkind in ('r','p')) tables,
         (select count(*) from pg_policy p join pg_class cl on cl.oid = p.polrelid
           join pg_namespace n on n.oid = cl.relnamespace
           where n.nspname in ('public','storage')) policies,
         (select count(*) from storage.buckets) buckets,
         (select count(*) from permissions) permissions,
         (select count(*) from role_permissions) role_permissions,
         (select count(*) from notification_templates) templates,
         (select count(*) from app_settings) app_settings`
    )
  ).rows[0];
  console.log("OK — the project now holds:", census);
} catch (e) {
  console.log("FAIL — " + (e instanceof Error ? e.message : String(e)));
  console.log("Nothing was reported as applied; check the file with verify-schema.mjs.");
  process.exitCode = 1;
} finally {
  await c.end();
}
