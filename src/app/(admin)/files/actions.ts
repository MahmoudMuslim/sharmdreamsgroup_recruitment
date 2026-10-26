"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";
import { displayName, isStoredPath } from "@/lib/files/paths";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { stageLabel, formatBytes } from "@/lib/utils";
import { recordActivity } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { LIST_LIMIT, WALK_LIST_LIMIT, listObjects, objectMetadata } from "./storage-list";
import {
  BUCKETS,
  bucketInfo,
  type BucketKey,
  type BucketStat,
  type DeleteResult,
  type FileOwner,
  type StoredFile,
  type StoredFolder,
  type ViewResult,
} from "./file-browser-types";

type ServerClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The bucket totals walk every folder, so the walk is bounded: a bucket with a
 * deep or enormous tree reports a lower bound instead of stalling the page.
 */
const WALK_MAX_LISTINGS = 8;
const WALK_MAX_DEPTH = 4;

const READ_DENIED = "Browsing stored files needs the View candidates permission.";

/**
 * The folder the address bar asks the page to open.
 *
 * A bucket this portal does not store in, or a prefix storage would refuse, is
 * ignored rather than half-honoured: the page then lists the CV root it could
 * always list, instead of showing an empty folder and reading as "no files here"
 * when the words in the URL simply named a place that is not there.
 */
function folderFromParams(
  bucket: string | null | undefined,
  prefix: string | null | undefined
): { bucket: BucketKey; prefix: string } {
  const info = bucketInfo(bucket);
  const trimmed = (prefix ?? "").trim().replace(/\/+$/, "");
  if (!info || (trimmed !== "" && !isStoredPath(trimmed))) {
    return { bucket: "candidate-cvs", prefix: "" };
  }
  // `readFolder` joins the prefix to each object name, so a folder travels with
  // its trailing slash and the root travels without one.
  return { bucket: info.key, prefix: trimmed === "" ? "" : `${trimmed}/` };
}

export async function getFileBrowserData(
  bucket?: string | null,
  prefix?: string | null
): Promise<{
  buckets: BucketStat[];
  view: ViewResult;
}> {
  await requireStaff("/files");

  if (!(await hasPermissionForUser("candidates.read"))) {
    return { buckets: [], view: { ok: false, error: READ_DENIED } };
  }

  const target = folderFromParams(bucket, prefix);
  const restClient = await createServerRestClient();
  const [buckets, view] = await Promise.all([
    describeBuckets(restClient),
    readFolder(restClient, target.bucket, target.prefix),
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

  const restClient = await createServerRestClient();
  return readFolder(restClient, bucket.key, prefix);
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

  const restClient = await createServerRestClient();
  const files = await getFileStore();

  // Read the object's size and type before removing it: the audit entry is
  // worthless if the only copy of that detail was the file itself.
  const before = await objectMetadata(bucket.key, path);
  const owner = await fileOwner(restClient, bucket.key, path);

  const { error } = await files.remove({ bucket: bucket.key, paths: [path] });
  if (error) {
    console.error("[files] delete refused:", bucket.key, error);
    return { ok: false, error: `Storage refused the delete: ${error}` };
  }

  const note = [
    await recordDeletion(restClient, user.authUserId, bucket.key, path, before),
    await unlinkReference(restClient, bucket.key, path),
  ]
    .filter(Boolean)
    .join(" ");

  await recordActivity({
    area: "files",
    action: "file_delete",
    entity: "attachment",
    entityId: path,
    summary: `Deleted ${bucket.label.toLowerCase()} “${displayName(path)}”${
      before.bytes ? ` (${formatBytes(before.bytes)})` : ""
    }${owner ? ` from ${owner.name}'s record` : " with no candidate record pointing at it"}`,
    detail: {
      bucket: bucket.key,
      path,
      bytes: before.bytes,
      mime_type: before.mimeType,
      application_id: owner?.applicationId ?? null,
      // A profile photo belongs to a person, not to an application, and the
      // person's id has to be recoverable from the trail after the byte is gone.
      person_id: owner?.personId ?? null,
      note: note || (owner ? "Its database pointer was cleared with it." : "Nothing pointed at it."),
    },
  });

  revalidatePath("/files");
  return {
    ok: true,
    name: displayName(path),
    ...(note ? { note } : {}),
  };
}

async function readFolder(restClient: ServerClient, bucket: BucketKey, prefix: string): Promise<ViewResult> {
  if (!(await hasPermissionForUser("candidates.read"))) {
    return { ok: false, error: READ_DENIED };
  }

  const info = bucketInfo(bucket);
  if (!info) return { ok: false, error: "That is not a bucket this portal stores files in." };

  const listed = await listObjects(restClient, bucket, prefix);
  if (!listed.ok) {
    return { ok: false, error: `The files could not be listed: ${listed.error}` };
  }

  const folders: StoredFolder[] = [];
  const rows = new Map<string, Omit<StoredFile, "owner">>();

  for (const entry of listed.entries) {
    const name = entry.name;
    if (!name) continue;

    // Storage reports a folder as an entry that carries no object id.
    if (entry.isFolder) {
      folders.push({ name, prefix: `${prefix}${name}/` });
      continue;
    }

    const path = entry.path;
    rows.set(path, {
      path,
      name: displayName(name),
      bytes: entry.bytes,
      mimeType: entry.mimeType,
      modifiedAt: entry.updatedAt,
    });
  }

  const owners = await ownersFor(restClient, bucket, [...rows.keys()]);

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
    },
  };
}

