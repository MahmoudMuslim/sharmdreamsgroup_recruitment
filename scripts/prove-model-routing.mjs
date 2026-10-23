// Run: node --experimental-strip-types scripts/prove-model-routing.mjs
// Only pure domain modules are imported. Server code runs as AST-selected declarations
// in a VM with no imports, real environment, database client, or network transport.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";
import * as routing from "../src/modules/settings/domain/modelRouting.ts";
import { AI_CAPABILITIES, PROVIDERS, providerRegistry } from "../src/modules/settings/domain/providers.ts";
import { scalarEdits, changePhrase } from "../src/modules/activity/domain/trail.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  gateway: "src/modules/screening/infrastructure/aiGateway.ts",
  actions: "src/modules/settings/application/credential-actions.ts",
  probes: "src/modules/settings/application/credential-actions-ai.ts",
  resolver: "src/modules/settings/infrastructure/credentialResolver.ts",
  config: "src/lib/config.ts",
  console: "src/app/(admin)/settings/ModelRoutingConsole.tsx",
  bits: "src/app/(admin)/settings/ModelRoutingBits.tsx",
};
const files = Object.fromEntries(Object.entries(paths).map(([key, relative]) => {
  const filename = resolve(root, relative);
  return [key, ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true)];
}));
const tests = [];
const test = (name, body) => tests.push({ name, body });
const plain = (value) => JSON.parse(JSON.stringify(value));
const equal = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);
const sorted = (values) => [...values].sort();
const unique = (values) => [...new Set(values)];
const forbidden = () => { throw new Error("Proof attempted an unmocked external operation"); };

function nodesMatching(node, predicate) {
  const matches = [];
  function visit(current) {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return matches;
}

function declaration(file, name) {
  const matches = file.statements.filter((node) =>
    node.name?.getText(file) === name ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(file) === name))
  );
  assert.equal(matches.length, 1, `${file.fileName}: expected one declaration for ${name}`);
  return matches[0];
}

function evaluate(source, bindings = {}, filename = "routing-proof.ts") {
  const output = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      jsxFactory: "__jsx",
      removeComments: true,
    },
  });
  const errors = (output.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const sandbox = {
    exports: {}, Error, TypeError, Buffer, Uint8Array, URL, AbortController, AbortSignal,
    fetch: forbidden, setTimeout: forbidden, clearTimeout: forbidden,
    ...bindings,
  };
  // No require/import callback or host process is available to extracted code.
  new Script(output.outputText, { filename }).runInNewContext(sandbox, {
    timeout: 2000, contextCodeGeneration: { strings: false, wasm: false },
  });
  return sandbox.__proof;
}

function extract(file, names, bindings = {}) {
  return evaluate(
    `${unique(names.map((name) => declaration(file, name))).map((node) => node.getText(file)).join("\n")}\n` +
    `globalThis.__proof = { ${names.join(", ")} };`,
    bindings,
    file.fileName,
  );
}

