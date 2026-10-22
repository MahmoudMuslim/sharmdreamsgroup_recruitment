/**
 * The settings change trail, in one implementation.
 *
 * `settings_audit_log` is what the portal records when a setting, a template, a
 * staff account or a stored file is written: the key, the value before, the value
 * after, and who the door managing it thought was acting. Until now the only
 * reader was the assistant, which answered with a window of its own choosing —
 * the recruiter was shown a number of changes no screen could reproduce, and the
 * link offered `/activity`, a page built on a different table — the hiring-data
 * trail, which the chat has no tool for. So this module gives the read one scope
 * vocabulary, one page size, one search window and one disclosure, shared by the
 * console section and the chat tool exactly as the keys console's credential trail
 * does.
 *
 * A row is filed under the console section that renders its key, because that is
 * where a reader goes to look at the thing that moved — `branding.logo_url` is
 * edited under General, so it belongs with General, not with a "branding" group
 * no dock entry has. Keys the console renders no control for are matched by their
 * own prefix instead: message templates, team accounts, stored files, and the
 * integration switches this portal deleted in favour of enforcing nothing.
 *
 * The actor column is reported as a count, never assumed. Most rows name nobody,
 * because the doors that wrote them recorded no actor, and a trail that quietly
 * left those rows blank reads as "nobody changed this" to whoever counts.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console
 * and the server-side read can import it alike.
 */

import { printableValue } from "@/modules/activity/domain/trail";
import { ALL_SETTINGS } from "./settingSearch";
import { SETTINGS_SCHEMA } from "./schema";

/**
 * One page of the trail: how many rows the console section and the chat answer
 * carry at a time.
 *
 * A page, not a ceiling — `trailPageCount` is what turns it into a depth a reader
 * can walk. Keeping one number means the screen and the chat cannot disagree about
 * how much of the trail a single read holds.
 */
export const SETTINGS_TRAIL_LIMIT = 15;

/** Where a page starts in the trail's own newest-first order, zero-based. */
export function trailOffset(page: number): number {
  return (page - 1) * SETTINGS_TRAIL_LIMIT;
}

/** How many pages it takes to walk a scope of `total` rows. Always at least one. */
export function trailPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / SETTINGS_TRAIL_LIMIT));
}

/**
 * How far back a search reads.
 *
 * Browsing the trail walks the whole scope a page at a time, but a search has to
 * hold the rows it is matching in one read, so it takes the newest ones and says
 * so: `settingsTrailNote` names the window whenever the scope is deeper than it.
 * Today's trail is 152 rows, so nothing is left out yet — the disclosure is here
 * for the day the trail grows past the window, which is when a silent cap would
 * start answering "no row matches" about rows nobody looked at.
 */
export const SETTINGS_TRAIL_SEARCH_SCAN = 400;

/**
 * The words a reader or the chat asked the trail to be searched for.
 *
 * Internal whitespace collapses and the ends are trimmed, because a row is matched
 * by a substring and "stage  change" would otherwise find nothing in a table that
 * prints "stage change". An all-blank parameter is no search at all — the same rule
 * every other parameter on this console follows, where a missing value lists
 * everything rather than nothing.
 */
export function trailFind(value: string | null | undefined): string | null {
  const words = value?.trim().replace(/\s+/g, " ") ?? "";
  return words === "" ? null : words;
}

/**
 * Whether one printed row carries the words.
 *
 * It is given exactly the fields the console renders — the key, the console's name
 * for it, the value before, the value after, and the actor — so the box can only
 * ever find what is on the screen. Matching them here rather than in the browser
 * keeps the search, its counts and its paging one read for the console and the chat
 * alike.
 */
