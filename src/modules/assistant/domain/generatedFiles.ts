/**
 * What the assistant may build, and what a built file is allowed to hold.
 *
 * No `server-only` here on purpose: the chat chip has to name the format it is
 * handing back, the Guide has to list what the assistant can make, and the server
 * has to refuse what is over the limit — three readers of one answer. Written in
 * three places, those copies drift, and the drift shows up as a chip that says
 * "Word document" over a file the writer built as .docx-but-not-really.
 *
 * The spec is deliberately narrow. A model that can ask for *any* document asks for
 * one with forty columns and nine thousand rows, and the recruiter gets a download
 * button that opens a file Excel spends a minute on. So there are two shapes —
 * tables and sections — a cap on each, and a refusal that tells the model what to
 * do instead ("split it across sheets", "keep the rows the portal already lists and
 * say the rest is one click away"), which is the difference between a tool that
 * works and a tool that retries until the turn runs out.
 */

export type GeneratedFileFormat = "csv" | "xlsx" | "pdf" | "docx" | "txt" | "md" | "json";

export type GeneratedFileShape = "table" | "sections";

export interface GeneratedFormat {
  format: GeneratedFileFormat;
  extension: string;
  /** What the chip and the answer call it. */
  label: string;
  contentType: string;
  /** Tables are sheets of columns and rows; sections are headings with lines. */
  shape: GeneratedFileShape;
}

/**
 * The ceilings.
 *
 * `MAX_FILE_BYTES` is the honest one. The file does not reach the recruiter as a
 * stream — it rides back on the step as base64, which is about a third larger
 * again, so this is a limit on the payload the panel has to hold, not on what a
 * spreadsheet could physically contain. Every cap above is far out of reach of a
 * file anyone would actually build in a chat (500 rows of 30 columns zips to a few
 * tens of kilobytes), so hitting it means the model dumped something huge into the
 * cells: the writer stops and says so rather than shipping a download that freezes
 * the tab.
 */
export const MAX_FILE_SHEETS = 8;
export const MAX_FILE_ROWS_PER_SHEET = 500;
export const MAX_FILE_COLUMNS = 30;
export const MAX_FILE_SECTIONS = 40;
export const MAX_FILE_LINES_PER_SECTION = 60;
export const MAX_CELL_CHARS = 400;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const GENERATED_FORMATS: readonly GeneratedFormat[] = [
  {
    format: "xlsx",
    extension: ".xlsx",
    label: "Excel workbook",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    shape: "table",
  },
  {
    format: "csv",
    extension: ".csv",
    label: "CSV file",
    contentType: "text/csv;charset=utf-8",
    shape: "table",
  },
  {
    format: "pdf",
    extension: ".pdf",
    label: "PDF",
    contentType: "application/pdf",
    shape: "table",
  },
  {
    format: "docx",
    extension: ".docx",
    label: "Word document",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    shape: "sections",
  },
  {
    format: "txt",
    extension: ".txt",
    label: "plain-text file",
    contentType: "text/plain;charset=utf-8",
    shape: "sections",
  },
  {
    format: "md",
    extension: ".md",
    label: "Markdown file",
    contentType: "text/markdown;charset=utf-8",
    shape: "sections",
  },
  {
    format: "json",
    extension: ".json",
    label: "JSON file",
    contentType: "application/json",
    shape: "table",
  },
];

/** The sentence the tool description and the Guide both quote. */
export const GENERATED_FORMAT_LABEL = GENERATED_FORMATS.map((entry) => entry.label).join(", ");

export function generatedFormat(format: unknown): GeneratedFormat | undefined {
  if (typeof format !== "string") return undefined;
  return GENERATED_FORMATS.find((entry) => entry.format === format.trim().toLowerCase());
}

/* ------------------------------------------------------------------ spec -- */

export type GeneratedCell = string | number | boolean | null;

export interface GeneratedSheet {
  name: string;
  columns: string[];
  rows: GeneratedCell[][];
}

export interface GeneratedSection {
  heading: string;
  lines: string[];
}

/** The document the model asked for, once the checks have run. */
export interface GeneratedFileSpec {
  title: string;
  /** Said once at the top of every format: what the file is and where it came from. */
  description: string;
  meta: { label: string; value: string }[];
  /** Anything that makes the file incomplete, carried into all of them. */
  limitations: string[];
  format: GeneratedFormat;
  baseName: string;
  sheets: GeneratedSheet[];
  sections: GeneratedSection[];
  /** What the caps cut, said out loud so the file and the answer both admit it. */
  notes: string[];
}

