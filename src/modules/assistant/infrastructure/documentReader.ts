import "server-only";

/**
 * Reading a document a recruiter attached to the assistant.
 *
 * The screening engine already turns a PDF or a Word file into text, and that path
 * is reused rather than written twice: a CV parsed for screening reads exactly the
 * same here. What is added is the material a recruiter actually works in — a
 * workbook they were sent, a CSV an agency exported, a deck from a review — none of
 * which is prose, all of which has structure worth keeping.
 *
 * So a spreadsheet does not arrive as a stream of words. Each sheet is printed with
 * its header row and a bounded number of rows, because a model asked "which of
 * these candidates are missing a phone number" needs to see the columns, not a
 * paragraph. A deck is printed slide by slide, because the slide a point lives on
 * is part of the point.
 *
 * The bounds are deliberate and are said out loud in the material itself. A
 * workbook with 40,000 rows is not read; the top of it is, and the note says how
 * much was left, which is the only honest version of "I analysed your file".
 */

import JSZip from "jszip";
import ExcelJS from "exceljs";
import type { CellValue, Worksheet } from "exceljs";
import {
  CvExtractionError,
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";
import type { AttachmentKind } from "@/modules/assistant/domain/attachments";

/** How much of a structured file the model is shown before the note takes over. */
const MAX_SHEETS = 8;
const MAX_ROWS_SHOWN = 200;
const MAX_COLUMNS_SHOWN = 30;
const MAX_SLIDES_SHOWN = 40;

export interface AssistantDocument {
  kind: AttachmentKind;
  /** What the reader calls the format, for the chip and the Guide. */
  label: string;
  text: string;
  /** How the text was obtained, when the structure is worth reporting. */
  method: "pdf" | "docx" | "text" | "xlsx" | "csv" | "pptx";
  /** True when the file opened but held nothing to read. */
  empty: boolean;
}

/** A refusal in the recruiter's words, safe to show in the panel. */
export class DocumentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentReadError";
  }
}

function count(noun: string, value: number): string {
  return `${value.toLocaleString("en-GB")} ${noun}${value === 1 ? "" : "s"}`;
}

function labelFor(kind: AttachmentKind): string {
  return LABEL_BY_KIND[kind];
}

/**
 * One cell as text.
 *
 * ExcelJS hands back whatever the cell holds, which is not always a string: a
 * formula arrives as `{formula, result}`, a rich run as `{richText: […]}`, a
 * hyperlink as `{text, hyperlink}`, and an error as `{error: "#N/A"}`. Each has to
 * be unwrapped or the sheet prints `[object Object]` where a figure should be.
 */
function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";

  // A date-only cell is midnight in the reader's own zone, so the local parts are
  // taken directly — `toISOString` would move it a day for anybody east of London.
  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const time = value.getHours() || value.getMinutes() ? ` ${value.toTimeString().slice(0, 5)}` : "";
    return `${value.getFullYear()}-${month}-${day}${time}`;
  }

  const cell = value as unknown as Record<string, unknown>;
  if ("result" in cell) return cellText(cell.result as CellValue);
  if ("formula" in cell) return String(cell.formula ?? "");
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim();
  }
  if ("text" in cell) return String(cell.text ?? "");
  if ("error" in cell) return String(cell.error ?? "");
  if ("hyperlink" in cell) return String(cell.hyperlink ?? "");

  return "";
}

/** A row as a pipe-separated line, the shape a model reads as a table. */
function tableLine(cells: string[]): string {
  return cells.map((cell) => cell.replace(/\s*\|\s*/g, " / ")).join(" | ");
}

/**
 * The sheet's heading, naming a tab the file hides.
 *
 * Hidden tabs are read on purpose — in a workbook somebody has been working in,
 * the hidden one often holds the data — and saying so in the material is the only
 * honest way to tell a recruiter the assistant read a tab they thought was
 * private.
 */
function sheetTitle(sheet: Worksheet): string {
  if (sheet.state === "veryHidden") return `SHEET — ${sheet.name} (a tab Excel hides completely)`;
  if (sheet.state === "hidden") return `SHEET — ${sheet.name} (a hidden tab)`;
  return `SHEET — ${sheet.name}`;
}

