/*
 * Proves that a filter keyed on a *storage path* reaches the row that stores
 * that path, over the door the File Manager actually uses: our own query
 * builder, our own transport, the gateway, and the RLS policies on the other
 * side.
 *
 *   node scripts/prove-path-filter.mjs
 *
 * Why this exists as its own gate. `literal()` in src/lib/rest/query-builder.ts
 * used to wrap any value with an "unsafe" character in double quotes before
 * putting it in the querystring. PostgREST's single-value grammar takes those
 * quotes as part of the value, so `path=eq."a/b.png"` looks for a row whose path
 * is literally `"a/b.png"` and answers zero rows. Every storage key contains a
 * `/`, so all eight `.eq(*_path, path)` reads in the File Manager answered "no
 * rows" about a row that existed: deleting a profile photo removed the byte,
 * wrote "Nothing pointed at it." in the audit trail with `person_id: null`, and
 * left `person_profiles.photo_path` naming a dead key — a record that offers a
 * download which 404s, forever.
 *
 * `prove-rest-builder.mjs` half five pins the *bytes* the builder puts in a
 * URL. This file pins what the database does with them, because a quoting rule
 * can be "correct" against a hand-written expectation and still match nothing:
 * the bracketed-list grammar strips quotes, the single-value grammar does not.
 * So the list checks (`in()`) assert the quotes are KEPT and still match, while
 * the single-value checks assert they are GONE.
 *
 * Every row this script plants is deleted by the owner connection before it
 * exits, and the last check asserts both tables are back where they started.
 * Nothing here touches a real candidate's record: the clear-then-verify runs on
 * a profile this script created thirty lines earlier.
 */
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createRestClient } from "../src/lib/rest/client.ts";

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
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
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
// person_profiles update policy is `is_staff() AND has_permission('candidates.write')`,
// so the token has to be a real staff member's or the write half below is
// refused for a reason that has nothing to do with the filter under test.
const staffRow = await db.query(
  "select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
);
if (!staffRow.rowCount) {
  await db.end();
  throw new Error("run scripts/seed-local-staff.mjs first");
}
const staffToken = mintToken({ sub: staffRow.rows[0].auth_user_id, role: "authenticated" });

const client = createRestClient({ baseUrl: BASE, token: staffToken });

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const marker = `sdg-pathfilter-${randomUUID().slice(0, 8)}`;
const profilesBaseline = (await db.query("select count(*)::int as n from public.person_profiles")).rows[0].n;
const filesBaseline = (await db.query("select count(*)::int as n from public.files")).rows[0].n;

// Two planted profiles, and the second one is the reason the first isn't
// enough: a key that is only `/`-separated could still be matched by a filter
// that happens to survive the split. A key with a comma, a space and parentheses
// in it is matched by nothing but a value that reaches the grammar whole.
const plainKey = `persons/${randomUUID()}/${randomUUID()}.png`;
const awkwardKey = `persons/${randomUUID()}/mohamed, cv (1).png`;

async function plant(legalName, photoPath) {
  const { rows } = await db.query(
    "insert into public.person_profiles (legal_name, photo_path, photo_mime) values ($1, $2, 'image/png') returning id",
    [`${marker} ${legalName}`, photoPath]
  );
  return rows[0].id;
}

const plainId = await plant("plain key", plainKey);
const awkwardId = await plant("awkward key", awkwardKey);
// The ledger row is removed by the id it came back with, not by a marker: its
// path has to be the real `persons/<id>/<uuid>.png` shape the read under test
// looks for, so there is nowhere to put a marker inside it.
const ledgerRow = await db.query(
  "insert into public.files (bucket, path, mime, bytes) values ('candidate-photos', $1, 'image/png', 12) returning id",
  [plainKey]
);
const ledgerId = ledgerRow.rows[0].id;

// --- 1. fileOwner's read: the audit trail's name and person_id come from here --
const owner = await client
  .from("person_profiles")
  .select("id, legal_name")
  .eq("photo_path", plainKey)
  .maybeSingle();
check(
  "the owner read finds the profile that points at the key",
  !owner.error && String(owner.data?.id ?? "") === plainId,
  `error ${owner.error?.message ?? "none"}, id ${owner.data?.id ?? "null"}`
);
check(
  "and names it, so the delete entry says whose record it came from",
  String(owner.data?.legal_name ?? "").startsWith(marker),
  `legal_name ${JSON.stringify(owner.data?.legal_name ?? null)}`
);

// --- 2. unlinkReference's count, then its clear --------------------------------
const beforeCount = await client
  .from("person_profiles")
  .select("id", { count: "exact", head: true })
  .eq("photo_path", plainKey);
check(
  "the HEAD count the unlink makes answers one, not zero",
  beforeCount.count === 1,
  `count ${beforeCount.count}, error ${beforeCount.error?.message ?? "none"}`
);

