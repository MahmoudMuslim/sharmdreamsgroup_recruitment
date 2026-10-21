/*
 * Two audits, and they retire differently.
 *
 * 1. A secret VALUE must never reach the browser bundle or the source tree. The
 *    values are read from `.env.local`, so this half retires itself — once the
 *    vendor lines are deleted from there, they drop out of `SECRETS` and stop
 *    being scanned for.
 * 2. A vendor NAME must never be *read* by the surface that builds and runs this
 *    app (spec §15's fourth claim). Three shapes count as a read, and only three:
 *    `process.env.<NAME>`, a quoted key `"<NAME>"` / `'<NAME>'`, and an assignment
 *    `<NAME> =` / `<NAME>:`. The bare word is not enough: a comment recording that
 *    a key is gone is the proof it is gone, and must not fail the gate. Docs,
 *    plans and the four retired hosted scripts are outside this surface on purpose
 *    — see the note it prints. The vendor-SDK import scan covers `src` and
 *    `scripts`, because §15 claim 1 is stated over both.
 *
 *   node scripts/audit-secrets.mjs
 *   node scripts/audit-secrets.mjs .probe-static   # the bundle copied out of the image
 *
 * The exit code is the gate, and it is deliberate about what it gates. The
 * deploy-surface name scan and the SDK-import scan need neither a built bundle
 * nor `.env.local`, so they are always fatal — that is §15 claim 4, and it is
 * what `prebuild` runs on every build, host and image. The bundle scan needs both,
 * and on the host the default bundle is whatever `next dev` last wrote, so it is
 * informational unless a bundle is named on the command line; a stale `.next`
 * failing a build would be a false alarm about an artifact that never ships.
 *
 * Prints no credential. Nothing here echoes a value back.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

/* The values that must NEVER reach a browser bundle or a tracked file.
 * `.env.local` is untracked and absent inside the image builder, which runs this
 * through `prebuild` — so a missing file means there are no live values to look
 * for, not that the audit passed. It says so. */
let envText = "";
try {
  envText = readFileSync(".env.local", "utf8");
} catch {
  console.log("note: no .env.local here, so the secret-VALUE half has no values to match");
}
const get = (n) => envText.match(new RegExp(`^${n}=(.+)$`, "m"))?.[1]?.trim();

// The service-role secret and the anon key share a JWT prefix, so identify the
// service role by its role claim rather than its whole value.
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const servicePayload = serviceKey ? serviceKey.split(".")[1] : "";

const SECRETS = [
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ["SUPABASE_DB_PASSWORD", get("SUPABASE_DB_PASSWORD")],
  ["SETTINGS_ENCRYPTION_KEY", get("SETTINGS_ENCRYPTION_KEY")],
  ["OPENROUTER_API_KEY", get("OPENROUTER_API_KEY")],
  ["GOOGLE_AI_STUDIO_API_KEY", get("GOOGLE_AI_STUDIO_API_KEY")],
  ["OPENCODE_API_KEY", get("OPENCODE_API_KEY")],
  ["QODER_API_KEY", get("QODER_API_KEY")],
  ["CLOUDFLARE_AI_API_TOKEN", get("CLOUDFLARE_AI_API_TOKEN")],
  ["NVIDIA_API_KEY", get("NVIDIA_API_KEY")],
  ["WHATSAPP (any EAAQB token)", "EAAQB"],
  ["service-role JWT payload", servicePayload],
].filter(([, v]) => v && v.length > 8);

function walk(dir, skip = [], out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || skip.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, skip, out);
    else out.push(full);
  }
  return out;
}

/* Which bundle to read. The default is this repo's own `.next/static`, which is
 * whatever `next dev` last wrote — useful for a quick check, but not the thing
 * that ships. The shipped artifact is the `.next` inside the app image, so the
 * §15 proof copies it out and passes its path:
 *   docker create --name probe <image>
 *   docker cp probe:/app/.next/static .probe-static
 *   docker rm probe
 *   node scripts/audit-secrets.mjs .probe-static
 */
const BUNDLE = process.argv[2] ?? join(".next", "static");
const BUNDLE_NAMED = process.argv[2] !== undefined;

let clean = true;
let bundleLeaks = 0;

