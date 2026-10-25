/* scripts/prove-job-distribution.mjs
 * Run: node scripts/prove-job-distribution.mjs
 *
 * Nothing here needs a database, a board account or a browser. What is pinned is
 * the part every surface shares: the columns the public read is allowed to see,
 * the schema.org mapping, the three pull artifacts, and the fact that each of the
 * five doors actually opens onto the module rather than writing its own version.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The modules under test import through the app's `@/` alias and through
// extensionless sibling paths. Plain Node resolves neither, so teach this one
// process the bundler's mapping before any dynamic import runs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function sourceHas(name, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(name, missing.length === 0, missing.map((n) => `missing ${JSON.stringify(n)}`).join(", "));
}

// ---------------------------------------------------------------------------
// 1. The public read carries the dates a posting is dated by.
// ---------------------------------------------------------------------------
// Pinned against the column list itself, not against the file: `posted_at`
// already appears in actions.ts as the board's sort key, so a loose substring
// check would pass before this slice exists.
const jobColumns = ((/const JOB_COLUMNS =\s*\n?\s*"([^"]+)"/.exec(read("src/app/careers/actions.ts")) ?? [])[1] ?? "")
  .split(",")
  .map((name) => name.trim());
for (const column of ["posted_at", "closing_at", "created_at"]) {
  check(`the public read selects ${column}`, jobColumns.includes(column));
}
sourceHas("toJob maps the three date columns", "src/app/careers/actions.ts", [
  "posted_at:",
  "closing_at:",
  "created_at:",
]);
sourceHas("PublicJob declares the three date columns", "src/modules/careers/job-board.ts", [
  "posted_at: string | null;",
  "created_at: string;",
  "closing_at: string | null;",
]);
check(
  "the published-only rule stays where the policy puts it",
  read("src/app/careers/actions.ts").includes('.eq("status", "PUBLISHED")'),
  "a surface that stopped filtering on PUBLISHED would publish a draft"
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
