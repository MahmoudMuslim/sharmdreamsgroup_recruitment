/**
 * One report, three file formats.
 *
 * Every export in the portal builds the same `ExportDocument` and then picks a
 * writer, so a CSV, an .xlsx and a PDF of one report cannot disagree about a
 * number — writing each format against its own copy of the data is how exports
 * start lying.
 *
 * The document is deliberately dumb: labels, columns and cells. Nothing here
 * knows about candidates, stages or Supabase, which is what lets the analytics
 * aggregates and the row-level reports share one set of writers.
 */

import "server-only";

import ExcelJS from "exceljs";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type ExportCell = string | number | null | undefined;

export interface ExportSheet {
  /** Excel tab name, PDF table caption, CSV section marker. */
  name: string;
  columns: string[];
  rows: ExportCell[][];
}

export interface ExportDocument {
  title: string;
  description: string;
  /** Written once, at the top of every format: window, time zone, who exported. */
  meta: { label: string; value: string }[];
  /** Anything that makes the figures incomplete, carried into all three files. */
  limitations: string[];
  sheets: ExportSheet[];
  /** File name without the extension. */
  baseName: string;
}

export const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "csv", label: "CSV", hint: "Plain text, one section per table" },
  { key: "xlsx", label: "Excel", hint: "One tab per table, header frozen and filterable" },
  { key: "pdf", label: "PDF", hint: "Paginated tables for reading or printing" },
];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function cellText(value: ExportCell): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

/* ------------------------------------------------------------------ CSV -- */

/**
 * A UTF-8 byte-order mark, because Excel on Windows reads a BOM-less file in
 * the local code page and turns every accented name into mojibake.
 */
const BOM = "﻿";

function csvCell(value: ExportCell): string {
  const text = cellText(value).replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values: ExportCell[]): string {
  return values.map(csvCell).join(",");
}

export function buildCsv(doc: ExportDocument): Uint8Array {
  const lines: string[] = [csvLine([doc.title]), csvLine([doc.description])];

  for (const entry of doc.meta) lines.push(csvLine([entry.label, entry.value]));
  for (const limitation of doc.limitations) lines.push(csvLine(["Note", limitation]));

  for (const sheet of doc.sheets) {
    lines.push("");
    lines.push(csvLine([sheet.name]));
    lines.push(csvLine(sheet.columns));
    for (const row of sheet.rows) lines.push(csvLine(row));
  }

  return new TextEncoder().encode(`${BOM}${lines.join("\r\n")}\r\n`);
}

/* ---------------------------------------------------------------- Excel -- */

/** Excel forbids these characters in a tab name and caps it at 31 of them. */
function sheetName(name: string, taken: Set<string>): string {
  const clean = (name || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let unique = clean;
  let index = 2;
  while (taken.has(unique.toLowerCase())) {
    unique = `${clean.slice(0, 27)} (${index++})`;
  }
  taken.add(unique.toLowerCase());
  return unique;
}

async function buildXlsx(doc: ExportDocument): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sharm Dreams Group talent portal";
  workbook.created = new Date();
  workbook.title = doc.title;

  const used = new Set<string>();
  const about = workbook.addWorksheet(sheetName("Information", used));
  about.getColumn(1).width = 28;
  about.getColumn(2).width = 96;

  const titleRow = about.addRow([doc.title]);
  titleRow.font = { bold: true, size: 14 };
  about.addRow([doc.description]).font = { italic: true };
  about.addRow([]);
  for (const entry of doc.meta) {
    about.addRow([entry.label, entry.value]).getCell(1).font = { bold: true };
  }
  if (doc.limitations.length > 0) {
    about.addRow([]);
    about.addRow(["What this file does not cover"]).getCell(1).font = { bold: true };
    for (const limitation of doc.limitations) about.addRow([limitation]);
  }

  for (const sheet of doc.sheets) {
    const table = workbook.addWorksheet(sheetName(sheet.name, used));
    table.columns = sheet.columns.map((label, index) => {
      const widest = sheet.rows.reduce(
        (max, row) => Math.max(max, cellText(row[index]).length),
        label.length
      );
      return { header: label, key: `column${index}`, width: Math.min(44, Math.max(11, widest + 2)) };
    });
    table.getRow(1).font = { bold: true };
    table.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

    for (const row of sheet.rows) {
      /* Numbers go in as numbers so whoever opens the file can total the
       * column: a "20.6" stored as text sums to zero, which reads as a bug in
       * the report rather than in the cell type. */
      table.addRow(
        row.map((value) => {
          if (value === null || value === undefined) return "";
          if (typeof value === "number") return Number.isFinite(value) ? value : "";
          return value;
        })
      );
    }

    table.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(sheet.rows.length + 1, 1), column: Math.max(sheet.columns.length, 1) },
    };
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ PDF -- */

