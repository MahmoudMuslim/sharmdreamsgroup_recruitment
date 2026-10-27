/* scripts/prove-guide-figures.mjs
 * Run: node --experimental-strip-types scripts/prove-guide-figures.mjs
 *
 * The Guide panel quotes a figure for almost every console in the portal — the rows
 * a screen draws, the ceiling a download carries, the point at which a bulk send or
 * an AI run stops. Each of those numbers is a constant in a source file, so a change
 * to the constant silently turns the manual into a lie: the recruiter reads "the
 * newest 200" while the grid holds 100, and the scope note under the strip is the
 * only thing that would tell them.
 *
 * This fixture reads both sides as text and requires them to agree. It asserts
 * nothing about a runtime — a `server-only` module cannot be imported here — so it
 * catches the two files being edited apart, which is the failure that actually
 * happens. A number that matches by coincidence is not a risk worth a live probe:
 * each figure is captured out of its own sentence, so a reworded sentence fails too
 * and the pair has to be re-pinned on purpose.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

/** The number written in a Guide sentence, with its thousands separators removed. */
function figureFrom(text, pattern, what) {
  const found = text.match(pattern);
  if (!found) return { error: `the Guide no longer says ${what}` };
  return { line: found[0], values: found.slice(1).map((n) => Number(n.replace(/,/g, ""))) };
}

/** A constant or literal in a source file, read as text so server-only files stay unread. */
function sourceValue(rel, pattern) {
  const found = read(rel).match(pattern);
  if (!found) return { error: `${rel} no longer holds ${pattern}` };
  return { value: Number(found[1].replace(/[,_]/g, "")) };
}

const GUIDE = read("src/modules/shell/domain/pageGuide.ts");

/**
 * Each entry: the sentence the manual prints, and the file that decides its length.
 * `want` names the figure for the failure message; the pattern must capture it.
 */