/** A refusal the model can act on, not just an error the turn dies on. */
export class GeneratedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratedFileError";
  }
}

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string") throw new GeneratedFileError(`"${field}" must be text.`);
  const clean = value.trim();
  if (clean.length === 0) throw new GeneratedFileError(`"${field}" must not be empty.`);
  return clean.length > limit ? clean.slice(0, limit) : clean;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Characters a file name may not hold: the ones Windows forbids, plus the control
 * range a model can emit when it copies a cell out of a log.
 */
const FORBIDDEN_IN_NAME = new RegExp("[<>:\"|?*\\\\/\\u0000-\\u001f]", "g");

/**
 * A file name a recruiter's operating system will accept.
 *
 * The extension the model typed is dropped and the one that matches the format is
 * added, so a request for "report.docx" built as a CSV cannot hand back a file whose
 * name lies about what is inside it.
 */
export function safeFileName(name: string, extension: string): string {
  const noSlashes = name.replace(/[\\/]/g, " ").replace(FORBIDDEN_IN_NAME, " ");
  const withoutExtension = noSlashes.replace(/\.[A-Za-z0-9]{1,6}$/, "").replace(/\s+/g, " ").trim();
  const base = withoutExtension.slice(0, 80) || "assistant-file";
  return `${base}${extension}`;
}

/* ----------------------------------------------------------------- parse -- */

function cellValue(value: unknown): GeneratedCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > MAX_CELL_CHARS) return `${value.slice(0, MAX_CELL_CHARS)}…`;
    return value;
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

function parseSheet(input: unknown, index: number, notes: string[]): GeneratedSheet {
  if (typeof input !== "object" || input === null) {
    throw new GeneratedFileError(`sheets[${index}] must be an object with "name", "columns" and "rows".`);
  }
  const given = input as Record<string, unknown>;
  const name = optionalText(given.name) || `Sheet ${index + 1}`;

  if (!Array.isArray(given.columns) || given.columns.length === 0) {
    throw new GeneratedFileError(
      `Sheet "${name}" needs a non-empty "columns" array — a list of header labels, one per column.`
    );
  }

  let columns = given.columns.map((column, position) =>
    requiredText(column, `column ${position + 1} of "${name}"`, 60)
  );
  if (columns.length > MAX_FILE_COLUMNS) {
    notes.push(
      `Sheet "${name}" was asked for ${columns.length} columns; only the first ${MAX_FILE_COLUMNS} are in the file.`
    );
    columns = columns.slice(0, MAX_FILE_COLUMNS);
  }

  if (!Array.isArray(given.rows)) {
    throw new GeneratedFileError(`Sheet "${name}" needs a "rows" array — one array of cells per row.`);
  }

  let rows = given.rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return columns.map((_, position) => cellValue(cells[position]));
  });

  const ragged = given.rows.filter(
    (row: unknown) => Array.isArray(row) && row.length > columns.length
  ).length;
  if (ragged > 0) {
    notes.push(
      `${ragged} row${ragged === 1 ? "" : "s"} in "${name}" had more cells than the ${columns.length} columns, so the extra cells were dropped.`
    );
  }

  /* A long cell is cut by `cellValue`, and a file whose cells end mid-sentence
   * has to say so — otherwise the recruiter reads the cut as the whole answer. */
  const shortened = given.rows.reduce(
    (total: number, row: unknown) =>
      total +
      (Array.isArray(row)
        ? row.filter((cell) => typeof cell === "string" && cell.length > MAX_CELL_CHARS).length
        : 0),
    0
  );
  if (shortened > 0) {
    notes.push(
      `${shortened} cell${shortened === 1 ? "" : "s"} in "${name}" is longer than ${MAX_CELL_CHARS} characters and is cut short in the file.`
    );
  }

  if (rows.length > MAX_FILE_ROWS_PER_SHEET) {
    notes.push(
      `Sheet "${name}" holds the first ${MAX_FILE_ROWS_PER_SHEET} of ${rows.length.toLocaleString("en-GB")} rows.`
    );
    rows = rows.slice(0, MAX_FILE_ROWS_PER_SHEET);
  }

  if (rows.length === 0) {
    throw new GeneratedFileError(
      `Sheet "${name}" has no rows. Leave the sheet out, or put the figures in the answer instead of the file.`
    );
  }

  return { name: name.slice(0, 31), columns, rows };
}

