"use server";

import { revalidatePath } from "next/cache";
import type { RestClient } from "@/lib/rest/client";
import { createServerRestClient } from "@/lib/data-api/server";
import { getFileStore } from "@/lib/files/store";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import {
  CvExtractionError,
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";
import { cvContentError } from "@/modules/careers/cv-rules";
import { readApplicationCvPath } from "@/infrastructure/repositories/application";

export interface CvReadResult {
  ok: boolean;
  error?: string;
  /** What landed, in the words the panel prints. */
  note?: string;
  characters?: number;
  /**
   * Set when the refusal is only that the record already holds text, so the
   * control can offer Replace without matching on the wording of a message.
   */
  needsReplace?: boolean;
}

/** The private bucket the career site writes applicant CVs into. */
const CV_RECORD_BUCKET = "candidate-cvs";

/** The formats the parser can read text out of; a voice note is not a CV. */
const CV_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

/**
 * The floor the screening engine itself uses: below this many characters there
 * is nothing to send a model, so the record is left as it was rather than
 * holding a file name the engine would still refuse.
 */
const MIN_CV_CHARS = 40;

function typeFor(fileName: string, declared: string | null): string {
  if (declared && CV_TYPES.has(declared)) return declared;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "txt" || ext === "md") return "text/plain";
  return declared ?? "";
}

function withCommas(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * A stored object is only worth parsing if it is still the document its name
 * claims. Three live records hold a 9 KB web page saved under a `.pdf` name, and
 * pdf.js answers that with "Invalid PDF structure" — a sentence about a broken
 * tool when the truth is that no CV was ever uploaded. The same rule the public
 * upload applies is asked here, so the two doors cannot disagree.
 */
function mislabelledFile(buffer: Buffer, mime: string): string | null {
  return cvContentError(buffer.subarray(0, 8), mime);
}

/**
 * Reads an attached CV file into `applications.cv_text`.
 *
 * A CV attached by staff lands in the `resumes` bucket with a row in
 * `application_attachments`, and nothing else looks at it: the screening engine
 * reads `cv_text` and falls back to `cv_file_path`, which only ever names the
 * `candidate-cvs` object the career site wrote. So the "Attach a CV" button put a
 * file on the record that the record could not be screened against — which is
 * exactly the dead end a hand-recorded candidate sits in until someone attaches
 * their CV.
 *
 * Storing the parsed text rather than a path keeps the two buckets out of it:
 * the engine then reads a staff upload the same way it reads an applicant's own.
 *
 * The write replaces nothing unless asked to. Text the candidate typed or whose
 * CV the site parsed is theirs, and quietly overwriting it with a file a
 * recruiter dropped in would be the record losing a version.
 */
export async function readAttachmentAsCv(input: {
  applicationId: string;
  attachmentId: string;
  replace?: boolean;
}): Promise<CvReadResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "Reading a CV into a record needs the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();

  // Both halves are read through RLS first: the file has to belong to this
  // record, and the record has to be in this recruiter's pipeline.
  const { data: file } = await restClient
    .from("application_attachments")
    .select("id, application_id, bucket, storage_path, file_name, mime_type")
    .eq("id", input.attachmentId)
    .maybeSingle();

  if (!file || String(file.application_id) !== input.applicationId) {
    return { ok: false, error: "That file is no longer attached to this candidate." };
  }

  return storeCvText(restClient, {
    applicationId: input.applicationId,
    replace: input.replace,
    source: {
      bucket: String(file.bucket),
      path: String(file.storage_path),
      fileName: String(file.file_name ?? "the file"),
      declaredMime: (file.mime_type as string | null) ?? null,
      origin: `attachment ${String(file.id)}`,
    },
  });
}

/**
 * Reads the CV the candidate themselves submitted into `applications.cv_text`.
 *
 * The career site parses the upload on apply and stores whatever came out. When
 * that parse fails — a download blip, a format the parser learned later — the
 * row keeps `cv_file_path` and no text, and only the screening engine can still
 * reach the file, because it alone falls back to storage. Every other reader of
 * the record (the profile's CV panel, the assistant, anything that quotes the CV)
 * then shows an empty section with a file sitting right there.
 */
