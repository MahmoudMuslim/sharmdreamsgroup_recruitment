import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Real editor handlers + schema + presence store. Only the server action and
// WebGL reactor boundary are replaced; this proof never starts a browser/server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const componentFile = path.join(root, "src/app/(admin)/settings/JarvisAppearanceConsole.tsx");
const domainFile = path.join(root, "src/modules/assistant/domain/jarvisAppearance.ts");
const storeFile = path.join(root, "src/lib/jarvis-ui.ts");
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props?.children)];
const text = (node) => Array.isArray(node) ? node.map(text).join("")
  : node == null || typeof node === "boolean" ? ""
    : typeof node === "object" ? text(node.props?.children) : String(node);
const clone = (value) => structuredClone(value);
const capital = (value) => value[0].toUpperCase() + value.slice(1);
const DOT_TITLE = "This state is not the portal's own look";
// The marker is a bare dot: a name's own text must stay exactly the name, so the
// proof counts dots inside a button rather than reading a sentence off it.
const dotsOn = (ui, label) => nodes(ui.button(label)).filter((n) => n.type === "span" && n.props.title === DOT_TITLE).length;

function runtime({ problem = null, stored = true, appearance, save, initialState = null } = {}) {
  const cache = new Map(), instances = new Map(), writes = [], effects = [], forbidden = [];
  let current, cursor = 0, dirty = true, tree, preview, changes = 0;
  const hooks = {
    useState(initial) {
      const owner = current, index = cursor++;
      if (!(index in owner)) owner[index] = typeof initial === "function" ? initial() : initial;
      return [owner[index], (next) => { owner[index] = typeof next === "function" ? next(owner[index]) : next; dirty = true; }];
    },
    useRef(initial) { return current[cursor++] ??= { current: initial }; },
    useId() { return current[cursor++] ??= `appearance-${instances.size}-${cursor}`; },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect(fn, deps) {
      const index = cursor++, previous = current[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) {
        current[index] = deps;
        effects.push(fn);
      }
    },
    Fragment: Symbol.for("appearance.fragment"),
  };
  const browser = new Proxy({}, { get(_target, key) {
    forbidden.push(String(key));
    throw new Error(`Appearance editor must not access browser runtime: ${String(key)}`);
  } });
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    assert.ok(existsSync(file), `Missing appearance component/module: ${file}`);
    const sandbox = { exports: {} };
    cache.set(file, sandbox.exports);
    const local = (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: hooks.Fragment };
      if (name === "zod") return require(name);
      if (name === "@/modules/assistant/domain/jarvisAppearance") return load(domainFile);
      if (name === "@/lib/jarvis-ui") return load(storeFile);
      if (name === "@/modules/assistant/presentation/JarvisReactor") return {
        JarvisReactor: (props) => { preview = props; return jsx("div", { "aria-label": "Reactor preview" }); },
      };
      if (name === "./jarvis-actions") return { setJarvisAppearance: async (draft) => {
        writes.push(clone(draft));
        return save ? save(draft) : { ok: true, appearance: clone(draft) };
      } };
      throw new Error(`Unexpected editor dependency: ${name}`);
    };
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function("require", "module", "exports", "window", "document", "navigator", "fetch", compiled)(
      local, sandbox, sandbox.exports, browser, browser, browser,
      () => { forbidden.push("fetch"); throw new Error("No editor network requests outside the save action"); },
    );
    return sandbox.exports;
  }
  const domain = load(domainFile), store = load(storeFile);
  // Non-idle runtime proves previews do not reset or impersonate real activity.
  store.setJarvisAmbient(true);
  store.setJarvisThinking(true);
  store.setJarvisApproval("A real approval is waiting");
  const operational = clone(store.readJarvisUi());
  store.subscribeJarvisUi(() => { changes++; });
  const initial = { appearance: clone(appearance ?? domain.DEFAULT_JARVIS_APPEARANCE), stored, problem };
  const initialSnapshot = clone(initial);
  const Component = load(componentFile).AppearanceConsole;
  assert.equal(typeof Component, "function", "AppearanceConsole is exported");
  const rootNode = jsx(Component, { initial, initialState });
  function expand(node, location = "root", disabled = false) {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${location}/${child?.key ?? i}`, disabled));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const id = `${location}/${node.type.name}`;
      if (!instances.has(id)) instances.set(id, []);
      current = instances.get(id); cursor = 0;
      return expand(node.type(node.props), `${id}/out`, disabled);
    }
    if (node.type === hooks.Fragment) return expand(node.props.children, location, disabled);
    const blocked = disabled || Boolean(node.props.disabled);
    return { ...node, blocked, props: { ...node.props, children: expand(node.props.children, `${location}/child`, blocked) } };
  }
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(count++ < 40, "editor render settles");
      dirty = false; tree = expand(rootNode); effects.splice(0).forEach((effect) => effect());
    }
  }
  const ui = {
    domain, store, writes, initial,
    all(predicate) { render(); return nodes(tree).filter(predicate); },
    find(predicate) { const found = ui.all(predicate)[0]; assert.ok(found, "rendered control exists"); return found; },
    button(label) { return ui.find((n) => n.type === "button" && (n.props["aria-label"] === label || text(n).trim() === label)); },
    input(label) { return ui.find((n) => ["input", "select"].includes(n.type) && n.props["aria-label"] === label); },
    click(label) { const node = ui.button(label); assert.ok(!node.blocked, `${label} enabled`); node.props.onClick(); render(); },
    change(label, value) {
      const node = ui.input(label); assert.ok(!node.blocked, `${label} enabled`);
      node.props.onChange({ target: { value: String(value), checked: Boolean(value) } }); render();
    },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    preview() { render(); assert.equal(preview.preview, true); assert.equal(preview.size, 240); return preview; },
    text() { render(); return text(tree); },
    status() { return text(ui.find((n) => n.props["aria-label"] === "Appearance status")); },
    error() { return ui.all((n) => n.props.role === "alert").map(text).join(" "); },
    assertRuntime(refreshes = 0) {
      assert.deepEqual(store.readJarvisUi(), { ...operational, prefsEpoch: operational.prefsEpoch + refreshes });
      assert.equal(changes, refreshes, "only successful saves notify presence");
      assert.deepEqual(forbidden, [], "no microphone, voice, browser storage or operational API access");
      assert.deepEqual(initial, initialSnapshot, "initial data is never mutated");
    },
  };
  render();
  return ui;
}

// Wrong selected-state writes, missing controls or previewing operational state fail here.
test("six state previews and five colors edit only the chosen visual", () => {
  const ui = runtime();
  assert.match(ui.status(), /Saved to your account/i);
  for (const state of ["idle", "listening", "thinking", "speaking", "approval", "alert"]) {
    ui.click(capital(state));
    assert.equal(ui.preview().state, state);
    assert.equal(ui.button(capital(state)).props["aria-pressed"], true);
  }
  ui.click("Listening");
  const idle = clone(ui.preview().appearance.states.idle);
  for (const [key, value] of [["core", "#ABCDEF"], ["primary", "#123456"], ["secondary", "#987654"], ["tertiary", "#abcdef"], ["deep", "#102030"]]) {
    assert.equal(ui.input(`${capital(key)} color`).props.type, "color");
    ui.change(`${capital(key)} color`, value);
    assert.equal(ui.preview().appearance.states.listening.palette[key], value);
    assert.equal(ui.input(`${capital(key)} hex`).props.value, value);
  }
  ui.change("Core hex", "#a1B2c3");
  assert.equal(ui.preview().appearance.states.listening.palette.core, "#a1B2c3");
  assert.deepEqual(ui.preview().appearance.states.idle, idle);
  assert.match(ui.status(), /Unsaved changes/i);
  assert.equal(ui.writes.length, 0);
  ui.assertRuntime();
});

test("invalid hex stays editable but cannot reach the preview, presets or account", async () => {
  const ui = runtime();
  const core = ui.preview().appearance.states.idle.palette.core;
  ui.change("Core hex", "#123");
  assert.equal(ui.input("Core hex").props.value, "#123");
  assert.equal(ui.input("Core hex").props["aria-invalid"], true);
  assert.equal(ui.preview().appearance.states.idle.palette.core, core);
  ui.change("Preset name", "Incomplete"); ui.click("Save as preset");
  assert.equal(ui.preview().appearance.presets.length, 0);
  assert.ok(ui.error());
  ui.click("Save appearance"); await ui.settle();
  assert.equal(ui.writes.length, 0);
  assert.match(ui.status(), /Unsaved changes/i);
  ui.change("Core hex", "#123456");
  ui.click("Save appearance"); await ui.settle();
  assert.equal(ui.writes[0].states.idle.palette.core, "#123456");
  ui.assertRuntime(1);
});

test("all eight bounded motion controls and global quality/breathing update the preview", () => {
  const ui = runtime();
  const ranges = [
    ["Energy", "energy", 0, 3], ["Rotation speed", "rotationSpeed", 0, 3],
    ["Particle speed", "particleSpeed", 0, 3], ["Shell radius", "shellRadius", 0.6, 1.5],
    ["Ring spread", "ringSpread", 0.4, 1.6], ["Filament opacity", "filamentOpacity", 0, 1],
    ["Core scale", "coreScale", 0.5, 1.5], ["Bloom", "bloom", 0, 1.5],
  ];
  for (const [label, key, min, max] of ranges) {
    const control = ui.input(label);
    assert.equal(control.props.type, "range"); assert.equal(control.props.min, min); assert.equal(control.props.max, max);
    for (const value of [min, max]) {
      ui.change(label, value);
      assert.equal(ui.preview().appearance.states.idle.motion[key], value);
    }
    ui.change(label, max + 100);
    assert.ok(ui.preview().appearance.states.idle.motion[key] <= max);
  }
  for (const quality of ["auto", "ultra", "high", "balanced", "performance"]) {
    ui.change("Quality", quality); assert.equal(ui.preview().appearance.quality, quality);
  }
  ui.change("Breathing", false); assert.equal(ui.preview().appearance.breathing, false);
  ui.change("Breathing", true);
  assert.equal(ui.input("Breathing intensity").props.min, 0.2);
  assert.equal(ui.input("Breathing intensity").props.max, 2.4);
  for (const value of [0.2, 2.4]) {
    ui.change("Breathing intensity", value); assert.equal(ui.preview().appearance.breathingIntensity, value);
  }
  assert.equal(ui.writes.length, 0); ui.assertRuntime();
});

test("presets trim names, reject case-insensitive duplicates, snapshot, apply and remove locally", () => {
  const ui = runtime();
  ui.change("Core color", "#123456"); ui.change("Energy", 2);
  ui.change("Preset name", "  Warm light  "); ui.click("Save as preset");
  assert.equal(ui.preview().appearance.presets[0].name, "Warm light");
  ui.change("Core color", "#654321");
  assert.equal(ui.preview().appearance.presets[0].palette.core, "#123456");
  ui.change("Preset name", " warm LIGHT "); ui.click("Save as preset");
  assert.equal(ui.preview().appearance.presets.length, 1); assert.ok(ui.error());
  ui.click("Thinking"); ui.click("Apply Warm light");
  assert.equal(ui.preview().appearance.states.thinking.palette.core, "#123456");
  assert.equal(ui.preview().appearance.states.thinking.motion.energy, 2);
  assert.equal(ui.preview().appearance.states.idle.palette.core, "#654321");
  ui.click("Remove Warm light");
  assert.equal(ui.preview().appearance.presets.length, 0);
  assert.equal(ui.preview().appearance.states.thinking.palette.core, "#123456");
  assert.equal(ui.writes.length, 0); ui.assertRuntime();
});

test("preset schema blocks empty, overlong and thirteenth names", () => {
  const ui = runtime();
  for (const name of ["   ", "x".repeat(33)]) {
    ui.change("Preset name", name); ui.click("Save as preset");
    assert.equal(ui.preview().appearance.presets.length, 0); assert.ok(ui.error());
  }
  for (let i = 1; i <= 12; i++) {
    ui.change("Preset name", i === 1 ? "x".repeat(32) : `Look ${i}`); ui.click("Save as preset");
  }
  assert.equal(ui.preview().appearance.presets.length, 12);
  ui.change("Preset name", "One too many");
  // Native disabling is fine, but force the handler too: schema is the final guard.
  ui.button("Save as preset").props.onClick();
  assert.equal(ui.preview().appearance.presets.length, 12);
  ui.assertRuntime();
});

test("successful save adopts normalized server return as draft and discard baseline", async () => {
  const ui = runtime({ stored: false, save: async (draft) => {
    const normalized = clone(draft); normalized.states.idle.palette.core = "#abcdef";
    return { ok: true, appearance: normalized };
  } });
  assert.match(ui.status(), /not saved/i);
  ui.change("Core color", "#ABCDEF"); ui.click("Save appearance"); await ui.settle();
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].states.idle.palette.core, "#ABCDEF");
  assert.equal(ui.input("Core hex").props.value, "#abcdef");
  assert.match(ui.status(), /Saved to your account/i);
  assert.doesNotMatch(ui.status(), /Unsaved/i);
  ui.change("Core color", "#112233"); ui.click("Discard changes");
  assert.equal(ui.preview().appearance.states.idle.palette.core, "#abcdef");
  assert.match(ui.status(), /Saved to your account/i); ui.assertRuntime(1);
});

for (const thrown of [false, true]) {
  test(`save ${thrown ? "exception" : "refusal"} preserves draft and previous baseline without refresh`, async () => {
    const ui = runtime({ save: async () => {
      if (thrown) throw new Error("offline");
      return { ok: false, error: "Appearance could not be saved. Try again." };
    } });
    const before = clone(ui.preview().appearance);
    ui.change("Core color", "#123456"); ui.click("Save appearance"); await ui.settle();
    assert.ok(ui.error()); assert.match(ui.status(), /Unsaved changes/i);
    assert.equal(ui.preview().appearance.states.idle.palette.core, "#123456");
    assert.equal(ui.button("Save appearance").blocked, false);
    ui.click("Discard changes"); assert.deepEqual(ui.preview().appearance, before);
    ui.assertRuntime();
  });
}

test("audit warning remains a successful save, visibly distinct from an error", async () => {
  const ui = runtime({ save: async (draft) => ({ ok: true, appearance: clone(draft), warning: "Appearance saved, but its audit entry could not be recorded." }) });
  ui.change("Core color", "#123456"); ui.click("Save appearance"); await ui.settle();
  assert.match(ui.status(), /Saved to your account/i);
  assert.match(text(ui.find((n) => n.props["aria-label"] === "Save warning")), /audit entry/i);
  assert.equal(ui.error(), "");
  ui.change("Energy", 2); ui.click("Discard changes");
  assert.equal(ui.preview().appearance.states.idle.palette.core, "#123456");
  ui.assertRuntime(1);
});

for (const problem of ["absent", "unreadable"]) {
  test(`${problem} storage blocks account save but preserves local editing and presets`, async () => {
    const ui = runtime({ problem, stored: false });
    assert.match(ui.text(), problem === "absent" ? /Migration 049/ : /reload|retry/i);
    assert.doesNotMatch(ui.status(), /Saved to your account/i);
    ui.click("Speaking"); ui.change("Core color", "#123456");
    ui.change("Preset name", "Local only"); ui.click("Save as preset");
    assert.equal(ui.preview().appearance.presets.length, 1);
    assert.equal(ui.button("Save appearance").blocked, true);
    ui.button("Save appearance").props.onClick(); await ui.settle();
    assert.equal(ui.writes.length, 0);
    ui.click("Reset all defaults");
    assert.deepEqual(ui.preview().appearance, ui.domain.DEFAULT_JARVIS_APPEARANCE);
    assert.doesNotMatch(ui.status(), /Saved to your account/i); ui.assertRuntime();
  });
}

test("reset selected, reset all and discard are reversible draft-only operations", () => {
  const setup = runtime();
  const custom = clone(setup.domain.DEFAULT_JARVIS_APPEARANCE);
  custom.states.idle.palette.core = "#010203"; custom.states.alert.palette.core = "#040506";
  custom.quality = "performance"; custom.breathing = false;
  custom.presets = [{ name: "Original", ...clone(custom.states.alert) }];
  const ui = runtime({ appearance: custom });
  ui.click("Alert"); ui.click("Reset selected state");
  assert.deepEqual(ui.preview().appearance.states.alert, ui.domain.DEFAULT_JARVIS_APPEARANCE.states.alert);
  assert.equal(ui.preview().appearance.states.idle.palette.core, "#010203");
  assert.equal(ui.preview().appearance.quality, "performance");
  assert.equal(ui.preview().appearance.presets.length, 1);
  ui.click("Reset all defaults"); assert.deepEqual(ui.preview().appearance, ui.domain.DEFAULT_JARVIS_APPEARANCE);
  assert.match(ui.status(), /Unsaved changes/i);
  ui.click("Discard changes"); assert.deepEqual(ui.preview().appearance, custom);
  ui.change("Core hex", "bad"); ui.click("Discard changes");
  assert.equal(ui.input("Core hex").props.value, "#040506");
  assert.match(ui.status(), /Saved to your account/i);
  assert.equal(ui.writes.length, 0); ui.assertRuntime();
});

test("pending save locks all editable controls and ignores stale edits and duplicate saves", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const ui = runtime({ save: () => pending });
  ui.change("Core color", "#123456");
  const staleColor = ui.input("Core color").props.onChange;
  const staleName = ui.input("Preset name").props.onChange;
  const staleState = ui.button("Alert").props.onClick;
  const staleReset = ui.button("Reset all defaults").props.onClick;
  const staleDiscard = ui.button("Discard changes").props.onClick;
  const stalePreset = ui.button("Save as preset").props.onClick;
  const staleSave = ui.button("Save appearance").props.onClick;
  staleSave(); staleSave();
  assert.equal(ui.writes.length, 1);
  assert.ok(ui.all((n) => n.type === "fieldset" && n.props.disabled).length > 0);
  for (const control of ui.all((n) => ["button", "input", "select"].includes(n.type))) assert.equal(control.blocked, true);
  assert.match(ui.status(), /Saving/i);
  staleColor({ target: { value: "#654321" } }); staleName({ target: { value: "Race" } });
  staleState(); staleReset(); staleDiscard(); stalePreset();
  assert.equal(ui.preview().state, "idle");
  assert.equal(ui.preview().appearance.states.idle.palette.core, "#123456");
  assert.equal(ui.preview().appearance.presets.length, 0);
  assert.equal(ui.input("Preset name").props.value, "");
  resolve({ ok: true, appearance: clone(ui.writes[0]) }); await ui.settle();
  assert.equal(ui.input("Core color").blocked, false);
  assert.match(ui.status(), /Saved to your account/i); ui.assertRuntime(1);
});

// An answer that says "the red one is too bright" links to
// /settings?area=assistant&section=appearance&state=alert, so the console must open that state.
test("an address naming a state opens the editor on that state's own colours", () => {
  const ui = runtime({ initialState: "alert" });
  assert.equal(ui.preview().state, "alert");
  assert.equal(ui.button("Alert").props["aria-pressed"], true);
  for (const state of ["idle", "listening", "thinking", "speaking", "approval"]) {
    assert.equal(ui.button(capital(state)).props["aria-pressed"], false);
  }
  const alert = ui.domain.DEFAULT_JARVIS_APPEARANCE.states.alert;
  assert.equal(ui.input("Core hex").props.value, alert.palette.core);
  assert.equal(ui.input("Energy").props.value, alert.motion.energy);
  ui.change("Core color", "#123456");
  assert.equal(ui.preview().appearance.states.alert.palette.core, "#123456");
  assert.notEqual(ui.preview().appearance.states.idle.palette.core, "#123456");
  assert.equal(ui.writes.length, 0); ui.assertRuntime();
});

test("a dot marks only the states wearing colours or motion of their own", () => {
  const portal = runtime();
  for (const state of ["idle", "listening", "thinking", "speaking", "approval", "alert"]) {
    assert.equal(dotsOn(portal, capital(state)), 0, `${state} is the portal's own look`);
  }
  const setup = runtime();
  const custom = clone(setup.domain.DEFAULT_JARVIS_APPEARANCE);
  custom.states.listening.palette.core = "#010203";
  custom.states.alert.motion.bloom = 1.2;
  const ui = runtime({ appearance: custom });
  assert.equal(dotsOn(ui, "Listening"), 1);
  assert.equal(dotsOn(ui, "Alert"), 1);
  assert.equal(dotsOn(ui, "Idle"), 0);
  assert.equal(dotsOn(ui, "Thinking"), 0);
  // The dot carries no words: the button's accessible name is still the state alone.
  assert.equal(text(ui.button("Listening")).trim(), "Listening");
  assert.equal(ui.button("Alert").props["aria-label"], "Alert");
  assert.match(ui.text(), /A dot beside a name/);
  ui.click("Alert"); ui.click("Reset selected state");
  assert.equal(dotsOn(ui, "Alert"), 0);
  assert.equal(dotsOn(ui, "Listening"), 1);
  ui.click("Idle"); ui.change("Core color", "#112233");
  assert.equal(dotsOn(ui, "Idle"), 1);
  assert.equal(ui.writes.length, 0); ui.assertRuntime();
});

