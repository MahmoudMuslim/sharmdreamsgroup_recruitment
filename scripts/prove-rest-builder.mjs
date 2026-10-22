/* scripts/prove-rest-builder.mjs
 * Run: node --experimental-strip-types scripts/prove-rest-builder.mjs
 *
 * Two halves, deliberately. The first pins the QUERYSTRING the builder emits;
 * the second pins the RESOLVED REQUEST — method, querystring, `Prefer`, and
 * whether a body is actually sent — by running a chain through the real
 * transport with a fake `fetchImpl`. The first half alone let a Critical bug
 * through: `select()` reset a recorded write verb back to GET, so
 * `.insert(row).select("id")` serialised a perfect `?select=id` for a request
 * that no longer wrote anything. A querystring cannot see that, because the
 * damage is in the verb and the headers, not in the URL. */
import { QueryBuilder, buildUrl } from "../src/lib/rest/query-builder.ts";
import { createRestClient } from "../src/lib/rest/client.ts";

const q = () => new QueryBuilder();

const cases = [
  [q().select("id,name").eq("tenant_id", "t1").order("created_at", { ascending: false }).limit(5),
    "?select=id%2Cname&tenant_id=eq.t1&order=created_at.desc&limit=5"],
  [q().select("*").in("id", ["a", "b"]).is("deleted_at", null),
    "?select=*&id=in.%28%22a%22%2C%22b%22%29&deleted_at=is.null"],
  [q().select("id").filter("score", "gte", 80).not("status", "eq", "DRAFT"),
    "?select=id&score=gte.80&status=not.eq.DRAFT"],
  [q().select("id").or("email.eq.a@b.c,name.ilike.*jo*"),
    "?select=id&or=%28email.eq.a%40b.c%2Cname.ilike.*jo*%29"],
  [q().select("id").range(20, 39), "?select=id&offset=20&limit=20"],
  /* CORRECTED EXPECTATION — the only deviation from the plan's fence in this
   * file, and it is forced: the fence pairs `select("*")` with a bare `*`
   * (case 2) and `select("*,job_openings(title)")` with `%2A`, and no encoder
   * on earth produces both, because they are the same decoded value. `%2A` is
   * what Python's quote() emits and `*` is what URLSearchParams emits, which is
   * the encoder the builder's own doc comment names and the one supabase-js
   * uses, so the bare form is what the 454 chains put on the wire before this
   * port. Measured on the local stack: `select=%2A` and `select=*` both answer
   * 200 with the same rows, so this case pins the byte shape, not the grammar. */
  [q().select("*,job_openings(title)").eq("id", "x"),
    "?select=*%2Cjob_openings%28title%29&id=eq.x"],
];

let bad = 0;
for (const [builder, expected] of cases) {
  const got = builder.toQuerystring();
  if (got !== expected) { bad++; console.error(`FAIL\n  expected ${expected}\n  got      ${got}`); }
}
if (bad) process.exit(1);
console.log(`PASS ${cases.length} URL shapes`);
console.log(buildUrl("applications", q().select("id").eq("id", "x")));

/* ------------------------------------------------------------------ *
 * Half two: the resolved request.
 * ------------------------------------------------------------------ */

/** Run one chain through the transport and return what it would put on the wire. */
async function resolveRequest(build) {
  let sent = null;
  const client = createRestClient({
    baseUrl: "http://gateway.invalid/rest/v1/",
    token: "probe-bearer",
    fetchImpl: async (url, init) => {
      sent = {
        url: String(url),
        method: init.method,
        headers: init.headers ?? {},
        body: init.body,
        bodySent: init.body !== undefined,
      };
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-0/1" },
      });
    },
  });
  await build(client.from("things"));
  if (!sent) throw new Error("the chain never reached fetch — it was not awaited as a request");
  return sent;
}

