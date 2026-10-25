/* scripts/prove-bulk-stage-actions.mjs
 * Run: node --experimental-strip-types scripts/prove-bulk-stage-actions.mjs
 *
 * Bulk stage moves. The rule that makes this feature dangerous is not the write —
 * `updateApplicationStage` already does one row honestly — it is that a stage move
 * fans out `notifyStageChange`, so forty selected rows mean forty real emails and
 * forty real WhatsApp messages. Everything here is pinned around that fact:
 *
 *   1. the notice is OFF unless the recruiter opts in, and the opt-in is only
 *      honoured when it arrives as a literal `true`;
 *   2. the checkbox names the count, and the note beside it names the channels;
 *   3. one click is not a migration — a size cap, a deduped selection, a closed
 *      stage vocabulary and the single-row reason rule, all refused *before* the
 *      first write;
 *   4. every row reports its own outcome, because a batch that "succeeded" while
 *      eleven rows failed is a lie a recruiter then acts on;
 *   5. the assistant has no private route — its bulk tool is the same action over
 *      the same plan, it defaults `notify` to false, and it is not on the
 *      exception list, so a chat-driven batch waits for the approval card too.
 *
 * The plan and the summary are pure, so they are run here. The action, the board
 * and the chat's registry are pinned as text: the runtime rules belong to the
 * live stack proof.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The module under test imports the stage vocabulary through an extensionless
// sibling path, which plain Node does not resolve, so this process learns the
// bundler's mapping before the dynamic import below runs.
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

const {
  BULK_STAGE_LIMIT,
  MISSING_ROW_ERROR,
  bulkStageFailureLines,
  bulkStageNoticeLabel,
  bulkStageNoticeNote,
  bulkStageSummaryMessage,
  planBulkStageMove,
  summarizeBulkStageMoves,
} = await import(pathToFileURL(path.join(root, "src/modules/candidates/domain/bulkStage.ts")).href);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

const ids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const plan = (input) => planBulkStageMove({ applicationIds: ids(3), stage: "INTERVIEW", ...input });

// ---------------------------------------------------------------------------
// 1. The notice is off unless somebody asks for it
// ---------------------------------------------------------------------------
check(
  "no notification goes out unless the recruiter opts in",
  plan({}).notify === false,
  JSON.stringify(plan({}))
);
check(
  "an explicit false keeps the notice off",
  plan({ notify: false }).notify === false
);
check(
  "a literal true is the only thing that turns the notice on",
  plan({ notify: true }).notify === true
);
check(
  "anything else a client sends is read as no notice",
  ["1", "true", "yes", 1, null, undefined, {}]
    .map((value) => plan({ notify: value }))
    .every((p) => p.ok === true && p.notify === false),
  JSON.stringify(["1", "true", "yes", 1, null, undefined, {}].map((v) => plan({ notify: v }).notify))
);
check(
  "the opt-in is carried in the plan, not re-derived from the stage",
  plan({ stage: "REJECTED", reason: "No role open", notify: true }).notify === true
);

// ---------------------------------------------------------------------------
// 2. The checkbox says what it is switching on
// ---------------------------------------------------------------------------
check(
  "the opt-in label names how many candidates will be mailed",
  bulkStageNoticeLabel(40) === "Send the stage notice to all 40 candidates",
  bulkStageNoticeLabel(40)
);
check(
  "the label counts one candidate as one candidate",
  bulkStageNoticeLabel(1) === "Send the stage notice to this candidate",
  bulkStageNoticeLabel(1)
);
check(
  "the note names the channels the notice uses",
  /email/i.test(bulkStageNoticeNote(40)) && /WhatsApp/.test(bulkStageNoticeNote(40)),
  bulkStageNoticeNote(40)
);
check(
  "the note points at the settings screen that decides them",
  /notifications/i.test(bulkStageNoticeNote(40)),
  bulkStageNoticeNote(40)
);

// ---------------------------------------------------------------------------
// 3. Refusals, all of them before the first write
// ---------------------------------------------------------------------------
{
  const over = plan({ applicationIds: ids(BULK_STAGE_LIMIT + 1) });
  check("a selection past the cap is refused", over.ok === false, JSON.stringify(over));
  check(
    "the refusal names the cap the way the constant reads it",
    String(over.error ?? "").includes(String(BULK_STAGE_LIMIT)),
    String(over.error)
  );
  check(
    "the cap is one click's work, not a migration",
    BULK_STAGE_LIMIT === 50,
    String(BULK_STAGE_LIMIT)
  );
  check(
    "a selection exactly at the cap is allowed",
    plan({ applicationIds: ids(BULK_STAGE_LIMIT) }).ok === true
  );
}
{
  const empty = planBulkStageMove({ applicationIds: [], stage: "INTERVIEW" });
  check("an empty selection is refused", empty.ok === false, JSON.stringify(empty));
  check(
    "the empty selection uses the words the bulk messages already use",
    empty.error === "Select at least one candidate.",
    String(empty.error)
  );
}
{
  const dupes = plan({ applicationIds: [...ids(2), ...ids(2), ""] });
  check(
    "the same row ticked twice is moved once",
    dupes.ok === true && dupes.ids.length === 2,
    JSON.stringify(dupes)
  );
  check(
    "a blank id is dropped rather than sent to the database",
    plan({ applicationIds: [...ids(3), "", "   ", 42] }).ids?.length === 3
  );
  check(
    "a deduped set is what the cap is measured against",
    plan({ applicationIds: ids(30).concat(ids(30)) }).ok === true
  );
}
{
  const unknown = plan({ stage: "MAYBE_NEXT_WEEK" });
  check("an unknown stage is refused", unknown.ok === false, JSON.stringify(unknown));
  check(
    "the unknown stage uses the single-row refusal",
    unknown.error === "Unknown pipeline stage.",
    String(unknown.error)
  );
}
{
  const noReason = plan({ stage: "REJECTED" });
  check("a bulk rejection without a reason is refused", noReason.ok === false, JSON.stringify(noReason));
  check(
    "a bulk rejection with a short reason is refused too",
    plan({ stage: "REJECTED", reason: "   nah " }).ok === false
  );
  check(
    "the reason refusal is the single row's sentence, not a new one",
    noReason.error === "Add a short rejection reason — it is shown on the candidate's profile.",
    String(noReason.error)
  );
  check(
    "any other stage needs no reason",
    plan({ stage: "ASSESSMENT" }).ok === true && plan({ stage: "HIRED" }).ok === true
  );
  check(
    "a reason typed for a non-rejection is trimmed away, not stored",
    plan({ stage: "INTERVIEW", reason: "  ignored  " }).reason === null,
    String(plan({ stage: "INTERVIEW", reason: "  ignored  " }).reason)
  );
  check(
    "a bulk rejection carries the one reason the rows share",
    plan({ stage: "REJECTED", reason: "  role filled  " }).reason === "role filled"
  );
}

// ---------------------------------------------------------------------------
// 4. Every row reports its own outcome
// ---------------------------------------------------------------------------
{
  const outcomes = [
    ...ids(29).map((id) => ({ id, name: "Moved", ok: true })),
    ...ids(11).map((id) => ({ id, name: "Stuck", ok: false, error: "Row-level security refused the write" })),
  ];
  const summary = summarizeBulkStageMoves(outcomes);
  check("the moved rows are counted", summary.moved === 29, String(summary.moved));
  check(
    "the failed rows are counted too",
    summary.failed === 11,
    String(summary.failed)
  );
  check(
    "nothing in the plan is unaccounted for",
    summary.moved + summary.failed === summary.total && summary.total === 40,
    JSON.stringify({ moved: summary.moved, failed: summary.failed, total: summary.total })
  );
  check(
    "a partly failed batch is never summarised as a clean move",
    /11/.test(bulkStageSummaryMessage(summary, "INTERVIEW")) &&
      /not moved/.test(bulkStageSummaryMessage(summary, "INTERVIEW")),
    bulkStageSummaryMessage(summary, "INTERVIEW")
  );
  check(
    "the summary names the destination in the words the board uses",
    /Interview/.test(bulkStageSummaryMessage(summary, "INTERVIEW")),
    bulkStageSummaryMessage(summary, "INTERVIEW")
  );
  const lines = bulkStageFailureLines(summary);
  check(
    "each failure is listed with the reason the database gave",
    lines.length === 11 && lines.every((line) => /security/.test(line)),
    lines[0] ?? ""
  );
  check(
    "a failure without a reason still says something",
    bulkStageFailureLines(summarizeBulkStageMoves([{ id: ids(1)[0], name: "Nobody", ok: false, error: null }]))
      .join("")
      .trim().length > 0,
    JSON.stringify(bulkStageFailureLines(summarizeBulkStageMoves([{ id: ids(1)[0], name: "Nobody", ok: false, error: null }])))
  );
}
{
  const all = summarizeBulkStageMoves(ids(3).map((id) => ({ id, name: "Moved", ok: true })));
  check(
    "a clean batch says only what moved",
    bulkStageSummaryMessage(all, "AI_SCREENING") === "3 candidates moved to AI screening.",
    bulkStageSummaryMessage(all, "AI_SCREENING")
  );
  check(
    "a clean batch lists no failures",
    bulkStageFailureLines(all).length === 0
  );
  check(
    "one candidate moved reads as one candidate",
    bulkStageSummaryMessage(summarizeBulkStageMoves([{ id: ids(1)[0], name: "Solo", ok: true }]), "HIRED") ===
      "1 candidate moved to Hired.",
    bulkStageSummaryMessage(summarizeBulkStageMoves([{ id: ids(1)[0], name: "Solo", ok: true }]), "HIRED")
  );
}
{
  const missing = summarizeBulkStageMoves([
    { id: ids(1)[0], name: null, ok: false, error: MISSING_ROW_ERROR },
  ]);
  check(
    "a row the read did not return is a failure, not a silent skip",
    missing.failed === 1 && missing.moved === 0
  );
  check(
    "the missing row says the candidate is gone rather than naming a column",
    /no longer/.test(MISSING_ROW_ERROR) && !/applications|column|uuid/i.test(MISSING_ROW_ERROR),
    MISSING_ROW_ERROR
  );
  check(
    "a failure whose candidate is unknown is still listed",
    bulkStageFailureLines(missing).join("").includes("A candidate"),
    JSON.stringify(bulkStageFailureLines(missing))
  );
}

// ---------------------------------------------------------------------------
// 5. The server action sends the plan's flag and nothing else
// ---------------------------------------------------------------------------
sourceHas("the stage writer takes the notify flag", "src/app/(admin)/candidates/candidate-actions.ts", [
  "notify?: boolean",
  "const notify = input.notify !== false;",
]);
sourceHas("a suppressed notice still leaves the move itself intact", "src/app/(admin)/candidates/candidate-actions.ts", [
  "if (notify) {",
  "notify &&",
]);
sourceHas("an absent flag means the notice is sent, as it was before", "src/app/(admin)/candidates/candidate-actions.ts", [
  "input.notify !== false",
]);
sourceHas("the notice fan-out is the writer's own", "src/app/(admin)/candidates/candidate-actions.ts", [
  "const report = await notifyStageChange(input.applicationId, input.stage);",
]);
sourceHas("the bulk action is a server action over the plan", "src/app/(admin)/candidates/candidate-actions.ts", [
  "export async function moveApplicationsStageBulk",
  "planBulkStageMove(input)",
]);
sourceHas("the bulk action reads the selection before writing any of it", "src/app/(admin)/candidates/candidate-actions.ts", [
  '.in("id", plan.ids)',
  "MISSING_ROW_ERROR",
]);
sourceHas("the bulk action writes through the single-row writer", "src/app/(admin)/candidates/candidate-actions.ts", [
  "await updateApplicationStage({",
  "notify: plan.notify,",
]);
sourceHas("the bulk action reports the batch row by row", "src/app/(admin)/candidates/candidate-actions.ts", [
  "summarizeBulkStageMoves(outcomes)",
  "bulkStageSummaryMessage",
  "failures: summary.failures",
]);

// ---------------------------------------------------------------------------
// 6. The dialog asks for the one thing that mails people
// ---------------------------------------------------------------------------
sourceHas("the toolbar opens the move only from a selection", "src/app/(admin)/candidates/CandidateBrowser.tsx", [
  "setBulkStageOpen(true)",
  "disabled={selected.size === 0}",
  "<BulkStageDrawer",
]);
sourceHas("a finished batch re-reads the board the rows sit on", "src/app/(admin)/candidates/CandidateBrowser.tsx", [
  "onMoved={() => {",
  "setSelected(new Set());",
  "router.refresh();",
]);
sourceHas("the dialog states the cap it enforces", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "BULK_STAGE_LIMIT",
]);
sourceHas("the opt-in says who would be told and how", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "bulkStageNoticeLabel(recipients.length)",
  "bulkStageNoticeNote(recipients.length)",
]);
sourceHas("the notice starts off and only a tick turns it on", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "useState(false)",
  "checked={notify}",
]);
sourceHas("a bulk rejection is typed, not implied", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  'stage === "REJECTED"',
  "TextArea",
]);
sourceHas("the panel lists every row that did not move", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "bulkStageFailureLines",
  "result.message",
]);
sourceHas("the dialog moves through the batch action, not a second writer", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "moveApplicationsStageBulk",
  "notify,",
]);
sourceHas("closing the dialog starts the next one clean", "src/app/(admin)/candidates/BulkStageDrawer.tsx", [
  "function dismiss()",
  "setNotify(false);",
  "setReason(\"\");",
  "setResult(null);",
  "onClose={dismiss}",
]);
sourceHas("the selection box says what a selection now does", "src/app/(admin)/candidates/CandidateBoard.tsx", [
  "for a bulk action",
]);

// ---------------------------------------------------------------------------
// 7. The assistant moves a group through the SAME doors, and never mails by accident
// ---------------------------------------------------------------------------
// These are text on purpose: `writes.ts` pulls in every registry section and
// `tools.ts` pulls in the model client, and what is under test here is which
// seam a tool arrives through and whether it waits for an approval card.
sourceHas("the chat's bulk tool is the batch action, not a second writer", "src/modules/assistant/domain/registry/writes.ts", [
  'name: "move_stage_bulk"',
  "moveApplicationsStageBulk({",
]);
sourceHas("the chat's bulk tool names the same cap the dialog shows", "src/modules/assistant/domain/registry/writes.ts", [
  "at most ${BULK_STAGE_LIMIT}",
]);
sourceHas("the chat cannot mail a group by leaving the flag out", "src/modules/assistant/domain/registry/writes.ts", [
  'notify: bool(args, "notify", false)',
  "The stage notice is NOT sent by default",
]);
sourceHas("the chat is told a partly failed batch is not a clean move", "src/modules/assistant/domain/registry/writes.ts", [
  "never report a partly failed batch as a clean move",
]);

// `READ_ONLY_TOOLS` is an exception list: a tool not named there is treated as a
// write and waits for an approval card. The bulk move must never be on it.
sourceLacks("the bulk move waits for the recruiter's approval card", "src/modules/assistant/domain/tools.ts", [
  '"move_stage_bulk"',
]);

sourceHas("the batch action reaches the chat through the one seam", "src/modules/assistant/application/sources.ts", [
  "moveApplicationsStageBulk,",
  "export { moveApplicationsStageBulk };",
]);
sourceHas("the registry section re-exports the action and the cap it quotes", "src/modules/assistant/domain/registry/shared.ts", [
  "export { moveApplicationsStageBulk };",
  "export { BULK_STAGE_LIMIT };",
]);
sourceHas("the chat's link opens the rail the group landed on", "src/modules/assistant/domain/links.ts", [
  'case "move_stage_bulk"',
  'named(args.stage, PIPELINE_STAGES)',
]);
sourceHas("the page guide tells the truth about both bulk buttons", "src/modules/shell/domain/pageGuide.ts", [
  "Bulk message and Bulk move both act on the rows you tick",
  "A bulk move stops at 50 rows",
  "sends no stage notice unless you tick the opt-in",
]);

function sourceHas(name, file, needles) {
  const source = read(file);
  const missing = needles.filter((needle) => !source.includes(needle));
  check(name, missing.length === 0, missing.length ? `missing in ${file}: ${JSON.stringify(missing)}` : "");
}

function sourceLacks(name, file, needles) {
  const source = read(file);
  const present = needles.filter((needle) => source.includes(needle));
  check(name, present.length === 0, present.length ? `unexpectedly in ${file}: ${JSON.stringify(present)}` : "");
}

// ---------------------------------------------------------------------------
console.log(
  `\n${results.filter((r) => r.pass).length}/${results.length} checks passed`
);
for (const failure of results.filter((r) => !r.pass)) {
  console.log(`FAILED: ${failure.name}${failure.detail ? ` — ${failure.detail}` : ""}`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
