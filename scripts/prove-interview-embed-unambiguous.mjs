/* scripts/prove-interview-embed-unambiguous.mjs
 * Run: node --env-file=docker/.env scripts/prove-interview-embed-unambiguous.mjs
 *
 * Who is on the panel is read by *embedding* the staff profile through
 * `interview_schedules`. That embed used to be obvious: one foreign key,
 * `interviewer_profile_id`. The scorecards and notes tables each added a second
 * and third path from a panel to a staff profile, so PostgREST can no longer
 * guess, and answers an unqualified embed with PGRST201 — a refused query, not an
 * empty one.
 *
 * That distinction is the whole reason this proof exists. Every reader that hits
 * it logs the error and returns `[]`, so the recruiter sees "No applications yet"
 * and "Nothing booked here" while the pipeline holds rows. A silent empty list is
 * worse than an error page: it looks like a quiet day.
 *
 * Every read below is put on the wire by the production `QueryBuilder`, not by a
 * hand-written `encodeURIComponent`. That matters: this stack's PostgREST rejects
 * the padding inside brackets that the call sites are written with
 * (`applications ( title )` answers `400 PGRST100`), and `encodeSelect` collapses
 * it at the seam that owns the chain. A probe that skipped the builder would
 * report a parse error production does not have, and the check would fail for the
 * wrong reason. Same bytes, same normalisation — so a failure here is the
 * ambiguity and nothing else.
 *
 * The checks:
 *
 *   1. the candidates list, with the production `INTERVIEW_SELECT` imported from
 *      the file the page uses — the query that broke;
 *   2. that read carries every live application, not the zero the page shows;
 *   3-5. the agenda, the reports numbers and the reports interview sheet — the
 *      other three copies of the same embed, each read as its own file reads it;
 *   6. the tripwire: the unqualified form must still be REFUSED, otherwise the
 *      checks above pass vacuously and would keep passing if someone dropped the
 *      qualifier;
 *   7. each production file names the relationship as many times as it embeds it.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The files under test are plain TS with extensionless siblings, which plain Node
// does not resolve, so this process learns the bundler's mapping first.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const base =
      specifier.startsWith("@/")
        ? path.join(root, "src", specifier.slice(2))
        : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
          ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
          : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { INTERVIEW_SELECT } = await import(
  pathToFileURL(path.join(root, "src/app/(admin)/candidates/interviews-model.ts")).href
);
const { QueryBuilder, buildUrl } = await import(
  pathToFileURL(path.join(root, "src/lib/rest/query-builder.ts")).href
);

const env = {};
for (const line of read("docker/.env").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = `http://localhost:${env.LOCAL_GATEWAY_PORT || 54321}/rest/v1`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A staff token, minted exactly the way `prove-local-stack.mjs` mints one. */
function mintToken(sub) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    aud: "sdg_local",
    iss: "sharm-dreams-local",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    sub,
    role: "authenticated",
  });
  const sig = createHmac("sha256", env.AUTH_JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * One production chain, executed over HTTP. `chain` receives a fresh
 * `QueryBuilder` and writes the same calls the server action writes, so the
 * select is encoded by `toQuerystring()` exactly as the app encodes it.
 */
async function rest(token, table, chain) {
  const builder = chain(new QueryBuilder());
  const res = await fetch(`${BASE}${buildUrl(table, builder)}`, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const text = await res.text();
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* an error body is read out of `text` by the check that asked for it */
  }
  return { status: res.status, rows, text };
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
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

// `sub` is the AUTH uid, never the profile id — see the note in
// prove-local-stack.mjs. A super-admin sees every company's rows, which is what
// makes "the same read the page performs" mean the whole pipeline.
const staffRow = await db.query(
  "select auth_user_id from user_profiles where role = 'SUPER_ADMIN' order by created_at limit 1"
);
if (!staffRow.rowCount) {
  await db.end();
  throw new Error("no SUPER_ADMIN profile to read as — run scripts/seed-local-staff.mjs");
}
const token = mintToken(staffRow.rows[0].auth_user_id);

const liveCount = await db.query("select count(*)::int as n from applications where archived_at is null");
const expectedRows = liveCount.rows[0].n;
await db.end();

const FK = "interview_schedules_interviewer_profile_id_fkey";

/**
 * `AGENDA_SELECT` in `src/app/(admin)/interviews/actions.ts` and both interview
 * projections in `reportReader.ts`, written on one line. Those files are
 * `"use server"` / server-only, so this is a copy pinned as text by the last
 * check: if a projection changes shape, the string here has to change with it.
 */
const AGENDA_SELECT =
  "id, scheduled_at, duration_minutes, status, meeting_link, interviewer_profile_id, " +
  "applications ( id, full_name, tracking_code, job_openings ( title ) ), " +
  `user_profiles!${FK} ( full_name )`;

const REPORTS_SELECT =
  "id, status, scheduled_at, created_at, duration_minutes, meeting_link, application_id, " +
  `applications ( created_at, job_openings ( title ) ), user_profiles!${FK} ( full_name )`;

/** The reports page's interview *sheet* — the fourth copy, `reportReader.ts:498`. */
const PANELS_SELECT =
  "scheduled_at, status, duration_minutes, meeting_link, calendar_provider, created_at, " +
  `applications ( full_name, created_at, job_openings ( title ) ), user_profiles!${FK} ( full_name )`;

/**
 * How many times a file must name the relationship, so a reader that fixes one
 * of its two projections and forgets the other still fails: Analytics reads
 * panels twice — once for the numbers, once for the sheet.
 */
const QUALIFIER_COUNTS = [
  ["src/app/(admin)/candidates/interviews-model.ts", 1],
  ["src/app/(admin)/interviews/actions.ts", 1],
  ["src/modules/analytics/infrastructure/reportReader.ts", 2],
];

// 1. THE BROKEN ONE. The page's own select, assembled the way the page assembles
//    it, with the production column list imported above.
const candidatesSelect = [
  "*",
  "job_openings(title, tenant_id, tenants_and_companies(name))",
  "candidate_attempts(access_token, status, total_score)",
  `interview_schedules(${INTERVIEW_SELECT})`,
].join(", ");

const list = await rest(token, "applications", (b) =>
  b.select(candidatesSelect).is("archived_at", null).order("created_at", { ascending: false }).limit(50)
);
check(
  "the candidates list read answers instead of being refused",
  list.status === 200 && list.rows !== null,
  `HTTP ${list.status} ${list.status === 200 ? "" : list.text.slice(0, 160)}`
);
check(
  "and it carries every live application, not the zero the page shows",
  list.rows !== null && list.rows.length === expectedRows,
  `read ${list.rows?.length ?? "no"} of ${expectedRows} live rows`
);

// 3-5. The other three copies of the embed, each read the way its own file reads
//      it. The agenda is the one that fails silently: with no panel booked it
//      looks identical to a quiet week.
for (const [name, select] of [
  ["the agenda read of a panel and its interviewer", AGENDA_SELECT],
  ["the reports read of interviews", REPORTS_SELECT],
  ["the reports interview sheet", PANELS_SELECT],
]) {
  const res = await rest(token, "interview_schedules", (b) => b.select(select).limit(5));
  check(
    `${name} answers`,
    res.status === 200 && res.rows !== null,
    `HTTP ${res.status} ${res.status === 200 ? "" : res.text.slice(0, 160)}`
  );
}

// 6. Qualifying does not rename. Every reader above destructures the row's
//    `user_profiles` key, so the fix only holds if the qualified form still
//    answers under the table's own name. Proven on a table that has rows,
//    because no panel is booked on this stack.
const alias = await rest(token, "applications", (b) =>
  b.select("id, job_openings!applications_job_id_fkey ( title )").limit(1)
);
check(
  "a qualified embed still answers under the table's own name",
  alias.status === 200 &&
    (alias.rows ?? []).length > 0 &&
    typeof alias.rows[0].job_openings === "object",
  `HTTP ${alias.status} keys=${Object.keys(alias.rows?.[0] ?? {}).join("|")}`
);

// 7. The tripwire. If the schema ever stops being ambiguous the qualifier is
//    still correct, but this proof stops proving anything — so say so loudly.
const bare = await rest(token, "interview_schedules", (b) =>
  b.select("id, user_profiles ( full_name )").limit(1)
);
check(
  "the unqualified embed is still refused, so the checks above are not vacuous",
  bare.status !== 200 && /PGRST201/.test(bare.text),
  `HTTP ${bare.status}`
);

// 8. Every production reader of that embed names the relationship it means, as
//    many times as it embeds it.
for (const [rel, expected] of QUALIFIER_COUNTS) {
  const occurrences = read(rel).split(`user_profiles!${FK}`).length - 1;
  check(
    `${rel} names the interviewer's own foreign key ${expected}×`,
    occurrences === expected,
    `found ${occurrences}`
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
