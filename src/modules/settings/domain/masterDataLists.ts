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
 * How a record stores the reference to a row.
 *
 * `name` is the words on the row, `code` is the currency's ISO short form and `id`
 * is a company's uuid. A write that keys by `name` stores text, which is exactly why
 * an opening can drift away from the vocabulary that names it.
 */
export type MasterRowKey = "name" | "id" | "code";

/** The row in the shape a record addresses it by. */
export function masterRowKey(
  entity: MasterEntity,
  row: MasterRowLike,
  by: MasterRowKey = "name"
): string {
  if (by === "id") return String(row.id ?? "").trim();
  if (by === "code") return String(row.code ?? masterRowName(entity, row)).trim().toUpperCase();
  return masterRowName(entity, row).trim();
}

/** Two names that read alike to a person, however each was typed. */
export function foldRowKey(text: string): string {
  return text.toLocaleLowerCase().trim();
}

/**
 * The row of a list a value points at, however it is spelled.
 *
 * A currency code is compared upper-case because that is how the column stores it;
 * everything else is matched case-insensitively and written back in the list's own
 * spelling. One matcher for the write door, the picker and the drift desk, so the
 * screen can never offer an option the action would refuse — and never refuse one it
 * would accept.
 */
export function findMasterRow(
  entity: MasterEntity,
  rows: MasterRowLike[],
  value: string,
  by: MasterRowKey = "name"
): MasterRowLike | undefined {
  if (!value) return undefined;
  return rows.find((row) =>
    by === "code"
      ? masterRowKey(entity, row, by) === value.toUpperCase()
      : foldRowKey(masterRowKey(entity, row, by)) === foldRowKey(value)
  );
}

/**
 * Another member of the list that already goes by the same words.
 *
 * What the database blocks is not what a record reads. Skills, currencies and role
 * families are unique on their key column, but case-sensitively, so “excel” joins
 * “Excel”; a company is unique on its derived slug; a department is unique only where
 * its slug and its tenant scope both match, and a location only where its name *and*
 * its city match — so a group-wide “Finance” beside a company’s “Finance”, or a
 * “Downtown” in two cities, are all accepted rows. Every reader of those lists ignores
 * the difference: `findMasterRow` scans the whole list case-insensitively and returns
 * the first hit, so once two rows share the words, the list’s own order decides which
 * one a record means — and a job stores only the words, never the city or the tenant.
 *
 * Compared on the row's words rather than its key, because that is what a recruiter
 * reads: two companies with different uuids and the same name are as indistinguishable
 * from the console as two departments are.
 */
export function findListTwin(
  entity: MasterEntity,
  rows: MasterRowLike[],
  value: string,
  exceptId?: string
): MasterRowLike | null {
  const wanted = foldRowKey(String(value ?? "").trim());
  if (!wanted) return null;
  return (
    rows.find(
      (row) => row.id !== exceptId && foldRowKey(masterRowName(entity, row)) === wanted
    ) ?? null
  );
}

/** One name a list holds more than once, and the rows that hold it. */
export interface ListTwin {
  value: string;
  ids: string[];
}

/** Every name the list holds twice, in the order the console shows the rows. */
export function listTwins(entity: MasterEntity, rows: MasterRowLike[]): ListTwin[] {
  const by = new Map<string, ListTwin>();
  for (const row of rows) {
    const shown = masterRowName(entity, row);
    const key = foldRowKey(shown);
    if (!key || key === "a record" || key === "a currency") continue;
    const group = by.get(key);
    if (group) group.ids.push(String(row.id ?? ""));
    else by.set(key, { value: shown, ids: [String(row.id ?? "")] });
  }
  return [...by.values()].filter((group) => group.ids.length > 1);
}

/** Why a second copy of a name is refused, in one sentence. */
export function twinRefusal(entity: MasterEntity, submitted: string, shown: string): string {
  const one = MASTER_ONE_WORDS[entity];
  const list = MASTER_LIST_WORDS[entity];
  return `“${submitted}” is the same ${one} as “${shown}”, which the ${list} list already holds. Two rows that read alike cannot be told apart: a record filed under that name lands on whichever row the list orders first, and each would claim the other’s openings. Edit “${shown}” instead, or give the new ${one} words a recruiter can tell apart.`;
}

/** The longest twin list one note names; the rest are counted. */
const OPTIONS_IN_NOTE = 6;

/** What the list already holds twice, as the console and the chat read it. */
export function twinNotice(entity: MasterEntity, twins: ListTwin[]): string {
  const list = MASTER_LIST_WORDS[entity];
  const named = twins
    .slice(0, OPTIONS_IN_NOTE)
    .map((twin) => `“${twin.value}” on ${twin.ids.length} rows`)
    .join(", ");
  const left = twins.length - Math.min(twins.length, OPTIONS_IN_NOTE);
  return `The ${list} list holds ${
    twins.length === 1 ? "one name twice" : `${twins.length} names twice`
  } — ${named}${left > 0 ? `, and ${left} more` : ""}. A record filed under one of them lands on whichever row the list orders first, so the rows cannot be told apart from here. Retire or rename all but one.`;
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
        // Named because the row that carries the group's own careers profile is not
        // a company an opening belongs to, and a chat filing a role under it would
        // have no way to know.
        is_group_profile: (row as Company).is_group_profile === true,
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
export const MASTER_ONE_WORDS: Record<MasterEntity, string> = {
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
 * Facts in the order a recruiter needs them: how many rows the list holds and that
 * none of them were left out, which rows are retired and what being retired costs,
 * how to bring one back, what else exists that this call did not read, and — only
 * when it is true — whether the list already holds one name on two rows.
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
    return `The ${words} list is empty — nothing has been added there, so no record can name a ${MASTER_ONE_WORDS[entity]}. Add one with save_master_record before any opening or candidate uses it.`;
  }

  const head = retired.length === 0
    ? `${words} — ${rowWord(rows.length)}, all in use. This is the whole list: nothing was left out, and no rows are retired.`
    : `${words} — ${rowWord(rows.length)}: ${inUse} in use, ${retired.length} ${
        retired.length === 1 ? "row is" : "rows are"
      } retired (${retired.map((row) => masterRowName(entity, row)).join(", ")}). This is the whole list, retired rows included.`;

  const retiredClause =
    retired.length === 0
      ? null
      : ` A retired ${MASTER_ONE_WORDS[entity]} still resolves the records that already point at it, and the console lists it with a Retired badge — but the job and assessment pickers leave it out, so do not put a retired ${MASTER_ONE_WORDS[entity]} in a new opening. Bring one back with save_master_record (fields {\"is_active\": true}).`;

  const others = MASTER_LIST_ORDER.filter((each) => each !== entity && counts[each] !== undefined);
  const beside =
    others.length === 0
      ? ""
      : ` Read one list per call: ${others
          .map((each) => `${MASTER_LIST_WORDS[each]} (${counts[each]!.toLocaleString()})`)
          .join(", ")}.`;

  // Named last, after the counts: a list that holds one name twice is a fact the
  // model has to weigh before filing under it, and it is the only place the
  // ambiguity is visible to the chat.
  const twins = listTwins(entity, rows);

  return `${head}${retiredClause}${beside}${twins.length ? ` ${twinNotice(entity, twins)}` : ""}`;
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
