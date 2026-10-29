import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function load(rel) {
  const sandbox = { exports: {} };
  const local = name => name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : require(name);
  const source = ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(local, sandbox, sandbox.exports);
  return sandbox.exports;
}

const stage = load("src/modules/assistant/domain/stage.ts");
const store = load("src/lib/jarvis-ui.ts");

test("group 1a — the geometry is self-consistent", () => {
  assert.equal(stage.STAGE_ROUTE, "/assistant/stage");
  assert.equal(stage.STAGE_ORB_EDGE_PX, Math.round(stage.STAGE_ORB_PX * stage.STAGE_ORB_SCALE));
  assert.equal(stage.STAGE_ORB_CENTRE_PX, stage.STAGE_ORB_INSET_PX + stage.STAGE_ORB_EDGE_PX / 2);
  assert.equal(stage.STAGE_ORB_GUTTER_PX, stage.STAGE_ORB_EDGE_PX + 2 * stage.STAGE_ORB_INSET_PX);
  assert.equal(stage.STAGE_ORB_PX, 200);
  assert.equal(stage.STAGE_ORB_SCALE, 0.48);
  assert.equal(stage.STAGE_ORB_INSET_PX, 24);
  assert.equal(stage.STAGE_ORB_GUTTER_PX, 144);
});

test("group 1b — the translate is the target centre minus the placed centre", () => {
  assert.deepEqual(stage.stageOrbTransformVars(false), { x: "-50%", y: "-50%", s: "1" });
  assert.deepEqual(stage.stageOrbTransformVars(true), {
    x: "calc(50vw - 172px)", y: "calc(-50vh - 28px)", s: "0.48",
  });
});

test("group 1c — the store carries turn counts without duplicate notifications", () => {
  assert.equal(store.jarvisUiOnServer().stageTurns, 0);
  let notifies = 0;
  const off = store.subscribeJarvisUi(() => { notifies++; });
  store.setJarvisStageTurns(3);
  assert.equal(store.readJarvisUi().stageTurns, 3);
  assert.equal(notifies, 1);
  store.setJarvisStageTurns(3);
  assert.equal(notifies, 1);
  store.setJarvisStageTurns(0);
  assert.equal(store.readJarvisUi().stageTurns, 0);
  assert.equal(notifies, 2);
  off();
  store.setJarvisStageTurns(1);
  assert.equal(notifies, 2);
  store.setJarvisStageTurns(0);
});
