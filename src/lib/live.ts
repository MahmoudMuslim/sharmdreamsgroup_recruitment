/**
 * The browser's live channel, modelled as an external store.
 *
 * One `EventSource` per tab, not one per admin page: the portal's chrome is
 * re-mounted by every route (and Next keeps the previous one alive while you
 * navigate), so a connection owned by the component would multiply. The store
 * is shared, the chrome only attaches to it, and the badge reads it through
 * `useSyncExternalStore` — the same shape `src/lib/rail.ts` uses for the fold.
 *
 * What arrives here is only which areas of the portal moved and when. Nothing
 * about the rows themselves: a change makes the page re-run its own queries,
 * which are still scoped by the viewer's role.
 */

export type LiveStatus = "connecting" | "live" | "paused" | "stalled";

export interface LiveSnapshot {
  status: LiveStatus;
  /** The server's own check interval, so the badge can quote the real number. */
  everyMs: number | null;
  lastChange: { areas: string[]; at: string } | null;
  /**
   * Area → the page prefixes it feeds, learned from the stream's first frame.
   *
   * Empty until that frame arrives, which is why the badge says "connecting"
   * rather than "not watched": a page cannot claim to be off the watch list
   * before it has been told what the list is.
   */
  watched: Record<string, string[]>;
}

const SERVER_SNAPSHOT: LiveSnapshot = {
  status: "connecting",
  everyMs: null,
  lastChange: null,
  watched: {},
};

let snapshot: LiveSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function emit(next: LiveSnapshot): void {
  snapshot = next;
  listeners.forEach((notify) => notify());
}

export function readLive(): LiveSnapshot {
  return snapshot;
}

export const liveOnServer = () => SERVER_SNAPSHOT;

