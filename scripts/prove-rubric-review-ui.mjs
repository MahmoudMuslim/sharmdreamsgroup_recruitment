/**
 * The rubric on the three surfaces a recruiter actually touches.
 *
 * The domain half of this slice (`prove-scoring-rubric.mjs`) proves what a
 * marking scheme is, what a grader may store against it and what a read is
 * allowed to hand back. None of that is visible until a drawer prints it, and a
 * drawer is where a mark can be leaked, a legacy paper can be mislabelled, or an
 * author's typed "40" can arrive as the string the validator refuses.
 *
 * So this file renders the three real client components in plain Node with the
 * same hand-rolled hook harness the comparison UI proof uses, and asks the three
 * questions each surface has to answer:
 *
 * - the answers desk and the comparison table: does every criterion the paper was
 *   marked on read back with its points, and does a withheld reviewer see none of
 *   them while still reading the grader's quotation?
 * - the question editor: does a stored scheme come back into the panel, go out as
 *   numbers, and does a type with no panel claim nothing about a scheme it never
 *   read?
 * - the Guide: does the manual describe the scheme the code now has?
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const Fragment = Symbol("Fragment");

const components = {
  answers: ["IssuedLinksBoard", "AnswersDrawer"],
  comparison: ["ComparisonDrawer", "ComparisonDrawer"],
  editor: ["QuestionEditorDrawer", "QuestionEditorDrawer"],
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** What the grader wrote beside one candidate's mark. */
const MARKED = [
  {
    label: "Diagnoses the cause",
    marks: 12,
    allowance: 16,
    percent: 75,
    evidence: "She names the occupancy drop before proposing a rate cut",
    description: "Names the real driver before recommending anything",
  },
  {
    label: "Protects the guest",
    marks: 4,
    allowance: 4,
    percent: 100,
    evidence: "She keeps the guest's invoice open until the room is re-issued",
    description: null,
  },
];

/** The same two lines with their points withheld — what a masked reviewer is sent. */
const WITHHELD = MARKED.map((line) => ({ ...line, marks: null, allowance: null, percent: null }));

const answer = (overrides = {}) => ({
  question_id: "q-case",
  title: "A complaint that turned into a referral",
  prompt: "Read the case and write what you would do first.",
  instructions: null,
  question_type: "CASE_STUDY",
  points: 20,
  answered: true,
  answer_text: "First I would find out what actually happened to the booking.",
  options: [],
  chosen_text: null,
  correct_text: null,
  cells: [],
  expected: [],
  context: null,
  min_words: null,
  words: 12,
  video_url: null,
  duration_seconds: null,
  transcript: null,
  score: 16,
  max_score: 20,
  awarded_by: "AI",
  rationale: "Strong on diagnosis, thin on the numbers.",
  strengths: ["Named the driver"],
  improvements: ["Quantify the recovery"],
  criteria: [],
  saved_at: null,
  ...overrides,
});

const paper = (answers, overrides = {}) => ({
  attempt_id: "attempt-1",
  application_id: "app-1",
  candidate_name: "Candidate 1",
  identity_blind: false,
  job_title: "Guest relations",
  template_name: "Guest service",
  status: "GRADED",
  scores_masked: false,
  answered: 1,
  questions: 1,
  score: 16,
  max_score: 20,
  benchmark: null,
  time_limit_minutes: 30,
  started_at: null,
  expires_at: null,
  submitted_at: "2026-10-23T11:00:00Z",
  integrity_flags: 0,
  dealt_from_order: false,
  answers,
  ...overrides,
});

const linkRow = {
  id: "attempt-1",
  application_id: "app-1",
  job_id: "job-a",
  template_id: "suite-a",
  candidate_name: "Candidate 1",
  identity_blind: false,
  job_title: "Guest relations",
  template_name: "Guest service",
  status: "GRADED",
  time_limit_minutes: 30,
  issued_at: "2026-10-23T10:00:00Z",
  started_at: null,
  expires_at: null,
  submitted_at: "2026-10-23T11:00:00Z",
  score: 16,
  max_score: 20,
  answers: 1,
  questions: 1,
  integrity_flags: 0,
};

