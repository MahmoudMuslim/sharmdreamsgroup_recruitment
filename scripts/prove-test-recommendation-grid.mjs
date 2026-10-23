import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as textSearch from "../src/lib/textSearch.ts";

const suiteSearch = {};
const searchSource = readFileSync(new URL("../src/modules/assessment/domain/suiteSearch.ts", import.meta.url), "utf8");
new Script(ts.transpileModule(searchSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)
  .runInNewContext({ exports: suiteSearch, require: (name) => { assert.equal(name, "@/lib/textSearch"); return textSearch; } });
const source = readFileSync(new URL("../src/app/(admin)/assessments/AssessmentGrid.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness(canEdit, props = {}) {
  const state = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useMemo: (fn, dependencies) => {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        state[index] = { dependencies, value: fn() };
      }
      return state[index].value;
    }, useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/navigation": { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {} }) },
    "@/modules/assessment/domain/suiteSearch": suiteSearch,
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
  };
  const exports = {};
  new Script(code).runInNewContext({ exports, require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => `${name}:${String(key)}` }) });
  const render = () => {
    cursor = 0;
    return exports.AssessmentGrid({ templates: [], candidates: [], options: { companies: [], roleFamilies: [] }, questionsByTemplate: {}, defaultDurationMinutes: 45, canEdit, links: { total: 0 }, timeZone: "UTC", situational: { situational: true, note: null }, followUps: { rules_available: false, routing_available: false, byTemplate: {}, suites: [], note: null }, ...props });
  };
  return { render, update: (next) => { props = { ...props, ...next }; } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree?.props ? text(tree.props.children) : "";
}
const drawerType = "./TestRecommendationDrawer:TestRecommendationDrawer";
test("recommendation launcher is hidden without authoring permission", () => {
  const tree = harness(false).render();
  assert.equal(nodes(tree).filter((node) => node.type === "button" && /Recommend tests/.test(text(node))).length, 0);
  assert.equal(nodes(tree).filter((node) => node.type === drawerType).length, 0);
});
test("launcher opens the recommendation drawer and its close callback unmounts it", () => {
  const h = harness(true);
  let tree = h.render();
  const button = nodes(tree).find((node) => node.type === "button" && /Recommend tests/.test(text(node)));
  assert.ok(button, "missing Recommend tests launcher");
  assert.equal(nodes(tree).filter((node) => node.type === drawerType).length, 0);
  button.props.onClick();
  tree = h.render();
  const drawer = nodes(tree).find((node) => node.type === drawerType);
  assert.ok(drawer, "click did not mount recommendation drawer");
  assert.equal(drawer.props.defaultDurationMinutes, 45);
  drawer.props.onClose();
  assert.equal(nodes(h.render()).filter((node) => node.type === drawerType).length, 0);
});
test("existing create and authoring controls remain available", () => {
  const buttons = nodes(harness(true).render()).filter((node) => node.type === "button").map(text);
  assert.ok(buttons.includes("Draft a suite"));
  assert.ok(buttons.includes("New template"));
});

function catalogue() {
  const templates = [
    ["brief", "Guest service", "FRONT_OFFICE", 15, true],
    ["mixed", "Guest scenarios", "FRONT_OFFICE", 30, true],
    ["long", "Guest leadership", "FRONT_OFFICE", 31, true],
    ["paused", "Guest review", "FRONT_OFFICE", 20, false],
    ["finance", "Finance skills", "FINANCE", 30, true],
    ["empty", "Empty suite", "GENERAL", 10, true],
  ].map(([id, name, role_family, time_limit_minutes, is_active]) => ({
    id, tenant_id: "company-a", name, description: "Practical skills", role_family,
    time_limit_minutes, is_active, question_count: 0, total_points: 0, attempts: 0,
    completed: 0, randomize_questions: false, randomize_options: false, block_copy_paste: true,
  }));
  const questionsByTemplate = Object.fromEntries(Object.entries({
    brief: ["MULTIPLE_CHOICE"], mixed: ["MULTIPLE_CHOICE", "VIDEO_PITCH"],
    long: ["VIDEO_PITCH"], paused: ["VIDEO_PITCH"], finance: ["EXCEL_MODEL", "CASE_STUDY", "SITUATIONAL_JUDGMENT"],
  }).map(([template_id, formats]) => [template_id, formats.map((question_type, position) => ({
    id: `${template_id}-${position}`, template_id, question_type, title: "Exercise", prompt: "Demonstrate your skills.",
    instructions: null, config: {}, points: 10, position, time_limit_minutes: 2, shuffle_options: false,
  }))]));
  for (const template of templates) {
    template.question_count = questionsByTemplate[template.id]?.length ?? 0;
    template.total_points = template.question_count * 10;
  }
  return { templates, questionsByTemplate };
}
function control(tree, label) {
  const found = nodes(tree).find((node) => node.props?.["aria-label"] === label);
  assert.ok(found, `missing ${label} control`);
  return found;
}
function change(h, label, value) {
  control(h.render(), label).props.onChange({ target: { value } });
}
function shown(h) {
  return nodes(h.render()).filter((node) => node.type?.name === "TemplateCard").map((node) => node.props.template.id);
}
function clear(h) {
  const button = nodes(h.render()).find((node) => node.type === "button" && text(node) === "Clear filters");
  assert.ok(button, "clear must be available while filters are active");
  button.props.onClick();
}

