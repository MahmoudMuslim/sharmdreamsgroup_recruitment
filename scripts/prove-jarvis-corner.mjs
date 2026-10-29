#!/usr/bin/env node
/**
 * The orb is the launcher, and it rests small in the corner.
 *
 * `prove-jarvis-presence.mjs` proves what the presence may hear and say; this file
 * proves only what it looks like and where it sits, because those are the two things
 * that changed when the old floating "Assistant" pill was deleted:
 *
 * - the dock no longer offers a second floating launcher, so the orb (and Ctrl+Space)
 *   is the one way in that floats over a page;
 * - an idle, closed, quiet orb shrinks and tucks into the corner after a moment, and
 *   a pointer or a tab focus brings it back at full size;
 * - the palette is the portal's own gold family, with red kept for the one alert.
 *
 * These are source-text proofs. The behaviour they pin is CSS classes and one timer,
 * and the repo's other proof scripts are written the same way where a headless
 * browser would only be re-testing Tailwind. Every check is paired with a mutation
 * that breaks the rule and must turn the check red.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DOCK = "src/app/(admin)/assistant/AssistantDock.tsx";
const PRESENCE = "src/modules/assistant/presentation/JarvisPresence.tsx";
const REACTOR = "src/modules/assistant/presentation/JarvisReactor.tsx";
const APPEARANCE = "src/modules/assistant/domain/jarvisAppearance.ts";
const GUIDE = "src/modules/shell/domain/pageGuide.ts";

function read(rel) {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return "";
  }
}

class Red extends Error {}
function expect(ok, detail) {
  if (!ok) throw new Red(detail);
}

const results = [];
const mutations = [];

async function safe(run) {
  try {
    await run();
    return { pass: true, detail: "held" };
  } catch (cause) {
    return { pass: false, detail: cause instanceof Red ? cause.message : `threw: ${cause.message}` };
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function check1() {
  const dock = read(DOCK);
  expect(dock.length > 0, `${DOCK} is missing`);
  expect(!dock.includes("Open the assistant"), "the dock still offers a floating launcher");
  expect(!dock.includes("toggleJarvisOpen"), "the dock still imports the orb's toggle for a second button");
  expect(dock.includes("<AssistantChat"), "the dock no longer renders the conversation itself");
  const presence = read(PRESENCE);
  expect(presence.includes("toggleJarvisOpen"), "the orb lost its own launcher behaviour");
}

function check2() {
  const reactor = read(REACTOR);
  expect(reactor.includes("ariaExpanded?: boolean;"), "the reactor does not accept the expanded state");
  // The gate is named here rather than in prove-jarvis-stage.mjs because this is the
  // check that owns the claim: only a surface that really opens something may say so.
  expect(
    reactor.includes("const interactive = !preview && Boolean(onClick);"),
    "the reactor decides its own interactivity from something other than having a click"
  );
  expect(
    reactor.includes("aria-expanded={interactive ? ariaExpanded : undefined}"),
    "the orb's button never says whether it is expanded, or a surface with no click claims it is"
  );
  const presence = read(PRESENCE);
  expect(
    presence.includes("ariaExpanded={onStage ? undefined : ui.open}"),
    "the presence does not pass the conversation's open state, or the stage's orb claims a panel it has none of"
  );
}

function check3() {
  const presence = read(PRESENCE);
  expect(
    presence.includes(
      "const canRest = !ui.open && state === \"idle\" && !announcement && watcher.news.length === 0 && !onStage;"
    ),
    "the orb may rest while open, busy, speaking, holding news, or on a screen it does not belong to"
  );
  expect(
    presence.includes("const resting = canRest && idle && !expanded;"),
    "the resting shape is not gated by both the timer and the pointer"
  );
  expect(
    presence.includes("if (!canRest) return;"),
    "the rest timer runs even while the orb has something to show"
  );
}

function check4() {
  const presence = read(PRESENCE);
  expect(presence.includes("const REST_AFTER_MS = 2500;"), "the rest timer is missing or changed");
  expect(
    presence.includes("window.setTimeout(() => setIdle(true), REST_AFTER_MS)"),
    "nothing ever starts the rest"
  );
  expect(presence.includes("[canRest]"), "the rest timer does not reset when the orb changes state");
  expect(
    presence.includes("onPointerEnter={() => setExpanded(true)}"),
    "hovering does not wake the orb"
  );
  expect(
    presence.includes("onPointerLeave={() => setExpanded(false)}"),
    "leaving the orb does not let it rest again"
  );
  expect(presence.includes("onFocus={() => setExpanded(true)}"), "tab focus does not wake the orb");
  expect(presence.includes("onBlur={() => setExpanded(false)}"), "leaving the orb by keyboard does not let it rest");
}

function check5() {
  const presence = read(PRESENCE);
  expect(
    presence.includes("translate-x-[34%] translate-y-[34%] scale-50"),
    "the resting orb shrinks without tucking, or tucks without shrinking"
  );
  expect(
    presence.includes("translate-x-0 translate-y-0 scale-100"),
    "the awake orb does not return to full size in the corner"
  );
  expect(presence.includes("origin-bottom-right"), "the orb does not scale about its corner");
  expect(presence.includes("motion-reduce:transition-none"), "the resize ignores reduced-motion");
  expect(
    presence.includes("[@media(hover:none)]:translate-x-0") &&
      presence.includes("[@media(hover:none)]:scale-75"),
    "a touch screen gets an orb it cannot wake"
  );
  expect(presence.includes("showStatus={!resting}"), "the status line still draws under a resting orb");
  expect(
    presence.includes('ui.open ? "bottom-5 left-5 hidden sm:block" : "bottom-5 right-5"'),
    "the orb no longer moves beside an open panel, or no longer sits in the corner"
  );
}

/**
 * The six default palettes, as the domain file writes them.
 *
 * Parsed rather than matched one literal at a time: the claim is about which
 * states are gold and which one is red, so a recolour that keeps that shape stays
 * green and a state quietly turned cyan does not.
 */
