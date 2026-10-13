import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  | { ok: true; entries: unknown[] };

export async function listObjects(
  supabase: Supabase,
  bucket: BucketKey,
  prefix: string,
  limit = LIST_LIMIT
): Promise<ListOutcome> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit, sortBy: { column: "name", order: "asc" } });

  if (error) return { ok: false, error: error.message };
  return { ok: true, entries: (data ?? []) as unknown[] };
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
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.name !== leaf) continue;

    const metadata = (row.metadata && typeof row.metadata === "object"
      ? row.metadata
      : {}) as Record<string, unknown>;

    return {
      bytes: typeof metadata.size === "number" && Number.isFinite(metadata.size) ? metadata.size : null,
      mimeType: typeof metadata.mimetype === "string" && metadata.mimetype ? metadata.mimetype : null,
    };
  }

  return empty;
}
