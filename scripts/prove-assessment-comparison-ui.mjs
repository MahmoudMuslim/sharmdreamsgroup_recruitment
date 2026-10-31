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
const link = (n, overrides = {}) => ({ id: `attempt-${n}`, application_id: `app-${n}`, job_id: "job-a", template_id: "suite-a", candidate_name: `Candidate ${n}`, identity_blind: false, job_title: "Guest relations", template_name: "Guest service", status: "SUBMITTED", time_limit_minutes: 30, issued_at: "2026-10-23T10:00:00Z", started_at: null, expires_at: null, submitted_at: null, score: null, max_score: null, answers: 1, questions: 1, integrity_flags: 0, ...overrides });
const rows = [...[1, 2, 3, 4, 5].map((n) => link(n)), link(6, { job_id: "job-b" }), link(7, { template_id: "suite-b" }), link(8, { application_id: "app-1" })];
const answer = { question_id: "q1", title: "Guest complaint", prompt: "Resolve a complaint", question_type: "CASE_STUDY", answered: true, answer_text: "Listen and investigate", chosen_text: null, cells: [], video_url: null, transcript: null, score: null, max_score: 10, rationale: "Explain your reasoning", strengths: ["Empathy"], improvements: ["More detail"], criteria: [] };
const success = { ok: true, papers: [
  { attempt_id: "attempt-1", candidate_name: "Candidate 1", identity_blind: true, job_title: "Guest relations", template_name: "Guest service", status: "SUBMITTED", scores_masked: false, score: null, max_score: 10, answers: [answer] },
  { attempt_id: "attempt-2", candidate_name: "Candidate 2", identity_blind: false, job_title: "Guest relations", template_name: "Guest service", status: "GRADED", scores_masked: false, score: 0, max_score: 10, answers: [{ ...answer, score: 0, answer_text: "Ignore it" }] },
] };

function harness(which = "board") {
  const slots = [], effects = [], requests = [], cache = new Map();
  let cursor = 0, dirty = true, mounted = true, tree, lateWrites = 0, closes = 0;
  let props = which === "board" ? { read: { rows, total: rows.length, scores_masked: false, blind_marking: false }, timeZone: "UTC" } : { attemptIds: ["attempt-1", "attempt-2"], onClose: () => { closes++; } };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (value) => { if (!mounted) lateWrites++; slot.value = typeof value === "function" ? value(slot.value) : value; dirty = true; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(create, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { value: create(), deps }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) { slots[index] = { deps, create, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  hooks.useLayoutEffect = hooks.useEffect;
  const actions = { getAttemptComparison(ids) { const request = { ids }; request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; }); requests.push(request); return request.promise; }, getAttemptAnswers: async () => null };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (!existsSync(file)) return {};
    const loaded = { exports: {} }; cache.set(file, loaded.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const local = (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (name === "next/link") return { __esModule: true, default: (props) => jsx("a", props) };
      if (name === "./actions") return actions;
      if (name === "./ComparisonDrawer" && which === "board") return { ComparisonDrawer: (props) => jsx("comparison-drawer", props) };
      if (name.endsWith("/Drawer")) return { Drawer: (props) => jsx("section", { role: "dialog", ...props, children: [props.title, props.subtitle, props.children, props.footer] }) };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(file), name);
        // A module may name its sibling with the extension it actually has, so try
        // the spelled path before adding one — otherwise the same file loads twice
        // under two names, or not at all.
        const target = [base, `${base}.tsx`, `${base}.ts`].find(existsSync);
        if (!target) throw new Error(`Unresolved ${name}`);
        return load(target);
      }
      return require(name);
    };
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }
  const Component = load(resolve(root, `src/app/(admin)/assessments/${which === "board" ? "IssuedLinksBoard" : "ComparisonDrawer"}.tsx`))[which === "board" ? "IssuedLinksBoard" : "ComparisonDrawer"];
  assert.equal(typeof Component, "function", "comparison component exists");
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.type === Fragment) return expand(node.props.children);
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? "" : typeof node === "object" ? text(node.props.children) : String(node);
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props.children)];
  function render() { let count = 0; while (dirty && mounted) { assert.ok(count++ < 20); dirty = false; cursor = 0; tree = expand(Component(props)); effects.splice(0).forEach((effect) => effect()); } }
  function find(predicate) { render(); const node = nodes(tree).find(predicate); assert.ok(node, "control exists"); return node; }
  const ui = { requests, text: (node = tree) => text(node), nodes: () => nodes(tree), find, render,
    button: (name) => find((node) => node.type === "button" && text(node).trim() === name),
    check: (n) => find((node) => node.type === "input" && node.props["aria-label"] === `Compare Candidate ${n}`),
    toggle(n) { const checkbox = ui.check(n); checkbox.props.onChange({ target: { checked: !checkbox.props.checked } }); render(); },
    click(name) { const button = ui.button(name); assert.ok(!button.props.disabled); button.props.onClick(); render(); },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
    get lateWrites() { return lateWrites; }, get closes() { return closes; },
  };
  render(); return ui;
}

