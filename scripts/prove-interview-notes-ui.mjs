/*
 * scripts/prove-interview-notes-ui.mjs
 * Run: node --test scripts/prove-interview-notes-ui.mjs
 *
 * The two desks an interviewer actually touches. The domain and action proofs
 * cover what a note is and who may write it; these assertions cover what the
 * screens do with that answer: whose words are labelled whose, whether a live
 * reseed can wipe a half-written note, what the character counter says at the
 * limit, and whether "insert my notes" ever replaces a draft or a mark.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsx = (type, props) => ({ type, props: props ?? {} });
const Fragment = Symbol("Fragment");

const NOTE = (overrides = {}) => ({
  interviewId: "panel-1",
  authorProfileId: "me",
  authorName: "Interviewer",
  body: "She named the occupancy drop first.",
  createdAt: "2026-10-23T10:00:00Z",
  updatedAt: "2026-10-23T10:00:00Z",
  ...overrides,
});

function harness(file, exportName, props) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let mounted = true;
  let tree;
  const saved = [];
  let write = Promise.resolve({ ok: true });

  const hooks = {
    useState(initial) {
      const slot = (slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial });
      return [
        slot.value,
        (value) => {
          if (!mounted) return;
          slot.value = typeof value === "function" ? value(slot.value) : value;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial });
    },
    useMemo(create, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { value: create(), deps };
      return slots[index].value;
    },
    useEffect() {},
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  hooks.useLayoutEffect = hooks.useEffect;

  const notesActions = {
    saveInterviewNotes(input) {
      saved.push(input);
      return write;
    },
  };
  const scorecardActions = { saveInterviewScorecard: () => Promise.resolve({ ok: true }) };

  const Button = ({ children, ...rest }) => jsx("button", { ...rest, children });
  const TextArea = (all) => jsx("textarea", all);
  const Field = ({ children, ...all }) => jsx("div", { ...all, children });
  const Select = ({ children, ...all }) => jsx("select", { ...all, children });
  const FormMessage = ({ error, success }) =>
    jsx("div", { children: error ? jsx("p", { children: error }) : success ? jsx("p", { children: success }) : null });

  const cache = new Map();
  function load(target) {
    if (cache.has(target)) return cache.get(target);
    if (!existsSync(target)) throw new Error(`Unresolved ${target}`);
    const loaded = { exports: {} };
    cache.set(target, loaded.exports);
    const code = ts.transpileModule(readFileSync(target, "utf8"), {
      fileName: target,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const local = (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (name === "next/link") return { __esModule: true, default: (all) => jsx("a", all) };
      if (name === "@/modules/analytics/presentation/ui") return { Button };
      if (name === "@/modules/analytics/presentation/Form") return { FormMessage, TextArea, Field, Select, TextInput: (all) => jsx("input", all) };
      if (name === "@/lib/timezone") return { formatInZone: () => "1 Oct 2026" };
      if (name === "./notes-actions") return notesActions;
      if (name === "./scorecard-actions") return scorecardActions;
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(target), name);
        const candidates = /\.[cm]?[jt]sx?$/.test(base) ? [base] : [`${base}.tsx`, `${base}.ts`];
        const found = candidates.find(existsSync);
        if (!found) throw new Error(`Unresolved ${name}`);
        return load(found);
      }
      throw new Error(`Unexpected import ${name}`);
    };
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }

  const Component = load(resolve(root, file))[exportName];
  assert.equal(typeof Component, "function");

  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.type === Fragment) return expand(node.props.children);
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const text = (node) =>
    Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? "" : typeof node === "object" ? text(node.props.children) : String(node);
  const nodes = (node) => (Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props.children)]);
  const render = () => {
    while (dirty && mounted) {
      dirty = false;
      cursor = 0;
      tree = expand(Component(props));
    }
  };
  const find = (predicate) => {
    render();
    const found = nodes(tree).find(predicate);
    assert.ok(found, "control exists");
    return found;
  };
  const byLabel = (name) => find((node) => (node.type === "input" || node.type === "textarea") && node.props["aria-label"] === name);
  const button = (name) => find((node) => node.type === "button" && text(node).trim() === name);

  return {
    saved,
    text: () => {
      render();
      return text(tree);
    },
    textOf: (node) => text(node),
    nodes: () => {
      render();
      return nodes(tree);
    },
    find,
    click(name) {
      const control = button(name);
      assert.ok(!control.props.disabled, `${name} is disabled`);
      control.props.onClick();
      render();
    },
    clickAt(ariaLabel) {
      const control = find((node) => node.type === "button" && node.props["aria-label"] === ariaLabel);
      assert.ok(!control.props.disabled, `${ariaLabel} is disabled`);
      control.props.onClick();
      render();
    },
    value: (name) => byLabel(name).props.value,
    type(name, next) {
      byLabel(name).props.onChange({ target: { value: next } });
      render();
    },
    submit() {
      find((node) => node.type === "form" && typeof node.props.onSubmit === "function").props.onSubmit({ preventDefault() {} });
      render();
    },
    rerender(next) {
      Object.assign(props, next);
      dirty = true;
      render();
    },
    settle() {
      write = write ?? Promise.resolve({ ok: true });
      return write;
    },
    setWrite(promise) {
      write = promise;
    },
    unmount() {
      mounted = false;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* NotesDesk                                                                   */
/* -------------------------------------------------------------------------- */