const FIGURES = [
  {
    route: "/dashboard",
    want: "the board's window",
    guide: /The board is the newest ([\d,]+) live applications/,
    sources: [
      {
        rel: "src/app/(admin)/dashboard/board-model.ts",
        pattern: /export const BOARD_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/reports",
    want: "the preview window",
    guide: /The screen draws the newest ([\d,]+) rows and a download/,
    sources: [
      { rel: "src/app/(admin)/reports/actions.ts", pattern: /const PREVIEW_ROWS = ([\d_]+);/ },
    ],
  },
  {
    route: "/time",
    want: "the ledger read",
    guide: /The read is the newest ([\d,]+) entries/,
    sources: [
      {
        rel: "src/modules/timelog/application/ledger.ts",
        pattern: /export const LEDGER_ROW_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/activity",
    want: "the trail window and its ceiling",
    guide: /The screen draws the newest ([\d,]+) matching rows and a download carries up to ([\d,]+)/,
    sources: [
      {
        rel: "src/modules/activity/application/record.ts",
        pattern: /filters\.limit \?\? ([\d_]+)/,
      },
      { rel: "src/modules/activity/application/record.ts", pattern: /const MAX_ROWS = ([\d_]+);/ },
    ],
  },
  {
    route: "/candidates",
    want: "the list window and the rail scan",
    guide: /The list is the newest ([\d,]+) records; the rails count up to the newest ([\d,]+)/,
    sources: [
      {
        rel: "src/modules/candidates/domain/listFilters.ts",
        pattern: /export const CANDIDATE_ROW_LIMIT = ([\d_]+);/,
      },
      {
        rel: "src/modules/candidates/domain/listFilters.ts",
        pattern: /export const CANDIDATE_COUNT_SCAN_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/candidates",
    want: "the bulk send stop",
    guide: /A bulk send stops at ([\d,]+) recipients/,
    sources: [
      {
        rel: "src/app/(admin)/candidates/candidate-actions.ts",
        pattern: /Send to at most ([\d_]+) candidates at a time/,
      },
    ],
  },
  {
    // The cap that decides how many people one click can mail: the dialog reads
    // the same constant it is refused by, so the manual drifts with it.
    route: "/candidates",
    want: "the bulk move stop",
    guide: /A bulk move stops at ([\d,]+) rows/,
    sources: [
      {
        rel: "src/modules/candidates/domain/bulkStage.ts",
        pattern: /export const BULK_STAGE_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    // The deadline the offer desk offers unless the recruiter names another:
    // the manual promises the candidate 7 days, so the default is pinned.
    route: "/candidates",
    want: "the offer deadline default",
    guide: /An offer defaults to ([\d,]+) days/,
    sources: [
      {
        rel: "src/modules/offers/domain/offer.ts",
        pattern: /export const OFFER_DEFAULT_DAYS = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/sourcing",
    want: "the dedupe window",
    guide: /An email match is only skipped when it sits among the newest ([\d,]+) records/,
    sources: [
      { rel: "src/app/(admin)/sourcing/pool-model.ts", pattern: /export const DEDUPE_WINDOW = ([\d_]+);/ },
    ],
  },
  {
    route: "/sourcing",
    want: "the paste cap and the bulk stop",
    guide: /A paste is capped at ([\d,]+) characters and a bulk message at ([\d,]+) recipients/,
    sources: [
      { rel: "src/app/(admin)/sourcing/actions.ts", pattern: /input\.raw\.length > ([\d_]+)/ },
      {
        rel: "src/app/(admin)/sourcing/actions.ts",
        pattern: /Send to at most ([\d_]+) prospects at a time/,
      },
    ],
  },
  {
    route: "/jobs",
    want: "openings per page",
    guide: /— ([\d,]+) openings to a page/,
    sources: [{ rel: "src/lib/paging.ts", pattern: /export const PAGE_ROWS = ([\d_]+);/ }],
  },
  {
    route: "/jobs",
    want: "the grid's held rows",
    guide: /The grid holds the newest ([\d,]+) openings in the browser/,
    sources: [
      { rel: "src/modules/jobs/domain/hireable.ts", pattern: /export const GRID_ROW_LIMIT = ([\d_]+);/ },
    ],
  },
  {
    route: "/jobs",
    want: "the applicants drawer window",
    guide: /the drawer lists the newest ([\d,]+) applicants/,
    sources: [
      {
        rel: "src/app/(admin)/jobs/applicant-actions.ts",
        pattern: /const APPLICANTS_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/assessments",
    want: "the picker window",
    guide: /The opening dropdown holds the newest ([\d,]+) roles/,
    sources: [
      { rel: "src/modules/jobs/domain/hireable.ts", pattern: /export const PICKER_LIMIT = ([\d_]+);/ },
    ],
  },
  {
    route: "/assessments",
    want: "the links board window",
    guide: /The board lists the newest ([\d,]+) links and says how many more are on file/,
    sources: [
      { rel: "src/modules/assessment/domain/issuedLinks.ts", pattern: /export const LINKS_LIMIT = ([\d_]+);/ },
    ],
  },
  {
    route: "/assessments",
    want: "one AI drafting run",
    guide: /One run drafts at most ([\d,]+) questions/,
    sources: [
      {
        rel: "src/modules/assessment/domain/aiAuthoring.ts",
        pattern: /export const MAX_DRAFTS_PER_RUN = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/assessments",
    want: "both item-statistics thresholds",
    guide: /A question needs ([\d,]+) graded answers before a difficulty figure is claimed for it, and the strongest-versus-weakest gap needs ([\d,]+) answers on each side/,
    sources: [
      {
        rel: "src/modules/assessment/domain/itemStats.ts",
        pattern: /export const MIN_ITEM_STATISTICS = ([\d_]+);/,
      },
      { rel: "src/modules/assessment/domain/itemStats.ts", pattern: /const MIN_PER_GROUP = ([\d_]+);/ },
    ],
  },
  {
    route: "/assessments",
    want: "both item-statistics ceilings",
    guide: /The figures cover at most ([\d,]+) graded papers and ([\d,]+) graded answers/,
    sources: [
      {
        rel: "src/modules/assessment/application/templateItemStats.ts",
        pattern: /const PAPER_CEILING = ([\d_]+);/,
      },
      {
        rel: "src/modules/assessment/application/templateItemStats.ts",
        pattern: /const ANSWER_CEILING = ([\d_]+);/,
      },
    ],
  },
  {
    // Not a window or a ceiling: the total a rubric's weights must reach, which
    // the author is refused until they hit. The Guide prints it, the validator
    // compares against it, so the pair drifts the same way a row limit does.
    route: "/assessments",
    want: "the rubric weight total",
    guide: /the weights are shares of that question's marks, so they must add up to ([\d,]+)/,
    sources: [
      {
        rel: "src/modules/assessment/domain/rubric.ts",
        pattern: /export const RUBRIC_WEIGHT_TOTAL = ([\d_]+);/,
      },
    ],
  },
  {
    // The coding caps live in the domain module as constants, so a change
    // there silently turns the Guide's promise about what an answer holds into
    // a lie. Each figure is read out of its own clause.
    route: "/assessments",
    want: "the coding answer cap",
    guide: /A coding answer holds at most ([\d,]+) characters/,
    sources: [
      { rel: "src/modules/assessment/domain/coding.ts", pattern: /export const CODE_ANSWER_CAP = ([\d_]+);/ },
    ],
  },
  {
    route: "/assessments",
    want: "the coding starter cap",
    guide: /starter is optional and holds at most ([\d,]+) characters/,
    sources: [
      { rel: "src/modules/assessment/domain/coding.ts", pattern: /export const CODE_STARTER_CAP = ([\d_]+);/ },
    ],
  },
  {
    route: "/jobs",
    want: "the requisition's skill ceiling",
    guide: /A requisition lists at most ([\d,]+) skills/,
    sources: [
      {
        rel: "src/modules/jobs/domain/openingSkills.ts",
        pattern: /export const MAX_REQUIRED_SKILLS = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/interviews",
    want: "the panel-note body cap",
    guide: /A note is capped at ([\d,]+) characters/,
    sources: [
      {
        rel: "src/modules/interviews/domain/interviewNotes.ts",
        pattern: /export const NOTES_BODY_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/files",
    want: "a folder's listing",
    guide: /A folder lists its first ([\d,]+) items/,
    sources: [
      { rel: "src/app/(admin)/files/storage-list.ts", pattern: /export const LIST_LIMIT = ([\d_]+);/ },
    ],
  },
  {
    route: "/whatsapp",
    want: "the queue window and the log window",
    guide: /The queue holds the newest ([\d,]+) jobs and the log the newest ([\d,]+) rows/,
    sources: [
      {
        rel: "src/app/(admin)/whatsapp/outbox-model.ts",
        pattern: /export const QUEUE_PAGE_LIMIT = ([\d_]+);/,
      },
      {
        rel: "src/app/(admin)/whatsapp/outbox-model.ts",
        pattern: /export const LOG_PAGE_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/assistant",
    want: "the conversation window",
    guide: /as far back as the ([\d,]+) turns it reads/,
    sources: [
      { rel: "src/app/(admin)/assistant/actions.ts", pattern: /const MAX_HISTORY = ([\d_]+);/ },
    ],
  },
  {
    route: "/referrals",
    want: "the hand-entry note",
    guide: /an optional note of up to ([\d,]+) characters/,
    sources: [
      {
        rel: "src/modules/referrals/domain/referral.ts",
        pattern: /export const REFERRAL_NOTE_MAX = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/referrals",
    want: "the bonus note",
    guide: /with a note of up to ([\d,]+) characters/,
    sources: [
      {
        rel: "src/modules/referrals/domain/referral.ts",
        pattern: /export const REFERRAL_BONUS_NOTE_MAX = ([\d_]+);/,
      },
    ],
  },
  {
    route: "/referrals",
    want: "the book's read",
    guide: /The read is the newest ([\d,]+) claims/,
    sources: [
      {
        rel: "src/modules/referrals/domain/referral.ts",
        pattern: /export const REFERRAL_READ_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    // Both halves of the desk's read are the one limit, so the sentence names it
    // twice and both names are checked against the constant that decides them.
    route: "/retention",
    want: "the desk's two reads",
    guide: /The read is the ([\d,]+) oldest applications and the newest ([\d,]+) requests/,
    sources: [
      {
        rel: "src/modules/privacy/domain/privacy.ts",
        pattern: /export const PRIVACY_READ_LIMIT = ([\d_]+);/,
      },
      {
        rel: "src/modules/privacy/domain/privacy.ts",
        pattern: /export const PRIVACY_READ_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    // The board's two ceilings: the forms it lists and the openings it offers the
    // assign picker, each read off the constant its own query passes to `.limit`.
    route: "/forms",
    want: "the board's two ceilings",
    guide: /The board reads at most ([\d,]+) forms and ([\d,]+) openings/,
    sources: [
      {
        rel: "src/modules/form-builder/application/formActions.ts",
        pattern: /const FORM_LIST_LIMIT = ([\d_]+);/,
      },
      {
        rel: "src/modules/form-builder/application/formActions.ts",
        pattern: /const JOB_LIST_LIMIT = ([\d_]+);/,
      },
    ],
  },
  {
    // The form page's Applications figure: without migration 045 it is a floor over a
    // bounded read, and the window that bounds it is the form builder's own constant.
    route: "/forms",
    want: "the usage tally's window",
    guide: /the figure comes from the newest ([\d,]+) applications/,
    sources: [
      {
        rel: "src/modules/form-builder/domain/formUsage.ts",
        pattern: /export const USAGE_APPLICATIONS = ([\d_]+);/,
      },
    ],
  },
];

for (const figure of FIGURES) {
  const said = figureFrom(GUIDE, figure.guide, figure.want);
  if (said.error) {
    check(`${figure.route}: ${figure.want}`, false, said.error);
    continue;
  }

  const pairs = figure.sources.map((source, index) => {
    const fromSource = sourceValue(source.rel, source.pattern);
    return { source, index, fromSource };
  });

  const wrong = [];
  for (const pair of pairs) {
    if (pair.fromSource.error) {
      wrong.push(`${pair.source.rel}: ${pair.fromSource.error}`);
      continue;
    }
    if (pair.fromSource.value !== said.values[pair.index]) {
      wrong.push(
        `the Guide says ${said.values[pair.index]}, ${pair.source.rel} says ${pair.fromSource.value}`
      );
    }
  }

  check(
    `${figure.route}: ${figure.want} agrees with its source`,
    wrong.length === 0,
    wrong.join("; ") || `both read ${said.values.join(" and ")}`
  );
}

// ---------------------------------------------------------------------------
// The tripwire: a quoted figure the table above does not pin
// ---------------------------------------------------------------------------
const COUNTED =
  /(?:\b(?:newest|at most|up to|capped at|stops at|first|older)\s+\d[\d,]*)|(?:\d[\d,]*\s+(?:openings to a page|graded (?:papers|answers)|recipients|rows|items|turns|questions|records|applications|links|entries))/;

const countedLines = GUIDE.split("\n").filter((line) => COUNTED.test(line));
const unpinned = countedLines.filter(
  (line) => !FIGURES.some((figure) => figure.guide.test(line))
);

check(
  "every counted sentence in the Guide is pinned above",
  unpinned.length === 0,
  unpinned.length
    ? `${unpinned.length} unpinned: ${unpinned.map((line) => line.trim().slice(0, 90)).join(" ~~ ")}`
    : `${countedLines.length} counted sentences, ${FIGURES.length} pinned pairs`
);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exitCode = 1;