/** A suite question carrying the scheme its author wrote. */
const rubricQuestion = (overrides = {}) => ({
  id: "q-case",
  template_id: "suite-a",
  question_type: "CASE_STUDY",
  title: "A complaint that turned into a referral",
  prompt: "Read the case and write what you would do first.",
  instructions: null,
  config: {
    context: "A resort faces a 30% drop in occupancy after a competitor opens.",
    min_words: 150,
    rubric: [
      {
        label: "Diagnoses the cause",
        weight: 60,
        description: "Names the real driver before recommending anything",
      },
      { label: "Protects the guest", weight: 40 },
    ],
  },
  points: 20,
  position: 0,
  time_limit_minutes: null,
  shuffle_options: false,
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* The render harness                                                          */
/* -------------------------------------------------------------------------- */

function harness(which, options = {}) {
  assert.ok(components[which], `unknown surface ${which}`);
  const slots = [], effects = [], requests = [], saves = [], cache = new Map();
  let cursor = 0, dirty = true, mounted = true, tree, lateWrites = 0, changed = 0;

  let props;
  if (which === "answers") {
    props = { link: options.link ?? linkRow, timeZone: "UTC", onClose: () => {} };
  } else if (which === "comparison") {
    props = { attemptIds: ["attempt-1", "attempt-2"], onClose: () => {} };
  } else {
    props = {
      open: true,
      onClose: () => {},
      templateId: "suite-a",
      templateName: "Guest service",
      questions: [options.question ?? rubricQuestion()],
      editable: true,
      onChanged: () => { changed++; },
      openAtId: options.openAtId === undefined ? (options.question ?? rubricQuestion()).id : options.openAtId,
      situationalAvailable: true,
      situationalNote: null,
      skillOptions: options.skillOptions ?? [
        { id: "s-fin", name: "Financial modelling" },
        { id: "s-neg", name: "Negotiation" },
      ],
      skillsNote: options.skillsNote ?? null,
    };
  }

  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (value) => { if (!mounted) lateWrites++; slot.value = typeof value === "function" ? value(slot.value) : value; dirty = true; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(create, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { value: create(), deps }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) { slots[index] = { deps, create, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  hooks.useLayoutEffect = hooks.useEffect;

  /**
   * Every read the surfaces make, deferred on purpose.
   *
   * A promise the test resolves by hand is the only way to watch what a drawer
   * prints before, during and after a read — including the state it must never
   * reach, such as a figure the withheld view should not have received.
   */
  const deferred = (kind, detail) => {
    const request = { kind, detail };
    request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    requests.push(request);
    return request.promise;
  };
  const actions = {
    getAttemptAnswers: (id) => deferred("answers", id),
    getAttemptComparison: (ids) => deferred("comparison", ids),
  };
  const authoring = {
    saveQuestion: (payload) => {
      saves.push(payload);
      // The write's own outcome, because what the panel shows after a refusal is
      // the author's only notice that their scheme was not stored.
      return Promise.resolve(options.save ?? { ok: true });
    },
  };
  const offLimits = (name) => () => {
    throw new Error(`Boundary reached in this proof: ${name}`);
  };
  const questionActions = {
    ...authoring,
    deleteQuestion: offLimits("deleteQuestion"),
    moveQuestion: offLimits("moveQuestion"),
    draftQuestions: offLimits("draftQuestions"),
    addDraftedQuestions: offLimits("addDraftedQuestions"),
  };

  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (!existsSync(file)) return {};
    const loaded = { exports: {} };
    cache.set(file, loaded.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const local = (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (name === "next/link") return { __esModule: true, default: (props) => jsx("a", props) };
      if (name === "./actions") return actions;
      if (name === "./question-actions") return questionActions;
      if (name === "./ComparisonDrawer") {
        return which === "comparison"
          ? load(resolve(root, "src/app/(admin)/assessments/ComparisonDrawer.tsx"))
          : { ComparisonDrawer: (props) => jsx("comparison-drawer", props) };
      }
      if (name.endsWith("/Drawer")) {
        return {
          Drawer: (props) => jsx("form", {
            onSubmit: props.onSubmit,
            children: [jsx("section", { role: "dialog", children: [props.eyebrow, props.title, props.subtitle, props.children, props.footer] })],
          }),
        };
      }
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(file), name);
        // A sibling named with its extension (`./attemptAnswers.ts`, which the
        // ESM loader in the other rubric proof requires) resolves as written;
        // an extensionless one takes the repo's usual `.tsx` then `.ts`.
        const targets = /\.[cm]?[jt]sx?$/.test(base) ? [base] : [`${base}.tsx`, `${base}.ts`];
        const target = targets.find(existsSync);
        if (!target) throw new Error(`Unresolved ${name}`);
        return load(target);
      }
      return require(name);
    };
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }

  const [file, exportName] = components[which];
  const Component = load(resolve(root, `src/app/(admin)/assessments/${file}.tsx`))[exportName];
  assert.equal(typeof Component, "function", `${exportName} exists`);

  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.type === Fragment) return expand(node.props.children);
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? "" : typeof node === "object" ? text(node.props.children) : String(node);
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props.children)];
  function render() { let count = 0; while (dirty && mounted) { assert.ok(count++ < 40); dirty = false; cursor = 0; tree = expand(Component(props)); effects.splice(0).forEach((effect) => effect()); } }
  function find(predicate) { render(); const node = nodes(tree).find(predicate); assert.ok(node, "control exists"); return node; }

  const labelled = (name) => find((node) => (node.type === "input" || node.type === "textarea") && node.props["aria-label"] === name);

  const ui = {
    requests, saves,
    text: (node = tree) => text(node),
    textOf: (node) => text(node),
    nodes: () => nodes(tree),
    find, render,
    button: (name) => find((node) => node.type === "button" && text(node).trim() === name),
    click(name) { const button = ui.button(name); assert.ok(!button.props.disabled, `${name} is disabled`); button.props.onClick(); render(); },
    control: labelled,
    value(name) { return labelled(name).props.value; },
    type(name, next) { const control = labelled(name); control.props.onChange({ target: { value: next } }); render(); },
    submit() {
      const form = find((node) => node.type === "form" && typeof node.props.onSubmit === "function");
      form.props.onSubmit();
      render();
    },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); render(); } },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
    get lateWrites() { return lateWrites; },
    get changes() { return changed; },
  };
  render();
  return ui;
}

