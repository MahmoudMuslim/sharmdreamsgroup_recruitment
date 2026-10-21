import "server-only";

import { createSupabaseServerClient } from "@/lib/data-api/server";
import { getFileStore, type FileStoreEntry } from "@/lib/files/store";
import type { BucketKey } from "./file-browser-types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * A single folder read. Storage caps one listing at 1000 objects; the default
 * here is lower so a page never ships a listing it cannot render.
 */
export const LIST_LIMIT = 200;

export const WALK_LIST_LIMIT = 500;

export type ListOutcome =
  | { ok: false; error: string }
  | { ok: true; entries: FileStoreEntry[] };

export async function listObjects(
  supabase: Supabase,
  bucket: BucketKey,
  prefix: string,
  limit = LIST_LIMIT
): Promise<ListOutcome> {
  const files = await getFileStore();
  const { entries, error } = await files.list({
    bucket,
    prefix,
    limit,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) return { ok: false, error };
  return { ok: true, entries };
}

export interface ObjectMetadata {
  bytes: number | null;
  mimeType: string | null;
}

/**
 * Size and stored content type of one object.
 *
 * Storage publishes no per-object read for a session client, so this reads the
 * parent folder and matches the leaf. Used both to enrich the audit entry before
 * a delete and to decide whether a file is safe to open inline.
 */
export async function objectMetadata(bucket: BucketKey, path: string): Promise<ObjectMetadata> {
  const empty: ObjectMetadata = { bytes: null, mimeType: null };

  const marker = path.lastIndexOf("/");
  const prefix = marker === -1 ? "" : path.slice(0, marker + 1);
  const leaf = marker === -1 ? path : path.slice(marker + 1);

  const supabase = await createSupabaseServerClient();
  const listed = await listObjects(supabase, bucket, prefix, WALK_LIST_LIMIT);
  if (!listed.ok) return empty;

  for (const entry of listed.entries) {
    if (entry.name !== leaf) continue;
    return { bytes: entry.bytes, mimeType: entry.mimeType };
  }

  return empty;
}