const requestCases = [
  /* THE CRITICAL REGRESSION. A chained read after a write must keep the write
   * verb, keep the body, and ask for the rows back. Before the fix this was a
   * GET with no body: no write, no error, and the caller read a stranger's row. */
  {
    label: "insert(row).select('id') → POST + select=id + representation + body",
    build: (b) => b.insert({ name: "x" }).select("id"),
    method: "POST", has: ["select=id"], lacks: [], prefer: ["return=representation"],
    noPrefer: [], bodySent: true,
  },
  {
    label: "insert(row).select('id').single() → POST + representation + object Accept",
    build: (b) => b.insert({ name: "x" }).select("id").single(),
    method: "POST", has: ["select=id"], lacks: [], prefer: ["return=representation"],
    noPrefer: [], bodySent: true, accept: "application/vnd.pgrst.object+json",
  },
  {
    label: "update(row).eq() → PATCH, no select, NO representation, body",
    build: (b) => b.update({ status: "SENT" }).eq("id", "z"),
    method: "PATCH", has: ["id=eq.z"], lacks: ["select="], prefer: [],
    noPrefer: ["return=representation"], bodySent: true,
  },
  {
    label: "update(row).eq().select().single() → PATCH + representation + body",
    build: (b) => b.update({ status: "SENT" }).eq("id", "z").select().single(),
    method: "PATCH", has: ["id=eq.z", "select=*"], lacks: [], prefer: ["return=representation"],
    noPrefer: [], bodySent: true,
  },
  {
    label: "delete().eq().select() → DELETE + representation, and still no body",
    build: (b) => b.delete().eq("id", "z").select(),
    method: "DELETE", has: ["id=eq.z", "select=*"], lacks: [], prefer: ["return=representation"],
    noPrefer: [], bodySent: false,
  },
  {
    label: "delete().eq() bare → DELETE, no representation, no body",
    build: (b) => b.delete().eq("id", "z"),
    method: "DELETE", has: ["id=eq.z"], lacks: ["select="], prefer: [],
    noPrefer: ["return=representation"], bodySent: false,
  },
  {
    label: "insert(row) bare → POST with NO representation (supabase answers data:null)",
    build: (b) => b.insert({ name: "x" }),
    method: "POST", has: [], lacks: ["select="], prefer: [],
    noPrefer: ["return=representation"], bodySent: true,
  },
  {
    label: "upsert(rows,{onConflict}) bare → POST + merge-duplicates, no representation",
    build: (b) => b.upsert([{ id: 1 }], { onConflict: "id" }),
    method: "POST", has: ["on_conflict=id"], lacks: ["select="],
    prefer: ["resolution=merge-duplicates"], noPrefer: ["return=representation"], bodySent: true,
  },
  {
    label: "upsert(rows,{onConflict}).select('id') → POST + merge-duplicates + representation",
    build: (b) => b.upsert([{ id: 1 }], { onConflict: "id" }).select("id"),
    method: "POST", has: ["on_conflict=id", "select=id"], lacks: [],
    prefer: ["resolution=merge-duplicates", "return=representation"], noPrefer: [], bodySent: true,
  },
  /* A read stays a read: the head-count idiom still selects HEAD with a count
   * and no representation, and a plain select still answers GET with no body. */
  {
    label: "select('id',{count:exact,head:true}) → HEAD + count=exact, no representation",
    build: (b) => b.select("id", { count: "exact", head: true }),
    method: "HEAD", has: ["select=id"], lacks: [], prefer: ["count=exact"],
    noPrefer: ["return=representation"], bodySent: false,
  },
  {
    label: "select('*').eq() → GET, no representation, no body",
    build: (b) => b.select("*").eq("id", "x"),
    method: "GET", has: ["select=*", "id=eq.x"], lacks: [], prefer: [],
    noPrefer: ["return=representation"], bodySent: false,
  },
];