test("board enables comparison only at two to four compatible applicants", () => {
  const ui = harness(); assert.equal(ui.button("Compare selected (0)").props.disabled, true);
  ui.toggle(1); assert.equal(ui.button("Compare selected (1)").props.disabled, true);
  for (const n of [6, 7, 8]) assert.equal(ui.check(n).props.disabled, true);
  ui.toggle(2); assert.equal(ui.button("Compare selected (2)").props.disabled, false);
  ui.toggle(3); ui.toggle(4); assert.equal(ui.check(5).props.disabled, true);
  ui.click("Compare selected (4)");
  assert.deepEqual(ui.find((node) => node.type === "comparison-drawer").props.attemptIds, ["attempt-1", "attempt-2", "attempt-3", "attempt-4"]);
  assert.equal(ui.requests.length, 0); ui.unmount();
});
test("comparison closes back to its opener", () => {
  const ui = harness(); ui.toggle(1); ui.toggle(2); let focuses = 0;
  ui.button("Compare selected (2)").props.ref.current = { focus: () => { focuses++; } };
  ui.click("Compare selected (2)"); ui.find((node) => node.type === "comparison-drawer").props.onClose(); ui.render();
  assert.equal(focuses, 1); assert.equal(ui.nodes().some((node) => node.type === "comparison-drawer"), false); ui.unmount();
});
test("comparison traps Tab at both ends, including a loading panel", () => {
  const ui = harness("drawer"); const wrapper = ui.find((node) => typeof node.props.onKeyDown === "function");
  let focused, prevented = false;
  const first = { focus: () => { focused = "first"; }, getClientRects: () => [1] };
  const last = { focus: () => { focused = "last"; }, getClientRects: () => [1] };
  const panel = { querySelectorAll: () => [first, last] };
  const dispatch = (target, shiftKey = false) => { focused = null; prevented = false; wrapper.props.onKeyDown({ key: "Tab", target, shiftKey, currentTarget: { querySelector: () => panel }, preventDefault: () => { prevented = true; } }); };
  dispatch(last); assert.equal(focused, "first"); assert.equal(prevented, true);
  dispatch(first, true); assert.equal(focused, "last");
  dispatch(panel, true); assert.equal(focused, "last");
  dispatch(first); assert.equal(prevented, false);
  panel.querySelectorAll = () => [first]; dispatch(first); assert.equal(focused, "first");
  ui.unmount();
});
test("filtering clears selection so hidden candidates cannot be compared", () => {
  const ui = harness(); ui.toggle(1); ui.toggle(2);
  ui.find((node) => node.props["aria-label"] === "Search issued links").props.onChange({ target: { value: "Candidate 5" } }); ui.render();
  assert.equal(ui.button("Compare selected (0)").props.disabled, true); ui.unmount();
});
test("status rail and explicit clear remove selection", () => {
  const ui = harness(); ui.toggle(1); ui.click("Clear selection"); assert.equal(ui.check(1).props.checked, false);
  ui.toggle(1); ui.click("Answered8");
  assert.equal(ui.button("Answered8").props["aria-pressed"], true);
  assert.equal(ui.button("Compare selected (0)").props.disabled, true); ui.unmount();
});
test("fresh board data invalidates removed selections", () => {
  const ui = harness(); ui.toggle(1); ui.toggle(2);
  ui.update({ read: { rows: [link(2)], total: 1, scores_masked: false, blind_marking: false } });
  assert.equal(ui.button("Compare selected (0)").props.disabled, true); ui.unmount();
});
test("comparison reads on open and renders aligned evidence, pending, true zero and blind note", async () => {
  const ui = harness("drawer"); assert.equal(ui.requests.length, 1); assert.match(ui.text(), /Reading/);
  ui.requests[0].resolve(success); await ui.settle();
  assert.equal(ui.nodes().filter((node) => node.type === "table").length, 1);
  for (const value of ["Pending", "0 / 10", "Listen and investigate", "Ignore it", "Explain your reasoning", "Empathy", "More detail", "current", "not anonymised"]) assert.ok(ui.text().includes(value), value);
  assert.equal(ui.nodes().filter((node) => node.type === "th" && node.props.scope === "col").length, 3);
  ui.unmount();
});
for (const rejects of [false, true]) {
  test(`reload clears stale data before ${rejects ? "exception" : "refusal"} and can retry`, async () => {
    const ui = harness("drawer"); ui.requests[0].resolve(success); await ui.settle();
    ui.click("Re-read"); assert.doesNotMatch(ui.text(), /Listen and investigate/);
    if (rejects) ui.requests[1].reject(new Error("PRIVATE failure")); else ui.requests[1].resolve({ ok: false, error: "Paper no longer available." });
    await ui.settle(); assert.ok(ui.find((node) => node.props.role === "alert")); assert.doesNotMatch(ui.text(), /PRIVATE/);
    ui.click("Re-read"); ui.requests[2].resolve(success); await ui.settle(); assert.match(ui.text(), /Listen and investigate/); ui.unmount();
  });
  test(`unmounted ${rejects ? "exception" : "success"} cannot write state`, async () => {
    const ui = harness("drawer"); ui.unmount();
    if (rejects) ui.requests[0].reject(new Error("late")); else ui.requests[0].resolve(success);
    await ui.settle(); assert.equal(ui.lateWrites, 0);
  });
}
test("empty papers state does not claim candidates answered nothing", async () => {
  const ui = harness("drawer"); ui.requests[0].resolve({ ok: true, papers: success.papers.map((paper) => ({ ...paper, answers: [] })) }); await ui.settle();
  assert.match(ui.text(), /No question data/i); ui.unmount();
});
test("comparison renders choice, spreadsheet changes, recording and transcript without answer keys", async () => {
  const ui = harness("drawer");
  ui.requests[0].resolve({ ok: true, papers: success.papers.map((paper) => ({ ...paper, answers: [
    { ...answer, question_id: "quiz", question_type: "MULTIPLE_CHOICE", answer_text: null, chosen_text: "Ask the guest" },
    { ...answer, question_id: "sjt", question_type: "SITUATIONAL_JUDGMENT", answer_text: null, chosen_text: "Investigate first" },
    { ...answer, question_id: "sheet", question_type: "EXCEL_MODEL", answer_text: null, cells: [{ ref: "B1", value: "200" }, { ref: "C1", value: "" }] },
    { ...answer, question_id: "video", question_type: "VIDEO_PITCH", answer_text: null, video_url: "/fixture-recording", transcript: "Recorded explanation" },
  ] })) }); await ui.settle();
  for (const value of ["Ask the guest", "Investigate first", "B1", "200", "C1", "Cleared", "Recorded explanation"]) assert.ok(ui.text().includes(value), value);
  const video = ui.find((node) => node.type === "video"); assert.equal(video.props.controls, true); assert.equal(video.props.preload, "none");
  assert.equal(ui.nodes().filter((node) => node.type === "a").length, 0);
  ui.unmount();
});
test("a stored blank case-study response explicitly says no written text was recorded", async () => {
  const ui = harness("drawer");
  ui.requests[0].resolve({ ok: true, papers: success.papers.map((paper) => ({ ...paper, answers: [{ ...answer, answered: true, answer_text: null }] })) });
  await ui.settle();
  assert.match(ui.text(), /No written text recorded/);
  assert.doesNotMatch(ui.text(), /No answer recorded/);
  ui.unmount();
});
test("masked results show Hidden and unanswered data stays explicit", async () => {
  const ui = harness("drawer"); ui.requests[0].resolve({ ok: true, papers: success.papers.map((paper) => ({ ...paper, scores_masked: true, score: null, max_score: null, answers: [{ ...answer, answered: false, answer_text: null, score: null, max_score: null }] })) }); await ui.settle();
  assert.match(ui.text(), /Hidden/); assert.match(ui.text(), /No answer recorded/); assert.doesNotMatch(ui.text(), /0 \/ 10|No written text recorded/); ui.unmount();
});
