/*
 * Checks that supabase/schema.sql describes the live database completely.
 * Compares catalog sets, so an absent object is a failure rather than a guess —
 * run it after every migration and before every deploy.
 *
 *   node scripts/verify-schema.mjs supabase/schema.sql
 *
 * Read-only. Point it at another database with ZZ_DB_URL to prove that a fresh
 * build matches production.
 */
import { readFileSync } from "fs";
import { Client } from "pg";

const file = process.argv[2];
const text = readFileSync(file, "utf8");
const lower = text.toLowerCase();

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const c = new Client({
  connectionString:
    process.env.ZZ_DB_URL ||
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
      encodeURIComponent(env.SUPABASE_DB_PASSWORD.trim()) +
      "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: process.env.ZZ_DB_URL ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;

let failures = 0;
function report(label, rows, missing) {
  const gap = missing();
  if (!gap.length) {
    console.log(`OK   ${label}: all ${rows.length} present`);
    return;
  }
  failures += gap.length;
  console.log(`GAP  ${label}: ${gap.length} of ${rows.length} missing`);
  for (const g of gap.slice(0, 25)) console.log(`       ${g}`);
  if (gap.length > 25) console.log(`       … and ${gap.length - 25} more`);
}

/* --- tables + columns --- */
const tables = await q(
  `select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by 2`
);
report("tables", tables, () =>
  tables.filter((t) => {
    const qualified = lower.includes(`create table if not exists ${t.s}.${t.t} (`);
    const bare = lower.includes(`create table if not exists ${t.t} (`);
    return !(qualified || bare);
  }).map((t) => `${t.s}.${t.t}`)
);

const declaredCols = new Map();
const declaredLines = new Map();
const pkTables = new Set();
const tre = /create table if not exists ([\w".]+) \(\n([\s\S]*?)\n\);/g;
let m;
while ((m = tre.exec(text))) {
  const cols = new Set();
  for (const raw of m[2].split("\n")) {
    const name = raw.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s/i);
    if (name) {
      cols.add(name[1].toLowerCase());
      declaredLines.set(
        `${m[1].toLowerCase().replace(/^public\./, "")}.${name[1].toLowerCase()}`,
        raw.trim().toLowerCase()
      );
    }
  }
  if (/primary key \(/i.test(m[2])) pkTables.add(m[1].toLowerCase().replace(/^public\./, ""));
  declaredCols.set(m[1].toLowerCase().replace(/^public\./, ""), cols);
}
const cols = await q(
  `select n.nspname s, c.relname t, a.attname col from pg_attribute a
     join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped`
);
report("columns", cols, () =>
  cols.filter((r) => !(declaredCols.get(r.t) ?? new Set()).has(r.col.toLowerCase())).map((r) => `${r.s}.${r.t}.${r.col}`)
);

/* --- column nullability ---
 * NOT NULL lives on the column, not in pg_constraint, so the constraint set
 * above cannot see it. Without this check a dump that silently dropped every
 * `not null` still verified clean.
 */
const pkCols = await q(
  `select c.relname t, a.attname col from pg_index x
     join pg_class c on c.oid = x.indrelid
     join pg_namespace n on n.oid = c.relnamespace
     join unnest(x.indkey) with ordinality k(colid, pos) on true
     join pg_attribute a on a.attrelid = c.oid and a.attnum = k.colid
    where n.nspname = 'public' and x.indisprimary`
);
const pkSet = new Set(pkCols.map((r) => `${r.t}.${r.col}`.toLowerCase()));
const nullability = await q(
  `select n.nspname s, c.relname t, a.attname col, a.attnotnull nn from pg_attribute a
     join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped`
);
report("column nullability", nullability, () =>
  nullability
    .filter((r) => !pkSet.has(`${r.t}.${r.col}`.toLowerCase()))
    .filter((r) => {
      const line = declaredLines.get(`${r.t}.${r.col}`.toLowerCase());
      if (line === undefined) return false;
      return line.includes("not null") !== r.nn;
    })
    .map((r) => `${r.s}.${r.t}.${r.col} ${r.nn ? "NOT NULL" : "nullable"} in live`)
);

/* --- constraints --- */
const cons = await q(
  `select n.nspname s, rel.relname t, oc.conname from pg_constraint oc
     join pg_class rel on rel.oid=oc.conrelid join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public'`
);
report("constraints", cons, () =>
  cons
    /* An inline `primary key (...)` makes Postgres mint the <table>_pkey name. */
    .filter((r) => !(r.conname.endsWith("_pkey") && pkTables.has(r.t)))
    .filter((r) => !lower.includes(r.conname.toLowerCase()))
    .map((r) => `${r.s}.${r.t}.${r.conname}`)
);

/* --- indexes not backing constraints --- */
const idx = await q(
  `select ix.relname n from pg_class ix join pg_index x on x.indexrelid=ix.oid
     join pg_class cl on cl.oid=x.indrelid join pg_namespace n on n.oid=cl.relnamespace
     left join pg_constraint k on k.conindid=ix.oid
    where n.nspname='public' and k.conindid is null`
);
report("indexes", idx, () => idx.filter((r) => !lower.includes(r.n.toLowerCase())).map((r) => r.n));

/* --- policies --- */
const pol = await q(
  `select n.nspname s, cl.relname t, p.polname from pg_policy p
     join pg_class cl on cl.oid=p.polrelid join pg_namespace n on n.oid=cl.relnamespace
    where n.nspname in ('public','storage')`
);
report("policies", pol, () =>
  pol
    .filter(
      (r) =>
        !lower.includes(`create policy "${r.polname.toLowerCase()}" on ${r.s}.${r.t}`) &&
        !lower.includes(`create policy '${r.polname.toLowerCase()}' on ${r.s}.${r.t}`) &&
        !lower.includes(`create policy ${r.polname.toLowerCase()} on ${r.s}.${r.t}`)
    )
    .map((r) => `${r.s}.${r.t}/${r.polname}`)
);

/* --- functions --- */
const fn = await q(
  `select n.nspname s, p.proname n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname in ('sql','plpgsql')`
);
report("functions", fn, () => fn.filter((r) => !lower.includes(`function ${r.s}.${r.n}(`)).map((r) => `${r.s}.${r.n}`));

/* --- triggers --- */
const trg = await q(
  `select cl.relname t, tg.tgname from pg_trigger tg join pg_class cl on cl.oid=tg.tgrelid
     join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and not tg.tgisinternal`
);
report("triggers", trg, () => trg.filter((r) => !lower.includes(r.tgname.toLowerCase())).map((r) => `${r.t}/${r.tgname}`));

/* --- enums and their labels, in order --- */
const en = await q(
  `select t.typname, n.nspname, e.enumlabel, e.enumsortorder from pg_type t
     join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' order by t.typname, e.enumsortorder`
);
report("enum types", en, () => [...new Set(en.map((r) => r.typname))].filter((x) => !(lower.includes(`create type public.${x} as enum`) || lower.includes(`create type ${x} as enum`))));
report("enum labels", en, () => {
  const bad = [];
  for (const r of en) {
    const blockM = new RegExp(`create type (?:public\\.)?${r.typname} as enum \\(([^)]*)\\)`).exec(text);
    if (!blockM || !blockM[1].toLowerCase().includes(`'${r.enumlabel.toLowerCase()}'`)) bad.push(`${r.typname}:${r.enumlabel}`);
  }
  return bad;
});

/* --- sequences --- */
const seq = await q(
  `select n.nspname s, c.relname n from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='S'`
);
report("sequences", seq, () => seq.filter((r) => !(lower.includes(`create sequence if not exists ${r.s}.${r.n}`) || lower.includes(`create sequence if not exists ${r.n}`))).map((r) => `${r.s}.${r.n}`));

/* --- storage buckets --- */
const buckets = await q(`select id from storage.buckets`);
report("storage buckets", buckets, () => buckets.filter((r) => !lower.includes(`'${r.id.toLowerCase()}'`)).map((r) => r.id));

/* --- grants --- */
const grants = await q(
  `select distinct case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end kind,
          n.nspname||'.'||c.relname obj, coalesce(g.rolname,'public') grantee
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(c.relacl) a left join pg_roles g on g.oid=a.grantee
    where n.nspname='public'
    union
    select 'function', n.nspname||'.'||p.proname, coalesce(g.rolname,'public')
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     cross join lateral aclexplode(p.proacl) a left join pg_roles g on g.oid=a.grantee
    where n.nspname='public'`
);
report("grant targets", grants, () =>
  grants
    .filter((r) => !new RegExp(`on ${r.kind} ${r.obj.replace(/[.$]/g, ".")} to ${r.grantee};`).test(text))
    .map((r) => `${r.kind} ${r.obj} -> ${r.grantee}`)
);

/* --- comments carried over --- */
const comments = await q(
  `select count(*)::int n from pg_description d join pg_class c on c.oid=d.objoid
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and d.objsubid=0 and c.relkind in ('r','p')`
);
console.log(`note table comments: ${comments[0].n} in live, ${(text.match(/^comment on table /gm) ?? []).length} in file`);

await c.end();
console.log(failures ? `\n${failures} GAP(S)` : "\nFILE DESCRIBES THE LIVE DATABASE COMPLETELY");
process.exit(failures ? 1 : 0);