export function trailRowMatches(
  row: { key: string; label: string | null; from: string; to: string; actor: string | null },
  words: string
): boolean {
  const needle = words.toLowerCase();
  return [row.key, row.label ?? "", row.from, row.to, row.actor ?? ""].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

/**
 * The page a parameter or argument asks for.
 *
 * Lenient in the same shape as `trailGroup`: page 1 is the whole trail's front, so
 * a missing, negative, fractional or unparseable value reads as page 1 rather than
 * as an error or an empty list. A stale bookmark that names a page the trail has
 * outgrown is clamped by the read, not answered with nothing.
 */
export function trailPage(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/**
 * A slice of the trail a reader can ask for.
 *
 * `keys` is exact: the settings a console section renders, so a section's rows are
 * the rows its own controls could have written. `prefix` is for the families the
 * Platform schema declares no control for — their key is the only thing that names
 * them, and it is stable because the writer composes it.
 */
export type SettingsTrailGroup =
  | { id: string; label: string; kind: "keys"; keys: readonly string[] }
  | { id: string; label: string; kind: "prefix"; prefix: string };

type KeyGroup = Extract<SettingsTrailGroup, { kind: "keys" }>;
type PrefixGroup = Extract<SettingsTrailGroup, { kind: "prefix" }>;

/**
 * The families a trail row can be filed under, for the writes that name no
 * settings control.
 *
 * `Removed integrations` is deliberately not friendlier than the fact: those rows
 * are real history, and the switches they record are gone from the console, so a
 * reader hunting one of them has to be told the door closed rather than left to
 * conclude the trail is broken.
 */
const UNCONTROLLED_GROUPS: readonly PrefixGroup[] = [
  { id: "templates", label: "Message templates", kind: "prefix", prefix: "notification_template:" },
  { id: "languages", label: "Interface wording", kind: "prefix", prefix: "i18n." },
  { id: "team", label: "Team accounts", kind: "prefix", prefix: "staff." },
  { id: "files", label: "Stored files", kind: "prefix", prefix: "storage." },
  { id: "integrations", label: "Removed integrations", kind: "prefix", prefix: "integrations." },
];

/** Every section of the Platform area, as the trail files it. */
const SECTION_GROUPS: readonly KeyGroup[] = SETTINGS_SCHEMA.map((section) => ({
  id: section.id,
  label: section.title,
  kind: "keys" as const,
  keys: section.controls.map((control) => control.key),
}));

/** The whole vocabulary, in the order a reader meets it: the dock's sections, then the rest. */
export const SETTINGS_TRAIL_GROUPS: readonly SettingsTrailGroup[] = [
  ...SECTION_GROUPS,
  ...UNCONTROLLED_GROUPS,
];

export function trailGroupById(id: string | null | undefined): SettingsTrailGroup | null {
  if (!id) return null;
  return SETTINGS_TRAIL_GROUPS.find((group) => group.id === id) ?? null;
}

/**
 * The scope a parameter or argument asks for, or `null` for the whole trail.
 *
 * Trimmed, and only an id this module declares narrows anything. A typo, a stale
 * bookmark naming a section the schema dropped, or an empty parameter all read as
 * "no filter", which is how every other console on this page treats its parameters
 * — a filtered list that comes back empty is indistinguishable from a trail with
 * nothing in it.
 */
export function trailGroup(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && trailGroupById(id) ? id : null;
}

/**
 * Where a stored key belongs.
 *
 * A control lookup first, because the section a key is edited in is the answer a
 * reader can act on; the prefix families only catch what no control declares.
 * Anything else has no group, and the console shows it as unfiled rather than
 * inventing a home for it.
 */
export function trailGroupFor(key: string): SettingsTrailGroup | null {
  const control = ALL_SETTINGS.find((entry) => entry.key === key);
  if (control) {
    return (
      SECTION_GROUPS.find((group) => group.id === control.sectionId) ??
      null
    );
  }
  return UNCONTROLLED_GROUPS.find((group) => key.startsWith(group.prefix)) ?? null;
}

/**
 * The words the console uses for a stored key.
 *
 * A trail row names a key (`security.session_timeout_minutes`), but the reader
 * knows it as the label beside its switch ("Idle session timeout"), so both are
 * shown and neither is retyped here. Keys no control declares — a team account, a
 * deleted integration switch — have no label, and the key stands on its own.
 */
export function trailKeyLabel(key: string): string | null {
  return ALL_SETTINGS.find((entry) => entry.key === key)?.label ?? null;
}

/** A stored value in the words a trail row prints — short, and never an empty cell. */
export function trailValueText(value: unknown): string {
  return printableValue(value);
}

/**
 * What a trail answer is standing on.
 *
 * Four facts in the order a reader needs them: whose history this is, how many
 * rows exist, which slice of them this listing holds, and how many of those rows
 * can name a person. The third clause is the one a busy portal cannot do without —
 * 15 rows of 152 reads as the whole trail to anyone who counts what is on the
 * screen — and it now names the page as well as the row numbers, so a reader who
 * walked deeper knows the walk is finite rather than endless. The fourth is what
 * stops a blank actor column being read as "nobody changed this".
 *
 * A search adds a fifth: which rows the words were looked for in. "Nothing matches"
 * and "the match is past the window" are the same empty listing, and only the note
 * can tell them apart.
 */
export function settingsTrailNote(input: {
  groupId: string | null;
  total: number;
  loaded: number;
  named: number;
  /** 1-based. The read reports the page it actually served, after clamping. */
  page?: number;
  /** Set when the listing is a search: the words, the window read, the scope's own size. */
  search?: { words: string; scanned: number; scopeRows: number } | null;
}): string {
  const { groupId, total, loaded, named, search } = input;
  const page = Math.max(1, input.page ?? 1);
  const group = trailGroupById(groupId);
  const rows = (value: number) => `${value.toLocaleString()} row${value === 1 ? "" : "s"}`;
  const whose = group ? ` for ${group.label}` : "";
  const searched = search ? searchedSentence(search) : null;

  if (total === 0 && search) {
    return `Nothing here matches “${search.words}”${whose}. ${searched} A search can only answer about the rows it read, so an empty listing is not a claim that the trail has no such change.`;
  }
  if (total === 0) {
    return group
      ? `Nothing is recorded${whose} — this trail holds only changes made through this portal, so a setting nobody has saved has no row here.`
      : "No change has been recorded through this portal yet, so the trail is empty.";
  }

  const pages = trailPageCount(total);
  const offset = trailOffset(page);
  const last = offset + loaded;
  let span: string;
  if (loaded >= total) {
    span = `this listing carries all ${rows(total)}`;
  } else {
    const newer = offset > 0
      ? `${offset.toLocaleString()} newer ${offset === 1 ? "change sits" : "changes sit"} on ${
          page === 2 ? "the previous page" : "earlier pages"
        }`
      : null;
    const older =
      last < total
        ? `${(total - last).toLocaleString()} older ${
            total - last === 1 ? "change is" : "changes are"
          } on ${pages - page === 1 ? "the next page" : "later pages"}`
        : null;
    const beside =
      newer && older
        ? `, with ${newer} and ${older}`
        : newer
          ? `, with ${newer}`
          : older
            ? `, so ${older}`
            : "";
    span =
      `page ${page} of ${pages} shows ${
        loaded === 1 ? "row" : "rows"
      } ${offset + 1}${loaded > 1 ? `–${last}` : ""} of them${beside}`;
  }
  const who =
    named === 0
      ? "No row names the person who made it: those writes recorded no actor, and the trail does not guess one."
      : named === total
        ? "Every row names the person who made it."
        : `Only ${named.toLocaleString()} of the ${total.toLocaleString()} name${
            named === 1 ? "s" : ""
          } the person who made it — the rest were written by a door that recorded no actor.`;
  const head = search
    ? `${rows(total)} ${total === 1 ? "matches" : "match"} “${search.words}”${whose}`
    : `${rows(total)} recorded${whose}`;
  return `${head} — ${span}. ${who}${searched ? ` ${searched}` : ""}`;
}

/**
 * What a search actually read.
 *
 * The sentence has to distinguish "no row matches" from "the matching row is further
 * back than the window", because the two look identical in a listing and only one of
 * them is the trail's fault. When the window covers the scope it says so, which is
 * the only case in which an empty search means anything at all.
 */
function searchedSentence(search: { words: string; scanned: number; scopeRows: number }): string {
  const { scanned, scopeRows } = search;
  if (scanned >= scopeRows) {
    return `All ${scopeRows.toLocaleString()} rows in this scope were searched.`;
  }
  const left = scopeRows - scanned;
  return `Searched the newest ${scanned.toLocaleString()} of the ${scopeRows.toLocaleString()} rows in this scope, so ${left.toLocaleString()} older ${
    left === 1 ? "change was" : "changes were"
  } not read.`;
}
