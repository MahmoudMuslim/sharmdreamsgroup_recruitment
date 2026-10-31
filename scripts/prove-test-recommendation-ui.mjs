import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Offline behavioral checks: real drawer logic, results, Form controls and domain.
// Only React's scheduling/browser shell and the two server actions are replaced.
// No test renderer is installed. This does not prove browser focus/layout or RSC wiring.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const uiPath = resolve(root, "src/app/(admin)/assessments/TestRecommendationDrawer.tsx");
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const Fragment = Symbol("Fragment");
const deferred = () => {
  let resolvePromise, reject;
  const promise = new Promise((resolve, fail) => { resolvePromise = resolve; reject = fail; });
  return { promise, resolve: resolvePromise, reject };
};
const options = {
  openings: [
    { id: "job-a", title: "Revenue manager", label: "Revenue manager · Open", status: "OPEN" },
    { id: "job-b", title: "Finance manager", label: "Finance manager · Draft", status: "DRAFT" },
  ],
  note: "Only the latest eligible openings are shown.",
  error: null,
};
const success = {
  ok: true,
  opening: { id: "job-a", title: "Revenue manager" },
  requirements: [
    { id: "r1", text: "Forecast resort revenue" },
    { id: "r2", text: "Explain pricing decisions" },
    { id: "r3", text: "Audit spreadsheets" },
    { id: "r4", text: "Lead a team" },
  ],
  recommendations: [
    { id: "a", name: "Revenue judgement", durationMinutes: 35, evidence: [
      { requirementId: "r1", questionId: "q1", questionTitle: "Seasonal forecast", quote: "Forecast next quarter revenue.", explanation: "The forecast task may support this requirement." },
      { requirementId: "r2", questionId: "q1", questionTitle: "Seasonal forecast", quote: "Explain your pricing decision.", explanation: "The explanation may reveal pricing judgement." },
    ] },
    { id: "b", name: "Spreadsheet audit", durationMinutes: 30, evidence: [
      { requirementId: "r2", questionId: "q2", questionTitle: "Pricing audit", quote: "Explain the pricing variance.", explanation: "The variance analysis may show pricing reasoning." },
      { requirementId: "r3", questionId: "q2", questionTitle: "Pricing audit", quote: "Find errors in this spreadsheet.", explanation: "Error checking may support spreadsheet review." },
    ] },
  ],
  // Deliberately not the domain's greedy initial choice: the UI must use the server choice.
  selectedIds: ["b"],
  notes: ["Reviewed a bounded sample of existing tests and question text."],
  model: "test/recommendation-model",
};