const { modelChains } = extract(files.config, ["optional", "PRIMARY", "FAST", "REASONING", "FALLBACK", "modelChains"], {
  process: Object.freeze({ env: Object.freeze({}) }),
});
const { isRoutableProvider } = extract(files.actions, ["isRoutableProvider"]);
const {
  routeFor, qualifiedId, ROUTING_PREFIXES, ROUTING_FALLBACK, GOOGLE_MODEL_CHAIN,
  transcriptionChain, acceptsAudio, transcriptionRefusal, probeCaveat,
} = routing;
const shipped = [...GOOGLE_MODEL_CHAIN];
const row = (overrides = {}) => ({
  enabled: true, primaryModel: "gemini-proof-primary", fallbackModel: "gemini-proof-fallback",
  temperature: 0.65, maxTokens: 321, ...overrides,
});
const examples = [
  { id: "openrouter", provider: "openrouter", model: "google/gemini-flash-1.5", stored: "google/gemini-flash-1.5", resolver: "credentials" },
  { id: "google_ai_studio", provider: "google", model: "gemini-2.5-flash", stored: "gemini-2.5-flash", resolver: "secret" },
  { id: "opencode", provider: "opencode", model: "claude-haiku-4-5", stored: "opencode:claude-haiku-4-5", resolver: "credentials" },
  { id: "qoder", provider: "qoder", model: "qfmodel", stored: "qoder:qfmodel", resolver: "secret" },
  { id: "cloudflare_workers_ai", provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct", stored: "cloudflare:@cf/meta/llama-3.3-70b-instruct", resolver: "credentials" },
  { id: "nvidia_nim", provider: "nvidia", model: "deepseek-ai/deepseek-r1", stored: "nvidia:deepseek-ai/deepseek-r1", resolver: "credentials" },
];
const unsupported = ["gemma-4-31b-it", "nano-banana-pro-preview", "google/gemini-2.5-flash", "models/gemini-2.5-flash", "opencode:gemini-2.5-flash", "qoder:qfmodel", "cloudflare:@cf/google/gemini", "nvidia:google/gemini"];

for (const example of examples) {
  test(`route and catalogue round-trip: ${example.id}`, () => {
    equal(routeFor(example.stored), { provider: example.provider, model: example.model });
    assert.equal(qualifiedId(example.id, example.model), example.stored);
    equal(routeFor(qualifiedId(example.id, example.model)), { provider: example.provider, model: example.model });
  });
}

test("prefixes preserve namespaced catalogue ids and strip only the routing prefix", () => {
  equal(ROUTING_PREFIXES, { "opencode:": "opencode", "qoder:": "qoder", "cloudflare:": "cloudflare", "nvidia:": "nvidia" });
  equal(routeFor("opencode:vendor/model:revision"), { provider: "opencode", model: "vendor/model:revision" });
  equal(routeFor("nvidia/nemotron-3.5-lightning:free"), { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" });
  equal(routeFor("gemma-4-31b-it"), { provider: "google", model: "gemma-4-31b-it" });
});

test("registry AI providers exactly match dispatch fixtures and routability", () => {
  equal(sorted(providerRegistry.getByGroup("ai").map((p) => p.id)), sorted(examples.map((e) => e.id)));
  equal(sorted(PROVIDERS.filter((p) => p.group === "ai").map((p) => p.id)), sorted(examples.map((e) => e.id)));
  for (const provider of PROVIDERS) assert.equal(isRoutableProvider(provider.id), provider.group === "ai", provider.id);
  for (const id of ["", "unknown", "google", "cloudflare", "nvidia"]) assert.equal(isRoutableProvider(id), false, id);
});

test("AI_CAPABILITIES exactly cover config AiCapability and modelChains", () => {
  const alias = declaration(files.config, "AiCapability");
  assert.ok(ts.isTypeAliasDeclaration(alias) && ts.isUnionTypeNode(alias.type));
  const ids = alias.type.types.map((type) => {
    assert.ok(ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal));
    return type.literal.text;
  });
  const uiIds = AI_CAPABILITIES.map((c) => c.id);
  assert.equal(uiIds.length, new Set(uiIds).size, "duplicate capability cards");
  equal(sorted(uiIds), sorted(ids));
  equal(sorted(uiIds), sorted(Object.keys(modelChains)));
  for (const id of ids) assert.ok(modelChains[id].length > 0, `${id} needs a compiled chain`);
});

test("shipped audio chain contains distinct bare Gemini models", () => {
  assert.ok(shipped.length >= 2, "audio needs rescue models");
  assert.equal(new Set(shipped).size, shipped.length);
  for (const model of shipped) assert.match(model, /^gemini[^/:\s]*$/i);
});
test("transcription order is configured primary, fallback, then shipped models", () => {
  equal(transcriptionChain(row()), ["gemini-proof-primary", "gemini-proof-fallback", ...shipped]);
});
test("transcription removes duplicate configured picks", () => {
  equal(transcriptionChain(row({ fallbackModel: "gemini-proof-primary" })), ["gemini-proof-primary", ...shipped]);
});
test("transcription trims stored picks before eligibility and deduplication", () => {
  equal(transcriptionChain(row({ primaryModel: " gemini-proof-primary ", fallbackModel: "\tgemini-proof-primary\n" })), ["gemini-proof-primary", ...shipped]);
});
test("transcription removes duplicates shared with the shipped chain without reordering", () => {
  equal(transcriptionChain(row({ primaryModel: shipped[1], fallbackModel: shipped[0] })), [shipped[1], shipped[0], ...shipped.slice(2)]);
});
test("unsupported transcription picks are skipped, not dispatched to text providers", () => {
  for (const model of unsupported) {
    equal(transcriptionChain(row({ primaryModel: model })), ["gemini-proof-fallback", ...shipped], model);
    equal(transcriptionChain(row({ fallbackModel: model })), ["gemini-proof-primary", ...shipped], model);
  }
});
for (const [label, value] of [["disabled", row({ enabled: false })], ["absent", undefined], ["null", null], ["resolver fallback", ROUTING_FALLBACK]]) {
  test(`transcription ${label} row uses the shipped chain`, () => equal(transcriptionChain(value), shipped));
}

test("audio acceptance is limited to bare Gemini, not Gemma or provider-qualified Gemini", () => {
  for (const id of ["gemini-2.5-flash", "GEMINI-2.5-FLASH"]) assert.equal(acceptsAudio(id), true, id);
  for (const id of [...unsupported, "", " \t\n"]) assert.equal(acceptsAudio(id), false, JSON.stringify(id));
});
test("audio acceptance trims whitespace like the save path", () => {
  assert.equal(acceptsAudio(" \tgemini-2.5-flash\n"), true);
  assert.equal(acceptsAudio(" gemma-4-31b-it "), false);
});
for (const primary of ["", " \t\n"]) {
  test(`transcription refusal rejects empty primary ${JSON.stringify(primary)}`, () => {
    assert.ok(transcriptionRefusal(primary, "gemini-2.5-flash"), "an optional fallback cannot replace a required primary");
  });
}
test("transcription refusal accepts Gemini with an omitted or empty fallback", () => {
  for (const fallback of [undefined, null, "", " \t", "gemini-2.5-pro"]) assert.equal(transcriptionRefusal("gemini-2.5-flash", fallback), null);
});
test("transcription refusal normalizes both picks like saveModelRouting", () => {
  assert.equal(transcriptionRefusal(" \tgemini-2.5-flash\n", " gemini-2.5-pro "), null);
});
test("transcription refusal rejects unsupported primary and fallback independently", () => {
  for (const model of unsupported) {
    assert.ok(transcriptionRefusal(model, null), `accepted primary ${model}`);
    assert.ok(transcriptionRefusal("gemini-2.5-flash", model), `accepted fallback ${model}`);
  }
});
test("only transcription probes carry a text-versus-audio caveat", () => {
  const caveat = probeCaveat("transcription");
  assert.equal(typeof caveat, "string");
  assert.match(caveat, /text/i);
  assert.match(caveat, /audio|recording/i);
  for (const id of [...AI_CAPABILITIES.map((c) => c.id), "unknown", ""]) {
    if (id !== "transcription") assert.equal(probeCaveat(id), null, id);
  }
});

// The production branches stay intact; only external resolution and provider I/O
// are replaced. Distinct dummy keys catch billing a hop to the wrong provider.
function gateway(options = {}) {
  const calls = [], resolutions = [], timers = new Set();
  const configured = Object.hasOwn(options, "routing") ? options.routing : row();
  const keyFor = (id) => `proof-only/${id}`;
  const credentialsFor = (id) => options.credentials?.[id] ?? [{
    provider: id, priority: 1, secret: keyFor(id), secretHint: `hint/${id}`,
    config: id === "cloudflare_workers_ai" ? { account_id: " proof-account " } : {}, extraSecrets: {},
  }];
  const bindings = {
    ...routing, modelChains,
    aiConfig: Object.fromEntries(["openRouter", "googleAiStudio", "openCode", "nvidiaNim", "cloudflareWorkersAi"].map((id) => [id, {
      baseUrl: `https://${id.toLowerCase()}.invalid/v1`, timeoutMs: 5000, accountId: "",
    }])),
    QODER_COMPLETION_TIMEOUT_MS: 5000,
    resolveCredentials: async (id) => {
      resolutions.push(["credentials", id]);
      assert.ok(examples.some((e) => e.id === id), `unknown credential path ${id}`);
      return credentialsFor(id);
    },
    resolveSecret: async (id) => {
      resolutions.push(["secret", id]);
      assert.ok(examples.some((e) => e.id === id), `unknown secret path ${id}`);
      return credentialsFor(id)[0]?.secret ?? null;
    },
    resolveModelRouting: async (capability) => {
      resolutions.push(["routing", capability]);
      if (options.routingError) throw options.routingError;
      return configured;
    },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.add(timer); return timer; },
    clearTimeout: (timer) => timers.delete(timer),
    fetch: async (url, init) => {
      const parsed = new URL(url);
      const model = decodeURIComponent(parsed.pathname.split("/models/")[1]?.split(":generateContent")[0] ?? "");
      const call = { provider: "google", model, url: parsed, init, body: JSON.parse(init.body) };
      calls.push(call);
      return options.fetch ? options.fetch(call, calls.length - 1) : forbidden();
    },
  };
  const transport = async (provider, model, request, key, signal, accountId, chain) => {
    const call = { provider, model, request, key, signal, accountId, chain };
    calls.push(call);
    if (options.transport) await options.transport(call, calls.length - 1);
    return { content: JSON.stringify({ provider, model, key, accountId }), model, truncated: false };
  };
  for (const [name, provider] of [["callOpenRouter", "openrouter"], ["callOpenCode", "opencode"], ["callNvidiaNim", "nvidia"], ["callCloudflareWorkersAi", "cloudflare"]]) {
    bindings[name] = (model, request, signal, key, accountId) => transport(provider, model, request, key, signal, accountId);
  }
  bindings.callGoogleAiStudio = (request, signal, key, chain = shipped) => transport("google", chain[0], request, key, signal, undefined, [...chain]);
  bindings.callQoderCompletion = (model, messages, key, controller) => transport("qoder", model, { messages }, key, controller.signal);
  const api = extract(files.gateway, ["AiGatewayError", "RecordingNotTranscribableError", "MAX_INLINE_MEDIA_BYTES", "transcribeRecording", "complete"], bindings);
  return {
    ...api, calls, resolutions,
    async transcribe(bytes = new Uint8Array([0, 1, 2, 253, 254, 255]), mime = "audio/webm") {
      try { return await api.transcribeRecording(bytes, mime); }
      finally { assert.equal(timers.size, 0, "transcription leaked a timeout"); }
    },
    async complete(request = {}) {
      try { return await api.complete({ capability: "feedback", messages: [{ role: "user", content: "proof prompt" }], ...request }); }
      finally { assert.equal(timers.size, 0, "completion leaked a timeout"); }
    },
  };
}
const reply = (...texts) => Response.json({ candidates: [{ content: { parts: texts.map((text) => ({ text })) } }] });
const failed = (status) => new Response(`fixture failure ${status}`, { status });
const callModels = (harness) => harness.calls.map((call) => call.model);
const captureError = async (operation, ErrorClass = Error) => {
  try { await operation(); }
  catch (error) { assert.ok(error instanceof ErrorClass, `expected ${ErrorClass.name}, received ${error}`); return error; }
  assert.fail("expected rejection, but operation succeeded");
};

test("real transcription sends configured order, inline media, and the Google resolver inputs", async () => {
  const order = ["gemini-proof-primary", "gemini-proof-fallback", ...shipped];
  const h = gateway({ fetch: (_call, index) => index === order.length - 1 ? reply("  spoken ", "words  ") : failed(503) });
  assert.equal(await h.transcribe(), "spoken words");
  equal(callModels(h), order);
  equal(sorted(h.resolutions.map((r) => r.join(":"))), ["routing:transcription", "secret:google_ai_studio"]);
  for (const call of h.calls) {
    assert.equal(call.url.hostname, "googleaistudio.invalid");
    assert.equal(call.url.searchParams.get("key"), "proof-only/google_ai_studio");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.ok(call.init.signal instanceof AbortSignal);
    const parts = call.body.contents[0].parts;
    equal(parts.filter((part) => part.inlineData), [{ inlineData: { mimeType: "audio/webm", data: "AAEC/f7/" } }]);
    assert.ok(parts.some((part) => /NO_SPEECH/.test(part.text ?? "")));
    assert.equal(call.body.generationConfig.temperature, 0);
    assert.ok(call.body.generationConfig.maxOutputTokens > 0);
  }
});
test("real transcription deduplicates configured and shipped models on the wire", async () => {
  const h = gateway({ routing: row({ primaryModel: shipped[1], fallbackModel: shipped[0] }), fetch: () => failed(503) });
  await captureError(() => h.transcribe());
  equal(callModels(h), [shipped[1], shipped[0], ...shipped.slice(2)]);
});
for (const [label, configured] of [["unsupported", row({ primaryModel: "qoder:qfmodel", fallbackModel: "google/gemini-flash-1.5" })], ["disabled", row({ enabled: false })], ["absent", null], ["resolver fallback", ROUTING_FALLBACK]]) {
  test(`real transcription ${label} row walks only shipped models`, async () => {
    const h = gateway({ routing: configured, fetch: (_call, i) => i === shipped.length - 1 ? reply("rescued") : failed(404) });
    assert.equal(await h.transcribe(), "rescued");
    equal(callModels(h), shipped);
  });
}
for (const [label, response] of [["NO_SPEECH", () => reply(" \nno_speech \t")], ["empty transcript", () => reply("  ")], ["no candidates", () => Response.json({ candidates: [] })]]) {
  test(`real transcription ${label} returns empty without another model call`, async () => {
    const h = gateway({ fetch: response });
    assert.equal(await h.transcribe(), "");
    equal(callModels(h), ["gemini-proof-primary"]);
  });
}
for (const status of [404, 429, 500, 502, 503, 504]) {
  test(`real transcription rescues HTTP ${status} with the configured fallback`, async () => {
    const h = gateway({ fetch: (_call, index) => index === 0 ? failed(status) : reply("fallback transcript") });
    assert.equal(await h.transcribe(), "fallback transcript");
    equal(callModels(h), ["gemini-proof-primary", "gemini-proof-fallback"]);
  });
}
for (const [label, failure] of [["network exception", () => { throw new Error("fixture network failure"); }], ["malformed JSON", () => new Response("not-json", { status: 200 })]]) {
  test(`real transcription rescues ${label}`, async () => {
    const h = gateway({ fetch: (_call, i) => i === 0 ? failure() : reply("recovered") });
    assert.equal(await h.transcribe(), "recovered");
    equal(callModels(h), ["gemini-proof-primary", "gemini-proof-fallback"]);
  });
}
test("real transcription exhaustion reports all models and provider errors", async () => {
  const h = gateway({ fetch: (_call, i) => i === 0 ? failed(403) : failed(503) });
  const error = await captureError(() => h.transcribe());
  assert.equal(error instanceof h.RecordingNotTranscribableError, false);
  equal(callModels(h), ["gemini-proof-primary", "gemini-proof-fallback", ...shipped]);
  for (const model of callModels(h)) assert.ok(error.message.includes(model), `missing failure for ${model}`);
  assert.match(error.message, /403/);
  assert.match(error.message, /503/);
});
test("real transcription oversized refusal happens before resolution or fetch", async () => {
  const h = gateway();
  assert.ok(h.MAX_INLINE_MEDIA_BYTES > 0);
  await captureError(() => h.transcribe(new Uint8Array(h.MAX_INLINE_MEDIA_BYTES + 1)), h.RecordingNotTranscribableError);
  equal(h.calls, []);
  equal(h.resolutions, []);
});
test("real transcription permits the exact inline media size limit", async () => {
  const h = gateway({ fetch: () => reply("at limit") });
  assert.equal(await h.transcribe(new Uint8Array(h.MAX_INLINE_MEDIA_BYTES), "video/mp4"), "at limit");
  const inline = h.calls[0].body.contents[0].parts[0].inlineData;
  assert.equal(inline.mimeType, "video/mp4");
  assert.equal(Buffer.from(inline.data, "base64").length, h.MAX_INLINE_MEDIA_BYTES);
});
test("real transcription missing key is a nontranscribable refusal, with no fetch", async () => {
  const h = gateway({ credentials: { google_ai_studio: [] } });
  await captureError(() => h.transcribe(), h.RecordingNotTranscribableError);
  equal(h.calls, []);
});
test("real transcription routing read errors propagate without a paid call", async () => {
  const problem = new Error("fixture resolver unavailable");
  const h = gateway({ routingError: problem });
  assert.equal(await captureError(() => h.transcribe()), problem);
  equal(h.calls, []);
});

for (const example of examples) {
  test(`real complete dispatch and credential path: ${example.id}`, async () => {
    const h = gateway({ routing: row({ primaryModel: example.stored, fallbackModel: "opencode:unused-fallback" }) });
    const result = await h.complete();
    assert.equal(result.provider, example.provider);
    assert.equal(result.model, example.model);
    equal(JSON.parse(result.content), {
      provider: example.provider, model: example.model, key: `proof-only/${example.id}`,
      ...(example.id === "cloudflare_workers_ai" ? { accountId: "proof-account" } : {}),
    });
    equal(callModels(h), [example.model]);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].ok, true);
    assert.equal(result.truncated, false);
    assert.ok(h.calls[0].signal instanceof AbortSignal);
    equal(h.calls[0].request.messages, [{ role: "user", content: "proof prompt" }]);
    if (example.provider !== "qoder") {
      assert.equal(h.calls[0].request.temperature, 0.65);
      assert.equal(h.calls[0].request.maxTokens, 321);
    }
    equal(sorted(h.resolutions.map(([kind, id]) => `${kind}:${id}`)), sorted([
      "credentials:openrouter", "secret:google_ai_studio", "credentials:opencode",
      "secret:qoder", "credentials:nvidia_nim", "credentials:cloudflare_workers_ai", "routing:feedback",
    ]));
  });
  test(`real complete explicit override failure never rescues: ${example.id}`, async () => {
    const h = gateway({ transport: () => { throw new Error("fixture selected model failed"); } });
    const error = await captureError(() => h.complete({ modelOverride: ` ${example.stored} ` }), h.AiGatewayError);
    equal(callModels(h), [example.model]);
    assert.equal(h.calls[0].provider, example.provider);
    assert.equal(error.attempts.length, 1);
    assert.equal(error.attempts[0].ok, false);
    assert.match(error.message, /fixture selected model failed/);
    if (example.provider === "google") equal(h.calls[0].chain, [example.model]);
  });
}
test("real complete walks configured primary before fallback across providers", async () => {
  const h = gateway({ routing: row({ primaryModel: "gemini-proof-primary", fallbackModel: "opencode:claude-haiku-4-5" }), transport: (_call, i) => { if (i === 0) throw new Error("primary failed"); } });
  const result = await h.complete({ temperature: 0, maxTokens: 99 });
  equal(callModels(h), ["gemini-proof-primary", "claude-haiku-4-5"]);
  assert.equal(result.provider, "opencode");
  equal(result.attempts.map((a) => a.ok), [false, true]);
  assert.equal(h.calls[1].request.temperature, 0);
  assert.equal(h.calls[1].request.maxTokens, 99);
});
for (const { id } of AI_CAPABILITIES) {
  test(`real complete disabled routing falls through to compiled defaults: ${id}`, async () => {
    const h = gateway({ routing: row({ enabled: false }) });
    const result = await h.complete({ capability: id });
    assert.equal(result.model, modelChains[id][0]);
    equal(callModels(h), [modelChains[id][0]]);
    assert.ok(h.resolutions.some(([kind, capability]) => kind === "routing" && capability === id));
  });
}
test("real complete final Google rescue excludes previously tried shipped models", async () => {
  const beforeRescue = unique([shipped[0], ...modelChains.feedback]);
  const h = gateway({ routing: row({ primaryModel: shipped[0], fallbackModel: shipped[0] }), transport: (_call, i) => { if (i < beforeRescue.length) throw new Error("regular hop failed"); } });
  const result = await h.complete();
  equal(callModels(h), [...beforeRescue, shipped[1]]);
  equal(h.calls.at(-1).chain, shipped.slice(1));
  assert.equal(result.provider, "google");
  assert.equal(result.model, shipped[1]);
  equal(result.attempts.map((a) => a.ok), [...beforeRescue.map(() => false), true]);
});
test("real complete missing override credential cannot silently use another provider", async () => {
  const h = gateway({ credentials: { qoder: [] } });
  const error = await captureError(() => h.complete({ modelOverride: "qoder:qfmodel" }), h.AiGatewayError);
  equal(h.calls, []);
  assert.equal(error.attempts.length, 1);
  assert.equal(error.attempts[0].model, "qoder:qfmodel");
  assert.equal(error.attempts[0].ok, false);
});
test("real complete credential failover retries the same model with the next key", async () => {
  const credentials = [1, 2].map((priority) => ({ provider: "opencode", priority, secret: `proof-key-${priority}`, secretHint: `key-${priority}`, config: {}, extraSecrets: {} }));
  const h = gateway({ credentials: { opencode: credentials }, transport: (call) => { if (call.key === "proof-key-1") throw new Error("first key failed"); } });
  const result = await h.complete({ modelOverride: "opencode:claude-haiku-4-5" });
  equal(callModels(h), ["claude-haiku-4-5", "claude-haiku-4-5"]);
  equal(result.attempts.map((a) => [a.credential, a.ok]), [["key-1", false], ["key-2", true]]);
  assert.equal(JSON.parse(result.content).key, "proof-key-2");
});
test("real complete no credentials fails without any provider transport", async () => {
  const h = gateway({ credentials: Object.fromEntries(examples.map((e) => [e.id, []])) });
  const error = await captureError(() => h.complete(), h.AiGatewayError);
  equal(error.attempts, []);
  equal(h.calls, []);
});

