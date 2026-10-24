/* scripts/prove-opening-skills-ui.mjs
 * Run: node --test scripts/prove-opening-skills-ui.mjs
 *
 * The requisition's skill list on the three surfaces a recruiter actually uses.
 *
 * The domain half (`prove-opening-skills.mjs`) proves what a required skill is,
 * what the cap and the scale allow, and what a drawer may say about a candidate.
 * The action half (`prove-opening-skills-actions.mjs`) proves the one write and
 * the two reads. None of it is visible until a picker prints checkboxes, a form
 * decides whether it has anything to save, and a shortlist says "required 4,
 * shown 2" beside a name — and those are the three places a figure can leak, a
 * level can leave as the string "4", or an unapplied migration can be dressed up
 * as a recruiter who chose nothing.
 *
 * So this file renders the three real client components in plain Node with the
 * same hand-rolled hook harness the rubric UI proof uses, and asks each surface
 * the questions only a render can answer:
 *
 * - the picker: does it offer the catalogue in its own order, add at the column's
 *   default, hand the level back as a number, refuse to add a thirteenth, quote
 *   the requirement line a suggestion came from, leave a level the recruiter set
 *   alone, and say nothing but the file name while 037 is unapplied?
 * - the job form: does an edit load the opening's own rows, does an untouched list
 *   spare the writer entirely, does a changed list go to the id the opening write
 *   returned, and does a skills refusal keep the drawer open on a saved opening?
 * - the applicants drawer: does each name carry the requisition's skills beside
 *   what that person showed, does no-evidence print as no evidence rather than a
 *   gap, and does a reviewer whose scores are masked read the requirement without
 *   reading the candidate's levels?
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import {
  DEFAULT_REQUIRED_LEVEL,
  MAX_REQUIRED_SKILLS,
  OPENING_SKILLS_SCHEMA_NOTE,
  SKILL_LEVELS,
} from "../src/modules/jobs/domain/openingSkills.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const Fragment = Symbol("Fragment");

const surfaces = {
  picker: ["JobSkillsField", "JobSkillsField"],
  form: ["JobFormDrawer", "JobFormDrawer"],
  applicants: ["JobApplicantsDrawer", "JobApplicantsDrawer"],
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** The live catalogue, in the order the master-data console shows it. */
const CATALOGUE = [
  { id: "s-excel", name: "Excel (advanced)" },
  { id: "s-npv", name: "NPV / IRR analysis" },
  { id: "s-ats", name: "ATS / HRIS tooling" },
  { id: "s-leadership", name: "Team leadership" },
  { id: "s-revenue", name: "Revenue management" },
];

/** The same list with one row the master-data console has since retired. */
const LABELS = [...CATALOGUE, { id: "s-pms", name: "Micros Opera PMS" }];

/** Long enough that the ceiling, and not the list, is what stops a twelfth pick. */
const MANY = Array.from({ length: 14 }, (_, i) => ({ id: `s-${i}`, name: `Skill ${i + 1}` }));
const FULL_LIST = MANY.slice(0, MAX_REQUIRED_SKILLS).map((skill) => ({
  skill_id: skill.id,
  required_level: 3,
  source: "RECRUITER",
}));

const REQUIREMENT_LINES = [
  "Owns revenue management for the marina",
  "Advanced Excel work, including monthly re-forecasts",
];

