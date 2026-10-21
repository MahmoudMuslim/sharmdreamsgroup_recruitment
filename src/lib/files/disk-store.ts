/* src/lib/files/disk-store.ts
 * The storage backend: bytes under `$UPLOADS_ROOT/<bucket>/<path>`, metadata in
 * `public.files`.
 *
 * Two doors, and which one each method uses is the interesting part of this
 * file.
 *
 * - **Listings go out through the session's REST client.** `public.files` has
 *   eight RLS policies (spec §7, Task 2) that are the ported shape of the eight
 *   `storage.objects` policies this replaces, and they bind the PostgREST door.
 *   A browse of the File Manager therefore runs as the signed-in staff member:
 *   a `candidate-cvs` listing needs `is_staff()`, and a bearer that is not a
 *   staff session gets an empty list rather than somebody's CVs.
 * - **The byte and its single row go through the app's own pool.** Every method
 *   that touches one named object also touches the bytes on disk, and the bytes
 *   have no RLS — the containment rule in `paths.ts` and the caller's own
 *   permission check are the gate there. Sending the matching metadata read down
 *   the same session door would make the two halves of one operation disagree:
 *   `/api/attempt/<token>/video` authorises a candidate by their attempt token,
 *   which is not a session, so a session-scoped read of that upload's `files`
 *   row would refuse a byte the route is entitled to serve. `store.ts` already
 *   made this trade in Plan 1 ("the portal's own checks … are now the gate on a
 *   byte"); Plan 2 keeps it, and ends it the day the vendor does.
 *
 * Writes never land on the final name first: the payload goes to a sibling
 * `*.tmp-<uuid>` and is renamed over the target. A crash mid-write then leaves a
 * temp file, not a truncated CV that the `files` row swears is whole — and the
 * row is only written after the rename succeeds, so a row never points at bytes
 * that are not there.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAuthPool } from "@/lib/auth/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isStoredPath, resolveObjectPath } from "./paths";
import { mintFileLink } from "./signed-link";
import type { FileStore, FileStoreEntry } from "./store";

/**
 * The most rows one listing will scan.
 *
 * `storage.list()` was capped at 1000 by the vendor; the folder is now a prefix
 * query over a table that holds every bucket, so the bound has to be ours. It is
 * generous on purpose — hitting it means a folder with thousands of objects,
 * which the File Manager has never shown — and when it is hit the call reports
 * the truncation instead of returning a partial listing as if it were complete.
 */
const SCAN_CEILING = 5000;

/** The URL the `/api/files/f/[token]` route answers, relative so it follows the
 * host the app is actually on: `appConfig.url` is a build-time value, and a link
 * minted on `localhost:3001` that says so is broken the moment it is opened from
 * the VPS. Every consumer puts this in an `href`/`src` on our own origin. */
const LINK_PREFIX = "/api/files/f/";

interface FileRow {
  path: string;
  mime: string | null;
  bytes: number | null;
  updated_at: string | null;
}

/** `bytes` is `bigint`, which node-postgres hands back as a string to keep it
 * exact (spec §15 finding 2) and PostgREST serialises as a JSON number. Coerce
 * once, at the row, so no reader has to know which door it came through. */
function rowBytes(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function readRow(bucket: string, key: string): Promise<FileRow | null> {
  const res = await getAuthPool().query(
    "select path, mime, bytes, updated_at from public.files where bucket = $1 and path = $2",
    [bucket, key]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    path: String(row.path),
    mime: row.mime == null ? null : String(row.mime),
    bytes: rowBytes(row.bytes),
    updated_at: row.updated_at == null ? null : new Date(row.updated_at).toISOString(),
  };
}

/** Body → bytes. A `Blob` is what every upload route hands us; a string is text
 * in the caller's own encoding, which is why they always pass a contentType. */
async function toBuffer(body: Blob | ArrayBuffer | string): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(await body.arrayBuffer());
}

