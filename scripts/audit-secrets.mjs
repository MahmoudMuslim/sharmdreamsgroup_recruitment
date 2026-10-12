import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// The values that must NEVER reach a browser bundle or a tracked file.
const env = readFileSync(".env.local", "utf8");
const get = (n) => env.match(new RegExp(`^${n}=(.+)$`, "m"))?.[1]?.trim();

// The service-role secret and the anon key share a JWT prefix, so identify the
// service role by its role claim rather than its whole value.
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const servicePayload = serviceKey ? serviceKey.split(".")[1] : "";

const SECRETS = [
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ["SUPABASE_DB_PASSWORD", get("SUPABASE_DB_PASSWORD")],
  ["SETTINGS_ENCRYPTION_KEY", get("SETTINGS_ENCRYPTION_KEY")],
  ["OPENROUTER_API_KEY", get("OPENROUTER_API_KEY")],
  ["GOOGLE_AI_STUDIO_KEY", get("GOOGLE_AI_STUDIO_KEY")],
  ["OPENCODE_API_KEY", get("OPENCODE_API_KEY")],
  ["WHATSAPP (any EAAQB token)", "EAAQB"],
  ["service-role JWT payload", servicePayload],
].filter(([, v]) => v && v.length > 8);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let clean = true;

console.log("=== .next/static (shipped to every browser) ===");
const staticFiles = walk(".next/static");
for (const [label, value] of SECRETS) {
  const hits = staticFiles.filter((f) => readFileSync(f, "utf8").includes(value));
  if (hits.length) {
    clean = false;
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
console.log("  " + srcFiles.length + " files scanned");

console.log("\n=== anon key (expected in the bundle — it is NEXT_PUBLIC) ===");
const anonKey = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const anonInBundle = staticFiles.filter((f) => readFileSync(f, "utf8").includes(anonKey));
console.log("  present in " + anonInBundle.length + " bundle file(s) — by design");

console.log("\n" + (clean ? "RESULT: no secrets in the browser bundle or source tree" : "RESULT: LEAKS FOUND"));