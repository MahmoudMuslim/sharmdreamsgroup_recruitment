/* scripts/prove-file-paths.mjs
 * Run: node scripts/prove-file-paths.mjs
 *
 * `src/lib/files/paths.ts` decides, in one place, whether a string a caller
 * handed us may become a filesystem path. Plan 2 puts candidate CVs, pitch
 * recordings and voice notes on our own disk, so a wrong answer here is not a
 * bad request — it is one tenant's file served to another, or `/etc/passwd`
 * downloaded as a "CV".
 *
 * This proves the rules directly, in plain Node: no database, no gateway, no
 * Next runtime. That is why the guards live in their own module — `store.ts`
 * is `server-only` and imports the pool, so nothing that reaches it can run
 * from a script, and a traversal guard nobody can execute is a guess.
 *
 * What is deliberately NOT proven: the check is *lexical*, so a symlink that
 * already exists inside the tree would be followed. Only this app writes that
 * volume (Tasks 3-6 of spec §15 route every byte through `resolveObjectPath`),
 * and anyone who can plant a symlink there already has the directory, so the
 * guarantee we chose is "no caller string escapes its bucket", not "the volume
 * is free of symlinks".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isStoredPath,
  isBucketName,
  uploadsRoot,
  bucketRoot,
  resolveObjectPath,
  displayName,
} from "../src/lib/files/paths.ts";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

// --- 1. isStoredPath: the accepts --------------------------------------------
// Every one of these is a key a real upload route writes today. A guard that
// rejects a working key is a data-loss bug wearing a security badge, so the
// accepts are as load-bearing as the rejects.
const realKeys = [
  "cv.pdf",
  "applications/6fa5/job-9e2c-4a1b-8f3d-111122223333-mohamed-cv.pdf",
  "public/2026/04/offer-letter.pdf",
  "0f8c1a2b-3d4e-5f60-7182-93a4b5c6d7e8/question-3-1730000000000.webm",
  "applications/notes.txt",
  "a".repeat(1024),
  "weird but legal: name with spaces.txt",
  "...",
  "..hidden/file.pdf",
  // Accepted as a *string*; the second guard in resolveObjectPath is what stops
  // it on win32, and check 6 proves that. It is here so that assertion is about
  // a key this module really does pass through.
  "C:/Windows/win.ini",
  "100%.pdf",
];
realKeys.forEach((key) => {
  check(`accepts ${JSON.stringify(key)}`, isStoredPath(key) === true, `got ${isStoredPath(key)}`);
});

// --- 2. isStoredPath: the rejects -------------------------------------------
const rejects = {
  "empty string": "",
  "one char over the limit": "a".repeat(1025),
  "absolute POSIX path": "/etc/passwd",
  "leading space": " cv.pdf",
  "trailing space": "cv.pdf ",
  "internal newline": "app\nlications/cv.pdf",
  "NUL byte": "cv\u0000.pdf",
  "backslash": "cv\\.pdf",
  "parent segment alone": "..",
  "parent segment mid-path": "applications/../../etc/passwd",
  "parent segment trailing": "applications/x/..",
};
for (const [what, value] of Object.entries(rejects)) {
  check(`rejects ${what}`, isStoredPath(value) === false, `got ${isStoredPath(value)}`);
}

// The exact-segment rule, stated as a test so a future edit to the split can't
// quietly widen it into "any path that contains two dots".
check(
  "rejects only the exact `..` segment, not a name that merely contains dots",
  isStoredPath("..") === false &&
    isStoredPath("a/..") === false &&
    isStoredPath("..a") === true &&
    isStoredPath("a...") === true,
);

// --- 3. isBucketName --------------------------------------------------------
// A bucket becomes a *directory name*, so it needs its own rule: `isStoredPath`
// allows dots and dots alone, which would make `..` a bucket and put every
// byte one level up.
for (const good of ["candidate-cvs", "candidate-videos", "candidate-audio", "resumes", "a.b_c-d"]) {
  check(`accepts bucket ${JSON.stringify(good)}`, isBucketName(good) === true);
}
for (const bad of ["", "a", "..", ".", ".hidden", "-lead", "UPPER", "has space", "a".repeat(65), "a/b", "/abs"]) {
  check(`rejects bucket ${JSON.stringify(bad)}`, isBucketName(bad) === false, `got ${isBucketName(bad)}`);
}
// "unknown" below is a *well-formed* name, not a shape failure: the module
// refuses to know our bucket list, because that would drag
// `src/lib/config.ts` — which throws at module scope when a vendor variable is
// absent — into a byte-level path decision. An unknown bucket is therefore a
// programmer error, not an attack, and the shape rule plus containment is what
// actually stops an escape.
check("isBucketName is a shape rule, so an unknown-but-safe name passes",
  isBucketName("unknown") === true && isBucketName("sql") === true);

// --- 4. uploadsRoot is lazy ------------------------------------------------
// `next build` imports every route module to collect its config. A root read at
// module scope would make the build need a /data/uploads that only exists where
// the app runs — the same trap `store.ts:58` already documents for the vendor key.
delete process.env.UPLOADS_ROOT;
let threwUnset = false;
try {
  uploadsRoot();
} catch (e) {
  threwUnset = e instanceof Error && /UPLOADS_ROOT is not set/.test(e.message);
}
check("uploadsRoot() throws with a readable message when UPLOADS_ROOT is absent", threwUnset);

process.env.UPLOADS_ROOT = "/data/uploads";
check("uploadsRoot() reads the env when set", uploadsRoot() === path.resolve("/data/uploads"), uploadsRoot());

// --- 5. bucketRoot ----------------------------------------------------------
check("bucketRoot joins under the root",
  bucketRoot("candidate-cvs", "/data/uploads") === path.join("/data/uploads", "candidate-cvs"),
  bucketRoot("candidate-cvs", "/data/uploads"));
let bucketThrew = false;
try {
  bucketRoot("../uploads", "/data/uploads");
} catch (e) {
  bucketThrew = e instanceof Error && /bucket name/.test(e.message);
}
check("bucketRoot refuses a bucket that is not a name", bucketThrew);

// --- 6. resolveObjectPath: containment -------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), "sdg-paths-"));
try {
  for (const key of [
    "cv.pdf",
    "applications/6fa5/9e2c-4a1b-8f3d-111122223333-mohamed-cv.pdf",
    "public/2026/04/offer-letter.pdf",
  ]) {
    const got = resolveObjectPath("candidate-cvs", key, dir);
    check(`resolves ${JSON.stringify(key)} inside the bucket`,
      got === path.resolve(dir, "candidate-cvs", key) && got.startsWith(path.join(dir, "candidate-cvs") + path.sep),
      got);
  }

  for (const bad of ["", "..", "/etc/passwd", "a/../..", "cv\u0000.pdf", "a\\b"]) {
    let msg = "";
    try {
      resolveObjectPath("candidate-cvs", bad, dir);
      msg = "no throw";
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    check(`resolves refuses ${JSON.stringify(bad)} at the key guard`, /storage key/.test(msg), msg);
  }

  // The second guard. On win32 `path.resolve(dir, "C:/Windows/win.ini")` answers
  // an absolute path, which `isStoredPath` passes (no `..`, no backslash, no
  // leading separator). Whatever the platform, the invariant is the same and
  // this is the check that holds it: no key resolves outside its bucket.
  const exotic = "C:/Windows/win.ini";
  let escaped = null;
  let msg = "";
  try {
    const got = resolveObjectPath("candidate-cvs", exotic, dir);
    const root = path.join(path.resolve(dir, "candidate-cvs"), path.sep);
    if (!got.startsWith(root)) escaped = got;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check(`no key escapes its bucket, even ${JSON.stringify(exotic)}`,
    escaped === null,
    escaped ? `ESCAPED to ${escaped}` : msg || "resolved inside");

  // A bucket that is a well-formed name but not one of ours still gets contained.
  const got = resolveObjectPath("unknown", "cv.pdf", dir);
  check("an unknown-but-safe bucket is still a containment boundary",
    got === path.resolve(dir, "unknown", "cv.pdf"), got);

  // --- 7. displayName ------------------------------------------------------
  for (const [key, want] of [
    ["applications/6fa5/9e2c4a1b-8f3d-4a1b-8f3d-111122223333-mohamed cv.pdf", "mohamed cv.pdf"],
    ["applications/6fa5/9e2c4a1b-8f3d-4a1b-8f3d-111122223333-cv.pdf", "cv.pdf"],
    ["cv.pdf", "cv.pdf"],
    ["applications/6fa5/plain-name.pdf", "plain-name.pdf"],
    ["", ""],
  ]) {
    check(`displayName(${JSON.stringify(key)})`, displayName(key) === want, `got ${JSON.stringify(displayName(key))}`);
  }
  // Only our own random-id prefix is stripped — a filename that genuinely
  // starts with a uuid is the candidate's, and renaming it would be a lie.
  check("displayName leaves a uuid-shaped filename alone",
    displayName("9e2c4a1b-8f3d-4a1b-8f3d-111122223333.pdf") === "9e2c4a1b-8f3d-4a1b-8f3d-111122223333.pdf",
    displayName("9e2c4a1b-8f3d-4a1b-8f3d-111122223333.pdf"));
} finally {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.UPLOADS_ROOT;
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join("; "));
  process.exit(1);
}