export function createDiskFileStore(): FileStore {
  return {
    async upload({ bucket, path: key, body, contentType, upsert }) {
      if (!isStoredPath(key)) return { ok: false, error: `Refusing to store "${key}".` };
      let target: string;
      try {
        target = resolveObjectPath(bucket, key);
      } catch (cause) {
        return { ok: false, error: (cause as Error).message };
      }

      const buf = await toBuffer(body);
      await mkdir(path.dirname(target), { recursive: true });

      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, buf);

      // A non-upsert write to a key that already holds a byte is a collision, and
      // the two public upload routes ask for exactly that refusal.
      if (!upsert) {
        const exists = await stat(target).then(() => true, () => false);
        if (exists) {
          await unlink(temp).catch(() => {});
          return { ok: false, error: `An object already exists at ${key}.` };
        }
      }

      try {
        await rename(temp, target);
      } catch (cause) {
        await unlink(temp).catch(() => {});
        return { ok: false, error: (cause as Error).message };
      }

      try {
        if (upsert) {
          await getAuthPool().query(
            `insert into public.files (bucket, path, mime, bytes, updated_at)
             values ($1, $2, $3, $4, now())
             on conflict (bucket, path) do update
               set mime = excluded.mime, bytes = excluded.bytes, updated_at = now()`,
            [bucket, key, contentType ?? null, buf.byteLength]
          );
        } else {
          const res = await getAuthPool().query(
            `insert into public.files (bucket, path, mime, bytes)
             values ($1, $2, $3, $4)
             on conflict (bucket, path) do nothing`,
            [bucket, key, contentType ?? null, buf.byteLength]
          );
          // Lost the race with an identical key: the byte we just renamed is not
          // what the row describes, so neither of them stays.
          if (res.rowCount === 0) {
            await unlink(target).catch(() => {});
            return { ok: false, error: `An object already exists at ${key}.` };
          }
        }
      } catch (cause) {
        // The bytes stay. Deleting them here would destroy whatever the key held
        // before, because the rename above already replaced it, and the only
        // failure this branch can hit is the database being unreachable — a
        // retry of the upload rewrites both halves. A byte with no row is
        // invisible to a listing; a row with no byte is a link that 404s, and
        // neither is worth losing a candidate's file for.
        console.error("[files] byte stored, row refused:", bucket, key, (cause as Error).message);
        return { ok: false, error: (cause as Error).message };
      }

      return { ok: true };
    },

    async signedUrl({ bucket, path: key, seconds, download }) {
      let target: string;
      try {
        target = resolveObjectPath(bucket, key);
      } catch (cause) {
        return { url: null, error: (cause as Error).message };
      }

      const present = await stat(target).then((s) => s.isFile(), () => false);
      if (!present) return { url: null, error: `No object at ${key}.` };

      // The mime comes from the row, not the extension: an object keeps whatever
      // type its upload declared, and that is what decides inline vs download.
      const mime = (await readRow(bucket, key).catch(() => null))?.mime ?? null;
      return { url: `${LINK_PREFIX}${mintFileLink({ bucket, path: key, seconds, download, mime })}` };
    },

    async download({ bucket, path: key }) {
      let target: string;
      try {
        target = resolveObjectPath(bucket, key);
      } catch (cause) {
        return { bytes: null, contentType: null, error: (cause as Error).message };
      }

      try {
        const buf = await readFile(target);
        const row = await readRow(bucket, key).catch(() => null);
        return { bytes: new Uint8Array(buf), contentType: row?.mime ?? null, error: undefined };
      } catch (cause) {
        return { bytes: null, contentType: null, error: (cause as Error).message };
      }
    },

    async remove({ bucket, paths }) {
      const failed: string[] = [];

      for (const key of paths) {
        let target: string;
        try {
          target = resolveObjectPath(bucket, key);
        } catch {
          failed.push(key);
          continue;
        }

        // Bytes first, then the row. The reverse order leaves an object on the
        // disk that nothing lists — candidate PII with no record and no way to
        // find it in the File Manager — and this portal deletes CVs on request.
        // A missing byte is the state the caller asked for, so ENOENT is a pass.
        try {
          await unlink(target);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            failed.push(key);
            continue;
          }
        }

        try {
          await getAuthPool().query("delete from public.files where bucket = $1 and path = $2", [bucket, key]);
        } catch {
          failed.push(key);
        }
      }

      return { ok: failed.length === 0, failed, error: failed.length ? `${failed.length} object(s) not removed` : undefined };
    },

    async list({ bucket, prefix, limit = 1000, sortBy }) {
      // The session door, so the eight `files` policies decide what a browse
      // shows. `column: "name"` sorts by the key, which is what a folder listing
      // sorts by when the vendor did it.
      const supabase = await createSupabaseServerClient();
      const column = sortBy?.column === "created_at" ? "created_at" : sortBy?.column === "updated_at" ? "updated_at" : "path";
      const { data, error } = await supabase
        .from("files")
        .select("path, mime, bytes, updated_at")
        .eq("bucket", bucket)
        .like("path", `${prefix}*`)
        .order(column, { ascending: sortBy?.order !== "desc" })
        .limit(SCAN_CEILING);

      if (error) return { entries: [], error: error.message };
      const rows = (data ?? []) as FileRow[];
      if (rows.length >= SCAN_CEILING) {
        return { entries: [], error: `The ${bucket} listing stopped at ${SCAN_CEILING} objects; this folder is larger than one read.` };
      }

      const entries = foldToPrefix(rows, prefix);
      return { entries: orderEntries(entries, sortBy ?? { column: "name", order: "asc" }).slice(0, Math.max(limit, 0)), error: undefined };
    },
  };
}