/**
 * Code points the built-in PDF fonts can print.
 *
 * `Helvetica` is WinAnsi-encoded: printable ASCII, Latin-1, and a handful of
 * Windows-1252 punctuation marks. Arabic, Cyrillic and CJK cannot be drawn at
 * all — and no built-in font joins joined script even if it could — so anything
 * else becomes `?` and the cover page says so. A silently mangled candidate
 * name in a hiring report is worse than an obvious gap, and CSV and Excel both
 * carry the exact spelling.
 */
const CP1252_PUNCTUATION = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function codePoints(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => String.fromCharCode(from + index));
}

const PDF_PRINTABLE = new Set<string>([
  ...CP1252_PUNCTUATION,
  ...codePoints(0x20, 0x7e),
  ...codePoints(0xa0, 0xff),
]);

function printable(text: string): string {
  let out = "";
  for (const character of text.replace(/\s+/g, " ")) {
    /* One marker per run of unprintable characters, so a mixed-script name
     * reads "Ahmed ?" rather than losing where it broke. */
    if (PDF_PRINTABLE.has(character)) out += character;
    else if (!out.endsWith("?")) out += "?";
  }
  return out;
}

/** True when anything in this document loses characters to the PDF font. */
function needsFontNote(doc: ExportDocument): boolean {
  const changed = (value: string) => printable(value) !== value.trim();
  if (changed(doc.title) || changed(doc.description)) return true;
  for (const entry of doc.meta) {
    if (changed(entry.label) || changed(entry.value)) return true;
  }
  for (const sheet of doc.sheets) {
    for (const column of sheet.columns) if (changed(column)) return true;
    for (const row of sheet.rows) {
      for (const value of row) if (changed(cellText(value))) return true;
    }
  }
  return false;
}

const A4 = { width: 595.28, height: 841.89 };
const LANDSCAPE = { width: 841.89, height: 595.28 };
const MARGIN = 34;
const ROW_HEIGHT = 14;
const BODY_SIZE = 8;

