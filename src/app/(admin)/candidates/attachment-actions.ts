"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";

export type AttachmentResult = { ok: true; note?: string } | { ok: false; error: string };

/**
 * Removes one file a recruiter attached — the stored object and the row that
 * named it.
 *
 * Both halves have to go: a row pointing at a deleted object offers a download
 * that 404s, and an object no row names is invisible in the dossier and shows up
 * in the File Manager as "not linked to a record". So when storage reports the
 * object is already missing, the row is still removed and that is what the
 * recruiter is told, rather than a delete that quietly did nothing.
 */
export async function deleteAttachment(attachmentId: string): Promise<AttachmentResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "Removing an attachment needs the Edit candidates permission." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("application_attachments")
    .select("bucket, storage_path, file_name, application_id")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!row) return { ok: false, error: "That attachment is no longer on this candidate." };

  const { error: storageError } = await supabase.storage
    .from(row.bucket)
    .remove([row.storage_path]);

  // A bulk remove reports the object missing rather than refusing quietly, so
  // "not found" counts as the file being gone already.
  const alreadyGone = !!storageError && /not found/i.test(storageError.message);
  if (storageError && !alreadyGone) {
    console.error("[attachments] delete refused:", row.bucket, storageError.message);
    return { ok: false, error: `Storage refused the delete: ${storageError.message}` };
  }

  const { error: rowError } = await supabase
    .from("application_attachments")
    .delete()
    .eq("id", attachmentId);

  if (rowError) {
    console.error("[attachments] row delete refused:", rowError.message);
    return {
      ok: false,
      error: storageError
        ? "The file is already gone, but its record could not be removed either."
        : "The file was deleted, but its record could not be removed — open the File Manager to clear the link.",
    };
  }

  await recordActivity({
    area: "files",
    action: "attachment_delete",
    entity: "attachment",
    entityId: attachmentId,
    summary: `Removed the attachment “${row.file_name ?? row.storage_path}”${
      alreadyGone ? " — the stored file was already missing, so only its record went" : ""
    }`,
    detail: {
      file_name: row.file_name,
      bucket: row.bucket,
      application_id: row.application_id,
      storage_was_already_gone: alreadyGone,
    },
  });

  return {
    ok: true,
    ...(alreadyGone ? { note: "That file was already missing from storage, so only its record was removed." } : {}),
  };
}
