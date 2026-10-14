"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { stageLabel } from "@/lib/utils";
import { LIST_LIMIT, WALK_LIST_LIMIT, listObjects, objectMetadata } from "./storage-list";
import {
  BUCKETS,
  bucketInfo,
  displayName,
  isStoredPath,
  type BucketKey,
  type BucketStat,
  type DeleteResult,
  type FileOwner,
  type StoredFile,
  type StoredFolder,
  type ViewResult,
} from "./file-browser-types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The bucket totals walk every folder, so the walk is bounded: a bucket with a
 * deep or enormous tree reports a lower bound instead of stalling the page.
 */
const WALK_MAX_LISTINGS = 8;
const WALK_MAX_DEPTH = 4;

const READ_DENIED = "Browsing stored files needs the View candidates permission.";

export async function getFileBrowserData(): Promise<{
  buckets: BucketStat[];
  view: ViewResult;
}> {
  await requireStaff("/files");

  if (!(await hasPermissionForUser("candidates.read"))) {
    return { buckets: [], view: { ok: false, error: READ_DENIED } };
  }

  const supabase = await createSupabaseServerClient();
  const [buckets, view] = await Promise.all([
    describeBuckets(supabase),
    readFolder(supabase, "candidate-cvs", ""),
  ]);

  return { buckets, view };
}

/** Opens another folder or bucket; the browser calls this on every navigation. */
export async function openFolder(bucketKey: string, prefix: string): Promise<ViewResult> {
  await requireStaff("/files");

  const bucket = bucketInfo(bucketKey);
  if (!bucket) return { ok: false, error: "That is not a bucket this portal stores files in." };

  if (prefix !== "" && !isStoredPath(prefix.replace(/\/+$/, ""))) {
    return { ok: false, error: "That folder path is not a valid storage prefix." };
  }

  const supabase = await createSupabaseServerClient();
  return readFolder(supabase, bucket.key, prefix);
}

/**
 * Permanently removes one stored object.
 *
 * Stricter than storage RLS, which lets any staff role delete a CV: a file a
 * candidate uploaded is evidence, so this is a platform-level action — and the
 * audit table it writes is only insertable with that same permission.
 */
export async function deleteStoredFile(bucketKey: string, path: string): Promise<DeleteResult> {
  const user = await requireStaff("/files");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Deleting a stored file needs the Manage platform settings permission." };
  }

  const bucket = bucketInfo(bucketKey);
  if (!bucket) return { ok: false, error: "That is not a bucket this portal stores files in." };

  if (!bucket.deletable) {
    return {
      ok: false,
      error: `The storage policy for ${bucket.label} does not authorise staff deletes, so the portal cannot remove files from it.`,
    };
  }

  if (!isStoredPath(path)) return { ok: false, error: "That is not a valid storage key." };

  const supabase = await createSupabaseServerClient();

  // Read the object's size and type before removing it: the audit entry is
  // worthless if the only copy of that detail was the file itself.
  const before = await objectMetadata(bucket.key, path);

  const { error } = await supabase.storage.from(bucket.key).remove([path]);
  if (error) {
    console.error("[files] delete refused:", bucket.key, error.message);
    return { ok: false, error: `Storage refused the delete: ${error.message}` };
  }

  const note = await recordDeletion(supabase, user.authUserId, bucket.key, path, before);

  revalidatePath("/files");
  return { ok: true, name: displayName(path), ...(note ? { note } : {}) };
}

