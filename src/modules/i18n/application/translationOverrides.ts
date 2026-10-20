import "server-only";

import { locales, type TranslationOverrides } from "@/lib/i18n";
import { readGlobalSettings } from "@/modules/settings/infrastructure/settingsReader";
import { overridesKey, parseOverrideMap } from "../domain/translations";

const ENABLED_LOCALES_KEY = "organisation.enabled_locales";

/** The `app_settings` keys this reader asks for, in one cached round trip. */
function settingKeys(): string[] {
  return [...locales.map((locale) => overridesKey(locale)), ENABLED_LOCALES_KEY];
}

/**
 * Every stored wording map, whether or not the platform offers the language.
 *
 * The console reads this one: an admin has to be able to correct the Arabic even
 * while `organisation.enabled_locales` leaves it switched off, and a console that
 * hid those rows would rewrite them from what it could not see.
 */
export async function loadStoredTranslations(): Promise<TranslationOverrides> {
  const settings = await readGlobalSettings(settingKeys());

  const out: TranslationOverrides = {};
  for (const locale of locales) {
    const map = parseOverrideMap(settings.get(overridesKey(locale)));
    // A locale with nothing stored is left out entirely, so neither the seed the
    // layout hands the browser nor the console's props carry empty objects.
    if (Object.keys(map).length > 0) out[locale] = map;
  }
  return out;
}

/**
 * The subset a visitor can actually reach, for the seed in the root layout.
 *
 * Both reads go through `readGlobalSettings`, so they share one cached entry and
 * its tag: `minutes` staleness on its own, and eviction the moment anything
 * writes, because `saveTranslations` drops the same `app-settings` tag every other
 * settings writer drops. A word saved in Settings is the word the next candidate
 * reads, not the one from up to five minutes ago.
 *
 * Filtering by `organisation.enabled_locales` is what keeps the two settings
 * honest with each other — a language the platform has switched off is one no
 * visitor can select, so shipping its wording would be payload nothing reads.
 */
export async function loadTranslationOverrides(): Promise<TranslationOverrides> {
  const settings = await readGlobalSettings(settingKeys());

  // A missing or hand-broken row means every shipped language stays reachable,
  // which is the same reading `getCandidateLocales` gives the language switcher.
  const offered = settings.get(ENABLED_LOCALES_KEY);
  const enabled = Array.isArray(offered)
    ? offered.filter((code): code is string => typeof code === "string")
    : [...locales];

  const out: TranslationOverrides = {};
  for (const locale of locales) {
    if (!enabled.includes(locale)) continue;
    const map = parseOverrideMap(settings.get(overridesKey(locale)));
    if (Object.keys(map).length > 0) out[locale] = map;
  }
  return out;
}
