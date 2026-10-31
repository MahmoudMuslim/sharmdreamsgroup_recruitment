/* scripts/prove-reporting.mjs
 * Run: node --experimental-strip-types scripts/prove-reporting.mjs
 *
 * The reporting slice's correctness boundary: what the three staff surfaces are
 * allowed to say about the application forms and the person spine that were
 * added after those surfaces were written.
 *
 * Nine checks run the pure builder against fixed rows, so a figure is pinned to
 * arithmetic rather than to a screenshot. Five are text pins: they hold the
 * reader, the report catalogue, the export route and the sheet columns to the
 * same promises, because a builder nobody calls changes nothing.
 *
 * The boundary these checks exist for: a person's gender, nationality, marital
 * status or age is never counted for a caller without the family-data grant,
 * tier-3 coverage is withheld with it, and no demographic value reaches a
 * row-level export at all.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(root, "src", specifier.slice(2));
      for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
        try {
          if (readFileSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          /* try the next candidate */
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const MODULE = "src/modules/analytics/domain/formAndProfile.ts";
const MODULE_URL = pathToFileURL(path.join(root, MODULE)).href;

const results = [];
const mutations = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${what}: expected ${b}, got ${a}`);
}

async function safe(fn) {
  try {
    await fn();
    return { pass: true };
  } catch (error) {
    return { pass: false, detail: String(error?.message ?? error).split("\n")[0] };
  }
}

async function check(name, fn) {
  results.push({ name, ...(await safe(fn)) });
}

let mod = null;
let version = 0;
const load = async () => {
  version += 1;
  try {
    mod = await import(`${MODULE_URL}?v=${version}`);
  } catch (error) {
    throw new Error(`${MODULE} cannot be imported: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  return mod;
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const NOW = "2026-10-26T00:00:00.000Z";

function snapshot(fields) {
  return {
    forms: [{ id: "c522ed4a-97bf-45f3-99f3-e40c4638ede3", name: "Personal details", version: 4 }],
    fields: fields.map((field) => ({
      key: field.key,
      type: field.type ?? "short_text",
      label: field.label,
      value: field.value ?? null,
      systemKey: field.systemKey ?? null,
    })),
  };
}

const FULL_SNAPSHOT = snapshot([
  { key: "personal_details_heading", type: "section_heading", label: "Personal details" },
  { key: "applicant_name", label: "Full name", value: "Nour Hany", systemKey: "name" },
  { key: "applicant_about", type: "long_text", label: "About you", value: "Six years at sea.", systemKey: "about" },
  { key: "applicant_phone", type: "phone", label: "Phone", value: "+20 100 000 0000", systemKey: "phone" },
  { key: "applicant_email", type: "email", label: "Email", value: "nour@example.com", systemKey: "email" },
  { key: "birthday", type: "date", label: "Birthday", value: null },
]);

const PARTIAL_SNAPSHOT = snapshot([
  { key: "applicant_name", label: "Full name", value: "Probe Cortez", systemKey: "name" },
  { key: "applicant_email", type: "email", label: "Email", value: "" },
  { key: "applicant_cv", type: "file", label: "CV" },
]);

const APPLICATIONS = [
  {
    id: "app-1",
    stage: "NEW",
    source: "CAREER_SITE",
    created_at: "2026-10-20T09:00:00.000Z",
    has_cv: true,
    consent: { processing: true, talent_pool: false, notice_version: "2026-10-25" },
    snapshot: FULL_SNAPSHOT,
  },
  {
    id: "app-2",
    stage: "ASSESSMENT",
    source: "LINKEDIN",
    created_at: "2026-10-21T09:00:00.000Z",
    has_cv: false,
    consent: { processing: true, talent_pool: true, notice_version: "2026-10-25" },
    snapshot: PARTIAL_SNAPSHOT,
  },
  {
    id: "app-3",
    stage: "HIRED",
    source: "REFERRAL",
    created_at: "2026-10-22T09:00:00.000Z",
    has_cv: false,
    consent: { processing: false, talent_pool: false, notice_version: null },
    snapshot: null,
  },
];

