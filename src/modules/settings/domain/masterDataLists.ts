/**
 * The Settings master-data lists, in the shape both the console and the chat read.
 *
 * Six controlled vocabularies — companies, departments, locations, role families,
 * skills, currencies — back every picker in the portal. `/settings` shows them one
 * list at a time (`?section=`, the section named in the left dock), and it lists
 * every row including the retired ones, because a retired row is still pointed at
 * by the openings, candidates and reports written while it was in use, and the only
 * way to see it again is the list it stayed on.
 *
 * The assistant's read is now built the same way, for two reasons measured against
 * the live database rather than guessed:
 *
 * 1. One call used to return all six lists at once — 72 rows, 6641 characters of
 *    JSON handed to a 6000-character clip. The result was cut mid-row, so the model
 *    read a shorter list than existed and reported it as the whole vocabulary. The
 *    last currencies in particular never arrived, while `create_job` tells the model
 *    to call this read for a valid currency.
 * 2. That call filtered `is_active = true`, so a row the chat had just retired with
 *    `delete_master_record` was invisible to the chat forever after: it could not
 *    name it, count it, or bring it back — while the console listed it with a
 *    Reactivate button. A read that cannot see what its own write produced is the
 *    defect this programme keeps fixing.
 *
 * A retired row is not a deleted row, and nothing here pretends otherwise:
 * `delete_master_record` flips `is_active` to `false`, `save_master_record` flips it
 * back, and the note below says which rows are retired and what that costs.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console,
 * the server-side reads and the assistant registry can all import it.
 */

import type { Company, Currency, Location, MasterEntity, Skill } from "./types";

/** The six lists, in the order the settings dock shows them. */
export const MASTER_LIST_ORDER: readonly MasterEntity[] = [
  "companies",
  "departments",
  "locations",
  "role_families",
  "skills",
  "currencies",
];

/** The list a recruiter recognises, in the words the console and the trail use. */
export const MASTER_LIST_WORDS: Record<MasterEntity, string> = {
  companies: "companies",
  departments: "departments",
  locations: "locations",
  role_families: "role families",
  skills: "skills",
  currencies: "currencies",
};

/** One row of a list, as the read carries it. */
export type MasterRowLike = {
  id?: string;
  name?: string | null;
  label?: string | null;
  key?: string | null;
  code?: string | null;
  is_active?: boolean | null;
};

/**
 * The list a parameter or a tool argument names, or `null` for none.
 *
 * A link builder interpolates this value into a URL, so anything the six lists do
 * not recognise has to read as "no list" rather than as a string that belongs in an
 * address — the same rule every other console on this page follows for its own
 * parameters.
 */
export function masterListEntity(value: unknown): MasterEntity | null {
  const words = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MASTER_LIST_ORDER.includes(words as MasterEntity) ? (words as MasterEntity) : null;
}

/**
 * A row as a person would name it in a sentence.
 *
 * Currencies are the one list whose display name is two columns — `EGP` is what a
 * job stores and `Egyptian Pound` is what the console prints — so both are quoted
 * and a recruiter recognising either can tell the read found the right row.
 */
export function masterRowName(entity: MasterEntity, row: MasterRowLike): string {
  if (entity === "currencies") {
    return `${String(row.code ?? "")} ${String(row.label ?? "")}`.trim() || "a currency";
  }
  return String(row.label ?? row.name ?? row.key ?? "a record");
}

/**
 * The row of a list the chat is allowed to write into a record.
 *
 * The fields are the ones the job, candidate and assessment forms actually store:
 * a company by `id`, a department or location by its `name` as text, a currency by
 * its `code`. Nothing else is sent, because the clip that cuts a long result is
 * unforgiving and a description column has never been needed to file a record.
 */
export function projectMasterRow(entity: MasterEntity, row: MasterRowLike): Record<string, unknown> {
  const is_active = row.is_active !== false;
  switch (entity) {
    case "companies":
      return {
        id: row.id,
        name: row.name ?? null,
        sector: (row as Company).sector ?? null,
        is_active,
      };
    case "departments":
      return { id: row.id, name: row.name ?? null, is_active };
    case "locations":
      return {
        id: row.id,
        name: row.name ?? null,
        city: (row as Location).city ?? null,
        is_active,
      };
    case "role_families":
      return {
        id: row.id,
        key: row.key ?? null,
        label: row.label ?? null,
        is_active,
      };
    case "skills":
      return {
        id: row.id,
        name: row.name ?? null,
        category: (row as Skill).category ?? null,
        is_active,
      };
    case "currencies":
      return {
        id: row.id,
        code: row.code ?? null,
        symbol: (row as Currency).symbol ?? null,
        label: row.label ?? null,
        is_active,
      };
    default:
      return { id: row.id, is_active };
  }
}