const bundleExists = existsSync(BUNDLE);
console.log(
  "=== " +
    BUNDLE +
    " (shipped to every browser" +
    (BUNDLE_NAMED ? ", named on the command line — its leaks are fatal" : ", this tree's dev artifact — informational") +
    ") ==="
);
const staticFiles = bundleExists ? walk(BUNDLE) : [];
if (!bundleExists) {
  console.log("  skipped  no bundle at this path yet");
}
for (const [label, value] of bundleExists ? SECRETS : []) {
  const hits = staticFiles.filter((f) => readFileSync(f, "utf8").includes(value));
  if (hits.length) {
    bundleLeaks++;
    if (BUNDLE_NAMED) clean = false;
    console.log("  LEAK  " + label + " in " + hits.length + " file(s): " + hits.slice(0, 3).join(", "));
  }
}
console.log("  " + staticFiles.length + " files scanned across " + SECRETS.length + " secret values");

console.log("\n=== tracked source + config files ===");
const srcFiles = walk("src").concat(["prompt.md", ".env.example", "next.config.ts"].filter((f) => {
  try { return statSync(f).isFile(); } catch { return false; }
}));
for (const [label, value] of SECRETS) {
  const hits = srcFiles.filter((f) => {
    try { return readFileSync(f, "utf8").includes(value); } catch { return false; }
  });
  if (hits.length) {
    clean = false;
    console.log("  LEAK  " + label + " in: " + hits.slice(0, 3).join(", "));
  }
}
console.log(
  "  " +
    srcFiles.length +
    " files scanned" +
    (SECRETS.length ? ` across ${SECRETS.length} secret values` : " — nothing to match, no .env.local here")
);

/* The vendor's own addresses. Nothing in the shipped bundle may name the hosted
 * project any more: the anon key used to be in here deliberately because it was
 * `NEXT_PUBLIC_*` and got inlined at build time, and that build arg is gone. */
console.log(
  "\n=== vendor addresses in the shipped bundle ===" +
    (bundleExists ? "" : "\n  skipped  no bundle to address-match against")
);
const hostedUrl = get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
for (const [label, value] of bundleExists ? [
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY value", get("NEXT_PUBLIC_SUPABASE_ANON_KEY")],
  ["hosted project ref", hostedUrl.match(/^https:\/\/([a-z0-9]+)\./i)?.[1] ?? "lbxdeceropsxwohnzinl"],
  ["hosted rest host", "supabase.co"],
] : []) {
  if (!value) continue;
  const hits = staticFiles.filter((f) => readFileSync(f, "utf8").includes(value));
  if (hits.length) {
    bundleLeaks++;
    if (BUNDLE_NAMED) clean = false;
    console.log("  LEAK  " + label + " in " + hits.length + " file(s): " + hits.slice(0, 3).join(", "));
  } else {
    console.log("  clean  " + label + " — in 0 of " + staticFiles.length + " bundle files");
  }
}

/* The deploy surface: what `docker compose build` and `next build` read. A name
 * still being read here means the app depends on a credential the owner has to
 * keep, which is exactly what §15 says must stop being true. A bare mention in a
 * comment is still not a read, so three shapes count — each one a place the value
 * is genuinely taken:
 *   `process.env.<NAME>`  a runtime read, the form §15 claim 1 names, and the one
 *                         the old `<NAME>\s*[=:]` test missed entirely
 *   `"<NAME>"` `'<NAME>'` a quoted key, i.e. `env["<NAME>"]` / `get("<NAME>")`
 *   `<NAME>\s*[=:]`       a write: `NAME=value` and `- NAME: value` in compose,
 *                         `ARG NAME=` / `ENV NAME=` in a Dockerfile
 * `docker/data` is the extracted candidate bytes and `docker/.env` is the
 * owner's untracked local file; neither is a surface the repo controls. */