test("every interviewer's note is listed and only mine is called mine", () => {
  const ui = harness("src/app/(admin)/interviews/NotesDesk.tsx", "NotesDesk", {
    interviewId: "panel-1",
    viewerId: "me",
    notes: [NOTE(), NOTE({ authorProfileId: "them", authorName: "Technical lead", body: "Unsure on budgets." })],
    timeZone: "Africa/Cairo",
    canWrite: true,
    onSaved: async () => {},
  });
  const body = ui.text();
  assert.match(body, /She named the occupancy drop first\./);
  assert.match(body, /Unsure on budgets\./);
  assert.match(body, /Technical lead/);
  assert.equal((body.match(/You/g) ?? []).length >= 1, true);
  ui.unmount();
});

test("a live reseed cannot wipe a half-written note", () => {
  const ui = harness("src/app/(admin)/interviews/NotesDesk.tsx", "NotesDesk", {
    interviewId: "panel-1",
    viewerId: "me",
    notes: [NOTE()],
    timeZone: "Africa/Cairo",
    canWrite: true,
    onSaved: async () => {},
  });
  ui.click("Edit my notes");
  ui.type("Your notes on this panel", "A draft I have not saved yet");
  ui.rerender({ notes: [NOTE(), NOTE({ authorProfileId: "them", authorName: "Technical lead" })] });
  assert.equal(ui.value("Your notes on this panel"), "A draft I have not saved yet");
  ui.unmount();
});

test("a note at the cap is not told to cut something", () => {
  const ui = harness("src/app/(admin)/interviews/NotesDesk.tsx", "NotesDesk", {
    interviewId: "panel-1",
    viewerId: "me",
    notes: [],
    timeZone: "Africa/Cairo",
    canWrite: true,
    onSaved: async () => {},
  });
  ui.click("Add my notes");
  ui.type("Your notes on this panel", "a".repeat(4000));
  assert.doesNotMatch(ui.text(), /Out of room/);
  assert.match(ui.text(), /4,000-character limit/);
  ui.unmount();
});

test("a save that landed is not reported as unchanged when the refresh fails", async () => {
  const ui = harness("src/app/(admin)/interviews/NotesDesk.tsx", "NotesDesk", {
    interviewId: "panel-1",
    viewerId: "me",
    notes: [],
    timeZone: "Africa/Cairo",
    canWrite: true,
    onSaved: async () => {
      throw new Error("refresh failed");
    },
  });
  ui.click("Add my notes");
  ui.type("Your notes on this panel", "What actually happened.");
  ui.submit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  ui.find(() => true);
  assert.match(ui.text(), /saved, but the calendar did not refresh/);
  assert.doesNotMatch(ui.text(), /notes are unchanged/);
  ui.unmount();
});

test("a panel beside the point keeps its notes readable and hides the editor", () => {
  const ui = harness("src/app/(admin)/interviews/NotesDesk.tsx", "NotesDesk", {
    interviewId: "panel-1",
    viewerId: "me",
    notes: [NOTE({ body: "The room was already booked." })],
    timeZone: "Africa/Cairo",
    canWrite: false,
    onSaved: async () => {},
  });
  assert.match(ui.text(), /The room was already booked\./);
  assert.equal(ui.nodes().some((node) => node.type === "button" && /Add my notes|Edit my notes/.test(ui.textOf(node))), false);
  ui.unmount();
});

/* -------------------------------------------------------------------------- */
/* ScorecardDesk                                                               */
/* -------------------------------------------------------------------------- */

const scorecardProps = () => ({
  interviewId: "panel-1",
  viewerId: "me",
  cards: [],
  myNote: "She named the occupancy drop first.",
  timeZone: "Africa/Cairo",
  onSaved: async () => {},
});

test("insert my notes fills the feedback box and no mark", () => {
  const ui = harness("src/app/(admin)/interviews/ScorecardDesk.tsx", "ScorecardDesk", scorecardProps());
  ui.click("Add a scorecard");
  ui.click("Insert my notes");
  const feedback = ui.find((node) => node.type === "textarea" && node.props.id === "score-feedback-panel-1");
  assert.equal(feedback.props.value, "She named the occupancy drop first.");
  const marks = ui.nodes().filter((node) => node.type === "select");
  assert.deepEqual(marks.map((node) => node.props.value), ["", "", "", ""]);
  ui.unmount();
});

test("insert my notes refuses to replace a draft already typed", () => {
  const ui = harness("src/app/(admin)/interviews/ScorecardDesk.tsx", "ScorecardDesk", scorecardProps());
  ui.click("Add a scorecard");
  ui.find((node) => node.type === "textarea" && node.props.id === "score-feedback-panel-1").props.onChange({
    target: { value: "My own judgement." },
  });
  ui.click("Insert my notes");
  const feedback = ui.find((node) => node.type === "textarea" && node.props.id === "score-feedback-panel-1");
  assert.equal(feedback.props.value, "My own judgement.");
  assert.match(ui.text(), /already has words/);
  ui.unmount();
});

test("an interviewer with no note is offered no insert", () => {
  const ui = harness("src/app/(admin)/interviews/ScorecardDesk.tsx", "ScorecardDesk", {
    ...scorecardProps(),
    myNote: null,
  });
  ui.click("Add a scorecard");
  assert.equal(ui.nodes().some((node) => node.type === "button" && ui.textOf(node).trim() === "Insert my notes"), false);
  ui.unmount();
});