// The REST-shaped doubles below are in-memory only. They capture the real save
// payload and resolution query; they cannot import a service or open a database.
function memoryRest(data = null, error = null) {
  const queries = [], writes = [];
  return {
    queries, writes,
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        async order(column) { query.order = column; return { data, error }; },
        async maybeSingle() { return { data, error }; },
        async upsert(value) { writes.push({ table, value: plain(value) }); return { data: null, error }; },
      };
    },
  };
}
test("real routing list distinguishes an empty table from a failed read", async () => {
  for (const error of [null, { message: "fixture read failure" }]) {
    const rest = memoryRest(null, error);
    const { listModelRouting } = extract(files.actions, ["listModelRouting"], {
      requireStaff: async () => {}, createServerRestClient: async () => rest,
    });
    if (error) await assert.rejects(listModelRouting);
    else equal(await listModelRouting(), []);
    assert.equal(rest.queries[0].table, "ai_model_config");
    assert.equal(rest.queries[0].order, "capability");
  }
});
function saveHarness() {
  const rest = memoryRest();
  const { saveModelRouting } = extract(files.actions, ["saveModelRouting"], {
    ...routing, AI_CAPABILITIES, scalarEdits, changePhrase,
    requireStaff: async () => {}, hasPermissionForUser: async () => true,
    createServerRestClient: async () => rest, recordActivity: async () => {}, revalidatePath: () => {},
  });
  return { rest, save: (input) => saveModelRouting({ capability: "transcription", primaryModel: "gemini-2.5-flash", fallbackModel: null, temperature: 0.3, maxTokens: 1200, isEnabled: true, ...input }) };
}
for (const primaryModel of ["", " \n", "gemma-4-31b-it", "qoder:qfmodel"]) {
  test(`real save refuses invalid transcription before persistence: ${JSON.stringify(primaryModel)}`, async () => {
    const h = saveHarness();
    assert.equal((await h.save({ primaryModel })).ok, false);
    equal(h.rest.writes, []);
  });
}
test("real save trims accepted Gemini primary and fallback in the persisted payload", async () => {
  const h = saveHarness();
  assert.equal((await h.save({ primaryModel: " gemini-2.5-flash ", fallbackModel: "\tgemini-2.5-pro\n" })).ok, true);
  equal(h.rest.writes, [{ table: "ai_model_config", value: {
    capability: "transcription", primary_model: "gemini-2.5-flash", fallback_model: "gemini-2.5-pro",
    temperature: 0.3, max_tokens: 1200, is_enabled: true, updated_by: null,
  } }]);
});
test("real save rejects unsupported transcription fallback but permits it for text tasks", async () => {
  const h = saveHarness();
  assert.equal((await h.save({ fallbackModel: "opencode:claude-haiku-4-5" })).ok, false);
  equal(h.rest.writes, []);
  assert.equal((await h.save({ capability: "feedback", primaryModel: "qoder:qfmodel" })).ok, true);
  assert.equal(h.rest.writes[0].value.primary_model, "qoder:qfmodel");
});
test("real resolver returns shared fallback for absent rows and read failures", async () => {
  for (const broken of [false, true]) {
    const rest = memoryRest();
    const api = extract(files.resolver, ["resolveModelRouting"], {
      ROUTING_FALLBACK, getServiceRestClient: () => { if (broken) throw new Error("offline fixture"); return rest; },
    });
    equal(await api.resolveModelRouting("feedback"), ROUTING_FALLBACK);
    if (!broken) {
      assert.equal(rest.queries[0].table, "ai_model_config");
      equal(rest.queries[0].filters, [["capability", "feedback"]]);
    }
  }
});

