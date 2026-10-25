/* scripts/prove-live-scope.mjs
 * Run: node --experimental-strip-types scripts/prove-live-scope.mjs
 *
 * #329: the live channel used to fingerprint all twelve watched areas for every
 * open tab, whether the page read them or not. A recruiter on /time paid twelve
 * database reads a tick to learn about six areas they could not see; Settings,
 * the assistant and the change trail paid the same for nothing.
 *
 * The browser now names the page it is on, the stream filters the watch list to
 * the areas whose paths feed that page, and a page fed by nothing polls nothing.
 * The reload rule is unchanged — it was already filtered by the same paths — so
 * this is a cut in reads, not in freshness.
 *
 * What is pinned here:
 *
 *   1. the watch table — one area per table, every path a staff route, and a
 *      stamp or a hashed column list on every entry;
 *   2. the scope — the exact areas for each page, the prefix boundary that keeps
 *      /timeline from matching /time, and the full sweep for a caller that names
 *      no page;
 *   3. the measured cut — per-page counts against the old full sweep;
 *   4. the server wiring — the stream reads the page, scopes the first read, the
 *      poll, the diff, the refusal list and the stall check, and announces only
 *      that slice;
 *   5. the browser wiring — the connection is re-pointed when the page changes,
 *      the old page's change memory is dropped, and the badge and Guide no
 *      longer claim to watch the rest of the portal.
 *
 * The counts are arithmetic over the table in this tree, not a database probe:
 * the watch list is a static table, and the pages it names are the sixteen staff
 * routes. Whether a particular database can read a watched table is a fact about
 * that database, checked by the channel's own refusal path at runtime.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The modules below import through the app's `@/` alias. Plain Node cannot
// resolve it, so teach this one process the same mapping the bundler uses, then
// import dynamically (static imports would run before these hooks exist).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { LIVE_WATCH, pathFeeds, watchForPath } = await import(
  "../src/modules/live/domain/watch.ts"
);
const live = await import("../src/lib/live.ts");
const { STAFF_ROUTES } = await import("../src/lib/auth/staffRoutes.ts");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? "" : `got ${a}, wanted ${e}`);
}

const areas = (path) => watchForPath(path).map((watch) => watch.area);
const allAreas = LIVE_WATCH.map((watch) => watch.area);

/* -------------------------------------------------------------------------- */
/* 1. The watch table                                                          */
/* -------------------------------------------------------------------------- */

check("the table watches thirteen areas", allAreas.length === 13, `got ${allAreas.length}`);
check(
  "every area has its own name",
  new Set(allAreas).size === allAreas.length,
  allAreas.join(", ")
);
check(
  "every area names a real portal page",
  LIVE_WATCH.every((watch) =>
    watch.paths.every((page) => STAFF_ROUTES.includes(page))
  ),
  LIVE_WATCH.flatMap((watch) => watch.paths).filter((page) => !STAFF_ROUTES.includes(page)).join(", ")
);
check(
  "every area has a table and a way to see it move",
  LIVE_WATCH.every(
    (watch) => watch.table.length > 0 && (Boolean(watch.stamp) || (watch.columns ?? []).length > 0)
  )
);
check(
  "no area is both stamped and hashed",
  LIVE_WATCH.every((watch) => Boolean(watch.stamp) !== Boolean(watch.columns?.length))
);
{
  const notes = LIVE_WATCH.find((watch) => watch.area === "interview notes");
  check(
    "the notes area watches its own stamped table on the agenda",
    notes?.table === "interview_notes" &&
      notes?.stamp === "updated_at" &&
      JSON.stringify(notes?.paths) === JSON.stringify(["/interviews"]),
    JSON.stringify(notes)
  );
  const schedule = LIVE_WATCH.find((watch) => watch.area === "interviews");
  check(
    "the schedule watch was not widened to carry note columns",
    JSON.stringify(schedule?.columns) ===
      JSON.stringify(["id", "application_id", "scheduled_at", "status", "meeting_link"]),
    JSON.stringify(schedule?.columns)
  );
}