/** Every row of one list, projected, from the bundle the settings page loads. */
export function projectMasterList(
  entity: MasterEntity,
  bundle: Record<string, unknown>
): Record<string, unknown>[] {
  const key = BUNDLE_KEY[entity];
  const rows = (bundle[key] as MasterRowLike[] | undefined) ?? [];
  return rows.map((row) => projectMasterRow(entity, row));
}

/** `getMasterData()` keys its lists in camelCase; the entity ids do not. */
const BUNDLE_KEY: Record<MasterEntity, string> = {
  companies: "companies",
  departments: "departments",
  locations: "locations",
  role_families: "roleFamilies",
  skills: "skills",
  currencies: "currencies",
};

/** What one member of a list is called, for a sentence that names a single row. */
const SINGULAR: Record<MasterEntity, string> = {
  companies: "company",
  departments: "department",
  locations: "location",
  role_families: "role family",
  skills: "skill",
  currencies: "currency",
};

/**
 * What one list answer is standing on.
 *
 * Four facts, in the order a recruiter needs them: how many rows the list holds and
 * that none of them were left out, which rows are retired and what being retired
 * costs, how to bring one back, and what else exists that this call did not read.
 *
 * The "none left out" clause is the point of the whole design: this read is scoped
 * by list, never by a caller-chosen limit, so an answer about a vocabulary can be
 * trusted to name every member of it. Naming the other lists and their counts is
 * what lets the model decide to ask for one rather than guess that nothing else
 * exists.
 */
export function masterListNote(input: {
  entity: MasterEntity;
  rows: MasterRowLike[];
  counts: Partial<Record<MasterEntity, number>>;
}): string {
  const { entity, rows, counts } = input;
  const words = MASTER_LIST_WORDS[entity];
  const retired = rows.filter((row) => row.is_active === false);
  const inUse = rows.length - retired.length;
  const rowWord = (value: number) => `${value.toLocaleString()} ${value === 1 ? "row" : "rows"}`;

  if (rows.length === 0) {
    return `The ${words} list is empty — nothing has been added there, so no record can name a ${SINGULAR[entity]}. Add one with save_master_record before any opening or candidate uses it.`;
  }

  const head = retired.length === 0
    ? `${words} — ${rowWord(rows.length)}, all in use. This is the whole list: nothing was left out, and no rows are retired.`
    : `${words} — ${rowWord(rows.length)}: ${inUse} in use, ${retired.length} ${
        retired.length === 1 ? "row is" : "rows are"
      } retired (${retired.map((row) => masterRowName(entity, row)).join(", ")}). This is the whole list, retired rows included.`;

  const retiredClause =
    retired.length === 0
      ? null
      : ` A retired ${SINGULAR[entity]} still resolves the records that already point at it, and the console lists it with a Retired badge — but the job and assessment pickers leave it out, so do not put a retired ${SINGULAR[entity]} in a new opening. Bring one back with save_master_record (fields {\"is_active\": true}).`;

  const others = MASTER_LIST_ORDER.filter((each) => each !== entity && counts[each] !== undefined);
  const beside =
    others.length === 0
      ? ""
      : ` Read one list per call: ${others
          .map((each) => `${MASTER_LIST_WORDS[each]} (${counts[each]!.toLocaleString()})`)
          .join(", ")}.`;

  return `${head}${retiredClause}${beside}`;
}

/** Row-count-per-list, from the bundle the settings page loads. */
export function masterListCounts(bundle: Record<string, unknown>): Record<MasterEntity, number> {
  return Object.fromEntries(
    MASTER_LIST_ORDER.map((entity) => [
      entity,
      ((bundle[BUNDLE_KEY[entity]] as MasterRowLike[] | undefined) ?? []).length,
    ])
  ) as Record<MasterEntity, number>;
}
