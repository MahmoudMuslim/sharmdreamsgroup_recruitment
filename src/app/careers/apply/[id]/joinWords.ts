import type { Locale } from "@/types";

/**
 * "name, email and phone", in the grammar of the language on screen.
 *
 * Both apply wizards end a CV read by naming the fields it filled, kept or could
 * not find, so the sentence is built here once rather than in two places that can
 * drift apart on the Arabic conjunction.
 */
export function joinWords(locale: Locale, items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const arabic = locale === "ar";
  const head = items.slice(0, -1).join(arabic ? "، " : ", ");
  return `${head}${arabic ? " و" : " and "}${items[items.length - 1]}`;
}