/**
 * The rows a worksheet actually holds.
 *
 * `rowCount` counts to the furthest cell ever touched, which in a file somebody
 * formatted and then half-deleted is far past the last row with anything in it, so
 * the walk stops at the rows that have text rather than at the sheet's edge. The
 * first row with a cell in it is taken for the header — that is what a spreadsheet
 * is, and any other guess prints column letters at a model that needs the names.
 */
function sheetBlock(sheet: Worksheet): { text: string; hasData: boolean } {
  const rows: string[][] = [];
  let seen = 0;
  let widest = 0;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (columnNumber > MAX_COLUMNS_SHOWN) return;
      cells.push(cellText(cell.value));
    });
    if (cells.every((cell) => cell === "")) return;

    seen += 1;
    widest = Math.max(widest, row.cellCount);
    if (rows.length <= MAX_ROWS_SHOWN) rows.push(cells);
  });

  if (rows.length === 0) return { text: "", hasData: false };

  const header = rows[0];
  const body = rows.slice(1);
  const heldRows = seen - rows.length;
  const heldColumns = widest - MAX_COLUMNS_SHOWN;

  const notes: string[] = [];
  if (heldRows > 0) notes.push(`${heldRows.toLocaleString("en-GB")} further rows not shown`);
  if (heldColumns > 0) notes.push(`${heldColumns.toLocaleString("en-GB")} further columns not shown`);

  const lines = [
    sheetTitle(sheet),
    tableLine(header),
    ...body.map((row) => tableLine(row)),
  ];
  if (notes.length > 0) lines.push(`[… ${notes.join(", ")}]`);

  return { text: lines.join("\n"), hasData: body.length > 0 };
}

async function readWorkbook(buffer: Buffer, name: string): Promise<AssistantDocument> {
  const workbook = new ExcelJS.Workbook();

  try {
    // ExcelJS types `load` against an ArrayBuffer, not a Node Buffer, and a Buffer
    // can be a view into a shared pool — so the file's own bytes are copied out
    // rather than handed over as a slice somebody else also points at.
    await workbook.xlsx.load(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    );
  } catch {
    throw new DocumentReadError(
      "That Excel file could not be opened. If it is a .xls from Excel 97-2003, open it and Save As .xlsx, then attach that."
    );
  }

  const sheets = workbook.worksheets;
  if (sheets.length === 0) throw new DocumentReadError(`"${name}" has no worksheets in it.`);

  const shown = sheets.slice(0, MAX_SHEETS);
  const blocks: string[] = [];
  let anyData = false;

  for (const sheet of shown) {
    const block = sheetBlock(sheet);
    if (block.text === "") {
      blocks.push(`${sheetTitle(sheet)}\n(nothing in it)`);
      continue;
    }
    if (block.hasData) anyData = true;
    blocks.push(block.text);
  }

  const held = sheets.length - shown.length;
  if (held > 0) blocks.push(`[… ${count("sheet", held)} not read]`);

  const heading =
    `EXCEL WORKBOOK — ${name} (${count("sheet", sheets.length)}` +
    (held > 0 ? `; the first ${shown.length} read` : "") +
    ")";

  return {
    kind: "xlsx",
    label: labelFor("xlsx"),
    method: "xlsx",
    text: [heading, ...blocks].join("\n\n"),
    // A workbook of empty sheets opened fine and still says nothing.
    empty: !anyData,
  };
}

/**
 * Which delimiter this file uses, decided by counting rather than assumed.
 *
 * An agency export can be semicolon-separated, and reading it as commas puts the
 * whole record in one column — which a model then reads as a file with one field.
 * Counting on the first line is enough because a real export is consistent.
 */
function detectDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = 0;

  for (const candidate of ["\t", ";", "|", ","]) {
    const seen = firstLine.split(candidate).length - 1;
    if (seen > bestCount) {
      best = candidate;
      bestCount = seen;
    }
  }

  return bestCount > 0 ? best : ",";
}

