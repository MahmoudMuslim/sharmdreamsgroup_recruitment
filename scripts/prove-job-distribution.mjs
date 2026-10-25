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

// ---------------------------------------------------------------------------
// 3. Employment and place: where the platform's vocabulary and Google's diverge.
// ---------------------------------------------------------------------------
const { jobPostingJsonLd } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-posting.ts")).href
);

const post = (over) => jobPosting(role(over), company(), { baseUrl: "https://careers.example" });

// Google names a contract; the column mixes contracts with arrangements.
check("FULL_TIME is the same word both sides", post({ employment_type: "FULL_TIME" })?.employmentType === "FULL_TIME");
check("PART_TIME is the same word both sides", post({ employment_type: "PART_TIME" })?.employmentType === "PART_TIME");
check("CONTRACT becomes Google's CONTRACTOR", post({ employment_type: "CONTRACT" })?.employmentType === "CONTRACTOR");
check("INTERNSHIP becomes Google's INTERN", post({ employment_type: "INTERNSHIP" })?.employmentType === "INTERN");
check(
  "REMOTE names an arrangement, not a contract, so it says nothing",
  post({ employment_type: "REMOTE" })?.employmentType === undefined
);
check(
  "HYBRID names an arrangement, not a contract, so it says nothing",
  post({ employment_type: "HYBRID" })?.employmentType === undefined
);
check(
  "a code the CHECK constraint never saw is OTHER, not a guess",
  post({ employment_type: "FREELANCE_ROTATION" })?.employmentType === "OTHER"
);
check("an empty job type says nothing", post({ employment_type: "" })?.employmentType === undefined);

// Place.
const place = post({})?.jobLocation?.[0];
check(
  "a role with a place carries it as a PostalAddress",
  place?.address?.addressLocality === "Sharm El Sheikh" &&
    place?.address?.addressCountry?.name === "Egypt"
);
check("a role that is not remote files no location type", post({})?.jobLocationType === undefined);

// Remote: the arrangement is carried by jobLocationType, which is where Google looks.
const remoteByType = post({ employment_type: "REMOTE", location: "" });
check("a remote role files TELECOMMUTE", remoteByType?.jobLocationType === "TELECOMMUTE");
check("a remote role with no place files no jobLocation", remoteByType?.jobLocation === undefined);
check(
  "a remote role names the countries an applicant may live in",
  remoteByType?.applicantLocationRequirements?.[0]?.name === "Egypt"
);
const remoteByText = post({ employment_type: "FULL_TIME", location: "Remote" });
check("the word remote in the location text is enough to be remote", remoteByText?.jobLocationType === "TELECOMMUTE");
check("and it loses no employment contract for it", remoteByText?.employmentType === "FULL_TIME");
const remoteWithOffice = post({ employment_type: "REMOTE", location: "Cairo / Remote" });
check(
  "a remote role that also names a real place keeps the hiring office",
  remoteWithOffice?.jobLocation?.[0]?.address?.addressLocality === "Cairo / Remote" &&
    remoteWithOffice?.jobLocationType === "TELECOMMUTE"
);
const hybrid = post({ employment_type: "HYBRID", location: "Sharm El Sheikh" });
check("a hybrid role files HYBRID and keeps its place", hybrid?.jobLocationType === "HYBRID" && hybrid?.jobLocation?.length === 1);
check(
  "a non-remote role files no applicant location requirements",
  post({})?.applicantLocationRequirements === undefined
);
check(
  "a role with an empty location is not a crash, just an addressless posting",
  post({ location: "   " })?.jobLocation === undefined
);

// baseSalary is deliberately absent: the platform stores an amount and a
// currency and no period, so any unitText would be invented.
check(
  "no salary is emitted, because no period is recorded",
  post({ min_salary_usd: 40000, max_salary_usd: 60000 })?.baseSalary === undefined
);

// The string that goes inside the <script> tag.
const ld = jobPostingJsonLd(
  jobPosting(role({ description: "We are hiring. </script><script>alert(1)</script>" }), company(), {
    baseUrl: "https://careers.example",
  })
);
check("the escape is the JSON escape, not a stripped tag", ld.includes("\\u003c/script>"));
check("no literal angle bracket survives to close the tag", !ld.includes("<"));
check(
  "what the browser parses back is the text the author typed",
  JSON.parse(ld).description === "We are hiring. </script><script>alert(1)</script>"
);
check(
  "a posting with no angle brackets round-trips untouched",
  JSON.parse(jobPostingJsonLd(post({}))).title === "Site Quantity Surveyor"
);