/** The answers desk, read and settled. */
async function desk(paperValue) {
  const ui = harness("answers");
  ui.requests[0].resolve(paperValue);
  await ui.settle();
  return ui;
}

/* -------------------------------------------------------------------------- */
/* 1. The answers desk                                                         */
/* -------------------------------------------------------------------------- */

test("a rubric'd paper reads back criterion by criterion", async () => {
  const ui = await desk(paper([answer({ criteria: MARKED })]));
  assert.match(ui.text(), /Criterion marks/);
  for (const value of ["Diagnoses the cause", "Protects the guest", "12 of 16", "75%", "100%", "4 of 4"]) {
    assert.ok(ui.text().includes(value), value);
  }
  // The author's words and the grader's quotation are feedback, not marks.
  assert.match(ui.text(), /Names the real driver before recommending anything/);
  assert.match(ui.text(), /She names the occupancy drop before proposing a rate cut/);
  ui.unmount();
});

test("a criterion with no note of its own prints no empty label", async () => {
  const ui = await desk(paper([answer({ criteria: MARKED })]));
  const rows = ui.nodes().filter((node) => node.type === "li" && ui.textOf(node).includes("Protects the guest"));
  const row = rows[rows.length - 1];
  assert.ok(row, "the criterion has its own row");
  assert.ok(ui.textOf(row).includes("4 of 4"));
  assert.doesNotMatch(ui.textOf(row), /strong answer shows/);
  ui.unmount();
});

