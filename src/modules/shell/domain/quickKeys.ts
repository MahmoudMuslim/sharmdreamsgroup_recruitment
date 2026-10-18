import type { StaffRoute } from "@/lib/auth/staffRoutes";

/**
 * The keyboard shortcuts the top bar answers to.
 *
 * Keyed by the letter rather than by the page on purpose, and that buys two
 * things the portal would otherwise have to remember to check: give two screens
 * the same letter and the object literal itself stops the build (a literal
 * cannot list one property twice), and leave a new admin page out and
 * `EVERY_PAGE_HAS_A_KEY` stops it. Keyed the other way round, a duplicated letter
 * would quietly send one of the two pages nowhere and the compiler would have
 * nothing to say about it.
 *
 * Every letter wears a chord: the bar only acts on Ctrl+Alt (⌘+⌥ on a Mac) plus
 * the letter, never on the letter alone. A bare letter jumping pages was always
 * one careless keystroke away from moving a recruiter off the screen they were
 * filling in, and a plain Ctrl+letter chord was never on offer at all — the
 * browser owns those: Ctrl+C is copy, Ctrl+W closes the tab, Ctrl+R reloads,
 * Ctrl+P prints, Ctrl+T is a new tab and Ctrl+F is the page's own find. Binding
 * a page to any of them would have meant swallowing the keystroke the person
 * meant. So the letters stay exactly as they are, and the chord is what says
 * "this one is for the portal".
 */
const KEY_TO_ROUTE = {
  d: "/dashboard",
  a: "/analytics",
  r: "/reports",
  t: "/time",
  h: "/activity",
  c: "/candidates",
  s: "/sourcing",
  j: "/jobs",
  q: "/apply-questions",
  e: "/assessments",
  i: "/interviews",
  o: "/onboarding",
  f: "/files",
  w: "/whatsapp",
  b: "/assistant",
  u: "/settings",
} as const satisfies Record<string, StaffRoute>;

/** The letters the bar binds, so the panel can print exactly these. */
export type QuickKey = keyof typeof KEY_TO_ROUTE;

type PagesWithoutAKey = Exclude<StaffRoute, (typeof KEY_TO_ROUTE)[keyof typeof KEY_TO_ROUTE]>;

/**
 * Compile-time coverage. A page added to `STAFF_ROUTES` without a key makes the
 * union below non-`never`, and `true` stops being assignable to it.
 */
export const EVERY_PAGE_HAS_A_KEY: [PagesWithoutAKey] extends [never] ? true : never = true;

const ROUTE_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_ROUTE).map(([key, route]) => [route, key])
) as Record<StaffRoute, QuickKey>;

/**
 * The chord, spelled the way a recruiter reads it. The key chips print it, the
 * bar's tooltip prints it, and `aria-keyshortcuts` is that same string with the
 * modifier spelled out, so the chip, the tooltip, the attribute and the handler
 * are one table and cannot disagree.
 */
export const CHORD_LABEL = "Ctrl+Alt";

/** The chord's Mac spelling, named once because the panel has to say it out loud. */
export const CHORD_LABEL_MAC = "⌘+⌥";

/** `g` opens the Guide under the chord; `?` still does it bare, being punctuation. */
const GUIDE_LETTER = "g";
export const GUIDE_KEY_LABEL = `${CHORD_LABEL}+G`;
export const HELP_KEY = "?";

/** `/` is bare too, and is the one key that has always belonged to a search box. */
export const SEARCH_KEY = "/";
export const CLOSE_KEY = "Escape";

/** The search box the `/` key focuses. One id, shared by the box and the key. */
export const SEARCH_INPUT_ID = "global-search";

/** A bound letter with its chord on, spelled for a key chip. */
export function keyLabel(key: QuickKey): string {
  return `${CHORD_LABEL}+${key.toUpperCase()}`;
}

/** The chip for a page: what the row prints and what the bar actually answers to. */
export function keyLabelFor(route: StaffRoute): string {
  return keyLabel(ROUTE_TO_KEY[route]);
}

type QuickAction =
  | { kind: "guide" }
  | { kind: "search" }
  | { kind: "goto"; route: StaffRoute };

/**
 * The letter a stroke names.
 *
 * `code` is read first because Ctrl+Alt is AltGr on many layouts, which changes
 * `key` without changing the physical key — so the chord still means the row the
 * recruiter is looking at. With no code, `key` decides, case-folded.
 */
function letterOf(stroke: { key: string; code?: string }): string {
  const physical = /^Key([A-Z])$/.exec(stroke.code ?? "");
  if (physical) return physical[1].toLowerCase();
  return stroke.key.length === 1 ? stroke.key.toLowerCase() : "";
}

/**
 * What a keystroke means, or nothing at all.
 *
 * Three rules, in this order: a field keeps every keystroke it is given, so
 * typing a candidate's name — or an AltGr character — never moves anyone and the
 * chord is no exception; a bare letter does nothing, only `?` and `/` answer
 * without a modifier; and a letter the portal binds only counts when Ctrl (or
 * ⌘) and Alt are both on it, with Shift off so Ctrl+Alt+⇧ chords stay unbound.
 * Everything the browser asked for that the portal does not take is left
 * untouched, which is what keeps copy, print, reload and its own tabs working.
 */
function planKey(stroke: {
  key: string;
  code?: string;
  typing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}): QuickAction | null {
  if (stroke.typing) return null;

  const control = stroke.ctrlKey || stroke.metaKey;
  if (!control && !stroke.altKey) {
    if (stroke.key === HELP_KEY) return { kind: "guide" };
    if (stroke.key === SEARCH_KEY) return { kind: "search" };
    return null;
  }

  if (!control || !stroke.altKey || stroke.shiftKey) return null;

  const letter = letterOf(stroke);
  if (letter === GUIDE_LETTER) return { kind: "guide" };
  const route = routeForKey(letter);
  return route ? { kind: "goto", route } : null;
}

/** The bar's three reactions, handed in so the rule above is the only thing that decides. */
export type QuickSink = {
  toggleGuide: () => void;
  focusSearch: () => void;
  goto: (route: StaffRoute) => void;
};

/**
 * Run one keystroke through the rule and out to the bar.
 *
 * Returns whether the key was consumed: the caller only calls `preventDefault()`
 * on a key it actually took, which is what leaves the browser's own chords
 * working. Keeping the whole decision here — not inside a `useEffect` — is what
 * lets a plain Node probe press all sixteen chords, every bare letter and every
 * plain Ctrl+letter and read back what the portal would do, without a signed-in
 * session.
 */
export function handleQuickKey(
  stroke: Parameters<typeof planKey>[0],
  sink: QuickSink
): boolean {
  const action = planKey(stroke);
  if (!action) return false;
  if (action.kind === "guide") sink.toggleGuide();
  else if (action.kind === "search") sink.focusSearch();
  else sink.goto(action.route);
  return true;
}

/** The page a letter opens, case-insensitively — caps lock is not a bug report. */
export function routeForKey(key: string): StaffRoute | null {
  const letter = key.toLowerCase();
  return (KEY_TO_ROUTE as Record<string, StaffRoute>)[letter] ?? null;
}

/** Whether the caret is in something the recruiter is writing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as
    | (HTMLElement & { isContentEditable?: boolean; tagName?: string })
    | null
    | undefined;
  if (!el?.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}