// The page, not the console, decides which state an address asks for.
test("the settings page reads the state off the address and validates it first", () => {
  const page = readFileSync(path.join(root, "src/app/(admin)/settings/page.tsx"), "utf8");
  assert.match(page, /if \(section !== "appearance"\) return <PresenceConsole/, "presence opens on the half that has no colours");
  assert.match(page, /REACTOR_STATES\.find\(\(entry\) => entry === state\) \?\? null/, "an unknown state names nothing");
  assert.match(page, /<AppearanceConsole initialState=\{openOn\}/, "the validated state reaches the console");
  assert.match(page, /import \{ REACTOR_STATES, type ReactorState \} from "@\/modules\/assistant\/domain\/jarvisAppearance"/);
  // One read per half: a chat link about an orb must not cost the settings page the
  // row it never shows, and the presence row cannot describe an appearance.
  assert.match(page, /area\.id === "assistant" &&/, "the area renders on its own address");
});

// The old page still answers a bookmark, by naming the section the tab meant.
test("the old JARVIS address translates its tab into the settings section", () => {
  const redirect = readFileSync(path.join(root, "src/app/(admin)/assistant/jarvis/page.tsx"), "utf8");
  assert.match(redirect, /jarvisSettingsHref\(/, "one mapper writes the address, here and in the dock");
  assert.match(redirect, /redirect\(href\)/);
  assert.match(redirect, /await requireStaff\(href\)/, "a signed-out bookmark returns to the section it asked for");

  const nav = readFileSync(path.join(root, "src/modules/settings/domain/settingsNav.ts"), "utf8");
  const mapper = nav.slice(nav.indexOf("export function jarvisSettingsHref"));
  assert.match(mapper, /tab === "appearance" \? "appearance" : "presence"/, "anything but appearance is presence");
  assert.match(mapper, /section === "appearance" && typeof state === "string" && state !== ""/, "presence cannot ask for a colour");
  assert.match(mapper, /settingsHref\("assistant", section\)/, "the address is the dock's own");
});

// The manual is the only place a recruiter learns these two doors exist.
test("the manual names the state address and says what the dot beside a name means", () => {
  const guide = readFileSync(path.join(root, "src/modules/shell/domain/pageGuide.ts"), "utf8");
  assert.match(guide, /\/settings\?area=assistant&section=appearance&state=alert/, "the address is spelled out");
  assert.match(guide, /opens the editor already showing Alert's own colours/);
  assert.match(guide, /A dot beside a state's name means that state wears colours or motion of its own/, "the dot is explained, not just drawn");
  assert.match(guide, /takes its dot away/, "a reset is said to move the dot too");
  // The manual also says where the two halves went, in the dock's own words.
  assert.match(guide, /the old address \/assistant\/jarvis redirects to whichever half its `tab=` named/);
  assert.match(guide, /Five areas in the dock/);
  // ...and the 049 sentence must state this database's way, which the applied column does.
  assert.match(guide, /049_jarvis_appearance\.sql is applied on this database/);
  assert.doesNotMatch(guide, /049_jarvis_appearance\.sql is authored but not applied/);
});