/** Totals for the bucket rail, from a bounded walk of each bucket's tree. */
async function describeBuckets(restClient: ServerClient): Promise<BucketStat[]> {
  return Promise.all(
    BUCKETS.map(async (bucket) => {
      const budget = { calls: 0, exhausted: false };
      const totals = await walk(restClient, bucket.key, "", budget);
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
  restClient: ServerClient,
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
  const listed = await listObjects(restClient, bucket, prefix, WALK_LIST_LIMIT);
  if (!listed.ok) return { files: 0, bytes: 0 };
  if (listed.entries.length >= WALK_LIST_LIMIT) budget.exhausted = true;

  let files = 0;
  let bytes = 0;
  const children: string[] = [];

  for (const entry of listed.entries) {
    const name = entry.name;
    if (!name) continue;

    if (entry.isFolder) {
      children.push(`${prefix}${name}/`);
      continue;
    }

    files += 1;
    bytes += entry.bytes ?? 0;
  }

  for (const child of children) {
    const inner = await walk(restClient, bucket, child, budget, depth + 1);
    files += inner.files;
    bytes += inner.bytes;
  }

  return { files, bytes };
}

/**
 * The second door into the CV and photo buckets.
 *
 * A public application form writes its byte to the same bucket an application's
 * CV or a person's photo lives in, but names it in `application_form_files`
 * instead of a column on either record, so the reads above cannot see it. Keys
 * already mapped stay mapped: the record the bucket has always reported wins.
 *
 * Rows still carrying `application_id null` are deliberately left out. Nobody
 * has filed them yet, so "unlinked" is the true answer until the orphan pass
 * removes them (spec §4) — and that pass reads only this table's own rows.
 */
async function mapFormUploads(
  restClient: ServerClient,
  bucket: BucketKey,
  map: Map<string, FileOwner>
): Promise<boolean> {
  if (bucket !== "candidate-cvs" && bucket !== "candidate-photos") return true;

  const { data, error } = await restClient
    .from("application_form_files")
    .select("storage_path, field_key, applications(full_name)")
    .eq("bucket", bucket)
    .not("application_id", "is", null)
    .limit(1000);

  if (error) {
    // 044 is applied per file by the owner, so a database without this table is
    // an expected state rather than a fault — and a table that is not there
    // cannot name a byte, so the rows above are still the whole answer.
    if (isMissingSchemaError(error)) return true;
    console.error("[files] form upload lookup failed:", error.message);
    return false;
  }

  for (const entry of data ?? []) {
    const row = asRecord(entry);
    const path = stringOrNull(row.storage_path);
    if (!path || map.has(path)) continue;

    const application = asRecord(
      Array.isArray(row.applications) ? row.applications[0] : row.applications
    );

    map.set(path, {
      label: stringOrNull(application.full_name) ?? "Unnamed applicant",
      detail: `Form upload · ${stringOrNull(row.field_key) ?? "file"}`,
    });
  }

  return true;
}

/**
 * Which record references each listed key.
 *
 * `applications.cv_file_path`, `candidate_responses.video_path`,
 * `application_attachments.storage_path` and `person_profiles.photo_path` hold
 * the keys a staff door writes. A public application form writes a second kind
 * of row into the same two buckets — an `application_form_files` ledger row that
 * names the applicant through `application_id` — so a byte with none of these
 * rows *and* no ledger row is the one that genuinely reports as unlinked.
 */
async function ownersFor(
  restClient: ServerClient,
  bucket: BucketKey,
  paths: string[]
): Promise<{ map: Map<string, FileOwner>; loaded: boolean }> {
  const map = new Map<string, FileOwner>();
  if (paths.length === 0) return { map, loaded: true };

  if (bucket === "candidate-cvs") {
    const { data, error } = await restClient
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
    return { map, loaded: await mapFormUploads(restClient, bucket, map) };
  }

  if (bucket === "candidate-videos") {
    const { data, error } = await restClient
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

  // The person spine: one photo per profile, and the profile names it itself.
  if (bucket === "candidate-photos") {
    const { data, error } = await restClient
      .from("person_profiles")
      .select("photo_path, legal_name")
      .not("photo_path", "is", "null")
      .limit(1000);

    if (error) {
      // `loaded: false` is the whole answer the view can carry, so both failures
      // report it. The split is only about the log: 043 is authored but applied
      // per-file by the owner, so a missing `person_profiles` is an expected
      // state, not a fault worth printing on every browse of the bucket.
      if (!isMissingSchemaError(error)) {
        console.error("[files] photo lookup failed:", error.message);
      }
      return { map, loaded: false };
    }

    for (const entry of data ?? []) {
      const row = asRecord(entry);
      const path = stringOrNull(row.photo_path);
      if (!path) continue;

      map.set(path, {
        label: stringOrNull(row.legal_name) ?? "Unnamed person",
        detail: "Profile photo",
      });
    }
    return { map, loaded: await mapFormUploads(restClient, bucket, map) };
  }

  // Staff resumes and voice notes: one row per object, on the candidate it was added to.
  const { data, error } = await restClient
    .from("application_attachments")
    .select("storage_path, applications(full_name, stage)")
    .eq("bucket", bucket)
    .limit(1000);

  if (error) {
    console.error("[files] attachment lookup failed:", error.message);
    return { map, loaded: false };
  }

  for (const entry of data ?? []) {
    const row = asRecord(entry);
    const path = stringOrNull(row.storage_path);
    if (!path) continue;

    const application = asRecord(
      Array.isArray(row.applications) ? row.applications[0] : row.applications
    );

    map.set(path, {
      label: stringOrNull(application.full_name) ?? "Unnamed applicant",
      detail: [
        bucketInfo(bucket)?.label ?? "Staff upload",
        stringOrNull(application.stage) ? stageLabel(String(application.stage)) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return { map, loaded: true };
}

/**
 * The candidate a stored object belongs to, read before it is removed.
 *
 * A trail row that only names a storage key cannot answer "whose file went";
 * after the delete and the unlink there is nothing left to ask, so this runs
 * first and against the one path rather than the whole bucket.
 *
 * A profile photo is owned by the person, not by an application, so it answers
 * with `personId` and leaves `applicationId` null — the trail must not file a
 * person's id under a column that says application.
 */
async function fileOwner(
  restClient: ServerClient,
  bucket: BucketKey,
  path: string
): Promise<{ name: string; applicationId: string | null; personId: string | null } | null> {
  if (bucket === "candidate-cvs") {
    const { data } = await restClient
      .from("applications")
      .select("id, full_name")
      .eq("cv_file_path", path)
      .maybeSingle();

    const row = asRecord(data);
    if (row.id) {
      return {
        name: stringOrNull(row.full_name) ?? "Unnamed applicant",
        applicationId: String(row.id),
        personId: null,
      };
    }
    return formUploadOwner(restClient, bucket, path);
  }

  if (bucket === "candidate-videos") {
    const { data } = await restClient
      .from("candidate_responses")
      .select("candidate_attempts(applications(id, full_name))")
      .eq("video_path", path)
      .maybeSingle();

    const embedded = asRecord(data);
    const attempt = asRecord(
      Array.isArray(embedded.candidate_attempts) ? embedded.candidate_attempts[0] : embedded.candidate_attempts
    );
    const application = asRecord(
      Array.isArray(attempt.applications) ? attempt.applications[0] : attempt.applications
    );

    return application.id
      ? {
          name: stringOrNull(application.full_name) ?? "Unnamed applicant",
          applicationId: String(application.id),
          personId: null,
        }
      : null;
  }

  // The person spine. `person_profiles` is 043's table, so on a database that has
  // not had it applied this read simply finds nothing and the trail says so.
  if (bucket === "candidate-photos") {
    const { data } = await restClient
      .from("person_profiles")
      .select("id, legal_name")
      .eq("photo_path", path)
      .maybeSingle();

    const row = asRecord(data);
    if (row.id) {
      return {
        name: stringOrNull(row.legal_name) ?? "Unnamed person",
        applicationId: null,
        personId: String(row.id),
      };
    }
    return formUploadOwner(restClient, bucket, path);
  }

  const { data } = await restClient
    .from("application_attachments")
    .select("application_id, applications(full_name)")
    .eq("storage_path", path)
    .maybeSingle();

  const row = asRecord(data);
  if (!row.application_id) return null;

  const application = asRecord(Array.isArray(row.applications) ? row.applications[0] : row.applications);
  return {
    name: stringOrNull(application.full_name) ?? "Unnamed applicant",
    applicationId: String(row.application_id),
    personId: null,
  };
}

/**
 * The applicant a form upload belongs to.
 *
 * A public form's file names its applicant through `application_form_files`
 * rather than through a column on the application, so the column reads above
 * find nothing for a form-only byte. The trail must still name the applicant:
 * "no candidate record pointing at it" would be false while the ledger row
 * points at one.
 */
async function formUploadOwner(
  restClient: ServerClient,
  bucket: BucketKey,
  path: string
): Promise<{ name: string; applicationId: string | null; personId: string | null } | null> {
  if (bucket !== "candidate-cvs" && bucket !== "candidate-photos") return null;

  const { data, error } = await restClient
    .from("application_form_files")
    .select("application_id, applications(id, full_name)")
    .eq("bucket", bucket)
    .eq("storage_path", path)
    .limit(1);

  // A missing 044 ledger cannot name anybody.
  if (error) return null;

  const row = asRecord((data ?? [])[0]);
  const application = asRecord(
    Array.isArray(row.applications) ? row.applications[0] : row.applications
  );
  if (!application.id) return null;

  return {
    name: stringOrNull(application.full_name) ?? "Unnamed applicant",
    applicationId: String(application.id),
    personId: null,
  };
}

/**
 * Writes the delete into `settings_audit_log`.
 *
 * Returns a note for the UI when that write is refused: the file is already
 * gone, so the delete cannot be rolled back and must not be reported as though
 * the record had been kept.
 */
async function recordDeletion(
  restClient: ServerClient,
  authUserId: string,
  bucket: BucketKey,
  path: string,
  before: { bytes: number | null; mimeType: string | null }
): Promise<string | null> {
  const { data: profile } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  const { error } = await restClient.from("settings_audit_log").insert({
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

/**
 * Deletes the form ledger rows that name a stored object.
 *
 * A form field keeps its byte in the same bucket as an application's CV or a
 * person's photo, but names it in its own ledger rather than a column on either
 * record, so the column clear below cannot reach it. A ledger row left behind
 * would offer a download of an object that is gone.
 */
async function deleteFormUploadRows(
  restClient: ServerClient,
  bucket: BucketKey,
  path: string
): Promise<string | null> {
  if (bucket !== "candidate-cvs" && bucket !== "candidate-photos") return null;

  const { error } = await restClient
    .from("application_form_files")
    .delete()
    .eq("bucket", bucket)
    .eq("storage_path", path);

  if (!error) return null;
  // Without 044 there are no form rows to leave behind.
  if (isMissingSchemaError(error)) return null;

  console.error("[files] form upload unlink failed:", error.message);
  return "The file was deleted, but a form upload record still names it.";
}

/**
 * Clears the database pointer to a storage key that no longer resolves.
 *
 * Deleting the object is only half of deletion: a row still naming it offers a
 * download that 404s, so the record would promise a file that is gone. Every
 * bucket in this portal is now referenced by a table, so every one of them can be
 * unlinked here — a CV or a pitch has its column cleared, a profile photo clears
 * its column together with the mime that described it, and a staff upload loses
 * the attachment row that existed only to name it. A form field's byte is named
 * by its own ledger row, which is deleted alongside whichever column it shares a
 * bucket with.
 */
async function unlinkReference(
  restClient: ServerClient,
  bucket: BucketKey,
  path: string
): Promise<string | null> {
  if (bucket === "resumes" || bucket === "candidate-audio") {
    const { count } = await restClient
      .from("application_attachments")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", path);
    if (!count) return null;

    const { data, error } = await restClient
      .from("application_attachments")
      .delete()
      .eq("storage_path", path)
      .select("id");

    if (error || (data?.length ?? 0) < count) {
      console.error("[files] attachment unlink failed:", error?.message);
      return `The file was deleted, but ${count} attachment record${count === 1 ? "" : "s"} still name${count === 1 ? "s" : ""} it — open the candidate to remove them.`;
    }
    return null;
  }

  const target =
    bucket === "candidate-cvs"
      ? { table: "applications", column: "cv_file_path", clear: { cv_file_path: null } }
      : bucket === "candidate-videos"
        ? { table: "candidate_responses", column: "video_path", clear: { video_path: null } }
        : bucket === "candidate-photos"
          ? {
              table: "person_profiles",
              column: "photo_path",
              // The mime travels with the byte. Clearing only the path would leave
              // the profile describing an image type for a file that is gone.
              clear: { photo_path: null, photo_mime: null },
            }
          : null;
  if (!target) return null;

  // A form field's byte is named by its own ledger row rather than by the
  // column below, and the column may name nothing at all: a form-only file has
  // no `cv_file_path` to clear. The ledger is cleared first so it happens even
  // when the column read finds no row.
  const formNote = await deleteFormUploadRows(restClient, bucket, path);

  const { count } = await restClient
    .from(target.table)
    .select("id", { count: "exact", head: true })
    .eq(target.column, path);
  if (!count) return formNote;

  const { data, error } = await restClient
    .from(target.table)
    .update(target.clear)
    .eq(target.column, path)
    .select("id");

  if (error || (data?.length ?? 0) < count) {
    console.error("[files] reference unlink failed:", target.table, error?.message);
    return `The file was deleted, but ${count} record${count === 1 ? "" : "s"} still name${count === 1 ? "s" : ""} it — open the candidate to clear the link.`;
  }

  return formNote;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