const REQUIRED = [
  { skill_id: "s-excel", required_level: 4, source: "RECRUITER" },
  { skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" },
];

const job = (overrides = {}) => ({
  id: "job-1",
  title: "Revenue manager",
  tenant_id: "t-1",
  department: "Finance",
  sector: "HOSPITALITY",
  location: "Marina",
  employment_type: "FULL_TIME",
  experience_level: null,
  description: "Owns the rate card for the marina rooms.",
  requirements: REQUIREMENT_LINES,
  min_salary_usd: null,
  max_salary_usd: null,
  salary_currency: "USD",
  status: "DRAFT",
  required_skills: [],
  ...overrides,
});

const formOptions = (overrides = {}) => ({
  companies: [{ id: "t-1", name: "Dreams Group", sector: "HOSPITALITY" }],
  departments: [{ id: "d-1", name: "Finance" }],
  locations: [{ id: "l-1", name: "Marina" }],
  currencies: [{ id: "c-1", code: "USD", symbol: "$", label: "US Dollar" }],
  filing: { companies: [], departments: [], locations: [], currencies: [] },
  positions: [],
  positionsAvailable: true,
  termsAvailable: true,
  skills: CATALOGUE,
  skillLabels: LABELS,
  skillsNote: null,
  ...overrides,
});

const applicant = (overrides = {}) => ({
  id: "app-1",
  full_name: "Candidate 1",
  email: "c1@example.com",
  phone: null,
  tracking_code: "TR-1",
  stage: "NEW",
  source: "CAREER_SITE",
  applied_at: "2026-10-20T09:00:00Z",
  cv_name: "candidate-1.pdf",
  ai_match_score: 62,
  attempt_status: null,
  attempt_token: null,
  attempt_score: null,
  attempt_max: null,
  template_name: null,
  scores_masked: false,
  demonstrated: [],
  ...overrides,
});

const submission = {
  cv_text: "Twelve years on a resort rate card.",
  cv_url: "https://files.invalid/candidate-1.pdf",
  cv_download_url: "https://files.invalid/candidate-1.download.pdf",
  screening_summary: "Strong on pricing, thin on the numbers behind it.",
  skill_evidence: [],
  skill_evidence_coverage: null,
  skill_evidence_note: null,
  skill_evidence_masked: false,
};

/** One roll-up line, shaped exactly as the action returns it. */
const EVIDENCE_LINE = {
  skill_id: "s-revenue",
  skill_name: "Revenue management",
  awarded: 16,
  allowance: 20,
  percent: 80,
  questionCount: 2,
  sittingCount: 2,
  contributions: [
    {
      question_title: "Rate card",
      criterion_label: "Diagnosis",
      awarded: 8,
      allowance: 10,
      evidence: "names the driver",
    },
    {
      question_title: "Weekend pricing",
      criterion_label: "Model",
      awarded: 8,
      allowance: 10,
      evidence: null,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* The render harness                                                          */
/* -------------------------------------------------------------------------- */

function harness(which, options = {}) {
  assert.ok(surfaces[which], `unknown surface ${which}`);
  const slots = [], effects = [], requests = [], saves = [], changes = [], cache = new Map();
  let cursor = 0, dirty = true, mounted = true, tree, lateWrites = 0, closes = 0, refreshes = 0;

  const catalogue = options.catalogue ?? CATALOGUE;
  const labels = options.labels ?? LABELS;

  let props;
  if (which === "picker") {
    props = {
      skills: catalogue,
      labels,
      required: options.required ?? [],
      requirements: options.requirements ?? REQUIREMENT_LINES,
      note: options.note ?? null,
      onChange: (next) => { changes.push(next); },
    };
  } else if (which === "form") {
    props = {
      options: options.formOptions ?? formOptions(),
      job: "job" in options ? options.job : job(),
      open: true,
      onClose: () => { closes++; },
    };
  } else {
    props = {
      job: { id: "job-1", title: "Revenue manager", status: "DRAFT", required_skills: options.required ?? [] },
      canDecide: options.canDecide ?? false,
      skillLabels: labels,
      onClose: () => { closes++; },
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
   * Every read and every write, deferred on purpose.
   *
   * A promise the test resolves by hand is the only way to watch what a drawer
   * prints before, during and after it — including the states it must never
   * reach, such as a level the masked reviewer was never sent.
   */
  const deferred = (kind, detail) => {
    const request = { kind, detail };
    request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    requests.push(request);
    return request.promise;
  };
  const offLimits = (name) => () => {
    throw new Error(`Boundary reached in this proof: ${name}`);
  };
  const actions = {
    getJobApplicants: (id) => deferred("applicants", id),
    getApplicantSubmission: (id) => deferred("submission", id),
  };
  // The candidates desk's own writers. This slice moves nobody and drafts nothing,
  // and the file behind them is a `"use server"` module that reaches the request
  // scope — so it stays a door that refuses rather than a thing that runs.
  const candidateWrites = {
    updateApplicationStage: offLimits("updateApplicationStage"),
    draftRejectionReason: offLimits("draftRejectionReason"),
  };
  const openingWrites = {
    createJobOpening: (body) => { saves.push({ verb: "create", body }); return deferred("create", body); },
    updateJobOpening: (id, body) => { saves.push({ verb: "update", id, body }); return deferred("update", body); },
    setJobStatus: offLimits("setJobStatus"),
    deleteJobOpening: offLimits("deleteJobOpening"),
    refileFiling: offLimits("refileFiling"),
  };
  const skillsWrites = {
    saveOpeningSkills: (id, rows) => {
      saves.push({ verb: "skills", id, rows });
      return deferred("skills", [id, rows]);
    },
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
      if (name === "next/navigation") {
        return {
          useRouter: () => ({ refresh: () => { refreshes++; }, push: offLimits("router.push"), replace: offLimits("router.replace") }),
          usePathname: () => "/jobs",
          useSearchParams: () => new URLSearchParams(),
        };
      }
      if (name === "server-only") return {};
      if (name === "./applicant-actions") return actions;
      if (name === "@/app/(admin)/candidates/candidate-actions") return candidateWrites;
      if (name === "./job-actions") return openingWrites;
      if (name === "./opening-skills-actions") return skillsWrites;
      if (name === "./JobApplicantsDrawer") {
        return { JobApplicantsDrawer: (props) => jsx("applicants-drawer", props) };
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

  const [file, exportName] = surfaces[which];
  const Component = load(resolve(root, `src/app/(admin)/jobs/${file}.tsx`))[exportName];
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
  function render() { let count = 0; while (dirty && mounted) { assert.ok(count++ < 60); dirty = false; cursor = 0; tree = expand(Component(props)); effects.splice(0).forEach((effect) => effect()); } }

  /**
   * The two ways this portal labels a control.
   *
   * The picker's rows carry an `aria-label` because they have no visible `Field`
   * beside them; every other control in the drawers is labelled by the shared
   * `Field`, whose `<label>` names the control through `htmlFor`. A test that could
   * only find one of the two would silently skip half the form.
   */
  const controlled = (name) => {
    const byAria = nodes(tree).find((node) => node.props["aria-label"] === name);
    if (byAria) return byAria;
    const label = nodes(tree).find(
      (node) => node.type === "label" && node.props.htmlFor && text(node).replace(/\*$/, "").trim() === name
    );
    if (!label) return undefined;
    return nodes(tree).find((node) => node.props.id === label.props.htmlFor);
  };
  function find(predicate) { render(); const node = nodes(tree).find(predicate); assert.ok(node, "control exists"); return node; }
  function want(name) { render(); const node = controlled(name); assert.ok(node, `control ${name} exists`); return node; }

  const ui = {
    requests, saves, changes,
    text: (node = tree) => text(node),
    textOf: (node) => text(node),
    nodes: () => nodes(tree),
    find, render,
    has(name) { render(); return Boolean(controlled(name)); },
    button: (name) => find((node) => node.type === "button" && text(node).trim() === name),
    click(name) { const button = ui.button(name); assert.ok(!button.props.disabled, `${name} is disabled`); button.props.onClick(); render(); },
    press(label) { const button = want(label); assert.equal(button.type, "button"); assert.ok(!button.props.disabled, `${label} is disabled`); button.props.onClick(); render(); },
    control: want,
    value(name) { return want(name).props.value; },
    checked(name) { return Boolean(want(name).props.checked); },
    check(name) { const box = want(name); assert.ok(!box.props.disabled, `${name} is disabled`); box.props.onChange({ target: { checked: true } }); render(); },
    uncheck(name) { const box = want(name); assert.ok(box.props.checked, `${name} is not checked`); box.props.onChange({ target: { checked: false } }); render(); },
    type(name, next) { const control = want(name); control.props.onChange({ target: { value: next } }); render(); },
    submit() {
      const form = find((node) => node.type === "form" && typeof node.props.onSubmit === "function");
      form.props.onSubmit();
      render();
    },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    async settle() { for (let i = 0; i < 24; i++) { await Promise.resolve(); render(); } },
    async wait(ms = 700) { await new Promise((done) => setTimeout(done, ms)); await ui.settle(); },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
    get lateWrites() { return lateWrites; },
    get closes() { return closes; },
    get refreshes() { return refreshes; },
  };
  render();
  return ui;
}

/** Every `<option>` value a control prints, in the order it prints them. */
function optionValues(node) {
  const walk = (value) =>
    Array.isArray(value)
      ? value.flatMap(walk)
      : value && typeof value === "object"
        ? value.type === "option"
          ? [value]
          : walk(value.props?.children)
        : [];
  return walk(node.props.children).map((option) => String(option.props.value));
}

/** The last thing the picker handed up, as plain rows. */
function picked(ui) {
  assert.ok(ui.changes.length, "the picker reported a change");
  return ui.changes[ui.changes.length - 1];
}

/** The opening's form, filled in and settled. */
function opening(options) {
  return harness("form", options);
}

/** The applicants desk, with its shortlist already read. */
async function desk(requiredSkills, rows, options = {}) {
  const ui = harness("applicants", { required: requiredSkills, ...options });
  ui.requests[0].resolve({ ok: true, applicants: rows });
  await ui.settle();
  return ui;
}

/** The first applicant's expanded submission, read on open. */
async function opened(ui, body) {
  const row = ui.find((node) => node.type === "button" && ui.textOf(node).includes("Candidate 1"));
  row.props.onClick();
  await ui.settle();
  const request = ui.requests.find((entry) => entry.kind === "submission");
  assert.ok(request, "opening a row reads its submission");
  request.resolve({ ok: true, submission: body });
  await ui.settle();
}

/**
 * The test-evidence section, and only it.
 *
 * The Drawer stub wraps the whole drawer in `<section role="dialog">`, and the
 * requisition section prints the same "Revenue management · required 4" prefix,
 * so a drawer-wide match would prove nothing about the new line. Scoping to the
 * section whose heading is "From this applicant’s tests" is the only way to ask
 * whether this line was drawn by the test read.
 */
function evidenceSection(ui) {
  ui.render();
  const section = ui.nodes().find(
    (node) =>
      node.type === "section" &&
      node.props.role !== "dialog" &&
      ui.textOf(node).includes("From this applicant’s tests")
  );
  assert.ok(section, "the test-evidence section is on screen");
  return section;
}

/* -------------------------------------------------------------------------- */
/* 1. The picker                                                               */
/* -------------------------------------------------------------------------- */

test("the picker offers every catalogue skill, in the catalogue's own order", () => {
  const ui = harness("picker");
  const boxes = ui.nodes().filter((node) => node.type === "input" && node.props.type === "checkbox");
  assert.deepEqual(
    boxes.map((node) => node.props["aria-label"]),
    CATALOGUE.map((skill) => `Require ${skill.name}`)
  );
  for (const skill of CATALOGUE) assert.equal(ui.checked(`Require ${skill.name}`), false);
  ui.unmount();
});

test("checking a skill asks for it at the level the column defaults to", () => {
  const ui = harness("picker");
  ui.check("Require Team leadership");
  assert.deepEqual(picked(ui), [
    { skill_id: "s-leadership", required_level: DEFAULT_REQUIRED_LEVEL, source: "RECRUITER" },
  ]);
  ui.unmount();
});

test("unchecking the same box is how a skill comes back off", () => {
  const ui = harness("picker", { required: REQUIRED });
  assert.equal(ui.checked("Require Excel (advanced)"), true);
  ui.uncheck("Require Excel (advanced)");
  assert.deepEqual(picked(ui), [{ skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" }]);
  ui.unmount();
});

test("a level set on screen leaves as a number, not the string the field holds", () => {
  const ui = harness("picker", { required: REQUIRED });
  ui.type("Required level for Excel (advanced)", "5");
  const [first] = picked(ui);
  assert.equal(first.required_level, 5);
  assert.equal(typeof first.required_level, "number");
  ui.unmount();
});

test("the level offers the whole scale the database accepts", () => {
  const ui = harness("picker", { required: REQUIRED });
  const select = ui.control("Required level for Excel (advanced)");
  assert.deepEqual(optionValues(select), SKILL_LEVELS.map(String));
  assert.equal(String(select.props.value), String(REQUIRED[0].required_level));
  ui.unmount();
});

test("at the ceiling every other skill is disabled and the ceiling is said", () => {
  const ui = harness("picker", { catalogue: MANY, required: FULL_LIST });
  assert.equal(ui.has("Require Skill 13"), true, "the two skills past the list are still shown");
  assert.ok(ui.control("Require Skill 13").props.disabled, "a thirteenth pick is not offered");
  assert.match(ui.text(), new RegExp(`at most ${MAX_REQUIRED_SKILLS} skills`));
  ui.unmount();
});

test("a full list can still be shortened", () => {
  const ui = harness("picker", { catalogue: MANY, required: FULL_LIST });
  assert.equal(ui.checked("Require Skill 1"), true);
  ui.uncheck("Require Skill 1");
  assert.equal(picked(ui).length, MAX_REQUIRED_SKILLS - 1);
  // The picker is controlled, so the shortening only reaches the screen the way it
  // does in the form: the row list the picker handed up comes back down as props.
  ui.update({ required: picked(ui) });
  assert.equal(ui.control("Require Skill 13").props.disabled, false, "room made is room offered");
  ui.unmount();
});

test("a suggestion quotes the requirement line it was found in", () => {
  const ui = harness("picker");
  assert.match(ui.text(), /Revenue management/);
  assert.match(ui.text(), /Owns revenue management for the marina/);
  assert.match(ui.text(), /Advanced Excel work/);
  ui.unmount();
});

test("accepting the suggestions marks them as the matcher's, not the recruiter's", () => {
  const ui = harness("picker");
  ui.click("Add the skills these lines name");
  const rows = picked(ui);
  assert.deepEqual(
    rows.map((row) => [row.skill_id, row.source]),
    [["s-excel", "CATALOGUE_MATCH"], ["s-revenue", "CATALOGUE_MATCH"]]
  );
  assert.ok(rows.every((row) => row.required_level === DEFAULT_REQUIRED_LEVEL));
  ui.unmount();
});

test("a suggestion cannot move a level a recruiter already set", () => {
  const ui = harness("picker", {
    required: [{ skill_id: "s-excel", required_level: 5, source: "RECRUITER" }],
  });
  ui.click("Add the skills these lines name");
  const excel = picked(ui).find((row) => row.skill_id === "s-excel");
  assert.equal(excel.required_level, 5);
  assert.equal(excel.source, "RECRUITER");
  assert.ok(picked(ui).some((row) => row.skill_id === "s-revenue"));
  ui.unmount();
});

test("a suggestion that would run past the ceiling adds nothing and says the ceiling", () => {
  const lines = ["Works with Skill 13 daily"];
  const ui = harness("picker", { catalogue: MANY, required: FULL_LIST, requirements: lines });
  ui.click("Add the skills these lines name");
  assert.equal(ui.changes.length, 0, "the list was not handed up");
  assert.match(ui.text(), new RegExp(`at most ${MAX_REQUIRED_SKILLS} skills`));
  ui.unmount();
});

test("a skill retired since it was required still prints its name and comes off", () => {
  const ui = harness("picker", {
    required: [{ skill_id: "s-pms", required_level: 2, source: "RECRUITER" }],
  });
  assert.match(ui.text(), /Micros Opera PMS/);
  assert.doesNotMatch(ui.text(), /s-pms/);
  assert.equal(ui.has("Require Micros Opera PMS"), false, "a retired skill is not offered again");
  ui.press("Remove Micros Opera PMS");
  assert.deepEqual(picked(ui), []);
  ui.unmount();
});

test("a matched row says where it came from and a chosen one does not", () => {
  const ui = harness("picker", { required: REQUIRED });
  const rows = ui.nodes().filter((node) => node.type === "li");
  const matched = rows.filter((node) => ui.textOf(node).includes("NPV / IRR analysis")).pop();
  const chosen = rows.filter((node) => ui.textOf(node).includes("Excel (advanced)")).pop();
  assert.ok(matched && chosen, "both rows are on screen");
  assert.match(ui.textOf(matched), /requirement line/);
  assert.doesNotMatch(ui.textOf(chosen), /requirement line/);
  ui.unmount();
});

test("while 037 is unapplied the picker names the file and offers no checkbox", () => {
  const ui = harness("picker", { note: OPENING_SKILLS_SCHEMA_NOTE });
  assert.ok(ui.text().includes(OPENING_SKILLS_SCHEMA_NOTE));
  assert.match(ui.text(), /037_opening_skills\.sql/);
  assert.equal(ui.has("Require Excel (advanced)"), false);
  assert.equal(ui.nodes().some((node) => node.type === "button"), false);
  ui.unmount();
});

/* -------------------------------------------------------------------------- */
/* 2. The job form                                                             */
/* -------------------------------------------------------------------------- */

test("editing an opening loads the skills it already carries", () => {
  const ui = opening({ job: job({ required_skills: REQUIRED }) });
  assert.equal(ui.checked("Require Excel (advanced)"), true);
  assert.equal(ui.checked("Require NPV / IRR analysis"), true);
  assert.equal(ui.value("Required level for Excel (advanced)"), "4");
  ui.unmount();
});

test("saving an opening whose skills were not touched asks the writer for nothing", async () => {
  const ui = opening({ job: job({ required_skills: REQUIRED }) });
  assert.equal(ui.checked("Require Excel (advanced)"), true, "the list was loaded, so this is a real no-op");
  ui.type("Job title", "Revenue manager");
  ui.submit();
  const update = ui.requests.find((request) => request.kind === "update");
  assert.ok(update, "the opening itself is written");
  update.resolve({ ok: true, id: "job-1" });
  await ui.settle();
  assert.equal(ui.saves.filter((save) => save.verb === "skills").length, 0);
  ui.unmount();
});

test("a changed list is written after the opening, against the id the opening returned", async () => {
  const ui = opening({ job: job({ required_skills: REQUIRED }) });
  ui.check("Require Team leadership");
  ui.submit();
  const update = ui.requests.find((request) => request.kind === "update");
  update.resolve({ ok: true, id: "job-1" });
  await ui.settle();
  const skillWrite = ui.saves.find((save) => save.verb === "skills");
  assert.ok(skillWrite, "the list that moved is written");
  assert.equal(skillWrite.id, "job-1");
  // The payload the opening write was handed, not the skills write's tuple.
  assert.equal(update.detail.title, "Revenue manager");
  assert.deepEqual(
    skillWrite.rows.map((row) => [row.skill_id, row.required_level, row.source]),
    [["s-excel", 4, "RECRUITER"], ["s-npv", 3, "CATALOGUE_MATCH"], ["s-leadership", DEFAULT_REQUIRED_LEVEL, "RECRUITER"]]
  );
  // The order is the opening's own, then the new pick — the writer refuses a duplicate,
  // not a reordering, so what the recruiter saw is what went on the wire.
  assert.ok(ui.saves.findIndex((save) => save.verb === "update") < ui.saves.indexOf(skillWrite));
  ui.unmount();
});

test("a create carries its skills to the id the create returned", async () => {
  const ui = opening({ job: null });
  ui.type("Job title", "Front office lead");
  ui.check("Require Team leadership");
  ui.submit();
  const create = ui.requests.find((request) => request.kind === "create");
  create.resolve({ ok: true, id: "job-new" });
  await ui.settle();
  const skillWrite = ui.saves.find((save) => save.verb === "skills");
  assert.equal(skillWrite.id, "job-new");
  assert.deepEqual(skillWrite.rows, [
    { skill_id: "s-leadership", required_level: DEFAULT_REQUIRED_LEVEL, source: "RECRUITER" },
  ]);
  ui.unmount();
});

test("a refused skill list keeps the drawer open and says the opening itself saved", async () => {
  const ui = opening({ job: job({ required_skills: REQUIRED }) });
  ui.check("Require Team leadership");
  ui.submit();
  const update = ui.requests.find((request) => request.kind === "update");
  update.resolve({ ok: true, id: "job-1" });
  await ui.settle();
  const skillWrite = ui.requests.find((request) => request.kind === "skills");
  skillWrite.resolve({ ok: false, error: OPENING_SKILLS_SCHEMA_NOTE });
  await ui.settle();
  assert.equal(ui.closes, 0, "a drawer that closed on a half-saved opening hides the refusal");
  assert.match(ui.text(), /opening (itself )?saved/i);
  assert.match(ui.text(), /037_opening_skills\.sql/);
  ui.unmount();
});

test("an opening with nothing to add and no table to add it to writes nothing", async () => {
  const ui = opening({
    formOptions: formOptions({ skillsNote: OPENING_SKILLS_SCHEMA_NOTE, skills: [], skillLabels: [] }),
    job: job({ required_skills: [] }),
  });
  assert.equal(ui.has("Require Excel (advanced)"), false);
  assert.match(ui.text(), /037_opening_skills\.sql/);
  ui.submit();
  const update = ui.requests.find((request) => request.kind === "update");
  update.resolve({ ok: true, id: "job-1" });
  await ui.settle();
  assert.equal(ui.saves.filter((save) => save.verb === "skills").length, 0);
  ui.unmount();
});

/* -------------------------------------------------------------------------- */
/* 3. The applicants desk                                                      */
/* -------------------------------------------------------------------------- */

test("each applicant is read against the requisition's own skills", async () => {
  const ui = await desk(
    [{ skill_id: "s-leadership", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [{ skill_id: "s-leadership", proficiency: 5 }] })]
  );
  assert.match(ui.text(), /Meets 1 of 1/);
  assert.match(ui.text(), /Team leadership/);
  assert.match(ui.text(), /required 4/);
  assert.match(ui.text(), /shown 5/);
  ui.unmount();
});

test("a skill nobody recorded reads as no evidence, never as a gap", async () => {
  const ui = await desk(
    [{ skill_id: "s-leadership", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [] })]
  );
  assert.match(ui.text(), /no evidence/i);
  assert.doesNotMatch(ui.text(), /gap|missing|lacks/i);
  assert.doesNotMatch(ui.text(), /null|undefined|NaN/);
  ui.unmount();
});

test("an applicant with nothing recorded at all is described as unrecorded", async () => {
  const ui = await desk(REQUIRED, [applicant({ demonstrated: [] })]);
  assert.match(ui.text(), /No skill evidence recorded yet/);
  assert.match(ui.text(), /2 required skills/);
  ui.unmount();
});

test("an opening that requires no skills says nothing about skills", async () => {
  const ui = await desk([], [applicant({ demonstrated: [{ skill_id: "s-excel", proficiency: 3 }] })]);
  assert.doesNotMatch(ui.text(), /required \d/);
  assert.doesNotMatch(ui.text(), /Meets \d/);
  assert.doesNotMatch(ui.text(), /No skill evidence recorded yet/);
  ui.unmount();
});

test("the detail lists every required skill beside what this applicant showed", async () => {
  const ui = await desk(
    REQUIRED,
    [applicant({ demonstrated: [{ skill_id: "s-excel", proficiency: 2 }] })]
  );
  const row = ui.find((node) => node.type === "button" && ui.textOf(node).includes("Candidate 1"));
  row.props.onClick();
  ui.requests[1].resolve({ ok: true, submission });
  await ui.settle();
  assert.match(ui.text(), /Against the requisition’s skills/);
  assert.match(ui.text(), /below 1/);
  assert.match(ui.text(), /Excel \(advanced\) · required 4 · shown 2/);
  assert.match(ui.text(), /NPV /);
  assert.match(ui.text(), /no evidence/);
  ui.unmount();
});

test("a reviewer whose scores are masked reads the ask without the candidate's levels", async () => {
  const ui = await desk(
    [{ skill_id: "s-leadership", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [{ skill_id: "s-leadership", proficiency: 5 }], scores_masked: true, ai_match_score: null, attempt_score: null })]
  );
  assert.match(ui.text(), /Team leadership/);
  assert.match(ui.text(), /required 4/);
  assert.doesNotMatch(ui.text(), /shown 5/);
  assert.doesNotMatch(ui.text(), /Meets 1/);
  assert.doesNotMatch(ui.text(), /Hidden of|null|undefined|NaN/);
  assert.match(ui.text(), /not granted/i);
  ui.unmount();
});

test("the expanded applicant shows test evidence beside the CV level", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [
      applicant({
        attempt_token: "tok-1",
        attempt_status: "SUBMITTED",
        attempt_score: 52,
        attempt_max: 70,
        demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }],
      }),
    ]
  );
  await opened(ui, {
    ...submission,
    skill_evidence: [EVIDENCE_LINE],
    skill_evidence_coverage:
      "From 2 tagged criteria on 2 questions. A percentage is evidence from these papers, not a proficiency level.",
  });
  const text = ui.textOf(evidenceSection(ui));
  assert.match(text, /Revenue management · required 4 · shown 3 · test evidence 80% \(2 questions\)/);
  assert.match(text, /not a proficiency level/);
  // The CV verdict is still the CV verdict — and this fixture is below on its one
  // required skill, so the exact sentence is the claim, not a word that happens to
  // appear somewhere in the drawer.
  assert.match(ui.text(), /Meets 0 of 1, below 1, no evidence for 0\./);
  // An unmasked reviewer keeps the figure: the attempt gate must not hide a real score.
  assert.match(ui.textOf(ui.nodes()), /52\/70/);
  const screening = ui.nodes().find(
    (node) =>
      node.type === "section" &&
      node.props.role !== "dialog" &&
      ui.textOf(node).includes("AI screening")
  );
  assert.ok(screening, "the AI screening section is on screen");
  assert.match(ui.textOf(screening), /62%/);
  ui.unmount();
});

test("a masked reviewer reads the skill and the count, never the level or the figure", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [
      applicant({
        scores_masked: true,
        ai_match_score: null,
        demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }],
      }),
    ]
  );
  await opened(ui, {
    ...submission,
    skill_evidence: [
      {
        ...EVIDENCE_LINE,
        awarded: null,
        allowance: null,
        percent: null,
        // The real mapper (`maskCriterionMarks`) nulls the contribution marks too,
        // so a fixture that only zeroed the totals would not be the paper a masked
        // reviewer receives.
        contributions: EVIDENCE_LINE.contributions.map((contribution) => ({
          ...contribution,
          awarded: null,
          allowance: null,
        })),
      },
    ],
  });
  const text = ui.textOf(evidenceSection(ui));
  assert.match(text, /Revenue management · required 4 · test evidence Hidden \(2 questions\)/);
  assert.doesNotMatch(text, /shown 3|80%/);
  assert.doesNotMatch(ui.text(), /null|undefined|NaN/);
  ui.unmount();
});

