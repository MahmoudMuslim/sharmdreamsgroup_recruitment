/* src/lib/files/store.ts
 * One interface for every byte the portal touches, so the storage *backend* is
 * decided once instead of sixteen times.
 *
 * The dated decision this file exists to record: during Plan 1 the *rows* move
 * to the local Postgres/PostgREST stack while the *bytes* stay with the vendor,
 * because the local `storage.objects` shim holds metadata and no file. So the
 * port runs two backends at once, and every method here still talks to the
 * client it is handed. Plan 2 replaces the body of `getFileStore` with a
 * disk-backed store over `/data/uploads` and a `files` table (spec §7); no call
 * site changes, and the `client` parameter stops being read rather than being
 * cast away.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Plan 2 returns a disk-backed store here; no call site changes. */
export async function getFileStore(client: { storage: SupabaseClient["storage"] }): Promise<FileStore> {
  const { storage } = client;
  return {
    async upload({ bucket, path, body, contentType, upsert }) {
      const { error } = await storage
        .from(bucket)
        .upload(path, body, { contentType, upsert });
      return { ok: !error, error: error?.message };
    },
    async signedUrl({ bucket, path, seconds, download }) {
      const { data, error } = await storage
        .from(bucket)
        .createSignedUrl(path, seconds, download === undefined ? undefined : { download });
      return { url: data?.signedUrl ?? null, error: error?.message };
    },
    async download({ bucket, path }) {
      const { data, error } = await storage.from(bucket).download(path);
      if (error || !data) return { bytes: null, contentType: null, error: error?.message };
      const buffer = await data.arrayBuffer();
      // `type` is the blob's own content type, and gradeAttempt hands it to the
      // transcriber. Returning null here would silently pin every recording to
      // that call's "video/webm" fallback.
      return { bytes: new Uint8Array(buffer), contentType: data.type || null, error: undefined };
    },
    async remove({ bucket, paths }) {
      const { error } = await storage.from(bucket).remove(paths);
      return { ok: !error, failed: error ? paths : [], error: error?.message };
    },
    async list({ bucket, prefix, limit = 1000, sortBy }) {
      const { data, error } = await storage.from(bucket).list(prefix, { limit, sortBy });
      return {
        // Storage keys are prefix + leaf, with the separator already inside the
        // prefix ("applications/<id>/"). Joining with "/" here would turn an
        // empty prefix into "/file.pdf" and a real prefix into a doubled slash.
        entries: (data ?? []).map((entry) => ({
          path: `${prefix}${entry.name}`,
          name: entry.name,
          isFolder: typeof entry.id !== "string",
          bytes: typeof entry.metadata?.size === "number" ? entry.metadata.size : null,
          mimeType: typeof entry.metadata?.mimetype === "string" ? entry.metadata.mimetype : null,
          updatedAt: entry.updated_at ?? null,
        })),
        error: error?.message,
      };
    },
  };
}
