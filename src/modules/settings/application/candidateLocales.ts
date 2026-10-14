import "server-only";

import { isLocale, locales } from "@/lib/i18n";
import {
  getStringListSetting,
  getStringSetting,
} from "@/modules/settings/infrastructure/settingsReader";
import type { Locale } from "@/types";

/**
 * The two language settings reduced to something a page can render.
 *
 * `organisation.locale` picks the language a candidate lands in and
 * `organisation.enabled_locales` the ones they may switch to. Rows are
 * hand-editable, so values the build has no dictionary for are dropped rather
 * than trusted: an unknown code would render raw keys instead of words.
 */
export interface CandidateLocales {
  defaultLocale: Locale;
  enabledLocales: Locale[];
}

export async function getCandidateLocales(): Promise<CandidateLocales> {
  const [configured, offered] = await Promise.all([
    getStringSetting("organisation.locale", "en"),
    getStringListSetting("organisation.enabled_locales", [...locales]),
  ]);

  const defaultLocale = isLocale(configured) ? configured : "en";
  const enabled = [...new Set(offered.filter(isLocale))];
  // Nothing ticked would leave the portal with no language at all, so the
  // default always survives even when the admin clears the list.
  const enabledLocales = enabled.length > 0 ? enabled : [defaultLocale];

  // A default the admin has switch off is not offered to candidates, so the
  // portal opens in the first enabled language instead.
  return {
    defaultLocale: enabledLocales.includes(defaultLocale) ? defaultLocale : enabledLocales[0],
    enabledLocales,
  };
}
