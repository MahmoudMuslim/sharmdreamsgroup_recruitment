import type { Locale } from "@/core/entities";

/**
 * Which language the public pages speak, remembered per browser.
 *
 * The admin panel is a recruiter's workplace and its wording is not in the
 * dictionary, so this preference belongs to the candidate-facing surface only:
 * the landing page, the job board, a role, the tracking portal. It is stored the
 * way the theme is — in localStorage, never on the row — because a person
 * browsing from the recruitment desk's shared laptop should not change what the
 * next visitor reads.
 *
 * `organisation.locale` decides the language a first-time visitor lands in;
 * `organisation.enabled_locales` decides which ones the menu offers. Both reach
 * the browser through `PublicLocaleProvider`, which seeds `serverDefault` before
 * anything renders so a prerendered page and its hydrated copy agree.
 */
export const LOCALE_KEY = "sdg-locale";

/** What the server rendered with, until the browser says otherwise. */
let serverDefault: Locale = "en";

/** The value the last read answered with, so snapshots stay stable. */
let resolved: Locale | null = null;

const listeners = new Set<() => void>();

export function setServerDefaultLocale(locale: Locale): void {
  serverDefault = locale;
}

function asLocale(value: string | null | undefined): Locale | null {
  // Narrowing lives in `isLocale` so an unknown code from a hand-edited row,
  // another site's localStorage or a stale tab never renders raw keys.
  return value === "en" || value === "ar" || value === "ru" || value === "de"
    ? (value as Locale)
    : null;
}

export function readLocale(): Locale {
  if (resolved) return resolved;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LOCALE_KEY);
  } catch {
    // Storage blocked (private mode) — the page still speaks the set language.
  }
  resolved = asLocale(stored) ?? serverDefault;
  return resolved;
}

export function writeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // The language still flips for this page.
  }
  resolved = locale;
  listeners.forEach((notify) => notify());
}

/**
 * A language the visitor never chose.
 *
 * Used when they pick "Automatic": the stored key is removed so the setting
 * falls back to `organisation.locale` again rather than to English.
 */
export function clearLocale(): void {
  try {
    window.localStorage.removeItem(LOCALE_KEY);
  } catch {
    // Nothing persisted to remove.
  }
  resolved = serverDefault;
  listeners.forEach((notify) => notify());
}

export function subscribeLocale(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab choosing a language, or the admin saving a new default.
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/** Snapshot for the browser. Reads through the cache so React sees one value. */
export function getLocaleSnapshot(): Locale {
  return readLocale();
}

/**
 * Snapshot for the server, and for the hydration pass.
 *
 * The server cannot see localStorage, so it renders the language the platform
 * was configured for. A returning visitor's saved language is applied in the
 * first client render after that.
 */
export function getLocaleServerSnapshot(): Locale {
  return serverDefault;
}
