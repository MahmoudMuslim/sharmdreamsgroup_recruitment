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
  findMasterRow,
  foldRowKey,
  masterRowKey,
  type MasterRowKey,
  type MasterRowLike,
} from "./masterDataLists";
import type { MasterEntity } from "./types";

/** A vocabulary row as the writer reads it: the list itself plus its in-use flag. */
export type FilingRow = MasterRowLike & { is_active?: boolean | null };

/** The four lists an opening names. Skills and role families are not on a job. */
export type FiledEntity = "companies" | "departments" | "locations" | "currencies";

/** The four, in the order a desk and a chat answer list them. */
export const FILED_ENTITIES: readonly FiledEntity[] = [
  "companies",
  "departments",
  "locations",
  "currencies",
];

/** Narrows the free text a chat or a URL carries to one of the four lists. */
export function isFiledEntity(value: unknown): value is FiledEntity {
  return typeof value === "string" && (FILED_ENTITIES as readonly string[]).includes(value);
}

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

/** The longest option list one refusal quotes; the rest are counted, not listed. */
const OPTIONS_SHOWN = 8;

/** The live rows of the list, in the order the console shows them. */
function liveNames(entity: MasterEntity, rows: FilingRow[], by: MasterRowKey): string[] {
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => masterRowKey(entity, row, by))
    .filter(Boolean);
}

