/*
 * Proves that a schema file can build a database from nothing. It applies the
 * file to a throwaway local Postgres, then applies it again over the top of
 * itself to prove the result is re-runnable.
 *
 * This catches what a catalog comparison cannot: statements in the wrong order.
 * Four of those were in supabase/schema.sql — foreign keys added before the
 * table they pointed at existed, uniqueness added after the foreign key that
 * needed it, indexes that call a function defined later, and index definitions
 * emitted without a semicolon.
 *
 * Local Docker only — it never connects to the Supabase project.
 *
 *   docker run -d --name schema-proof -e POSTGRES_PASSWORD=zzproof \
 *     -e POSTGRES_DB=postgres -p 55432:5432 postgres:17-alpine \
 *     -c shared_preload_libraries=pg_stat_statements
 *
 *   node scripts/apply-proof-schema.mjs [file]      # default supabase/schema.sql
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, "supabase", "schema.sql");
const URL = "postgresql://postgres:zzproof@localhost:55432/postgres";

/* Supabase ships this extension; a vanilla image cannot create it, so the local
 * proof skips exactly one statement and says so. */
const SUPABASE_ONLY = /^create extension if not exists "supabase_vault".*$/m;

/* Split on top-level semicolons only — dollar-quoted bodies, string literals
 * and comments all contain semicolons that must not end a statement. */
function split(text) {
  const stmts = [];
  let buf = "";
  let dollar = null;
  let sq = false;
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (line) {
      if (ch === "\n") line = false;
      buf += ch;
      continue;
    }
    if (block) {
      if (two === "*/") {
        block = false;
        buf += two;
        i++;
      } else buf += ch;
      continue;
    }
    if (dollar) {
      if (text.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length - 1;
        dollar = null;
      } else buf += ch;
      continue;
    }
    if (sq) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          buf += "''";
          i++;
          continue;
        }
        sq = false;
      }
      buf += ch;
      continue;
    }
    if (two === "--") {
      line = true;
      buf += two;
      i++;
      continue;
    }
    if (two === "/*") {
      block = true;
      buf += two;
      i++;
      continue;
    }
    if (ch === "'") {
      sq = true;
      buf += ch;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[\w]*\$/.exec(text.slice(i));
      if (tag) {
        dollar = tag[0];
        buf += dollar;
        i += dollar.length - 1;
        continue;
      }
    }
    if (ch === ";") {
      buf += ch;
      if (buf.replace(/[;\s]|--[^\n]*/g, "")) stmts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.replace(/[;\s]|--[^\n]*/g, "")) stmts.push(buf.trim());
  return stmts;
}

const c = new Client({ connectionString: URL, connectionTimeoutMillis: 15000 });
for (let i = 0; ; i++) {
  try {
    await c.connect();
    break;
  } catch (e) {
    if (i > 30) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log("connected to the throwaway database");

await c.query(`drop schema if exists public, auth, storage, extensions, vault cascade;
               drop role if exists service_role, authenticated, anon;
               drop publication if exists supabase_realtime;
               create schema public;`);
await c.query(readFileSync(join(root, "scripts", "local-supabase-stub.sql"), "utf8"));
console.log("Supabase stand-in created (auth.users, storage, roles, helpers)");

const raw = readFileSync(file, "utf8");
const skipped = SUPABASE_ONLY.exec(raw)?.[0];
const sql = raw.replace(SUPABASE_ONLY, "-- (skipped for the local proof: supabase_vault is hosted)");

try {
  await c.query(sql);
  console.log(`PASS — applied ${file} as one atomic script`);
} catch (e) {
  console.log(`FAIL as one script: ${e.message}`);
  console.log("Retrying statement by statement to find the cause…");
  const stmts = split(sql);
  console.log(`${stmts.length} statements`);
  for (let i = 0; i < stmts.length; i++) {
    try {
      await c.query(stmts[i]);
    } catch (e2) {
      console.log(`\nSTMT ${i + 1} FAILED — ${e2.message}\n${stmts[i].slice(0, 400)}`);
      process.exit(1);
    }
  }
  console.log("FAIL — the file only applies statement by statement, so it is not atomic");
  process.exit(1);
}

if (skipped) console.log(`note: skipped one hosted-only statement — ${skipped}`);

const counts = await c.query(
  `select
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind in ('r','p')) tables,
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public') functions,
     (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','storage')) policies,
     (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and not t.tgisinternal) triggers,
     (select count(*) from storage.buckets) buckets`
);
console.log("fresh database now holds:", counts.rows[0]);

await c.query(sql);
const after = await c.query(
  `select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind in ('r','p')) tables,
          (select count(*) from pg_constraint c join pg_class cl on cl.oid=c.conrelid
            join pg_namespace n on n.oid=cl.relnamespace
            where n.nspname='public' and cl.relkind in ('r','p')) constraints`
);
console.log("PASS — applied a second time over itself, still:", after.rows[0]);
await c.end();
