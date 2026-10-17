/**
 * Filling a hiring-data row with master data.
 *
 * `jobColumnsFrom` checked that a department, a location and a company were
 * *non-empty*, then wrote the text it was given. The pickers on the screen only
 * offer rows from the six vocabularies, so the human path was safe by accident —
 * but the assistant writes the same columns from text the model typed, and nothing
 * refused. Measured against the live database: 5 of the 7 openings — carrying 13 of
 * the 20 applicant rows — name a department or location the vocabulary does not
 * hold at all ("Finance" against "Finance & Investment", "Cairo, Egypt" against
 * "Cairo (Head Office)"). Those values came from seed rows written before the
 * master tables were populated, and the openings grid, the candidates drawer and
 * `list_jobs` all show them as if they were the vocabulary.
 *
 * So a filing is only accepted when it names a row the master data holds *and that
 * row is in use*. Two things follow, and both are deliberate:
 *
 * - A value that is not in the list is refused with the live names quoted, so the
 *   chat can correct itself in one turn instead of inventing a ninth spelling of
 *   "Operations". A match is read case-insensitively and written back in the
 *   vocabulary's own spelling, so "sales & marketing" lands as "Sales & Marketing"
 *   rather than as a second facet on the grid.
 * - An edit that leaves a field exactly as the row already holds it is accepted even
 *   when that value is retired or off-vocabulary. Refusing it would block the
 *   recruiter from fixing the opening's title or salary because of history they did
 *   not write; the console's drawer lists such a value as its own option instead.
 *
 * Pure by design — no database, no `server-only`, no clock — so the server action,
 * the client drawer and the assistant registry all read the same words.
 */

import {
  MASTER_LIST_WORDS,
  masterRowName,
  type MasterRowLike,
} from "./masterDataLists";
import type { MasterEntity } from "./types";

/** A vocabulary row as the writer reads it: the list itself plus its in-use flag. */
export type FilingRow = MasterRowLike & { is_active?: boolean | null };

/** The four lists an opening names. Skills and role families are not on a job. */
export type FiledEntity = "companies" | "departments" | "locations" | "currencies";

/** The four lists as one read carries them, retired rows included. */
export type FilingVocabularies = Record<FiledEntity, FilingRow[]>;

/**
 * How a submitted value relates to the list it was supposed to come from.
 *
 * `value` is what the record writes — the id, the code, the row's own spelling of its
 * name. `shown` is what a person is told, because a company id and a currency code
 * are not words a recruiter reads.
 */
export type FilingMatch =
  | { status: "live"; value: string; shown: string }
  | { status: "retired"; value: string; shown: string }
  | { status: "off_list" }
  | { status: "unchanged"; value: string; shown: string };

/**
 * Where the record stores the reference.
 *
 * A company is stored by id and a currency by its code; a department and a location
 * are stored as the text of the row's name, which is exactly why they can drift.
 */
export type FilingKey = "name" | "id" | "code";

/** The longest option list one refusal quotes; the rest are counted, not listed. */
const OPTIONS_SHOWN = 8;

/** The vocabulary's own words for one row, per key. */
function rowKey(entity: MasterEntity, row: FilingRow, by: FilingKey): string {
  if (by === "id") return String(row.id ?? "").trim();
  if (by === "code") return String(row.code ?? masterRowName(entity, row)).trim().toUpperCase();
  return masterRowName(entity, row).trim();
}

const fold = (text: string) => text.toLocaleLowerCase().trim();

/** The live rows of the list, in the order the console shows them. */
function liveNames(entity: MasterEntity, rows: FilingRow[], by: FilingKey): string[] {
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => rowKey(entity, row, by))
    .filter(Boolean);
}

/** The names a refusal quotes — bounded, with the remainder counted. */
function optionWords(names: string[]): string {
  if (names.length <= OPTIONS_SHOWN) return names.join(", ");
  const head = names.slice(0, OPTIONS_SHOWN).join(", ");
  return `${head}, … and ${names.length - OPTIONS_SHOWN} more`;
}

/**
 * The row a value points at, however it is spelled.
 *
 * A currency code is compared upper-case because that is how the column stores it;
 * everything else is matched case-insensitively and written back in the list's own
 * spelling, so "sales & marketing" cannot become a second facet on the grid. One
 * matcher for the write and the picker, so the screen can never offer an option the
 * action would refuse.
 */
function findRow(entity: MasterEntity, rows: FilingRow[], value: string, by: FilingKey): FilingRow | undefined {
  if (!value) return undefined;
  return rows.find((row) =>
    by === "code"
      ? rowKey(entity, row, by) === value.toUpperCase()
      : fold(rowKey(entity, row, by)) === fold(value)
  );
}

