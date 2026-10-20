"use client";

import { setTranslationOverrides, type TranslationOverrides } from "@/lib/i18n";

/**
 * Hands the stored wording to the module `translate` reads from.
 *
 * Written during render rather than in an effect for the same reason
 * `PublicLocaleProvider` seeds the language this way: a child that calls
 * `translate` on its first pass has to see the wording already in place, or the
 * server's HTML and the browser's first paint would disagree and React would have
 * to patch the difference. An effect runs after that paint.
 *
 * Rendered by the root layout, so it reaches every surface in one place —
 * including the candidate portal, whose own files this console does not edit.
 */
export function TranslationsSeed({ value }: { value: TranslationOverrides }) {
  setTranslationOverrides(value);
  return null;
}