test("withheld marks hide every criterion figure and keep the reading", async () => {
  const ui = await desk(paper([answer({ criteria: WITHHELD })], { scores_masked: true }));
  assert.match(ui.text(), /Criterion marks/);
  assert.match(ui.text(), /Diagnoses the cause/);
  assert.match(ui.text(), /She keeps the guest's invoice open/);
  for (const leaked of ["12 of 16", "4 of 4", "75%", "100%"]) {
    assert.ok(!ui.text().includes(leaked), `withheld view shows ${leaked}`);
  }
  assert.doesNotMatch(ui.text(), /null|NaN|undefined/);
  ui.unmount();
});

test("a criterion whose snapshot lost its figure is not invented as a zero", async () => {
  const ui = await desk(paper([answer({ criteria: [{ ...MARKED[0], marks: null, allowance: null, percent: null }] })]));
  assert.match(ui.text(), /no mark on file/i);
  assert.doesNotMatch(ui.text(), /0 of |null|NaN/);
  ui.unmount();
});

test("a paper graded without a rubric says nothing about criteria", async () => {
  const ui = await desk(paper([answer({ criteria: [] })]));
  assert.doesNotMatch(ui.text(), /Criterion marks/);
  // The mark it does have is still printed.
  assert.ok(ui.text().includes("16/20"));
  ui.unmount();
});

test("a late read cannot write into a closed drawer", async () => {
  const ui = harness("answers");
  ui.unmount();
  ui.requests[0].resolve(paper([answer({ criteria: MARKED })]));
  await ui.settle();
  assert.equal(ui.lateWrites, 0);
});

/* -------------------------------------------------------------------------- */
/* 2. The comparison table                                                     */
/* -------------------------------------------------------------------------- */

async function compared(first, second) {
  const ui = harness("comparison");
  ui.requests[0].resolve({ ok: true, papers: [first, second] });
  await ui.settle();
  return ui;
}

/** The second column, same question, its own marks and its own reading. */
const otherPaper = (answers, overrides = {}) =>
  paper(answers, { attempt_id: "attempt-2", candidate_name: "Candidate 2", ...overrides });

test("each column carries the criteria its own paper was marked on", async () => {
  const ui = await compared(
    paper([answer({ criteria: [MARKED[0]] })]),
    otherPaper([answer({ criteria: [{ ...MARKED[1], marks: 2, allowance: 4, percent: 50 }] })])
  );
  assert.match(ui.text(), /Criterion marks/);
  assert.ok(ui.text().includes("12 of 16"));
  assert.ok(ui.text().includes("2 of 4"));
  assert.ok(ui.text().includes("50%"));
  ui.unmount();
});

test("a withheld column keeps the criterion names and quotes but not the points", async () => {
  const ui = await compared(
    paper([answer({ criteria: MARKED })]),
    otherPaper([answer({ criteria: WITHHELD, score: null, max_score: null })], {
      scores_masked: true,
      score: null,
      max_score: null,
    })
  );
  assert.match(ui.text(), /Protects the guest/);
  // The open column's figures stay; the masked one adds none of its own.
  assert.equal(ui.text().split("75%").length - 1, 1);
  assert.doesNotMatch(ui.text(), /Hidden of/);
  ui.unmount();
});

test("a paper without a scheme leaves the cell as it was", async () => {
  const ui = await compared(paper([answer({ criteria: [] })]), otherPaper([answer({ criteria: [] })]));
  assert.doesNotMatch(ui.text(), /Criterion marks/);
  ui.unmount();
});

/* -------------------------------------------------------------------------- */
/* 3. The question editor's marking scheme                                     */
/* -------------------------------------------------------------------------- */

test("a stored scheme opens in the panel, one row per criterion", () => {
  const ui = harness("editor");
  assert.equal(ui.value("Name of criterion 1"), "Diagnoses the cause");
  assert.equal(ui.value("Weight of criterion 1"), "60");
  assert.equal(ui.value("What a strong answer shows for criterion 1"), "Names the real driver before recommending anything");
  assert.equal(ui.value("Name of criterion 2"), "Protects the guest");
  assert.equal(ui.value("Weight of criterion 2"), "40");
  assert.equal(ui.value("What a strong answer shows for criterion 2"), "");
  assert.ok(ui.text().includes("100"));
  ui.unmount();
});

test("an author's weights leave as numbers, in the order on screen", async () => {
  const ui = harness("editor");
  ui.type("Weight of criterion 1", "70");
  ui.type("Weight of criterion 2", "30");
  ui.type("What a strong answer shows for criterion 2", "Keeps the guest whole");
  ui.submit();
  await ui.settle();
  assert.deepEqual(ui.saves[0].rubric, [
    { label: "Diagnoses the cause", weight: 70, description: "Names the real driver before recommending anything", skill_id: undefined },
    { label: "Protects the guest", weight: 30, description: "Keeps the guest whole", skill_id: undefined },
  ]);
  assert.equal(typeof ui.saves[0].rubric[0].weight, "number");
  ui.unmount();
});

test("a new criterion is written with a blank weight, never a zero", () => {
  const ui = harness("editor");
  ui.click("Add criterion");
  ui.type("Name of criterion 3", "Follows up");
  ui.submit();
  assert.deepEqual(ui.saves[0].rubric[2], { label: "Follows up", weight: undefined, description: "", skill_id: undefined });
  ui.unmount();
});

test("emptying the panel is how a scheme is retired", () => {
  const ui = harness("editor");
  for (const name of ["Name of criterion 1", "Name of criterion 2"]) ui.type(name, "");
  for (const weight of ["Weight of criterion 1", "Weight of criterion 2"]) ui.type(weight, "");
  ui.submit();
  const rows = ui.saves[0].rubric;
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every((row) => String(row.label).trim() === "" && row.weight === undefined));
  ui.unmount();
});

