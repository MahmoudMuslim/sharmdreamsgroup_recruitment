/**
 * What a recruiter may attach to the assistant, and what it costs to read one.
 *
 * No `server-only` here on purpose. The composer has to know which formats to
 * offer, the panel has to say how much of the file the model actually saw, and
 * the saved conversation has to clip what it stores to the same number — three
 * places that each had their own copy of a constant and quietly drifted. One
 * table, one set of caps, and the refusal wording a recruiter reads is the
 * wording the server used to turn the file down.
 *
 * The table lists the formats the portal *cannot* read as well as the ones it
 * can. A file that is not in it gets a generic sentence, and a `.doc` gets the
 * true one: the assistant has no Word-97-2003 reader, and it used to accept the
 * extension anyway and then report a parse failure that looked like a bad file
 * rather than an unsupported one. Naming the format the recruiter attached, and
 * the door that would actually work, is the whole point of listing them.
 */

export type AttachmentKind = "pdf" | "docx" | "text" | "csv" | "xlsx" | "pptx";

export interface AttachmentFormat {
  /** The extension as a person sees it in a file box, lower case, with the dot. */
  extension: string;
  /** What to call it back to them. */
  label: string;
  /** The MIME labels browsers send for this extension, lower case. */
  mimes: string[];
  /** Set for the ones this portal can read; the reader dispatches on it. */
  kind?: AttachmentKind;
  /**
   * Why a recruiter cannot attach this one, in words that name the door that
   * works instead. Absent means the format is readable.
   */
  refusal?: string;
}

/**
 * The limits, in one place.
 *
 * `MAX_MATERIAL_CHARS` is what the file attached to *this question* contributes.
 * `MAX_HISTORY_ATTACHMENT_CHARS` is what a file from an earlier turn still
 * contributes, and what a saved conversation keeps — so reopening a thread gives
 * the model the same amount it was given live, never more. A whole spreadsheet
 * therefore belongs in the turn being answered; a file mentioned three turns ago
 * is remembered by its first pages.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_MATERIAL_CHARS = 40_000;
export const MAX_HISTORY_ATTACHMENT_CHARS = 12_000;

/** Below this there is no answer to be had, only a header row or a title slide. */
export const MIN_MATERIAL_CHARS = 40;

/**
 * Room for the note a clipped file carries: " [… name: 1,234 more characters not
 * shown]". A file is clipped once, when it is read, and the text then travels with
 * that note into the panel, back out on the next turn, and into the saved
 * conversation. Every later cut therefore allows for the note it did not write, so
 * a second clip cannot chop the first one and leave the model with a number that
 * no longer matches the file.
 */
export const MATERIAL_NOTE_ROOM = 1_000;

const LEGACY_OFFICE =
  "This portal reads the modern Office formats, not the 97-2003 ones. Open the file and Save As .docx, .xlsx or .pptx, then attach that.";

const NO_TEXT_LAYER =
  "A picture has no text for the assistant to read — it has no optical character recognition. Paste the words from it into the chat instead.";

export const ATTACHMENT_FORMATS: readonly AttachmentFormat[] = [
  { extension: ".pdf", label: "PDF", mimes: ["application/pdf", "application/x-pdf"], kind: "pdf" },
  {
    extension: ".docx",
    label: "Word document",
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    kind: "docx",
  },
  {
    extension: ".doc",
    label: "Word 97-2003 document",
    mimes: ["application/msword"],
    refusal: LEGACY_OFFICE,
  },
  {
    extension: ".xlsx",
    label: "Excel workbook",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    kind: "xlsx",
  },
  {
    extension: ".xlsm",
    label: "Excel workbook with macros",
    mimes: ["application/vnd.ms-excel.sheet.macroEnabled.12"],
    kind: "xlsx",
  },
  { extension: ".xls", label: "Excel 97-2003 workbook", mimes: [], refusal: LEGACY_OFFICE },
  { extension: ".pptx", label: "PowerPoint deck", mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], kind: "pptx" },
  { extension: ".ppt", label: "PowerPoint 97-2003 deck", mimes: [], refusal: LEGACY_OFFICE },
  {
    extension: ".csv",
    label: "CSV file",
    mimes: ["text/csv", "application/csv", "application/vnd.ms-excel"],
    kind: "csv",
  },
  {
    extension: ".tsv",
    label: "tab-separated file",
    mimes: ["text/tab-separated-values", "text/tsv"],
    kind: "csv",
  },
  {
    extension: ".txt",
    label: "plain-text file",
    mimes: ["text/plain"],
    kind: "text",
  },
  {
    extension: ".md",
    label: "Markdown file",
    mimes: ["text/markdown", "text/x-markdown"],
    kind: "text",
  },
  {
    extension: ".json",
    label: "JSON file",
    mimes: ["application/json", "text/json"],
    kind: "text",
  },
  { extension: ".png", label: "image", mimes: ["image/png"], refusal: NO_TEXT_LAYER },
  { extension: ".jpg", label: "image", mimes: ["image/jpeg"], refusal: NO_TEXT_LAYER },
  { extension: ".jpeg", label: "image", mimes: ["image/jpeg"], refusal: NO_TEXT_LAYER },
  { extension: ".webp", label: "image", mimes: ["image/webp"], refusal: NO_TEXT_LAYER },
  { extension: ".gif", label: "image", mimes: ["image/gif"], refusal: NO_TEXT_LAYER },
  { extension: ".zip", label: "archive", mimes: ["application/zip", "application/x-zip-compressed"], refusal: "Attach the file inside it, not the folder." },
];