const PROFILES = [
  {
    id: "person-1",
    filled: ["legal_name", "phone", "date_of_birth", "gender", "nationality", "marital_status", "children_count", "skills"],
    date_of_birth: "1996-03-14",
    gender: "Woman",
    nationality: "Egyptian",
    marital_status: "Single",
    children_count: 0,
  },
  {
    id: "person-2",
    filled: ["legal_name", "date_of_birth", "gender", "dependants", "employment"],
    date_of_birth: "1990-01-02",
    gender: "Man",
    nationality: null,
    marital_status: null,
    children_count: null,
  },
  {
    id: "person-3",
    filled: ["legal_name", "phone"],
    date_of_birth: null,
    gender: null,
    nationality: null,
    marital_status: null,
    children_count: null,
  },
];

const ATTACHMENTS = { "app-1": 2, "app-2": 1 };

// One row per `application_form_files` row the reader hands over. A null
// application_id is an upload nobody submitted; the orphan window decides
// whether the retention sweep is still going to clear it.
const FILES = [
  { application_id: "app-1", field_key: "applicant_cv", uploaded_at: "2026-10-25T00:00:00.000Z" },
  { application_id: null, field_key: "applicant_cv", uploaded_at: "2026-10-24T00:00:00.000Z" },
  { application_id: null, field_key: "photo", uploaded_at: "2026-10-23T12:00:00.000Z" },
  { application_id: null, field_key: "applicant_cv", uploaded_at: "2026-10-25T12:00:00.000Z" },
];

// p1: 59 months + 29 months = 88; p2: a year-only period = 12. Neither
// figure is a score, and p3 has no dated role at all.
const EMPLOYMENT = [
  { person_id: "person-1", employer: "A", startYear: 2016, startMonth: 1, endYear: 2020, endMonth: 12, ongoing: false },
  { person_id: "person-1", employer: "B", startYear: 2021, startMonth: 1, endYear: 2023, endMonth: 6, ongoing: false },
  { person_id: "person-2", employer: "C", startYear: 2019, startMonth: null, endYear: 2022, endMonth: null, ongoing: false },
];

