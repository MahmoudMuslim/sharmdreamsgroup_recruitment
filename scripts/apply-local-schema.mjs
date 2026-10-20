/*
 * Applies supabase/schema.sql to the LOCAL self-hosted stack, then reports the
 * object counts. Replaces `ZZ_DB_URL=… node scripts/apply-schema.mjs` for local
 * work so nobody has to remember the escape hatch — or read the password.
 *
 *   npm run docker:up && node scripts/apply-local-schema.mjs
 *
 * Reads docker/.env, never .env.local, and never connects to the vendor.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(file) {
  const out = {};
  for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const local = env(join("docker", ".env"));
if (!local.LOCAL_DB_PASSWORD) {
  console.error("docker/.env is missing LOCAL_DB_PASSWORD. See docker/.env.example.");
  process.exit(1);
}

const sql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

// Field-based, not a URL: a URI would need the password percent-encoded, and a
// rotated password containing @, / or % silently misparses into the wrong
// database name.
const c = new Client({
  user: "postgres",
  password: local.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(local.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await c.connect();
if (/^create extension if not exists "supabase_vault"/m.test(sql)) {
  await c.end();
  console.error(
    "supabase/schema.sql still creates supabase_vault, which a vanilla image\n" +
    "cannot do. That statement is a hand-removal — see this task's Step 3.\n" +
    "If a re-dump restored it, re-delete it and update the AUTHORITATIVE marker."
  );
  process.exit(1);
}

console.log("applying supabase/schema.sql to the local stack as one atomic script…");
await c.query(sql);

const counts = await c.query(`
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')) as tables,
    (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','storage')) as policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public') as functions,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal) as triggers,
    (select count(*) from storage.buckets) as buckets`);
console.log("local stack now holds:", counts.rows[0]);
await c.end();

// PostgREST caches its schema description; without this the next read answers
// 404 "relation not found" even though the table is plainly there.
execFileSync("docker", [
  "compose", "-f", join(root, "docker", "docker-compose.yml"),
  "--env-file", join(root, "docker", ".env"), "restart", "rest",
], { stdio: "inherit" });
console.log("restarted PostgREST so it re-reads the schema");
