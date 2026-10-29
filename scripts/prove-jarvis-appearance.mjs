import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stubs = {
  "server-only": "export {};",
  "@/lib/auth/session": "export const getSessionUser = async () => globalThis.__appearanceUser; export const requireStaff = async route => { globalThis.__appearanceGuards.push(route); if (!globalThis.__appearanceUser) throw new Error('Unauthorized'); return globalThis.__appearanceUser; };",
  "@/lib/data-api/server": "export const createServerRestClient = async () => globalThis.__appearanceRest;",
  "@/modules/activity/application/record": "export const recordActivity = async entry => { globalThis.__appearanceTrail.push(entry); return globalThis.__appearanceAudit; };",
};
registerHooks({
  resolve(specifier, context, next) {
    if (stubs[specifier]) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = path.join(root, "src", `${specifier.slice(2)}.ts`);
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const file = fileURLToPath(new URL(`${specifier}.ts`, context.parentURL));
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const domainPath = path.join(root, "src/modules/assistant/domain/jarvisAppearance.ts");
const domain = async () => {
  assert.ok(existsSync(domainPath), "the appearance validation boundary must exist");
  return import(pathToFileURL(domainPath).href);
};
const settings = async () => import(pathToFileURL(path.join(root, "src/modules/assistant/application/jarvisAppearanceSettings.ts")).href);
const fresh = async () => structuredClone((await domain()).DEFAULT_JARVIS_APPEARANCE);

test("default appearance produces persistent custom targets and the brand/red palettes", async () => {
  const { parseJarvisAppearance, DEFAULT_JARVIS_APPEARANCE, orbPalette } = await domain();
  const result = parseJarvisAppearance(DEFAULT_JARVIS_APPEARANCE);
  assert.equal(result.ok, true);
  assert.equal(result.appearance.states.idle.palette.primary, "#b38f6f");
  assert.equal(result.appearance.states.alert.palette.primary, "#ef4444");
  for (const state of Object.values(result.appearance.states)) {
    assert.equal(typeof state.motion.energy, "number");
    assert.equal(Object.keys(state.motion).length, 8);
  }
  const palette = orbPalette(result.appearance.states.idle.palette);
  assert.equal(palette.primary, 0xb38f6f);
  assert.match(palette.fallback, /#161616/);
});

test("a color cannot inject a CSS URL, expression, alpha or invalid hex", async () => {
  const { parseJarvisAppearance } = await domain();
  for (const color of ["url(https://invalid.test/a)", "red", "#123", "#12345678", "#zzzzzz", 12]) {
    const value = await fresh();
    value.states.idle.palette.primary = color;
    assert.equal(parseJarvisAppearance(value).ok, false, String(color));
  }
});

test("every motion control rejects values outside its finite bounds", async () => {
  const { parseJarvisAppearance, MOTION_CONTROLS } = await domain();
  for (const control of MOTION_CONTROLS) {
    for (const bad of [NaN, Infinity, -Infinity, "1", control.min - 0.01, control.max + 0.01]) {
      const value = await fresh();
      value.states.thinking.motion[control.key] = bad;
      assert.equal(parseJarvisAppearance(value).ok, false, `${control.key}: ${bad}`);
    }
    for (const edge of [control.min, control.max]) {
      const value = await fresh();
      value.states.thinking.motion[control.key] = edge;
      assert.equal(parseJarvisAppearance(value).ok, true, `${control.key}: ${edge}`);
    }
  }
});

test("appearance refuses unknown runtime states and unrelated microphone/access fields", async () => {
  const { parseJarvisAppearance } = await domain();
  for (const patch of [{ ambient: true }, { profile_id: "somebody-else" }, { quality: "unlimited" }, { breathing: "true" }, { breathingIntensity: 2.5 }]) {
    assert.equal(parseJarvisAppearance({ ...await fresh(), ...patch }).ok, false);
  }
  const value = await fresh();
  value.states.working = value.states.idle;
  assert.equal(parseJarvisAppearance(value).ok, false);
  delete value.states.working;
  delete value.states.speaking;
  assert.equal(parseJarvisAppearance(value).ok, false);
});

test("named presets are bounded and unique after trimming without regard to case", async () => {
  const { parseJarvisAppearance } = await domain();
  const value = await fresh();
  const preset = { name: " Calm ", ...structuredClone(value.states.idle) };
  value.presets = [preset];
  assert.equal(parseJarvisAppearance(value).appearance.presets[0].name, "Calm");
  value.presets.push({ ...preset, name: "calm" });
  assert.equal(parseJarvisAppearance(value).ok, false);
  value.presets = Array.from({ length: 13 }, (_, i) => ({ ...preset, name: `Mood ${i}` }));
  assert.equal(parseJarvisAppearance(value).ok, false);
  for (const name of ["", " ", "a".repeat(33)]) {
    value.presets = [{ ...preset, name }];
    assert.equal(parseJarvisAppearance(value).ok, false);
  }
});

function database({ data = { appearance: null }, error = null, writeError = null, throws = false, audit = { ok: true }, user = { profileId: "viewer" } } = {}) {
  const calls = [];
  globalThis.__appearanceUser = user;
  globalThis.__appearanceTrail = [];
  globalThis.__appearanceAudit = audit;
  globalThis.__appearanceRest = {
    from(table) {
      const call = { table };
      calls.push(call);
      const query = {
        select(columns) { call.columns = columns; return query; },
        eq(key, value) { call.filter = [key, value]; return query; },
        async maybeSingle() { if (throws) throw new Error("unavailable"); return { data, error }; },
        async upsert(row, options) { call.write = row; call.options = options; return { error: writeError }; },
      };
      return query;
    },
  };
  return calls;
}

test("missing appearance column is different from no saved choice and does not arm anything", async () => {
  const { readJarvisAppearance } = await settings();
  database({ error: { code: "42703", message: "column appearance does not exist" } });
  const missing = await readJarvisAppearance("viewer");
  assert.equal(missing.problem, "absent");
  database({ data: null });
  const empty = await readJarvisAppearance("viewer");
  assert.equal(empty.problem, null);
  assert.equal(empty.stored, false);
  database({ data: { appearance: null } });
  assert.equal((await readJarvisAppearance("viewer")).stored, false);
  assert.equal("ambient" in empty.appearance, false);
});

test("a failed or corrupt settings read is not presented as a saved default", async () => {
  const { readJarvisAppearance } = await settings();
  for (const options of [{ error: { code: "42501" } }, { throws: true }, { data: { appearance: { broken: true } } }]) {
    database(options);
    const read = await readJarvisAppearance("viewer");
    assert.equal(read.problem, "unreadable");
    assert.equal(read.stored, false);
  }
});

test("saving writes only this account's appearance, leaving consent and voice preferences untouched", async () => {
  const { saveJarvisAppearance } = await settings();
  const value = await fresh();
  value.states.idle.palette.primary = "#112233";
  const calls = database();
  const result = await saveJarvisAppearance(value);
  assert.equal(result.ok, true);
  const write = calls.find(call => call.write);
  assert.deepEqual(Object.keys(write.write).sort(), ["appearance", "profile_id"]);
  assert.equal(write.write.profile_id, "viewer");
  assert.equal(write.write.appearance.states.idle.palette.primary, "#112233");
  assert.equal(write.options.onConflict, "profile_id");
  assert.equal(calls[0].columns, "appearance");
  assert.deepEqual(calls[0].filter, ["profile_id", "viewer"]);
  assert.equal(globalThis.__appearanceTrail.length, 1);
  assert.equal(globalThis.__appearanceTrail[0].actorId, "viewer");
  assert.equal(globalThis.__appearanceTrail[0].action, "jarvis_appearance_changed");
});

test("a forged draft, missing session or failed read cannot reach the appearance writer", async () => {
  const { saveJarvisAppearance } = await settings();
  for (const options of [{ user: null }, { error: { code: "42703" } }, { error: { code: "42501" } }, { throws: true }]) {
    const calls = database(options);
    assert.equal((await saveJarvisAppearance(await fresh())).ok, false);
    assert.equal(calls.some(call => call.write), false);
    assert.equal(globalThis.__appearanceTrail.length, 0);
  }
  const calls = database();
  assert.equal((await saveJarvisAppearance({ ...await fresh(), profile_id: "other" })).ok, false);
  assert.equal(calls.some(call => call.write), false);
});

test("database refusal never reports saved or creates a change-trail row", async () => {
  const { saveJarvisAppearance } = await settings();
  database({ writeError: { code: "42501", message: "private database details" } });
  const result = await saveJarvisAppearance(await fresh());
  assert.equal(result.ok, false);
  assert.equal(result.error.includes("private database details"), false);
  assert.equal(globalThis.__appearanceTrail.length, 0);
});

test("a trail failure says appearance saved but its audit could not be recorded", async () => {
  const { saveJarvisAppearance } = await settings();
  database({ audit: { ok: false, error: "private database details" } });
  const result = await saveJarvisAppearance(await fresh());
  assert.equal(result.ok, true);
  assert.match(result.warning, /saved.*audit/i);
  assert.equal(result.warning.includes("private database details"), false);
});

test("appearance actions guard both reading and saving as staff-owned requests", async () => {
  const actions = await import(pathToFileURL(path.join(root, "src/app/(admin)/settings/jarvis-actions.ts")).href);
  globalThis.__appearanceGuards = [];
  const calls = database();
  const read = await actions.getJarvisAppearance();
  assert.equal(read.problem, null);
  assert.deepEqual(calls[0].filter, ["profile_id", "viewer"]);
  assert.equal((await actions.setJarvisAppearance(await fresh())).ok, true);
  assert.deepEqual(globalThis.__appearanceGuards, ["/assistant", "/settings?area=assistant&section=appearance"]);
  database({ user: null });
  await assert.rejects(() => actions.getJarvisAppearance(), /Unauthorized/);
  await assert.rejects(() => actions.setJarvisAppearance({}), /Unauthorized/);
});

test("049 adds only a bounded nullable appearance column without changing microphone defaults", () => {
  const sql = readFileSync(path.join(root, "db/migrations/049_jarvis_appearance.sql"), "utf8");
  assert.match(sql, /alter table public\.assistant_jarvis_prefs/i);
  assert.match(sql, /add column if not exists appearance jsonb/i);
  assert.match(sql, /octet_length\(appearance::text\)/i);
  assert.doesNotMatch(sql, /update\s+public\.|drop\s+(?:table|policy)|disable row level|alter column\s+ambient/i);
});