function defaultPalettes() {
  const block = read(APPEARANCE).split("export const DEFAULT_JARVIS_APPEARANCE")[1] ?? "";
  return [...block.matchAll(/(\w+): \{\s*\n\s*palette: \{([^}]*)\}/g)].map(([, state, body]) => ({
    state,
    colors: [...body.matchAll(/(\w+): "(#[0-9a-fA-F]{6})"/g)].map(([, key, hex]) => ({ key, hex })),
  }));
}

const GOLD = ["#b38f6f", "#d4b393", "#a87c52", "#8a6237", "#6b4a28", "#c19a76", "#e8d5bd", "#f2f1ed",
  "#faf9f6", "#fffdf9", "#fff8ee", "#fffaf3", "#f5f4f0", "#161616", "#1c1b1a", "#241a10"];
const REDDISH = ["#ef4444", "#dc2626", "#fca5a5", "#fff1f2", "#450a0a"];

function check6() {
  const palettes = defaultPalettes();
  expect(palettes.length === 6, `the default appearance describes ${palettes.length} states, not six`);
  const gold = palettes.filter(({ state }) => state !== "alert");
  expect(gold.length === 5, "fewer than five states are left to wear the gold family");
  for (const { state, colors } of gold) {
    expect(colors.length === 5, `${state} has ${colors.length} colors, not the five the renderer takes`);
    for (const { hex } of colors) {
      expect(GOLD.includes(hex), `${state} wears ${hex}, outside the portal's gold family`);
    }
  }
  const reactor = read(REACTOR);
  expect(
    !/#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}/.test(reactor),
    "the reactor colours the orb with a colour of its own"
  );
}

function check7() {
  const palettes = defaultPalettes();
  expect(palettes.length === 6, "there is no default appearance to read a red out of");
  const alert = palettes.find(({ state }) => state === "alert");
  expect(alert && alert.colors.length === 5, "alert does not describe the five colours the renderer takes");
  for (const { hex } of alert.colors) {
    expect(REDDISH.includes(hex), `alert wears ${hex}, which is not the red kept for it`);
  }
  for (const { state, colors } of palettes) {
    if (state === "alert") continue;
    expect(!colors.some(({ hex }) => REDDISH.includes(hex)), `${state} wears a red that belongs to alert alone`);
  }
  const reactor = read(REACTOR);
  expect(
    reactor.includes("${visual.palette.primary}33") && reactor.includes("${visual.palette.primary}66"),
    "the glow and the ring no longer follow the appearance that was saved"
  );
  expect(reactor.includes("text-brand-gold-dark"), "the status line is not in the brand's ink");
  for (const foreign of ["bg-cyan-500", "bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-violet-500"]) {
    expect(!reactor.includes(foreign), `${foreign} is still behind the orb`);
  }
}

function check8() {
  const guide = read(GUIDE);
  expect(
    guide.includes("It rests small in the corner until your pointer or focus wakes it."),
    "the assistant's own page guide does not describe the resting orb"
  );
}

const CHECKS = [
  ["1. The dock offers no second floating launcher; the orb is the launcher", check1],
  ["2. The orb's button reports whether its conversation is open", check2],
  ["3. An orb rests only while closed, idle, quiet and holding nothing back", check3],
  ["4. Rest begins after a still moment, and a pointer or a tab focus wakes it", check4],
  ["5. The resting orb shrinks into the corner and never strands a touch screen", check5],
  ["6. Every state but alert wears the portal's gold family", check6],
  ["7. Alert is the one red, and the chrome follows the palette", check7],
  ["8. The page guide says where the orb rests", check8],
];

for (const [name, run] of CHECKS) {
  results.push([name, await safe(run)]);
}

// ---------------------------------------------------------------------------
// Mutation proofs
// ---------------------------------------------------------------------------

const checkIsRed = async (number) => {
  const outcome = await safe(CHECKS[number - 1][1]);
  const threw = String(outcome.detail ?? "").startsWith("threw:");
  if (threw) return { pass: false, detail: outcome.detail };
  if (outcome.pass) return { pass: false, detail: "check stayed green" };
  return { pass: true, detail: outcome.detail };
};

