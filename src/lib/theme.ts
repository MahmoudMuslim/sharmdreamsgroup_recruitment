/**
 * Which palette the chrome renders in, remembered per browser.
 *
 * The choice lives in localStorage only: there is no per-user column for it,
 * and a recruiter on a shared machine should not change anyone else's theme.
 * The inline script in the root layout writes the same attribute before paint,
 * so the page never flashes the other palette while this module loads.
 */
export const THEME_KEY = "sdg-theme";

export type ThemeChoice = "light" | "dark" | "glass";

const CHOICES: readonly ThemeChoice[] = ["light", "dark", "glass"];

/** What each palette is called in the chrome, and which one clicking gives. */
export const PALETTE_LABEL: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  glass: "Liquid glass",
};

export const NEXT_PALETTE: Record<ThemeChoice, ThemeChoice> = {
  light: "dark",
  dark: "glass",
  glass: "light",
};

function stored(): ThemeChoice | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return CHOICES.includes(value as ThemeChoice) ? (value as ThemeChoice) : null;
  } catch {
    return null;
  }
}

/** Falls back to what the operating system asked for, not to a fixed light. */
export function readTheme(): ThemeChoice {
  return stored() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/** The server cannot see localStorage, so it renders the palette the CSS ships. */
export const lightOnServer = (): ThemeChoice => "light";

export function applyTheme(theme: ThemeChoice): void {
  document.documentElement.dataset.theme = theme;
}

const themeListeners = new Set<() => void>();

export function writeTheme(theme: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked (private mode) — the palette still flips for this page.
  }
  applyTheme(theme);
  themeListeners.forEach((notify) => notify());
}

export function subscribeTheme(notify: () => void): () => void {
  themeListeners.add(notify);
  // Another tab choosing a palette, or the OS switching while nothing is stored.
  window.addEventListener("storage", notify);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", notify);
  return () => {
    themeListeners.delete(notify);
    window.removeEventListener("storage", notify);
    window.matchMedia?.("(prefers-color-scheme: dark)").removeEventListener?.("change", notify);
  };
}

/** Runs from the root layout before hydration so the first paint is already right. */
export const themeBootstrap = `(function(){try{var k=${JSON.stringify(CHOICES)},v=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});if(k.indexOf(v)<0){v=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=v}catch(e){document.documentElement.dataset.theme="light"}})();`;
