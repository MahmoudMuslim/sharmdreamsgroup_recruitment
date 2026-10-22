import { getAnonRestClient } from "@/lib/data-api/anon";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import { describeAboutFailure, writeAboutMe } from "@/modules/careers/about-me";
import {
  CV_MAX_BYTES,
  CV_TYPE_ERROR,
  cvContentError,
  cvSizeError,
  isAcceptedCvType,
  profileLink,
} from "@/modules/careers/cv-rules";
import {
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";
import {
  isWorthExtracting,
  readProfileFromUrl,
} from "@/modules/sourcing/infrastructure/profile-reader";

/**
 * Public "write my About me from my LinkedIn link or my CV" endpoint.
 *
 * The apply form asks a candidate to describe themselves, and the two things they
 * have already got — a profile link and the CV in their downloads folder — describe
 * them. This reads whichever the form holds and puts them into the box, so the
 * applicant edits a draft instead of starting from an empty field.
 *
 * It reads, and nothing else. No row is written and no file is stored: the upload
 * route owns storage, and a candidate who presses this and then writes their own
 * lines should not leave a CV sitting in a bucket with no application on it. What
 * comes back is a draft in a field they can still change, and it is the field they
 * submit that reaches the hiring team.
 *
 * The link is fetched from here, so it is untrusted input even though the form
 * calls it optional: only a linkedin.com or linkedin.cn address is accepted, and
 * `readProfileFromUrl` refuses private hosts, resolves the name and re-checks every
 * redirect before one byte is requested. LinkedIn answers an automated request with
 * a login wall rather than the profile, so a blocked read is reported as that — and
 * pointed at the two doors this form actually has, the CV and the candidate's own
 * typing. The reader's own sentence names the sourcing console's buttons, so it is
 * not forwarded here.
 *
 * Nothing a model returns reaches the browser unwritten-over: `writeAboutMe` keeps
 * the prose inside the field's own limits and refuses a box too short to be an
 * answer, and the candidate's own words are never replaced — that is the form's job.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refused(error: string, hint?: string, status = 422): Response {
  return Response.json({ error, ...(hint ? { hint } : {}) }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // A file here is optional — the link leg never carries bytes — so this bounds
  // only the CV leg, with the ceiling `refused(cvSizeError(), …, 413)` below uses.
  const oversize = oversizeUploadResponse(request, CV_MAX_BYTES);
  if (oversize) return oversize;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refused("Could not read that request.", undefined, 400);
  }

  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || !UUID.test(jobId)) {
    return refused("Unknown role.", undefined, 400);
  }

  const linkEntry = form.get("link");
  const fileEntry = form.get("file");
  const typedLink = typeof linkEntry === "string" ? linkEntry.trim() : "";
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  // Checked before anything costs a query or a model call.
  const link = typedLink ? profileLink(typedLink) : null;
  if (typedLink && !link) {
    return refused(
      "Only a linkedin.com profile link can be read from here.",
      "Check the link, or clear that field and press the button again to choose your CV file.",
      400
    );
  }
  if (!link && !file) {
    return refused(
      "Nothing to write from yet.",
      "Add your LinkedIn link here, or press that button again and choose your CV file.",
      400
    );
  }

  const { data: job } = await getAnonRestClient()
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  // Same guard the upload and prefill routes make: a draft or closed role has no
  // form to fill, so this endpoint is not a way to spend model calls for nothing.
  if (!job) {
    return refused(
      "This role is no longer accepting applications.",
      undefined,
      404
    );
  }

  const parts: string[] = [];
  const sources: string[] = [];
  const misses: string[] = [];
  let linkMissed = false;

  if (link) {
    let read: Awaited<ReturnType<typeof readProfileFromUrl>> | null = null;
    try {
      read = await readProfileFromUrl(link);
    } catch {
      read = null;
    }
    if (read && isWorthExtracting(read)) {
      parts.push(`LINKEDIN PROFILE — ${read.host}\n${read.text}`);
      sources.push("LINKEDIN");
    } else {
      // The reader's own sentence names the doors of the sourcing console —
      // "Pasted text" and "Upload export" are not on this form. A candidate told
      // to look for them is sent to a page that does not exist, so this door
      // says what it can offer instead.
      misses.push(
        "LinkedIn shows a profile only to signed-in members, so an automated read of that link comes back as a login page rather than your profile."
      );
      linkMissed = true;
    }
  }

  if (file) {
    if (!isAcceptedCvType(file.type)) {
      return refused(CV_TYPE_ERROR, undefined, 415);
    }
    if (file.size > CV_MAX_BYTES) {
      return refused(cvSizeError(), undefined, 413);
    }

    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const contentError = cvContentError(head, file.type);
    if (contentError) return refused(contentError, undefined, 415);

    try {
      const extracted = await extractCvText(Buffer.from(await file.arrayBuffer()), file.type);
      if (extracted.empty) {
        misses.push(
          "That file holds no readable text — it may be a scan or a photo. Write your About me yourself, or attach the PDF or Word file itself."
        );
      } else {
        parts.push(`CV — ${file.name}\n${extracted.text}`);
        sources.push("CV");
      }
    } catch (error) {
      misses.push(describeExtractionFailure(error));
    }
  }

  if (!parts.length) {
    return refused(
      misses.join(" ") || "Nothing there could be read.",
      linkMissed
        ? "Clear the link field and press the button again to choose your CV file, or write a few lines about yourself here."
        : "Write a few lines about yourself here, or attach a different CV.",
    );
  }

  try {
    const aboutMe = await writeAboutMe(parts.join("\n\n---\n\n"));
    if (!aboutMe) {
      return refused(
        "We could not write an About me from that. Please write a few lines yourself."
      );
    }
    return Response.json(
      { aboutMe, sources },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "[careers] About me write failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return Response.json({ error: describeAboutFailure(error) }, { status: 500 });
  }
}