const cleared = await client
  .from("person_profiles")
  .update({ photo_path: null, photo_mime: null })
  .eq("photo_path", plainKey)
  .select("id");
check(
  "the unlink reaches the row and returns it",
  !cleared.error && (cleared.data?.length ?? 0) === 1,
  `rows ${cleared.data?.length ?? 0}, error ${cleared.error?.message ?? "none"}`
);

const afterRow = (
  await db.query("select photo_path, photo_mime from public.person_profiles where id = $1", [plainId])
).rows[0];
check(
  "the pointer and its mime are both gone on the database",
  afterRow?.photo_path === null && afterRow?.photo_mime === null,
  `photo_path ${JSON.stringify(afterRow?.photo_path)}, mime ${JSON.stringify(afterRow?.photo_mime)}`
);
const afterCount = await client
  .from("person_profiles")
  .select("id", { count: "exact", head: true })
  .eq("photo_path", plainKey);
check("the cleared row no longer answers that filter", afterCount.count === 0, `count ${afterCount.count}`);

// --- 3. a key that carries the grammar's own delimiters -----------------------
const awkward = await client
  .from("person_profiles")
  .select("id, legal_name")
  .eq("photo_path", awkwardKey)
  .maybeSingle();
check(
  "a key with a comma, a space and parentheses is matched whole",
  !awkward.error && String(awkward.data?.id ?? "") === awkwardId,
  `error ${awkward.error?.message ?? "none"}, id ${awkward.data?.id ?? "null"}, key ${JSON.stringify(awkwardKey)}`
);

// Two members, one answer: the plain key is in the list but its profile was
// unlinked by check 2, so a quoted comma inside the surviving member is the only
// thing that can match. Were the quoting rule wrong in either direction, this
// answers nought or two.
const awkwardList = await client
  .from("person_profiles")
  .select("id")
  .in("photo_path", [awkwardKey, plainKey]);
check(
  "an in() list still finds the same key, quotes and all",
  !awkwardList.error && (awkwardList.data ?? []).length === 1,
  `rows ${(awkwardList.data ?? []).length}, error ${awkwardList.error?.message ?? "none"}`
);

const twoKeys = await client
  .from("person_profiles")
  .select("id")
  .in("photo_path", [awkwardKey, `persons/${randomUUID()}/absent.png`]);
check(
  "and a two-member list does not split a quoted comma into two members",
  !twoKeys.error && (twoKeys.data ?? []).length === 1,
  `rows ${(twoKeys.data ?? []).length}`
);

// --- 4. the negative control: what the old quoting did ----------------------
// Hand-built, deliberately the shape `literal()` emitted before the fix, so a
// reader can see the zero is about the quotes and not about the row. Percent-
// encoding is what the builder's own URLSearchParams step would have produced.
async function rawCount(qs) {
  const res = await fetch(`${BASE}/person_profiles?select=id&${qs}`, {
    headers: { Authorization: `Bearer ${staffToken}`, Prefer: "count=exact" },
    method: "HEAD",
  });
  return res.headers.get("content-range");
}
const quotedRange = await rawCount(`photo_path=eq.${encodeURIComponent(JSON.stringify(awkwardKey))}`);
check(
  "the old double-quoted form matches nothing (the defect this gate holds shut)",
  /\/0$/.test(quotedRange ?? ""),
  `content-range ${quotedRange}`
);
const bareRange = await rawCount(`photo_path=eq.${encodeURIComponent(awkwardKey)}`);
check("the bare form the builder sends now matches one row", /\/1$/.test(bareRange ?? ""), `content-range ${bareRange}`);

// --- 5. the ledger row the same delete writes through ----------------------
const ledger = await client
  .from("files")
  .select("bucket, path")
  .eq("bucket", "candidate-photos")
  .eq("path", plainKey)
  .maybeSingle();
check(
  "a path-keyed read reaches the storage ledger too",
  !ledger.error && ledger.data?.path === plainKey,
  `error ${ledger.error?.message ?? "none"}, path ${ledger.data?.path ?? "null"}`
);

// --- teardown ----------------------------------------------------------------
await db.query("delete from public.person_profiles where position($1 in legal_name) > 0", [marker]);
await db.query("delete from public.files where position($1 in path) > 0", [marker]);
await db.query("delete from public.files where id = $1", [ledgerId]);
const profilesNow = (await db.query("select count(*)::int as n from public.person_profiles")).rows[0].n;
const filesNow = (await db.query("select count(*)::int as n from public.files")).rows[0].n;
check(
  "both tables are back where this script found them",
  profilesNow === profilesBaseline && filesNow === filesBaseline,
  `profiles ${profilesNow}/${profilesBaseline}, files ${filesNow}/${filesBaseline}`
);

await db.end();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join("; "));
  process.exit(1);
}
