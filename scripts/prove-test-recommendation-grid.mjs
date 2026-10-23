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
function harness(canEdit) {
  const state = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useMemo: (fn) => fn(), useState: (initial) => {
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
    return exports.AssessmentGrid({ templates: [], candidates: [], options: { companies: [], roleFamilies: [] }, questionsByTemplate: {}, defaultDurationMinutes: 45, canEdit, links: { total: 0 }, timeZone: "UTC", situational: { situational: true }, followUps: { rules_available: false, routing_available: false } });
  };
  return { render };
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
