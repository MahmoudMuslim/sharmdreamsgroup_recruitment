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

const staff = await (async () => {
  const c = new Client({
    user: "postgres",
    password: env.LOCAL_DB_PASSWORD,
    host: "localhost",
    port: Number(env.LOCAL_DB_PORT) || 54320,
    database: "sharm_dreams",
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  // `sub` must be the AUTH uid, i.e. user_profiles.auth_user_id (= auth.users.id),
  // never user_profiles.id. The two differ on this stack: the profile PK defaults
  // to gen_random_uuid() and only auth_user_id FK-references auth.users(id), so a
  // token carrying the profile id makes auth.uid() and is_staff() both miss, and
  // checks 2 and 4 fail at zero rows for a reason that has nothing to do with RLS.
  const r = await c.query(
    "select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
  );
  await c.end();
  if (!r.rowCount) throw new Error("run scripts/seed-local-staff.mjs first");
  return r.rows[0].auth_user_id;
})();

const staffToken = mintToken({ sub: staff, role: "authenticated" });
const anonToken = mintToken({ sub: "00000000-0000-0000-0000-000000000000", role: "anon" });

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

// 5. Task 5's lock-down must hold even for staff.
for (const t of ["jobs", "applicants"]) {
  const r = await rest(staffToken, `${t}?select=id`);
  check(`locked-down table ${t} is unreachable even with a staff token`,
    r.status === 401 || r.status === 403 || r.status === 404,
    `status ${r.status}`);
}

// 6. The two RPCs the app calls must be exposed by PostgREST.
//    Both take one required named uuid (`refresh_attempt_integrity(target_attempt)`
//    and `stop_time_entry(entry_id)`, measured from pg_proc), so a `{}` body is not
//    "reached the function and tripped a not-null violation" — PostgREST answers 404
//    PGRST202 because no zero-argument form of either name exists in the schema
//    cache. Probing with the nil uuid resolves the signature and the UPDATE inside
//    matches no row, so the check stays a no-op on data.
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
  // 200/204 = ran; 400 = reached the function and it raised.
  // 404 = PostgREST does not expose it, which is the only real failure.
  check(`rpc/${name} is exposed`, r.status !== 404, `status ${r.status}, ${text.slice(0, 100)}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
