#!/usr/bin/env node
/**
 * Fails the build when the theme the picker offers is not the theme the CSS draws.
 *
 * A theme is a pair — a parent (`base` or `glass`) and a tone (`light` or
 * `dark`) — and the two halves live in two different kinds of thing:
 *
 *   1. `CHOICES` / `PARENTS` / `TONES` in `src/lib/theme.ts` — what the app bar
 *      button walks and Account → Preferences offers, and what the inline script
 *      writes into `data-palette` and `data-tone`.
 *   2. the attribute selectors in `src/app/globals.css` — what actually paints.
 *
 * Nothing the compiler checks holds them together, and the failure reads as
 * success: pick a theme with no CSS block and the page keeps the `@theme`
 * defaults — a bright, working, *wrong* portal, with the picker showing the
 * choice you made. So each of the four pairs must be reachable, and no selector
 * may name a parent or tone that `theme.ts` does not know about.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME_FILE = join(root, "src/lib/theme.ts");
const CSS_FILE = join(root, "src/app/globals.css");

/** The quoted members of a union type, e.g. `"base" | "glass"`. */
function readUnion(source, typeName) {
  const block = new RegExp(`export type ${typeName} = ([^;]+);`).exec(source);
  if (!block) {
    throw new Error(`Could not find \`export type ${typeName} = …\` — the shape this check reads changed.`);
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The quoted paths inside a named `as const` array. */
function readArray(source, exportName) {
  const block = new RegExp(`export const ${exportName}[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(
    source
  );
  if (!block) {
    throw new Error(`Could not find \`export const ${exportName} = […] as const\` — the shape this check reads changed.`);
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const themeSource = readFileSync(THEME_FILE, "utf8");
const css = readFileSync(CSS_FILE, "utf8");

const parents = readUnion(themeSource, "ThemeParent");
const tones = readUnion(themeSource, "ThemeTone");
const choices = readArray(themeSource, "CHOICES");

const problems = [];

/** One line per distinct defect: a bad value can appear in several rules. */
function addProblem(problem) {
  if (!problems.includes(problem)) problems.push(problem);
}

for (const parent of parents) {
  for (const tone of tones) {
    const choice = `${parent}-${tone}`;
    if (!choices.includes(choice)) {
      addProblem(`\`${choice}\` is a parent and a tone, but CHOICES does not list it: nothing offers it.`);
      continue;
    }
    // Either the pair has its own block, or the tone paints it alone.
    const paired = new RegExp(`\\[data-palette="${parent}"\\]\\s*\\[data-tone="${tone}"\\]`).test(css);
    const byTone = new RegExp(`\\[data-tone="${tone}"\\]`).test(css);
    if (parent === "glass" && !paired) {
      addProblem(
        `CHOICES offers \`${choice}\` but globals.css has no \`[data-palette="glass"][data-tone="${tone}"]\` block: ` +
          `no film tokens, no backdrop, so it renders as the base theme.`
      );
    } else if (parent === "base" && !byTone && tone !== "light") {
      addProblem(`globals.css has no \`[data-tone="${tone}"]\` block for the base theme \`${choice}\`.`);
    }
  }
}

// The other direction: a selector naming a value nothing can set is dead CSS that
// reads as a theme someone forgot to add. One message per value, not per rule.
for (const [, attr, value] of css.matchAll(/\[data-(palette|tone)="([^"]+)"\]/g)) {
  const known = attr === "palette" ? parents : tones;
  if (!known.includes(value)) {
    addProblem(
      `globals.css styles \`data-${attr}="${value}"\`, which src/lib/theme.ts does not define — ` +
        `that selector can never match, because the script and applyTheme only write known values.`
    );
  }
}

// Both halves are written together, so one stale `data-theme` left in either file
// would be a palette nobody sets and a comment that describes the old model.
if (/data-theme/.test(css)) {
  addProblem(`globals.css still styles \`data-theme\`, which nothing writes since the theme became a pair.`);
}
if (/data-theme/.test(readFileSync(join(root, "src/app/layout.tsx"), "utf8"))) {
  addProblem(`src/app/layout.tsx still sets a \`data-theme\` attribute the CSS no longer reads.`);
}

if (problems.length) {
  console.error("\nTheme check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\n  Add the missing block to src/app/globals.css, or take the choice out of\n" +
      "  src/lib/theme.ts — a theme the picker offers and the CSS does not draw is\n" +
      "  a page that renders in the wrong palette while it claims the right one.\n"
  );
  process.exitCode = 1;
} else {
  console.log(
    `Theme check passed: ${parents.length} parents × ${tones.length} tones = ${choices.length} themes, each painted by globals.css.`
  );
}