test("evidence for a skill the CV never named is still evidence, and never a CV verdict", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }] })]
  );
  await opened(ui, {
    ...submission,
    skill_evidence: [
      {
        skill_id: "s-ats",
        skill_name: "ATS / HRIS tooling",
        awarded: 7,
        allowance: 10,
        percent: 70,
        questionCount: 1,
        sittingCount: 1,
        contributions: [
          {
            question_title: "Tooling",
            criterion_label: "Data entry",
            awarded: 7,
            allowance: 10,
            evidence: null,
          },
        ],
      },
    ],
  });
  const text = ui.textOf(evidenceSection(ui));
  assert.match(text, /ATS \/ HRIS tooling · test evidence 70% \(1 question\)/);
  // The line is not against the requisition, so it carries no "required".
  assert.doesNotMatch(text, /required/);
  assert.match(ui.text(), /Meets 0 of 1, below 1, no evidence for 0\./);
  ui.unmount();
});

test("an unmasked paper with no mark says so instead of claiming it was withheld", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }] })]
  );
  await opened(ui, {
    ...submission,
    skill_evidence: [
      {
        ...EVIDENCE_LINE,
        awarded: null,
        allowance: null,
        percent: null,
        contributions: EVIDENCE_LINE.contributions.map((contribution) => ({
          ...contribution,
          awarded: null,
          allowance: null,
        })),
      },
    ],
  });
  const text = ui.textOf(evidenceSection(ui));
  assert.match(text, /test evidence no mark on file \(2 questions\)/);
  assert.doesNotMatch(text, /Hidden/);
  ui.unmount();
});