/** Every format the reader can take, for the record and for the Guide's wording. */
export const READABLE_FORMATS = ATTACHMENT_FORMATS.filter((format) => format.kind);

/**
 * What the file box offers. Extension-first, because a `.csv` a browser labels
 * `application/vnd.ms-excel` is still a CSV — the label is the operating system's,
 * not the file's.
 */
export const ATTACHMENT_INPUT_ACCEPT = READABLE_FORMATS.map((format) => format.extension).join(",");

/** The sentence a recruiter is given when nothing they named could be read. */
export const READABLE_FORMAT_LABEL = READABLE_FORMATS.map((format) => format.label).join(", ");

export interface AttachmentMatch {
  format: AttachmentFormat | null;
  /** True when the file is one this portal can read. */
  readable: boolean;
  /** Why not, in the recruiter's words. Absent when it can. */
  refusal?: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** Spelling variants that are the same kind of file, folded before the lookup. */
const EXTENSION_ALIASES: Record<string, string> = {
  ".markdown": ".md",
  ".text": ".txt",
  ".log": ".txt",
  ".htm": ".txt",
};

function formatByExtension(extension: string): AttachmentFormat | undefined {
  return ATTACHMENT_FORMATS.find((format) => format.extension === extension);
}

/**
 * Which format is this, and can the assistant do anything with it.
 *
 * The extension decides when it names a known format; a file renamed to suit
 * somebody else is caught later by the parser, which cannot read a web page saved
 * as `.pdf` and says so.
 */
export function attachmentMatch(name: string, declaredMime: string): AttachmentMatch {
  const raw = extensionOf(name.trim());
  const extension = EXTENSION_ALIASES[raw] ?? raw;
  const mime = declaredMime.trim().toLowerCase();

  const byExtension = formatByExtension(extension);
  if (byExtension) {
    return byExtension.kind
      ? { format: byExtension, readable: true }
      : { format: byExtension, readable: false, refusal: byExtension.refusal };
  }

  const byMime = ATTACHMENT_FORMATS.find((format) => format.mimes.includes(mime));
  if (byMime) {
    return byMime.kind
      ? { format: byMime, readable: true }
      : { format: byMime, readable: false, refusal: byMime.refusal };
  }

  // Browsers send an empty label for a file with no extension, and some send
  // `text/whatever` for a document this table does not name. Anything that
  // announces itself as text is read as text; anything else is refused rather
  // than guessed at, because handing a model a compressed binary as prose is the
  // bug this module was written to replace.
  if (mime.startsWith("text/")) {
    const text = formatByExtension(".txt");
    return { format: text ?? null, readable: true };
  }

  return {
    format: null,
    readable: false,
    refusal: `That is not a file this assistant reads. Attach ${READABLE_FORMAT_LABEL}.`,
  };
}

/**
 * The size line, from the same number the server refuses at.
 *
 * Kept out of the parser because the recruiter needs it before the pick, in the
 * panel's own wording, and the upload path needs the identical sentence.
 */
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

export function uploadTooLarge(): string {
  return `That file is larger than ${MAX_UPLOAD_MB} MB.`;
}

/**
 * The text a model is given, clipped at the budget with the cut named.
 *
 * Saying "… 21,406 characters not shown" is the difference between a recruiter
 * believing the assistant read the workbook and knowing it read the top of it.
 */
export function clipMaterial(text: string, name: string, limit = MAX_MATERIAL_CHARS): string {
  const clipped = text.slice(0, limit);
  if (text.length <= clipped.length) return clipped;
  return `${clipped}\n[… ${name}: ${(text.length - clipped.length).toLocaleString("en-GB")} more characters not shown]`;
}

export function materialLengthLimit(historyOnly = false): number {
  return historyOnly ? MAX_HISTORY_ATTACHMENT_CHARS : MAX_MATERIAL_CHARS;
}

/**
 * The turn as a model reads it: the file named, its format named, and its text
 * inside a fence.
 *
 * The fence matters — it is what marks the file as material rather than as
 * instructions, because its content is whatever somebody uploaded. Both doors
 * build it from here: the live question on the server, an earlier turn's file as
 * the panel replays it, so the sentence that says "this is a file" cannot read
 * differently depending on which turn it came from.
 */
export function materialFence(name: string, text: string, label?: string): string {
  return `Attached file “${name}”${label ? ` — ${label}` : ""} — extracted text:\n"""\n${text}\n"""`;
}
