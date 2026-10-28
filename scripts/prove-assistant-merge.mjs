import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const assistant = "src/app/(admin)/assistant/";
const voice = "src/modules/assistant/presentation/voice/";
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props?.children)];
const text = (node) => Array.isArray(node) ? node.map(text).join("")
  : node == null || typeof node === "boolean" ? ""
    : typeof node === "object" ? text(node.props?.children) : String(node);
const autonomy = { level: "code", stored: true, canOpen: false, problem: null };
const saved = [{ id: "saved-1", title: "Saved pipeline", messageCount: 2, updatedAt: "2026-10-20T09:00:00Z", engine: "auto" }];

function runtime({ server = false, preference = null, ambientArmed = false, blockedStorage = false, sessions = saved } = {}) {
  const cache = new Map(), instances = new Map(), effects = [];
  const history = [], sent = [], spoken = [], opened = [], guarded = [], reads = [], writes = [];
  const storage = new Map(preference === null ? [] : [["sdg-assistant-speak", preference]]);
  let current, cursor = 0, dirty = true, tree, rootNode, listReads = 0;
  const hooks = {
    useState(initial) {
      const owner = current, index = cursor++;
      if (!(index in owner)) owner[index] = typeof initial === "function" ? initial() : initial;
      return [owner[index], (next) => {
        owner[index] = typeof next === "function" ? next(owner[index]) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return current[index] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const owner = current, index = cursor++, previous = owner[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        owner[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          owner[index].cleanup?.();
          owner[index].cleanup = effect();
        });
      }
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useId: () => `merge-${cursor++}`,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    Fragment: Symbol.for("merge.fragment"),
    ViewTransition: ({ children }) => children,
  };
  const create = server ? React.createElement : (type, props) => jsx(type, props);
  const window = {
    localStorage: {
      getItem: (key) => { if (blockedStorage) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const actions = {
    getAssistantSessions: async () => { listReads++; return sessions; },
    openAssistantSession: async (id) => {
      opened.push(id);
      return { engine: "auto", messages: [{ id: "message-1", role: "user", content: "Earlier saved question" }] };
    },
    getAssistantModelChoices: async () => ({ ok: true, models: [], defaultModel: "", degraded: false }),
    sendAssistantMessage: async (input) => {
      sent.push(input);
      return { ok: true, sessionId: input.sessionId ?? "new-1", reply: "The saved answer.", steps: [] };
    },
    renameSavedSession: async () => ({ ok: true }),
    deleteSavedSession: async () => ({ ok: true }),
  };
  function load(relative) {
    const file = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (cache.has(file)) return cache.get(file);
    const source = readFileSync(file, "utf8");
    const loaded = { exports: {} };
    cache.set(file, loaded.exports);
    const local = (name) => {
      if (name === "react") return server ? { ...React, ViewTransition: ({ children }) => children } : hooks;
      if (name === "react/jsx-runtime") return server ? require(name) : { jsx, jsxs: jsx, Fragment: hooks.Fragment };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (name === "next/link") return { __esModule: true, default: (props) => create("a", props) };
      if (name === "next/navigation") return { useRouter: () => ({ replace: (url) => history.push(url) }) };
      if (name === "next/server") return { connection: async () => {} };
      if (name === "@/lib/auth/session") return { requireStaff: async (route) => { guarded.push(route); return { profileId: "staff-1" }; } };
      if (name === "@/modules/assistant/application/voiceSettings") return {
        readVoiceAutonomy: async (id) => { reads.push(id); return autonomy; },
        saveVoiceAutonomy: async (level) => { writes.push(level); return { ok: true, level }; },
      };
      if (name.endsWith("/RichReply")) return { RichReply: ({ text: value }) => create("div", { children: value }) };
      if (name.endsWith("/ReplyChart")) return { ReplyChart: () => null };
      if (name.endsWith("/useSpeech")) return { useSpeech: () => ({ speaking: false, error: null, speak: (value) => spoken.push(value), stop() {}, echoedOwnVoice: () => false }) };
      if (name.endsWith("/useRecorder")) return { useRecorder: () => ({ state: "idle", secondsLeft: 120, hitLimit: false, start() {}, stop() {} }) };
      if (name.endsWith("/useWakeWord")) return { useWakeWord: () => ({ supported: true, listening: false, error: null }) };
      if (name.endsWith("/useJarvisHandoff")) return {
        useJarvisHandoff: () => ({ ambientArmed }),
        useJarvisAwaitingWriter: (ref) => (value) => { ref.current = value; },
      };
      const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2))
        : name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
      if (base) {
        const target = [base, `${base}.tsx`, `${base}.ts`].find((candidate) => existsSync(candidate) && /\.[jt]sx?$/.test(candidate));
        assert.ok(target, `resolves ${name} from ${file}`);
        if (target === path.join(root, assistant, "actions.ts")) return actions;
        assert.ok(!target.includes("/candidate/"), "no candidate portal dependency");
        return load(target);
      }
      if (name === "server-only") throw new Error("Unexpected server dependency");
      return require(name);
    };
    const code = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function("require", "module", "exports", "window", "document", code)(local, loaded, loaded.exports, server ? undefined : window, { addEventListener() {}, removeEventListener() {} });
    return loaded.exports;
  }
  function expand(node, location = "root") {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${location}/${child?.key ?? i}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const id = `${location}/${node.type.name}/${node.key ?? ""}`;
      if (!instances.has(id)) instances.set(id, []);
      current = instances.get(id); cursor = 0;
      return expand(node.type(node.props), `${id}/out`);
    }
    if (node.type === hooks.Fragment) return expand(node.props.children, location);
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${location}/child`) } };
  }
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(count++ < 60, "render settles");
      dirty = false;
      tree = expand(rootNode);
      effects.splice(0).forEach((effect) => effect());
    }
  }
  const ui = {
    load, history, sent, spoken, opened, guarded, reads, writes, storage,
    get listReads() { return listReads; },
    mount(Component, props) { rootNode = jsx(Component, props); render(); },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    find(predicate) { render(); const node = nodes(tree).find(predicate); assert.ok(node, "rendered control exists"); return node; },
    all(predicate) { render(); return nodes(tree).filter(predicate); },
    button(label) { return ui.find((node) => node.type === "button" && (text(node).trim() === label || node.props["aria-label"] === label)); },
    check(label) { const node = ui.find((node) => node.type === "label" && text(node).trim() === label); return nodes(node).find((child) => child.type === "input"); },
    text: () => { render(); return text(tree); },
    click(label) { const button = ui.button(label); assert.ok(!button.props.disabled); button.props.onClick(); dirty = true; render(); },
    async send(question) {
      ui.find((node) => node.type === "textarea").props.onChange({ target: { value: question } });
      render(); ui.click("Send"); await ui.settle();
    },
  };
  return ui;
}

const chatProps = { sessionId: null, onSessionChange() {}, onNewConversation() {}, variant: "page", voiceMode: "console" };

test("main page renders history, console controls and collapsed privacy/autonomy without a Voice link", async () => {
  const ui = runtime({ server: true });
  const page = ui.load(`${assistant}page.tsx`);
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ session: "saved-1" }) }));
  assert.match(html, /Saved conversations/);
  assert.match(html, /Push to talk/);
  assert.doesNotMatch(html, /href="\/assistant\/voice"/);
  const disclosure = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(disclosure, "voice settings can be expanded");
  assert.doesNotMatch(disclosure[1], /\bopen(?:=|\s|$)/);
  for (const promise of ["never stored", "discarded", "browser vendor", "only while this tab is visible", "What a spoken word may release"]) assert.ok(disclosure[2].includes(promise), promise);
  assert.deepEqual(ui.guarded, ["/assistant"]);
  assert.deepEqual(ui.reads, ["staff-1"]);
  assert.equal(page.instant, false);
});

test("legacy Voice URL permanently redirects with session and all query values intact", async () => {
  const config = runtime().load("next.config.ts").default;
  const { unstable_getResponseFromNextConfig } = require("next/experimental/testing/server");
  const response = await unstable_getResponseFromNextConfig({
    nextConfig: config, url: "https://portal.invalid/assistant/voice?session=saved%2F1&from=dock&tag=a",
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://portal.invalid/assistant?session=saved%2F1&from=dock&tag=a");
  const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination");
  const { stringifyQuery } = require("next/dist/server/server-route-utils");
  const { addRequestMeta } = require("next/dist/server/request-meta");
  const query = { session: "saved/1", from: "dock", tag: ["a", "b"] };
  const req = {};
  addRequestMeta(req, "initQuery", query);
  const redirect = (await config.redirects()).find((route) => route.source === "/assistant/voice");
  const { parsedDestination } = prepareDestination({ destination: redirect.destination, params: {}, query, appendParamsToQuery: false });
  assert.equal(`${parsedDestination.pathname}?${stringifyQuery(req, parsedDestination.query)}`, "/assistant?session=saved%2F1&from=dock&tag=a&tag=b");
  for (const url of ["/assistant", "/assistant/jarvis", "/api/assistant/voice"]) {
    assert.equal((await unstable_getResponseFromNextConfig({ nextConfig: config, url: `https://portal.invalid${url}` })).status, 200);
  }
});

for (const mode of ["console", "dictate"]) {
  for (const [preference, expected] of [[null, false], ["0", false], ["1", true]]) {
    test(`${mode} honors spoken preference ${preference ?? "unset"} when answering`, async () => {
      const ui = runtime({ preference });
      ui.mount(ui.load(`${assistant}AssistantChat.tsx`).AssistantChat, { ...chatProps, voiceMode: mode, variant: mode === "dictate" ? "docked" : "page" });
      await ui.settle();
      await ui.send("Which openings are waiting?");
      assert.equal(ui.sent.length, 1);
      assert.deepEqual(ui.spoken, expected ? ["The saved answer."] : []);
      assert.equal(ui.storage.get("sdg-assistant-speak") ?? null, preference);
    });
  }
}

test("console SSR and blocked storage start silent; hands-free remains opt-in", async () => {
  const ssr = runtime({ server: true, preference: "1" });
  const html = renderToStaticMarkup(React.createElement(ssr.load(`${assistant}AssistantChat.tsx`).AssistantChat, chatProps));
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  const ui = runtime({ blockedStorage: true });
  ui.mount(ui.load(`${assistant}AssistantChat.tsx`).AssistantChat, chatProps);
  assert.equal(ui.check("Hands-free").props.checked, false);
  await ui.settle(); await ui.send("Who is waiting?");
  assert.deepEqual(ui.spoken, []);
});

test("saved sessions open in merged console; repeated answers refresh history without replacing the URL", async () => {
  const ui = runtime();
  ui.mount(ui.load(`${assistant}AssistantConsole.tsx`).AssistantConsole, { initialSessionId: "saved-1" });
  await ui.settle();
  assert.match(ui.text(), /Earlier saved question/);
  assert.match(ui.text(), /Saved pipeline/);
  await ui.send("First follow-up"); await ui.send("Second follow-up");
  assert.deepEqual(ui.sent.map((input) => input.sessionId), ["saved-1", "saved-1"]);
  assert.deepEqual(ui.opened, ["saved-1"]);
  assert.deepEqual(ui.history, []);
  assert.equal(ui.listReads, 3);
  ui.click("New"); await ui.settle();
  await ui.send("Start another conversation");
  assert.deepEqual(ui.history, ["/assistant", "/assistant?session=new-1"]);
  assert.equal(ui.sent.at(-1).sessionId, null);
  ui.click("Reload"); await ui.settle();
  assert.deepEqual(ui.opened, ["saved-1", "new-1"]);
});

test("voice autonomy action moves to the Assistant guard without changing its application policy", async () => {
  const ui = runtime();
  const actionPath = existsSync(path.join(root, assistant, "voice-actions.ts")) ? `${assistant}voice-actions.ts` : `${assistant}voice/actions.ts`;
  const result = await ui.load(actionPath).setVoiceAutonomy("code");
  assert.deepEqual(result, { ok: true, level: "code" });
  assert.deepEqual(ui.guarded, ["/assistant"]);
  assert.deepEqual(ui.writes, ["code"]);
});

test("voice implementation no longer lives under the retired page", () => {
  for (const name of ["AutonomyPanel.tsx", "VoiceButton.tsx", "VoiceStrip.tsx", "transcribe.ts", "useRecorder.ts", "useSpeech.ts", "useWakeWord.ts", "useJarvisHandoff.ts"]) {
    assert.ok(existsSync(path.join(root, voice, name)), `shared module: ${name}`);
    assert.ok(!existsSync(path.join(root, assistant, "voice", name)), `retired route module: ${name}`);
  }
  assert.ok(!existsSync(path.join(root, assistant, "voice/page.tsx")));
  assert.ok(!existsSync(path.join(root, assistant, "voice/VoiceConsole.tsx")));
  assert.ok(!existsSync(path.join(root, assistant, "voice/actions.ts")));
});

const three = [
  { id: "saved-1", title: "Saved pipeline", messageCount: 2, updatedAt: "2026-10-20T09:00:00Z", engine: "auto" },
  { id: "saved-2", title: "Offer letters", messageCount: 5, updatedAt: "2026-10-21T09:00:00Z", engine: "auto" },
  { id: "saved-3", title: "Openings in Cairo", messageCount: 1, updatedAt: "2026-10-22T09:00:00Z", engine: "auto" },
];

// The chat has its own lists, so the rail's rows are counted inside the named list.
const railRows = (ui) => nodes(ui.find((node) => node.type === "ul" && node.props["aria-label"] === "Your saved conversations"))
  .filter((node) => node.type === "li").length;

// The rail only ever holds the 60 newest conversations, so the box narrows those
// rows and says so — it never claims to have searched the ones it does not have.
test("the rail's search box narrows the names it holds, without another read", async () => {
  const ui = runtime({ sessions: three });
  ui.mount(ui.load(`${assistant}AssistantConsole.tsx`).AssistantConsole, { initialSessionId: null, initialQuery: "" });
  await ui.settle();
  const listed = () => railRows(ui);
  const type = (value) => {
    ui.find((node) => node.type === "input" && node.props["aria-label"] === "Search saved conversations by name")
      .props.onChange({ target: { value } });
    return ui.text();
  };
  const reads = ui.listReads;
  assert.equal(listed(), 3);

  const narrowed = type("offer");
  assert.equal(listed(), 1);
  assert.match(narrowed, /Offer letters/);
  assert.doesNotMatch(narrowed, /Saved pipeline|Openings in Cairo/);
  assert.match(narrowed, /1 of 3 names match/);
  type("OFFER");
  assert.equal(listed(), 1, "the box ignores case");
  type("letter");
  assert.equal(listed(), 1, "a word inside a name reaches that name");
  type("o");
  assert.equal(listed(), 2, "one letter reaches two names");
  assert.match(ui.text(), /2 of 3 names match/);
  type("  ");
  assert.equal(ui.text().includes("names match"), false, "spaces alone are not a search");
  assert.equal(listed(), 3);

  const none = type("zzz");
  assert.equal(listed(), 0);
  assert.match(none, /None of your 3 saved names hold “zzz”/);
  assert.match(none, /Clear the box to see the whole rail again/);
  ui.click("Clear the search");
  assert.equal(ui.find((node) => node.type === "input" && node.props["aria-label"] === "Search saved conversations by name").props.value, "");
  assert.equal(listed(), 3);
  assert.match(ui.text(), /60 most recent/);
  assert.equal(ui.listReads, reads, "narrowing the rail is a filter, not another read");
  assert.deepEqual(ui.history, [], "the box does not rewrite the address");
});

// An answer that says "your Offer letters conversation" links to /assistant?q=…
test("an address naming words arrives with the rail already narrowed", async () => {
  const ui = runtime({ sessions: three });
  ui.mount(ui.load(`${assistant}AssistantConsole.tsx`).AssistantConsole, { initialSessionId: null, initialQuery: "cairo" });
  await ui.settle();
  assert.equal(railRows(ui), 1);
  assert.match(ui.text(), /Openings in Cairo/);
  assert.doesNotMatch(ui.text(), /Offer letters/);
  assert.match(ui.text(), /1 of 3 names match/);

  const ssr = runtime({ server: true, sessions: three });
  const page = ssr.load(`${assistant}page.tsx`);
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ q: "offer letters" }) }));
  assert.match(html, /value="offer letters"/);
  assert.match(html, /Search saved conversations by name/);
  const long = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ q: "x".repeat(200) }) }));
  assert.match(long, /value="x{80}"/);
  assert.doesNotMatch(long, /x{81}/);
  assert.deepEqual([...new Set(ssr.guarded)], ["/assistant"], "every render of this page guards the same route");
  assert.equal(page.instant, false);
});