/* -------------------------------------------------------------------------- */
/* 2. The scope                                                                */
/* -------------------------------------------------------------------------- */

equal("a caller that names no page keeps the full sweep", areas(null), allAreas);
equal("the time ledger watches one table", areas("/time"), ["time"]);
equal("settings watches nothing", areas("/settings"), []);
equal("the assistant watches nothing", areas("/assistant"), []);
equal("the change trail watches nothing", areas("/activity"), []);
equal("the pipeline reads six areas", areas("/candidates"), [
  "pipeline",
  "assessments",
  "interviews",
  "openings",
  "outreach",
  "files",
]);
equal("the dashboard reads six areas", areas("/dashboard"), [
  "pipeline",
  "sourcing",
  "assessments",
  "interviews",
  "openings",
  "onboarding",
]);
equal("the files page reads three areas", areas("/files"), [
  "pipeline",
  "outreach",
  "files",
]);
equal("the whatsapp page reads three areas", areas("/whatsapp"), [
  "pipeline",
  "outreach",
  "queue",
]);
equal("the interviews page reads all three interview tables", areas("/interviews"), [
  "interviews",
  "interview scorecards",
  "interview notes",
]);
equal("the jobs page reads the pipeline and the openings", areas("/jobs"), [
  "pipeline",
  "openings",
]);
equal("a candidate's own page inherits the pipeline scope", areas("/candidates/abc-123"), [
  "pipeline",
  "assessments",
  "interviews",
  "openings",
  "outreach",
  "files",
]);
equal("a query on the path is stripped before matching", areas("/files?bucket=resumes"), [
  "pipeline",
  "outreach",
  "files",
]);
equal("a hash on the path is stripped before matching", areas("/candidates#top"), [
  "pipeline",
  "assessments",
  "interviews",
  "openings",
  "outreach",
  "files",
]);
equal("a trailing slash still matches its page", areas("/dashboard/"), areas("/dashboard"));
equal("a page whose name merely starts like another does not match", areas("/timeline"), []);
equal("a path without a leading slash is refused", areas("candidates"), []);
equal("an empty path is refused rather than widened", areas(""), []);
equal("a page name in the wrong case is refused", areas("/CANDIDATES"), []);
equal("an endpoint path is not a page", areas("/api/live"), []);

/* -------------------------------------------------------------------------- */
/* 3. The measured cut                                                         */
/* -------------------------------------------------------------------------- */

const perPage = STAFF_ROUTES.map((route) => ({ route, count: areas(route).length }));
const busiest = Math.max(...perPage.map((page) => page.count));
const silent = perPage.filter((page) => page.count === 0).length;
const reads = perPage.reduce((sum, page) => sum + page.count, 0);
const oldReads = allAreas.length * STAFF_ROUTES.length;

check("no page reads the whole watch list", busiest < allAreas.length, `busiest ${busiest}`);
check("the busiest page reads six tables", busiest === 6, `got ${busiest}`);
check("four pages poll nothing at all", silent === 4, `got ${silent}`);
check(
  "the average page reads at most a quarter of the old sweep",
  reads <= oldReads * 0.25,
  `${reads} reads across ${STAFF_ROUTES.length} pages vs ${oldReads} before`
);
equal("the per-page sum is the tree's 30", reads, 30);
check(
  "the reduction is at least 80 per cent",
  (oldReads - reads) / oldReads >= 0.8,
  `${Math.round(((oldReads - reads) / oldReads) * 100)}%`
);

/* -------------------------------------------------------------------------- */
/* 4. One prefix rule, two readers                                             */
/* -------------------------------------------------------------------------- */

equal("the exact page feeds itself", pathFeeds(["/files"], "/files"), true);
equal("a nested page inherits the prefix", pathFeeds(["/files"], "/files/resumes"), true);
equal("a page that merely starts with the name does not", pathFeeds(["/time"], "/timeline"), false);
equal("a missing list feeds nothing", pathFeeds(undefined, "/files"), false);