function build(overrides = {}) {
  return mod.buildFormProfileReport({
    applications: APPLICATIONS,
    profiles: PROFILES,
    attachments: ATTACHMENTS,
    files: FILES,
    employment: EMPLOYMENT,
    orphanWindowHours: 24,
    canViewDemographics: false,
    generatedAt: NOW,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Behaviour                                                                   */
/* -------------------------------------------------------------------------- */

await check("1. form adoption counts every application, snapshot or not", async () => {
  await load();
  const report = build();
  same(report.applications.total, 3, "total applications");
  same(report.applications.withForm, 2, "with a snapshot");
  same(report.applications.withoutForm, 1, "without a snapshot");
  same(report.applications.adoptionRate, 67, "adoption rate");
  same(report.applications.withCv, 1, "applications carrying a CV");
});

await check("2. asked vs answered comes from the snapshot, blanks are not answers", async () => {
  await load();
  const report = build();
  // app-1: 5 answerable fields (a heading is not a question), 4 answered.
  // app-2: 3 answerable fields (an empty email is a blank; a file has no value), 1 answered.
  same(report.forms.asked, 8, "answerable fields across both snapshots");
  same(report.forms.answered, 5, "fields with a value");
  same(report.forms.answerRate, 63, "answer rate");
  same(report.forms.versions, [{ label: "Personal details v4", count: 2 }], "form versions");
});

await check("3. attachments are counted per application and in total", async () => {
  await load();
  const report = build();
  same(report.applications.attachments, 3, "attachment rows");
  same(report.applications.withAttachments, 2, "applications with an attachment");
});

await check("4. consent is reported from the application row, not inferred", async () => {
  await load();
  const report = build();
  same(report.applications.processingConsent, 2, "processing consent given");
  same(report.applications.talentPoolConsent, 1, "talent-pool consent given");
  same(report.applications.noticeVersions, [{ label: "2026-10-25", count: 2 }], "notice versions");
});

await check("5. coverage is per group, and any field in the group covers it", async () => {
  await load();
  const report = build();
  const row = (group) => report.profiles.coverage.find((entry) => entry.group === group);
  same(row("identity").filled, 3, "identity covered");
  same(row("contact").filled, 2, "contact covered");
  same(row("skills").filled, 1, "skills covered");
  same(row("work_history").filled, 1, "work history covered");
  same(report.profiles.total, 3, "profiles read");
  same(report.profiles.coverage.length, report.profiles.coverage.filter((entry) => entry.tier !== 3).length, "no tier-3 group");
});

await check("6. identity core is a name plus a date of birth, not either alone", async () => {
  await load();
  const report = build();
  same(report.profiles.identityComplete, 2, "identity core complete");
  same(report.profiles.withName, 3, "profiles with a legal name");
  same(report.profiles.withDob, 2, "profiles with a date of birth");
});

await check("7. demographics fail closed for a caller without the grant", async () => {
  await load();
  const report = build({ canViewDemographics: false });
  same(report.demographics, null, "demographics withheld");
  same(report.profiles.coverage.filter((entry) => entry.tier === 3), [], "tier-3 coverage withheld");
});

await check("8. with the grant, demographics count values and never infer one", async () => {
  await load();
  const report = build({ canViewDemographics: true });
  assert(report.demographics !== null, "demographics should be present");
  same(report.demographics.gender, [
    { label: "Man", count: 1 },
    { label: "Woman", count: 1 },
    { label: "Not stated", count: 1 },
  ], "gender");
  same(report.demographics.nationality, [
    { label: "Egyptian", count: 1 },
    { label: "Not stated", count: 2 },
  ], "nationality");
  same(report.demographics.maritalStatus, [
    { label: "Single", count: 1 },
    { label: "Not stated", count: 2 },
  ], "marital status");
  same(report.demographics.children, [
    { label: "0", count: 1 },
    { label: "Not stated", count: 2 },
  ], "children");
  const dependants = report.profiles.coverage.find((entry) => entry.group === "dependants");
  same(dependants?.filled, 1, "tier-3 coverage visible with the grant");
});

await check("9. age bands are computed at the report date, and a missing date is not a band", async () => {
  await load();
  const report = build({ canViewDemographics: true });
  same(report.demographics.ageBands, [
    { label: "30–39", count: 2 },
    { label: "Not stated", count: 1 },
  ], "age bands");
  same(report.demographics.stated, 2, "profiles stating at least one demographic");
});

/* -------------------------------------------------------------------------- */
/* Text pins — a builder nobody calls changes nothing                          */
/* -------------------------------------------------------------------------- */

await check("10. the analytics reader asks applications for their form and consent columns", async () => {
  const source = read("src/modules/analytics/infrastructure/reportReader.ts");
  assert(source.includes("form_answers"), "form_answers is selected");
  assert(source.includes("processing_consent_at"), "processing consent is selected");
  assert(source.includes("talent_pool_consent_at"), "talent-pool consent is selected");
  assert(source.includes("buildFormProfileReport"), "the report builder is called");
  assert(source.includes("canViewDemographics"), "the grant flag reaches the builder");
});

await check("11. the analytics report carries the new section", async () => {
  const source = read("src/modules/analytics/domain/report.ts");
  assert(source.includes("formProfile"), "AnalyticsReport gains formProfile");
});

await check("12. both new lists are in the report catalogue and the export route", async () => {
  const documents = read("src/modules/analytics/domain/documents.ts");
  assert(documents.includes('"application_forms"'), "application_forms report id");
  assert(documents.includes('"person_profiles"'), "person_profiles report id");
  assert(/Every application form/i.test(documents), "form report label");
  assert(/Every person profile/i.test(documents), "profile report label");

  const route = read("src/app/api/reports/export/route.ts");
  assert(route.includes("reportDefinition"), "the route accepts catalogue ids");
});

/** The source of one exported function, up to the next top-level `export function`. */
function functionBody(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `${marker} exists`);
  const next = source.indexOf("export function", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

await check("13. a row-level profile export never carries a demographic value", async () => {
  const documents = read("src/modules/analytics/domain/documents.ts");
  const body = functionBody(documents, "export function profileSheet");
  for (const forbidden of ["gender", "nationality", "birthplace", "marital", "children"]) {
    assert(!body.includes(forbidden), `profileSheet must not export ${forbidden}`);
  }
});

await check("14. the dashboard counts only files filed against an application", async () => {
  const source = read("src/app/(admin)/dashboard/actions.ts");
  assert(source.includes("form_answers"), "dashboard reads the snapshot");
  assert(source.includes("application_form_files"), "dashboard counts attachments");
  // A null application_id is an upload the applicant never submitted; the
  // retention sweep deletes it after the orphan window. Counting it would
  // overstate what the form saved and disagree with the Analytics reader.
  assert(
    source.includes('.not("application_id", "is", null)'),
    "unlinked uploads excluded"
  );
});

/* -------------------------------------------------------------------------- */
/* Deeper detail: questions, abandonment, experience                           */
/* -------------------------------------------------------------------------- */

await check("15. a question is counted by key, and a blank is not an answer", async () => {
  await load();
  const report = build();
  same(
    report.questions,
    [
      { key: "applicant_email", label: "Email", type: "email", asked: 2, answered: 1, skipped: 1, answerRate: 50 },
      { key: "applicant_name", label: "Full name", type: "short_text", asked: 2, answered: 2, skipped: 0, answerRate: 100 },
      { key: "applicant_about", label: "About you", type: "long_text", asked: 1, answered: 1, skipped: 0, answerRate: 100 },
      { key: "birthday", label: "Birthday", type: "date", asked: 1, answered: 0, skipped: 1, answerRate: 0 },
      { key: "applicant_cv", label: "CV", type: "file", asked: 1, answered: 0, skipped: 1, answerRate: 0 },
      { key: "applicant_phone", label: "Phone", type: "phone", asked: 1, answered: 1, skipped: 0, answerRate: 100 },
    ],
    "question rows"
  );
  // A heading is layout; it must never appear as a question.
  assert(!report.questions.some((row) => row.key === "personal_details_heading"), "heading excluded");
});

await check("16. abandoned uploads are split by the orphan window", async () => {
  await load();
  const report = build({
    applications: [
      { ...APPLICATIONS[0], id: "app-9", snapshot: snapshot([{ key: "cv", type: "file", label: "CV" }]) },
      { ...APPLICATIONS[1], id: "app-10", snapshot: snapshot([{ key: "photo", type: "photo", label: "Photo" }]) },
      { ...APPLICATIONS[2], id: "app-11", snapshot: snapshot([{ key: "about", label: "About" }]) },
    ],
    attachments: { "app-10": 1 },
  });
  const completion = report.completion;
  same(completion.orphanWindowHours, 24, "window");
  same(completion.unclaimed, 3, "unclaimed rows");
  same(completion.unclaimedPastWindow, 2, "past the window");
  same(completion.unclaimedInsideWindow, 1, "still inside the window");
  same(completion.fileFieldsAsked, 2, "applications whose form asks for a file");
  same(completion.withAttachment, 1, "of those, with an attachment");
  same(completion.completionRate, 50, "completion rate");
  same(
    completion.fields,
    [
      { fieldKey: "applicant_cv", uploads: 2, insideWindow: 1, pastWindow: 1, oldestHours: 48 },
      { fieldKey: "photo", uploads: 1, insideWindow: 0, pastWindow: 1, oldestHours: 60 },
    ],
    "unclaimed by field"
  );
});

await check("17. experience is counted per person from dated roles", async () => {
  await load();
  const report = build();
  same(
    report.experience,
    {
      people: 3,
      withHistory: 2,
      roles: 3,
      medianTotalMonths: 50,
      bands: [
        { label: "Under 1 year", count: 0 },
        { label: "1–2 years", count: 1 },
        { label: "2–5 years", count: 0 },
        { label: "5–10 years", count: 1 },
        { label: "10 years and over", count: 0 },
      ],
      rowsWithMonths: 2,
      rowsWithEnd: 3,
    },
    "experience"
  );
});

await check("18. an empty store yields zeros and a null median, never a NaN", async () => {
  await load();
  const report = build({
    applications: [],
    profiles: [],
    employment: [],
    files: [],
    attachments: {},
  });
  same(report.experience.people, 0, "people");
  same(report.experience.withHistory, 0, "with history");
  same(report.experience.medianTotalMonths, null, "median");
  same(report.experience.bands.map((band) => band.count), [0, 0, 0, 0, 0], "bands");
  same(report.completion.unclaimed, 0, "unclaimed");
  same(report.completion.fileFieldsAsked, 0, "file fields asked");
  same(report.completion.completionRate, null, "completion rate");
  assert(!JSON.stringify(report).includes("NaN"), "no NaN anywhere");
});

await check("19. the aggregate export carries the form, question and profile sections", async () => {
  const source = read("src/modules/analytics/domain/documents.ts");
  assert(source.includes('add("forms", "adoption_rate_percent"'), "adoption reaches the summary sheet");
  assert(source.includes('add("forms", "unclaimed_past_window"'), "abandonment reaches the summary sheet");
  assert(source.includes('add("profiles", "median_total_experience_months"'), "experience reaches the summary sheet");
  assert(source.includes('add("profiles", "demographics"'), "demographics state their own visibility");
});

await check("20. the new lists and columns are in the catalogue and stay value-free", async () => {
  const documents = read("src/modules/analytics/domain/documents.ts");
  assert(documents.includes('"form_questions"'), "form_questions report id");
  assert(documents.includes('"unclaimed_uploads"'), "unclaimed_uploads report id");
  assert(/Every form question/i.test(documents), "question report label");
  assert(/Every unclaimed upload/i.test(documents), "unclaimed report label");

  const questionBody = functionBody(documents, "export function questionSheet");
  assert(questionBody.includes('"Skipped"'), "skip count is exported");
  assert(!questionBody.includes("field.value"), "no answer value reaches the question sheet");

  const uploadBody = functionBody(documents, "export function unclaimedSheet");
  assert(!uploadBody.includes("storage_path"), "no storage path reaches the unclaimed sheet");
  assert(!uploadBody.includes("filename"), "no file name reaches the unclaimed sheet");

  const profileBody = functionBody(documents, "export function profileSheet");
  assert(profileBody.includes('"Total experience"'), "profile rows carry experience");
  assert(!/score|verdict|rating/i.test(profileBody), "experience is never printed as a score");
});

await check("21. the reader reads field keys, upload dates and employment rows", async () => {
  const source = read("src/modules/analytics/infrastructure/reportReader.ts");
  assert(source.includes("field_key"), "form files keep their field key");
  assert(source.includes("uploaded_at"), "form files keep their upload date");
  assert(source.includes('from("person_employment")'), "employment rows are read");
  assert(source.includes("orphan_upload_window_hours"), "the window comes from LIMITS");
});

await check("22. the dashboard counts the uploads the sweep will actually clear", async () => {
  const source = read("src/app/(admin)/dashboard/actions.ts");
  assert(source.includes('is("application_id", null)'), "unclaimed uploads are a null application");
  assert(source.includes('lt("uploaded_at"'), "only those past the window");
  assert(/Unclaimed uploads/i.test(source), "the figure is named for what it counts");
});

/* -------------------------------------------------------------------------- */
/* Mutation proofs — each edit must turn its assertion red                     */
/* -------------------------------------------------------------------------- */

async function mutate(label, find, replace, assertion, target = MODULE) {
  const absolute = path.join(root, target);
  let original;
  try {
    original = readFileSync(absolute, "utf8");
  } catch {
    mutations.push({ label, pass: false, detail: `${target} does not exist` });
    return;
  }
  if (!original.includes(find)) {
    mutations.push({ label, pass: false, detail: "anchor not found" });
    return;
  }
  try {
    writeFileSync(absolute, original.replace(find, replace));
    mod = null;
    const outcome = await safe(assertion);
    mutations.push({ label, pass: !outcome.pass, detail: outcome.pass ? "the assertion stayed green" : "" });
  } finally {
    writeFileSync(absolute, original);
    mod = null;
  }
}

await mutate(
  "M1. a blank counts as an answer → check 2 red",
  "if (answeredValue(field)) answered += 1;",
  "answered += 1;",
  async () => { await load(); same(build().forms.answered, 5, "answered"); }
);

await mutate(
  "M2. demographics ignore the grant → check 7 red",
  "if (!canViewDemographics) return null;",
  "if (false) return null;",
  async () => { await load(); same(build().demographics, null, "withheld"); }
);

await mutate(
  "M3. a name alone counts as the identity core → check 6 red",
  'const IDENTITY_CORE = ["legal_name", "date_of_birth"] as const;',
  'const IDENTITY_CORE = ["legal_name"] as const;',
  async () => { await load(); same(build().profiles.identityComplete, 2, "identity core"); }
);

await mutate(
  "M5. a blank counts as an answer in the question list → check 15 red",
  "if (answeredValue(field)) row.answered += 1;",
  "row.answered += 1;",
  async () => {
    await load();
    same(
      build().questions.find((row) => row.key === "applicant_email")?.answered,
      1,
      "email answered"
    );
  }
);

await mutate(
  "M6. every unclaimed upload counts as past the window → check 16 red",
  "const past = age !== null && age > orphanWindowHours;",
  "const past = age !== null;",
  async () => { await load(); same(build().completion.unclaimedInsideWindow, 1, "inside the window"); }
);

await mutate(
  "M7. a five-year band swallows ten-year careers → check 17 red",
  '{ label: "2–5 years", min: 24, max: 59.999 }',
  '{ label: "2–5 years", min: 24, max: 88 }',
  async () => {
    await load();
    same(
      build().experience.bands.find((band) => band.label === "2–5 years")?.count,
      0,
      "2–5 years"
    );
  }
);

await mutate(
  "M8. the aggregate export drops the form section → check 19 red",
  'add("forms", "adoption_rate_percent", f.applications.adoptionRate);',
  "",
  async () => {
    const source = read("src/modules/analytics/domain/documents.ts");
    assert(source.includes('add("forms", "adoption_rate_percent"'), "adoption in the summary");
  },
  "src/modules/analytics/domain/documents.ts"
);

await mutate(
  "M9. experience is printed as a score → check 20 red",
  '{ header: "Total experience", value: (row) => row.total_experience }',
  '{ header: "Experience score", value: (row) => row.total_experience }',
  async () => {
    const source = read("src/modules/analytics/domain/documents.ts");
    const body = functionBody(source, "export function profileSheet");
    assert(!/score|verdict|rating/i.test(body), "no score word in the profile sheet");
  },
  "src/modules/analytics/domain/documents.ts"
);

await mutate(
  "M4. the dashboard counts unlinked uploads as form files → check 14 red",
  '.not("application_id", "is", null)',
  "",
  async () => {
    const source = read("src/app/(admin)/dashboard/actions.ts");
    assert(source.includes('.not("application_id", "is", null)'), "unlinked uploads excluded");
  },
  "src/app/(admin)/dashboard/actions.ts"
);

/* -------------------------------------------------------------------------- */
/* Verdict                                                                     */
/* -------------------------------------------------------------------------- */

const passed = results.filter((entry) => entry.pass).length;
const held = mutations.filter((entry) => entry.pass).length;
console.log(`${passed} checks passed`);
for (const failure of results.filter((entry) => !entry.pass)) {
  console.log(`FAIL ${failure.name} — ${failure.detail}`);
}
console.log(`${held}/${mutations.length} mutation proofs held`);
for (const failure of mutations.filter((entry) => !entry.pass)) {
  console.log(`FAIL ${failure.label} — ${failure.detail}`);
}

if (passed !== results.length || held !== mutations.length) process.exitCode = 1;