function harness(defaultDurationMinutes = 60) {
  const slots = [], effects = [], reads = [], requests = [], cache = new Map();
  let cursor = 0, dirty = true, mounted = true, tree, writes = 0, lateWrites = 0, closes = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      slot.set ??= (next) => {
        writes++;
        if (!mounted) lateWrites++;
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      };
      return [slot.value, slot.set];
    },
    useRef(initial) { return (slots[cursor++] ??= { current: initial }); },
    useEffect(create, dependencies) {
      const index = cursor++;
      const old = slots[index];
      if (!old || !dependencies || dependencies.some((item, i) => !Object.is(item, old.dependencies?.[i]))) {
        const slot = { dependencies, create, cleanup: old?.cleanup };
        slots[index] = slot;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = create(); });
      }
    },
    useMemo(create, dependencies) {
      const index = cursor++;
      const old = slots[index];
      if (!old || dependencies.some((item, i) => !Object.is(item, old.dependencies[i]))) {
        slots[index] = { dependencies, value: create() };
      }
      return slots[index].value;
    },
  };
  hooks.useCallback = (fn, dependencies) => hooks.useMemo(() => fn, dependencies);
  const actions = {
    getOpeningsForAuthoring() { const read = deferred(); reads.push(read); return read.promise; },
    recommendTests(input) { const request = { ...deferred(), input }; requests.push(request); return request.promise; },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule.exports);
    function localRequire(specifier) {
      if (specifier === "react") return hooks;
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment };
      if (specifier === "lucide-react") return { Loader2: () => null };
      if (specifier.endsWith("/Drawer")) return {
        Drawer: (props) => props.open ? jsx("section", { ...props, children: [
          jsx("h2", { children: props.title }), jsx("p", { children: props.subtitle }),
          jsx("form", { onSubmit: props.onSubmit, children: [props.children, props.footer] }),
        ] }) : null,
      };
      if (specifier === "./suite-authoring-actions" || specifier === "./recommendation-actions") return actions;
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(filename), specifier);
        // Resolve only source files; server actions are intercepted above, never executed.
        for (const extension of [".tsx", ".ts"]) {
          try { return load(base + extension); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        throw new Error(`Unresolved local import: ${specifier}`);
      }
      return require(specifier);
    }
    new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const Component = load(uiPath).TestRecommendationDrawer;
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap((child) => { const item = expand(child); return Array.isArray(item) ? item : [item]; });
    if (node == null || typeof node === "boolean") return null;
    if (typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.type === Fragment) return expand(node.props.children);
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  function render() {
    let turns = 0;
    while (dirty && mounted) {
      assert.ok(turns++ < 20, "render should settle");
      dirty = false; cursor = 0;
      tree = expand(Component({ defaultDurationMinutes, onClose: () => { closes++; } }));
      effects.splice(0).forEach((effect) => effect());
    }
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props.children)];
  }
  function text(node = tree) {
    if (Array.isArray(node)) return node.map(text).join(" ").replace(/\s+/g, " ");
    if (node == null || typeof node === "boolean") return "";
    return typeof node === "object" ? text(node.props.children) : String(node);
  }
  function find(predicate) {
    render(); const found = nodes().find(predicate);
    assert.ok(found, "expected rendered control/content is available"); return found;
  }
  function field(label) {
    const id = find((node) => node.type === "label" && text(node).includes(label)).props.htmlFor;
    return find((node) => node.props.id === id);
  }
  const ui = {
    reads, requests, render, text, nodes, find, field,
    get writes() { return writes; }, get lateWrites() { return lateWrites; }, get closes() { return closes; },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    change(label, value) { field(label).props.onChange({ target: { value } }); render(); },
    submit() { find((node) => node.type === "form").props.onSubmit(); render(); },
    button() { return find((node) => node.type === "button" && node.props.type === "submit"); },
    check(name) { return find((node) => node.type === "input" && node.props.type === "checkbox" && node.props["aria-label"]?.includes(name)); },
    toggle(name) { const node = ui.check(name); node.props.onChange({ target: { checked: !node.props.checked } }); render(); },
    summary() { return text(find((node) => node.props["aria-label"] === "Selection summary")); },
    gaps() { return text(find((node) => node.props["aria-label"] === "No suggested match in this selection")); },
    cancel() { find((node) => node.type === "button" && text(node) === "Cancel").props.onClick(); render(); },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
    replayEffects() {
      const active = slots.filter((slot) => slot.create);
      active.forEach((slot) => slot.cleanup?.());
      active.forEach((slot) => { slot.cleanup = slot.create(); }); render();
    },
  };
  render();
  return ui;
}

async function ready(defaultDurationMinutes = 60) {
  const ui = harness(defaultDurationMinutes);
  ui.reads[0].resolve(options); await ui.settle();
  ui.change("Job opening", "job-a");
  return ui;
}
async function recommended() {
  const ui = await ready(); ui.submit();
  ui.requests[0].resolve(structuredClone(success)); await ui.settle();
  return ui;
}

// Removing the explicit submit boundary must cause this test to fail.
test("loads openings lazily and requests recommendations only on valid explicit submit", async () => {
  const ui = harness();
  assert.equal(ui.reads.length, 1);
  assert.equal(ui.button().props.disabled, true);
  ui.submit(); assert.equal(ui.requests.length, 0);
  ui.reads[0].resolve(options); await ui.settle();
  assert.match(ui.text(), /latest eligible openings/);
  assert.equal(ui.button().props.disabled, true);
  ui.submit(); assert.equal(ui.requests.length, 0);
  ui.change("Job opening", "job-a"); ui.change("Budget", "75");
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.button().props.disabled, false);
  ui.submit();
  assert.deepEqual(ui.requests.map((request) => request.input), [{ openingId: "job-a", budgetMinutes: 75 }]);
  assert.equal(ui.button().props.disabled, true);
  ui.submit(); assert.equal(ui.requests.length, 1);
  ui.requests[0].resolve(success); await ui.settle(); ui.unmount();
});

test("clamps finite defaults to integer bounds and falls back to 60 for non-finite defaults", () => {
  for (const [input, expected] of [[60, "60"], [0, "5"], [999, "480"], [20.6, "21"], [NaN, "60"], [Infinity, "60"]]) {
    const ui = harness(input); assert.equal(ui.field("Budget").props.value, expected); ui.unmount();
  }
});

test("rejects blank, nonnumeric, fractional and out-of-range budgets even if submit is invoked", async () => {
  const ui = await ready();
  assert.equal(ui.field("Budget").props.min, 5);
  assert.equal(ui.field("Budget").props.max, 480);
  assert.equal(ui.field("Budget").props.step, 1);
  assert.equal(ui.field("Budget").props.required, true);
  for (const value of ["", " ", "NaN", "Infinity", "4", "481", "5.5"]) {
    ui.change("Budget", value);
    assert.equal(ui.button().props.disabled, true, value);
    assert.equal(ui.field("Budget").props["aria-invalid"], true, value);
    ui.submit(); assert.equal(ui.requests.length, 0);
  }
  for (const value of ["5", "480"]) {
    ui.change("Budget", value); assert.equal(ui.button().props.disabled, false);
    ui.submit(); assert.equal(ui.requests.at(-1).input.budgetMinutes, Number(value));
    ui.requests.at(-1).resolve({ ok: false, error: "Try another job." }); await ui.settle();
  }
  ui.unmount();
});

