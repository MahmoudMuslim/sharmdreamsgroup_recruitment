/* scripts/prove-positions.mjs
 * Run: node --experimental-strip-types scripts/prove-positions.mjs
 *
 * #254 lets a new opening inherit its copy from a position definition, and
 * `db/migrations/026_positions.sql` is now applied to the local self-hosted
 * database. This proof still runs without a database, because what it pins is the
 * part that decides what an opening says and what the portal promises — and that
 * part has to keep deciding it the same way on a database where 026 has not been
 * run:
 *
 *   1. precedence — a supplied field wins, a blank one comes from the position;
 *   2. the Settings/chat answer for an uncreated list — "not created", not "empty";
 *   3. the authored DDL — table, opening link, RLS, cache reload, all present;
 *   4. the wiring markers — the picker, the conditional insert, the cross-company
 *      refusal and the assistant's `create_job` path;
 *   5. the edit trail's diff — which columns the diff reads, what an unread
 *      column and a reworded requirement look like to each comparison pass, and
 *      where a position's own trail row points the reader back to (#482).
 *
 * (3), (4) and the source half of (5) are text assertions, deliberately: the SQL is
 * reviewed, never run here, and the UI needs a browser. They catch the file being
 * edited apart, not a runtime that was misconfigured. Whether 026 is applied to any
 * given database is a fact about that database, not about this tree, and is checked
 * there.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  POSITION_TEMPLATE_COLUMNS,
  inheritedFrom,
  supplied,
} from "../src/modules/jobs/domain/positionInheritance.ts";
import {
  MASTER_LIST_ORDER,
  UNAPPLIED_MASTER_LIST,
  masterListCounts,
  masterListNote,
  projectMasterRow,
} from "../src/modules/settings/domain/masterDataLists.ts";
import { resolveFiling } from "../src/modules/settings/domain/masterDataFiling.ts";
import {
  changePhrase,
  printableValue,
  recordHref,
  scalarEdits,
} from "../src/modules/activity/domain/trail.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. supplied() — what counts as "the caller said something"
// ---------------------------------------------------------------------------
for (const [value, want, label] of [
  ["", false, "empty string"],
  ["   ", false, "whitespace only"],
  ["\n\t", false, "newlines and tabs"],
  [null, false, "null"],
  [undefined, false, "undefined"],
  ["x", true, "one character"],
  ["  x  ", true, "padded character"],
]) {
  check(`supplied(${label}) is ${want}`, supplied(value) === want, `got ${supplied(value)}`);
}

// ---------------------------------------------------------------------------
// 2. inheritedFrom() — the precedence rule the action and the chat share
// ---------------------------------------------------------------------------
const position = {
  id: "pos-front-desk",
  tenant_id: "company-a",
  title: "Front Desk Agent",
  department: "Front Office",
  responsibilities: "Welcome guests and run the desk.",
  requirements: ["Hospitality experience", "Fluent English"],
  min_salary_usd: 450,
  max_salary_usd: 600,
  salary_currency: "USD",
  is_active: true,
};

const blank = {
  position_id: "pos-front-desk",
  title: "",
  tenant_id: "",
  department: "",
  sector: "",
  location: "Sharm El Sheikh",
  employment_type: "FULL_TIME",
  description: "",
  requirements: [],
  min_salary_usd: "",
  max_salary_usd: "",
  salary_currency: "",
  status: "DRAFT",
};

const filled = inheritedFrom(blank, position);
check("a blank create inherits the title", filled.title === "Front Desk Agent", filled.title);
check("a blank create inherits the company", filled.tenant_id === "company-a", filled.tenant_id);
check("a blank create inherits the department", filled.department === "Front Office", filled.department);
check(
  "a blank create inherits responsibilities as its description",
  filled.description === "Welcome guests and run the desk.",
  filled.description
);
check(
  "a blank create inherits the requirements",
  same(filled.requirements, ["Hospitality experience", "Fluent English"]),
  JSON.stringify(filled.requirements)
);
check("a blank create inherits the salary floor as text", filled.min_salary_usd === "450", filled.min_salary_usd);
check("a blank create inherits the salary ceiling as text", filled.max_salary_usd === "600", filled.max_salary_usd);
check("a blank create inherits the currency", filled.salary_currency === "USD", filled.salary_currency);

check("the location is the intake's, not the position's", filled.location === "Sharm El Sheikh", filled.location);
check("the employment type is the intake's", filled.employment_type === "FULL_TIME", filled.employment_type);
check("the status is the intake's", filled.status === "DRAFT", filled.status);
check("the position link survives inheritance", filled.position_id === "pos-front-desk", filled.position_id);
check("inheritance does not invent a sector", filled.sector === "", filled.sector);
check("the draft is not mutated", blank.title === "" && blank.requirements.length === 0, blank.title);

const reworded = {
  ...blank,
  title: "Senior Front Desk Agent",
  tenant_id: "company-a",
  department: "Rooms",
  description: "Own the desk and the night audit.",
  requirements: ["Night shift"],
  min_salary_usd: "500",
  max_salary_usd: "700",
  salary_currency: "EGP",
};
const kept = inheritedFrom(reworded, position);
check("a supplied title wins", kept.title === "Senior Front Desk Agent", kept.title);
check("a supplied department wins", kept.department === "Rooms", kept.department);
check("a supplied description wins", kept.description === "Own the desk and the night audit.", kept.description);
check("supplied requirements win", same(kept.requirements, ["Night shift"]), JSON.stringify(kept.requirements));
check("a supplied salary floor wins", kept.min_salary_usd === "500", kept.min_salary_usd);
check("a supplied salary ceiling wins", kept.max_salary_usd === "700", kept.max_salary_usd);
check("a supplied currency wins", kept.salary_currency === "EGP", kept.salary_currency);

const padded = inheritedFrom({ ...blank, title: "   " }, position);
check("a whitespace-only title inherits rather than saving blanks", padded.title === "Front Desk Agent", padded.title);

const groupWide = {
  ...position,
  tenant_id: null,
  responsibilities: null,
  requirements: null,
  min_salary_usd: null,
  max_salary_usd: null,
};
const fromGroupWide = inheritedFrom(blank, groupWide);
check("a group-wide position leaves the company blank", fromGroupWide.tenant_id === "", fromGroupWide.tenant_id);
check("a position without prose leaves the description blank", fromGroupWide.description === "", fromGroupWide.description);
check("a position without entries leaves requirements empty", same(fromGroupWide.requirements, []), JSON.stringify(fromGroupWide.requirements));
check("a missing salary floor reads as no figure", fromGroupWide.min_salary_usd === "", fromGroupWide.min_salary_usd);
check("a missing salary ceiling reads as no figure", fromGroupWide.max_salary_usd === "", fromGroupWide.max_salary_usd);

const decimals = inheritedFrom(blank, { ...position, min_salary_usd: 450.5, max_salary_usd: 0 });
check("a fractional floor keeps its decimals", decimals.min_salary_usd === "450.5", decimals.min_salary_usd);
check("a zero ceiling is a figure, not a blank", decimals.max_salary_usd === "0", decimals.max_salary_usd);

// The select string and the type must name one set: a column added to the type
// and missed here would come back `undefined` for every opening.
const readColumns = POSITION_TEMPLATE_COLUMNS.split(",").map((column) => column.trim()).sort();
const declaredColumns = [
  "id",
  "tenant_id",
  "title",
  "department",
  "responsibilities",
  "requirements",
  "min_salary_usd",
  "max_salary_usd",
  "salary_currency",
  "is_active",
].sort();
check(
  "POSITION_TEMPLATE_COLUMNS names exactly the inherited row",
  same(readColumns, declaredColumns),
  readColumns.join(", ")
);

// ---------------------------------------------------------------------------
// 3. What Settings and the chat say while 026 is unapplied
// ---------------------------------------------------------------------------
check(
  "the seven lists keep the dock's order",
  same(MASTER_LIST_ORDER, [
    "companies",
    "departments",
    "locations",
    "role_families",
    "positions",
    "skills",
    "currencies",
  ]),
  MASTER_LIST_ORDER.join(", ")
);
check(
  "the unapplied list names its migration",
  UNAPPLIED_MASTER_LIST.positions === "db/migrations/026_positions.sql",
  UNAPPLIED_MASTER_LIST.positions
);

const unavailableBundle = {
  companies: [{ id: "c1", name: "Company A" }],
  departments: [{ id: "d1", name: "Front Office" }],
  locations: [],
  roleFamilies: [],
  positions: [],
  positionsAvailable: false,
  skills: [],
  currencies: [],
};
const unavailableCounts = masterListCounts(unavailableBundle);
check(
  "an uncreated positions table is left out of the counts",
  !("positions" in unavailableCounts),
  JSON.stringify(unavailableCounts)
);
check(
  "the other six lists are still counted",
  unavailableCounts.companies === 1 && unavailableCounts.departments === 1,
  JSON.stringify(unavailableCounts)
);

const availableCounts = masterListCounts({ ...unavailableBundle, positionsAvailable: true });
check("a created but empty positions table counts as zero", availableCounts.positions === 0, String(availableCounts.positions));

const missingNote = masterListNote({
  entity: "positions",
  rows: [],
  counts: unavailableCounts,
  unavailable: true,
});
check("the missing table is called not created", /has not been created/.test(missingNote), missingNote);
check("the missing table names 026", /db\/migrations\/026_positions\.sql/.test(missingNote));
check("the missing table says the file is authored but not applied", /authored but not applied/.test(missingNote));
check("the missing table is explicitly not an empty list", /not an empty list/.test(missingNote));
check("the missing table is not called empty", !/list is empty/.test(missingNote), missingNote);
check(
  "the missing-table note does not offer a retry",
  !/try again|retry/i.test(missingNote),
  missingNote
);

const emptyNote = masterListNote({ entity: "positions", rows: [], counts: availableCounts });
check("a created but empty list is called empty", /list is empty/.test(emptyNote), emptyNote);
check("an empty list names its write door", /save_master_record/.test(emptyNote));

const otherNote = masterListNote({ entity: "companies", rows: unavailableBundle.companies, counts: unavailableCounts });
check("another list's note does not call positions zero", !/positions \(0\)/.test(otherNote), otherNote);
check(
  "a note never leaks a null into the sentence",
  [missingNote, emptyNote, otherNote].every((note) => !/\bnull\b/.test(note)),
  otherNote
);

const positionRow = {
  id: "pos-1",
  tenant_id: null,
  title: "Front Desk Agent",
  department: "Front Office",
  grade: "G5",
  responsibilities: "Welcome guests.",
  requirements: ["Fluent English"],
  min_salary_usd: 450,
  max_salary_usd: 600,
  salary_currency: "USD",
  is_active: true,
};
const projected = projectMasterRow("positions", positionRow);
check(
  "the chat's position row carries the whole definition",
  same(Object.keys(projected).sort(), [
    "department",
    "grade",
    "id",
    "is_active",
    "max_salary_usd",
    "min_salary_usd",
    "requirements",
    "responsibilities",
    "salary_currency",
    "tenant_id",
    "title",
  ]),
  Object.keys(projected).sort().join(", ")
);
check("the projected row names a group-wide post as null", projected.tenant_id === null);
check(
  "a position with no requirements projects an empty list",
  same(projectMasterRow("positions", { ...positionRow, requirements: null }).requirements, [])
);

// ---------------------------------------------------------------------------
// 4. A position's department and currency resolve like a job filing
// ---------------------------------------------------------------------------
// The migration's own comments promise these two are resolved against the live
// lists "on write". If they were not, a position could be authored off-vocabulary
// and every opening copied from it would be refused by the filing door — so the
// position write door runs the same rule, with the same words a recruiter reads.
const departmentRows = [
  { id: "d1", name: "Front Office", is_active: true },
  { id: "d2", name: "Finance & Investment", is_active: true },
  { id: "d3", name: "Housekeeping", is_active: false },
];
const currencyRows = [
  { id: "c1", code: "USD", label: "USD US Dollar", is_active: true },
  { id: "c2", code: "EGP", label: "EGP Egyptian Pound", is_active: true },
  { id: "c3", code: "SAR", label: "SAR Saudi Riyal", is_active: false },
];

const deptLive = resolveFiling({
  entity: "departments",
  rows: departmentRows,
  submitted: "front office",
});
check(
  "a department is accepted however it is typed, written in the list's spelling",
  deptLive.ok && deptLive.name === "Front Office",
  deptLive.ok ? deptLive.name : deptLive.error
);

const deptOffList = resolveFiling({
  entity: "departments",
  rows: departmentRows,
  submitted: "Finance",
});
check("a department the list does not hold is refused", !deptOffList.ok, deptOffList.ok ? deptOffList.name : "");
check(
  "the refusal quotes the live departments to choose from",
  !deptOffList.ok && /Front Office, Finance & Investment/.test(deptOffList.error),
  deptOffList.ok ? "" : deptOffList.error
);
check(
  "the refusal names where to file one",
  !deptOffList.ok && /Settings → Organisation/.test(deptOffList.error),
  deptOffList.ok ? "" : deptOffList.error
);

const deptRetired = resolveFiling({
  entity: "departments",
  rows: departmentRows,
  submitted: "Housekeeping",
});
check(
  "a retired department is refused for a new position",
  !deptRetired.ok && /retired/.test(deptRetired.error),
  deptRetired.ok ? deptRetired.name : deptRetired.error
);

const deptStored = resolveFiling({
  entity: "departments",
  rows: departmentRows,
  submitted: "Housekeeping",
  stored: "Housekeeping",
});
check(
  "a row already filed under a retired department keeps it",
  deptStored.ok && deptStored.name === "Housekeeping",
  deptStored.ok ? deptStored.name : deptStored.error
);

const currencyLive = resolveFiling({
  entity: "currencies",
  rows: currencyRows,
  submitted: "egp",
  by: "code",
});
check(
  "a currency is accepted by code and stored as the list spells it",
  currencyLive.ok && currencyLive.name === "EGP",
  currencyLive.ok ? currencyLive.name : currencyLive.error
);

const currencyOffList = resolveFiling({
  entity: "currencies",
  rows: currencyRows,
  submitted: "GBP",
  by: "code",
});
check("a currency the list does not hold is refused", !currencyOffList.ok);
check(
  "the currency refusal says it is not set up and quotes the live codes",
  !currencyOffList.ok && /not set up/.test(currencyOffList.error) && /USD/.test(currencyOffList.error),
  currencyOffList.ok ? "" : currencyOffList.error
);

const currencyStored = resolveFiling({
  entity: "currencies",
  rows: currencyRows,
  submitted: "SAR",
  by: "code",
  stored: "SAR",
});
check(
  "a position already denominated in a retired currency keeps it",
  currencyStored.ok && currencyStored.name === "SAR",
  currencyStored.ok ? currencyStored.name : currencyStored.error
);

// ---------------------------------------------------------------------------
// 5. The migration's DDL (read from the file, never executed here)
// ---------------------------------------------------------------------------
const migration = read("db/migrations/026_positions.sql");
for (const [label, needle] of [
  ["creates the table idempotently", "create table if not exists public.positions ("],
  ["keeps requirements as a bounded array", "requirements text[] not null default '{}'"],
  ["bounds the requirement count", "constraint positions_requirements_check"],
  ["refuses a ceiling under the floor", "max_salary_usd >= min_salary_usd"],
  ["adds the opening link idempotently", "add column if not exists position_id uuid references public.positions (id) on delete set null"],
  ["keeps one title per scope", "positions_global_title_uniq"],
  ["keeps one title per company", "positions_tenant_title_uniq"],
  ["enables row level security", "alter table public.positions enable row level security"],
  ["lets staff read", "create policy positions_read on public.positions"],
  ["gates writes on the settings permission", "create policy positions_write on public.positions"],
  ["checks settings.manage_platform", "has_permission('settings.manage_platform')"],
  ["revokes anon", "revoke all on table public.positions from anon"],
  ["reloads the REST schema", "notify pgrst, 'reload schema';"],
  ["says it is applied and proven locally", "Applied to the local self-hosted database on 2026-10-23 and proven against it:"],
  ["keeps the not-created fallback on the record", 'still treats\n-- a missing table as "not created yet"'],
]) {
  check(`026 ${label}`, migration.includes(needle), needle);
}
check("026 does not claim to be unapplied", !/NOT applied to any database/.test(migration));
check("026 does not seed rows", !/insert into public\.positions/i.test(migration));
check("026 does not add the link as required", !/position_id uuid[^;]*not null/i.test(migration));

// ---------------------------------------------------------------------------
// 6. Wiring markers — the screens and the chat reach the same write path
// ---------------------------------------------------------------------------
function sourceHas(label, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(label, missing.length === 0, missing.length ? `missing ${missing.map((n) => JSON.stringify(n)).join(", ")}` : "");
}

sourceHas("the create action reads a position before validating", "src/app/(admin)/jobs/job-actions.ts", [
  '.from("positions")',
  "POSITION_TEMPLATE_COLUMNS",
  "inheritedFrom(draft, position)",
]);
sourceHas("the create action links an opening only when a position was chosen", "src/app/(admin)/jobs/job-actions.ts", [
  "...(positionId ? { position_id: positionId } : {}),",
]);
sourceHas("the create action refuses a cross-company position", "src/app/(admin)/jobs/job-actions.ts", [
  "is filed under a different company",
]);
sourceHas("the create action names 026 when the column is missing", "src/app/(admin)/jobs/job-actions.ts", [
  "has no position_id column yet",
  "db/migrations/026_positions.sql is authored but not applied",
]);
sourceHas("the drawer offers a create-only position picker", "src/app/(admin)/jobs/JobFormDrawer.tsx", [
  'label="Start from a position"',
  "No position — start from a blank opening",
]);
sourceHas("the drawer says the table is not created", "src/app/(admin)/jobs/JobFormDrawer.tsx", [
  "positionsAvailable === false",
  "Positions have not been created on this database yet.",
  "db/migrations/026_positions.sql",
]);
sourceHas("the jobs page hands the drawer the position list", "src/app/(admin)/jobs/page.tsx", [
  "positions: master.positions",
  "positionsAvailable: master.positionsAvailable",
]);
sourceHas("the settings dock counts positions", "src/modules/settings/domain/settingsNav.ts", [
  'id: "positions"',
  "vacancy copy a new opening starts from",
]);
sourceHas("the settings page does not print a count for an uncreated table", "src/app/(admin)/settings/page.tsx", [
  'if (key === "positions" && !master.positionsAvailable) continue;',
]);
sourceHas("the master-data console says the section is not created", "src/app/(admin)/settings/MasterDataConsole.tsx", [
  'tab === "positions" && !data.positionsAvailable',
]);
sourceHas("the assistant writes positions and says 026 is unapplied", "src/modules/assistant/domain/registry/masterData.ts", [
  "position, skill or currency",
  "026_positions.sql",
]);
sourceHas("the assistant's create_job reaches the same inheritance", "src/modules/assistant/domain/registry/writes.ts", [
  "position_id:",
  "fromPosition: true",
]);
sourceHas("the assistant's job draft accepts the position path", "src/modules/assistant/domain/registry/shared.ts", [
  "fromPosition",
  "position_id",
]);
sourceHas("the assistant's read reports the uncreated list", "src/modules/assistant/domain/registry/reads.ts", [
  'entity === "positions" && bundle.positionsAvailable === false',
]);
sourceHas("the position write door resolves department and currency", "src/modules/settings/application/master-data-actions.ts", [
  "async function resolvePositionCopy(",
  'column: "department", by: "name" as const',
  'column: "salary_currency", by: "code" as const',
  "resolveFiling({",
  "if (result.ok) resolved[column] = result.name;",
]);
sourceHas("a position create refuses to omit its title or department", "src/modules/settings/application/master-data-actions.ts", [
  'if (!shaped.row.title) return { ok: false, error: "A position needs a title." };',
  'if (!shaped.row.department) return { ok: false, error: "A position needs a department." };',
]);
sourceHas("a position write maps a vanished company to a sentence", "src/modules/settings/application/master-data-actions.ts", [
  'error.code === "23503" && entity === "positions"',
  "That company no longer exists — pick another.",
]);
sourceHas("the position pickers offer live rows only", "src/app/(admin)/settings/MasterDataConsole.tsx", [
  ".filter((c) => c.is_active && !c.is_group_profile)",
  "d.departments.filter((x) => x.is_active)",
  "d.currencies.filter((c) => c.is_active)",
]);
sourceHas("the console still shows a value the list has retired", "src/app/(admin)/settings/MasterDataConsole.tsx", [
  'const kept = field.kind === "select"',
  "retired or no longer on the list",
]);

// ---------------------------------------------------------------------------
// 7. What the trail says a position save moved (#482)
// ---------------------------------------------------------------------------
// The position form posts every declared field on every save, and the write door
// compares that patch against the row it read back beforehand. A column missing
// from that read cannot be compared, so `scalarEdits` reports it as a field the save
// set — a recruiter who moved one salary figure and reworded one requirement saved
// and saw three changed fields, two of them columns they never touched.
// The columns for the diff come from the door's own `DIFF_COLUMNS`, so they are read
// out of the source here rather than repeated: a prose column added to the row and
// left out of that read re-opens the hole, and this fails.
const door = read("src/modules/settings/application/master-data-actions.ts");

function declaredBlock(name) {
  const match = new RegExp(`const ${name}[\\s\\S]{0,120}?\\{([\\s\\S]*?)\\n\\};`).exec(door);
  check(`the write door declares ${name}`, Boolean(match), match ? "" : "no such block");
  return match ? match[1] : "";
}

const shortMatch = /positions:\s*\n?\s*"([^"]+)"/.exec(declaredBlock("READ_COLUMNS"));
const extraMatch = /positions:\s*`\$\{READ_COLUMNS\.positions\},([^`]*)`/.exec(
  declaredBlock("DIFF_COLUMNS")
);
const docMatch = /positions:\s*\[([^\]]*)\]/.exec(declaredBlock("DOCUMENT_COLUMNS"));

const shortColumns = shortMatch ? shortMatch[1].split(",").map((c) => c.trim()) : [];
const proseColumns = extraMatch ? extraMatch[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
const documentColumns = docMatch
  ? docMatch[1].split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean)
  : [];

check("the short read names the columns a position is addressed by", same(shortColumns, [
  "title", "tenant_id", "department", "grade", "min_salary_usd", "max_salary_usd",
  "salary_currency", "is_active",
]), shortColumns.join(", "));
check("the diff read adds the prose the form posts", same(proseColumns, ["responsibilities", "requirements"]), proseColumns.join(", "));
check("requirements is compared as a document, not a scalar", same(documentColumns, ["requirements"]), documentColumns.join(", "));

// The row the door reads back, and the patch the form posts against it. The write
// door shapes the salary fields as numbers and the requirements as an array, so the
// patch below is what `updateMasterRecord` actually diffs — including the ceiling,
// which comes back as `6100` against the column's "6100.00".
const prose = {
  responsibilities: "Runs the desk and owns the night handover.",
  requirements: ["3 seasons at a front desk", "Fluent English and Arabic"],
};
const stored = {
  title: "Probe Guest Services Team Lead",
  tenant_id: null,
  department: "Front Office",
  grade: "G5",
  min_salary_usd: "4200.00",
  max_salary_usd: "6100.00",
  salary_currency: "USD",
  is_active: true,
};
const fullRead = { ...stored, ...prose };
// Two fields moved: the floor was retyped, and the first requirement reworded.
const posted = {
  ...stored,
  ...prose,
  min_salary_usd: 4500,
  max_salary_usd: 6100,
  requirements: ["3 seasons at a busy front desk", "Fluent English and Arabic"],
};

const shortBefore = Object.fromEntries(shortColumns.map((c) => [c, stored[c]]));
const blamed = scalarEdits(shortBefore, posted);
check("a column the read skips is blamed on the save", blamed.responsibilities === `set to ${prose.responsibilities}`, blamed.responsibilities);
check("so is the requirements list", blamed.requirements === "set to 2 items", blamed.requirements);
check("the short read reports three changed fields where two moved", changePhrase(blamed) === "changed 3 fields (min_salary_usd, responsibilities, requirements)", changePhrase(blamed));

const scalarPass = Object.fromEntries(Object.entries(posted).filter(([key]) => !documentColumns.includes(key)));
const moved = scalarEdits(fullRead, scalarPass);
check("the diff read leaves nothing to blame", same(Object.keys(moved), ["min_salary_usd"]), Object.keys(moved).join(", "));
check("the retyped floor prints as the move it is", moved.min_salary_usd === "4200.00 → 4500", moved.min_salary_usd);
check("a band posted back as 6100 against 6100.00 is not a change", !("max_salary_usd" in moved), String(moved.max_salary_usd));
check("the untouched prose is not a change", !("responsibilities" in moved), JSON.stringify(moved.responsibilities));

// The document half: a reworded list prints as the same number of items, so the
// scalar pass cannot see it at all. That is why the door compares it on its contents
// and describes it by `listWords`, which names a plain string entry by its words.
check(
  "a reworded requirement is invisible to the words-only compare",
  printableValue(posted.requirements) === printableValue(prose.requirements) &&
    printableValue(posted.requirements) === "2 items",
  `${printableValue(prose.requirements)} vs ${printableValue(posted.requirements)}`
);
sourceHas("the document columns are kept out of the scalar pass", "src/modules/settings/application/master-data-actions.ts", [
  "const docs = DOCUMENT_COLUMNS[entity] ?? [];",
  ".filter(([key]) => !docs.includes(key))",
  "edits[key] = `${listWords(before[key])} → ${listWords(patch[key])}`;",
]);
sourceHas("a plain string entry is named by its own words", "src/modules/settings/application/master-data-actions.ts", [
  'if (typeof item === "string") return item;',
]);
sourceHas("the row for the diff is read through DIFF_COLUMNS", "src/modules/settings/application/master-data-actions.ts", [
  ".select(DIFF_COLUMNS[entity] ?? READ_COLUMNS[entity])",
]);

const trail = { ...moved, requirements: "2 entries (3 seasons at a busy front desk, Fluent English and Arabic)" };
check("the trail a fixed save leaves", changePhrase(trail) === "changed 2 fields (min_salary_usd, requirements)", changePhrase(trail));

// ---------------------------------------------------------------------------
// 8. A position's own trail row points back at the list it changed (#482)
// ---------------------------------------------------------------------------
// The trail console renders a Record link from `recordHref`, and every other
// organisation list has one — a company row lands on Companies, a skill row on
// Skills. A position row had nowhere to go, so the reviewer of a reworded
// requirement could not reach the row they would want to re-read. The section's
// id and label are read out of the nav table rather than repeated here, because
// a link built from a stale id would land on the default section and look right.
const nav = read("src/modules/settings/domain/settingsNav.ts");
const sectionMatch = /id: "positions",\s*\n\s*label: "([^"]+)"/.exec(nav);
check("the dock declares a positions section", Boolean(sectionMatch), sectionMatch ? "" : "no positions section");
check(
  "that section belongs to the organisation area",
  /const ORGANISATION_SECTIONS[\s\S]*?id: "positions"/.test(nav) &&
    /id: "organisation",[\s\S]*?sections: ORGANISATION_SECTIONS,/.test(nav),
  "positions is not under organisation"
);

const positionLink = recordHref("position", "4a45b47f-0000-4000-8000-000000000000");
check(
  "a position trail row links to the positions section",
  positionLink?.href === "/settings?area=organisation&section=positions",
  String(positionLink?.href)
);
check(
  "and labels the link with the dock's own words",
  positionLink?.label === sectionMatch?.[1],
  `${positionLink?.label} vs ${sectionMatch?.[1]}`
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