async function mutation(label, rel, needle, replacement, verify) {
  const file = join(root, rel);
  let original = null;
  const restore = () => {
    if (original === null) return;
    try {
      writeFileSync(file, original);
    } catch {
      // Nothing left to write to; the next run's read will report the damage.
    }
    original = null;
  };
  const onSignal = () => {
    restore();
    process.exit(1);
  };
  try {
    original = readFileSync(file, "utf8");
    const forms = [needle, needle.replace(/\n/g, "\r\n")];
    const matched = forms.find((form) => original.includes(form));
    if (!matched) {
      mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
      return;
    }
    const asMatched = matched === needle ? replacement : replacement.replace(/\n/g, "\r\n");
    const mutated = original.replace(matched, () => asMatched);
    process.once("exit", restore);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    writeFileSync(file, mutated);
    mutations.push({ label, ...(await verify()) });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause.message}` });
  } finally {
    process.off("exit", restore);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restore();
  }
}

await mutation(
  "1. A second floating launcher returns to the dock → check 1 red",
  DOCK,
  '      {mode === "docked" && (',
  '      <button type="button" aria-expanded={open} aria-label="Open the assistant" />\n      {mode === "docked" && (',
  async () => checkIsRed(1)
);

await mutation(
  "2. The orb stops saying whether it is expanded → check 2 red",
  PRESENCE,
  "          ariaExpanded={onStage ? undefined : ui.open}\n",
  "",
  async () => checkIsRed(2)
);

await mutation(
  "2b. A surface with nothing to open calls itself a button → check 2 red",
  REACTOR,
  "const interactive = !preview && Boolean(onClick);",
  "const interactive = !preview;",
  async () => checkIsRed(2)
);

await mutation(
  "2c. The button stops reporting expansion and the display picks it up → check 2 red",
  REACTOR,
  "aria-expanded={interactive ? ariaExpanded : undefined}",
  "aria-expanded={interactive ? undefined : ariaExpanded}",
  async () => checkIsRed(2)
);

await mutation(
  "3. The orb may rest while it has something to say → check 3 red",
  PRESENCE,
  "!announcement && watcher.news.length === 0",
  "watcher.news.length === 0",
  async () => checkIsRed(3)
);

await mutation(
  "4. The rest begins immediately → check 4 red",
  PRESENCE,
  "const REST_AFTER_MS = 2500;",
  "const REST_AFTER_MS = 0;",
  async () => checkIsRed(4)
);

await mutation(
  "5. Hovering no longer wakes the orb → check 4 red",
  PRESENCE,
  "onPointerEnter={() => setExpanded(true)}",
  "onPointerEnter={() => setExpanded(false)}",
  async () => checkIsRed(4)
);

await mutation(
  "6. The resting orb shrinks without tucking → check 5 red",
  PRESENCE,
  "translate-x-[34%] translate-y-[34%] scale-50",
  "translate-x-0 translate-y-0 scale-50",
  async () => checkIsRed(5)
);

await mutation(
  "7. The status line draws under a resting orb → check 5 red",
  PRESENCE,
  "showStatus={!resting}",
  "showStatus",
  async () => checkIsRed(5)
);

await mutation(
  "8. A gold state wears cyan → check 6 red",
  APPEARANCE,
  'primary: "#b38f6f",',
  'primary: "#00f0ff",',
  async () => checkIsRed(6)
);

await mutation(
  "9. Alert stops being the one red → check 7 red",
  APPEARANCE,
  'primary: "#ef4444",',
  'primary: "#c19a76",',
  async () => checkIsRed(7)
);

await mutation(
  "10. The reactor puts a colour of its own back behind the orb → check 6 red",
  REACTOR,
  "backgroundColor: `${visual.palette.primary}33`",
  'backgroundColor: "#00f0ff33"',
  async () => checkIsRed(6)
);

await mutation(
  "11. The page guide forgets where the orb rests → check 8 red",
  GUIDE,
  "It rests small in the corner until your pointer or focus wakes it. ",
  "",
  async () => checkIsRed(8)
);

// ---------------------------------------------------------------------------

for (const [name, outcome] of results) {
  console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${name}${outcome.pass ? "" : ` — ${outcome.detail}`}`);
}
for (const mutationResult of mutations) {
  console.log(
    `${mutationResult.pass ? "PASS" : "FAIL"}  ${mutationResult.label}${
      mutationResult.pass ? "" : ` — ${mutationResult.detail}`
    }`
  );
}

const checksHeld = results.filter(([, outcome]) => outcome.pass).length;
const mutationsRed = mutations.filter((outcome) => outcome.pass).length;
console.log(`\n${checksHeld}/${results.length} checks held, ${mutationsRed}/${mutations.length} mutations turned red.`);
if (checksHeld !== results.length || mutationsRed !== mutations.length) process.exit(1);
