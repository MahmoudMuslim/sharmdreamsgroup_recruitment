/*
 * Seeds a tiny staff directory into the LOCAL self-hosted stack so identity can
 * be proved without a live dump. Never point this at the vendor: it writes
 * auth.users rows directly, which is exactly what GoTrue used to do for us.
 *
 *   node scripts/seed-local-staff.mjs
 *
 * Passwords go in as pgcrypto bcrypt, i.e. `extensions.crypt(pw,
 * extensions.gen_salt('bf', 10))`, so they are byte-compatible with the hashes a
 * restored live dump carries and Task 9 can verify both the same way. The
 * `extensions.` prefix is not decoration: Task 3 installs pgcrypto `with schema
 * extensions`, and a `pg` client's default search_path is `"$user", public`, so
 * an unqualified `gen_salt(...)` raises
 * `function gen_salt(unknown, integer) does not exist` (measured). The password
 * is read from docker/.env and is never printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
if (!local.LOCAL_DB_PASSWORD || !local.LOCAL_STAFF_PASSWORD) {
  console.error("docker/.env needs LOCAL_DB_PASSWORD and LOCAL_STAFF_PASSWORD.");
  process.exit(1);
}

const STAFF = [
  { email: "owner.local@sharmdreams.test", name: "Local Owner", role: "SUPER_ADMIN" },
  { email: "recruiter.local@sharmdreams.test", name: "Local Recruiter", role: "RECRUITER" },
  { email: "candidate.local@sharmdreams.test", name: "Local Candidate", role: "CANDIDATE" },
];

const c = new Client({
  user: "postgres",
  password: local.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(local.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await c.connect();

const tenant = await c.query(
  "select id from public.tenants_and_companies where is_group_profile = true limit 1"
);
if (!tenant.rowCount) throw new Error("no group tenant — did schema.sql apply its seed rows?");
const tenantId = tenant.rows[0].id;

for (const s of STAFF) {
  const { rows } = await c.query(
    `with up as (
       insert into auth.users (email, role, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ($1, 'authenticated', extensions.crypt($2, extensions.gen_salt('bf', 10)), now(),
               jsonb_build_object('provider','email','providers',array['email'],
                                  'tenant_id', $3::uuid),
               jsonb_build_object('full_name', $4::text))
       on conflict (email) do update
         set encrypted_password = excluded.encrypted_password
       returning id
     )
     insert into public.user_profiles (auth_user_id, tenant_id, full_name, email, role, locale)
     select id, $3::uuid, $4, $1, $5::user_role, 'en' from up
     on conflict (auth_user_id) do update
       set role = excluded.role, full_name = excluded.full_name, email = excluded.email
     returning auth_user_id, role`,
    [s.email, local.LOCAL_STAFF_PASSWORD, tenantId, s.name, s.role]
  );
  console.log(`seeded ${s.role} profile for ${s.email}`);
  if (!rows.length) throw new Error(`profile not written for ${s.email}`);
}

await c.end();
