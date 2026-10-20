import "server-only";

/**
 * Building a file the assistant was asked for.
 *
 * Three of the seven formats are the portal's own export writers, reused rather
 * than written twice: `exportDocument` already turns one table into a CSV, an
 * .xlsx and a paginated PDF, and a file built here cannot disagree with the button
 * on the reports page because it is the same code answering.
 *
 * The rest are added here, and each one is kept inside what the format can actually
 * carry. Word gets headings and paragraphs — a hand-built OOXML document, no new
 * dependency, and nothing assemblable that Word refuses to open. A PDF gets the
 * same non-Latin warning the reports page gives it, because the built-in font
 * cannot print Arabic and a recruiter finding that out from a printed sheet is a
 * worse discovery than being told before the download.
 *
 * The bytes never reach the model. They go on the step for the button and are
 * stripped before the turn is stored, so a reloaded conversation names the file and
 * offers to build it again instead of replaying a megabyte of base64.
 */

import JSZip from "jszip";
import {
  buildExport,
  needsFontNote,
  type ExportDocument,
  type ExportFormat,
} from "@/modules/analytics/domain/exportDocument";
import {
  GeneratedFileError,
  MAX_FILE_BYTES,
  formatBytes,
  type GeneratedCell,
  type GeneratedFileManifest,
  type GeneratedFileSpec,
  type GeneratedSheet,
} from "@/modules/assistant/domain/generatedFiles";

/** How many contents lines the card shows before it says how many were left off. */
const MAX_CONTENT_LINES = 8;

/** A cell in the shape the shared export writers accept — booleans have to become words. */
type ExportValue = string | number | null;

function exportCell(value: GeneratedCell): ExportValue {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16);
}

/**
 * The header every format prints above its own contents.
 *
 * The timestamp is added here rather than left to the model so a file cannot claim
 * to be current without saying when it was built — the read behind it was true at
 * that minute, and a report opened next week needs to say which minute that was.
 */
function headerMeta(spec: GeneratedFileSpec): { label: string; value: string }[] {
  const meta = [...spec.meta];
  if (!meta.some((entry) => entry.label.toLowerCase() === "generated")) {
    meta.push({ label: "Generated", value: `${stamp()} UTC` });
  }
  return meta;
}

function toExportDocument(spec: GeneratedFileSpec, meta: { label: string; value: string }[]): ExportDocument {
  const sheets: ExportDocument["sheets"] = spec.sheets.map(
    (sheet): ExportDocument["sheets"][number] => ({
      name: sheet.name,
      columns: sheet.columns,
      rows: sheet.rows.map((row) => row.map(exportCell)),
    })
  );

  return {
    title: spec.title,
    description: spec.description,
    meta,
    limitations: [...spec.limitations, ...spec.notes],
    sheets,
    baseName: spec.baseName,
  };
}

/* --------------------------------------------------------------- plain -- */

/**
 * The same document as lines, for the two formats that are only lines.
 *
 * Markdown and plain text differ in markup, not in content — a recruiter who asks
 * for a `.md` of a summary gets the sentences they asked for, and one who asks for
 * `.txt` gets them without the stars.
 */
function textLines(spec: GeneratedFileSpec, meta: { label: string; value: string }[]): string[] {
  const markdown = spec.format.format === "md";
  const heading = (value: string, level: 1 | 2) =>
    markdown ? `${"#".repeat(level)} ${value}` : level === 1 ? value.toUpperCase() : value;

  const lines: string[] = [markdown ? `# ${spec.title}` : spec.title];
  if (spec.description) lines.push("", spec.description);
  lines.push("");

  for (const entry of meta) lines.push(markdown ? `- **${entry.label}**: ${entry.value}` : `${entry.label}: ${entry.value}`);

  if (spec.limitations.length > 0) {
    lines.push("", heading("What this file does not cover", 2));
    for (const limitation of spec.limitations) lines.push(markdown ? `- ${limitation}` : `  - ${limitation}`);
  }

  for (const section of spec.sections) {
    lines.push("", heading(section.heading, 1));
    for (const line of section.lines) lines.push(markdown ? `- ${line}` : `  ${line}`);
  }

  if (spec.notes.length > 0) {
    lines.push("", heading("Notes on this file", 2));
    for (const note of spec.notes) lines.push(markdown ? `- ${note}` : `  - ${note}`);
  }

  return lines;
}