test("duration includes the exact suite limit and excludes longer suites, not question timing", () => {
  const h = harness(true, catalogue());
  change(h, "Maximum suite duration", "30");
  assert.deepEqual(shown(h), ["brief", "mixed", "paused", "finance", "empty"]);
  change(h, "Maximum suite duration", "15");
  assert.deepEqual(shown(h), ["brief", "empty"]);
  change(h, "Maximum suite duration", "");
  assert.deepEqual(shown(h), ["brief", "mixed", "long", "paused", "finance", "empty"]);
});
for (const [format, expected] of [
  ["MULTIPLE_CHOICE", ["brief", "mixed"]], ["VIDEO_PITCH", ["mixed", "long", "paused"]],
  ["EXCEL_MODEL", ["finance"]], ["CASE_STUDY", ["finance"]], ["SITUATIONAL_JUDGMENT", ["finance"]],
]) {
  test(`format ${format} includes mixed suites and excludes those without that question format`, () => {
    const h = harness(false, catalogue());
    const picker = control(h.render(), "Filter by question format");
    assert.ok(nodes(picker).some((node) => node.type === "option" && node.props.value === format));
    change(h, "Filter by question format", format);
    assert.deepEqual(shown(h), expected);
  });
}
test("duration and format intersect with text, family and status filters", () => {
  const h = harness(true, catalogue());
  change(h, "Search suites", "guest");
  change(h, "Filter by role family", "FRONT_OFFICE");
  change(h, "Filter by status", "active");
  change(h, "Maximum suite duration", "30");
  change(h, "Filter by question format", "VIDEO_PITCH");
  assert.deepEqual(shown(h), ["mixed"]);
  change(h, "Filter by role family", "FINANCE");
  assert.deepEqual(shown(h), []);
});
test("result count reflects the filtered subset without changing catalogue totals", () => {
  const h = harness(true, catalogue());
  change(h, "Filter by question format", "VIDEO_PITCH");
  const tree = h.render();
  const count = nodes(tree).find((node) => node.props?.role === "status");
  assert.ok(count, "missing announced result count");
  assert.match(text(count), /3 of 6 suites/);
  const tile = nodes(tree).find((node) => node.props?.label === "Suites");
  assert.equal(tile.props.value, 6);
});
test("clear resets every filter even when matching suites remain", () => {
  const h = harness(true, catalogue());
  change(h, "Search suites", "guest");
  change(h, "Filter by role family", "FRONT_OFFICE");
  change(h, "Filter by status", "active");
  change(h, "Maximum suite duration", "30");
  change(h, "Filter by question format", "VIDEO_PITCH");
  clear(h);
  assert.deepEqual(shown(h), ["brief", "mixed", "long", "paused", "finance", "empty"]);
  for (const [label, value] of [["Search suites", ""], ["Filter by role family", "ALL"], ["Filter by status", "all"], ["Maximum suite duration", ""], ["Filter by question format", "ALL"]]) {
    assert.equal(control(h.render(), label).props.value, value);
  }
});
test("unmatched duration and format show empty results and can be cleared", () => {
  const h = harness(true, catalogue());
  change(h, "Maximum suite duration", "15");
  change(h, "Filter by question format", "VIDEO_PITCH");
  assert.deepEqual(shown(h), []);
  assert.ok(nodes(h.render()).some((node) => node.props?.title === "No suites match"));
  clear(h);
  assert.equal(shown(h).length, 6);
});
test("empty catalogue remains usable with either filter selected", () => {
  const h = harness(false);
  change(h, "Maximum suite duration", "30");
  change(h, "Filter by question format", "VIDEO_PITCH");
  assert.deepEqual(shown(h), []);
  assert.ok(nodes(h.render()).some((node) => node.props?.title === "No assessment suites yet"));
  clear(h);
  assert.equal(control(h.render(), "Maximum suite duration").props.value, "");
});
test("active duration filter uses a template-only refresh", () => {
  const data = catalogue();
  const h = harness(true, data);
  change(h, "Maximum suite duration", "30");
  change(h, "Filter by question format", "VIDEO_PITCH");
  assert.deepEqual(shown(h), ["mixed", "paused"]);
  h.update({ templates: data.templates.map((suite) => suite.id === "mixed" ? { ...suite, time_limit_minutes: 45 } : suite) });
  assert.deepEqual(shown(h), ["paused"]);
});
test("active format filter uses a question-only refresh", () => {
  const data = catalogue();
  const h = harness(true, data);
  change(h, "Maximum suite duration", "30");
  change(h, "Filter by question format", "VIDEO_PITCH");
  assert.deepEqual(shown(h), ["mixed", "paused"]);
  h.update({ questionsByTemplate: { ...data.questionsByTemplate, paused: [] } });
  assert.deepEqual(shown(h), ["mixed"]);
});