export async function readRecordCv(input: {
  applicationId: string;
  replace?: boolean;
}): Promise<CvReadResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "Reading a CV into a record needs the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();

  const found = await readApplicationCvPath(restClient, input.applicationId);

  if (!found.ok || !found.application) {
    return { ok: false, error: "This candidate record is no longer in your pipeline." };
  }

  const path = found.application.cv_file_path ?? "";
  if (!path) {
    return { ok: false, error: "No CV file is stored on this record — attach one first." };
  }

  return storeCvText(restClient, {
    applicationId: input.applicationId,
    replace: input.replace,
    source: {
      bucket: CV_RECORD_BUCKET,
      path,
      fileName: path.split("/").pop() ?? path,
      declaredMime: null,
      origin: "the CV on the record",
    },
  });
}

interface CvReadSource {
  bucket: string;
  path: string;
  fileName: string;
  declaredMime: string | null;
  /** How the trail names where the text came from. */
  origin: string;
}

/**
 * The single body behind both doors: permission check, the replace refusal,
 * download, parse, write, trail and revalidation. Two ways in, one set of rules.
 */
async function storeCvText(
  restClient: RestClient,
  input: {
    applicationId: string;
    replace?: boolean;
    source: CvReadSource;
  }
): Promise<CvReadResult> {
  const { data: application } = await restClient
    .from("applications")
    .select("id, full_name, cv_text")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) {
    return { ok: false, error: "This candidate record is no longer in your pipeline." };
  }

  const mime = typeFor(input.source.fileName, input.source.declaredMime);
  if (!CV_TYPES.has(mime)) {
    return { ok: false, error: "Only a PDF, Word document or text file can be read as a CV." };
  }

  const held = ((application.cv_text as string | null) ?? "").trim();
  if (held.length >= MIN_CV_CHARS && !input.replace) {
    return {
      ok: false,
      needsReplace: true,
      error: `${application.full_name ?? "This candidate"} already has CV text on file. Replace it with this file?`,
    };
  }

  const files = await getFileStore();
  const { bytes, error: downloadError } = await files.download({
    bucket: input.source.bucket,
    path: input.source.path,
  });

  if (downloadError || !bytes) {
    return {
      ok: false,
      error: `The stored file could not be read${
        /not found/i.test(downloadError ?? "") ? " — it is no longer in storage" : ""
      }.`,
    };
  }

  let text: string;
  const buffer = Buffer.from(bytes);
  const mislabelled = mislabelledFile(buffer, mime);
  if (mislabelled) {
    return { ok: false, error: mislabelled };
  }
  try {
    const extracted = await extractCvText(buffer, mime);
    text = extracted.text.trim();
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof CvExtractionError ? error.message : describeExtractionFailure(error),
    };
  }

  if (text.length < MIN_CV_CHARS) {
    return {
      ok: false,
      error:
        "No readable text came out of that file — a scanned PDF has no text layer. Type the CV into the record instead.",
    };
  }

  const { data: written, error: updateError } = await restClient
    .from("applications")
    .update({ cv_text: text, updated_at: new Date().toISOString() })
    .eq("id", input.applicationId)
    .select("id")
    .maybeSingle();

  // PostgREST reports a write an RLS policy refused as a success with no rows,
  // so the read-back is what proves the record holds the text.
  if (updateError || !written) {
    return {
      ok: false,
      error: updateError?.message ?? "The text was read but the record would not take it.",
    };
  }

  const replacing = held.length >= MIN_CV_CHARS;

  await recordActivity({
    area: "candidates",
    action: "cv_read",
    entity: "application",
    entityId: input.applicationId,
    summary: `Read ${withCommas(text.length)} characters of CV text into ${
      application.full_name ?? "a candidate"
    }'s record from ${input.source.origin}${
      replacing ? " — replacing the text already on file" : ""
    }`,
    detail: {
      source: input.source.origin,
      bucket: input.source.bucket,
      storage_path: input.source.path,
      file_name: input.source.fileName.slice(0, 80),
      mime_type: mime,
      characters: text.length,
      replaced: held.slice(0, 120),
    },
  });

  // The dossier shows the CV text, the opening's applicant list carries the
  // screening columns this unlocks, and the table counts who can be screened.
  revalidatePath("/candidates");
  revalidatePath("/jobs");

  return {
    ok: true,
    characters: text.length,
    note: `Read ${withCommas(text.length)} characters into the record — AI screening can run now.`,
  };
}