/**
 * Rows under a prefix → one level of entries.
 *
 * The query returns every descendant, so a row deeper than the prefix becomes
 * the folder it sits in, named by the next segment and emitted once. A key
 * exactly at `prefix + "/"` (a directory marker) has an empty leaf and is
 * dropped — there is no such row in our table, but the fold must not invent one.
 */
function foldToPrefix(rows: FileRow[], prefix: string): FileStoreEntry[] {
  const files: FileStoreEntry[] = [];
  const folders = new Map<string, FileStoreEntry>();

  for (const row of rows) {
    if (!row.path.startsWith(prefix)) continue; // a LIKE wildcard in the prefix over-matches; this is the truth
    const rest = row.path.slice(prefix.length);
    if (!rest) continue;

    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push({
        path: row.path,
        name: rest,
        isFolder: false,
        bytes: rowBytes(row.bytes),
        mimeType: row.mime,
        updatedAt: row.updated_at,
      });
      continue;
    }

    const name = rest.slice(0, slash);
    if (!folders.has(name)) folders.set(name, { path: `${prefix}${name}`, name, isFolder: true, bytes: null, mimeType: null, updatedAt: null });
  }

  return [...folders.values(), ...files];
}

/**
 * Folders lead, whatever the sort.
 *
 * A folder has no `updated_at` of its own, so a date sort that interleaved them
 * with the files would show a directory as a file with a null timestamp. For a
 * date column the query already ordered the rows and this only lifts the folders;
 * for `name` it re-sorts on the leaf, because the SQL ordered on the whole key —
 * `applications/z.pdf` and `z.pdf` are neighbours by key and not by name.
 */
function orderEntries(entries: FileStoreEntry[], sortBy: { column: "name" | "created_at" | "updated_at"; order: "asc" | "desc" }): FileStoreEntry[] {
  const folders = entries.filter((entry) => entry.isFolder);
  const files = entries.filter((entry) => !entry.isFolder);
  const dir = sortBy.order === "desc" ? -1 : 1;
  if (sortBy.column !== "name") return [...folders, ...files];
  return [
    ...folders.sort((a, b) => a.name.localeCompare(b.name) * dir),
    ...files.sort((a, b) => a.name.localeCompare(b.name) * dir),
  ];
}
