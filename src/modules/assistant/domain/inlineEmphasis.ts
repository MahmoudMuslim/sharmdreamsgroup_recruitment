/**
 * The one question the chat's inline renderer asks about an `_…_` span.
 *
 * The renderer turns `_word_` into italics, and the same pattern is a normal part
 * of a column name: the assistant echoes `min_salary_usd` straight out of a trail
 * row, and a pair of underscores with letters either side is spelling, not
 * emphasis. Marking that span italic eats both underscores and the recruiter reads
 * `minsalaryusd` — a field name that no longer matches any console, in the one
 * message that tells them what a change touched.
 *
 * Pure and import-free so the rule can be run against real strings by
 * `scripts/prove-chat-emphasis.mjs`, which a client component cannot be.
 */

/** A character that binds an underscore to the word it sits in. */
const BINDING = /[\w`]/;

/**
 * True when the span `text.slice(start, end)` is held by a word at either end.
 *
 * `start` and `end` are the match's own bounds, so they name the characters
 * *outside* the two underscores — a match at the very start or end of a message has
 * nothing to bind to, which is what lets "_this_ is italic" still render.
 */
export function insideAWord(text: string, start: number, end: number): boolean {
  return BINDING.test(text[start - 1] ?? "") || BINDING.test(text[end] ?? "");
}
