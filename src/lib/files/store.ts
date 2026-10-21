/* src/lib/files/store.ts
 * One interface for every byte the portal touches, so the storage *backend* is
 * decided once instead of sixteen times.
 *
 * The dated decision this file exists to record: during Plan 1 the *rows* moved
 * to the local Postgres/PostgREST stack while the *bytes* stayed with the vendor,
 * because the local `storage.objects` shim held metadata and no file. So the port
 * ran two backends at once, and once Task 11 replaced the row factories the bytes
 * no longer travelled under the caller's identity — the widening that this file's
 * previous header documented instead of hiding.
 *
 * Plan 2 closed it. `getFileStore()` returns the disk-backed store over
 * `$UPLOADS_ROOT/<bucket>/<path>` + the `public.files` table (spec §7); the vendor
 * client and `@supabase/supabase-js` left with it, and no call site changed: the
 * interface below is what the 14 `getFileStore()` callers code against, which is
 * the whole reason it stayed exactly as it was. Read `disk-store.ts` for which
 * door each method uses and why a browse and a byte do not use the same one.
 */
import "server-only";
import { createDiskFileStore } from "./disk-store";

export interface FileStoreEntry {
  path: string;
  name: string;
  isFolder: boolean;
  bytes: number | null;
  mimeType: string | null;
  updatedAt: string | null;
}

export interface FileStore {
  upload(input: { bucket: string; path: string; body: Blob | ArrayBuffer | string; contentType?: string; upsert?: boolean }): Promise<{ ok: boolean; error?: string }>;
  signedUrl(input: { bucket: string; path: string; seconds: number; download?: string }): Promise<{ url: string | null; error?: string }>;
  download(input: { bucket: string; path: string }): Promise<{ bytes: Uint8Array | null; contentType: string | null; error?: string }>;
  remove(input: { bucket: string; paths: string[] }): Promise<{ ok: boolean; failed: string[]; error?: string }>;
  list(input: { bucket: string; prefix: string; limit?: number; sortBy?: { column: "name" | "created_at" | "updated_at"; order: "asc" | "desc" } }): Promise<{ entries: FileStoreEntry[]; error?: string }>;
}

export async function getFileStore(): Promise<FileStore> {
  return createDiskFileStore();
}
