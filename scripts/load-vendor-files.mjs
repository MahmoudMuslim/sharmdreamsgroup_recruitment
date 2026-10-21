/* scripts/load-vendor-files.mjs
 *
 * The other half of the cut-over: `extract-vendor-files.mjs` brought the bytes
 * home, this one puts them where `src/lib/files/disk-store.ts` looks for them
 * and writes the `public.files` row that makes each one listable, sized and
 * typed. Without the row a byte is invisible; without the byte a row is a link
 * that 404s. Both halves land together or a File Manager page lies.
 *
 *   node scripts/load-vendor-files.mjs              # into $UPLOADS_ROOT
 *   node scripts/load-vendor-files.mjs --root .data/uploads
 *   node scripts/load-vendor-files.mjs --dry-run    # report, write nothing
 *
 * Idempotent by content, not by faith: an object whose bytes already sit at the
 * target with the manifest's size and sha256 is left alone, so a re-run after a
 * interrupted load costs a hash, not a rewrite. The row is always upserted,
 * because a row that disagrees with the byte is the bug worth fixing on a rerun.
 *
 * Writes only under UPLOADS_ROOT and only into `public.files`, over the same
 * superuser connection the other local scripts use. Prints no credential and no
 * candidate path beyond the one it is working on.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = join(ROOT, "docker", "data", "vendor-files", "manifest.json");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const DRY = argv.includes("--dry-run");

/** The same tiny KEY=VALUE reader `seed-local-staff.mjs` uses — no dotenv dep. */
function envFile(file) {
  const out = {};
  for (const line of readFileSync(join(ROOT, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const local = envFile(join("docker", ".env"));

/**
 * Where the tree goes. `--root` wins, then UPLOADS_ROOT, then the host dev twin.
 *
 * The container's own value is `/data/uploads`, and this script runs on the host
 * — where that path is not the volume — so the default here is deliberately the
 * host directory, and loading a container is a two-step: seed here, then
 * `docker compose cp` (printed at the end).
 */
function targetRoot() {
  const raw = flag("root") ?? process.env.UPLOADS_ROOT ?? join(".data", "uploads");
  return resolve(ROOT, raw.replace(/^\.\.(\/|\\)/, ""));
}

const uploadsRoot = targetRoot();
if (!uploadsRoot.startsWith(ROOT)) {
  console.error(`Refusing to write outside the repo: ${uploadsRoot}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch {
  console.error(`No manifest at ${MANIFEST} — run scripts/extract-vendor-files.mjs first.`);
  process.exit(1);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const counts = { copied: 0, unchanged: 0, rows: 0, failed: 0 };
const perBucket = new Map();

let client;
if (!DRY) {
  if (!local.LOCAL_DB_PASSWORD) {
    console.error("docker/.env needs LOCAL_DB_PASSWORD — the rows have somewhere to go.");
    process.exit(1);
  }
  client = new Client({
    user: "postgres",
    password: local.LOCAL_DB_PASSWORD,
    host: "localhost",
    port: Number(local.LOCAL_DB_PORT) || 54320,
    database: "sharm_dreams",
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  const table = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'files'"
  );
  if (table.rowCount === 0) {
    console.error("public.files does not exist — run npm run db:apply-local first.");
    process.exit(1);
  }
}

for (const object of manifest.objects) {
  const stat = perBucket.get(object.bucket) ?? { count: 0, bytes: 0 };
  stat.count += 1;
  stat.bytes += object.bytes;
  perBucket.set(object.bucket, stat);

  // `localFile` is the manifest author's Windows-relative path; the segments are
  // what matter, so they are rebuilt below the repo rather than trusted.
  const source = resolve(ROOT, object.localFile.replace(/\\/g, "/").replace(/^\.\.(\/|\\)/, ""));
  if (!source.startsWith(join(ROOT, "docker", "data"))) {
    console.error(`  SKIP  ${object.path}: the manifest points outside docker/data`);
    counts.failed += 1;
    continue;
  }
  const target = join(uploadsRoot, object.bucket, ...object.path.split("/"));
  if (!target.startsWith(join(uploadsRoot, object.bucket))) {
    console.error(`  SKIP  ${object.path}: escapes the ${object.bucket} bucket`);
    counts.failed += 1;
    continue;
  }

  let bytes;
  try {
    bytes = readFileSync(source);
  } catch (error) {
    console.error(`  OPEN  ${object.path}: ${error.message}`);
    counts.failed += 1;
    continue;
  }
  if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) {
    console.error(`  SOURCE ${object.path}: the extracted copy no longer matches its manifest`);
    counts.failed += 1;
    continue;
  }

  let alreadyThere = false;
  try {
    const existing = statSync(target);
    alreadyThere = existing.isFile() && existing.size === object.bytes;
  } catch {
    alreadyThere = false;
  }
  if (alreadyThere) {
    try {
      alreadyThere = sha256(readFileSync(target)) === object.sha256;
    } catch {
      alreadyThere = false;
    }
  }

  if (DRY) {
    // Counted as if the load ran, because the summary line is read as a budget:
    // a dry run that reported "0 copied, 0 already in place" for 17 objects it
    // had just printed `ok` for told the operator nothing.
    if (alreadyThere) counts.unchanged += 1;
    else counts.copied += 1;
    counts.rows += 1;
    console.log(`  ${alreadyThere ? "ok    " : "copy  "} ${object.bucket}/${object.path} (${object.bytes} B)`);
    continue;
  }

  try {
    if (!alreadyThere) {
      mkdirSync(dirname(target), { recursive: true });
      // tmp + rename, the same rule disk-store.ts writes by: a reader that hits
      // this path mid-load sees the old object or the new one, never half.
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, bytes);
      renameSync(temp, target);
      counts.copied += 1;
    } else {
      counts.unchanged += 1;
    }

    const stamp = object.updatedAt ?? new Date().toISOString();
    await client.query(
      `insert into public.files (bucket, path, mime, bytes, created_at, updated_at)
       values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)
       on conflict (bucket, path) do update
         set mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
      [object.bucket, object.path, object.mimeType ?? null, object.bytes, stamp]
    );
    counts.rows += 1;
  } catch (error) {
    console.error(`  FAIL  ${object.bucket}/${object.path}: ${error.message}`);
    counts.failed += 1;
  }
}

if (client) {
  const after = await client.query(
    "select bucket, count(*)::int as objects, coalesce(sum(bytes), 0)::bigint as bytes from public.files group by bucket order by bucket"
  );
  console.log("\npublic.files now holds:");
  for (const row of after.rows) console.log(`  ${row.bucket}: ${row.objects} object(s), ${row.bytes} B`);
  await client.end();
}

for (const [bucket, stat] of perBucket) {
  console.log(`manifest ${bucket}: ${stat.count} object(s), ${stat.bytes} B`);
}
console.log(
  `\n${DRY ? "would load" : "loaded"}: ${counts.copied} copied, ${counts.unchanged} already in place, ` +
    `${counts.rows} row(s) upserted, ${counts.failed} failure(s) into ${uploadsRoot}`
);

if (!DRY && counts.failed === 0) {
  console.log(
    `\nIf the app runs in the container, hand the tree to the volume and recreate:\n` +
      `  docker compose -f docker/docker-compose.yml --env-file docker/.env up -d app\n` +
      `  docker compose -f docker/docker-compose.yml --env-file docker/.env cp "${uploadsRoot}/." app:/data/uploads\n` +
      // `docker cp` lands every file as root, and an unlink needs write on the
      // PARENT directory — so a root-owned tree is an object a staff member can
      // open but never delete or re-upload. The chown is part of the copy, not
      // a tidy-up.
      `  docker compose -f docker/docker-compose.yml --env-file docker/.env exec -u root app \\ \n` +
      `      sh -c 'chown -R node:node /data/uploads && chmod -R u+rw,go+r,go-w /data/uploads'\n` +
      `  docker compose -f docker/docker-compose.yml --env-file docker/.env exec app find /data/uploads -type f | wc -l\n` +
      `\nnginx caches the app container's address in its upstream, so reload it after a recreate:\n` +
      `  docker compose -f docker/docker-compose.yml --env-file docker/.env exec nginx nginx -s reload`
  );
}

process.exit(counts.failed ? 1 : 0);