test("UI hydration consumes shared fallback for missing cards and preserves stored rows", () => {
  const hydration = nodesMatching(files.console, (n) => ts.isVariableDeclaration(n) && n.name.getText(files.console) === "hydrated");
  assert.equal(hydration.length, 1, "locate the console's real hydration expression");
  const expression = hydration[0].initializer.getText(files.console);
  const stored = { capability: "feedback", primaryModel: "qoder:qfmodel", fallbackModel: null, temperature: 1.2, maxTokens: 777, isEnabled: false, updatedAt: "2026-01-01" };
  const hydrate = (fallback) => evaluate(`globalThis.__proof = (${expression});`, { AI_CAPABILITIES, ROUTING_FALLBACK: fallback, routing: [stored] });
  for (const fallback of [ROUTING_FALLBACK, row({ enabled: false, primaryModel: "opencode:fixture", fallbackModel: null, temperature: 0, maxTokens: 99 })]) {
    const hydrated = hydrate(fallback);
    equal(sorted(hydrated.map((r) => r.capability)), sorted(AI_CAPABILITIES.map((c) => c.id)));
    for (const card of hydrated) {
      const want = card.capability === "feedback" ? stored : { ...fallback, isEnabled: fallback.enabled };
      for (const key of ["primaryModel", "fallbackModel", "temperature", "maxTokens", "isEnabled"]) equal(card[key], want[key], `${card.capability}.${key}`);
    }
  }
});

