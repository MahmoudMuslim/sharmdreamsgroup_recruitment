/*
 * Proves the eight `public.files` policies (db/schema.sql, Plan 2 Task 2)
 * enforce the same rules the vendor's eight `storage.objects` policies did, over
 * the door that will actually carry them: the gateway, exactly as the File
 * Manager will call it.
 *
 *   node scripts/prove-files-rls.mjs
 *
 * Reads docker/.env, never .env.local, and never connects to the vendor.
 *
 * Which door is load-bearing: uploads write through the app's own pool, whose
 * login owns the table and therefore bypasses RLS. These policies bind the
 * PostgREST path — every list, read and delete the portal makes. So the checks
 * below are all HTTP, and the only SQL connection is the table owner's, used to
 * plant a known row and to verify what the HTTP layer actually did to it.
 *
 * Every row this script inserts is deleted by the owner before it exits, and
 * the final check asserts the table is back where it started. A proof that
 * leaves probe rows behind would show phantom files in the File Manager.
 */
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
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
if (!SECRET) {
  console.error("docker/.env is missing AUTH_JWT_SECRET; PostgREST and this script must agree on it.");
  process.exit(1);
}
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

async function rest(token, path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = res.status >= 400 ? await res.text() : "";
  const json = res.status >= 400 ? text : await res.json().catch(() => null);
  return { status: res.status, json, text };
}

// Same distinction prove-local-stack.mjs draws: a PGRSTnnn code is PostgREST
// refusing before the database ran, a bare SQLSTATE like 42501 is RLS refusing
// it. Only the second is evidence about a policy.
function code(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    return typeof parsed?.code === "string" ? parsed.code : "";
  } catch {
    return "";
  }
}

// PostgREST answers the same database refusal with two different statuses: 401
// when the request ran as `anon`, 403 when it ran as `authenticated`. Measured
// on this stack — both bodies are the identical
// `{"code":"42501","message":"new row violates row-level security policy for
// table \"files\""}`. So a status-only assertion is wrong half the time, and a
// caller that maps 401 to "your session expired" would bounce an anonymous
// candidate who merely tripped a policy. Every refusal check below therefore
// matches on the SQLSTATE and accepts either status.
function refusedByPolicy(answer) {
  const status = answer.status;
  return code(answer.text ?? answer.json) === "42501" && (status === 401 || status === 403);
}