test("a case study with no scheme yet opens on two blank rows", () => {
  const ui = harness("editor", { question: rubricQuestion({ config: { context: "A resort.", min_words: 150 } }) });
  assert.equal(ui.value("Name of criterion 1"), "");
  assert.equal(ui.value("Name of criterion 2"), "");
  assert.equal(ui.nodes().filter((node) => node.type === "input" && /^Name of criterion \d+$/.test(String(node.props["aria-label"]))).length, 2);
  ui.unmount();
});

test("the panel holds the rubric's own ceiling and no floor on removal", () => {
  const ui = harness("editor", {
    question: rubricQuestion({
      config: {
        rubric: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `Criterion ${n}`, weight: n === 6 ? 45 : 11 })),
      },
    }),
  });
  assert.equal(ui.button("Add criterion").props.disabled, true);
  // Every row can go: an emptied panel is the author retiring the scheme.
  for (let index = 1; index <= 6; index++) ui.button(`Remove criterion ${index}`);
  ui.click("Remove criterion 6");
  assert.equal(ui.button("Add criterion").props.disabled, false);
  ui.unmount();
});

test("a video pitch says its marks come only from the transcript", () => {
  const ui = harness("editor", {
    question: rubricQuestion({ question_type: "VIDEO_PITCH", config: { max_duration_seconds: 120, rubric: [{ label: "Opens with the ask", weight: 50 }, { label: "Closes the loop", weight: 50 }] } }),
  });
  assert.match(ui.text(), /only what the transcript carries/i);
  assert.equal(ui.value("Name of criterion 1"), "Opens with the ask");
  ui.unmount();
});

test("a case study says the grader scores the written answer against each criterion", () => {
  const ui = harness("editor");
  assert.match(ui.text(), /written answer/);
  ui.unmount();
});

