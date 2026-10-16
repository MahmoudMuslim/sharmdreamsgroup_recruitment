/**
 * The keys console's "Recent changes" trail, in one implementation.
 *
 * The trail is the only place a passed provider test survives on a deployment
 * that keeps its keys in environment variables: `provider_credentials` has no
 * row to stamp `last_verified_at` onto, so every such test lives here and nowhere
 * else. That is why the console's list and the assistant's read share one filter,
 * one cap and one scope note — an answer that counted rows a page cannot show is
 * the same defect the other consoles were fixed for, and a chat link to an
 * unfiltered list would name rows the recruiter cannot find on screen.
 *
 * The cap is disclosed rather than hidden. A section headed "Recent changes" that
 * silently drops half the table reads as the whole history, so the count it holds
 * and the number of rows it left out are both said out loud, in the browser and
 * in the chat answer, from the same function.
 *
 * A row's `detail` never carries a key: the writer stores `secretHint(...)` (eight
 * mask characters plus at most four) or a fixed phrase, so this module reads the
 * column as ordinary text and repeats it.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console
 * and the server-side read can import it alike.
 */

import { providerById, type ProviderDefinition } from "./providers";

/** How many newest rows the console section and the chat answer both carry. */
export const TRAIL_LIMIT = 12;

/**
 * The provider a trail listing is scoped to, or `null` for the whole history.
 *
 * Only an id the portal has a definition for narrows the list. Anything else —
 * a typo, a provider the registry dropped, an empty parameter — reads as "no
 * filter" rather than filtering the section down to nothing that was never asked
 * for, which is how every other console on this page treats its own parameters.
 */
export function trailScope(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && providerById(id) ? id : null;
}

/** The definition behind a scope, for a label that names the provider the way its card does. */
export function trailProvider(id: string | null): ProviderDefinition | null {
  return id ? (providerById(id) ?? null) : null;
}

/**
 * What a trail answer is standing on.
 *
 * Three facts in the order they are needed: whose history this is, how many rows
 * exist for it, and whether the listing is all of them. The last clause is the
 * one that matters on a busy portal — the newest 12 of 24 rows leaves 12 older
 * changes off the screen, and a reader who is not told counts what they can see.
 */
export function trailScopeNote(input: {
  providerId: string | null;
  total: number;
  loaded: number;
}): string {
  const { providerId, total, loaded } = input;
  const definition = trailProvider(providerId);
  const rows = (value: number) => `${value.toLocaleString()} row${value === 1 ? "" : "s"}`;
  const whose = definition ? ` for ${definition.displayName}` : "";

  if (total === 0) {
    return definition
      ? `Nothing is recorded${whose} — the trail holds only changes and tests made through this portal, so a key served from the environment may be working without ever having been tested here.`
      : "No credential has been changed or tested through this portal yet, so the trail is empty.";
  }

  const hidden = total - loaded;
  const span =
    hidden > 0
      ? `this listing carries the newest ${rows(loaded)} of them, so ${hidden.toLocaleString()} older ${
          hidden === 1 ? "change is" : "changes are"
        } not shown here`
      : `this listing carries all ${rows(total)}`;
  return `${rows(total)} recorded${whose} — ${span}.`;
}