for (const rejects of [false, true]) {
  test(`opening ${rejects ? "exception" : "returned error"} is visible and leaves generation disabled`, async () => {
    const ui = harness();
    if (rejects) ui.reads[0].reject(new Error("offline"));
    else ui.reads[0].resolve({ openings: [], note: null, error: "Cannot list openings." });
    await ui.settle();
    assert.match(ui.text(ui.find((node) => node.props.role === "alert")), /opening/i);
    assert.doesNotMatch(ui.text(), /Loading openings/);
    assert.equal(ui.button().props.disabled, true);
    ui.submit(); assert.equal(ui.requests.length, 0); ui.unmount();
  });
  test(`stale options ${rejects ? "rejection" : "success"} cannot update state or clear loading after effect replay`, async () => {
    const ui = harness(); ui.replayEffects();
    const before = ui.writes;
    if (rejects) ui.reads[0].reject(new Error("stale")); else ui.reads[0].resolve(options);
    await ui.settle(); assert.equal(ui.writes, before, "including stale finally");
    assert.equal(ui.field("Job opening").props.disabled, true);
    ui.reads[1].resolve({ ...options, note: "Current picker scope" }); await ui.settle();
    assert.match(ui.text(), /Current picker scope/);
    assert.equal(ui.field("Job opening").props.disabled, false); ui.unmount();
  });
  test(`unmounted options ${rejects ? "rejection" : "success"} cannot call any setters`, async () => {
    const ui = harness(); ui.unmount();
    if (rejects) ui.reads[0].reject(new Error("late")); else ui.reads[0].resolve(options);
    await ui.settle(); assert.equal(ui.lateWrites, 0);
  });
}

test("empty picker reports no eligible openings without requesting recommendations", async () => {
  const ui = harness(); ui.reads[0].resolve({ openings: [], note: null, error: null }); await ui.settle();
  assert.match(ui.text(), /No eligible job openings/i);
  assert.equal(ui.button().props.disabled, true); assert.equal(ui.requests.length, 0); ui.unmount();
});

test("success uses server selection and presents requirement-linked evidence, scope and model", async () => {
  const ui = await recommended();
  assert.equal(ui.check("Revenue judgement").props.checked, false);
  assert.equal(ui.check("Spreadsheet audit").props.checked, true);
  assert.match(ui.summary(), /30 minutes selected/); assert.match(ui.summary(), /60 minute budget/);
  assert.match(ui.summary(), /2 of 4 requirements have a suggested match/);
  assert.match(ui.gaps(), /Forecast resort revenue/); assert.match(ui.gaps(), /Lead a team/);
  assert.doesNotMatch(ui.gaps(), /Audit spreadsheets/);
  for (const suite of success.recommendations) {
    assert.match(ui.text(), new RegExp(`${suite.durationMinutes} minutes`));
    for (const evidence of suite.evidence) {
      const quote = ui.find((node) => node.type === "blockquote" && ui.text(node).includes(evidence.quote));
      assert.ok(quote);
      const evidenceGroup = ui.find((node) => node.type === "li" && ui.text(node).includes(evidence.quote));
      for (const expected of [evidence.questionTitle, evidence.explanation, success.requirements.find((r) => r.id === evidence.requirementId).text]) {
        assert.ok(ui.text(evidenceGroup).includes(expected), expected);
      }
    }
  }
  assert.match(ui.text(), /AI-suggested matches\. Quotes are checked against question text; suitability still needs your review\./);
  assert.match(ui.text(), /Verified quot/); assert.match(ui.text(), /AI explanation/);
  assert.match(ui.text(), /bounded sample/); assert.ok(ui.text().includes(success.model));
  assert.match(ui.text(), /shortlist is not saved/i); assert.match(ui.text(), /Closing discards/i);
  assert.match(ui.text(ui.button()), /Regenerate/i); ui.unmount();
});

