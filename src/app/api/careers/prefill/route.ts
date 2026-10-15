import { getSupabaseAnonClient } from "@/lib/supabase/anon";
import {
  CV_MAX_BYTES,
  CV_TYPE_ERROR,
  cvSizeError,
  isAcceptedCvType,
} from "@/modules/careers/cv-rules";
import { describeDetailsFailure, readCvDetails } from "@/modules/careers/cv-details";
import {
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";

/**
 * Public "read my details out of my CV" endpoint.
 *
 * The apply form asks for a name, an email and a phone number, and the CV the
 * candidate is about to attach already prints all three. This takes the file,
 * extracts its text the same way the submit path does, and asks the screening
 * chain for the applicant's own contact block — so the form arrives filled rather
 * than typed out.
 *
 * Deliberately stateless: the file is read and dropped, never stored. The upload
 * route owns storage, and a candidate who presses this button and then changes
 * their mind should not leave a CV sitting in a bucket with no application on it.
 *
 * Nothing is written to the application here, and nothing the model returns
 * reaches the browser unvalidated — see `readCvDetails`. The fields stay editable,
 * so the candidate is still the one confirming their own address.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
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

  if (fileEntry.size > CV_MAX_BYTES) {
    return Response.json({ error: cvSizeError() }, { status: 413 });
  }

  const supabase = getSupabaseAnonClient();

  // Same guard the upload route makes: a draft or closed role has no form to
  // fill, so this endpoint is not a way to spend model calls for nothing.
  const { data: job } = await supabase
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
    const details = await readCvDetails(cvText);
    return Response.json({ details }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "[careers] CV detail read failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return Response.json({ error: describeDetailsFailure(error) }, { status: 500 });
  }
}
