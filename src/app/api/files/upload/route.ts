import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFileStore } from "@/lib/files/store";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import { readAttachmentAsCv } from "@/app/(admin)/candidates/cv-actions";
import { cvContentError } from "@/modules/careers/cv-rules";
import {
  ATTACHMENT_RULES,
  attachmentPath,
  attachmentRule,
  isApplicationId,
} from "@/modules/careers/attachment-rules";

/**
 * Stores a file a recruiter attaches to a candidate record.
 *
 * Multipart cannot travel through a Server Action's serialised arguments, which
 * is why the career site's CV upload is a route too. Everything the bucket will
 * enforce is checked first, so an oversize or wrong-typed file reads as the
 * limit in words rather than as a storage error code.
 *
 * The row that owns the object is written in the same call: a stored file no
 * record names is invisible in the candidate's dossier and untraceable in the
 * File Manager, so a failed insert takes the object straight back out.
 */
export async function POST(request: NextRequest) {
  // The ceiling only becomes bucket-specific once the body is parsed, so this
  // first line uses the largest rule (`candidate-audio`, 20 MB): a body bigger
  // than that cannot satisfy any bucket, and the check below still applies the
  // one the caller actually asked for.
  const oversize = oversizeUploadResponse(
    request,
    Math.max(...ATTACHMENT_RULES.map((rule) => rule.maxBytes))
  );
  if (oversize) return oversize;

  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return NextResponse.json({ error: "Sign in as staff to attach files." }, { status: 401 });
  }

  if (!(await hasPermissionForUser("candidates.write"))) {
    return NextResponse.json(
      { error: "Attaching a file needs the Edit candidates permission." },
      { status: 403 }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });

  const file = form.get("file");
  const applicationId = form.get("applicationId");
  const bucket = form.get("bucket");
  const rule = attachmentRule(typeof bucket === "string" ? bucket : null);

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (!rule) {
    return NextResponse.json(
      { error: `Attach into one of: ${ATTACHMENT_RULES.map((each) => each.bucket).join(", ")}.` },
      { status: 400 }
    );
  }
  if (!isApplicationId(applicationId)) {
    return NextResponse.json({ error: "Missing candidate reference." }, { status: 400 });
  }

  // Re-validated server-side: a client MIME type proves nothing, and the bucket
  // only ever accepts the formats it was configured with.
  if (!rule.allowedMimeTypes.includes(file.type)) {
    return NextResponse.json(
      { error: `That bucket accepts only ${rule.hint.replace(/\.$/, "")}.` },
      { status: 415 }
    );
  }
  if (rule.bucket === "resumes") {
    // The same bytes are asked here as on the public upload, or a recruiter could
    // file the identical fake CV that the career site now refuses.
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const contentError = cvContentError(head, file.type);
    if (contentError) {
      return NextResponse.json({ error: contentError }, { status: 415 });
    }
  }
  if (file.size > rule.maxBytes) {
    return NextResponse.json(
      { error: `That file is larger than ${Math.round(rule.maxBytes / (1024 * 1024))} MB.` },
      { status: 413 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const files = await getFileStore();

  // The parent record is read through RLS first, so a recruiter cannot attach a
  // file to a candidate sitting in another tenant's pipeline.
  const { data: application } = await supabase
    .from("applications")
    .select("id, full_name")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) {
    return NextResponse.json(
      { error: "This candidate record is no longer in your pipeline." },
      { status: 404 }
    );
  }

  const path = attachmentPath(applicationId, file.name);

  const { error: uploadError } = await files.upload({
    bucket: rule.bucket,
    path,
    body: file,
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    console.error("[uploads] storage refused:", rule.bucket, uploadError);
    return NextResponse.json(
      { error: `Storage refused that file. ${rule.hint}` },
      { status: 500 }
    );
  }

  // The uploader is named from their own profile row, so the candidate record can
  // say who added a file months after they left the company.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", user.authUserId)
    .maybeSingle();

  const { data: attachment, error: insertError } = await supabase
    .from("application_attachments")
    .insert({
      application_id: applicationId,
      bucket: rule.bucket,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      bytes: file.size,
      uploaded_by: profile?.id ?? null,
    })
    .select("id, bucket, storage_path, file_name, mime_type, bytes, created_at")
    .maybeSingle();

  if (insertError || !attachment) {
    console.error("[uploads] attachment row refused:", insertError?.message);
    const { error: cleanupError } = await files.remove({ bucket: rule.bucket, paths: [path] });
    if (cleanupError) {
      console.error("[uploads] orphan left behind:", rule.bucket, path, cleanupError);
    }
    return NextResponse.json(
      {
        error: cleanupError
          ? "The file was stored but could not be recorded, and could not be removed again either."
          : "The file was stored but could not be recorded, so it has been taken back out.",
      },
      { status: 500 }
    );
  }

  await recordActivity({
    area: "files",
    action: "file_upload",
    entity: "attachment",
    entityId: String(attachment.id),
    summary: `Attached “${file.name.slice(0, 80)}” to ${application.full_name ?? "a candidate"}'s record`,
    detail: {
      application_id: applicationId,
      bucket: rule.bucket,
      storage_path: path,
      mime_type: file.type,
      bytes: file.size,
    },
  });

  // A CV a recruiter attaches is not what the screening engine reads: the engine
  // takes `applications.cv_text`, and `cv_file_path` only ever names the object
  // the career site wrote into `candidate-cvs`. So a document dropped into
  // `resumes` is parsed into the row in the same click, and the recruiter is
  // told which way it landed rather than left believing the file is screened.
  let cv: { state: "filled" | "kept" | "unreadable" | "none"; note?: string } = { state: "none" };
  if (rule.bucket === "resumes") {
    const read = await readAttachmentAsCv({
      applicationId: String(applicationId),
      attachmentId: String(attachment.id),
    });
    cv = read.ok
      ? { state: "filled", note: read.note }
      : read.needsReplace
        ? { state: "kept", note: "The record already holds CV text, so this file sits alongside it." }
        : { state: "unreadable", note: read.error };
  }

  return NextResponse.json({ ok: true, attachment, cv });
}
