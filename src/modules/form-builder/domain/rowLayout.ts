/**
 * How wide a field is, and what may sit beside it (the layout the form asks in).
 *
 * `resolveLayout` still owns the *order* — one list, one position per field —
 * and this module owns only the shape each field takes inside a row. That
 * separation is why a re-layout is harmless: a width lives in the field's own
 * `config` jsonb, so no key, position or stored answer moves when an author
 * pairs two questions up.
 *
 * The grid is six columns wide because six divides by two and three, so a
 * half and a third both land on whole columns and never share one. CSS
 * auto-placement packs the rows: the fields fill left to right and a `full`
 * after a `half` starts a new row by itself. No container, no column block —
 * the ordering model stays one list.
 *
 * Six types are always full width, and the reason is the answer they take, not
 * their looks: a heading divides the form, a long-text box is written in, a
 * file or photo is an upload door with a byte ceiling under it, an address is
 * six inputs, a geolocation pick is a map. Cutting any of those in half asks
 * the candidate to write into a box the author never saw.
 *
 * Mobile is the second reason the widths are advisory: below the `sm` break
 * every field takes all six columns, so a phone gets one question per row no
 * matter how a recruiter arranged them on a desktop.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

import type { FieldType } from "./field-types";

export type FieldWidth = "full" | "half" | "third";

/** The only three widths an author may pick, in the order the control shows them. */
export const FIELD_WIDTHS: readonly FieldWidth[] = ["full", "half", "third"];

/** Six columns, so 1/2 and 1/3 both land on whole columns. */
export const GRID_COLUMNS = 6;

/** The container every row of fields sits in; the surfaces add their own gap. */
export const GRID_CLASS = "grid grid-cols-6";

/**
 * The class one width takes. Written as literals, not built from the number:
 * Tailwind generates a class only for a string it can see in the source, so an
 * interpolated `col-span-${n}` would ship a layout that silently never applies.
 */
export const SPAN_CLASS: Record<FieldWidth, string> = {
  full: "col-span-6",
  half: "col-span-6 sm:col-span-3",
  third: "col-span-6 sm:col-span-2",
};

export const ALWAYS_FULL_TYPES: ReadonlySet<FieldType> = new Set([
  "section_heading",
  "long_text",
  "file",
  "photo",
  "address",
  "geolocation",
]);

/**
 * The width a field asks for.
 *
 * A field that names no width — every field written before this existed, and
 * every field whose type was switched and its config reset — reads as `full`,
 * which is exactly how it renders today. A width that is not one of the three
 * is treated as absent rather than guessed at, so a hand-edited config cannot
 * put a question into a column nobody designed.
 */
export function widthOf(
  field: { type: FieldType; config?: Record<string, unknown> | null },
): FieldWidth {
  if (ALWAYS_FULL_TYPES.has(field.type)) return "full";
  const raw = field.config?.width;
  return (FIELD_WIDTHS as readonly string[]).includes(String(raw))
    ? (raw as FieldWidth)
    : "full";
}

/** One side of a pairing, named the way the author named it. */
export interface PairSide {
  type: FieldType;
  label: string;
}

export interface PairTarget extends PairSide {
  width: FieldWidth;
}

export type PairOutcome =
  | { ok: true; dragged: FieldWidth; target: FieldWidth; notice: string }
  | { ok: false; error: string };

const wholeRowSentence = (side: PairSide) =>
  `"${side.label}" takes a whole row, so nothing can be asked beside it.`;

/**
 * What the pair looks like after one field is dropped beside another, and what
 * the author is told about it.
 *
 * The dragged field takes the target's width, because the row the author is
 * aiming at is already that shape. A full target halves itself: leaving it full
 * would push the dragged field onto the next row and the author would see a
 * pairing that did not happen.
 *
 * A refusal is the sentence itself, because which of the two fields takes the
 * whole row is the fact the author needs — the live proof of this feature
 * dropped a file onto a URL field and was told the *URL* field takes a whole
 * row. The row it lands on is answered first: it is the one the pointer is on.
 */
export function beside(input: {
  dragged: PairSide;
  target: PairTarget;
}): PairOutcome {
  if (ALWAYS_FULL_TYPES.has(input.target.type)) {
    return { ok: false, error: wholeRowSentence(input.target) };
  }
  if (ALWAYS_FULL_TYPES.has(input.dragged.type)) {
    return { ok: false, error: wholeRowSentence(input.dragged) };
  }
  const width: FieldWidth = input.target.width === "third" ? "third" : "half";
  return {
    ok: true,
    dragged: width,
    target: width,
    notice: `"${input.target.label}" and "${input.dragged.label}" are asked in one row.`,
  };
}