check(
  "the browser's rule and the server's scope agree",
  STAFF_ROUTES.every((route) => {
    const watched = { files: ["/files"], time: ["/time"], pipeline: ["/candidates"] };
    const fromBrowser = live.areasFeeding(watched, route);
    const fromServer = Object.keys(watched).filter((area) => pathFeeds(watched[area], route));
    return JSON.stringify(fromBrowser) === JSON.stringify(fromServer);
  })
);
equal(
  "a scoped watch map answers with its own areas",
  live.areasFeeding({ time: ["/time"] }, "/time"),
  ["time"]
);
equal(
  "a scoped watch map says nothing about a page it does not feed",
  live.areasFeeding({ time: ["/time"] }, "/candidates"),
  []
);

/* -------------------------------------------------------------------------- */
/* 5. The server wiring                                                        */
/* -------------------------------------------------------------------------- */

const route = read("src/app/api/live/route.ts");
check(
  "the stream reads the page from the query string",
  route.includes('new URL(request.url).searchParams.get("path")')
);
check("the stream scopes the watch list", route.includes("const scope = watchForPath("));
check(
  "the first fingerprint is scoped",
  route.includes("readLiveFingerprints(restClient, scope)")
);
check(
  "the poll is scoped",
  route.includes("const next = await readLiveFingerprints(restClient, scope)")
);
check(
  "the diff is scoped",
  route.includes("diffLiveFingerprints(seen, next, scope)")
);
check(
  "the refusal list comes from the scope",
  route.includes('scope.filter((w) => marks[w.area]?.state === "refused")')
);
check(
  "the stall check is scoped",
  route.includes('scope.every((w) => next[w.area].state !== "ok")')
);
check("hello announces only the scope", route.includes("watch: scope.map("));
check(
  "a page fed by nothing skips the poll",
  route.includes("if (scope.length === 0)") && route.includes("if (!beat()) break;")
);
check("the route no longer names the full table", !route.includes("LIVE_WATCH"));

const reader = read("src/modules/live/infrastructure/changeWatch.ts");
check("the table moved out of the reader", !reader.includes("export const LIVE_WATCH"));
check("the reader takes a slice of the list", reader.includes("watches: readonly LiveWatch[]"));
check("the diff walks the slice", reader.includes("for (const watch of watches)"));

const domain = read("src/modules/live/domain/watch.ts");
check("the domain owns the prefix rule", domain.includes("export function pathFeeds"));
check("the domain owns the scope selector", domain.includes("export function watchForPath"));
check(
  "a bad path watches nothing rather than everything",
  domain.includes("if (!pathname.startsWith(\"/\")) return [];")
);

/* -------------------------------------------------------------------------- */
/* 6. The browser wiring and the copy                                          */
/* -------------------------------------------------------------------------- */

const client = read("src/lib/live.ts");
check("the client remembers the page scope", client.includes("let scopePath: string | null = null"));
check(
  "the stream URL carries the page",
  client.includes("/api/live?path=${encodeURIComponent(scopePath)}")
);
check(
  "a page change replaces the old connection",
  client.includes("previous !== null && previous !== pathname")
);
check(
  "a page change forgets the old page's change",
  client.includes("watched: {}, lastChange: null")
);
check("attach takes the page", client.includes("export function attachLive(pathname: string)"));
check("the client does not import the table", !client.includes("LIVE_WATCH"));

const presentation = read("src/modules/live/presentation/Live.tsx");
check("the chrome passes the page", presentation.includes("attachLive(pathname)"));
check("the badge no longer claims changes elsewhere", !presentation.includes("changedElsewhere"));
check(
  "the badge words its promise about what feeds this page",
  presentation.includes("Nothing has moved in what feeds this page")
);

const guide = read("src/modules/shell/presentation/AppBarGuide.tsx");
check(
  "the Guide scopes the check to this page",
  guide.includes("hiring tables that feed this page every")
);
check(
  "the Guide says the channel does not probe elsewhere",
  guide.includes("probes only what this page reads") &&
    guide.includes("is not announced here")
);
check(
  "the Guide no longer says it re-checks the watched tables generally",
  !guide.includes("watched hiring tables every")
);

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  if (!result.pass) console.log(`FAIL ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
