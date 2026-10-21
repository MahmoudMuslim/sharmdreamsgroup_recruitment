/* scripts/extract-vendor-files.mjs
 *
 * HOSTED-ONLY — retired with spec §15. The extraction it performed is finished
 * and its output is in `docker/data/vendor-files`; the vendor storage API it
 * reads needs `SUPABASE_SERVICE_ROLE_KEY`, which the app stopped using the day
 * `src/lib/files/store.ts` became a disk store. Delete it with the other three
 * hosted scripts once the off-machine copy of that tree exists and the project
 * is closed.
 *
 * Brings every stored byte home, read-only, before anything vendor-facing is
 * deleted (spec §15's ordering rule: after the package goes, a byte exists only
 * where we put it).
 *
 *   node scripts/extract-vendor-files.mjs
 *
 * Deliberately uses the storage HTTP API with `fetch` rather than the SDK: this
 * file stays in the tree as the record of how the extraction was done, and an SDK
 * import would have broken spec §15's first fitness claim — the grep for SDK
 * imports under `src` and `scripts` answering 0 — on the day the package was
 * uninstalled. It is that day now, and the claim holds because this file never
 * needed the package.
 *
 * Writes only into git-ignored `docker/data/` — these objects are candidate CVs
 * and pitch recordings, so nothing here may be stageable. Prints no credential:
 * the service key is read from `.env.local` and only ever enters an
 * Authorization header.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const OUT_ROOT = "docker/data/vendor-files";
const BUCKETS = ["candidate-cvs", "candidate-videos", "candidate-audio", "resumes"];
const PAGE = 500;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const BASE = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
if (!BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY };

/** One directory page. `limit`/`offset` page by NAME, so a folder row counts too. */
async function listPage(bucket, prefix, offset) {
  const res = await fetch(`${BASE}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`list ${bucket}/${prefix} -> HTTP ${res.status}`);
  return res.json();
}

/** Storage returns immediate children; a row with no `id` is a folder aggregate.
 * Walking to the leaf is what makes the manifest keys real object paths. */
async function walk(bucket, prefix, out) {
  let offset = 0;
  for (;;) {
    const rows = await listPage(bucket, prefix, offset);
    if (!Array.isArray(rows) || rows.length === 0) return;
    for (const row of rows) {
      const name = row["name"];
      if (!name) continue;
      if (row["id"]) {
        out.push({
          path: `${prefix}${name}`,
          bytes: Number(row["metadata"]?.size ?? 0),
          mimeType: row["metadata"]?.mimetype ?? null,
          updatedAt: row["updated_at"] ?? null,
        });
      } else {
        await walk(bucket, `${prefix}${name}/`, out);
      }
    }
    if (rows.length < PAGE) return;
    offset += PAGE;
  }
}

async function download(bucket, objectPath, dest) {
  const res = await fetch(`${BASE}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: auth,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`get ${bucket}/${objectPath} -> HTTP ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  // `Readable.fromWeb` because `res.body` is a WHATWG stream, and a byte-for-byte
  // file is what the load step and the verify step both have to be able to trust.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// Whole file in memory on purpose: the entire payload measured 3.8 MB, and a
// buffer hash cannot silently report a partial stream read as a good object.
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const manifest = [];
let failures = 0;

for (const bucket of BUCKETS) {
  const objects = [];
  await walk(bucket, "", objects);
  console.log(`${bucket}: ${objects.length} object(s)`);
  for (const object of objects) {
    const dest = join(OUT_ROOT, bucket, object.path);
    try {
      await download(bucket, object.path, dest);
      const size = statSync(dest).size;
      if (size !== object.bytes) throw new Error(`size drift: ${size} != ${object.bytes}`);
      manifest.push({ bucket, ...object, sha256: sha256(dest), localFile: dest });
    } catch (error) {
      failures += 1;
      // The message never carries the key: a URL here is `${BASE}/storage/...`,
      // which is safe, but an Authorization header echoed by fetch would not be.
      console.error(`  FAIL ${bucket}/${object.path}: ${String(error.message).slice(0, 200)}`);
    }
  }
}

mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(
  join(OUT_ROOT, "manifest.json"),
  JSON.stringify({ extractedAt: new Date().toISOString(), baseUrl: BASE, objects: manifest }, null, 2)
);

const total = manifest.reduce((sum, o) => sum + o.bytes, 0);
console.log(`\n${manifest.length} of ${manifest.length + failures} object(s) extracted, ${total} bytes.`);
console.log(`Manifest: ${join(OUT_ROOT, "manifest.json")}`);
if (failures) {
  console.error(`${failures} object(s) did NOT come home — do not delete anything vendor-facing.`);
  process.exit(1);
}
