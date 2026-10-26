import { getAnonRestClient } from "@/lib/data-api/anon";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import {
  CV_MAX_BYTES,
  CV_TYPE_ERROR,
  cvContentError,
  cvSizeError,
  isAcceptedCvType,
} from "@/modules/careers/cv-rules";
import {
  describeFormAnswersFailure,
  readCvFormAnswers,
} from "@/modules/careers/cv-form-answers";
import { resolveFormForJob } from "@/modules/form-builder/application/publicForm";
import { acceptCvAnswers, cvAskList } from "@/modules/form-builder/domain/cvAnswers";
import {
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";

/**
 * Public "read the whole form out of my CV" endpoint, for an authored application.
 *
 * The built-in apply form could only ever fill three fields, because three is all
 * it asks. A form an author built asks twenty, and a CV prints most of them: the
 * address, the languages, the notice period, the current salary, the LinkedIn line.
 * This takes the file the candidate is about to attach, reads it once, and offers
 * back the answers the form's own fields accept.
 *
 * The shape of the reply is decided by the layout, never by the request. `skip`
 * only ever removes questions from the ask list — it names the fields the candidate
 * has already answered, so a second press on a half-filled page costs fewer tokens
 * rather than more. Anything the client could invent about a field (its options,
 * its bounds, its type) is re-read from the published layout here, because the
 * browser was never shown any of it.
 *
 * Deliberately stateless: the file is read and dropped, never stored. The upload
 * route owns storage, and a candidate who presses this button and then changes
 * their mind should not leave a CV sitting in a bucket with no application on it.
 * Nothing is written to the application, and no proposed answer reaches the
 * browser until `acceptCvAnswers` has run it through the field that asks for it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  // Before the buffer, and before the model call this door pays for: an oversize
  // CV must cost nothing at all. The message matches `cvSizeError()` below.
  const oversize = oversizeUploadResponse(request, CV_MAX_BYTES);
  if (oversize) return oversize;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read that file." }, { status: 400 });
  }

  const fileEntry = form.get("file");
  const jobId = form.get("jobId");

  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  // Validated before anything costs a query or a model call: the id arrives from
  // a public page and is only ever used to look one published role up.
  if (typeof jobId !== "string" || !UUID.test(jobId)) {
    return Response.json({ error: "Unknown role." }, { status: 400 });
  }

  if (!isAcceptedCvType(fileEntry.type)) {
    return Response.json({ error: CV_TYPE_ERROR }, { status: 415 });
  }

  // Asked of the bytes, as on the upload route: a page saved as `CV.pdf` has a
  // valid declared type and no CV in it, and reading it would cost a model call.
  const head = new Uint8Array(await fileEntry.slice(0, 8).arrayBuffer());
  const contentError = cvContentError(head, fileEntry.type);
  if (contentError) {
    return Response.json({ error: contentError }, { status: 415 });
  }

  if (fileEntry.size > CV_MAX_BYTES) {
    return Response.json({ error: cvSizeError() }, { status: 413 });
  }

  const restClient = getAnonRestClient();

  // Same guard the upload route makes: a draft or closed role has no form to
  // fill, so this endpoint is not a way to spend model calls for nothing.
  const { data: job } = await restClient
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!job) {
    return Response.json(
      { error: "This role is no longer accepting applications." },
      { status: 404 }
    );
  }

  // The questions come from the layout the candidate's page was built from, read
  // again here. A role that fell back to the built-in wizard has no authored
  // fields to fill, and that wizard already has its own three-field door.
  const layout = await resolveFormForJob(jobId);
  if ("fallback" in layout) {
    return Response.json(
      { error: "This role does not use an application form to fill in." },
      { status: 404 }
    );
  }

  const fields = layout.fields.map((entry) => entry.field);
  const skip = form.getAll("skip").filter((entry): entry is string => typeof entry === "string");

  const asks = cvAskList(fields, skip);
  if (asks.length === 0) {
    return Response.json({ answers: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  let cvText: string;
  try {
    const extracted = await extractCvText(
      Buffer.from(await fileEntry.arrayBuffer()),
      fileEntry.type
    );

    if (extracted.empty) {
      return Response.json(
        {
          error:
            "That file holds no readable text — it may be a scan or a photo. Fill the fields yourself, or paste your CV as text.",
        },
        { status: 422 }
      );
    }

    cvText = extracted.text;
  } catch (error) {
    return Response.json({ error: describeExtractionFailure(error) }, { status: 422 });
  }

  try {
    const proposals = await readCvFormAnswers(cvText, asks);
    const answers = acceptCvAnswers(fields, proposals);
    return Response.json({ answers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "[careers] CV form read failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return Response.json({ error: describeFormAnswersFailure(error) }, { status: 500 });
  }
}