let requestBad = 0;
for (const testCase of requestCases) {
  const sent = await resolveRequest(testCase.build);
  const prefer = sent.headers.Prefer ?? "";
  const problems = [];
  if (sent.method !== testCase.method) problems.push(`method ${sent.method} != ${testCase.method}`);
  for (const needle of testCase.has) {
    if (!sent.url.includes(needle)) problems.push(`url missing ${needle} (${sent.url})`);
  }
  for (const needle of testCase.lacks) {
    if (sent.url.includes(needle)) problems.push(`url contains ${needle}`);
  }
  for (const needle of testCase.prefer) {
    if (!prefer.includes(needle)) problems.push(`Prefer missing ${needle} ("${prefer}")`);
  }
  for (const needle of testCase.noPrefer) {
    if (prefer.includes(needle)) problems.push(`Prefer carries ${needle} ("${prefer}")`);
  }
  if (sent.bodySent !== testCase.bodySent) problems.push(`bodySent ${sent.bodySent} != ${testCase.bodySent}`);
  if (testCase.accept && sent.headers.Accept !== testCase.accept) {
    problems.push(`Accept ${sent.headers.Accept} != ${testCase.accept}`);
  }
  if (problems.length) {
    requestBad++;
    console.error(`FAIL  ${testCase.label}\n  ${problems.join("\n  ")}`);
  }
}
if (requestBad) process.exit(1);
console.log(`PASS ${requestCases.length} resolved requests (verb + Prefer + body)`);

/* ------------------------------------------------------------------ *
 * Half three: a wrapped or padded projection.
 *
 * PostgREST 16.5's select grammar takes a space around a comma and a space
 * before an embed's `(`, but not a newline and not a space just inside the
 * brackets. Measured on the local stack: `applications ( full_name )` answers
 * `400 PGRST100 … unexpected ")"`, the same string with the padding removed
 * answers 200. `/assessments` shipped broken by the newline and the Analytics
 * report by the padding — no gate renders an authenticated page, so both were
 * invisible until a signed-in browser opened them.
 *
 * The assertion is on the DECODED parameter, not the escaped string: the bug is
 * a character the grammar owns, and the encoder (`URLSearchParams`) is already
 * pinned by half one.
 * ------------------------------------------------------------------ */
const wrapped = [
  [
    `id, application_id, template_id, status, created_at, integrity_flags,
       applications!inner(full_name, archived_at, job_openings(title)),
       assessment_templates(name, assessment_questions(id)),
       candidate_responses(id)`,
    "id, application_id, template_id, status, created_at, integrity_flags, applications!inner(full_name, archived_at, job_openings(title)), assessment_templates(name, assessment_questions(id)), candidate_responses(id)",
  ],
  [
    `id, template_id, status,
  question_order, option_order`,
    "id, template_id, status, question_order, option_order",
  ],
];

// The same strings Analytics and the row reports hand-write today. A space
// before `(` is legal and kept; only the padding inside the brackets goes.
const padded = [
  [
    "id, applications ( full_name, job_openings ( title ) )",
    "id, applications (full_name, job_openings (title))",
  ],
  [
    "applications ( created_at, job_openings ( title ) ), user_profiles ( full_name )",
    "applications (created_at, job_openings (title)), user_profiles (full_name)",
  ],
  ["prospect_id, application_id, applications ( full_name )", "prospect_id, application_id, applications (full_name)"],
];

let wrapBad = 0;
for (const [input, expected] of [...wrapped, ...padded]) {
  const qs = q().select(input).toQuerystring();
  const got = new URLSearchParams(qs.slice(1)).get("select");
  if (got === null) { wrapBad++; console.error(`FAIL  select vanished from ${qs}`); continue; }
  if (got.includes("\n") || /\(\s|\s\)/.test(got) || got !== expected) {
    wrapBad++;
    console.error(`FAIL  wrapped or padded projection\n  expected ${expected}\n  got      ${got}`);
  }
}
// A projection written on one line with no padding must go out byte-for-byte.
const singleLine = q().select("id, name, applications(full_name)").toQuerystring();
if (new URLSearchParams(singleLine.slice(1)).get("select") !== "id, name, applications(full_name)") {
  wrapBad++;
  console.error(`FAIL  single-line projection was rewritten: ${singleLine}`);
}
if (wrapBad) process.exit(1);
console.log(
  `PASS ${wrapped.length + padded.length + 1} wrapped and padded projections (no newline or bracket padding reaches the grammar)`
);
