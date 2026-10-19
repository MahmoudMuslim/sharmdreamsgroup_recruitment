import { ViewTransition } from "react";
import { pageEnter } from "@/modules/shell/domain/navTransition";

/**
 * The one wrapper that animates a route change in the recruiter portal.
 *
 * It sits in the page, not in the shell, because `<ViewTransition>` only runs
 * enter and exit when the wrapper itself mounts or unmounts. A wrapper that
 * persists across navigations — the rail, the app bar, the dock — sees its
 * children swap, which React treats as an update governed by `default`, and the
 * directional map never fires.
 *
 * `default: "none"` is what keeps a live-channel refresh or a search-param
 * filter from pretending it was a navigation.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={pageEnter} exit={pageEnter} default="none">
      {children}
    </ViewTransition>
  );
}