function parseSection(input: unknown, index: number): GeneratedSection {
  if (typeof input !== "object" || input === null) {
    throw new GeneratedFileError(`sections[${index}] must be an object with a "heading" and "lines".`);
  }
  const given = input as Record<string, unknown>;
  const heading = optionalText(given.heading) || `Section ${index + 1}`;

  if (!Array.isArray(given.lines) || given.lines.length === 0) {
    throw new GeneratedFileError(
      `Section "${heading}" needs a non-empty "lines" array — the sentences to write under the heading.`
    );
  }

  let lines = given.lines.map((line, position) => requiredText(line, `line ${position + 1} of "${heading}"`, 600));
  if (lines.length > MAX_FILE_LINES_PER_SECTION) {
    lines = [...lines.slice(0, MAX_FILE_LINES_PER_SECTION), `… ${given.lines.length - MAX_FILE_LINES_PER_SECTION} further lines not written`];
  }

  return { heading, lines };
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new GeneratedFileError(`"${field}" must be an array of strings.`);
  return value.map((entry, index) => requiredText(entry, `${field}[${index}]`, 300));
}

/**
 * Read the model's request into a checked document.
 *
 * The errors name the field and the fix, because the model gets another turn and
 * can only use what the message says. "Invalid arguments" costs the recruiter the
 * answer; "csv takes sheets, not sections" costs nothing.
 */
export function parseFileSpec(args: Record<string, unknown>): GeneratedFileSpec {
  const format = generatedFormat(args.format);
  if (!format) {
    const given = optionalText(args.format) || "(none)";
    throw new GeneratedFileError(
      `"${given}" is not a file this assistant writes. Use one of: ${GENERATED_FORMATS.map((entry) => entry.format).join(", ")}.`
    );
  }

  const title = requiredText(args.title, "title", 120);
  const description = optionalText(args.description);
  const notes: string[] = [];

  const givenMeta = args.meta;
  const meta: { label: string; value: string }[] = [];
  if (Array.isArray(givenMeta)) {
    for (const entry of givenMeta) {
      if (typeof entry !== "object" || entry === null) continue;
      const label = optionalText((entry as Record<string, unknown>).label);
      const value = optionalText((entry as Record<string, unknown>).value);
      if (label && value) meta.push({ label: label.slice(0, 60), value: value.slice(0, 300) });
    }
  } else if (givenMeta !== undefined && givenMeta !== null) {
    throw new GeneratedFileError(`"meta" must be an array of { label, value } pairs.`);
  }

  const limitations = stringList(args.limitations, "limitations");

  const sheets: GeneratedSheet[] = [];
  const sections: GeneratedSection[] = [];

  if (format.shape === "table") {
    if (!Array.isArray(args.sheets) || args.sheets.length === 0) {
      throw new GeneratedFileError(
        `${format.format} needs a non-empty "sheets" array — each sheet is { name, columns, rows }.`
      );
    }
    if (Array.isArray(args.sections) && args.sections.length > 0) {
      notes.push(`"sections" was ignored: ${format.format} is written from "sheets".`);
    }
    if (args.sheets.length > MAX_FILE_SHEETS) {
      notes.push(
        `The request had ${args.sheets.length} sheets; only the first ${MAX_FILE_SHEETS} are in the file.`
      );
    }
    args.sheets.slice(0, MAX_FILE_SHEETS).forEach((sheet, index) => sheets.push(parseSheet(sheet, index, notes)));
  } else {
    if (!Array.isArray(args.sections) || args.sections.length === 0) {
      throw new GeneratedFileError(
        `${format.format} needs a non-empty "sections" array — each section is { heading, lines }. ` +
          `For a table of figures use csv or xlsx.`
      );
    }
    if (Array.isArray(args.sheets) && args.sheets.length > 0) {
      notes.push(`"sheets" was ignored: ${format.format} is written from "sections".`);
    }
    if (args.sections.length > MAX_FILE_SECTIONS) {
      notes.push(
        `The request had ${args.sections.length} sections; only the first ${MAX_FILE_SECTIONS} are in the file.`
      );
    }
    args.sections.slice(0, MAX_FILE_SECTIONS).forEach((section, index) => sections.push(parseSection(section, index)));
  }

  const baseName = optionalText(args.filename) || title;

  return {
    title,
    description,
    meta,
    limitations,
    format,
    baseName: safeFileName(baseName, format.extension).slice(0, -format.extension.length),
    sheets,
    sections,
    notes,
  };
}