async function readFolder(supabase: Supabase, bucket: BucketKey, prefix: string): Promise<ViewResult> {
  if (!(await hasPermissionForUser("candidates.read"))) {
    return { ok: false, error: READ_DENIED };
  }

  const info = bucketInfo(bucket);
  if (!info) return { ok: false, error: "That is not a bucket this portal stores files in." };

  const listed = await listObjects(supabase, bucket, prefix);
  if (!listed.ok) {
    return { ok: false, error: `The files could not be listed: ${listed.error}` };
  }

  const folders: StoredFolder[] = [];
  const rows = new Map<string, Omit<StoredFile, "owner">>();

  for (const entry of listed.entries) {
    const row = asRecord(entry);
    const name = typeof row.name === "string" ? row.name : null;
    if (!name) continue;

    // Storage reports a folder as an entry that carries no object id.
    if (typeof row.id !== "string") {
      folders.push({ name, prefix: `${prefix}${name}/` });
      continue;
    }

    const path = `${prefix}${name}`;
    rows.set(path, {
      path,
      name: displayName(name),
      bytes: numberOrNull(asRecord(row.metadata).size),
      mimeType: stringOrNull(asRecord(row.metadata).mimetype),
      modifiedAt: stringOrNull(row.updated_at),
    });
  }

  const owners = await ownersFor(supabase, bucket, [...rows.keys()]);
  const trackable = bucket === "candidate-cvs" || bucket === "candidate-videos";

  const files: StoredFile[] = [...rows.values()]
    .map((file) => ({ ...file, owner: owners.map.get(file.path) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  folders.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    listing: {
      bucketKey: bucket,
      bucketLabel: info.label,
      prefix,
      folders,
      files,
      truncated: listed.entries.length >= LIST_LIMIT,
      ownersLoaded: owners.loaded,
      ownersTrackable: trackable,
    },
  };
}

/** Totals for the bucket rail, from a bounded walk of each bucket's tree. */
async function describeBuckets(supabase: Supabase): Promise<BucketStat[]> {
  return Promise.all(
    BUCKETS.map(async (bucket) => {
      const budget = { calls: 0, exhausted: false };
      const totals = await walk(supabase, bucket.key, "", budget);
      return {
        key: bucket.key,
        label: bucket.label,
        files: totals.files,
        bytes: totals.bytes,
        exact: !budget.exhausted,
      } satisfies BucketStat;
    })
  );
}

async function walk(
  supabase: Supabase,
  bucket: BucketKey,
  prefix: string,
  budget: { calls: number; exhausted: boolean },
  depth = 0
): Promise<{ files: number; bytes: number }> {
  if (depth > WALK_MAX_DEPTH || budget.calls >= WALK_MAX_LISTINGS) {
    budget.exhausted = true;
    return { files: 0, bytes: 0 };
  }

  budget.calls += 1;
  const listed = await listObjects(supabase, bucket, prefix, WALK_LIST_LIMIT);
  if (!listed.ok) return { files: 0, bytes: 0 };
  if (listed.entries.length >= WALK_LIST_LIMIT) budget.exhausted = true;

  let files = 0;
  let bytes = 0;
  const children: string[] = [];

  for (const entry of listed.entries) {
    const row = asRecord(entry);
    const name = typeof row.name === "string" ? row.name : null;
    if (!name) continue;

    if (typeof row.id !== "string") {
      children.push(`${prefix}${name}/`);
      continue;
    }

    files += 1;
    bytes += numberOrNull(asRecord(row.metadata).size) ?? 0;
  }

  for (const child of children) {
    const inner = await walk(supabase, bucket, child, budget, depth + 1);
    files += inner.files;
    bytes += inner.bytes;
  }

  return { files, bytes };
}

/**
 * Which record references each listed key.
 *
 * `applications.cv_file_path` and `candidate_responses.video_path` are the only
 * columns in this schema that hold storage keys, so a file in another bucket —
 * or one whose row was deleted — genuinely reports as unlinked.
 */
async function ownersFor(
  supabase: Supabase,
  bucket: BucketKey,
  paths: string[]
): Promise<{ map: Map<string, FileOwner>; loaded: boolean }> {
  const map = new Map<string, FileOwner>();
  if (paths.length === 0) return { map, loaded: true };

  if (bucket === "candidate-cvs") {
    const { data, error } = await supabase
      .from("applications")
      .select("full_name, stage, cv_file_path, job_openings(title)")
      .not("cv_file_path", "is", "null")
      .is("archived_at", null)
      .limit(1000);

    if (error) {
      console.error("[files] applicant lookup failed:", error.message);
      return { map, loaded: false };
    }

    for (const entry of data ?? []) {
      const row = asRecord(entry);
      const path = stringOrNull(row.cv_file_path);
      if (!path) continue;

      const opening = asRecord(Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings);
      map.set(path, {
        label: stringOrNull(row.full_name) ?? "Unnamed applicant",
        detail: [stageLabel(String(row.stage ?? "NEW")), stringOrNull(opening.title)]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return { map, loaded: true };
  }

  if (bucket === "candidate-videos") {
    const { data, error } = await supabase
      .from("candidate_responses")
      .select("video_path, candidate_attempts(applications(full_name, stage))")
      .not("video_path", "is", "null")
      .limit(1000);

    if (error) {
      console.error("[files] attempt lookup failed:", error.message);
      return { map, loaded: false };
    }

    for (const entry of data ?? []) {
      const row = asRecord(entry);
      const path = stringOrNull(row.video_path);
      if (!path) continue;

      const attempt = asRecord(
        Array.isArray(row.candidate_attempts) ? row.candidate_attempts[0] : row.candidate_attempts
      );
      const application = asRecord(
        Array.isArray(attempt.applications) ? attempt.applications[0] : attempt.applications
      );

      map.set(path, {
        label: stringOrNull(application.full_name) ?? "Unnamed attempt",
        detail: [
          "Video pitch",
          stringOrNull(application.stage) ? stageLabel(String(application.stage)) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return { map, loaded: true };
  }

  // No column in this schema points at the other two buckets.
  return { map, loaded: true };
}

/**
 * Writes the delete into `settings_audit_log`.
 *
 * Returns a note for the UI when that write is refused: the file is already
 * gone, so the delete cannot be rolled back and must not be reported as though
 * the record had been kept.
 */
async function recordDeletion(
  supabase: Supabase,
  authUserId: string,
  bucket: BucketKey,
  path: string,
  before: { bytes: number | null; mimeType: string | null }
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  const { error } = await supabase.from("settings_audit_log").insert({
    key: `storage.file:${bucket}/${path}`,
    previous_value: { bucket, path, bytes: before.bytes, mime_type: before.mimeType },
    next_value: null,
    changed_by: stringOrNull(asRecord(profile).id) ?? null,
  });

  if (error) {
    console.error("[files] audit insert failed:", error.message);
    return "The file was deleted, but the audit log refused the entry.";
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