/* ---------------------------------------------------------------- JSON -- */

/**
 * Sheets as objects keyed by their column labels.
 *
 * `rows` as arrays of columns is what a spreadsheet is; `rows` as objects is what a
 * script wants. A recruiter asking for JSON is asking to load it somewhere, so the
 * columns become the keys and the two-line header the table format needs is left
 * out. The column order is still printed beside them, because an object has no
 * order a reader can trust.
 */
function buildJson(spec: GeneratedFileSpec, meta: { label: string; value: string }[]): Uint8Array {
  const document = {
    title: spec.title,
    description: spec.description,
    generated_at: new Date().toISOString(),
    meta,
    limitations: [...spec.limitations, ...spec.notes],
    sheets: spec.sheets.map((sheet) => ({
      name: sheet.name,
      columns: sheet.columns,
      rows: sheet.rows.map((row) =>
        Object.fromEntries(sheet.columns.map((column, index) => [column, exportCell(row[index])]))
      ),
    })),
  };

  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

/* ---------------------------------------------------------------- Word -- */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Characters XML 1.0 has no representation for; a log dump can carry them. */
const CONTROL_CODES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function xmlText(value: string): string {
  return value
    .replace(CONTROL_CODES, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ParagraphOptions {
  style?: string;
  bold?: boolean;
  italic?: boolean;
  /** Half-points, the unit OOXML measures in. */
  size?: number;
}

function run(text: string, options: ParagraphOptions): string {
  const properties: string[] = [];
  if (options.style) properties.push(`<w:rStyle w:val="${options.style}"/>`);
  if (options.bold) properties.push("<w:b/>");
  if (options.italic) properties.push("<w:i/>");
  if (options.size) properties.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);

  const paragraphs = text
    .split(/\r?\n/)
    .map(
      (line) =>
        `<w:t xml:space="preserve">${xmlText(line)}</w:t>`
    )
    .join("<w:br/>");

  return `<w:r>${properties.length > 0 ? `<w:rPr>${properties.join("")}</w:rPr>` : ""}${paragraphs}</w:r>`;
}

function paragraph(text: string, options: ParagraphOptions = {}): string {
  const reference = options.style ? `<w:pStyle w:val="${options.style}"/>` : "";
  return `<w:p>${reference ? `<w:pPr>${reference}</w:pPr>` : ""}${run(text, options)}</w:p>`;
}

/**
 * The two styles a heading is allowed to be.
 *
 * Word looks a style up by the name declared here, and so does every reader that
 * converts the file afterwards — mammoth turns `Heading 1` into an `<h1>` because
 * this line says so. Without it the paragraphs are bold text, which looks right in
 * Word and is nothing at all to anything else.
 */
const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
</w:styles>`;

function docxDocument(spec: GeneratedFileSpec, meta: { label: string; value: string }[]): string {
  const body: string[] = [paragraph(spec.title, { style: "Title" })];
  if (spec.description) body.push(paragraph(spec.description, { italic: true }));

  for (const entry of meta) {
    body.push(
      `<w:p>${run(`${entry.label}: `, { bold: true })}${run(entry.value, {})}</w:p>`
    );
  }

  if (spec.limitations.length > 0) {
    body.push(paragraph("What this file does not cover", { style: "Heading2" }));
    for (const limitation of spec.limitations) body.push(paragraph(`- ${limitation}`));
  }

  for (const section of spec.sections) {
    body.push(paragraph(section.heading, { style: "Heading1" }));
    for (const line of section.lines) body.push(paragraph(line));
  }

  if (spec.notes.length > 0) {
    body.push(paragraph("Notes on this file", { style: "Heading2" }));
    for (const note of spec.notes) body.push(paragraph(`- ${note}`));
  }

  const sectionProperties =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body.join("")}${sectionProperties}</w:body></w:document>`;
}

async function buildDocx(spec: GeneratedFileSpec, meta: { label: string; value: string }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlText(spec.title)}</dc:title>
<dc:creator>Sharm Dreams Group talent portal</dc:creator>
<cp:lastModifiedBy>Sharm Dreams Group talent portal</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`
  );
  zip.file("word/styles.xml", DOCX_STYLES);
  zip.file("word/document.xml", docxDocument(spec, meta));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* -------------------------------------------------------------- reader -- */

/** One line per table or section, so the card says what the file holds. */
function contentsOf(spec: GeneratedFileSpec): string[] {
  const lines =
    spec.format.shape === "table"
      ? spec.sheets.map(
          (sheet: GeneratedSheet) =>
            `${sheet.name} — ${sheet.rows.length.toLocaleString("en-GB")} row${
              sheet.rows.length === 1 ? "" : "s"
            } × ${sheet.columns.length} column${sheet.columns.length === 1 ? "" : "s"}`
        )
      : spec.sections.map(
          (section) => `${section.heading} — ${section.lines.length} line${section.lines.length === 1 ? "" : "s"}`
        );

  if (lines.length <= MAX_CONTENT_LINES) return lines;

  const unit = spec.format.shape === "table" ? "sheet" : "section";
  const held = lines.length - MAX_CONTENT_LINES;
  return [...lines.slice(0, MAX_CONTENT_LINES), `… ${held} more ${held === 1 ? unit : `${unit}s`}`];
}

/* --------------------------------------------------------------- router -- */

/**
 * Turn a checked spec into a file, and say what it turned into.
 *
 * Throws `GeneratedFileError` with a sentence the model can act on. Every other
 * failure is returned as a note, because a file that exists with a warning on the
 * card is worth more to a recruiter than a refusal.
 */
export async function writeAssistantFile(spec: GeneratedFileSpec): Promise<GeneratedFileManifest> {
  const meta = headerMeta(spec);
  const format = spec.format.format;

  let bytes: Uint8Array;
  let contentType = spec.format.contentType;

  if (format === "csv" || format === "xlsx" || format === "pdf") {
    const document = toExportDocument(spec, meta);
    const file = await buildExport(document, format as ExportFormat);
    bytes = file.bytes;
    contentType = file.contentType;
  } else if (format === "json") {
    bytes = buildJson(spec, meta);
  } else if (format === "docx") {
    bytes = await buildDocx(spec, meta);
  } else {
    bytes = new TextEncoder().encode(`${textLines(spec, meta).join("\r\n")}\r\n`);
  }

  const notes = [...spec.notes];

  if (format === "pdf") {
    if (needsFontNote(toExportDocument(spec, meta))) {
      notes.push(
        "The PDF font cannot print Arabic or other non-Latin script, so those letters are printed as ?. Ask for the Excel or CSV copy for the exact spelling."
      );
    }
    notes.push("PDF columns are clipped to fit the page, not wrapped — the full text of a long cell is in the Excel or CSV copy.");
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new GeneratedFileError(
      `The ${spec.format.label} came out at ${formatBytes(bytes.byteLength)}, over the ${formatBytes(
        MAX_FILE_BYTES
      )} a file built in this chat may reach. Write fewer rows — keep the ones the answer already names, or send the rest as a second file.`
    );
  }

  return {
    format,
    label: spec.format.label,
    fileName: `${spec.baseName}${spec.format.extension}`,
    contentType,
    title: spec.title,
    bytes: bytes.byteLength,
    data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
    contents: contentsOf(spec),
    notes,
    spec,
  };
}