test("a submission read that says masked hides the figure even when the list row does not", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [
      applicant({
        scores_masked: false,
        ai_match_score: 62,
        attempt_token: "tok-1",
        attempt_status: "SUBMITTED",
        attempt_score: 52,
        attempt_max: 70,
        demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }],
      }),
    ]
  );
  await opened(ui, {
    ...submission,
    skill_evidence_masked: true,
    skill_evidence: [EVIDENCE_LINE],
  });
  const text = ui.textOf(evidenceSection(ui));
  assert.match(text, /Revenue management · required 4 · test evidence Hidden \(2 questions\)/);
  assert.doesNotMatch(text, /80%/);
  assert.doesNotMatch(text, /shown 3/);
  assert.doesNotMatch(ui.text(), /80%/);

  // The whole drawer, not only the evidence line: the stale list read must not
  // leak the requisition's level, the collapsed row's level or the match figure.
  const drawer = ui.textOf(ui.nodes());
  assert.doesNotMatch(drawer, /shown 3/);
  assert.doesNotMatch(drawer, /62%/);
  assert.doesNotMatch(drawer, /52\/70/);
  const screening = ui.nodes().find(
    (node) =>
      node.type === "section" &&
      node.props.role !== "dialog" &&
      ui.textOf(node).includes("AI screening")
  );
  assert.ok(screening, "the AI screening section is on screen");
  assert.match(ui.textOf(screening), /Hidden — your role is not granted “View unmasked scores”\./);
  ui.unmount();
});

