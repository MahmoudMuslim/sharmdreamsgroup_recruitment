import { getServiceRestClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import {
  KINDS,
  headMatchesKind,
  kindRules,
  sanitiseFileName,
  type Kind,
} from "@/modules/form-builder/domain/field-types";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import {
  resolveFormForJob,
  type FormResolution,
} from "@/modules/form-builder/application/publicForm";
import type { FieldRow } from "@/modules/form-builder/domain/resolveLayout";

/**
 * The public upload for every `file` and `photo` field (spec §5, plan Task 11).
 *
 * One route, because the question a byte belongs to is decided by its field and
 * nothing else. The constraints come from the **published layout** read here —
 * the offered `kinds`, the kind's MIME list and its magic bytes, and the byte
 * ceiling — never from the request body. An applicant cannot widen a 5 MB photo
 * field by posting a different limit, and the browser's `Content-Type` only
 * chooses between two types the field already offers.
 *
 * The response is the ledger row's id and nothing else: a local object URL is
 * the browser's preview, and the submit door attaches this id after re-checking
 * that it is unattached, for this job, and for this field.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PHOTO_KINDS: readonly Kind[] = ["image"];
const MEGABYTE = 1024 * 1024;

function offeredKinds(field: FieldRow): Kind[] {
  if (field.type === "photo") return [...PHOTO_KINDS];
  const raw = field.config.kinds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (kind): kind is Kind =>
      typeof kind === "string" && (KINDS as readonly string[]).includes(kind),
  );
}

function ceilingFor(field: FieldRow, kinds: readonly Kind[]): number {
  const fieldCeiling = field.type === "photo" ? LIMITS.photo_bytes : LIMITS.file_bytes;
  const kindCeilings = kinds.map((kind) => kindRules(kind)?.maxBytes ?? fieldCeiling);
  return Math.min(fieldCeiling, ...kindCeilings);
}

/**
 * The kind(s) the head bytes actually match. Signed kinds are asked first: a
 * `text` kind matches anything by definition, so it must not out-vote an image
 * signature the author also offered.
 */
function matchedKinds(kinds: readonly Kind[], head: Uint8Array): Kind[] {
  const signed = kinds.filter((kind) => (kindRules(kind)?.magicBytes.length ?? 0) > 0);
  const matchedSigned = signed.filter((kind) => headMatchesKind(kind, head));
  if (matchedSigned.length > 0) return matchedSigned;
  return kinds.filter((kind) => headMatchesKind(kind, head));
}

/** The declared type only wins when the field already offers it; otherwise the kind's first. */
function storedMime(kinds: readonly Kind[], declared: string): string | null {
  const lowered = declared.trim().toLowerCase();
  for (const kind of kinds) {
    const rule = kindRules(kind);
    if (rule && lowered && rule.acceptedMimes.includes(lowered)) return lowered;
  }
  return kindRules(kinds[0])?.acceptedMimes[0] ?? null;
}

function fallbackReason(layout: FormResolution): string {
  return "fallback" in layout
    ? layout.reason
    : "This role's form cannot take an upload right now.";
}

export async function POST(request: Request): Promise<Response> {
  // The field is named in the multipart body, so the pre-buffer line can only
  // bound the largest ceiling any field has. The field's own, smaller ceiling is
  // checked once the body is parsed — a 5 MB photo field still refuses at 5 MB.
  const oversize = oversizeUploadResponse(request, LIMITS.file_bytes);
  if (oversize) return oversize;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const jobId = form.get("jobId");
  const fieldKey = form.get("fieldKey");
  const file = form.get("file");

  if (typeof jobId !== "string" || !UUID_PATTERN.test(jobId)) {
    return Response.json({ error: "Missing role reference." }, { status: 400 });
  }
  if (typeof fieldKey !== "string" || fieldKey.length === 0) {
    return Response.json({ error: "Missing question reference." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  const layout = await resolveFormForJob(jobId);
  if ("fallback" in layout) {
    return Response.json({ error: fallbackReason(layout) }, { status: 409 });
  }

  const field = layout.fields.find((entry) => entry.field.key === fieldKey)?.field;
  if (!field) {
    return Response.json(
      { error: "The form changed while this page was open. Reload it and attach the file again." },
      { status: 409 },
    );
  }
  if (field.type !== "file" && field.type !== "photo") {
    return Response.json({ error: "That question does not take a file." }, { status: 400 });
  }

  const kinds = offeredKinds(field);
  if (kinds.length === 0) {
    return Response.json(
      { error: "That question accepts no file type. The recruiters have been told." },
      { status: 409 },
    );
  }

  const maxBytes = ceilingFor(field, kinds);
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / MEGABYTE);
    return Response.json({ error: `That file is larger than ${mb} MB.` }, { status: 413 });
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const matched = matchedKinds(kinds, head);
  if (matched.length === 0) {
    return Response.json(
      { error: "That file is not one of the types this question accepts." },
      { status: 415 },
    );
  }

  const mime = storedMime(matched, file.type);
  const bucket = field.type === "photo" ? "candidate-photos" : "candidate-cvs";
  // Every kind a `file` field offers lands in `candidate-cvs`: it is the one
  // bucket the File Manager's ledger read names (§4), so an audio byte filed
  // under `candidate-audio` would report unlinked while a row did name it.
  const leaf = sanitiseFileName(file.name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  const path = `applications/${jobId}/${crypto.randomUUID()}-${leaf}`;

  const files = await getFileStore();
  const uploaded = await files.upload({
    bucket,
    path,
    body: file,
    contentType: mime ?? undefined,
    upsert: false,
  });
  if (!uploaded.ok) {
    console.error("[forms] the upload byte did not store:", uploaded.error);
    return Response.json(
      { error: "We could not attach that file. Try again, or send it another way." },
      { status: 500 },
    );
  }

  const restClient = getServiceRestClient();
  const { data, error } = await restClient
    .from("application_form_files")
    .insert({
      application_id: null,
      job_id: jobId,
      field_key: fieldKey,
      bucket,
      storage_path: path,
      mime,
      bytes: file.size,
    })
    .select("id")
    .single();

  if (error || !data) {
    // A byte with no ledger row could never be attached or swept, so it does not
    // stay. The row is written after the rename, never before it.
    await files.remove({ bucket, paths: [path] }).catch(() => undefined);
    console.error("[forms] the upload ledger row did not store:", error?.message);
    return Response.json(
      { error: "We could not attach that file. Try again, or send it another way." },
      { status: 500 },
    );
  }

  return Response.json(
    { uploadId: (data as { id: string }).id },
    { headers: { "cache-control": "no-store" } },
  );
}
