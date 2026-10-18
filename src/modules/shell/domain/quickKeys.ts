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
 * The letters are only half the feature: every one of them is printed on its row
 * in the Guide panel, so a shortcut a recruiter has never seen is a shortcut they
 * can find without leaving the page they are on.
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

/** `?` is the help key a visitor reaches for first; `g` is the faster one. */
export const GUIDE_KEYS = ["g", "?"] as const;
export const SEARCH_KEY = "/";
export const CLOSE_KEY = "Escape";

/** The search box the `/` key focuses. One id, shared by the box and the key. */
export const SEARCH_INPUT_ID = "global-search";

type QuickAction =
  | { kind: "guide" }
  | { kind: "search" }
  | { kind: "goto"; route: StaffRoute };

/**
 * What a keystroke means, or nothing at all.
 *
 * Every shortcut sleeps while a field has the caret — typing a `c` into a search,
 * a filter box or a name field is the letter, not a jump to Candidates. A held
 * Ctrl/Cmd/Alt is somebody else's shortcut and is left alone, so browser and
 * extension chords (Ctrl+T, Cmd+R, Alt+D) still do what the browser expects.
 * Shift is not ignored: it is how `?` is typed.
 */
function planKey(stroke: {
  key: string;
  typing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): QuickAction | null {
  if (stroke.typing || stroke.ctrlKey || stroke.metaKey || stroke.altKey) return null;
  if ((GUIDE_KEYS as readonly string[]).includes(stroke.key)) return { kind: "guide" };
  if (stroke.key === SEARCH_KEY) return { kind: "search" };
  const route = routeForKey(stroke.key);
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
 * on a key it actually took, which is what leaves the browser's own chords working.
 * Keeping the whole decision here — not inside a `useEffect` — is what lets a
 * plain Node probe press every key in the table and read back what the portal
 * would do, without a signed-in session.
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

export function keyForRoute(route: StaffRoute): QuickKey {
  return ROUTE_TO_KEY[route];
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
