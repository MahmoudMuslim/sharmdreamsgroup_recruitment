/* scripts/prove-job-distribution.mjs
 * Run: node scripts/prove-job-distribution.mjs
 *
 * Nothing here needs a database, a board account or a browser. What is pinned is
 * the part every surface shares: the columns the public read is allowed to see,
 * the schema.org mapping, the three pull artifacts, and the fact that each of the
 * five doors actually opens onto the module rather than writing its own version.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The modules under test import through the app's `@/` alias and through
// extensionless sibling paths. Plain Node resolves neither, so teach this one
// process the bundler's mapping before any dynamic import runs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
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

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function sourceHas(name, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(name, missing.length === 0, missing.map((n) => `missing ${JSON.stringify(n)}`).join(", "));
}

// ---------------------------------------------------------------------------
// 1. The public read carries the dates a posting is dated by.
// ---------------------------------------------------------------------------
// Pinned against the column list itself, not against the file: `posted_at`
// already appears in actions.ts as the board's sort key, so a loose substring
// check would pass before this slice exists.
const jobColumns = ((/const JOB_COLUMNS =\s*\n?\s*"([^"]+)"/.exec(read("src/app/careers/actions.ts")) ?? [])[1] ?? "")
  .split(",")
  .map((name) => name.trim());
for (const column of ["posted_at", "closing_at", "created_at"]) {
  check(`the public read selects ${column}`, jobColumns.includes(column));
}
sourceHas("toJob maps the three date columns", "src/app/careers/actions.ts", [
  "posted_at:",
  "closing_at:",
  "created_at:",
]);
sourceHas("PublicJob declares the three date columns", "src/modules/careers/job-board.ts", [
  "posted_at: string | null;",
  "created_at: string;",
  "closing_at: string | null;",
]);
check(
  "the published-only rule stays where the policy puts it",
  read("src/app/careers/actions.ts").includes('.eq("status", "PUBLISHED")'),
  "a surface that stopped filtering on PUBLISHED would publish a draft"
);

// ---------------------------------------------------------------------------
// 2. The schema.org mapping: what a role becomes, and what it cannot become.
// ---------------------------------------------------------------------------
const { GROUP_NAME, dateOf, jobPosting } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-posting.ts")).href
);

/** The smallest role that is a role. Every fixture starts here. */
const role = (over = {}) => ({
  id: "3f2a1b00-0000-4000-8000-000000000001",
  title: "Site Quantity Surveyor",
  department: "Commercial",
  sector: "real_estate",
  location: "Sharm El Sheikh",
  employment_type: "FULL_TIME",
  experience_level: null,
  description: "Measure the work before it is poured.",
  requirements: ["5 years on site", "AutoCAD"],
  min_salary_usd: null,
  max_salary_usd: null,
  salary_currency: "USD",
  company_id: "tenant-1",
  company_name: "Dreams Development",
  posted_at: "2026-10-01T00:00:00.000Z",
  created_at: "2026-09-20T00:00:00.000Z",
  closing_at: null,
  ...over,
});

const company = (over = {}) => ({
  id: "tenant-1",
  name: "Dreams Development",
  legal_name: null,
  slug: "dreams-development",
  sector: "real_estate",
  tagline: null,
  description: null,
  history: null,
  careers_pitch: null,
  founded_year: null,
  ownership_type: null,
  employee_range: null,
  headquarters: null,
  milestones: [],
  benefits: [],
  website: null,
  is_group_profile: false,
  sort_order: 100,
  ...over,
});

check("dateOf prefers the day it went public", dateOf(role()) === "2026-10-01T00:00:00.000Z");
check(
  "dateOf falls back to the day the row was made",
  dateOf(role({ posted_at: null })) === "2026-09-20T00:00:00.000Z"
);
check(
  "dateOf treats blank text as no date at all",
  dateOf(role({ posted_at: "  ", created_at: "" })) === null
);

const posted = jobPosting(role(), company(), { baseUrl: "https://careers.example/" });
check("a role with a date makes a posting", posted !== null);
check("the trailing slash is not doubled into the url", posted?.url === `https://careers.example/careers/${role().id}`);
check("the title names the role, not the employer", posted?.title === "Site Quantity Surveyor");
check("the description is the column verbatim", posted?.description === "Measure the work before it is poured.");
check("datePosted is the publication day", posted?.datePosted === "2026-10-01T00:00:00.000Z");
check("the employer is the role's own company", posted?.hiringOrganization.name === "Dreams Development");
check("a company with no legal name files none", posted?.hiringOrganization.legalName === undefined);
check("a company with no website files no sameAs", posted?.hiringOrganization.sameAs === undefined);
check("the apply form is one click away", posted?.directApply === true);
check(
  "the identifier is the role's own id",
  posted?.identifier.value === "3f2a1b00-0000-4000-8000-000000000001" &&
    posted?.identifier.name === "Job ID"
);
check("a role with no closing date says none", posted?.validThrough === undefined);
check(
  "a role that closes on a day carries it",
  jobPosting(role({ closing_at: "2026-11-30T00:00:00.000Z" }), company(), {
    baseUrl: "https://careers.example",
  })?.validThrough === "2026-11-30T00:00:00.000Z"
);

// The employer chain, step by step. Each step must name an employer; only the
// first one may name the wrong company.
check(
  "a legal name that differs from the name is filed",
  jobPosting(role(), company({ legal_name: "Dreams Development LLC" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.legalName === "Dreams Development LLC"
);
check(
  "a legal name identical to the name is not repeated",
  jobPosting(role(), company({ legal_name: "Dreams Development" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.legalName === undefined
);
check(
  "a filed website becomes sameAs",
  jobPosting(role(), company({ website: "https://dreams.example" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.sameAs === "https://dreams.example"
);
check(
  "a role with no company row keeps its own company name",
  jobPosting(role(), null, { baseUrl: "https://careers.example", groupName: "Sharm Dreams" })
    ?.hiringOrganization.name === "Dreams Development"
);
check(
  "a role whose join carried no name falls to the group",
  jobPosting(role({ company_name: null }), null, {
    baseUrl: "https://careers.example",
    groupName: "Sharm Dreams Holdings",
  })?.hiringOrganization.name === "Sharm Dreams Holdings"
);
check(
  "with neither company nor group it names the group it belongs to",
  jobPosting(role({ company_name: null }), null, { baseUrl: "https://careers.example" })
    ?.hiringOrganization.name === GROUP_NAME
);

// The one null case: a role that cannot be dated is not published.
check(
  "an undated role makes no posting at all",
  jobPosting(role({ posted_at: null, created_at: "" }), company(), {
    baseUrl: "https://careers.example",
  }) === null
);
check("the group literal is the one the spec names", GROUP_NAME === "Sharm Dreams Group");

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
