/**
 * Which way the desktop rail is folded, remembered per browser.
 *
 * localStorage is invisible to the server, so this is modelled as an external
 * store: `useSyncExternalStore` renders the expanded rail for hydration and then
 * applies the saved preference. Reading it in a `useState` initialiser instead
 * would make the first client render disagree with the markup the server sent.
 *
 * The app bar's Preferences panel and the rail's own toggle button both write
 * through here, so folding from either place updates both.
 */
const COLLAPSE_KEY = "sdg-nav-collapsed";

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

const collapseListeners = new Set<() => void>();

export function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSE_KEY, "1");
    else window.localStorage.removeItem(COLLAPSE_KEY);
  } catch {
    // Storage blocked (private mode) — the rail still folds for this page.
  }
  collapseListeners.forEach((notify) => notify());
}

export function subscribeCollapsed(notify: () => void): () => void {
  collapseListeners.add(notify);
  // Folding the rail in another tab changes the same preference.
  window.addEventListener("storage", notify);
  return () => {
    collapseListeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

export const expandedOnServer = () => false;

/**
 * Folds or unfolds the rail, opting the chrome into its slide the first time.
 *
 * A saved preference is applied after hydration; animating that would look like
 * the panel moved on its own, so `html[data-nav-animated]` only appears once a
 * person has clicked.
 */
export function setRailFolded(collapsed: boolean): void {
  document.documentElement.dataset.navAnimated = "1";
  writeCollapsed(collapsed);
}
