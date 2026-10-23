/* scripts/prove-hiring-demand.mjs
 * Run: node --experimental-strip-types scripts/prove-hiring-demand.mjs
 *
 * #255 put a hiring-demand line on every opening card — the headcount target, who
 * sits in the pipeline now, who is hired — and it ships ahead of its column:
 * `positions_needed` arrives with db/migrations/031_job_headcount.sql, which is
 * authored but NOT applied on this database (checked against the live schema: the
 * column is absent, so the grid reads `unavailable` on every page load today).
 * That arrangement is only honest while three things stay true, and until now none
 * of them were pinned anywhere:
 *
 *   1. the words a card prints — a target that does not exist is said as "no target
 *      set", never as a role that wants zero people, and the two counts stay named
 *      as populations at an instant;
 *   2. the split itself — the in-pipeline set is every stage the database's own enum
 *      holds except the two terminal ones, so a fifth active stage added to the
 *      enum cannot silently drop a live person out of both counts;
 *   3. the blast radius of the missing column — the target is read apart from the
 *      grid's own row read, so its absence costs one figure, not the page.
 *
 * (1) and (2) run for real against the pure domain module. (3) and the copy the
 * Guide, the grid note and the chat carry are text assertions: they exist to catch
 * the files being edited apart, not to prove a runtime.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HIRED_STAGE,
  IN_PIPELINE_STAGES,
  demandLine,
  demandUnavailableNote,
  seatsStillToFill,
} from "../src/modules/jobs/domain/hiringDemand.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. demandLine — what a card actually prints
// ---------------------------------------------------------------------------
check(
  "a recorded target leads with the gap",
  demandLine({ needed: 5, inPipeline: 4, hired: 2 }) ===
    "needs 5 · 4 in pipeline · 2 hired · 3 still to fill",
  demandLine({ needed: 5, inPipeline: 4, hired: 2 })
);
check(
  "a full role reads target met, not 0 still to fill",
  demandLine({ needed: 3, inPipeline: 2, hired: 3 }) ===
    "needs 3 · 2 in pipeline · 3 hired · target met",
  demandLine({ needed: 3, inPipeline: 2, hired: 3 })
);
check(
  "no recorded target says so in its own words",
  demandLine({ needed: null, inPipeline: 4, hired: 2 }) ===
    "4 in pipeline · 2 hired · no target set",
  demandLine({ needed: null, inPipeline: 4, hired: 2 })
);

// The claim the whole slice rests on: an absent target is a fact about the column,
// and a card that said "needs 0" would tell a recruiter someone asked for nobody.
const nullLine = demandLine({ needed: null, inPipeline: 1, hired: 0 });
check("a missing target never prints a needs-figure", !nullLine.includes("needs"), nullLine);
check("a missing target never claims the role is full", !nullLine.includes("target met"), nullLine);
check("seatsStillToFill(null) stays null instead of becoming zero", seatsStillToFill({ needed: null, inPipeline: 0, hired: 9 }) === null);
check("an over-hired role floors at zero rather than a negative gap", seatsStillToFill({ needed: 2, inPipeline: 0, hired: 5 }) === 0);

// ---------------------------------------------------------------------------
// 2. The stage split, against the database's own enum
// ---------------------------------------------------------------------------
const schema = read("db/schema.sql");
const enumMatch = /create\s+type\s+public\.application_stage\s+as\s+enum\s*\(([^)]*)\)/i.exec(schema);
const stages = enumMatch ? enumMatch[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")) : [];

check("the schema of record declares application_stage", Boolean(enumMatch), stages.join(", "));
check(
  "in-pipeline is every stage but the two terminal ones",
  enumMatch &&
    JSON.stringify([...stages].filter((s) => s !== "HIRED" && s !== "REJECTED").sort()) ===
      JSON.stringify([...IN_PIPELINE_STAGES].sort()),
  `enum: ${stages.join(",")} · module: ${IN_PIPELINE_STAGES.join(",")}`
);
check("HIRED is the one stage that fills a seat", HIRED_STAGE === "HIRED");
check("a hire is never counted as still in the pipeline", !IN_PIPELINE_STAGES.includes(HIRED_STAGE));
check("a rejection is never counted as still in the pipeline", !IN_PIPELINE_STAGES.includes("REJECTED"));

// ---------------------------------------------------------------------------
// 3. The missing column costs the target, not the page
// ---------------------------------------------------------------------------
const reader = read("src/modules/jobs/application/hiringDemand.ts");
check(
  "the target is read in its own query",
  reader.includes('.select("id, positions_needed")'),
  "the grid's projection must stay free of the column"
);
check(
  "a failed target read reports itself instead of an empty map",
  /if \(error\) return \{ neededById: new Map\(\), unavailable: true \};/.test(reader),
  ""
);

const gridPage = read("src/app/(admin)/jobs/page.tsx");
const gridSelect = /"id, title,[^"]*"/.exec(gridPage)?.[0] ?? "";
check("the grid's own row read names no headcount column", !gridSelect.includes("positions_needed"), gridSelect.slice(0, 60));
check(
  "the grid splits the same applications three ways",
  gridSelect.includes("applicants:applications(count)") &&
    gridSelect.includes("pipeline:applications(count)") &&
    gridSelect.includes("hired:applications(count)")
);
check(
  "an archived person is in neither count",
  gridPage.includes('.is("applicants.archived_at", null)') &&
    gridPage.includes('.is("pipeline.archived_at", null)') &&
    gridPage.includes('.is("hired.archived_at", null)')
);
check(
  "the page hands the grid both the figures and the fact they could not be had",
  gridPage.includes("headcountUnavailable={headcount.unavailable}") &&
    gridPage.includes("positions_needed: headcount.neededById.get(row.id) ?? null")
);

// ---------------------------------------------------------------------------
// 4. The copy a recruiter reads when the target is not there
// ---------------------------------------------------------------------------
const note = demandUnavailableNote();
check("the grid note names db/migrations/031_job_headcount.sql", note.includes("db/migrations/031_job_headcount.sql"), note);
check(
  "and keeps the cause conditional — the read can also be refused",
  /on a database where[\s\S]*has not been run/.test(note) && note.includes("could not be read")
);
check("the note still says what is being shown", note.includes("only the pipeline and hire counts are shown"), note);

const guide = read("src/modules/shell/domain/pageGuide.ts");
const jobsEntry = (() => {
  const start = guide.indexOf('"/jobs": {');
  const end = guide.indexOf('"/questions": {');
  return start >= 0 && end > start ? guide.slice(start, end) : "";
})();
check("the Guide's /jobs entry is found", jobsEntry.length > 200, `${jobsEntry.length} chars`);
check("the Guide describes the demand line on the card", /hiring-demand line/.test(jobsEntry));
check("the Guide names 031 as the target's own migration", jobsEntry.includes("db/migrations/031_job_headcount.sql"));
check(
  "and says the counts that need no migration",
  /pipeline and hired counts need no migration/.test(jobsEntry)
);

const chatReads = read("src/modules/assistant/domain/registry/reads.ts");
const listJobs = /"Job openings newest first[^"]*"/.exec(chatReads)?.[0] ?? "";
check("the chat's list_jobs is found", listJobs.length > 200, `${listJobs.length} chars`);
check(
  "and the chat claims no headcount target of its own",
  /no headcount target is claimed here/.test(listJobs),
  "the grid reads it in a separate query; the tool result does not carry it"
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