/**
 * Which row the submitted value points at, and whether it may be used.
 *
 * `stored` is what the record already holds. When the two agree the value passes as
 * `unchanged` whatever the list says, because that is the recruiter leaving history
 * alone, not filing new data under it.
 */
export function matchFiling(input: {
  entity: MasterEntity;
  rows: FilingRow[];
  submitted: string;
  by?: FilingKey;
  stored?: string | null;
}): FilingMatch {
  const by = input.by ?? "name";
  const wanted = String(input.submitted ?? "").trim();
  const hit = findRow(input.entity, input.rows, wanted, by);
  if (hit && hit.is_active !== false) {
    return {
      status: "live",
      value: rowKey(input.entity, hit, by),
      shown: rowKey(input.entity, hit, "name"),
    };
  }

  // Checked before the retired refusal, because this is the recruiter leaving their
  // own history alone: the row they are saving already carries the value, so nothing
  // new is being filed under the retired name.
  const stored = String(input.stored ?? "").trim();
  if (stored && fold(wanted) === fold(stored)) {
    return { status: "unchanged", value: stored, shown: stored };
  }

  if (hit) {
    return {
      status: "retired",
      value: rowKey(input.entity, hit, by),
      shown: rowKey(input.entity, hit, "name"),
    };
  }
  return { status: "off_list" };
}

/** The one sentence a recruiter or the model has to work with, in the list's words. */
export function filingRefusal(
  entity: MasterEntity,
  submitted: string,
  match: FilingMatch,
  rows: FilingRow[],
  by: FilingKey = "name"
): string {
  const list = MASTER_LIST_WORDS[entity];
  // An id-keyed list is refused in the names a person recognises; the id is only
  // ever the thing they were trying to write.
  const names = liveNames(entity, rows, by === "id" ? "name" : by);
  const inUse = names.length
    ? `In use: ${optionWords(names)}.`
    : `The ${list} list holds no rows in use at all, so nothing can be filed under it yet.`;
  const readFirst = names.length
    ? ` Read them with get_master_data (${entity}) or in Settings → Organisation.`
    : ` Add one with save_master_record (${entity}) or in Settings → Organisation.`;

  if (match.status === "retired") {
    return `“${match.shown}” is on the ${list} list but retired, so a role cannot be filed under it. ${inUse}${
      names.length
        ? " Reactivate it in Settings → Organisation, or pick one of those."
        : " Reactivate it, or add a row, in Settings → Organisation."
    }`;
  }
  if (entity === "currencies") {
    return `Currency “${submitted}” is not set up. ${inUse} Add it in Settings → Organisation → Currencies.`;
  }
  return `“${submitted}” is not one of the ${list} the master data holds. ${inUse}${readFirst}${
    by === "id" ? " File the company's id, which get_master_data (companies) returns as id." : ""
  }`;
}

/**
 * The value to write, or the refusal.
 *
 * `name` is the vocabulary's own spelling, which is what makes the grid's facets and
 * the master-data "in use" counts line up with the rows they name.
 */
export function resolveFiling(input: {
  entity: MasterEntity;
  rows: FilingRow[];
  submitted: string;
  by?: FilingKey;
  stored?: string | null;
}): { ok: true; name: string } | { ok: false; error: string } {
  const by = input.by ?? "name";
  const submitted = String(input.submitted ?? "").trim();
  const match = matchFiling({ ...input, by, submitted });
  if (match.status === "live" || match.status === "unchanged") return { ok: true, name: match.value };
  return { ok: false, error: filingRefusal(input.entity, submitted, match, input.rows, by) };
}

/**
 * The drawer's label for a value the picker no longer offers, or `null`.
 *
 * The console's pickers list active rows only, so an opening that still holds a
 * retired or legacy value renders its `<select>` as "Select department…" while the
 * form keeps the text underneath — the screen reads as if the field had been
 * cleared. Handing the drawer this label gives the value an option of its own,
 * worded in the same terms as the refusal a write would return.
 */
export function filingGhostLabel(input: {
  entity: FiledEntity;
  rows: FilingRow[];
  value: string | null | undefined;
  by?: FilingKey;
}): string | null {
  const by = input.by ?? "name";
  const value = String(input.value ?? "").trim();
  if (!value) return null;
  const hit = findRow(input.entity, input.rows, value, by);
  if (hit && hit.is_active !== false) return null;

  // A retired row is named for what it is. A value the list never held is quoted
  // back exactly as the record has it, because that is all anybody has to go on —
  // except a company, where the stored text is an id no recruiter reads.
  if (!hit) {
    const shown = by === "id" ? `${value.slice(0, 8)}…` : value;
    return `${shown} — not in the ${MASTER_LIST_WORDS[input.entity]} list`;
  }
  return `${rowKey(input.entity, hit, "name")} — retired, kept only because this role already uses it`;
}
