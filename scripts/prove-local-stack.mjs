/*
 * Proves the self-hosted stack enforces the ported policies the same way the
 * vendor did, for the same uid. Run it after every slice.
 *
 *   npm run stack:prove
 *
 * It talks to the gateway over HTTP, exactly like the app will, and computes the
 * expected answer in SQL on the same connection PostgREST uses — so a disagreement
 * is a real behavioural difference, not a difference in transport.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, "docker", ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const SECRET = env.AUTH_JWT_SECRET;
const BASE = `http://localhost:${env.LOCAL_GATEWAY_PORT || 54321}/rest/v1`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function mintToken(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    aud: "sdg_local",
    iss: "sharm-dreams-local",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...claims,
  });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function rest(token, qs) {
  const res = await fetch(`${BASE}/${qs}`, {
    headers: {
      Accept: "application/json",
      Prefer: "count=exact",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const range = res.headers.get("content-range");
  const json = res.status >= 400 ? await res.text() : await res.json();
  return { status: res.status, json, range };
}

// PostgREST answers every failure with {"code":…,"message":…}. `code` is what tells
// the mechanisms apart: PGRSTnnn is PostgREST itself refusing (303 = token not in
// audience, 202 = no function matched that signature, 205 = schema not exposed),
// while a bare SQLSTATE like 42501 came from the database, past the HTTP layer.
function errorCode(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.code === "string" ? parsed.code : "";
  } catch {
    return "";
  }
}

// One connection, opened here and closed after the last check: check 5 compares an
// HTTP answer against catalog SQL, and that comparison only means something if both
// halves describe the same stack at the same instant.
// Password, host, port and database are passed as FIELDS on purpose — never rebuild
// this as a postgresql:// URI: a rotated password containing @ / or % misparses into
// the wrong database name, which is why commit 9b6ca2f exists.
// And note: loopback is `trust` in this cluster's pg_hba, so a successful connect here
// proves only that the port is published and the database exists. It is never
// evidence that a password was checked.
const db = new Client({
  user: "postgres",
  password: env.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(env.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await db.connect();

// `sub` must be the AUTH uid, i.e. user_profiles.auth_user_id (= auth.users.id),
// never user_profiles.id. The two differ on this stack: the profile PK defaults
// to gen_random_uuid() and only auth_user_id FK-references auth.users(id), so a
// token carrying the profile id makes auth.uid() and is_staff() both miss, and
// checks 2 and 4 fail at zero rows for a reason that has nothing to do with RLS.
// Measured: the SUPER_ADMIN profile PK is 48dfd60a-… while its auth user is
// f2f37a1a-…, and `id is not distinct from auth_user_id` is false for all three
// fixtures.
const staffRow = await db.query(
  "select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
);
if (!staffRow.rowCount) {
  await db.end();
  throw new Error("run scripts/seed-local-staff.mjs first");
}
const staff = staffRow.rows[0].auth_user_id;

const staffToken = mintToken({ sub: staff, role: "authenticated" });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

// 1. No token at all: the anon role must be refused every staff table's rows.
const anonProfiles = await rest(null, "user_profiles?select=id");
check("tokenless read of user_profiles is allowed by the API but returns no rows",
  anonProfiles.status === 200 && Array.isArray(anonProfiles.json) && anonProfiles.json.length === 0,
  `status ${anonProfiles.status}, ${JSON.stringify(anonProfiles.json).slice(0, 120)}`);

// 2. A staff token must see its own profile — the auth.uid() path end to end.
const mine = await rest(staffToken, `user_profiles?select=id,role&auth_user_id=eq.${staff}`);
check("auth.uid() reaches the row: staff sees its own profile",
  mine.status === 200 && Array.isArray(mine.json) && mine.json.length === 1 && mine.json[0].role === "SUPER_ADMIN",
  `status ${mine.status}, ${JSON.stringify(mine.json).slice(0, 160)}`);

// 3. THE LOAD-BEARING ONE. A token must never be *refused* by PostgREST. If the
//    role switch failed, every check above would "pass" by returning zero rows
//    for the wrong reason, and the whole suite would be worthless.
const refused = await rest(staffToken, "user_profiles?select=id");
check("the staff token is accepted, not merely unanswered",
  refused.status === 200,
  `status ${refused.status}, ${JSON.stringify(refused.json).slice(0, 160)}`);

// 4. is_staff() must be SECURITY DEFINER and reach user_profiles through RLS.
//    If ownership ever changes, is_staff() returns false for everyone and every
//    staff page silently 404s — this is the check that catches it.
const staffSawAll = await rest(staffToken, "user_profiles?select=id");
check("is_staff() admits the staff role to the profile table",
  staffSawAll.status === 200 && Array.isArray(staffSawAll.json) && staffSawAll.json.length >= 3,
  `rows ${Array.isArray(staffSawAll.json) ? staffSawAll.json.length : "n/a"}`);

// 5. Task 5's lock-down must hold even for staff — and it must hold for the RIGHT
//    reason. The old predicate (401 || 403 || 404) also matched a broken token:
//    measured, a wrong-aud JWT answers `401 PGRST303 "JWT not in audience"` for
//    EVERY table, open or locked — including job_openings, which a valid staff token
//    reads at 200. So a row-count or status-only assertion cannot tell "the grants
//    are revoked" from "my token is junk". Both halves below are required:
//      HTTP: 403 whose body carries SQLSTATE "42501" (permission denied for table),
//            i.e. the request reached Postgres and the GRANT refused it; and
//      SQL, on this connection: zero rows in pg_policies for the table, and no
//            `anon=` / `authenticated=` entry in pg_class.relacl.
//    Measured baseline: jobs/applicants relacl is
//    {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}, both carry no
//    policy at all, and the control table job_openings still holds
//    anon=…,authenticated=… with 2 policies.
for (const t of ["jobs", "applicants"]) {
  const r = await rest(staffToken, `${t}?select=id`);
  const cat = await db.query(
    `select
       (select count(*)::int from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = $1) as policy_rows,
       (select array_to_string(relacl, ',') from pg_catalog.pg_class
         where relnamespace = 'public'::regnamespace and relname = $1) as relacl`,
    [t],
  );
  const policyRows = cat.rows[0].policy_rows;
  const relacl = cat.rows[0].relacl ?? "";
  // One aclitem per comma: `<grantee>=<privs>/<grantor>`; a NULL relacl means no
  // explicit grants at all, which is equally closed.
  const aclGrantees = relacl
    .split(",")
    .filter(Boolean)
    .map((item) => item.split("=")[0].trim());
  const httpDenied =
    r.status === 403 && /"code"\s*:\s*"42501"/.test(String(r.json));
  check(
    `locked-down table ${t} is denied by its own GRANT (403 + 42501), not by a refused token`,
    httpDenied && policyRows === 0 && !aclGrantees.some((g) => g === "anon" || g === "authenticated"),
    `http ${r.status} code ${errorCode(r.json) || "none"}, pg_policies ${policyRows} rows, relacl ${relacl ? `[${relacl.slice(0, 80)}]` : "NULL"}`,
  );
}

// 6. The two RPCs the app calls must be exposed by PostgREST AND actually resolve.
//    Both take one required named uuid (`refresh_attempt_integrity(target_attempt)`
//    and `stop_time_entry(entry_id)`, read from pg_proc), so a `{}` body is not
//    "reached the function and tripped a not-null violation" — PostgREST answers 404
//    PGRST202 because no zero-argument form of either name exists in the schema
//    cache. That is an ARITY MISS CAUSED BY THE PROBE, and it is not evidence about
//    exposure at all, so probing with `{}` could never fail for the right reason.
//    Probing with the signature's own parameter name and the nil uuid does resolve
//    (measured 204 and 200 null), and stays a no-op: both bodies are a single UPDATE
//    keyed `where id = <the uuid>` with no INSERT anywhere, and neither target table
//    holds a row whose id is the nil uuid, so zero rows match and nothing is written.
//    A 400 still counts as exposed, but only when its body proves the FUNCTION ran:
//    PostgREST's own rejections carry a PGRSTnnn code, a database error raised inside
//    the body carries its SQLSTATE. 404 is the one real failure, and the printed code
//    separates PGRST202 (no such signature) from PGRST205 (the schema is not exposed).
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const RPCS = [
  { name: "refresh_attempt_integrity", arg: "target_attempt" },
  { name: "stop_time_entry", arg: "entry_id" },
];
for (const { name, arg } of RPCS) {
  const r = await fetch(`${BASE}/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ [arg]: NIL_UUID }),
  });
  const text = await r.text();
  const code = errorCode(text);
  const ran = r.status === 200 || r.status === 204;
  const raisedInsideBody = r.status === 400 && code !== "" && !code.startsWith("PGRST");
  check(`rpc/${name} is exposed and resolves its signature`,
    ran || raisedInsideBody,
    `status ${r.status}, code ${code || "none"}, ${(text || "<empty body>").slice(0, 90)}`);
}

await db.end();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