/** The names a refusal quotes — bounded, with the remainder counted. */
function optionWords(names: string[]): string {
  if (names.length <= OPTIONS_SHOWN) return names.join(", ");
  const head = names.slice(0, OPTIONS_SHOWN).join(", ");
  return `${head}, … and ${names.length - OPTIONS_SHOWN} more`;
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
  by?: MasterRowKey;
  stored?: string | null;
}): FilingMatch {
  const by = input.by ?? "name";
  const wanted = String(input.submitted ?? "").trim();
  const hit = findMasterRow(input.entity, input.rows, wanted, by);
  if (hit && hit.is_active !== false) {
    return {
      status: "live",
      value: masterRowKey(input.entity, hit, by),
      shown: masterRowKey(input.entity, hit, "name"),
    };
  }

  // Checked before the retired refusal, because this is the recruiter leaving their
  // own history alone: the row they are saving already carries the value, so nothing
  // new is being filed under the retired name.
  const stored = String(input.stored ?? "").trim();
  if (stored && foldRowKey(wanted) === foldRowKey(stored)) {
    return { status: "unchanged", value: stored, shown: stored };
  }

  if (hit) {
    return {
      status: "retired",
      value: masterRowKey(input.entity, hit, by),
      shown: masterRowKey(input.entity, hit, "name"),
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
  by: MasterRowKey = "name"
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
 * the master-data "in use" counts line up with the rows they name. `shown` is the
 * same row in the words a person reads, because a refile that reports
 * "moved onto 8f2c1b9a-…" promises something nobody checked.
 */
export function resolveFiling(input: {
  entity: MasterEntity;
  rows: FilingRow[];
  submitted: string;
  by?: MasterRowKey;
  stored?: string | null;
}): { ok: true; name: string; shown: string } | { ok: false; error: string } {
  const by = input.by ?? "name";
  const submitted = String(input.submitted ?? "").trim();
  const match = matchFiling({ ...input, by, submitted });
  if (match.status === "live" || match.status === "unchanged") {
    return { ok: true, name: match.value, shown: match.shown };
  }
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
  by?: MasterRowKey;
}): string | null {
  const by = input.by ?? "name";
  const value = String(input.value ?? "").trim();
  if (!value) return null;
  const hit = findMasterRow(input.entity, input.rows, value, by);
  if (hit && hit.is_active !== false) return null;

  // A retired row is named for what it is. A value the list never held is quoted
  // back exactly as the record has it, because that is all anybody has to go on —
  // except a company, where the stored text is an id no recruiter reads.
  if (!hit) {
    const shown = by === "id" ? `${value.slice(0, 8)}…` : value;
    return `${shown} — not in the ${MASTER_LIST_WORDS[input.entity]} list`;
  }
  return `${masterRowKey(input.entity, hit, "name")} — retired, kept only because this role already uses it`;
}

/* ------------------------------- Filing drift ------------------------------- */

/**
 * Why a value already stored on a record is not the vocabulary's own words.
 *
 * `spelling` is the mildest: the list holds the row, and the record spells it
 * differently ("finance & investment", "usd"). `retired` means the row exists but is
 * out of use, so the list no longer offers it anywhere. `off_list` is the one an
 * applicant reads as a second department: the list never held that text at all.
 */
export type DriftState = "spelling" | "retired" | "off_list";

/** One record's filed value, with the record kept alongside it. */
export interface DriftEntry<T> {
  value: string | null | undefined;
  record: T;
}

/** One drifting value, and every record that carries it. */
export interface DriftGroup<T> {
  /** The text as the records hold it, trimmed; `""` when they hold nothing. */
  value: string;
  state: DriftState;
  /** What to write to fix it — the id, the code, the row's own name. Null when no row owns it. */
  canonical: string | null;
  /** The same thing a person reads: the row's name, never an id or a bare code. */
  shown: string | null;
  records: T[];
}

/**
 * A stored value quoted back to a person.
 *
 * A company is filed by id, so a uuid is the only thing the record holds; a desk and
 * a trail row that print it whole read as noise, and shortening it keeps the digits
 * that distinguish one row from another. A blank is named as one, because an empty
 * quote looks like a bug in the sentence rather than a missing filing.
 */
export function storedFilingLabel(value: string, by: MasterRowKey): string {
  const stored = String(value ?? "").trim();
  if (!stored) return "(blank)";
  return by === "id" ? `${stored.slice(0, 8)}…` : stored;
}

/**
 * Every stored value the list does not carry as written, grouped and counted.
 *
 * This is the other half of the rule `matchFiling` enforces on a write: the writer
 * refuses new drift, and this names the drift the seeds left behind so a recruiter
 * can see it and move it. Values that agree with the list character for character are
 * left out — the desk reports exceptions, not the whole vocabulary.
 */
export function filingDrift<T>(input: {
  entity: FiledEntity;
  rows: FilingRow[];
  entries: DriftEntry<T>[];
  by?: MasterRowKey;
}): DriftGroup<T>[] {
  const by = input.by ?? "name";
  const groups = new Map<string, DriftGroup<T>>();

  for (const { value, record } of input.entries) {
    const stored = String(value ?? "").trim();
    const hit = findMasterRow(input.entity, input.rows, stored, by);

    let state: DriftState;
    let canonical: string | null = null;
    let shown: string | null = null;
    if (!hit) {
      state = "off_list";
      // An id nobody recognises is still what the record holds; a screen quoting it
      // short reads better than a uuid, and there is no row left to name it. A name
      // the list never held is quoted exactly, because that is all anybody has.
      shown = by === "id" ? storedFilingLabel(stored, by) : null;
    } else if (hit.is_active === false) {
      state = "retired";
      canonical = masterRowKey(input.entity, hit, by);
      shown = masterRowKey(input.entity, hit, "name");
    } else if (stored === masterRowKey(input.entity, hit, by)) {
      // The record says exactly what the list says.
      continue;
    } else {
      state = "spelling";
      canonical = masterRowKey(input.entity, hit, by);
      shown = masterRowKey(input.entity, hit, "name");
    }

    const key = `${state}\u0000${stored}`;
    const group = groups.get(key) ?? { value: stored, state, canonical, shown, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }

  return [...groups.values()].sort(
    (a, b) => b.records.length - a.records.length || a.value.localeCompare(b.value)
  );
}

/** The one line a screen, a trail row and a chat answer all print for a drifting value. */
export function driftWords<T>(entity: FiledEntity, group: DriftGroup<T>): string {
  const list = MASTER_LIST_WORDS[entity];
  if (!group.value) return `These records file no ${list} at all.`;
  if (group.state === "spelling") {
    return `“${group.value}” is the ${list} row the list itself spells “${group.shown}”.`;
  }
  if (group.state === "retired") {
    return `“${group.shown}” is on the ${list} list but retired, so nothing new may be filed under it.`;
  }
  // A company is filed by id, so the text nobody recognises is a uuid; `shown` is
  // the desk's shortened form of the very same value, quoted rather than dropped
  // because it is all anybody has to go on.
  const quoted = group.shown ?? group.value;
  return `“${quoted}” is not on the ${list} list at all.`;
}

/**
 * How wide a drift count was taken, in the line under the heading.
 *
 * Read through the staff client, so the figure is the openings *this* account can
 * see — a desk that stayed quiet about that would read as the whole portal.
 */
export function driftScopeSentence(openings: number): string {
  return `Counted over ${openings.toLocaleString()} ${
    openings === 1 ? "opening" : "openings"
  } this account can see.`;
}

/** What a desk and a chat answer say when the count came back with nothing to move. */
export function noDriftSentence(openings: number): string {
  return `Nothing is filed outside the list: all ${openings.toLocaleString()} ${
    openings === 1 ? "opening reads" : "openings read"
  } it as written.`;
}

/** The destinations a refile may choose, in the list's order, live rows only. */
export function filingChoices(
  entity: FiledEntity,
  rows: FilingRow[],
  by: MasterRowKey = "name"
): { value: string; label: string }[] {
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => ({
      value: masterRowKey(entity, row, by),
      // The row's own words, which for a currency already carry the code
      // ("USD US Dollar") because that is how the console prints the row everywhere
      // else — joining code and name here would read "USD — USD US Dollar".
      label: masterRowKey(entity, row, "name"),
    }))
    .filter((choice) => choice.value);
}

/**
 * What a refile did, in the words the trail keeps and the chat repeats.
 *
 * The count is the caller's, because it is the number of records the write actually
 * moved — which is the only figure that can be promised to match the rows named.
 */
export function refileSentence(
  entity: FiledEntity,
  fromShown: string,
  toShown: string,
  count: number
): string {
  const list = MASTER_LIST_WORDS[entity];
  return `Filed ${count} ${count === 1 ? "opening" : "openings"} from “${fromShown}” onto “${toShown}” in the ${list} list.`;
}
