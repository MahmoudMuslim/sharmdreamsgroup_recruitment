/**
 * What the career site accepts as a CV file.
 *
 * The apply form checks before sending, the upload route checks before storing
 * and the prefill route checks before spending a model call on it. Those three
 * have to agree — a candidate whose file passes one gate and fails another reads
 * it as the site losing their CV — so the numbers live here once.
 */

export const CV_MAX_MB = 5;
export const CV_MAX_BYTES = CV_MAX_MB * 1024 * 1024;

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
