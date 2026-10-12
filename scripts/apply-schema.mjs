/**
 * Applies supabase/schema.sql to the live Supabase Postgres instance via the
 * Supavisor pooler, then seeds demo data (jobs, assessment templates,
 * questions, applications) and creates the admin auth user via the
 * management API.
 *
 * Usage: node scripts/apply-schema.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const POOLER_HOST = process.env.POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com";
const PROJECT_REF = env.SUPABASE_PROJECT_REF;
const DB_PASSWORD = env.SUPABASE_DB_PASSWORD;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const APP_URL = env.APP_URL || "http://localhost:3000";

if (!PROJECT_REF || !DB_PASSWORD || !SERVICE_ROLE || !SUPABASE_URL) {
  console.error("Missing required env vars in .env.local");
  process.exit(1);
}

const sql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

const client = new Client({
  host: POOLER_HOST,
  port: 5432,
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(`Connecting to ${POOLER_HOST} (project ${PROJECT_REF})…`);
  await client.connect();

  console.log("Applying schema.sql…");
  await client.query(sql);
  console.log("Schema applied.");

  const seedFile = readFileSync(join(root, "supabase", "seed.sql"), "utf8");
  console.log("Applying seed.sql…");
  await client.query(seedFile);
  console.log("Seed applied.");

  await client.end();

  // ---------------------------------------------------------------------
  // Create admin auth users via Supabase management API
  // ---------------------------------------------------------------------
  const managementBase = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;

  async function management(path, init) {
    const response = await fetch(`${managementBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${DB_PASSWORD}`, // placeholder, replaced below
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    return response;
  }
  void management;

  // Management API needs a Supabase platform access token which we do not
  // have; instead we create auth users through the GoTrue admin endpoint
  // using the service role key.
  const users = [
    { email: "admin@sharmdreams.com", password: "Admin#2024", full_name: "Mahmoud Muslim", role: "SUPER_ADMIN", tenant_id: null, locale: "en" },
    { email: "recruiter@sharmdreams.com", password: "Recruit#2024", full_name: "Sara Hassan", role: "RECRUITER", tenant_id: "11111111-1111-1111-1111-111111111101", locale: "ar" },
    { email: "manager@rowadmisr.com", password: "Manager#2024", full_name: "Omar Khaled", role: "HIRING_MANAGER", tenant_id: "11111111-1111-1111-1111-111111111102", locale: "en" },
  ];

  for (const user of users) {
    const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: user.full_name },
      }),
    });

    let authUserId = null;
    if (createResponse.ok) {
      const created = await createResponse.json();
      authUserId = created.id;
      console.log(`Created auth user ${user.email} (${authUserId})`);
    } else if (createResponse.status === 422) {
      // Already exists — look it up.
      const listResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      const list = await listResponse.json();
      const existing = (list.users ?? []).find((u) => u.email === user.email);
      authUserId = existing?.id ?? null;
      console.log(`Auth user ${user.email} already exists (${authUserId})`);
    } else {
      console.error(`Failed creating ${user.email}: ${createResponse.status} ${await createResponse.text()}`);
      continue;
    }

    if (authUserId) {
      await client2UpsertProfile(authUserId, user);
    }
  }

  console.log("Done.");
  console.log(`\nAdmin login: admin@sharmdreams.com / Admin#2024`);
  console.log(`App URL: ${APP_URL}`);
}

async function client2UpsertProfile(authUserId, user) {
  const profileClient = new Client({
    host: POOLER_HOST,
    port: 5432,
    user: `postgres.${PROJECT_REF}`,
    password: DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await profileClient.connect();
  await profileClient.query(
    `insert into user_profiles (auth_user_id, tenant_id, full_name, email, role, locale)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (auth_user_id) do update
       set tenant_id = excluded.tenant_id, full_name = excluded.full_name,
           email = excluded.email, role = excluded.role, locale = excluded.locale`,
    [authUserId, user.tenant_id, user.full_name, user.email, user.role, user.locale]
  );
  await profileClient.end();
  console.log(`Profile upserted for ${user.email} (${user.role})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
