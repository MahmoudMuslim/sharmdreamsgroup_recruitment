/**
 * The folder search, in one implementation.
 *
 * The browser runs it over the files one folder listing holds; the assistant runs
 * it over the files its own read carries. An owner is matched by its label, never
 * by an id: a recruiter types a candidate's name, not a uuid, and a uuid in a
 * search box matches nothing.
 *
 * Pure by design — no database, no `server-only` — so the client browser and the
 * server-side read can import it alike.
 */

import { describeFields, searchByFields, wordsClause } from "@/lib/textSearch";
import type { SearchField } from "@/lib/textSearch";
import type { StoredFile } from "./file-browser-types";

export const FILE_SEARCH_FIELDS: readonly SearchField<StoredFile>[] = [
  { label: "file name", read: (file) => file.name },
  { label: "storage path", read: (file) => file.path },
  { label: "linked record", read: (file) => file.owner?.label },
];

/** What the search box promises, in the recruiter's words. */
export function fileSearchWords(): string {
  return describeFields(FILE_SEARCH_FIELDS);
}

export function searchFiles(rows: readonly StoredFile[], query: string): StoredFile[] {
  return searchByFields(rows, query, FILE_SEARCH_FIELDS);
}

/**
 * What a folder listing answer is standing on.
 *
 * Three numbers, and the answer has to say which of them it drew from: how many
 * files the storage listing carried, how many of those hold the words, and how
 * many the answer names. A generic capped-read note cannot be used beside a
 * search, because a search that matches nothing would report "0 files exist and
 * only the 0 first are listed" — the folder is not empty, the window just has no
 * match, and the second claim is the one a recruiter acts on.
 *
 * `listingTruncated` is the outer cap the tool's own read cannot see past: the
 * storage listing stops at a fixed number of entries, so an un-truncated listing
 * is the folder and a truncated one is a floor.
 */
export function folderReadNote(input: {
  loaded: number;
  matched: number;
  shown: number;
  listingTruncated: boolean;
  search: string | null;
}): string {
  const { loaded, matched, shown, listingTruncated, search } = input;
  const n = (count: number) => count.toLocaleString();
  const files = (count: number) => `${n(count)} file${count === 1 ? "" : "s"}`;
  if (loaded === 0) return "There are no files in this folder, so none are listed.";
  if (!search) {
    if (shown >= loaded) return `All ${files(loaded)} this listing carries are named here.`;
    return `${files(loaded)} are in the listing and only the first ${n(
      shown
    )} are named here, so the other ${n(loaded - shown)} are out of reach from this read.`;
  }
  const words = wordsClause(
    search,
    `the ${files(loaded)} this listing carries`,
    !listingTruncated,
    "a file"
  ).trim();
  if (matched === 0) return `Nothing is named here. ${words}`;
  return `${words} ${
    shown >= matched
      ? matched === 1
        ? "This answer names the only file that holds those words."
        : `This answer names every one of the ${n(matched)} that hold those words.`
      : `This answer names ${n(shown)} of the ${n(matched)} that hold those words.`
  }`;
}
