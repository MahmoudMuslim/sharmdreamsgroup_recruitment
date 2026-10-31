/**
 * The buckets a recruiter writes a byte into.
 *
 * These numbers were transcribed from the live `storage.buckets` rows, which
 * used to be the second gate: storage refused an oversize or wrong-typed object
 * no matter what the portal promised first. Plan 2 Task 10 retired that schema,
 * and the disk store deliberately checks nothing but path containment, so the
 * rules below and the doors that read them are now the only size and type
 * enforcement a byte gets. Changing one here changes what the portal accepts —
 * there is nothing behind it to catch a wider value.
 *
 * `candidate-photos` is the third: the record door (Task 11) stores a profile
 * photo here at `persons/<personId>/<uuid>.<ext>`. Its size and type are NOT
 * literals — they are the `PERSON_LIMITS.photo_bytes` / `photo_mime` ceilings
 * (spec §11), read straight from the spine's one limits module, so the rule the
 * door enforces is the same number the store declares and a ceiling changes in
 * exactly one place. The magic-byte check below is what makes a renamed web
 * page read as the fake it is before the door ever writes the byte.
 */

import { PERSON_LIMITS } from "@/modules/candidates/domain/person-limits";

export type AttachmentBucket = "resumes" | "candidate-audio" | "candidate-photos";

/** The stored extension for each accepted photo type — the spine's `photo_mime` set. */
const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** `<exts>,<mimes>` for the file input, built from the one MIME list so it cannot drift. */
const PHOTO_ACCEPT = [...PERSON_LIMITS.photo_mime]
  .map((mime) => `.${PHOTO_EXTENSIONS[mime] ?? ""},${mime}`)
  .filter((part) => !part.startsWith(","))
  .join(",");

/** "JPEG, PNG, WEBP, up to 5 MB.", sized from `PERSON_LIMITS.photo_bytes`. */
const PHOTO_HINT = `${[...PERSON_LIMITS.photo_mime]
  .map((mime) => mime.split("/")[1].toUpperCase())
  .join(", ")}, up to ${Math.round(PERSON_LIMITS.photo_bytes / (1024 * 1024))} MB.`;

export interface AttachmentRule {
  bucket: AttachmentBucket;
  /** Heading the control is filed under in the candidate record. */
  label: string;
  /** The button text. */
  action: string;
  /** The types the portal accepts for this bucket, enforced by the upload route. */
  allowedMimeTypes: readonly string[];
  /** The largest object the portal accepts for this bucket. */
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
  {
    bucket: "candidate-photos",
    label: "Profile photo",
    action: "Add a photo",
    allowedMimeTypes: PERSON_LIMITS.photo_mime,
    maxBytes: PERSON_LIMITS.photo_bytes,
    accept: PHOTO_ACCEPT,
    hint: PHOTO_HINT,
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

/**
 * The photo's magic-byte check, beside the rule that sets its types.
 *
 * The declared MIME type only follows the filename, so a web page renamed
 * `face.jpg` would otherwise store as a face. The three signatures are the
 * ones spec §Security names — `\xff\xd8` (JPEG), the 8-byte `\x89PNG\r\n\x1a\n`
 * header (PNG) and `RIFF….WEBP` (WebP) — asked of the bytes themselves, so the
 * answer cannot be forged from the client. Returns a candidate-facing sentence,
 * or null when the bytes are the image the name claims.
 */
export const PHOTO_CONTENT_ERROR =
  "That file is not an image we can store — it looks like another program saved under a picture's name. Use a JPEG, PNG or WebP photo.";

const PHOTO_SIGNATURES: Record<string, (head: Uint8Array) => boolean> = {
  "image/jpeg": (h) => h.length >= 2 && h[0] === 0xff && h[1] === 0xd8,
  "image/png": (h) =>
    h.length >= 8 &&
    h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 &&
    h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a,
  // `RIFF` in bytes 0–3 and `WEBP` in bytes 8–11; bytes 4–7 are the size field.
  "image/webp": (h) =>
    h.length >= 12 &&
    h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
    h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50,
};

export function photoContentError(head: Uint8Array, mimeType: string): string | null {
  const signature = PHOTO_SIGNATURES[mimeType.toLowerCase()];
  if (!signature) return PHOTO_CONTENT_ERROR;
  return signature(head) ? null : PHOTO_CONTENT_ERROR;
}

/**
 * Where a profile photo lands: `persons/<person id>/<uuid>.<ext>`.
 *
 * The `persons/` prefix and the `candidates.write` gate are exactly what 043's
 * `candidate-photos` `files` insert policy requires, so the byte the record door
 * writes is one a session-client write would be allowed to reference the day the
 * form builder becomes the second door into this bucket.
 */
export function personPhotoPath(personId: string, mimeType: string): string {
  if (!isApplicationId(personId)) {
    throw new Error("personPhotoPath wants a uuid person id — it appears in the storage key.");
  }
  const ext = PHOTO_EXTENSIONS[mimeType.toLowerCase()];
  if (!ext) throw new Error(`personPhotoPath: "${mimeType}" is not a stored photo type.`);
  return `persons/${personId}/${crypto.randomUUID()}.${ext}`;
}