const db = new Client({
  user: "postgres",
  password: env.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(env.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await db.connect();

// `sub` is the AUTH uid (user_profiles.auth_user_id), not the profile PK — the
// two differ on this stack and a token with the wrong half makes is_staff()
// return false for a genuine super admin.
const staffRow = await db.query(
  "select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
);
if (!staffRow.rowCount) {
  await db.end();
  throw new Error("run scripts/seed-local-staff.mjs first");
}
const staff = staffRow.rows[0].auth_user_id;
const staffToken = mintToken({ sub: staff, role: "authenticated" });
// A token the database will accept at the HTTP layer and reject at the policy
// layer: valid signature and audience, no user_profiles row, so is_staff() is
// false. This is what a signed-in candidate looks like to RLS.
const outsiderToken = mintToken({ sub: randomUUID(), role: "authenticated" });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const marker = `sdg-prove-${randomUUID().slice(0, 8)}`;
// Teardown matches the marker ANYWHERE in the path, not as a prefix, because two
// of the policies under test force a path to start with something else —
// `public/…` and `applications/…` — so `path like 'sdg-prove-…%'` silently keeps
// those rows and the next run reads last run's leftovers. A random uuid8 prefix
// cannot collide with a real candidate file, and this table never grows past a
// few thousand rows, so the scan is not worth an index.
const seedCount = await db.query("select count(*)::int as n from public.files");
const baseline = seedCount.rows[0].n;

// --- 1. The table is reachable and staff-only on the read side ---------------
const staffList = await rest(staffToken, "files?select=bucket,path");
check("a staff session can list files",
  staffList.status === 200 && Array.isArray(staffList.json),
  `status ${staffList.status}, code ${code(staffList.json) || "none"}`);

const tokenless = await rest(null, "files?select=bucket,path");
check("a tokenless read is allowed by the API and answers zero rows",
  tokenless.status === 200 && Array.isArray(tokenless.json) && tokenless.json.length === 0,
  `status ${tokenless.status}, rows ${Array.isArray(tokenless.json) ? tokenless.json.length : "n/a"}`);

const outsiderList = await rest(outsiderToken, "files?select=bucket,path");
check("a signed-in non-staff session reads zero rows",
  outsiderList.status === 200 && Array.isArray(outsiderList.json) && outsiderList.json.length === 0,
  `status ${outsiderList.status}, rows ${Array.isArray(outsiderList.json) ? outsiderList.json.length : "n/a"}`);

// --- 2. The attempt-token predicate, which is the candidate's only door ------
// The vendor wrote `(storage.foldername(name))[1]`; this writes
// `split_part(path, '/', 1)`. Both mean "the first path segment is the token".
const attemptToken = `${marker}-token`;
const ownVideo = await rest(mintToken({ role: "anon", attempt_token: attemptToken }), "files", {
  method: "POST",
  body: { bucket: "candidate-videos", path: `${attemptToken}/${marker}-q1.webm`, mime: "video/webm", bytes: 2048 },
  prefer: "return=minimal",
});
check("an attempt token may write its own video folder",
  ownVideo.status === 201,
  `status ${ownVideo.status}, code ${code(ownVideo.text) || "none"}`);

const otherVideo = await rest(mintToken({ role: "anon", attempt_token: attemptToken }), "files", {
  method: "POST",
  body: { bucket: "candidate-videos", path: `someone-else/${marker}-q2.webm`, mime: "video/webm", bytes: 2048 },
  prefer: "return=minimal",
});
check("the same token may NOT write another attempt's folder",
  refusedByPolicy(otherVideo) && otherVideo.status === 401,
  `status ${otherVideo.status}, code ${code(otherVideo.text) || "none"}`);

const anonNoToken = await rest(mintToken({ role: "anon" }), "files", {
  method: "POST",
  body: { bucket: "candidate-videos", path: `${marker}/orphan.webm`, mime: "video/webm", bytes: 1 },
  prefer: "return=minimal",
});
check("a video write with no attempt token claim is refused",
  refusedByPolicy(anonNoToken),
  `status ${anonNoToken.status}, code ${code(anonNoToken.text) || "none"}`);

// --- 3. The CV door is bucket-scoped, not path-scoped ------------------------
const cv = await rest(mintToken({ role: "anon" }), "files", {
  method: "POST",
  body: { bucket: "candidate-cvs", path: `${marker}/cv.pdf`, mime: "application/pdf", bytes: 4096 },
  prefer: "return=minimal",
});
check("an anonymous candidate may register a CV",
  cv.status === 201,
  `status ${cv.status}, code ${code(cv.text) || "none"}`);

const wrongBucket = await rest(mintToken({ role: "anon" }), "files", {
  method: "POST",
  body: { bucket: "resumes", path: `applications/${marker}/forged.pdf`, mime: "application/pdf", bytes: 1 },
  prefer: "return=minimal",
});
check("an anonymous candidate may NOT write a staff resume under applications/",
  refusedByPolicy(wrongBucket),
  `status ${wrongBucket.status}, code ${code(wrongBucket.text) || "none"}`);

const publicResume = await rest(mintToken({ role: "anon" }), "files", {
  method: "POST",
  body: { bucket: "resumes", path: `public/${marker}.pdf`, mime: "application/pdf", bytes: 1 },
  prefer: "return=minimal",
});
check("an anonymous candidate may write resumes only under public/",
  publicResume.status === 201,
  `status ${publicResume.status}, code ${code(publicResume.text) || "none"}`);

// --- 4. Staff writes are gated on the permission, not just the role ----------
const staffUpload = await rest(staffToken, "files", {
  method: "POST",
  body: { bucket: "resumes", path: `applications/${marker}/attached.pdf`, mime: "application/pdf", bytes: 1 },
  prefer: "return=minimal",
});
check("a super admin uploads a resume under applications/",
  staffUpload.status === 201,
  `status ${staffUpload.status}, code ${code(staffUpload.text) || "none"}`);

const outsiderUpload = await rest(outsiderToken, "files", {
  method: "POST",
  body: { bucket: "resumes", path: `applications/${marker}/outsider.pdf`, mime: "application/pdf", bytes: 1 },
  prefer: "return=minimal",
});
check("a signed-in non-staff session cannot upload into applications/",
  refusedByPolicy(outsiderUpload) && outsiderUpload.status === 403,
  `status ${outsiderUpload.status}, code ${code(outsiderUpload.text) || "none"}`);

// --- 5. Delete: the RLS precondition, proved by what survives ----------------
// PostgREST DELETE answers 204 whether or not a row matched, so a status code
// can never distinguish "policy admitted me and I deleted it" from "policy
// hid the row and I deleted nothing". Each attempt is therefore followed by an
// owner-side count of the specific path.
const doomed = `${marker}/doomed.pdf`;
await db.query(
  "insert into public.files (bucket, path, mime, bytes) values ('candidate-cvs', $1, 'application/pdf', 1)",
  [doomed]
);
const refusedDelete = await rest(outsiderToken, `files?bucket=eq.candidate-cvs&path=eq.${encodeURIComponent(doomed)}`, {
  method: "DELETE",
});
const afterOutsider = await db.query("select count(*)::int as n from public.files where path = $1", [doomed]);
check("a non-staff DELETE matches nothing — the row survives it",
  afterOutsider.rows[0].n === 1,
  `delete ${refusedDelete.status}, rows still there ${afterOutsider.rows[0].n}`);

// The same row, and now the staff policy must reach it. A staff SELECT policy
// for candidate-cvs has to exist or this delete silently answers 204 and leaves
// the row: the UPDATE-requires-SELECT trap, applied to DELETE.
const staffDelete = await rest(staffToken, `files?bucket=eq.candidate-cvs&path=eq.${encodeURIComponent(doomed)}`, {
  method: "DELETE",
});
const afterStaff = await db.query("select count(*)::int as n from public.files where path = $1", [doomed]);
check("a staff DELETE reaches the row and removes it",
  staffDelete.status < 300 && afterStaff.rows[0].n === 0,
  `delete ${staffDelete.status}, rows left ${afterStaff.rows[0].n}`);

// --- 6. A bucket with no delete policy is undeletable through this door ------
const mediaPath = `${marker}/note.webm`;
await db.query(
  "insert into public.files (bucket, path, mime, bytes) values ('candidate-audio', $1, 'audio/webm', 1)",
  [mediaPath]
);
await rest(staffToken, `files?bucket=eq.candidate-audio&path=eq.${encodeURIComponent(mediaPath)}`, { method: "DELETE" });
const afterMedia = await db.query("select count(*)::int as n from public.files where path = $1", [mediaPath]);
check("staff delete candidate media covers candidate-audio",
  afterMedia.rows[0].n === 0,
  `rows left ${afterMedia.rows[0].n}`);

const unknownPath = `${marker}/stray.bin`;
await db.query("insert into public.files (bucket, path, bytes) values ('not-a-bucket', $1, 1)", [unknownPath]);
const unknownDelete = await rest(staffToken, `files?bucket=eq.not-a-bucket&path=eq.${encodeURIComponent(unknownPath)}`, {
  method: "DELETE",
});
const afterUnknown = await db.query("select count(*)::int as n from public.files where path = $1", [unknownPath]);
check("a bucket outside the four the policies name cannot be deleted",
  afterUnknown.rows[0].n === 1,
  `delete ${unknownDelete.status}, rows still there ${afterUnknown.rows[0].n}`);

// --- 7. The column shapes the disk store depends on --------------------------
// `bytes` is bigint, and the two transports disagree about how they hand it
// back — measured, not assumed:
//   node-postgres parses int8 as a STRING (it refuses to lose precision to a
//   float), so a pool read needs `Number(entry.bytes)` before the file browser
//   can render it. That is the coercion in src/lib/files/disk-store.ts.
//   PostgREST serialises JSON numbers, so over HTTP the same value arrives as a
//   JS number. Both halves are checked here because the File Manager reads the
//   row over HTTP and the store writes it over the pool; getting either wrong
//   shows up as "— B" or a NaN in a size column, not as an error.
// The value is 4 GiB: still exact as a float (precision ends at 2^53), and no
// candidate file approaches it, so this documents the type, not a hazard.
const bigRow = `${marker}/big.bin`;
await db.query("insert into public.files (bucket, path, bytes) values ('candidate-cvs', $1, 4294967296)", [bigRow]);
const readBack = await rest(staffToken, `files?select=bytes,path&path=eq.${encodeURIComponent(bigRow)}`);
const viaRest = Array.isArray(readBack.json) ? readBack.json[0]?.bytes : undefined;
const viaPool = await db.query("select bytes from public.files where path = $1", [bigRow]);
check("bytes arrives as a number over REST and a string over the pool",
  typeof viaRest === "number" && viaRest === 4294967296 &&
  typeof viaPool.rows[0]?.bytes === "string" && Number(viaPool.rows[0].bytes) === 4294967296,
  `rest typeof ${typeof viaRest} [${String(viaRest)}], pool typeof ${typeof viaPool.rows[0]?.bytes} [${String(viaPool.rows[0]?.bytes)}]`);

// The prefix index exists, and the listing the File Manager will run is the
// shape it was built for. An EXPLAIN here would be dishonest: on a table this
// small the planner seq-scans whatever indexes exist, so a plan assertion would
// pass and prove nothing. Catalog presence plus a correct result is the claim.
const idx = await db.query(
  "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'files_bucket_path_prefix_idx'"
);
const prefixed = await rest(staffToken, `files?select=path&bucket=eq.candidate-cvs&path=like.${encodeURIComponent(`${marker}/*`)}`);
// The exact rows this script planted under `<marker>/` in that bucket — and only
// those. A bare count would have been the wrong shape of assertion: the first
// run answered 2 where it expected 1 and the disagreement was mine, not the
// index's, because `big.bin` was planted after `cv.pdf` and both match.
const expectedUnderMarker = [`${marker}/big.bin`, `${marker}/cv.pdf`].sort();
const gotUnderMarker = (Array.isArray(prefixed.json) ? prefixed.json : [])
  .map((row) => row.path)
  .sort();
check("the prefix index exists and a prefixed listing answers exactly its rows",
  idx.rowCount === 1 &&
  gotUnderMarker.length === expectedUnderMarker.length &&
  expectedUnderMarker.every((p, i) => gotUnderMarker[i] === p),
  `index rows ${idx.rowCount}, listing [${gotUnderMarker.join(", ")}]`);

// --- 8. The GRANT line, not just the policies --------------------------------
const acl = await db.query(
  "select array_to_string(relacl, ',') as relacl from pg_class " +
    "where relnamespace = 'public'::regnamespace and relname = 'files'"
);
const relacl = acl.rows[0]?.relacl ?? "";
const grantFor = (role) =>
  relacl
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${role}=`)) ?? "";
const anonAcl = grantFor("anon");
const authAcl = grantFor("authenticated");
// The letter order Postgres prints is arwdDxt, so `ar` is INSERT+SELECT and
// `arwd` adds UPDATE+DELETE. That is the point of the line: an anonymous role
// holding no `w` and no `d` cannot rewrite or remove a row through this door
// even if a policy ever loosens.
check("anon holds insert+select only, authenticated holds all four",
  anonAcl === "anon=ar/postgres" && authAcl === "authenticated=arwd/postgres",
  `anon [${anonAcl}], authenticated [${authAcl}]`);

// --- 9. RLS is on, and the eight policies are the eight we wrote -------------
const policyRows = await db.query(
  "select polname from pg_policy p join pg_class c on c.oid = p.polrelid " +
    "where c.relname = 'files' order by polname"
);
const installedNames = policyRows.rows.map((r) => r.polname).sort();
// Compared against the eight names in db/schema.sql, not just a count: a
// re-dump or a hand edit that renames one policy and adds another would keep the
// count at eight while changing what the door actually permits.
const expectedNames = [
  "candidate video uploads",
  "candidates upload cvs",
  "public resume uploads",
  "staff delete candidate cvs",
  "staff delete candidate media",
  "staff read candidate cvs",
  "staff read candidate media",
  "staff upload candidate media",
].sort();
const rlson = await db.query("select relrowsecurity from pg_class where oid = 'public.files'::regclass");
check("RLS is enabled on files and the eight expected policies are installed",
  rlson.rows[0]?.relrowsecurity === true &&
  installedNames.length === expectedNames.length &&
  expectedNames.every((n, i) => installedNames[i] === n),
  `rowsecurity ${rlson.rows[0]?.relrowsecurity}, policies [${installedNames.join(", ")}]`);

// --- teardown: the owner deletes every probe row -----------------------------
// The owner connection bypasses RLS, which is the only way to remove the
// `not-a-bucket` row that check 6 deliberately left undeletable.
const cleaned = await db.query("delete from public.files where position($1 in path) > 0", [marker]);
const finalCount = await db.query("select count(*)::int as n from public.files");
check("the table is back where this script found it",
  finalCount.rows[0].n === baseline,
  `deleted ${cleaned.rowCount}, now ${finalCount.rows[0].n}, started at ${baseline}`);

await db.end();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join("; "));
  process.exit(1);
}
