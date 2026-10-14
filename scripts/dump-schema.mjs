/*
 * Dumps the live Supabase project's schema to stdout, shaped like a re-runnable
 * bootstrap file: every statement comes from Postgres' own pg_get_* definers, so
 * what lands in the file is what the database actually holds.
 *
 * Read-only — every query here is a SELECT.
 *
 *   node scripts/dump-schema.mjs > supabase/schema.sql
 */
import { readFileSync } from "fs";
import { Client } from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const POOLER =
  "postgresql://postgres.lbxdeceropsxwohnzinl:" +
  encodeURIComponent((env.SUPABASE_DB_PASSWORD ?? "").trim()) +
  "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

const c = new Client({
  connectionString: POOLER,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();

const q = async (sql) => (await c.query(sql)).rows;
const out = [];
const say = (s) => out.push(s);
const block = (title) =>
  say(
    `\n-- ============================================================================\n-- ${title}\n-- ============================================================================\n`
  );

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/* Policy and trigger names are identifiers, so they need double quotes — and
 * several of them contain spaces. */
function ident(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

say(`/*
 * Sharm Dreams Talent Cloud — schema of record.
 *
 * Generated from the live project, so this file describes the database instead
 * of intending to: every statement is Postgres' own pg_get_* definer. The design
 * reasoning behind any single object lives in supabase/migrations/001-*.sql.
 *
 * The two seed blocks at the end are the only sections this file authors rather
 * than dumps — and both are dumps of live rows in authored shape. Regenerate with:
 *
 *   node scripts/dump-schema.mjs > supabase/schema.sql
 *   node scripts/verify-schema.mjs supabase/schema.sql   # must report no gaps
 *
 * Order is dependency-driven, because this file has to apply on an empty
 * database: extensions and enums, then every table, then uniqueness, then the
 * foreign keys that point at it, then functions, then the indexes and policies
 * that call those functions, then the rows the console reads before it can
 * render anything. It applies on a Supabase project — some policies reference
 * auth.uid() and storage.objects — but not on vanilla Postgres, where the auth
 * and storage schemas have to be stood in for first.
 */`);

/* -------------------------------------------------------------------------- */
block("EXTENSIONS");

say("create schema if not exists extensions;");
const seenSchemas = new Set(["extensions"]);
for (const e of await q(
  `select e.extname, n.nspname from pg_extension e
     join pg_namespace n on n.oid = e.extnamespace
    where e.extname <> 'plpgsql' order by e.extname`
)) {
  if (!seenSchemas.has(e.nspname)) {
    seenSchemas.add(e.nspname);
    if (e.nspname !== "public") say(`create schema if not exists ${e.nspname};`);
  }
  say(
    `create extension if not exists ${ident(e.extname)}${e.nspname === "public" ? "" : ` with schema ${e.nspname}`};`
  );
}

/* -------------------------------------------------------------------------- */
block("ENUM TYPES — label order is the sort order, so it is load-bearing");

for (const e of await q(
  `select t.typname, n.nspname,
          string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) labels
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by 1, 2 order by t.typname`
)) {
  say(
    `do $$ begin\n  create type ${e.nspname}.${e.typname} as enum (${e.labels});\nexception when duplicate_object then null; end $$;`
  );
}

/* -------------------------------------------------------------------------- */
block("SEQUENCES");

const ownedSeqs = await q(
  `select sn.nspname s, sc.relname seq, tn.nspname ts, tc.relname tbl, a.attname col
     from pg_depend d
     join pg_class sc on sc.oid = d.objid
     join pg_namespace sn on sn.oid = sc.relnamespace
     join pg_class tc on tc.oid = d.refobjid
     join pg_namespace tn on tn.oid = tc.relnamespace
     join pg_attribute a on a.attrelid = tc.oid and a.attnum = d.refobjsubid
    where sc.relkind = 'S' and sn.nspname = 'public' and d.deptype = 'a'`
);
/* Every sequence exists before the tables, because a column default names one. */
for (const s of await q(
  `select n.nspname s, c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
    order by 1, 2`
)) {
  say(`create sequence if not exists ${s.s}.${s.relname};`);
}

/* -------------------------------------------------------------------------- */
block("TABLES");

const constraints = await q(
  `select n.nspname s, rel.relname t, conname, oc.contype, pg_get_constraintdef(oc.oid) def
     from pg_constraint oc join pg_class rel on rel.oid = oc.conrelid
     join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' order by rel.relname, conname`
);
const consByTable = new Map();
for (const k of constraints) {
  const key = `${k.s}.${k.t}`;
  if (!consByTable.has(key)) consByTable.set(key, []);
  consByTable.get(key).push(k);
}

const tableInfo = await q(
  `select n.nspname s, c.relname t, a.attnum, a.attname name,
          format_type(a.atttypid, a.atttypmod) typ,
          a.attnotnull as "notnull", nullif(a.attgenerated, '') generated,
          a.attidentity identity,
          pg_get_expr(d.adbin, d.adrelid) default_expr,
          obj_description(c.oid) table_comment
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`
);

const byTable = new Map();
for (const col of tableInfo) {
  const key = `${col.s}.${col.t}`;
  if (!byTable.has(key)) byTable.set(key, []);
  byTable.get(key).push(col);
}

/* Every table is created before any foreign key is added, so no constraint can
 * name a table that has not been created yet — tables come back alphabetically,
 * and an FK on ai_model_config points at user_profiles. */
for (const [key, tableCols] of byTable) {
  const pks = (consByTable.get(key) ?? []).filter((k) => k.def.startsWith("PRIMARY KEY"));
  const pkCols = new Set(
    pks.flatMap((k) => (k.def.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((x) => x.trim()))
  );
  const lines = [];
  for (const col of tableCols) {
    let def = `  ${col.name} ${col.typ}`;
    if (col.identity) def += " generated always as identity";
    else if (col.default_expr) def += ` default ${col.default_expr}`;
    if (col.generated) def += ` generated always as (${col.generated}) stored`;
    if (col.notnull && !pkCols.has(col.name)) def += " not null";
    lines.push(def);
  }
  for (const p of pks) lines.push(`  ${p.def}`);
  say(`create table if not exists ${key} (\n${lines.join(",\n")}\n);`);
  if (tableCols[0].table_comment) say(`comment on table ${key} is ${quote(tableCols[0].table_comment)};`);
}

/* Uniqueness first: a foreign key can only point at a column that already has a
 * unique index, and `role_permissions` sorts before the `roles` table it names. */
const addCons = (match) => {
  for (const [key, tableCons] of consByTable) {
    for (const k of tableCons.filter((k) => !k.def.startsWith("PRIMARY KEY") && match(k))) {
      say(
        `do $$ begin\n  alter table ${key} add constraint ${k.conname} ${k.def};\n` +
          `exception when duplicate_object or duplicate_table or undefined_object then null; end $$;`
      );
    }
  }
};
addCons((k) => k.contype !== "f");
addCons((k) => k.contype === "f");

for (const s of ownedSeqs) say(`alter sequence ${s.s}.${s.seq} owned by ${s.ts}.${s.tbl}.${s.col};`);

/* -------------------------------------------------------------------------- */
block("ROW LEVEL SECURITY");

for (const t of await q(
  `select n.nspname s, c.relname t, c.relrowsecurity rls, c.relforcerowsecurity force
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`
)) {
  if (t.rls) say(`alter table ${t.s}.${t.t} enable row level security;`);
  if (t.force) say(`alter table ${t.s}.${t.t} force row level security;`);
}

/* -------------------------------------------------------------------------- */
block("FUNCTIONS");

for (const f of await q(
  `select n.nspname s, p.proname name,
          pg_get_functiondef(p.oid) def,
          pg_get_function_identity_arguments(p.oid) args,
          obj_description(p.oid) comment
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname in ('sql', 'plpgsql')
    order by p.proname`
)) {
  say(f.def.trimEnd() + ";");
  if (f.comment) say(`comment on function ${f.s}.${f.name}(${f.args}) is ${quote(f.comment)};`);
}

/* Indexes come after functions because an expressional index can call one. */
block("INDEXES");

for (const r of await q(
  `select ix.relname indexname, pg_get_indexdef(ix.oid) indexdef
     from pg_class ix
     join pg_index x on x.indexrelid = ix.oid
     join pg_class cl on cl.oid = x.indrelid
     join pg_namespace n on n.oid = cl.relnamespace
     left join pg_constraint k on k.conindid = ix.oid
    where n.nspname = 'public' and k.conindid is null
    order by cl.relname, ix.relname`
)) {
  say(r.indexdef.replace(/^CREATE( UNIQUE)? INDEX /i, "CREATE$1 INDEX IF NOT EXISTS ") + ";");
}

/* Policies come after functions: several of them call is_staff() and friends. */
block("POLICIES");

for (const p of await q(
  `select n.nspname s, cl.relname t, p.polname, p.polpermissive permissive,
          case p.polcmd
            when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when 'i' then 'MERGE' else 'ALL'
          end cmd,
          case when cardinality(p.polroles) = 0 or 0 = any(p.polroles) then 'public'
               else (select string_agg(r.rolname, ', ' order by r.rolname)
                       from unnest(p.polroles) x join pg_roles r on r.oid = x)
          end roles,
          pg_get_expr(p.polqual, p.polrelid) using_expr,
          pg_get_expr(p.polwithcheck, p.polrelid) check_expr
     from pg_policy p
     join pg_class cl on cl.oid = p.polrelid
     join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname in ('public', 'storage')
    order by n.nspname, cl.relname, p.polname`
)) {
  const lines = [
    `create policy ${ident(p.polname)} on ${p.s}.${p.t}`,
    `  for ${p.cmd}`,
    `  to ${p.roles}`,
  ];
  if (!p.permissive) lines.push("  as restrictive");
  if (p.using_expr) lines.push(`  using (${p.using_expr})`);
  if (p.check_expr) lines.push(`  with check (${p.check_expr})`);
  say(`drop policy if exists ${ident(p.polname)} on ${p.s}.${p.t};\n${lines.join("\n")};`);
}

/* -------------------------------------------------------------------------- */
block("TRIGGERS");

for (const r of await q(
  `select n.nspname s, cl.relname t, tg.tgname, pg_get_triggerdef(tg.oid) def
     from pg_trigger tg
     join pg_class cl on cl.oid = tg.tgrelid
     join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal
    order by cl.relname, tg.tgname`
)) {
  say(`drop trigger if exists ${ident(r.tgname)} on ${r.s}.${r.t};\n${r.def};`);
}

/* -------------------------------------------------------------------------- */
block("COMMENTS");

for (const r of await q(
  `select n.nspname s, c.relname t, a.attname col, col_description(c.oid, a.attnum) comment
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
      and col_description(c.oid, a.attnum) is not null
    order by c.relname, a.attnum`
)) {
  say(`comment on column ${r.s}.${r.t}.${r.col} is ${quote(r.comment)};`);
}
for (const r of await q(
  `select n.nspname s, i.relname idx, obj_description(i.oid) comment
     from pg_index x
     join pg_class c on c.oid = x.indrelid
     join pg_class i on i.oid = x.indexrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and obj_description(i.oid) is not null order by 2`
)) {
  say(`comment on index ${r.s}.${r.idx} is ${quote(r.comment)};`);
}

/* -------------------------------------------------------------------------- */
block("GRANTS");

const grantRows = await q(
  `select case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end kind,
          n.nspname s, c.relname o, a.privilege_type priv, coalesce(g.rolname, 'public') grantee
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     left join pg_roles g on g.oid = a.grantee
    where n.nspname = 'public'
    union all
    select 'function', n.nspname, p.proname, a.privilege_type, coalesce(g.rolname, 'public')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) a
     left join pg_roles g on g.oid = a.grantee
    where n.nspname = 'public'
    order by 2, 3, 5, 4`
);
const grouped = new Map();
for (const g of grantRows) {
  const key = `${g.kind}|${g.s}.${g.o}|${g.grantee}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(g.priv.toLowerCase());
}
for (const [key, privs] of grouped) {
  const [kind, object, grantee] = key.split("|");
  say(`grant ${privs.join(", ")} on ${kind} ${object} to ${grantee};`);
}

/* -------------------------------------------------------------------------- */
block("STORAGE SCHEMA PRIVILEGES");

/*
 * The `storage` schema and its tables belong to Supabase, not to this project,
 * so this block does not try to reproduce them — it records the rights the
 * project's own storage policies cannot run without. Supabase provisions them at
 * project creation, which is why a hand-written bootstrap never mentioned them
 * and the omission went unnoticed: the throwaway proof grants them out of band.
 *
 * Only the three roles an app actually connects as are dumped. The internal
 * `supabase_*` and `dashboard_user` grants and the platform tables
 * (buckets_analytics, vector_indexes, s3_multipart_*) are deliberately left to
 * the host — a rebuilt project has no such roles yet, so copying them would make
 * the file un-runnable rather than more faithful.
 */
const APP_ROLES = "'anon', 'authenticated', 'service_role'";

for (const r of await q(
  `select distinct a.privilege_type priv, g.rolname grantee
     from pg_namespace n cross join lateral aclexplode(n.nspacl) a
     join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and g.rolname in (${APP_ROLES})
    order by 2, 1`
)) {
  say(`grant ${r.priv.toLowerCase()} on schema storage to ${r.grantee};`);
}

for (const r of await q(
  `select c.relname obj, a.privilege_type priv, g.rolname grantee
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and c.relname in ('buckets', 'objects')
      and g.rolname in (${APP_ROLES})
    order by 1, 3, 2`
)) {
  say(`grant ${r.priv.toLowerCase()} on table storage.${r.obj} to ${r.grantee};`);
}

/* The path helpers the storage policies above call — only the ones they actually
 * reference. Their ACL is NULL, which in Postgres means "the default", so
 * aclexplode() must be handed acldefault() or it returns no rows at all and the
 * dependency silently disappears from this file. */
const called = new Set();
for (const p of await q(
  `select pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) w
     from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage')`
)) {
  for (const expr of [p.q, p.w]) {
    for (const f of String(expr ?? "").matchAll(/storage\.([a-z_]+)\(/g)) called.add(f[1]);
  }
}
for (const f of await q(
  `select p.proname name, pg_get_function_identity_arguments(p.oid) args,
          coalesce(g.rolname, 'public') grantee
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles g on g.oid = a.grantee
    where n.nspname = 'storage' and lower(a.privilege_type) = 'execute'
    order by 1, 3`
)) {
  if (!called.has(f.name)) continue;
  if (["supabase_admin", "supabase_storage_admin"].includes(f.grantee)) continue;
  say(`grant execute on function storage.${f.name}(${f.args}) to ${f.grantee};`);
}

/* -------------------------------------------------------------------------- */
block("STORAGE BUCKETS");

for (const b of await q(
  `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id`
)) {
  say(
    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\n` +
      `values (${quote(b.id)}, ${quote(b.name)}, ${b.public}, ${b.file_size_limit ?? "null"}, ` +
      `${b.allowed_mime_types ? `array[${b.allowed_mime_types.map(quote).join(", ")}]::text[]` : "null"})\n` +
      `on conflict (id) do update\n  set file_size_limit = excluded.file_size_limit,\n` +
      `      allowed_mime_types = excluded.allowed_mime_types;`
  );
}

/* -------------------------------------------------------------------------- */
block("REALTIME PUBLICATION");

/* Which public tables the app asked Realtime to stream. Supabase creates the
 * publication empty, so every table listed here is project intent. */
for (const t of await q(
  `select pt.pubname, pt.tablename from pg_publication_tables pt
     where pt.schemaname = 'public' order by 1, 2`
)) {
  say(
    `do $$ begin\n` +
      `  if not exists (select 1 from pg_publication_tables\n` +
      `                   where pubname = ${quote(t.pubname)} and tablename = ${quote(t.tablename)}) then\n` +
      `    execute ${quote(`alter publication ${t.pubname} add table public.${t.tablename}`)};\n` +
      `  end if;\n` +
      `exception when undefined_object then null; end $$;`
  );
}

/* -------------------------------------------------------------------------- */
block("SEED DATA — Sharm Dreams Group companies");

say(
  `insert into tenants_and_companies (id, name, slug, sector, country) values
  ('11111111-1111-1111-1111-111111111101', 'Sharm Dreams Touristic', 'sharm-dreams-touristic', 'HOSPITALITY', 'Egypt'),
  ('11111111-1111-1111-1111-111111111102', 'Rowad Misr Development', 'rowad-misr', 'COMMERCIAL_DEVELOPMENT', 'Egypt'),
  ('11111111-1111-1111-1111-111111111103', 'Sharm Dreams Real Estate', 'sharm-dreams-realestate', 'REAL_ESTATE', 'Egypt'),
  ('11111111-1111-1111-1111-111111111104', 'SDG Corporate Shared Services', 'sdg-corporate', 'CORPORATE', 'Egypt')
on conflict (slug) do nothing;`
);

/* -------------------------------------------------------------------------- */
block("REFERENCE ROWS — the lookup data the console reads before it can render");

/*
 * These twelve tables used to be filled only by hand-written migrations, so a
 * project built from this file had the schema of the portal and none of its
 * vocabulary: no permission catalogue (so every has_permission() check failed
 * closed), no roles (so Settings → Team had nothing to assign), no notification
 * templates (so dispatch-by-key found no copy), no currencies, no AI routing
 * rows. Dumping them makes this file describe a working console.
 *
 * Rows carry their primary keys, so re-running the block duplicates nothing.
 * created_at / updated_at are left out on purpose — they take their defaults,
 * and including them would churn the file every time any row was touched.
 *
 * Two kinds of column are deliberately nulled rather than dumped:
 *   - updated_by and head_profile_id, which point at user_profiles rows that
 *     belong to this project's staff, not to the schema;
 *   - any app_settings row flagged is_secret, which is none of them today but is
 *     the rule the dump follows so a future credential can never leak into a
 *     committed file. (Every column named "key" on these tables is a lookup key.)
 */
const REFERENCE = [
  { t: "permissions", pk: ["key"], cols: ["key", "label", "group_name", "description"] },
  { t: "roles", pk: ["id"], cols: ["id", "key", "label", "description", "is_system"] },
  {
    t: "role_permissions",
    pk: ["role_key", "permission_key"],
    cols: ["role_key", "permission_key", "granted"],
  },
  { t: "currencies", pk: ["id"], cols: ["id", "code", "symbol", "label", "is_active", "sort_order"] },
  {
    t: "skills",
    pk: ["id"],
    cols: ["id", "name", "category", "description", "is_active", "sort_order"],
  },
  {
    t: "notification_templates",
    pk: ["id"],
    cols: ["id", "key", "channel", "subject", "body", "is_active"],
  },
  {
    t: "ai_model_config",
    pk: ["capability"],
    cols: ["capability", "primary_model", "fallback_model", "temperature", "max_tokens", "is_enabled", "updated_by"],
    nulls: ["updated_by"],
  },
  {
    t: "departments",
    pk: ["id"],
    cols: ["id", "tenant_id", "name", "slug", "description", "head_profile_id", "is_active", "sort_order"],
    nulls: ["head_profile_id"],
  },
  {
    t: "locations",
    pk: ["id"],
    cols: ["id", "tenant_id", "name", "city", "governorate", "country", "timezone", "address", "is_active", "sort_order"],
  },
  {
    t: "role_families",
    pk: ["id"],
    cols: ["id", "key", "label", "description", "department_id", "is_active", "sort_order"],
  },
  {
    t: "role_family_skills",
    pk: ["role_family_id", "skill_id"],
    cols: ["role_family_id", "skill_id", "required_level", "weight"],
  },
  {
    t: "app_settings",
    pk: ["id"],
    cols: ["id", "scope", "company_id", "key", "value", "description", "is_secret", "updated_by"],
    jsonb: ["value"],
    nulls: ["updated_by"],
    where: "is_secret = false",
  },
];

/* A jsonb column has to be dumped as its own text: node hands back a JS boolean
 * for `true`, which would print as the SQL keyword `true` — and Postgres refuses
 * `boolean` into `jsonb`. Quoted text does coerce. */
function lit(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return quote(v.toISOString());
  if (typeof v === "object") return quote(JSON.stringify(v));
  return quote(String(v));
}

let refTotal = 0;
for (const spec of REFERENCE) {
  const where = spec.where ? ` where ${spec.where}` : "";
  const exprs = spec.cols.map((col) =>
    (spec.jsonb ?? []).includes(col) ? `"${col}"::text as "${col}"` : `"${col}"`
  );
  const rows = await q(
    `select ${exprs.join(", ")} from public.${spec.t}${where} order by ${spec.pk.join(", ")}`
  );
  const skip = new Set(spec.nulls ?? []);
  for (const r of rows) {
    say(
      `insert into public.${spec.t} (${spec.cols.join(", ")}) values (` +
        spec.cols.map((col) => lit(skip.has(col) ? null : r[col])).join(", ") +
        `) on conflict (${spec.pk.join(", ")}) do nothing;`
    );
  }
  refTotal += rows.length;
  if (spec.t === "app_settings") {
    const secret = (await q(`select count(*)::int n from public.app_settings where is_secret`))[0].n;
    if (secret) say(`-- ${secret} app_settings row(s) flagged is_secret were not dumped.`);
  }
}
say(`-- ${refTotal} reference rows above. Their order is load-bearing: parents before children.`);

process.stdout.write(out.join("\n") + "\n");
await c.end();
