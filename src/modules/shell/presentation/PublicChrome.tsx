"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Palette } from "lucide-react";
import {
  getLocaleServerSnapshot,
  getLocaleSnapshot,
  setServerDefaultLocale,
  subscribeLocale,
  writeLocale,
} from "@/lib/locale-pref";
import { dirForLocale, hasKey, localeLabels, translate } from "@/lib/i18n";
import {
  NEXT_PALETTE,
  PALETTE_LABEL,
  applyTheme,
  lightOnServer,
  readTheme,
  subscribeTheme,
  writeTheme,
  type ThemeChoice,
} from "@/lib/theme";
import type { Locale } from "@/core/entities";
import { cn } from "@/lib/utils";

/**
 * The language and theme a visitor's browser remembers, read the React way.
 *
 * Both live in localStorage, so the server renders the configured default and
 * the browser corrects it in the first client pass. That is the same trade the
 * theme already makes through its bootstrap script; here the swap is one string
 * rather than a colour, and it only ever happens for someone who chose before.
 */
export function usePublicLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleServerSnapshot);
}

function useThemeChoice(): [ThemeChoice, (next: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, lightOnServer);
  // The bootstrap script paints the attributes before React arrives; writing
  // them again costs nothing and keeps the document in step with a theme the
  // visitor changed in another tab.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, (next) => writeTheme(next)];
}

/**
 * Seeds the browser store with what the platform was configured to speak.
 *
 * `organisation.locale` is the language a first-time visitor gets, and it is a
 * database row the server can see and the browser cannot. Rendering this next to
 * the content hands the answer down before any control reads the store, so the
 * menu shows the setting the admin made rather than a hard-coded English.
 */
export function PublicLocaleProvider({
  defaultLocale,
  children,
}: {
  defaultLocale: Locale;
  children: React.ReactNode;
}) {
  setServerDefaultLocale(defaultLocale);
  return <>{children}</>;
}

/**
 * One interface string, in the language the visitor chose.
 *
 * A server component can render this even though it cannot read localStorage:
 * the key travels as a prop and the client pass resolves it. Use it for words
 * the interface owns — headings, buttons, filter titles — never for a job ad or
 * a company's history, which are a recruiter's own sentences and must arrive as
 * they were filed, in whichever language they were written.
 */
export function PublicText({
  k,
  vars,
  fallback,
  className,
}: {
  k: string;
  vars?: Record<string, string | number>;
  fallback?: string;
  className?: string;
}) {
  const locale = usePublicLocale();
  // `fallback` is for a key built from data rather than written in the page —
  // an enum code, say. Without it a code no dictionary carries would print its
  // own key to the candidate.
  if (!hasKey(k)) return <span className={className}>{fallback ?? k}</span>;
  return <span className={className}>{translate(locale, k, vars)}</span>;
}

/**
 * The right-to-left wrapper for a public page.
 *
 * `dir` is applied to the region rather than to `<html>` because the admin panel
 * shares this build and is laid out with physical left/right offsets: flipping
 * the document would mirror a recruiter's console for a candidate's preference.
 */
export function PublicDir({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const locale = usePublicLocale();
  return (
    <div dir={dirForLocale(locale)} lang={locale} className={className}>
      {children}
    </div>
  );
}

/**
 * The theme button on its own.
 *
 * A page that already has its own language control — the portal's row of
 * language chips — uses this beside it instead of `PublicPrefs`, so one page
 * never offers the same choice twice.
 */
export function PublicThemeToggle({ className }: { className?: string }) {
  const locale = usePublicLocale();
  const [theme, setTheme] = useThemeChoice();

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT_PALETTE[theme])}
      title={`${translate(locale, "chrome.theme")} — ${PALETTE_LABEL[theme]}`}
      aria-label={`${translate(locale, "chrome.theme")}: ${PALETTE_LABEL[theme]}`}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-gold/50",
        className
      )}
    >
      {theme.startsWith("glass") ? (
        <Monitor className="h-4 w-4" aria-hidden />
      ) : (
        <Palette className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

/**
 * Language and theme, for every page outside the admin panel.
 *
 * The language list is the one `organisation.enabled_locales` allows, so a
 * tick-box in Settings is what adds or removes a name here. With a single
 * language enabled the control disappears rather than offering a choice of one.
 */
export function PublicPrefs({
  enabledLocales,
  className,
}: {
  enabledLocales: Locale[];
  className?: string;
}) {
  const locale = usePublicLocale();

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {enabledLocales.length > 1 && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">{translate(locale, "chrome.language")}</span>
          <select
            value={locale}
            onChange={(event) => writeLocale(event.target.value as Locale)}
            className="h-9 rounded-lg border border-brand-line bg-white px-2 text-xs font-semibold text-brand-ink/70 outline-none transition hover:bg-brand-sand focus-visible:ring-2 focus-visible:ring-brand-gold/50"
          >
            {enabledLocales.map((option) => (
              <option key={option} value={option}>
                {localeLabels[option]}
              </option>
            ))}
          </select>
        </label>
      )}

      <PublicThemeToggle />
    </div>
  );
}