test("a quiz has no panel and claims nothing about a scheme", () => {
  const ui = harness("editor", {
    question: rubricQuestion({
      question_type: "MULTIPLE_CHOICE",
      config: { options: [{ label: "OPT_1", text: "Ask the guest", is_correct: true }, { label: "OPT_2", text: "Escalate", is_correct: false }] },
    }),
  });
  assert.equal(
    ui.nodes().filter((node) => /^Name of criterion \d+$/.test(String(node.props["aria-label"]))).length,
    0
  );
  ui.submit();
  assert.ok(!("rubric" in ui.saves[0]), "a quiz draft must not speak of a marking scheme");
  ui.unmount();
});

test("a spreadsheet model keeps its definition and claims nothing about a scheme", () => {
  const ui = harness("editor", {
    question: rubricQuestion({ question_type: "EXCEL_MODEL", config: { initial_sheet: [["Rate", 220]], expected: [] } }),
  });
  ui.submit();
  assert.ok(!("rubric" in ui.saves[0]));
  assert.deepEqual(ui.saves[0].preserve_config, { initial_sheet: [["Rate", 220]], expected: [] });
  ui.unmount();
});

test("a refused scheme keeps the panel and prints the reason", async () => {
  const ui = harness("editor", { save: { ok: false, error: "A rubric's weights add up to 100 so the shares read as percentages — these add up to 90." } });
  ui.type("Weight of criterion 1", "50");
  ui.submit();
  await ui.settle();
  assert.ok(ui.find((node) => node.props.role === "alert"));
  assert.match(ui.text(), /add up to 90/);
  // The draft the author typed is still on the desk, not silently dropped.
  assert.equal(ui.value("Name of criterion 1"), "Diagnoses the cause");
  ui.unmount();
});

const skillSelect = (ui, index = 1) =>
  ui.find(
    (node) =>
      node.type === "select" &&
      node.props["aria-label"] === `Skill of criterion ${index}`
  );

test("a stored skill tag comes back selected in the editor", () => {
  const question = rubricQuestion({
    config: {
      rubric: [
        { label: "Diagnoses the cause", weight: 60, description: "Names the real driver before recommending anything", skill_id: "s-fin", skill_name: "Financial modelling" },
        { label: "Protects the guest", weight: 40 },
      ],
    },
  });
  const ui = harness("editor", { question });
  assert.equal(skillSelect(ui, 1).props.value, "s-fin");
  assert.equal(skillSelect(ui, 2).props.value, "");
  ui.unmount();
});

test("choosing a skill sends its id and never a name", async () => {
  const ui = harness("editor");
  const select = skillSelect(ui, 1);
  select.props.onChange({ target: { value: "s-neg" } });
  ui.render();
  ui.type("Name of criterion 1", "Negotiates the rebooking");
  ui.type("Weight of criterion 1", "60");
  ui.type("What a strong answer shows for criterion 1", "Keeps the guest whole");
  ui.type("Name of criterion 2", "Protects the rate");
  ui.type("Weight of criterion 2", "40");
  ui.submit();
  await ui.settle();
  const [payload] = ui.saves;
  assert.equal(payload.rubric[0].skill_id, "s-neg");
  assert.equal("skill_name" in payload.rubric[0], false);
  ui.unmount();
});

test("a retired tag still reads, and is marked as one the catalogue no longer offers", () => {
  const question = rubricQuestion({
    config: {
      rubric: [
        { label: "Diagnoses the cause", weight: 100, skill_id: "s-old", skill_name: "Legacy tooling" },
      ],
    },
  });
  const ui = harness("editor", { question });
  const select = skillSelect(ui, 1);
  assert.equal(select.props.value, "s-old");
  assert.match(ui.textOf(select), /Legacy tooling/);
  ui.unmount();
});

