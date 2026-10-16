/**
 * The settings console's own box, in one implementation.
 *
 * The console filters the controls of the one section the address bar names; the
 * assistant runs the same words over all of them. A search that exists only in the
 * browser is how an answer ends up saying "there is no such setting" about a control
 * the recruiter can hover into seconds later — and how a chat link carrying `?q=`
 * lands on a box that reads nothing. So the columns, the predicate and the words
 * describing them live here beside the schema they read, and the placeholder, the
 * tool argument and the scope note are all generated from that one list.
 *
 * The set searched is the schema, not the stored rows. A setting nobody has ever
 * changed has no `app_settings` row and runs on the default the code ships with, so
 * a read that searched only the stored values would tell a recruiter the platform
 * has no such control. Each match therefore carries its stored value *and* whether
 * a row exists at all, and the note says which half of the answer is a default
 * rather than a setting.
 *
 * There is no cap: the console holds a few dozen controls, so the words always run
 * over the whole set and a "nothing matched" answer is a fact about the platform
 * rather than about a page of rows.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console
 * and the server-side read can import it alike.
 */

import {
  describeFields,
  searchByFields,
  wordsClause,
  type SearchField,
} from "@/lib/textSearch";
import { SETTINGS_SCHEMA } from "./schema";
import type { SettingControl } from "./types";

/** A control plus the section it is rendered in, so a match can name an address. */
export type IndexedSetting = SettingControl & {
  sectionId: string;
  sectionTitle: string;
};

/** Every control the Platform area renders, flattened once and in dock order. */
export const ALL_SETTINGS: readonly IndexedSetting[] = SETTINGS_SCHEMA.flatMap((section) =>
  section.controls.map(
    (control): IndexedSetting => ({
      ...control,
      sectionId: section.id,
      sectionTitle: section.title,
    })
  )
);

/**
 * The columns a search reads.
 *
 * `description` is the `help` text, because that is the only place most of these
 * settings say what they do — a recruiter who asks "what hides scores from
 * interviewers?" has named a sentence, not a key.
 */
export function settingSearchFields(): SearchField<SettingControl>[] {
  return [
    { label: "name", read: (control) => control.label },
    { label: "setting key", read: (control) => control.key },
    { label: "description", read: (control) => control.help },
  ];
}

/** What the box promises, in the recruiter's words: "name, setting key or description". */
export function settingSearchWords(): string {
  return describeFields(settingSearchFields());
}

/** Keep the controls whose columns hold the words — the console's own filter. */
export function searchSettingRows<T extends SettingControl>(
  rows: readonly T[],
  query: string
): T[] {
  return searchByFields(rows, query, settingSearchFields());
}

/** The same predicate run over every section, so an answer can reach one nobody has open. */
export function searchSettings(query: string): IndexedSetting[] {
  return searchSettingRows(ALL_SETTINGS, query);
}

/**
 * The one section holding every key named, or `null` when there is no single one.
 *
 * A link can only promise a filtered box if the section it opens holds everything
 * the answer named: words that reach across two sections would land on a box
 * showing none of them. A key the console renders no control for names no section
 * either, and an empty list — what a refusal reports — is not a location.
 */
export function settingsSection(
  keys: readonly string[]
): { id: string; title: string } | null {
  let found: { id: string; title: string } | null = null;
  for (const key of keys) {
    const control = ALL_SETTINGS.find((entry) => entry.key === key);
    if (!control) return null;
    const located = { id: control.sectionId, title: control.sectionTitle };
    if (found && found.id !== located.id) return null;
    found = located;
  }
  return found;
}

/**
 * What a searched settings answer is standing on.
 *
 * Three facts, in the order a recruiter needs them: the set the words ran over and
 * the columns they read, how many of that set the answer names, and how many of
 * those actually have a stored row. The last one is the sentence that stops a null
 * being read as a broken setting — `app_settings` holds only what somebody has
 * changed, so most of the console is defaults on a fresh portal.
 */
export function settingReadNote(input: {
  search: string;
  searched: number;
  matched: number;
  stored: number;
}): string {
  const { search, searched, matched, stored } = input;
  const count = (value: number, word: string) =>
    `${value.toLocaleString()} ${word}${value === 1 ? "" : "s"}`;
  const clause = wordsClause(
    search,
    `the ${count(searched, "setting")} this console can show, by ${settingSearchWords()}`,
    true,
    "a setting"
  ).trim();
  if (matched === 0) return `${clause} Nothing matched, so this answer lists no settings.`;
  const defaults =
    stored === matched
      ? ", each with a row stored, so every value shown is one the platform runs on"
      : ` — ${count(stored, "row")} stored, so the other ${count(
          matched - stored,
          "value"
        )} ${matched - stored === 1 ? "has" : "have"} never been written and run on the default the code ships with. A null there means never changed, not missing`;
  return `${clause} This answer lists ${matched.toLocaleString()} of them${defaults}.`;
}