export function subscribeLive(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/* -------------------------------------------------------------------------- */
/* The page on screen                                                          */
/* -------------------------------------------------------------------------- */

let active: { pathname: string; reload: () => void } | null = null;

/** Which chrome gets reloaded when something moves — the one you are looking at. */
export function setActivePage(pathname: string, reload: () => void): void {
  active = { pathname, reload };
}

export function clearActivePage(pathname: string): void {
  if (active?.pathname === pathname) active = null;
}

/**
 * Whether an area's watched pages include this one.
 *
 * Prefix, not equality — the same rule `isStaffPath()` uses, because it is
 * answering the same question about the same list of page names: `/files` feeds
 * `/files` and anything nested under it.
 */
export function feedsPage(pages: readonly string[] | undefined, pathname: string): boolean {
  return (pages ?? []).some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Which areas feed the page on screen — all the badge is allowed to promise. */
export function areasFeeding(watched: Record<string, string[]>, pathname: string): string[] {
  return Object.entries(watched)
    .filter(([, pages]) => feedsPage(pages, pathname))
    .map(([area]) => area);
}

/**
 * Of the areas that just moved, the ones that feed this page.
 *
 * Both halves of the promise read this: the stream reloads the page when it
 * returns something, and the badge only counts a change as "here" when it does.
 * One rule, so a page cannot be told it is live and then left stale.
 */
export function areasThatReached(
  watched: Record<string, string[]>,
  changed: readonly string[],
  pathname: string
): string[] {
  return changed.filter((area) => feedsPage(watched[area], pathname));
}

function feedsActivePage(areas: string[]): boolean {
  return areasThatReached(snapshot.watched, areas, active?.pathname ?? "").length > 0;
}

/* -------------------------------------------------------------------------- */
/* The stream                                                                  */
/* -------------------------------------------------------------------------- */

let source: EventSource | null = null;
let retry: number | null = null;
let attached = 0;
let dropTimer: number | null = null;

/** Changes inside this window reload the page once, not once per area. */
const MIN_RELOAD_GAP_MS = 1_000;

/** A dropped stream is retried here rather than by the browser's own loop. */
const RETRY_MS = 15_000;

/** How long the channel stays open after the last chrome unmounts (a navigation). */
const IDLE_MS = 3_000;

let lastReloadAt = 0;
let reloadTimer: number | null = null;

function reloadNow(): void {
  if (reloadTimer !== null) {
    window.clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  lastReloadAt = Date.now();
  active?.reload();
}

function reloadSoon(): void {
  if (!active || reloadTimer !== null) return;
  const wait = Math.max(0, MIN_RELOAD_GAP_MS - (Date.now() - lastReloadAt));
  reloadTimer = window.setTimeout(() => {
    reloadTimer = null;
    lastReloadAt = Date.now();
    active?.reload();
  }, wait);
}

/** Reload the page you are on immediately — what the badge's click does. */
export function reloadLivePage(): void {
  reloadNow();
}

function open(): void {
  if (source || typeof window === "undefined" || document.hidden) return;

  const next = new EventSource("/api/live");
  source = next;

  next.addEventListener("hello", (event) => {
    const frame = JSON.parse((event as MessageEvent<string>).data) as {
      everyMs: number;
      watch: { area: string; paths: string[] }[];
    };
    // Held in the snapshot rather than in a module variable, because the badge
    // has to answer "does anything here feed *this* page?" and only a subscribed
    // value re-renders it when the answer changes.
    const watched: Record<string, string[]> = {};
    for (const entry of frame.watch) watched[entry.area] = entry.paths;
    emit({ ...snapshot, status: "live", everyMs: frame.everyMs, watched });
  });

  next.addEventListener("change", (event) => {
    const frame = JSON.parse((event as MessageEvent<string>).data) as {
      areas: string[];
      at: string;
    };
    emit({ ...snapshot, status: "live", lastChange: { areas: frame.areas, at: frame.at } });
    if (feedsActivePage(frame.areas)) reloadSoon();
  });

  // The server could not read a single watched table.
  next.addEventListener("stalled", () => emit({ ...snapshot, status: "stalled" }));
  next.addEventListener("recovered", () => emit({ ...snapshot, status: "live" }));

  next.onerror = () => {
    if (source !== next) return;
    close();
    emit({ ...snapshot, status: "stalled" });
    if (retry === null) {
      retry = window.setTimeout(() => {
        retry = null;
        if (attached > 0) open();
      }, RETRY_MS);
    }
  };
}

function close(): void {
  if (retry !== null) {
    window.clearTimeout(retry);
    retry = null;
  }
  source?.close();
  source = null;
}

/**
 * Attaches the admin chrome to the channel, opening it on the first attach.
 *
 * The returned detach lets the connection survive a route change — the old
 * chrome unmounts a moment after the new one mounts — and close for good once
 * nothing is left to notify.
 */
export function attachLive(): () => void {
  attached += 1;
  if (dropTimer !== null) {
    window.clearTimeout(dropTimer);
    dropTimer = null;
  }
  if (!offVisibility) offVisibility = watchTabVisibility();

  if (document.hidden) emit({ ...snapshot, status: "paused" });
  else {
    if (snapshot.status !== "live") emit({ ...snapshot, status: "connecting" });
    open();
  }

  return () => {
    attached -= 1;
    if (attached > 0) return;
    dropTimer = window.setTimeout(() => {
      dropTimer = null;
      if (attached > 0) return;
      close();
      offVisibility?.();
      offVisibility = null;
    }, IDLE_MS);
  };
}

let offVisibility: (() => void) | null = null;

/**
 * A background tab stops listening; coming back reloads what it missed.
 *
 * Owned by the attachment above, not by the page, so ten chrome mounts sharing
 * one tab still mean one listener and one reconnect.
 */
function watchTabVisibility(): () => void {
  const onVisibility = () => {
    if (document.hidden) {
      close();
      emit({ ...snapshot, status: "paused" });
      return;
    }
    emit({ ...snapshot, status: "connecting" });
    if (attached > 0) open();
    reloadNow();
  };

  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
