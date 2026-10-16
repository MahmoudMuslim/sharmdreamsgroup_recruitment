/**
 * The one wording every capped assistant read uses.
 *
 * A sliced list is indistinguishable from a complete one inside the rows
 * themselves, so "the alerts on this candidate" reads to the model as every
 * alert that exists. Each read that slices calls this and puts the sentence
 * first in its result — the JSON handed back is clipped at `MAX_RESULT_CHARS`,
 * so a caveat that sits behind the rows it describes can be cut off along with
 * them.
 *
 * Lives on its own because the registry it serves imports server actions and
 * cannot be loaded outside a request; the sentences are the part worth testing.
 */
export function reachNote(noun: string, total: number, shown: number): string {
  if (total === 0) return `There are no ${noun} in this set, so nothing is listed.`;
  if (shown >= total) return `All ${total.toLocaleString()} ${noun} are listed.`;
  const rest = total - shown;
  return `${total.toLocaleString()} ${noun} exist and only the ${shown.toLocaleString()} first are listed here, so the other ${rest.toLocaleString()} ${
    rest === 1 ? "is" : "are"
  } out of reach from this read.`;
}