/**
 * Parse a delimited file, quoted fields and all.
 *
 * Small on purpose: what a split cannot do is a quoted name containing a comma, a
 * doubled quote inside a quoted field, a CRLF line ending, or the byte-order mark
 * Excel writes ahead of the header, and a CSV export hits at least one of those
 * every time.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((cell) => cell.replace(/\s+/g, " ").trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));
}

function readDelimited(text: string, name: string, format: "CSV" | "TSV"): AssistantDocument {
  const delimiter = detectDelimiter(text.split("\n", 1)[0] ?? "");
  const rows = parseDelimited(text, delimiter);

  if (rows.length === 0) {
    return {
      kind: "csv",
      label: labelFor("csv"),
      method: "csv",
      text: `${format} — ${name}\n(nothing in it)`,
      empty: true,
    };
  }

  const header = rows[0];
  const body = rows.slice(1);
  const shown = body.slice(0, MAX_ROWS_SHOWN);
  const held = body.length - shown.length;

  const lines = [
    `${format} — ${name} (${count("column", header.length)}, ${count("row", body.length)})`,
    tableLine(header),
    ...shown.map((row) => tableLine(row)),
  ];
  if (held > 0) lines.push(`[… ${held.toLocaleString("en-GB")} further rows not read]`);

  return {
    kind: "csv",
    label: labelFor("csv"),
    method: "csv",
    text: lines.join("\n"),
    // A file with a header and no rows below it says nothing about anybody.
    empty: body.length === 0,
  };
}

/** Turn the XML entities a deck stores back into the characters they are. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The text on a slide.
 *
 * PowerPoint stores runs in `<a:t>` elements, and a title is only a convention —
 * so the runs are read in the order they appear, which is the order somebody
 * reading the slide would say them. Speaker notes live in a different part nobody
 * asked for, and a picture has no text at all, so both are said rather than skipped
 * silently.
 */
async function readDeck(buffer: Buffer, name: string): Promise<AssistantDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new DocumentReadError(
      "That PowerPoint file could not be opened. If it is a .ppt from PowerPoint 97-2003, open it and Save As .pptx, then attach that."
    );
  }

  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0));

  if (slides.length === 0) throw new DocumentReadError(`"${name}" has no slides in it.`);

  const blocks: string[] = [];
  let anyText = false;

  for (const [index, path] of slides.slice(0, MAX_SLIDES_SHOWN).entries()) {
    const xml = await zip.files[path].async("string");
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]).replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (runs.length > 0) anyText = true;
    blocks.push(
      `SLIDE ${index + 1}\n${runs.length > 0 ? runs.join("\n") : "(no text on this slide — it is a picture)"}`
    );
  }

  const held = slides.length - blocks.length;
  if (held > 0) blocks.push(`[… ${count("slide", held)} not read]`);

  return {
    kind: "pptx",
    label: labelFor("pptx"),
    method: "pptx",
    text:
      `POWERPOINT — ${name} (${count("slide", slides.length)}; slide text only, not speaker notes or images)\n\n` +
      blocks.join("\n\n"),
    empty: !anyText,
  };
}

/* ------------------------------------------------------------------ router -- */

const MIME_BY_KIND: Record<AttachmentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const LABEL_BY_KIND: Record<AttachmentKind, string> = {
  pdf: "PDF",
  docx: "Word document",
  text: "plain-text file",
  csv: "CSV file",
  xlsx: "Excel workbook",
  pptx: "PowerPoint deck",
};

/**
 * Read one attached file.
 *
 * `kind` is decided by the shared table in `domain/attachments`, which is the same
 * answer the composer gave the recruiter when it offered the format — so a file the
 * panel accepted is never refused here for being the wrong shape, and the only
 * refusals left are about the file itself.
 */
export async function readAssistantDocument(input: {
  name: string;
  kind: AttachmentKind;
  buffer: Buffer;
}): Promise<AssistantDocument> {
  const { name, kind, buffer } = input;

  if (buffer.length === 0) throw new DocumentReadError("That file is empty.");

  if (kind === "xlsx") return readWorkbook(buffer, name);
  if (kind === "pptx") return readDeck(buffer, name);

  if (kind === "csv") {
    return readDelimited(buffer.toString("utf-8"), name, name.toLowerCase().endsWith(".tsv") ? "TSV" : "CSV");
  }

  // PDF, Word and plain text go through the screening parser, so a CV says the
  // same thing here as it does on the desk that scores it.
  try {
    const extracted = await extractCvText(buffer, MIME_BY_KIND[kind]);
    return {
      kind,
      label: labelFor(kind),
      method: extracted.method === "plaintext" ? "text" : extracted.method,
      text: extracted.text,
      empty: extracted.empty,
    };
  } catch (error) {
    if (error instanceof CvExtractionError) throw new DocumentReadError(error.message);
    throw new DocumentReadError(describeExtractionFailure(error));
  }
}