function clip(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

function columnWidths(
  font: PDFFont,
  columns: string[],
  rows: ExportCell[][],
  size: number,
  available: number
): number[] {
  const wanted = columns.map((label, index) => {
    const widest = rows.reduce(
      (max, row) =>
        Math.max(max, font.widthOfTextAtSize(printable(cellText(row[index])), size)),
      font.widthOfTextAtSize(printable(label), size)
    );
    return Math.min(Math.max(widest + 10, 52), 250);
  });
  const total = wanted.reduce((sum, width) => sum + width, 0);
  return total <= available ? wanted : wanted.map((width) => (width * available) / total);
}

/**
 * One sheet as a landscape table, paginating under itself.
 *
 * Cells are clipped rather than wrapped: a wrapped table needs per-row heights,
 * and getting those wrong turns a 300-row export into a PDF where every other
 * line is cut in half. Clipping says "this column is too narrow" honestly and
 * leaves the exact text to Excel.
 */
function drawTable(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  sheet: ExportSheet,
  caption: string
): void {
  const usable = LANDSCAPE.width - MARGIN * 2;
  const widths = columnWidths(font, sheet.columns, sheet.rows, BODY_SIZE, usable);

  const startPage = (first: boolean): { page: PDFPage; cursor: number } => {
    const page = pdf.addPage([LANDSCAPE.width, LANDSCAPE.height]);
    let top = LANDSCAPE.height - MARGIN;

    if (first) {
      page.drawText(clip(bold, printable(caption), 10, usable), {
        x: MARGIN,
        y: top - 10,
        size: 10,
        font: bold,
      });
      top -= 26;
    }

    const header = top - ROW_HEIGHT;
    page.drawRectangle({
      x: MARGIN - 4,
      y: header,
      width: usable + 8,
      height: ROW_HEIGHT,
      color: rgb(0.93, 0.91, 0.85),
    });
    let x = MARGIN;
    sheet.columns.forEach((label, index) => {
      page.drawText(clip(bold, printable(label), BODY_SIZE, widths[index] - 6), {
        x,
        y: header + 4,
        size: BODY_SIZE,
        font: bold,
      });
      x += widths[index];
    });

    return { page, cursor: header - 4 };
  };

  let { page, cursor } = startPage(true);

  if (sheet.rows.length === 0) {
    page.drawText("No rows match this report.", {
      x: MARGIN,
      y: cursor,
      size: BODY_SIZE,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
    return;
  }

  sheet.rows.forEach((row, rowIndex) => {
    if (cursor < MARGIN + ROW_HEIGHT) {
      ({ page, cursor } = startPage(false));
    }
    if (rowIndex % 2 === 1) {
      page.drawRectangle({
        x: MARGIN - 4,
        y: cursor - 3,
        width: usable + 8,
        height: ROW_HEIGHT,
        color: rgb(0.98, 0.97, 0.95),
      });
    }
    let x = MARGIN;
    sheet.columns.forEach((_, index) => {
      const drawn = clip(font, printable(cellText(row[index])), BODY_SIZE, widths[index] - 6);
      const numeric = typeof row[index] === "number";
      page.drawText(drawn, {
        x: numeric ? x + widths[index] - 6 - font.widthOfTextAtSize(drawn, BODY_SIZE) : x,
        y: cursor,
        size: BODY_SIZE,
        font,
      });
      x += widths[index];
    });
    cursor -= ROW_HEIGHT;
  });
}

async function buildPdf(doc: ExportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(doc.title));
  pdf.setCreator("Sharm Dreams Group talent portal");
  pdf.setSubject(
    printable(doc.meta.map((entry) => `${entry.label}: ${entry.value}`).join("  ·  "))
  );

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cover = pdf.addPage([A4.width, A4.height]);
  const usableWidth = A4.width - MARGIN * 2;
  let y = A4.height - MARGIN;

  const write = (
    text: string,
    options: { size: number; bold?: boolean; grey?: number } = { size: 9 }
  ) => {
    const active = options.bold ? bold : font;
    const colour = options.grey === undefined ? undefined : rgb(options.grey, options.grey, options.grey);

    let line = "";
    const lines: string[] = [];
    for (const word of printable(text).split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || active.widthOfTextAtSize(candidate, options.size) <= usableWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = word;
    }
    if (line) lines.push(line);

    for (const one of lines.map((value) => clip(active, value, options.size, usableWidth))) {
      if (y < MARGIN + 24) return;
      cover.drawText(one, {
        x: MARGIN,
        y,
        size: options.size,
        font: active,
        color: colour,
      });
      y -= options.size + 4;
    }
  };

  write("Sharm Dreams Group", { size: 9, bold: true, grey: 0.45 });
  y -= 6;
  write(doc.title, { size: 20, bold: true });
  y -= 4;
  write(doc.description, { size: 9, grey: 0.35 });
  y -= 8;

  for (const entry of doc.meta) write(`${entry.label}: ${entry.value}`, { size: 9 });

  if (doc.limitations.length > 0) {
    y -= 6;
    write("What these numbers do not cover", { size: 10, bold: true });
    for (const limitation of doc.limitations) write(`- ${limitation}`, { size: 8, grey: 0.3 });
  }

  if (needsFontNote(doc)) {
    y -= 6;
    write("About the spelling in this file", { size: 10, bold: true });
    write(
      "- The built-in PDF font cannot print Arabic, Cyrillic or other non-Latin script, so any name that uses it appears here with ? in place of those letters. Use the Excel or CSV copy for the exact spelling.",
      { size: 8, grey: 0.3 }
    );
  }

  for (const sheet of doc.sheets) {
    if (sheet.columns.length === 0) continue;
    drawTable(pdf, font, bold, sheet, `${doc.title} — ${sheet.name}`);
  }

  /* Footers last, so the page total is already known. */
  const pages = pdf.getPages();
  const footer = `${printable(doc.title)} · ${printable(
    doc.meta.map((entry) => entry.value).join(" · ")
  )}`;
  pages.forEach((page, index) => {
    page.drawText(
      clip(font, `${footer} · Page ${index + 1} of ${pages.length}`, 7, page.getWidth() - MARGIN * 2),
      { x: MARGIN, y: 18, size: 7, font, color: rgb(0.45, 0.45, 0.45) }
    );
  });

  return new Uint8Array(await pdf.save());
}

/* --------------------------------------------------------------- router -- */

export interface ExportFile {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

/** The writer for one format, chosen on the server rather than by the client. */
export async function buildExport(doc: ExportDocument, format: ExportFormat): Promise<ExportFile> {
  const bytes =
    format === "csv"
      ? buildCsv(doc)
      : format === "xlsx"
        ? await buildXlsx(doc)
        : await buildPdf(doc);

  return { bytes, contentType: CONTENT_TYPES[format], fileName: `${doc.baseName}.${format}` };
}