test("an empty catalogue says tagging is unavailable and offers no select", () => {
  const ui = harness("editor", {
    skillOptions: [],
    skillsNote: "No active skills are on file, so every criterion saves untagged.",
  });
  assert.equal(
    ui.nodes().some(
      (node) => node.type === "select" && node.props["aria-label"] === "Skill of criterion 1"
    ),
    false
  );
  assert.match(ui.text(), /No active skills are on file/);
  ui.unmount();
});

/** A question whose first criterion already carries a stored tag. */
const taggedQuestion = (skillId = "s-old", skillName = "Legacy tooling") =>
  rubricQuestion({
    config: {
      rubric: [
        {
          label: "Diagnoses the cause",
          weight: 60,
          description: "Names the real driver before recommending anything",
          skill_id: skillId,
          skill_name: skillName,
        },
        { label: "Protects the guest", weight: 40 },
      ],
    },
  });

test("an empty catalogue still shows a stored tag, disabled, with its note", () => {
  const ui = harness("editor", {
    question: taggedQuestion(),
    skillOptions: [],
    skillsNote: "No active skills are on file.",
  });
  const select = skillSelect(ui, 1);
  assert.equal(select.props.value, "s-old");
  const stored = ui.nodes().find(
    (node) => node.type === "option" && node.props.value === "s-old"
  );
  assert.ok(stored, "the stored option exists");
  assert.equal(stored.props.disabled, true);
  assert.match(ui.textOf(stored), /Legacy tooling/);
  assert.match(ui.text(), /No active skills are on file/);
  // The untagged second criterion has nothing to show, so it keeps the note only.
  assert.equal(
    ui.nodes().some(
      (node) => node.type === "select" && node.props["aria-label"] === "Skill of criterion 2"
    ),
    false
  );
  ui.unmount();
});

test("the note beside a stored tag does not promise an untagged save", () => {
  const ui = harness("editor", { question: taggedQuestion(), skillOptions: [] });
  assert.doesNotMatch(ui.text(), /Every criterion still saves untagged/);
  assert.match(ui.text(), /save this criterion untagged/);
  ui.unmount();
});

test("an unchanged editor still sends a stored tag under an empty catalogue", async () => {
  const ui = harness("editor", { question: taggedQuestion(), skillOptions: [] });
  // The tag is on screen, so not retagging cannot be mistaken for dropping it.
  assert.equal(skillSelect(ui, 1).props.value, "s-old");
  ui.submit();
  await ui.settle();
  const [payload] = ui.saves;
  assert.equal(payload.rubric[0].skill_id, "s-old");
  ui.unmount();
});

test("a stored tag is clearable even when the catalogue is empty", async () => {
  const ui = harness("editor", { question: taggedQuestion(), skillOptions: [] });
  skillSelect(ui, 1).props.onChange({ target: { value: "" } });
  ui.render();
  ui.submit();
  await ui.settle();
  const [payload] = ui.saves;
  const wire = JSON.parse(JSON.stringify(payload.rubric[0]));
  assert.equal("skill_id" in wire, false);
  ui.unmount();
});

/* -------------------------------------------------------------------------- */
/* 4. The Guide                                                                */
/* -------------------------------------------------------------------------- */

function sourceHas(name, relative, needles) {
  test(name, () => {
    const source = readFileSync(resolve(root, relative), "utf8");
    for (const needle of needles) assert.ok(source.includes(needle), `missing: ${needle}`);
  });
}

sourceHas("the Guide tells a recruiter to write the marking scheme", "src/modules/shell/domain/pageGuide.ts", [
  "name two to six criteria",
  "add up to 100",
]);

sourceHas("the Guide says a rubric'd paper is read back criterion by criterion", "src/modules/shell/domain/pageGuide.ts", [
  "Criterion marks",
  "the line quoted from the answer",
]);

sourceHas("the Guide limits a pitch to what the transcript carries", "src/modules/shell/domain/pageGuide.ts", [
  "only what the transcript carries",
]);

sourceHas("the Guide states that the scheme a paper was graded under is its own", "src/modules/shell/domain/pageGuide.ts", [
  "stored inside the paper it graded",
]);
