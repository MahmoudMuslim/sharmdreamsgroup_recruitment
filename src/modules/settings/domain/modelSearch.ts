/**
 * The model catalogue search, in one implementation.
 *
 * The AI models console runs its box over the several hundred models the provider
 * reads carried; the assistant runs the same words over the handful one answer
 * names. A column list kept beside each of them is how a chat answer starts
 * denying a model the tiles show seconds later — and how `save_model_routing`
 * ends up written with an id nobody can find in the console, because the chat had
 * no vocabulary to borrow. So the predicate, its columns and the words describing
 * them live here, next to neither surface, and both the placeholder and the tool
 * argument are generated from the same list.
 *
 * Provider is matched by both of its spellings on purpose. A row carries the
 * source id (`openrouter`) while the tab beside it prints the display name
 * ("OpenRouter"), so a box that promises "provider" and reads only the id matches
 * what nobody can see — and the provider tab strip stays a picklist, not a second
 * search box: typing the vendor's name already gets the same rows.
 *
 * Pure by design — no database, no `server-only`, no provider call — so the
 * client console and the server-side read can import it alike.
 */

import {
  describeFields,
  searchByFields,
  wordsClause,
  type SearchField,
} from "@/lib/textSearch";

/** The three things a catalogue row is known by. `ModelOption` and a console tile both satisfy it. */
export interface SearchableModel {
  name: string;
  /** The qualified id a routing row is written with, e.g. `openrouter/google/gemini-2.5-flash`. */
  id: string;
  /** Source id, e.g. `openrouter` — not the label the console prints beside it. */
  provider: string;
}

/** Source id to display name, read from wherever the caller keeps its labels. */
export type ProviderLabels = ReadonlyMap<string, string>;

function labelFor(labels: ProviderLabels, id: string): string {
  return labels.get(id) ?? "";
}

/**
 * The columns a search reads.
 *
 * Takes the labels because the provider column spans two spellings, and each
 * caller resolves them its own way — the console from the tabs it already built,
 * the read from the catalogue's `sources`.
 */
export function modelSearchFields(
  labels: ProviderLabels = new Map()
): SearchField<SearchableModel>[] {
  return [
    { label: "model name", read: (model) => model.name },
    { label: "model ID", read: (model) => model.id },
    { label: "provider", read: (model) => `${model.provider} ${labelFor(labels, model.provider)}` },
  ];
}

/** What the box promises, in the recruiter's words: "model name, model ID or provider". */
export function modelSearchWords(): string {
  return describeFields(modelSearchFields());
}

/** Keep the models whose three columns hold the words. */
export function searchModels<T extends SearchableModel>(
  rows: readonly T[],
  query: string,
  labels: ProviderLabels = new Map()
): T[] {
  return searchByFields(rows, query, modelSearchFields(labels));
}

/**
 * What a catalogue answer is standing on.
 *
 * Three numbers, none of them the whole catalogue: how many models the provider
 * reads carried, how many of those this portal can call, and how many the answer
 * names. The middle one is the set the words ran over, and it is smaller than the
 * first by design — a model with no caller in the gateway, or one the account has
 * switched off, cannot go into a routing row, so offering it would be a promise
 * the console breaks on the next screening. `carried` is stated anyway, or a
 * recruiter reads the smaller number as the vendor's list.
 *
 * `degradedSources` counts the providers whose list is a built-in fallback rather
 * than today's read — a model added since then is genuinely absent from this set.
 * `silentSources` counts the ones that answered with nothing at all, which is a
 * different sentence: no fallback list stands in for a vendor that never replied.
 */
export function modelReadNote(input: {
  carried: number;
  callable: number;
  matched: number;
  shown: number;
  cap: number;
  search: string | null;
  degradedSources: number;
  silentSources: number;
}): string {
  const { carried, callable, matched, shown, cap, search, degradedSources, silentSources } = input;
  const n = (count: number) => count.toLocaleString();
  const models = (count: number) => `${n(count)} model${count === 1 ? "" : "s"}`;
  const unlive =
    (degradedSources > 0
      ? ` ${n(degradedSources)} of the provider lists this answer stands on ${
          degradedSources === 1 ? "is" : "are"
        } a built-in fallback rather than a live read, so a model a vendor added since then may not appear in it.`
      : "") +
    (silentSources > 0
      ? ` ${n(silentSources)} provider${
          silentSources === 1 ? "" : "s"
        } returned no list at all, so this set holds nothing from ${
          silentSources === 1 ? "it" : "them"
        }.`
      : "");
  if (carried === 0) return `No provider returned a model list, so this answer names none.${unlive}`;
  const held = `The catalogue read carried ${models(carried)}, of which ${n(
    callable
  )} can actually be called by this portal; this answer runs over those ${n(callable)}.${
    carried === callable
      ? ""
      : ` The other ${models(
          carried - callable
        )} are listed by a provider that has no caller for them in this portal, or are switched off on the account, so a routing row cannot use them.`
  }`;
  const set = search ? matched : callable;
  const window =
    set === 0
      ? search
        ? `Nothing in the ${models(callable)} this portal can call holds those words, so this answer names none.`
        : `This portal can call none of the models the read carried, so this answer names none.`
      : shown >= set
        ? shown === set && set === 1
          ? `This answer names the only model${search ? " that holds those words" : ""}.`
          : `This answer names every one of the ${models(set)}${search ? " that hold those words" : ""}.`
        : `This answer names ${models(shown)} of the ${models(set)}${
            search ? " that hold those words" : " this portal can call"
          }. An answer lists at most ${n(cap)}, so a narrower word brings the rest into view.`;
  // The words ran over the callable set, which is the whole catalogue only when
  // nothing was dropped for being uncallable.
  const words = search
    ? wordsClause(search, `the ${models(callable)} this portal can call`, carried === callable, "a model")
    : "";
  return `${held} ${window}${words}${unlive}`.trim();
}
