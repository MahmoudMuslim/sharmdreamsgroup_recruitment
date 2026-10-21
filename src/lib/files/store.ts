/* src/lib/files/store.ts
 * One interface for every byte the portal touches, so the storage *backend* is
 * decided once instead of sixteen times.
 *
 * The dated decision this file exists to record: during Plan 1 the *rows* move
 * to the local Postgres/PostgREST stack while the *bytes* stay with the vendor,
 * because the local `storage.objects` shim holds metadata and no file. So the
 * port runs two backends at once. Since Task 11 the row factories are no longer
 * vendor clients, so the bytes no longer travel under the caller's identity —
 * see `vendor` below for what that widens and why it is deliberate. Plan 2
 * replaces the body of `getFileStore` with a disk-backed store over
 * `/data/uploads` and a `files` table (spec §7); no call site changes.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

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

/**
 * The bytes still live with the vendor (spec §7: the local `storage.objects`
 * shim holds metadata, not files), and after Task 11 the vendor has no other
 * identity for us — our session token is signed with `AUTH_JWT_SECRET`, which
 * gotrue will not accept. So every byte the portal touches here moves under
 * the service key, which is a deliberate widening relative to the eight staff
 * sites that used to run under the signed-in staff JWT and the vendor's bucket
 * policies. The portal's own checks — the staff guard, the ownership predicates
 * in the actions, the format table on the upload routes — are now the gate on
 * a byte. Plan 2 deletes this whole path: `getFileStore()` returns a
 * disk-backed store over `/data/uploads` + a `files` table, the vendor client
 * and `@supabase/supabase-js` go with it (Task 17's importer list shrinks by
 * this file), and the widening ends the day the bytes do.
 */
/**
 * Built on first use, never at module scope. `next build` imports every route
 * module to collect its config, and a keyless `createClient` throws
 * `supabaseKey is required` right there — which is what a container build hits,
 * because the image's build context carries no secrets by design
 * (`.dockerignore` excludes `.env.local` so no credential can be baked into a
 * layer). Deferring construction to the first byte means the build needs
 * nothing and the runtime still gets the real key from the environment.
 */
let vendor: ReturnType<typeof createClient> | null = null;
function getVendor() {
  vendor ??= createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey!);
  return vendor;
}

/** Plan 2 returns a disk-backed store here; no call site changes. */
export async function getFileStore(): Promise<FileStore> {
  const { storage } = getVendor();
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
          bytes: typeof entry.metadata?.size === "number" && Number.isFinite(entry.metadata.size) ? entry.metadata.size : null,
          mimeType: typeof entry.metadata?.mimetype === "string" ? entry.metadata.mimetype : null,
          updatedAt: entry.updated_at ?? null,
        })),
        error: error?.message,
      };
    },
  };
}
