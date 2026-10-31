/* scripts/prove-job-distribution.mjs
 * Run: node scripts/prove-job-distribution.mjs
 *
 * Nothing here needs a database, a board account or a browser. What is pinned is
 * the part every surface shares: the columns the public read is allowed to see,
 * the schema.org mapping, the three pull artifacts, and the fact that each of the
 * five doors actually opens onto the module rather than writing its own version.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// A URL segment is not an id until it is one. Without the shape check the filter
// reaches Postgres as `id = 'nonexistent'`, which raises 22P02 mid-render.
const publicJobSource = read("src/app/careers/actions.ts");
const publicJobBody = publicJobSource.slice(
  publicJobSource.indexOf("export async function getPublicJob(id")
);
const shapeAt = publicJobBody.indexOf("UUID_PATTERN.test(id)");
const restAt = publicJobBody.indexOf("const restClient = getAnonRestClient()");
check(
  "a path segment that cannot be an id is answered as missing, not sent to Postgres",
  shapeAt !== -1 && shapeAt < restAt,
  "an unvalidated id reaches the REST filter as 22P02 instead of 404ing"
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

// ---------------------------------------------------------------------------
// 5. The feed: XML the recruiter's description cannot break.
// ---------------------------------------------------------------------------
const { rssFeed } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-distribution.ts")).href
);

const feed = rssFeed([role()], {
  baseUrl: "https://careers.example",
  title: "Sharm Dreams Group",
  link: "https://careers.example/careers",
  description: "Open roles with the Sharm Dreams Group.",
  publishedAt: "2026-10-01T00:00:00.000Z",
});
check("it is a declaration, then an RSS 2.0 document", feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">'));
check("the channel names the group", feed.includes("<title>Sharm Dreams Group</title>"));
check("the channel links the board", feed.includes("<link>https://careers.example/careers</link>"));
check("one item per published role", (feed.match(/<item>/g) ?? []).length === 1);
check("the item's guid is its canonical url as a permalink", feed.includes(`<guid isPermaLink="true">https://careers.example/careers/${role().id}</guid>`));
check("the item links the canonical page", feed.includes(`<link>https://careers.example/careers/${role().id}</link>`));
check("pubDate is the RFC 822 form of the posted day", feed.includes("<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>"));
check("the channel's lastBuildDate is the newest item's date", feed.includes("<lastBuildDate>Thu, 01 Oct 2026 00:00:00 GMT</lastBuildDate>"));
check("it closes every tag it opened", feed.trimEnd().endsWith("</channel>\n</rss>"));

const hostile = rssFeed(
  [
    role({
      id: "3f2a1b00-0000-4000-8000-000000000002",
      title: 'Salt & Pepper <b>"bold"</b>',
      description: "]]> ends a CDATA section; <tag> does not survive escaping",
    }),
  ],
  { baseUrl: "https://careers.example", title: "Group & Co", publishedAt: "2026-10-01T00:00:00.000Z" }
);
check("an ampersand in text is escaped", hostile.includes("Salt &amp; Pepper"));
check("angle brackets in text are escaped", hostile.includes('&lt;b&gt;"bold"&lt;/b&gt;'));
check(
  "a quote in text stays a quote, because a text node needs no escaping of it",
  hostile.includes("&lt;b&gt;&quot;") === false
);
check("a CDATA terminator in a description is inert", hostile.includes("]]&gt;"));
check("CDATA is not used at all", !hostile.includes("<![CDATA["));
check(
  "a channel title is escaped too",
  hostile.includes("<title>Group &amp; Co</title>")
);
check(
  "an undated role makes no item",
  rssFeed([role({ posted_at: null, created_at: "" })], {
    baseUrl: "https://careers.example",
    title: "Group",
    publishedAt: "2026-10-01T00:00:00.000Z",
  }).includes("<item>") === false
);
const empty = rssFeed([], { baseUrl: "https://careers.example", title: "Group", publishedAt: "2026-10-01T00:00:00.000Z" });
check("no roles is still a valid channel", empty.includes("<channel>") && empty.includes("</channel>") && !empty.includes("<item>"));
check(
  "the feed's own default link is the board on the base url",
  rssFeed([], { baseUrl: "https://careers.example/", title: "Group", publishedAt: "2026-10-01T00:00:00.000Z" }).includes(
    "<link>https://careers.example/careers</link>"
  )
);

// ---------------------------------------------------------------------------
// 6. The five doors: each surface calls the module, and writes no rules of its own.
// ---------------------------------------------------------------------------
sourceHas("the role page emits JobPosting JSON-LD", "src/app/careers/[id]/page.tsx", [
  'type="application/ld+json"',
  "dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(posting) }}",
  "jobPosting(job, company",
  "appConfig.url",
]);
check(
  "the page leaves the tag out when the role cannot be dated",
  read("src/app/careers/[id]/page.tsx").includes("{posting && (")
);
check(
  "the page does not write its own employer rule",
  !read("src/app/careers/[id]/page.tsx").includes("hiringOrganization")
);
check(
  "the page does not re-stringify the posting itself",
  !read("src/app/careers/[id]/page.tsx").includes("JSON.stringify")
);

sourceHas("the sitemap is built from the board's own read", "src/app/sitemap.ts", [
  'from "@/app/careers/actions"',
  "getPublicJobs()",
  "sitemapEntries",
  "appConfig.url",
  "${base}/careers",
]);
// The call, not the prose: the module's own docblock names `await connection()`,
// so a needle over the raw file passed after the call was deleted.
const sitemapCode = read("src/app/sitemap.ts")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
check(
  "the sitemap waits for a request before it reads",
  /^\s*await connection\(\);/m.test(sitemapCode),
  "the call must be code, not a comment"
);
check(
  "the sitemap logs what it had to leave out",
  read("src/app/sitemap.ts").includes("role without a date is not published")
);
check(
  "the sitemap reaches no page a staff member works on",
  !read("src/app/sitemap.ts").includes("(admin)") &&
    !read("src/app/sitemap.ts").includes("/portal") &&
    !read("src/app/sitemap.ts").includes("/api/")
);

sourceHas("the robots file points at the sitemap", "src/app/robots.ts", [
  "appConfig.url",
  "/sitemap.xml",
  'allow: "/"',
  'userAgent: "*"',
  '"/careers/apply"',
  '"/api/"',
  '"/login"',
]);
const robotText = read("src/app/robots.ts");
const robotCode = robotText
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
check(
  "the robots file waits for a request before it names its origin",
  /^\s*await connection\(\);/m.test(robotCode),
  "the call must be code, not a comment"
);
// The refusal list is read from the route tree rather than repeated: this file
// is the one place a crawler is told what is not for it, and a page added without
// a matching line here would be indexed the day it ships.
// The count is derived from the tree, not written down: a hard-coded figure
// goes stale the day a staff page is added, and a stale pin that still passes
// because the check was skipped is worse than no pin. The tree is the source
// of truth and the guard is measured against it.
const staffPaths = readdirSync(path.join(root, "src/app/(admin)"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, "src/app/(admin)", entry.name, "page.tsx")))
  .map((entry) => `/${entry.name}`)
  .sort();
const staffRoutesBlock = /export const STAFF_ROUTES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(
  read("src/lib/auth/staffRoutes.ts")
);
const guardedPaths = staffRoutesBlock
  ? [...staffRoutesBlock[1].matchAll(/"(\/[^"]*)"/g)].map((match) => match[1]).sort()
  : [];
check(
  `the staff tree is the ${staffPaths.length} pages the guard counts`,
  staffPaths.join(",") === guardedPaths.join(","),
  `tree ${staffPaths.join(", ")} / guard ${guardedPaths.join(", ")}`
);
for (const staffPath of staffPaths) {
  check(`the robots file refuses ${staffPath}`, robotText.includes(`"${staffPath}"`));
}
check("and refuses the candidate surfaces", robotText.includes('"/portal"') && robotText.includes('"/test"'));
check(
  "the careers tree is allowed, which is the point of the file",
  !robotText.includes('"/careers"')
);

sourceHas("the feed route serves RSS", "src/app/api/careers/feed.xml/route.ts", [
  'await connection()',
  "rssFeed(",
  'application/rss+xml',
  'Cache-Control": "no-store"',
  "groupProfile(companies)",
  "${base}/careers",
]);
sourceHas("the export route serves CSV", "src/app/api/careers/jobs.csv/route.ts", [
  'await connection()',
  "jobsCsv(",
  'text/csv',
  'attachment; filename="sharm-dreams-openings.csv"',
]);
for (const rel of ["src/app/api/careers/feed.xml/route.ts", "src/app/api/careers/jobs.csv/route.ts"]) {
  const text = read(rel);
  // The route may normalise a trailing slash; what it must never do is escape,
  // because re-escaping what the module already escaped double-encodes every
  // ampersand in a role description.
  check(`${rel} writes no escaping of its own`, !/&amp;|&lt;|&quot;|CDATA|JSON\.stringify/.test(text));
  check(`${rel} reads only the board's own published read`, text.includes("getPublicJobs()"));
  check(`${rel} logs an undated role`, text.includes("role without a date is not published"));
}

// ---------------------------------------------------------------------------
// 7. The live read: the same rows the board publishes, in all five formats.
//    Skipped, not failed, when the local stack is not answering.
// ---------------------------------------------------------------------------
// The port comes from the stack's own env file, never a guess — the gateway has
// moved ports before. Only the one key is read; nothing else in that file is
// touched, and nothing from it is printed.
const gatewayPort = (() => {
  const line = readFileSync(path.join(root, "docker", ".env"), "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("LOCAL_GATEWAY_PORT="));
  return line ? line.slice("LOCAL_GATEWAY_PORT=".length).trim() : "54321";
})();
const stackBase = `http://localhost:${gatewayPort}/rest/v1`;

// A probe over a column that has always existed. If THIS fails, the stack is
// down and the live section is skipped; if only the widened read below fails,
// the column list is wrong and that is a failure, not a skip.
const stackProblem = await (async () => {
  try {
    const probe = await fetch(`${stackBase}/job_openings?select=id&limit=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    return probe.ok ? null : `PostgREST answered ${probe.status}`;
  } catch (error) {
    return error.name === "TimeoutError" ? "the gateway timed out" : "PostgREST is not listening";
  }
})();

if (stackProblem) {
  console.log(`(skipping the live read: ${stackProblem})`);
} else {
  // An anonymous read through the same policy every surface uses. No writes, no
  // token: `token: null` is exactly what `getAnonRestClient` sends, and RLS
  // decides what comes back.
  const response = await fetch(
    `${stackBase}/job_openings?select=id,posted_at,created_at&status=eq.PUBLISHED&order=posted_at.desc`,
    { headers: { Accept: "application/json" } }
  );
  const body = await response.text();
  let rows = null;
  try {
    rows = JSON.parse(body);
  } catch {
    rows = null;
  }

  check(
    "the widened read answers the anonymous role",
    response.status === 200,
    `status ${response.status}: ${body.slice(0, 160)}`
  );
  check("the public read returns rows the board can publish", Array.isArray(rows));
  if (Array.isArray(rows)) {
    const dated = rows.filter((row) => row.posted_at || row.created_at);
    check(
      "every published row can be dated, so no role is silently missing from a surface",
      dated.length === rows.length,
      `${rows.length - dated.length} published row(s) have neither posted_at nor created_at — they will be absent from all five surfaces`
    );
    // The REST row carries the three columns under test; the free-text fields
    // are blanked because `jobPosting` reads them and this check is about the
    // date rule, which is the one thing a widened select can break.
    const asJob = (row) => ({
      ...row,
      title: "",
      department: "",
      sector: "",
      location: "",
      employment_type: "",
      description: "",
      requirements: [],
      company_name: null,
    });
    check(
      "the widened read still shapes a PublicJob the domain accepts",
      rows.length === 0 || jobPosting(asJob(rows[0]), null, { baseUrl: "http://localhost:3000" }) !== null
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
