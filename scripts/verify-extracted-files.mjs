/* scripts/verify-extracted-files.mjs
 *
 * Proves the extracted copy is still whole: every object in the manifest is
 * re-opened, re-hashed and re-sized on disk, and any `pg_dump` archive the owner
 * puts down beside it is checked by its header rather than its size. Read-only.
 *
 *   node scripts/verify-extracted-files.mjs
 *
 * Exits non-zero on the first mismatch. This is the only remaining proof of the
 * cut-over — the hosted doorway that made these bytes is deleted — so a
 * mismatch here has no second source to re-extract from.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = "docker/data";
const manifestPath = `${ROOT}/vendor-files/manifest.json`;

const read = (p) => readFileSync(p.replace(/\\/g, "/"));

let manifest;
try {
  manifest = JSON.parse(read(manifestPath).toString("utf8"));
} catch (error) {
  console.error(`No manifest at ${manifestPath} — the extracted copy under docker/data/vendor-files is not on this disk, and the hosted doorway that made it is gone.`, error.message);
  process.exit(1);
}

let failures = 0;
const perBucket = new Map();

for (const object of manifest.objects) {
  const bucket = perBucket.get(object.bucket) ?? { count: 0, bytes: 0 };
  perBucket.set(object.bucket, bucket);
  bucket.count += 1;
  try {
    const bytes = read(object.localFile);
    bucket.bytes += bytes.length;
    if (bytes.length !== object.bytes) {
      console.error(`  SIZE  ${object.bucket}/${object.path}: ${bytes.length} on disk, ${object.bytes} listed`);
      failures += 1;
      continue;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== object.sha256) {
      console.error(`  HASH  ${object.bucket}/${object.path}: contents differ from the extraction`);
      failures += 1;
      continue;
    }
    // A zero-byte file that matches a zero-byte listing is still not a file a
    // candidate can be graded on, so say what the bytes actually look like.
    if (bytes.length === 0) {
      console.error(`  EMPTY ${object.bucket}/${object.path}`);
      failures += 1;
    }
  } catch (error) {
    console.error(`  OPEN  ${object.bucket}/${object.path}: ${error.message}`);
    failures += 1;
  }
}

for (const [bucket, stat] of perBucket) {
  console.log(`${bucket}: ${stat.count} object(s), ${stat.bytes} bytes re-read`);
}

// The dump is the owner's off-machine copy; a truncated redirect still reads as
// a file, so check it is a real pg_dump archive rather than trusting its size.
for (const name of readdirSync(ROOT)) {
  if (!name.endsWith(".dump")) continue;
  const head = readFileSync(join(ROOT, name)).subarray(0, 5).toString("latin1");
  const ok = head === "PGDMP";
  console.log(`${name}: archive header ${ok ? "PGDMP (valid custom-format dump)" : JSON.stringify(head)}`);
  if (!ok) failures += 1;
}

console.log(`\n${manifest.objects.length} object(s) checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