console.log("\n=== vendor env names read by the deploy surface ===");
const VENDOR_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_REST_BASE",
  "VERCEL",
];
const READ_FORMS = [
  ["process.env read", (name) => new RegExp(`process\\.env\\.${name}\\b`)],
  ["quoted env key", (name) => new RegExp(`["']${name}["']`)],
  ["assignment", (name) => new RegExp(`${name}\\s*[=:]`)],
];
const deployFiles = [
  ...walk("src"),
  ...walk("docker", ["data", "node_modules", ".git", ".env"]),
  ".env.example",
  "next.config.ts",
  "package.json",
].filter((f) => {
  try { return statSync(f).isFile(); } catch { return false; }
});
const readers = [];
for (const file of deployFiles) {
  const text = readFileSync(file, "utf8");
  for (const name of VENDOR_NAMES) {
    const forms = READ_FORMS.filter(([_, build]) => build(name).test(text)).map(([label]) => label);
    if (forms.length) readers.push(`${file} ${forms.join(" + ")} ${name}`);
  }
}
if (readers.length) {
  clean = false;
  for (const r of readers) console.log("  VENDOR  " + r);
} else {
  console.log(
    "  clean  " +
      deployFiles.length +
      " deploy-surface files neither set nor read a vendor credential (no `process.env.<NAME>`, no quoted key, no `<NAME> =` / `<NAME>:`)"
  );
}
const sdkImporters = [...walk("src"), ...walk("scripts")].filter((f) =>
  /from\s+["']@supabase\//.test(readFileSync(f, "utf8"))
);
if (sdkImporters.length) {
  clean = false;
  console.log("  VENDOR  `src` + `scripts` import the vendor SDK in: " + sdkImporters.join(", "));
} else {
  console.log("  clean  `src` + `scripts` import the vendor SDK in 0 files");
}

/* Honest remainder: the names live on in exactly four kinds of place, none of
 * them a leak — the first three are the owner's to delete after the hosted project
 * is closed, and the fourth is a decision the owner has to make. Values are never
 * printed; the variable names are, because the names are what is left to clean. */
console.log("\n=== still present outside the deploy surface (owner action, not a leak) ===");
const hostedScripts = walk("scripts").filter((f) => {
  const text = readFileSync(f, "utf8");
  return VENDOR_NAMES.some((n) => text.includes("process.env." + n) || text.includes("env." + n));
});
console.log("  hosted scripts that still read them: " + (hostedScripts.join(", ") || "none"));
for (const label of [".env.local", join("docker", ".env")]) {
  let names;
  try {
    names = readFileSync(label, "utf8")
      .split(/\r?\n/)
      .flatMap((l) => {
        const m = l.match(/^([A-Z0-9_]+)=/);
        return m && VENDOR_NAMES.includes(m[1]) ? [m[1]] : [];
      });
  } catch {
    names = ["file absent"];
  }
  console.log(`  ${label} still holds: ${names.join(", ") || "nothing"}`);
}

/* A fourth place, and the one §15 claim 1's grep structurally cannot see: tracked
 * copies of a vendored `supabase-server` agent skill, each of which instructs an
 * agent to `npm install @supabase/ssr` and import from `@supabase/`. They are not
 * in `src` or `scripts`, and `.dockerignore` never allow-lists them, so the shipped
 * artifact is clean — but the repo tree still carries instructions to re-add the
 * dependency, and an agent pointed at this workspace can be triggered by them.
 * Deleting them is the owner's call (53 tracked files is not a doc slice's
 * business), so this prints where they are instead of claiming they are gone.
 * `git ls-files` is the cheap census of *tracked* copies, which is the claim; the
 * image builder has no repo to enumerate, and that is a skip, not a zero. */
let skillCopies;
try {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((f) => f.endsWith("skills/supabase-server/SKILL.md"));
  skillCopies = tracked.length
    ? `${tracked.length} tracked copies, e.g. ${tracked[0]}`
    : "none tracked";
} catch {
  skillCopies = "not enumerable here (no git repo)";
}
console.log("  vendored agent instructions that re-prescribe the SDK: " + skillCopies);

console.log(
  "\n" +
    (clean
      ? "RESULT: PASS — the deploy surface sets and reads no vendor credential, and no live secret value sits in the tracked source" +
        (bundleLeaks ? ` (${bundleLeaks} bundle finding${bundleLeaks === 1 ? "" : "s"} above are informational; pass a bundle path to make them fatal)` : "")
      : "RESULT: LEAKS FOUND")
);

process.exitCode = clean ? 0 : 1;
