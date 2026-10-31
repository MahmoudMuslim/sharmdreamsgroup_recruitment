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

test("group 2 — the stage variant reserves the gutter and reports its turns", () => {
  const source = readFileSync(path.join(root, "src/app/(admin)/assistant/AssistantChat.tsx"), "utf8");
  assert.match(source, /variant: "docked" \| "page" \| "stage"/);
  assert.match(source, /setJarvisStageTurns\(messages\.length\)/);
  assert.match(source, /setJarvisStageTurns\(0\)/);
  // `wide` is the max-w-3xl measure: a stage line of text at full width is unreadable.
  assert.match(source, /const wide = variant !== "docked"/);
  // Only the dock gets the sessions button; a stage is not a second copy of the rail.
  assert.match(source, /variant === "docked" && \(\n          <button/);
  // The gutter is padding on the stage's own container, so the chat must not spell it.
  assert.ok(!source.includes('@/modules/assistant/domain/stage'), "the chat reads the store, not the geometry module");
  assert.doesNotMatch(source, /\[(144|96|72)px\]/, "the chat owns no gutter class");
});

test("group 3 — the route guards itself and reads the session, not the query", () => {
  const source = readFileSync(path.join(root, "src/app/(admin)/assistant/stage/page.tsx"), "utf8");
  assert.match(source, /await connection\(\)/);
  assert.match(source, /requireStaff\("\/assistant"\)/);
  assert.match(source, /export const instant = false/);
  // The stage reuses the conversation the page already saves to, and needs nothing else.
  assert.match(source, /<AssistantStage initialSessionId=\{session\} \/>/);
  assert.doesNotMatch(source, /readVoiceAutonomy|AutonomyPanel/, "the stage draws no autonomy panel, so it reads no autonomy");
});

test("group 4 — the shell is bare and the stage keeps the orb's gutter", () => {
  const shell = readFileSync(path.join(root, "src/modules/analytics/presentation/AdminShell.tsx"), "utf8");
  assert.match(shell, /if \(pathname === STAGE_ROUTE\)/);
  // The bare branch is the one place the stage renders; it keeps the orb and drops the rest.
  const start = shell.indexOf("if (pathname === STAGE_ROUTE)");
  const branch = shell.slice(start, shell.indexOf("\n  }", start));
  assert.ok(start > 0 && branch.length > 0, "the stage branch exists to read");
  assert.match(branch, /<JarvisPresence user=\{user\} timeZone=\{timeZone\} \/>/);
  assert.match(branch, /\{children\}/);
  assert.ok(!/<AssistantDock|<LiveChrome|<AppRail|NavigationDrawer/.test(branch), "the bare branch mounts neither a second dock nor a second chrome");
  assert.equal(shell.split("<JarvisPresence").length - 1, 2, "the shell renders the orb in exactly two branches");

  const stageView = readFileSync(path.join(root, "src/app/(admin)/assistant/stage/AssistantStage.tsx"), "utf8");
  // The gutter is a literal class spelled from the constant group 1a pins: `pt-` is the
  // narrow form (orb top-centre, answers below it), `lg:pr-` the wide one (answers to
  // the orb's left). Both must be the same number the orb reserves.
  const gutter = String(stage.STAGE_ORB_GUTTER_PX);
  assert.ok(stageView.includes(`pt-[${gutter}px]`), "the narrow gutter must be the constant");
  assert.ok(stageView.includes(`lg:pr-[${gutter}px]`), "the wide gutter must be the same constant");
  assert.match(stageView, /variant="stage"/);
  assert.match(stageView, /voiceMode="console"/);
  // A flex column cannot hand its scroller a height without this.
  assert.match(stageView, /min-h-0/);
  // Two ways out, because the spec says Escape on its own is not discoverable.
  assert.match(stageView, /event\.key !== "Escape"/);
  assert.match(stageView, /router\.push\("\/assistant"\)/);
  assert.match(stageView, /Exit stage/);
  assert.match(stageView, /router\.replace\(\`\$\{STAGE_ROUTE\}\?session=\$\{encodeURIComponent\(id\)\}\`, \{ scroll: false \}\)/);
  assert.ok(!/AssistantDock|<LiveChrome/.test(stageView), "the stage page does not mount a second conversation or a second chrome");
});

test("group 5 — one orb, three positions, and the shell's hotkeys", () => {
  const presence = readFileSync(path.join(root, "src/modules/assistant/presentation/JarvisPresence.tsx"), "utf8");
  // The route is read, not stored: a reload and the back button both agree with the screen.
  assert.match(presence, /usePathname\(\)/);
  assert.match(presence, /const onStage = pathname === STAGE_ROUTE/);
  assert.match(presence, /const turned = onStage && ui\.stageTurns > 0/);
  // The vars are literal classes (Tailwind purges what it must assemble) and the
  // transform list itself is inline, so scale and translate cannot be split.
  // Each literal is compared against the derivation, never against a second copy of
  // the number: change a STAGE_ORB_* constant and leave a class alone and this turns
  // red. `_` is how Tailwind spells a space inside an arbitrary value.
  const turned = stage.stageOrbTransformVars(true);
  const centred = stage.stageOrbTransformVars(false);
  const asClass = (value) => value.replace(/ /g, "_");
  assert.ok(presence.includes(`[--jv-x:${asClass(centred.x)}]`), "the centred horizontal term");
  assert.ok(presence.includes(`[--jv-y:${asClass(turned.y)}]`), "the turned vertical term");
  assert.ok(presence.includes(`[--jv-s:${asClass(turned.s)}]`), "the turned scale");
  assert.ok(presence.includes(`lg:[--jv-x:${asClass(turned.x)}]`), "the turned horizontal term, wide screens only");
  // The un-turned state is the inline fallback, so it must read as the centred vars.
  assert.ok(
    presence.includes(
      `translate(var(--jv-x, ${centred.x}), var(--jv-y, ${centred.y})) scale(var(--jv-s, ${centred.s}))`
    ),
    "the transform list falls back to the centred position"
  );
  assert.match(presence, /duration-500/);
  // Off the stage the inline transform must be absent, or it beats the resting classes.
  assert.match(presence, /style=\{onStage \? stageTransform : undefined\}/);
  assert.match(presence, /onStage \? "origin-center" : "origin-bottom-right"/);
  assert.match(presence, /const canRest = !ui\.open && state === "idle" && !announcement && watcher\.news\.length === 0 && !onStage/);
  // The dock is not a second surface on a screen that already is one.
  assert.match(presence, /if \(!onStage\) setJarvisOpen\(true\);/);
  // Ctrl+Shift+Space before Ctrl+Space, or the same keystroke does both.
  assert.match(presence, /if \(event\.shiftKey\)/);
  assert.match(presence, /router\.push\(STAGE_ROUTE\)/);
  // Group 4 already asserts the stage's two ways out (the Escape key and the visible
  // control), so this group only checks the third door: the dock links to the stage
  // and takes its own panel down when it does.
  const dock = readFileSync(path.join(root, "src/app/(admin)/assistant/AssistantDock.tsx"), "utf8");
  const at = dock.indexOf("href={STAGE_ROUTE}");
  assert.ok(at > -1, "the dock links to the stage");
  // Scoped to the link itself: the close button already calls setJarvisOpen(false), so
  // a bare assertion on that call would pass with the stage link wide open.
  assert.ok(dock.slice(at, at + 240).includes("setJarvisOpen(false)"), "the stage link closes the dock");
  // A reactor with nothing to open is not a button that lies about expanding.
  const reactor = readFileSync(path.join(root, "src/modules/assistant/presentation/JarvisReactor.tsx"), "utf8");
  assert.match(reactor, /const interactive = !preview && Boolean\(onClick\)/);
  // And the two needles the corner proof pins are still there, spelled exactly.
  assert.ok(presence.includes('ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-5 right-5"'));
  assert.ok(presence.includes("origin-bottom-right"));
  // The stage's orb is drawn, not scaled up from a corner avatar: the box it is handed
  // is the size the geometry module reserves for it.
  assert.match(presence, /size=\{onStage \? STAGE_ORB_PX : ui\.open \? 76 : 104\}/);
  // Two more literals the note card spells, derived the same way rather than copied:
  // the gap to the turned orb is its drawn half plus the inset plus air, and the phone's
  // top offset is the very gutter the stage pads.
  const cardGap = String(stage.STAGE_ORB_EDGE_PX + stage.STAGE_ORB_INSET_PX + 32);
  assert.ok(presence.includes(`right-[${cardGap}px]`), "the card's gap must follow the turned orb's edge");
  assert.ok(
    presence.includes(`max-sm:top-[${String(stage.STAGE_ORB_GUTTER_PX)}px]`),
    "the card on a phone must start where the transcript starts"
  );
});
