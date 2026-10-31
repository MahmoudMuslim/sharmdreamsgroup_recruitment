import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props?.children)];
function load(rel) {
  const file = path.join(root, rel);
  const sandbox = { exports: {} };
  const local = name => {
    if (name === "react") return { useState: value => [value, () => {}], useEffect() {}, useMemo: fn => fn() };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "next/dynamic") return { __esModule: true, default: () => "orb-boundary" };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", source)(local, sandbox, sandbox.exports);
  return sandbox.exports;
}
const { DEFAULT_JARVIS_APPEARANCE } = load("src/modules/assistant/domain/jarvisAppearance.ts");
const { JarvisReactor } = load("src/modules/assistant/presentation/JarvisReactor.tsx");
const draw = props => nodes(JarvisReactor(props));
const orb = tree => tree.find(node => node.type === "orb-boundary");

test("each observed state passes its own complete custom visual to the renderer", () => {
  const appearance = structuredClone(DEFAULT_JARVIS_APPEARANCE);
  for (const state of Object.keys(appearance.states)) {
    appearance.states[state].palette.primary = "#123456";
    appearance.states[state].motion.rotationSpeed = 2.3;
    const rendered = orb(draw({ state, appearance }));
    assert.deepEqual(rendered.props.state, appearance.states[state].motion);
    assert.equal(rendered.props.palette.primary, 0x123456);
    assert.match(rendered.props.palette.fallback, /#123456/);
  }
});

test("quality changes remount the renderer and reapply breathing settings", () => {
  const appearance = structuredClone(DEFAULT_JARVIS_APPEARANCE);
  appearance.breathing = false;
  appearance.breathingIntensity = 1.8;
  const initial = orb(draw({ state: "idle", appearance }));
  appearance.quality = "performance";
  const changed = orb(draw({ state: "idle", appearance }));
  assert.notEqual(initial.key, changed.key);
  assert.equal(changed.props.quality, "performance");
  assert.equal(changed.props.breathing, false);
  assert.equal(changed.props.breathingIntensity, 1.8);
});

test("the meter modulates chosen energy and idle does not inherit sampled intensity", () => {
  const appearance = structuredClone(DEFAULT_JARVIS_APPEARANCE);
  appearance.states.speaking.motion.energy = 2;
  assert.equal(orb(draw({ state: "speaking", appearance, level: () => 0 })).props.intensity, 1.1);
  appearance.states.speaking.motion.energy = 0;
  assert.equal(orb(draw({ state: "speaking", appearance, level: () => 0 })).props.intensity, 0);
  assert.equal(orb(draw({ state: "idle", appearance, level: () => 0 })).props.intensity, 0.72);
});

test("a preview is not a launcher or listening claim and never samples a microphone", () => {
  let reads = 0;
  const tree = draw({ state: "listening", preview: true, level: () => { reads++; return 1; } });
  assert.equal(tree.some(node => node.type === "button"), false);
  assert.equal(orb(tree).props.intensity, 1.4);
  assert.match(orb(tree).props.ariaLabel, /preview/i);
  assert.doesNotMatch(orb(tree).props.ariaLabel, /armed|click to open/i);
  assert.equal(reads, 0);
});

test("the real launcher still reports expansion and dispatches its click", () => {
  let opened = 0;
  const button = draw({ state: "idle", ariaExpanded: true, onClick: () => opened++ }).find(node => node.type === "button");
  assert.equal(button.props["aria-expanded"], true);
  button.props.onClick();
  assert.equal(opened, 1);
});