// The manual has to say what the box does, what it cannot do, and where it sits in the address.
test("the manual describes the rail box as a filter over the names the rail holds", () => {
  const guide = readFileSync(path.join(root, "src/modules/shell/domain/pageGuide.ts"), "utf8");
  assert.match(guide, /Type in the box above your saved conversations/);
  assert.match(guide, /a word inside a name reaches that name/, "the match rule is stated, not implied");
  assert.match(guide, /\/assistant\?q=offer and the rail is already narrowed/, "the address is spelled out");
  assert.match(guide, /never asks the server for another read/, "the box is a filter, not a search request");
  assert.match(guide, /The rail lists your 60 most recent conversations newest first/, "the bound the box can narrow");
  assert.match(guide, /rather than claiming it searched the older ones/, "it does not overstate its own reach");
});

// A person with nothing saved yet must not be told their zero names failed a search.
test("an empty rail keeps saying nothing saved while the box holds words", async () => {
  const ui = runtime({ sessions: [] });
  ui.mount(ui.load(`${assistant}AssistantConsole.tsx`).AssistantConsole, { initialSessionId: null, initialQuery: "offer" });
  await ui.settle();
  assert.equal(railRows(ui), 0);
  const body = ui.text();
  assert.match(body, /Nothing saved yet/);
  assert.doesNotMatch(body, /None of your 0/, "zero is not a search that found nothing");
  assert.doesNotMatch(body, /names match/);
});
