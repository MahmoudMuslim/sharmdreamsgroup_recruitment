/**
 * Which theme the chrome renders in, remembered per browser.
 *
 * Two parents, each with both tones:
 *   - `base`  — the opaque brand palette.
 *   - `glass` — the same palette as translucent film over a moving backdrop.
 * So the settings are a pair, not a pick-one-of-four: the tone means the same
 * thing in either parent, and a recruiter who likes dark keeps it dark when
 * they switch to glass.
 *
 * The choice lives in localStorage only: there is no per-user column for it,
 * and a recruiter on a shared machine should not change anyone else's theme.
 * The inline script in the root layout writes the same two attributes before
 * paint, so the page never flashes the other theme while this module loads.
 */
export const THEME_KEY = "sdg-theme";

export type ThemeParent = "base" | "glass";
export type ThemeTone = "light" | "dark";

/**
 * The one stored value: a parent and a tone joined by a dash.
 *
 * Each key names a pair of attributes the CSS has to define. Get that wrong and
 * nothing throws — the page keeps the `@theme` defaults while the picker shows
 * the theme you chose. Hence `scripts/check-themes.mjs`, which `prebuild` runs.
 */
export type ThemeChoice = `${ThemeParent}-${ThemeTone}`;

export const CHOICES: readonly ThemeChoice[] = [
  "base-light",
  "base-dark",
  "glass-light",
  "glass-dark",
] as const;

/** The two parents, in the order the Preferences panel offers them. */
export const PARENTS: readonly { key: ThemeParent; label: string }[] = [
  { key: "base", label: "Base" },
  { key: "glass", label: "Liquid glass" },
];

/** The tone every parent comes in. */
export const TONES: readonly { key: ThemeTone; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

export const parentOf = (choice: ThemeChoice): ThemeParent =>
  choice.slice(0, choice.indexOf("-")) as ThemeParent;

export const toneOf = (choice: ThemeChoice): ThemeTone =>
  choice.slice(choice.indexOf("-") + 1) as ThemeTone;

export const choiceOf = (parent: ThemeParent, tone: ThemeTone): ThemeChoice =>
  `${parent}-${tone}`;

/**
 * Values saved before glass gained its own tones, and before the tone was a
 * setting of its own.
 *
 * Without this a saved choice stops matching `CHOICES` and the page quietly
 * reverts to whatever the operating system asked for.
 */
const RENAMED: Readonly<Record<string, ThemeChoice>> = {
  light: "base-light",
  dark: "base-dark",
  glass: "glass-dark",
};

/** What each theme is called in the chrome, and which one clicking gives. */
export const PALETTE_LABEL: Record<ThemeChoice, string> = {
  "base-light": "Light",
  "base-dark": "Dark",
  "glass-light": "Liquid glass — light",
  "glass-dark": "Liquid glass — dark",
};

/**
 * The walk the app bar button takes: both tones of one parent, then the other.
 *
 * Stepping tone before parent keeps a single click a small visual change.
 */
export const NEXT_PALETTE: Record<ThemeChoice, ThemeChoice> = {
  "base-light": "base-dark",
  "base-dark": "glass-dark",
  "glass-dark": "glass-light",
  "glass-light": "base-light",
};

function asChoice(value: string | null | undefined): ThemeChoice | null {
  if (!value) return null;
  const named = RENAMED[value] ?? value;
  return CHOICES.includes(named as ThemeChoice) ? (named as ThemeChoice) : null;
}

function stored(): ThemeChoice | null {
  try {
    return asChoice(window.localStorage.getItem(THEME_KEY));
  } catch {
    return null;
  }
}

/** Falls back to what the operating system asked for, in the base parent. */
export function readTheme(): ThemeChoice {
  const saved = stored();
  if (saved) return saved;
  const tone = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return choiceOf("base", tone);
}

/** The server cannot see localStorage, so it renders the theme the CSS ships. */
export const lightOnServer = (): ThemeChoice => "base-light";

/** The two attributes, from one stored value. */
export const THEME_ATTRIBUTES: Record<ThemeChoice, { palette: ThemeParent; tone: ThemeTone }> =
  Object.fromEntries(
    CHOICES.map((choice) => [choice, { palette: parentOf(choice), tone: toneOf(choice) }])
  ) as Record<ThemeChoice, { palette: ThemeParent; tone: ThemeTone }>;

export function applyTheme(theme: ThemeChoice): void {
  const { palette, tone } = THEME_ATTRIBUTES[theme];
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.tone = tone;
}

const themeListeners = new Set<() => void>();

export function writeTheme(theme: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked (private mode) — the theme still flips for this page.
  }
  applyTheme(theme);
  themeListeners.forEach((notify) => notify());
}

export function subscribeTheme(notify: () => void): () => void {
  themeListeners.add(notify);
  // Another tab choosing a theme, or the OS switching while nothing is stored.
  window.addEventListener("storage", notify);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", notify);
  return () => {
    themeListeners.delete(notify);
    window.removeEventListener("storage", notify);
    window.matchMedia?.("(prefers-color-scheme: dark)").removeEventListener?.("change", notify);
  };
}

/**
 * Runs from the root layout before hydration so the first paint is already right.
 *
 * Mirrors `applyTheme` and `readTheme` rather than calling them: it has to work
 * in a `<script>` that runs before any module does. `data-palette` and `data-tone`
 * are written together, because a page carrying only one of them matches no CSS.
 */
export const themeBootstrap = `(function(){try{var k=${JSON.stringify(CHOICES)},r=${JSON.stringify(
  RENAMED
)},a=${JSON.stringify(
  THEME_ATTRIBUTES
)},v=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});if(r[v])v=r[v];if(k.indexOf(v)<0){v=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"base-dark":"base-light"}var t=a[v];document.documentElement.dataset.palette=t.palette;document.documentElement.dataset.tone=t.tone}catch(e){document.documentElement.dataset.palette="base";document.documentElement.dataset.tone="light"}})();`;
