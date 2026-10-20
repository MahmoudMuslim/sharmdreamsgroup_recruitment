/**
 * The PDF an offer email attaches.
 *
 * The `offer_letter` copy has always closed with "The formal documents are
 * attached." while the mailer had no attachments at all, so the one sentence in
 * the candidate-facing letters that promised a document was never true. This is
 * that document: the same text the candidate reads in the email, set on A4, so
 * the letter and the message cannot disagree about the offer.
 *
 * It is generated at send time rather than stored on the record. A real offer
 * needs terms a recruiter typed — salary, start date, reporting line — and the
 * schema has no column for any of them, so an editable document would mean a
 * table, an upload door and a preview. What the portal can honestly print today
 * is the letter it already wrote.
 */

import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * The WinAnsi guard the portal's report PDFs already use. Two tables for one
 * job is how one of them drifts, and a name printed as `?` has to break the
 * same way here as it does in a hiring report. It collapses whitespace runs, so
 * every line is split into paragraphs before it is passed in.
 */
import { printable } from "@/modules/analytics/domain/exportDocument";

export interface OfferLetterInput {
  companyName: string;
  candidateName: string;
  jobTitle: string;
  /** Already rendered — placeholders replaced — the exact text of the email. */
  body: string;
  /** Date line, formatted in the organisation's own timezone by the caller. */
  issuedOn: string;
}

export interface OfferLetter {
  filename: string;
  contentType: "application/pdf";
  bytes: Uint8Array;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 64;
/** Stop text this far from the foot of the page — the footer draws below it. */
const FOOT = MARGIN + 34;
const BODY_SIZE = 11;
const LEADING = 16;
const PARAGRAPH_GAP = 10;
const GREY = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.12, 0.14, 0.18);
/** The portal's gold accent, the same one the candidate emails are styled with. */
const GOLD = rgb(0.69, 0.55, 0.25);

/** A word wider than the column — a long URL — cut rather than run off the page. */
function splitLongWord(font: PDFFont, word: string, width: number): string[] {
  if (font.widthOfTextAtSize(word, BODY_SIZE) <= width) return [word];

  const parts: string[] = [];
  let current = "";
  for (const character of word) {
    if (current && font.widthOfTextAtSize(current + character, BODY_SIZE) > width) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrap(font: PDFFont, line: string, width: number): string[] {
  const out: string[] = [];
  let current = "";

  for (const word of line.split(" ").filter(Boolean)) {
    const pieces = splitLongWord(font, word, width);
    for (const [index, piece] of pieces.entries()) {
      if (!current) {
        current = piece;
        continue;
      }
      /* Only a whole word may join the line being built; a piece cut out of a
       * longer word starts a line of its own. */
      const joins =
        index === 0 && font.widthOfTextAtSize(`${current} ${piece}`, BODY_SIZE) <= width;
      if (joins) {
        current = `${current} ${piece}`;
        continue;
      }
      out.push(current);
      current = piece;
    }
  }

  if (current) out.push(current);
  return out;
}

/**
 * A file name every mail client will accept.
 *
 * Deliberately not passed through `printable`: that guard exists because the
 * PDF *font* cannot draw Arabic, but a file name is encoded by the mailer
 * (RFC 2231) and a client that supports it prints the candidate's own spelling.
 */
function letterFilename(candidateName: string, jobTitle: string): string {
  const clean = (value: string) =>
    value
      .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);

  const name = clean(candidateName) || "candidate";
  const role = clean(jobTitle);
  return `Offer letter - ${name}${role ? ` - ${role}` : ""}.pdf`.slice(0, 96);
}

export async function buildOfferLetter(input: OfferLetterInput): Promise<OfferLetter> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const title = "Offer of Employment";
  const company = printable(input.companyName);

  pdf.setTitle(`${company} — ${title}`);
  pdf.setAuthor(company);
  pdf.setSubject(`${title} for ${printable(input.candidateName)} — ${printable(input.jobTitle)}`);
  pdf.setCreator("Sharm Dreams Group talent portal");

  const usableWidth = A4.width - MARGIN * 2;
  let page = pdf.addPage([A4.width, A4.height]);
  let cursor = A4.height - MARGIN;

  page.drawText(company, { x: MARGIN, y: cursor - 13, size: 13, font: bold, color: INK });
  cursor -= 28;
  page.drawLine({
    start: { x: MARGIN, y: cursor },
    end: { x: A4.width - MARGIN, y: cursor },
    thickness: 1.5,
    color: GOLD,
  });
  cursor -= 36;
  page.drawText(title, { x: MARGIN, y: cursor, size: 20, font: bold, color: INK });
  cursor -= 17;
  page.drawText(printable(`Dated ${input.issuedOn}`), {
    x: MARGIN,
    y: cursor,
    size: 9,
    font,
    color: GREY,
  });
  cursor -= 30;

  for (const paragraph of input.body.split(/\n{2,}/)) {
    for (const hardLine of paragraph.split("\n")) {
      const text = printable(hardLine).trim();
      if (!text) continue;

      for (const line of wrap(font, text, usableWidth)) {
        if (cursor < FOOT) {
          page = pdf.addPage([A4.width, A4.height]);
          cursor = A4.height - MARGIN;
        }
        page.drawText(line, { x: MARGIN, y: cursor, size: BODY_SIZE, font, color: INK });
        cursor -= LEADING;
      }
    }
    cursor -= PARAGRAPH_GAP;
  }

  /* Footers last, so the page total is already known. */
  const pages = pdf.getPages();
  const footer = `${company} · ${title} · ${printable(input.candidateName)}`;
  pages.forEach((one, index) => {
    one.drawText(`${footer} · Page ${index + 1} of ${pages.length}`, {
      x: MARGIN,
      y: 22,
      size: 7.5,
      font,
      color: GREY,
    });
  });

  return {
    filename: letterFilename(input.candidateName, input.jobTitle),
    contentType: "application/pdf",
    bytes: new Uint8Array(await pdf.save()),
  };
}
