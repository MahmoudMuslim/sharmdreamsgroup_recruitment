/**
 * Provisions recruiter accounts in Supabase Auth and links each one to a
 * `user_profiles` row carrying the RBAC role and company (tenant).
 *
 * Usage (PowerShell):
 *   node scripts/create-staff.mjs admin@sharmdreams.com "Admin Name" SUPER_ADMIN sharm-dreams-touristic
 *
 * The password is read from the STAFF_PASSWORD environment variable, or
 * generated and printed once if it is not set.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Trim-aware: `APP_URL=` (empty but defined) in .env.local would otherwise slip
// straight past `??` and print a host-less "/login".
const APP_URL = (process.env.APP_URL ?? "").trim() || "http://localhost:3000";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run through: npx dotenv -e .env.local -- node scripts/create-staff.mjs"
  );
  process.exit(1);
}

const [email, fullName, role = "RECRUITER", tenantSlug] = process.argv.slice(2);

if (!email || !fullName) {
  console.error("Usage: create-staff.mjs <email> <full name> [ROLE] [tenant slug]");
  process.exit(1);
}

const VALID_ROLES = ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER", "CANDIDATE"];
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Expected one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

const password = process.env.STAFF_PASSWORD ?? randomBytes(12).toString("base64url");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Idempotent: an existing account is reused rather than duplicated. */
async function findExistingAuthUser() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function main() {
  const existing = await findExistingAuthUser();

  const authUserId = existing
    ? existing.id
    : (
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        })
      ).data.user?.id;

  if (!authUserId) {
    console.error("Failed to create or resolve the auth user.");
    process.exit(1);
  }

  let tenantId = null;
  if (tenantSlug) {
    const { data: tenant, error } = await supabase
      .from("tenants_and_companies")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();
    if (error) throw error;
    if (!tenant) {
      console.error(`No tenant found with slug "${tenantSlug}".`);
      process.exit(1);
    }
    tenantId = tenant.id;
  }

  const { error: profileError } = await supabase.from("user_profiles").upsert(
    {
      auth_user_id: authUserId,
      email,
      full_name: fullName,
      role,
      tenant_id: tenantId,
    },
    { onConflict: "auth_user_id" }
  );

  if (profileError) {
    console.error("Failed to upsert user_profiles:", profileError.message);
    process.exit(1);
  }

  console.log("Staff account ready:");
  console.log(`  email    : ${email}`);
  console.log(`  name     : ${fullName}`);
  console.log(`  role     : ${role}`);
  console.log(`  tenant   : ${tenantSlug ?? "(group-wide)"}`);
  if (!existing) console.log(`  password : ${password}`);
  console.log(`\nSign in at ${APP_URL}/login`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});