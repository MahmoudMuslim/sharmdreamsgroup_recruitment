"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isStaffPath } from "@/lib/auth/staffRoutes";
import { cn } from "@/lib/utils";

/**
 * The line that shows while the portal is reading the screen you asked for.
 *
 * Every admin page is `instant = false`, so a rail click is a request to the
 * server and the old page stays on screen until the answer lands. The rail row
 * already shimmers from Next's own `useLinkStatus`, but that signal stops at the
 * edge of the `<Link>` that fired it — nothing in the content column can see it,
 * and `next/navigation` exposes no global pending hook.
 *
 * So this listens to the two events that genuinely mean "a screen was asked for":
 * a click on an anchor the router would navigate, decided by `<Link>`'s own rules
 * (local URL, no modifier key, no `download`, not the page you are on) narrowed to
 * `STAFF_ROUTES`, and a `popstate`. `loading.tsx` is deliberately not used: the
 * admin layout reads the session cookie, and a fallback nested under a layout that
 * has not rendered yet cannot flush — which is what once left a skeleton up forever
 * on the dashboard.
 *
 * Nothing here estimates how long a page takes. The line appears when a request is
 * in flight, is cleared by the commit itself, and its 150ms reveal delay (in CSS)
 * means a navigation the router cache answers at once never paints it.
 */
const PENDING_EVENT = "sdg:navigation-pending";

/**
 * Announce a navigation the caller started with `router.push`.
 *
 * Only needed where the address is written by hand — the candidates desk's rails
 * and its board/table switch. Those change a query on the page you are standing
 * on, so no anchor is involved and the click listener below cannot see them.
 */
export function signalNavigationPending() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PENDING_EVENT));
}

/**
 * The hatch for a navigation that never commits — a read that throws into the
 * error boundary, a redirect the middleware refused. The commit clears the line on
 * every normal path; this only stops the chrome claiming a wait that has already
 * been abandoned, and sits far outside any real page read.
 */
const GIVE_UP_AFTER_MS = 30_000;

export function NavigationPending({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // A modified click opens a tab of its own; this shell is not involved.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.hasAttribute("download") || anchor.target !== "") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // An export goes through a route handler, a tracking link belongs to a
      // candidate, an anchor in the page only scrolls, and a link to the address
      // you already hold swaps nothing. None of them may claim to be loading.
      if (!isStaffPath(url.pathname)) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      setWaiting(true);
    };

    const onSignal = () => setWaiting(true);

    document.addEventListener("click", onClick);
    window.addEventListener(PENDING_EVENT, onSignal);
    window.addEventListener("popstate", onSignal);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener(PENDING_EVENT, onSignal);
      window.removeEventListener("popstate", onSignal);
    };
  }, []);

  // The commit. The router writes the address only once the new screen is in the
  // tree, so an address change is the arrival itself. Adjusted while rendering,
  // the way the shell closes the mobile drawer on navigation: an effect would leave
  // the line painted through one more render of the page it was waiting for.
  const href = `${pathname}${search.toString()}`;
  const [lastHref, setLastHref] = useState(href);
  if (href !== lastHref) {
    setLastHref(href);
    setWaiting(false);
  }

  // The cap, kept off the render path: while the line is shown, one timer owns it,
  // and moving or landing the address re-runs this and replaces the timer.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setWaiting(false), GIVE_UP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, href]);

  return (
    <div
      aria-hidden
      className={cn(
        "nav-wait pointer-events-none fixed inset-x-0 top-14 z-50 h-[2px] overflow-hidden bg-brand-gold/10",
        // Lines up with the content column, which begins where the rail ends.
        "lg:left-[264px]",
        collapsed && "lg:left-[76px]",
        waiting && "is-waiting"
      )}
    >
      <span className="nav-wait-sweep absolute inset-y-0" />
    </div>
  );
}
