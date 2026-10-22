/* src/lib/files/paths.ts
 * The one place that decides where a byte lives on our own disk.
 *
 * This module exists because `store.ts`'s backend is about to become a
 * directory tree, and a directory tree makes a string like `../../etc/passwd`
 * an outcome instead of a typo. Every accessor that takes a `bucket` or a `path`
 * from a caller resolves through here, so the containment rule is written once
 * and cannot be forgotten in one of the five.
 *
 * It is a separate file from the store itself for a selfish reason too: the
 * path rules are testable in plain Node, with no database and no Next runtime,
 * and `store.ts` is `server-only` and imports the pool. Keeping the guards here
 * is what lets `scripts/prove-file-paths.mjs` hit them directly.
 */
import path from "node:path";

/**
 * Storage keys are plain object names, never paths that escape a bucket.
 *
 * Moved here from `src/app/(admin)/files/file-browser-types.ts` when the disk
 * store arrived: a lib that resolves a filesystem path cannot import a page
 * module's type file, and the rule is the same one the File Manager's actions
 * already applied, so the callers kept their behaviour and lost an indirection.
 */
export function isStoredPath(value: string): boolean {
  if (!value || value.length > 1024) return false;
  if (value.startsWith("/") || value !== value.trim()) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000-\u001f]/.test(value)) return false;
  return !value.split("/").includes("..");
}

/**
 * Upload paths prefix the leaf with a random uuid; what follows it is the
 * filename the candidate chose.
 */
export function displayName(pathValue: string): string {
  const leaf = pathValue.split("/").pop() || pathValue;
  return leaf.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || leaf;
}

/**
 * A bucket becomes a first-level directory, so it needs its own rule and cannot
 * borrow the one above: `isStoredPath` rejects a leading separator, which is
 * right for a key and irrelevant to a single name, and it permits dots, which
 * would let `..` be a bucket.
 *
 * Nothing here checks the value against the four known buckets. That list is
 * `storageConfig.buckets` and `BUCKETS` in the admin module, and this file is
 * deliberately kept free of both so that `scripts/prove-file-paths.mjs` can
 * import it in plain Node and so a byte-level path decision never depends on a
 * configuration module. It also would not help: since Plan 2 the bucket is a
 * directory name and a `files` column value, not a row the vendor provisioned,
 * so an allow-list here would be a second copy to keep in step rather than a
 * gate. No caller can supply a bucket anyway: every one of the 14 sites passes a
 * literal or a config field, so an unknown-but-well-formed name is a programmer
 * error, not an attack, and containment below already holds.
 */
export function isBucketName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(value);
}

/**
 * Where the tree hangs. Read lazily, never at module scope: `next build`
 * imports every route module to collect its config, and a build has no
 * `/data/uploads` — the volume only exists where the app runs.
 */
export function uploadsRoot(): string {
  const root = process.env.UPLOADS_ROOT?.trim();
  if (!root) {
    throw new Error(
      "UPLOADS_ROOT is not set. In docker/.env it is /data/uploads; for a host-side `next dev` use .data/uploads."
    );
  }
  return path.resolve(root);
}

/** The bucket's own directory, which is also the outer bound of every key. */
export function bucketRoot(bucket: string, root = uploadsRoot()): string {
  if (!isBucketName(bucket)) throw new Error(`Refusing to treat "${bucket}" as a bucket name.`);
  return path.join(root, bucket);
}

/**
 * Resolve a key to an absolute path, or refuse.
 *
 * `isStoredPath` has already removed the ways a caller could express an escape,
 * and this does not rely on that alone — it re-checks the resolved result
 * against the bucket directory. Two independent guards is deliberate: the first
 * is a statement about the string, the second is a fact about the filesystem,
 * and the one that catches a future edit to the other is the filesystem.
 */
export function resolveObjectPath(bucket: string, key: string, root = uploadsRoot()): string {
  if (!isStoredPath(key)) throw new Error(`Refusing to resolve "${key}" as a storage key.`);
  const dir = bucketRoot(bucket, root);
  const target = path.resolve(dir, key);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error(`Refusing to resolve "${key}" outside the ${bucket} bucket.`);
  }
  return target;
}
