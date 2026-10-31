import { readPublishedOpening } from "@/infrastructure/repositories/jobOpening";
import { getAnonRestClient } from "@/lib/data-api/anon";
import { getFileStore } from "@/lib/files/store";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import {
  CV_MAX_BYTES,
  CV_TYPE_ERROR,
  cvContentError,
  cvSizeError,
  isAcceptedCvType,
} from "@/modules/careers/cv-rules";

/**
 * Public CV upload endpoint.
 *
 * Separate from the application action because the file has to travel as
 * multipart form data, which a Server Action's serialised arguments do not
 * carry. The two-step flow (upload, then submit) means an orphaned file is
 * possible if the second step fails; that is preferable to losing the file
 * entirely, and orphans are invisible to staff until an application references
 * them.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  // Refused before the body is buffered, in the same words the check below uses
  // (`cvSizeError()`), so a candidate cannot tell which of the two caught them.
  const oversize = oversizeUploadResponse(request, CV_MAX_BYTES);
  if (oversize) return oversize;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const fileEntry = form.get("file");
  const jobId = form.get("jobId");

  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  if (typeof jobId !== "string" || !jobId) {
    return Response.json({ error: "Missing job reference." }, { status: 400 });
  }

  // The shape is checked before the read: `id = 'nonexistent'` raises 22P02,
  // which would report a permanent refusal as a read that failed just now.
  if (!UUID.test(jobId)) {
    return Response.json({ error: "This role is no longer accepting applications." }, { status: 404 });
  }

  // Re-validated server-side: a client MIME type proves nothing.
  if (!isAcceptedCvType(fileEntry.type)) {
    return Response.json({ error: CV_TYPE_ERROR }, { status: 415 });
  }

  // The declared type only follows the file's name, so the bytes are asked as
  // well — three live applications hold the same web page saved as `CV.pdf`,
  // stored because nothing checked what the file actually contained.
  const head = new Uint8Array(await fileEntry.slice(0, 8).arrayBuffer());
  const contentError = cvContentError(head, fileEntry.type);
  if (contentError) {
    return Response.json({ error: contentError }, { status: 415 });
  }

  if (fileEntry.size > CV_MAX_BYTES) {
    return Response.json({ error: cvSizeError() }, { status: 413 });
  }

  const restClient = getAnonRestClient();

  // Only open roles accept applications, so an upload for a draft or closed
  // role is rejected here rather than after the file is already stored. A read
  // that was refused is not an answer about the role, so it does not borrow one.
  const opening = await readPublishedOpening(restClient, jobId);

  if (!opening.ok) {
    if (opening.reason === "read_failed") {
      return Response.json(
        { error: "This role could not be checked right now. Try again in a moment." },
        { status: 503 }
      );
    }
    return Response.json(
      { error: "This role is no longer accepting applications." },
      { status: 404 }
    );
  }

  // The stored name never includes the client's path — only a sanitised leaf.
  const leaf = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "cv";
  const path = `applications/${jobId}/${crypto.randomUUID()}-${leaf}`;

  const files = await getFileStore();
  const { error } = await files.upload({
    bucket: "candidate-cvs",
    path,
    body: fileEntry,
    contentType: fileEntry.type,
    upsert: false,
  });

  if (error) {
    return Response.json(
      { error: "We could not attach your CV. Try pasting your CV text instead." },
      { status: 500 }
    );
  }

  return Response.json({ path });
}