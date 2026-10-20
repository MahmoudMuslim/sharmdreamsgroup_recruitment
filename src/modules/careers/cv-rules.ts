/**
 * What the career site accepts from a candidate.
 *
 * The apply steps check before sending, the upload route checks before storing
 * and the prefill route checks before spending a model call on it. Those three
 * have to agree — a candidate whose file passes one gate and fails another reads
 * it as the site losing their CV — so the numbers live here once.
 */

export const CV_MAX_MB = 5;
export const CV_MAX_BYTES = CV_MAX_MB * 1024 * 1024;

/**
 * The shortest pasted CV that counts as a CV, when no file is attached.
 *
 * The submission action is what refuses a shorter one, so the step that asks
 * for the text quotes this number instead of keeping its own.
 */
export const CV_TEXT_MIN_CHARS = 40;

/** The most the "About you" box on the first step can hold. */
export const ABOUT_ME_MAX_CHARS = 1_200;

/**
 * The candidate's profile link, in the one form the rest of the app can use.
 *
 * A LinkedIn URL arrives with a campaign tag or a shared-from fragment
 * (`?trk=public_profile`), which is noise on a record a recruiter will read. Only
 * linkedin.com or linkedin.cn is accepted, because the field is labelled as that
 * link and a record that calls another site's page a LinkedIn profile would
 * mislead whoever reads it.
 *
 * Returns the cleaned link, or null for anything that is not one. The step, the
 * public reader and the submit action all ask this same function, so a link the
 * candidate was allowed to leave cannot be refused at the door — and it is pure,
 * so the browser can check it too.
 */
export function profileLink(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 300) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!/(^|\.)linkedin\.(com|cn)$/i.test(url.hostname)) return null;
  if (url.pathname === "/" || url.pathname.length < 2) return null;

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** `.doc` is accepted by the form and the bucket, but nothing parses it. */
export const CV_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export function isAcceptedCvType(mimeType: string): boolean {
  return (CV_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export const CV_TYPE_ERROR = "Attach a PDF, Word document or plain-text CV.";

export function cvSizeError(): string {
  return `That file is larger than ${CV_MAX_MB} MB.`;
}

/**
 * Whether the bytes are the document the name and MIME type claim.
 *
 * A browser reports the type from the file's extension, so a web page renamed to
 * `CV.pdf` passes every check above and lands in storage as a CV. Three live
 * applications hold the same 9 KB sign-in page that way: the candidate believed
 * they had applied with a CV, the record shows one, and nothing downstream could
 * ever read it. Both doors — the public upload and the staff re-read — ask this
 * of the bytes themselves, so the answer cannot be forged from the client.
 *
 * Returns a candidate-facing sentence, or null when the content matches.
 */
export function cvContentError(head: Uint8Array, mimeType: string): string | null {
  const text = (length: number) =>
    String.fromCharCode(...head.subarray(0, length));

  if (mimeType === "text/plain") return null;

  if (mimeType === "application/pdf") {
    return text(4) === "%PDF" ? null : CV_CONTENT_ERROR;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // A .docx is a zip container.
    return text(2) === "PK" ? null : CV_CONTENT_ERROR;
  }

  if (mimeType === "application/msword") {
    // A legacy .doc is an OLE compound file.
    return head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
      ? null
      : CV_CONTENT_ERROR;
  }

  return CV_TYPE_ERROR;
}

export const CV_CONTENT_ERROR =
  "That file is not a CV we can read — it looks like a web page or another program saved under a document name. Please attach the PDF or Word file itself.";