function probeHarness(fail = false) {
  const h = gateway({ transport: () => { if (fail) throw new Error("fixture probe failure"); } });
  const api = extract(files.probes, ["PROBE_PROMPT", "excerpt", "reportFailure", "withCaveat", "testCapability"], {
    ...routing, AI_CAPABILITIES, AiGatewayError: h.AiGatewayError,
    requireStaff: async () => {}, resolveModelRouting: async () => row(), complete: h.complete,
  });
  return { ...h, ...api };
}
for (const fail of [false, true]) {
  test(`real capability probe ${fail ? "failure" : "success"} distinguishes text from audio only for transcription`, async () => {
    for (const { id } of AI_CAPABILITIES) {
      const h = probeHarness(fail);
      const result = await h.testCapability(id);
      assert.equal(result.ok, !fail, id);
      if (id === "transcription") {
        assert.match(result.detail, /text/i);
        assert.match(result.detail, /audio|recording/i);
        assert.ok(result.detail.includes(probeCaveat(id)), "probe dropped the shared caveat");
      } else {
        assert.equal(result.detail.includes(probeCaveat("transcription")), false, id);
      }
      assert.ok(h.calls.length > 0);
      for (const call of h.calls) {
        assert.equal(call.body, undefined, "a capability probe must not send inline media");
        assert.ok(call.request.messages.every((m) => typeof m.content === "string"));
      }
    }
  });
}
test("UI probe badge exposes diagnostic detail including the transcription caveat", () => {
  const { ProbeBadge } = extract(files.bits, ["ProbeBadge"], {
    ...routing, cn: (...values) => values.filter(Boolean).join(" "), CheckCircle2: "check-icon", XCircle: "error-icon",
    __jsx: (tag, props, ...children) => ({ tag, props: props ?? {}, children }),
  });
  for (const ok of [true, false]) {
    const detail = `fixture result; ${probeCaveat("transcription")}`;
    const tree = ProbeBadge({ result: { capability: "transcription", ok, detail, servedBy: "fixture Gemini", latencyMs: 12, status: "fixture failure" } });
    const containsDetail = (node) => node && typeof node === "object" &&
      (node.props?.title === detail || node.children?.some((child) => child === detail || containsDetail(child)));
    assert.ok(containsDetail(tree), "badge hides the diagnostic caveat");
  }
});

let passed = 0;
const failures = [];
for (const { name, body } of tests) {
  try {
    await body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\nModel routing proof: ${passed} passed; ${failures.length} failed; ${tests.length} checks.`);
console.log("External operations: mocked only; no network, environment files, credentials, or live database writes.");
process.exitCode = failures.length ? 1 : 0;