// --- P1: the employer chain's first step, pinned only by a fixture that
// separates the two names. Every fixture above passes the same string to
// `company.name` and `job.company_name`, so a posting that read the role's
// join instead of its company row — or read an untrimmed row — stayed green.
check(
  "the company row is named over the role's own company name",
  jobPosting(role(), company({ name: "Dreams Development Holdings" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.name === "Dreams Development Holdings"
);
check(
  "a company row that is only spaces falls to the role's own company name",
  jobPosting(role(), company({ name: "  " }), { baseUrl: "https://careers.example" })
    ?.hiringOrganization.name === "Dreams Development"
);

// --- P2: the type discriminators spec §2 marks required. A posting Google
// refuses outright would otherwise stay suite-green.
const published = JSON.parse(jobPostingJsonLd(post({})));
check("the published posting names the schema.org context", published["@context"] === "https://schema.org");
check("and its own type in full", published["@type"] === "JobPosting");
check("the employer is typed an Organization", published.hiringOrganization["@type"] === "Organization");
check("the identifier is typed a PropertyValue", published.identifier["@type"] === "PropertyValue");
check(
  "the place is typed through its address to its country",
  published.jobLocation[0]["@type"] === "Place" &&
    published.jobLocation[0].address["@type"] === "PostalAddress" &&
    published.jobLocation[0].address.addressCountry["@type"] === "Country"
);
check(
  "a remote role's applicant requirement is typed a Country",
  JSON.parse(jobPostingJsonLd(remoteByType)).applicantLocationRequirements[0]["@type"] === "Country"
);

// --- P3: blank-as-absent off the date path. A whitespace-only website would
// publish `sameAs: "  "` to all five surfaces.
check(
  "a company whose website is only spaces files no sameAs",
  jobPosting(role(), company({ website: "   " }), { baseUrl: "https://careers.example" })
    ?.hiringOrganization.sameAs === undefined
);

// ---------------------------------------------------------------------------
// 4. The pull surfaces: what a crawler and a recruiter's upload form read.
// ---------------------------------------------------------------------------
const { partitionByDate, sitemapEntries, jobsCsv } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-distribution.ts")).href
);

check(
  "a dated role becomes one sitemap entry",
  sitemapEntries([role()], "https://careers.example").length === 1
);
const entry = sitemapEntries([role()], "https://careers.example")[0];
check("the entry points at the canonical page", entry.url === `https://careers.example/careers/${role().id}`);
check("and carries the date the posting carries", entry.lastModified === "2026-10-01T00:00:00.000Z");
check("a published role changes daily", entry.changeFrequency === "daily" && entry.priority === 0.8);
check(
  "an undated role is left out rather than given a made-up date",
  sitemapEntries([role({ posted_at: null, created_at: "" })], "https://careers.example").length === 0
);
check(
  "the trailing slash is normalised here too",
  sitemapEntries([role()], "https://careers.example/")[0].url === `https://careers.example/careers/${role().id}`
);

const split = partitionByDate([role(), role({ id: "undated-1", posted_at: null, created_at: "" })]);
check("partitionByDate keeps what it can publish", split.publishable.length === 1 && split.undated.length === 1);
check("and names the one it could not", split.undated[0] === "undated-1");

const csv = jobsCsv([role()], "https://careers.example");
const [head, row] = csv.trimEnd().split("\n");
check(
  "the header is the ten columns the spec names, and no salary",
  head === "title,company,location,job_type,department,sector,description,requirements,date_posted,url"
);
check("every field in the row is quoted", (row.match(/"/g) ?? []).length >= 18 && row.startsWith('"Site Quantity Surveyor"'));
check("the stored job type code travels, not a rendered label", row.includes('"FULL_TIME"'));
check("requirements are joined with a semicolon and a space", row.includes('"5 years on site; AutoCAD"'));
check("the url is the canonical page", row.endsWith(`"https://careers.example/careers/${role().id}"`));
check("and the date is the publication day", row.includes('"2026-10-01T00:00:00.000Z"'));

const messy = jobsCsv(
  [role({ title: 'Big "Boss", Jr', description: "line one\nline two", requirements: [] })],
  "https://careers.example"
);
check('an internal quote is doubled, not escaped with a backslash', messy.includes('"Big ""Boss"", Jr"'));
check("a description with a newline stays inside its quoted field", messy.includes('"line one\nline two"'));
check(
  "one role is one record, even when its text spans lines",
  messy.startsWith('title,company,location,job_type,department,sector,description,requirements,date_posted,url\n"Big ""Boss"", Jr"')
);
check(
  "a role with no requirements files an empty cell, not the word null",
  jobsCsv([role({ requirements: [] })], "https://careers.example").split("\n")[1].includes('""')
);
check(
  "a role with no company name files an empty company cell",
  jobsCsv([role({ company_name: null })], "https://careers.example").split("\n")[1].startsWith(
    '"Site Quantity Surveyor","",'
  )
);
check("an undated role makes no row", jobsCsv([role({ posted_at: null, created_at: "" })], "https://careers.example").trimEnd().split("\n").length === 1);
check("no roles at all is still a header", jobsCsv([], "https://careers.example").trimEnd() === "title,company,location,job_type,department,sector,description,requirements,date_posted,url");

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