/* --------------------------------------------------------------- rebuild -- */

/**
 * Re-check a file description that came back from the browser.
 *
 * A chip in a reopened conversation keeps its `spec` so the recruiter can build
 * the same file again, and that spec arrives as whatever the browser sent. Handing
 * it straight to the writer would let a stuffed object name an arbitrary format or
 * skip every ceiling, so it goes back through the parser the model's own request
 * went through — which re-cuts the rows, re-counts the columns, and refuses in the
 * same words when the object is not a file description at all.
 */
export function rebuildFileSpec(value: unknown): GeneratedFileSpec {
  const given = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const format = (given.format as { format?: unknown } | undefined)?.format;
  return parseFileSpec({ ...given, format });
}

/* -------------------------------------------------------------- manifest -- */

/**
 * What the finished file looks like on the way to the screen.
 *
 * `data` is the only place the bytes ever sit, and it is removed before the turn is
 * written to the transcript: a stored conversation that replays a three-megabyte
 * base64 string on every page load is a slow portal, and a file left in a database
 * row nobody can delete is a worse one. So the download works while the answer is
 * on screen, and after a reload the chip still names the file and offers to build
 * it again from `spec` — which is the honest split, because nothing here promises a
 * link that outlives the browser.
 */
export interface GeneratedFileManifest {
  format: GeneratedFileFormat;
  label: string;
  fileName: string;
  contentType: string;
  title: string;
  /** Size of the file, so the chip can state it without holding the file. */
  bytes: number;
  /** base64 of those bytes; stripped before the turn is stored. */
  data?: string;
  /** One line per sheet or section: what the recruiter is being handed. */
  contents: string[];
  /** Every cap the writer applied, plus the format warnings worth repeating. */
  notes: string[];
  /** Enough to rebuild the same file after the bytes are gone. */
  spec: GeneratedFileSpec;
}

/** The manifest with its bytes removed — what the transcript keeps. */
export function withoutFileBytes(manifest: GeneratedFileManifest): GeneratedFileManifest {
  return { ...manifest, data: undefined };
}

/** True when the step carries a file a recruiter can hand a spreadsheet to. */
export function isGeneratedFile(value: unknown): value is GeneratedFileManifest {
  if (typeof value !== "object" || value === null) return false;
  const given = value as Record<string, unknown>;
  return (
    typeof given.fileName === "string" &&
    typeof given.label === "string" &&
    typeof given.bytes === "number" &&
    Array.isArray(given.contents) &&
    Array.isArray(given.notes)
  );
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A built file splits in two on the way out of a tool call.
 *
 * The bytes belong on the recruiter's card and nowhere else; the words about the
 * file belong in the model's context. Both engines call this one function rather
 * than each remembering to strip, because a forgotten strip puts a megabyte of
 * base64 into the transcript, and the model reads it back on the next turn.
 */
export function splitFilePayload(value: unknown): { forModel: unknown; file?: GeneratedFileManifest } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { forModel: value };

  const given = value as Record<string, unknown>;
  if (!isGeneratedFile(given.file)) return { forModel: value };

  const rest = { ...given };
  delete rest.file;
  return { forModel: rest, file: given.file };
}

/**
 * The line the chip shows under the step.
 *
 * Both engines call this, so the same file reports the same size whichever model
 * built it. It says what the file *is*, not that it was saved anywhere — a chip
 * reading "Saved shortlist.xlsx" would promise a row in the file manager that does
 * not exist.
 */
export function fileChipLine(manifest: GeneratedFileManifest): string {
  const held = manifest.contents.length;
  const unit = manifest.spec.format.shape === "table" ? "sheet" : "section";
  return `Built ${manifest.fileName} — ${manifest.label}, ${formatBytes(manifest.bytes)}, ${held} ${
    held === 1 ? unit : `${unit}s`
  }`;
}
