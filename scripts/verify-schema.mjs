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

/* --- storage-schema privileges the project's own policies depend on ---
 * Supabase provisions these at project creation, so a hand-written bootstrap
 * never mentioned them and a rebuild lost them silently. The dump records the
 * three roles an app connects as; the internal supabase_* grants stay with the
 * host, so only these are compared.
 */
const APP_ROLES = "'anon', 'authenticated', 'service_role'";
const storageGrants = await q(
  `select 'schema' kind, 'storage' obj, lower(a.privilege_type) priv, g.rolname grantee
     from pg_namespace n cross join lateral aclexplode(n.nspacl) a
     join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and g.rolname in (${APP_ROLES})
    union all
    select 'table', 'storage.'||c.relname, lower(a.privilege_type), g.rolname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and c.relname in ('buckets', 'objects')
      and g.rolname in (${APP_ROLES})
    order by 1, 2, 4, 3`
);
report("storage privileges", storageGrants, () =>
  storageGrants
    .filter((r) => !lower.includes(`grant ${r.priv} on ${r.kind} ${r.obj} to ${r.grantee};`))
    .map((r) => `${r.priv} on ${r.kind} ${r.obj} -> ${r.grantee}`)
);

const policyHelpers = new Set();
for (const p of await q(
  `select coalesce(pg_get_expr(p.polqual, p.polrelid), '')||coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') src
     from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage')`
)) {
  for (const f of p.src.matchAll(/storage\.([a-z_]+)\(/g)) policyHelpers.add(f[1]);
}
/* These helpers carry the default ACL, so proacl is NULL and aclexplode() of it
 * returns nothing — hence acldefault(). Without that, this check would compare
 * an empty list against the file and report a pass it had not earned. */
const helperGrants = await q(
  `select p.proname name, pg_get_function_identity_arguments(p.oid) args,
          lower(a.privilege_type) priv, coalesce(g.rolname, 'public') grantee
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and lower(a.privilege_type) = 'execute'
      and coalesce(g.rolname, 'public') not in ('supabase_admin', 'supabase_storage_admin')
    order by 1, 4`
);
const neededHelpers = helperGrants.filter((r) => policyHelpers.has(r.name));
report("storage policy helpers", neededHelpers, () =>
  neededHelpers.length === 0
    ? [...policyHelpers].map((h) => `no grantee row for called helper storage.${h}()`)
    : neededHelpers
        .filter((r) => {
          const names = `function storage.${r.name}(${r.args})`;
          /* Supabase leaves these ACLs at their default, which is EXECUTE to
           * PUBLIC; a rebuild may hold them as per-role grants instead. Every
           * role is a member of PUBLIC, so either form satisfies the policy. */
          return (
            !lower.includes(`grant ${r.priv} on ${names} to ${r.grantee};`) &&
            !lower.includes(`grant ${r.priv} on ${names} to public;`)
          );
        })
        .map((r) => `${r.priv} on storage.${r.name}(${r.args}) -> ${r.grantee}`)
);

/* --- reference rows the console reads before it can render ---
 * DDL alone builds a database with an empty permission catalogue, no roles, no
 * notification templates and no AI routing, so every has_permission() check
 * fails closed and every screen shows nothing. The dump ends with one INSERT per
 * live row; this compares the primary key of each of those rows against the
 * file, and the per-table counts, so a forgotten re-dump is a gap rather than a
 * silently smaller rebuild.
 */
const REFERENCE_PKS = {
  permissions: ["key"],
  roles: ["id"],
  role_permissions: ["role_key", "permission_key"],
  currencies: ["id"],
  skills: ["id"],
  notification_templates: ["id"],
  ai_model_config: ["capability"],
  departments: ["id"],
  locations: ["id"],
  role_families: ["id"],
  role_family_skills: ["role_family_id", "skill_id"],
  app_settings: ["id"],
};

/* Read the leading values out of one emitted INSERT — the primary key always
 * comes first, and quoted text may contain commas, so this walks the tuple
 * rather than splitting it. */
function leadingValues(line, count) {
  const start = line.indexOf("values (");
  if (start < 0) return null;
  const out = [];
  let i = start + "values (".length;
  let item = "";
  let quoted = false;
  while (i < line.length && out.length < count) {
    const ch = line[i];
    if (quoted) {
      if (ch === "'") {
        if (line[i + 1] === "'") {
          item += "'";
          i++;
        } else quoted = false;
      } else item += ch;
    } else if (ch === "'" && item.trim() === "") {
      item = "";
      quoted = true;
    } else if (ch === ",") {
      out.push(item.trim());
      item = "";
    } else if (ch === ")") {
      out.push(item.trim());
      break;
    } else item += ch;
    i++;
  }
  return out.length >= count ? out.slice(0, count) : null;
}

const refRows = [];
const refGaps = [];
for (const [t, pk] of Object.entries(REFERENCE_PKS)) {
  const where = t === "app_settings" ? " where not is_secret" : "";
  const live = await q(
    `select ${pk.map((p) => `coalesce(${p}::text, 'null')`).join(" || ' | ' || ")} as sig
       from public.${t}${where} order by 1`
  );
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith(`insert into public.${t} (`));
  const inFile = new Set(lines.map((l) => leadingValues(l, pk.length)?.join(" | ") ?? "??"));
  for (const r of live) {
    refRows.push({ t, sig: r.sig });
    if (!inFile.has(r.sig)) refGaps.push(`${t}: no row for ${r.sig}`);
  }
  if (lines.length !== live.length) {
    refGaps.push(`${t}: ${lines.length} INSERT line(s) in file, ${live.length} row(s) live`);
  }
}
report("reference rows", refRows, () => refGaps);

/* --- comments carried over --- */
const comments = await q(
  `select count(*)::int n from pg_description d join pg_class c on c.oid=d.objoid
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and d.objsubid=0 and c.relkind in ('r','p')`
);
console.log(`note table comments: ${comments[0].n} in live, ${(text.match(/^comment on table /gm) ?? []).length} in file`);

await c.end();
console.log(failures ? `\n${failures} GAP(S)` : "\nFILE DESCRIBES THE LIVE DATABASE COMPLETELY");
process.exit(failures ? 1 : 0);