test("a capped read says the figure covers what it read, even with no line to show", async () => {
  const ui = await desk(
    [{ skill_id: "s-revenue", required_level: 4, source: "RECRUITER" }],
    [applicant({ demonstrated: [{ skill_id: "s-revenue", proficiency: 3 }] })]
  );
  await opened(ui, {
    ...submission,
    skill_evidence: [],
    skill_evidence_note:
      "Skill evidence covers the 500 most recent graded responses; this applicant has more.",
  });
  assert.match(ui.textOf(evidenceSection(ui)), /500 most recent graded responses/);
  ui.unmount();
});

// ---------------------------------------------------------------------------
// The manual: what the Guide panel tells a recruiter about these two surfaces
// ---------------------------------------------------------------------------
test("the Guide's jobs entry describes the skills picker and the drawer as built", () => {
  const guide = readFileSync(resolve(root, "src/modules/shell/domain/pageGuide.ts"), "utf8");
  const from = guide.indexOf('  "/jobs": {');
  const to = guide.indexOf('  "/questions": {');
  assert.ok(from >= 0 && to > from, "the Guide lost its jobs entry");
  const jobs = guide.slice(from, to);

  // Three things a recruiter cannot read off the screen: that the list is not on
  // this database yet, where the ceiling bites, and what "no evidence" claims.
  for (const needle of [
    "037_opening_skills.sql",
    "Add the skills these lines name",
    "A requisition lists at most 12 skills",
    "Against the requisition's skills",
    "no evidence",
    "withholds what each person showed",
  ]) {
    assert.ok(jobs.includes(needle), `the jobs entry never says ${JSON.stringify(needle)}`);
  }
});
