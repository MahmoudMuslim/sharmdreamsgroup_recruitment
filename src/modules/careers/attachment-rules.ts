/**
 * The two buckets a recruiter writes into.
 *
 * The limits below are transcribed from the live `storage.buckets` rows, which
 * are the authority: storage refuses an oversize or wrong-typed object no matter
 * what the portal promises first. Enforcing the same numbers here only means the
 * recruiter reads "That file is larger than 10 MB" instead of a storage error
 * code, and lets the file picker offer the formats the bucket will accept.
 */

export type AttachmentBucket = "resumes" | "candidate-audio";

export interface AttachmentRule {
  bucket: AttachmentBucket;
  /** Heading the control is filed under in the candidate record. */
  label: string;
  /** The button text. */
  action: string;
  /** Exactly what `storage.buckets.allowed_mime_types` holds for this bucket. */
  allowedMimeTypes: readonly string[];
  /** Exactly what `storage.buckets.file_size_limit` holds for this bucket. */
  maxBytes: number;
  /** `accept` for the file input, so the OS picker starts in the right place. */
  accept: string;
  /** The limit line shown under the control. */
  hint: string;
}

export const ATTACHMENT_RULES: readonly AttachmentRule[] = [
  {
    bucket: "resumes",
    label: "CV or resume added by staff",
    action: "Attach a CV",
    allowedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxBytes: 10 * 1024 * 1024,
    accept: ".pdf,.docx,application/pdf",
    hint: "PDF or Word, up to 10 MB.",
  },
  {
    bucket: "candidate-audio",
    label: "Voice note",
    action: "Attach a voice note",
    allowedMimeTypes: ["audio/webm", "audio/mpeg", "audio/mp4"],
    maxBytes: 20 * 1024 * 1024,
    accept: ".webm,.mp3,.m4a,audio/webm,audio/mpeg,audio/mp4",
    hint: "WebM, MP3 or M4A, up to 20 MB. A WAV export is refused by the bucket.",
  },
] as const;

export function attachmentRule(bucket: string | null | undefined): AttachmentRule | null {
  return ATTACHMENT_RULES.find((rule) => rule.bucket === bucket) ?? null;
}

/** Application ids are uuids, and they appear in the storage key, so nothing else is accepted. */
export function isApplicationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Where a staff upload lands: `applications/<application id>/<uuid>-<name>`.
 *
 * The same shape the career site already writes into `candidate-cvs`, so both
 * buckets group by candidate in the File Manager, and the random prefix keeps a
 * second upload of the same filename from overwriting the first.
 */
export function attachmentPath(applicationId: string, fileName: string): string {
  const leaf = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  return `applications/${applicationId}/${crypto.randomUUID()}-${leaf}`;
}
