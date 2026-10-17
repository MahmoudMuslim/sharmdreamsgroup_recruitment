#!/usr/bin/env node
/**
 * Fails the build when the staff gate and the rail stop describing the same pages.
 *
 * Three lists have to agree, and they live in three different kinds of thing — a
 * directory tree, a TypeScript array, a table of icons — so nothing the compiler
 * checks can hold them together on its own:
 *
 *   1. every `src/app/(admin)/<area>/page.tsx`    — what a person can be sent to
 *   2. `STAFF_ROUTES` in `src/lib/auth/staffRoutes.ts` — what the edge middleware
 *      guards: the anonymous redirect, `security.session_timeout_minutes`, the
 *      candidate bounce
 *   3. `NAV` in `src/modules/analytics/presentation/nav.ts` — what the rail, the
 *      Guide panel and the app bar's page shortcuts offer
 *
 * Missing from (2) is the dangerous one and the one that reads as harmless: the
 * page still calls `requireStaff()`, so it renders only for staff and an
 * anonymous visitor is stopped — but the idle sign-out silently stops applying to
 * it and a signed-in candidate can walk in. Seven of the sixteen pages were in
 * that state until 2026-10-16. Missing from (3) leaves a page reachable by URL
 * and invisible in every menu.
 *
 * Text rather than imports on purpose: `nav.ts` pulls in `lucide-react`, so
 * loading it here would need the whole client graph.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_DIR = join(root, "src/app/(admin)");
const ROUTES_FILE = join(root, "src/lib/auth/staffRoutes.ts");
const NAV_FILE = join(root, "src/modules/analytics/presentation/nav.ts");

/** The quoted paths inside a named `as const` array. */
function readRouteArray(source, exportName) {
  const block = new RegExp(`export const ${exportName}[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(
    source
  );
  if (!block) {
    fail([`Could not find \`export const ${exportName} = [...] as const\` — the shape this check reads changed.`]);
    return [];
  }
  return [...block[1].matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
}

/** The `href: "/area"` of each rail entry, query strings stripped. */
function readNavHrefs(source) {
  const block = /export const NAV[\s\S]*?\n\] as const/.exec(source);
  if (!block) {
    fail(["Could not find `export const NAV = [...] as const` — the shape this check read changed."]);
    return [];
  }
  return [...block[0].matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1].split("?")[0]);
}

/** Every admin area that actually renders a page. */
function readPageAreas() {
  if (!existsSync(ADMIN_DIR)) {
    fail([`No admin route group at ${ADMIN_DIR} — this check is pointing at the wrong tree.`]);
    return [];
  }
  return readdirSync(ADMIN_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ADMIN_DIR, entry.name, "page.tsx")))
    .map((entry) => `/${entry.name}`)
    .sort();
}

function fail(problems) {
  console.error("\nStaff route check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\n  A staff page the edge guard does not list keeps its in-page requireStaff(),\n" +
      "  so it looks secure while the idle sign-out and the candidate bounce stop\n" +
      "  applying to it. Add the path to STAFF_ROUTES in src/lib/auth/staffRoutes.ts,\n" +
      "  and to NAV in src/modules/analytics/presentation/nav.ts if the rail should\n" +
      "  offer it.\n"
  );
  process.exitCode = 1;
}

const pages = readPageAreas();
const guarded = readRouteArray(readFileSync(ROUTES_FILE, "utf8"), "STAFF_ROUTES");
const rail = readNavHrefs(readFileSync(NAV_FILE, "utf8"));

const problems = [];
const setOf = (list) => new Set(list);
const guardedSet = setOf(guarded);
const railSet = setOf(rail);
const pagesSet = setOf(pages);

if (guarded.length !== guardedSet.size) {
  problems.push(`STAFF_ROUTES lists a path twice: ${dupes(guarded)}.`);
}
if (rail.length !== railSet.size) {
  problems.push(`NAV links to the same page twice: ${dupes(rail)}.`);
}

for (const page of pages.filter((p) => !guardedSet.has(p))) {
  problems.push(
    `\`${page}\` is a page under src/app/(admin) but STAFF_ROUTES does not guard it: ` +
      `no idle sign-out, no candidate bounce.`
  );
}
for (const route of guarded.filter((r) => !pagesSet.has(r))) {
  problems.push(`STAFF_ROUTES guards \`${route}\`, which has no page.tsx under src/app/(admin).`);
}
for (const route of guarded.filter((r) => !railSet.has(r))) {
  problems.push(`\`${route}\` is guarded but NAV never offers it: reachable by URL, invisible in the rail.`);
}
for (const href of rail.filter((h) => !guardedSet.has(h))) {
  problems.push(`NAV links to \`${href}\`, which STAFF_ROUTES does not guard.`);
}

function dupes(list) {
  return [...new Set(list.filter((item, index) => list.indexOf(item) !== index))].join(", ");
}

if (problems.length) fail(problems);
else {
  console.log(
    `Staff route check passed: ${pages.length} pages, ${guarded.length} guarded, ${rail.length} on the rail.`
  );
}