test("manual selection and budget edits recompute real domain totals, unique matches and advisory gaps without AI", async () => {
  const ui = await recommended(); ui.toggle("Revenue judgement");
  assert.equal(ui.check("Revenue judgement").props.checked, true);
  assert.match(ui.summary(), /65 minutes selected/);
  assert.match(ui.summary(), /3 of 4 requirements have a suggested match/);
  assert.equal(ui.gaps().trim(), "Lead a team");
  assert.match(ui.text(), /Over budget by 5 minutes/i);
  ui.toggle("Spreadsheet audit");
  assert.match(ui.summary(), /35 minutes selected/);
  assert.match(ui.summary(), /2 of 4 requirements have a suggested match/);
  assert.match(ui.gaps(), /Audit spreadsheets/); assert.doesNotMatch(ui.text(), /Over budget by/);
  ui.change("Budget", "20");
  assert.match(ui.summary(), /20 minute budget/); assert.match(ui.text(), /Over budget by 15 minutes/);
  ui.change("Budget", "");
  assert.match(ui.summary(), /35 minutes selected/); assert.doesNotMatch(ui.text(), /NaN|Infinity|Over budget by/);
  assert.equal(ui.button().props.disabled, true);
  ui.toggle("Revenue judgement");
  assert.match(ui.summary(), /0 minutes selected/); assert.match(ui.summary(), /0 of 4 requirements/);
  assert.equal(ui.requests.length, 1); ui.unmount();
});

test("empty grounded results do not claim there are no tests available", async () => {
  const ui = await ready(); ui.submit();
  ui.requests[0].resolve({ ...success, recommendations: [], selectedIds: [] }); await ui.settle();
  assert.match(ui.text(), /No grounded suggestions/i); assert.doesNotMatch(ui.text(), /No tests available/i);
  assert.match(ui.gaps(), /Forecast resort revenue/); assert.match(ui.text(), /bounded sample/);
  assert.ok(ui.text().includes(success.model)); ui.unmount();
});

for (const rejects of [false, true]) {
  test(`retry removes stale success before ${rejects ? "a thrown error" : "a server refusal"}`, async () => {
    const ui = await recommended(); ui.submit();
    assert.equal(ui.nodes().filter((node) => node.props.type === "checkbox").length, 0);
    assert.doesNotMatch(ui.text(), /test\/recommendation-model/);
    if (rejects) ui.requests[1].reject(new Error("offline")); else ui.requests[1].resolve({ ok: false, error: "Request refused." });
    await ui.settle();
    assert.ok(ui.text(ui.find((node) => node.props.role === "alert")).length > 0);
    assert.equal(ui.button().props.disabled, false);
    ui.submit(); assert.equal(ui.nodes().filter((node) => node.props.role === "alert").length, 0);
    ui.requests[2].resolve(success); await ui.settle();
    assert.equal(ui.check("Spreadsheet audit").props.checked, true); ui.unmount();
  });
}

for (const change of ["job", "budget"]) {
  for (const outcome of ["success", "refusal", "exception"]) {
    test(`${change} change invalidates pending ${outcome}, including finally, while a newer request is busy`, async () => {
      const ui = await ready(); ui.submit();
      if (change === "job") ui.change("Job opening", "job-b"); else ui.change("Budget", "45");
      assert.equal(ui.button().props.disabled, false, "editing must reset busy");
      assert.equal(ui.requests.length, 1, "editing never regenerates");
      ui.submit(); const before = ui.writes;
      if (outcome === "exception") ui.requests[0].reject(new Error("stale exception"));
      else ui.requests[0].resolve(outcome === "success" ? success : { ok: false, error: "stale refusal" });
      await ui.settle(); assert.equal(ui.writes, before, "stale result/error/finally must not set state");
      assert.equal(ui.button().props.disabled, true);
      assert.equal(ui.nodes().filter((node) => node.props.type === "checkbox").length, 0);
      ui.requests[1].resolve({ ...success, opening: { id: change === "job" ? "job-b" : "job-a", title: "Current opening" }, model: "current-model" });
      await ui.settle(); assert.match(ui.text(), /Current opening/); assert.match(ui.text(), /current-model/);
      assert.equal(ui.button().props.disabled, false); ui.unmount();
    });
  }
}

test("job change clears an existing shortlist and does not automatically regenerate", async () => {
  const ui = await recommended(); ui.change("Job opening", "job-b");
  assert.equal(ui.nodes().filter((node) => node.props.type === "checkbox").length, 0);
  assert.doesNotMatch(ui.text(), /test\/recommendation-model/);
  assert.equal(ui.requests.length, 1); ui.unmount();
});

for (const close of ["cancel", "drawer", "unmount"]) {
  for (const rejects of [false, true]) {
    test(`${close} invalidates pending ${rejects ? "exception" : "success"} without further setters`, async () => {
      const ui = await ready(); ui.submit();
      if (close === "cancel") ui.cancel();
      else if (close === "drawer") ui.find((node) => node.type === "section" && node.props.onClose).props.onClose();
      else ui.unmount();
      const before = ui.writes;
      if (rejects) ui.requests[0].reject(new Error("late")); else ui.requests[0].resolve(success);
      await ui.settle(); assert.equal(ui.writes, before); assert.equal(ui.lateWrites, 0);
      if (close !== "unmount") { assert.equal(ui.closes, 1); ui.unmount(); }
    });
  }
}
