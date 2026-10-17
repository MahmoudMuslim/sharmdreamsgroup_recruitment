"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  areasFeeding,
  areasThatReached,
  attachLive,
  clearActivePage,
  liveOnServer,
  readLive,
  reloadLivePage,
  setActivePage,
  subscribeLive,
  type LiveSnapshot,
} from "@/lib/live";

export function useLive(): LiveSnapshot {
  return useSyncExternalStore(subscribeLive, readLive, liveOnServer);
}

/**
 * Mounts the tab's live channel inside the admin chrome.
 *
 * Renders nothing and owns no data — it only tells the store which page is on
 * screen and how to reload it. Every admin page draws the chrome, so this
 * re-attaches on navigation while the connection underneath stays open.
 */
export function LiveChrome() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setActivePage(pathname, () => router.refresh());
    return () => clearActivePage(pathname);
  }, [pathname, router]);

  useEffect(attachLive, []);

  return null;
}

const DOT: Record<LiveSnapshot["status"], string> = {
  live: "bg-emerald-500",
  connecting: "bg-brand-gold",
  paused: "bg-brand-ink/25",
  stalled: "bg-rose-500",
};

const WORD: Record<LiveSnapshot["status"], string> = {
  live: "Live",
  connecting: "Connecting",
  paused: "Paused",
  stalled: "Reconnecting",
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * The channel's status, where a recruiter can see it.
 *
 * The dot and the word describe the channel — connected, paused in a background
 * tab, or failing to reach the check. The sentence behind them describes *this*
 * page: which areas are watched, whether any of them feeds the screen you are
 * on, and when one that does last moved. Most of the portal is fed by a watched
 * table and reloads itself; three pages are not, and say so, because a tip that
 * promises "reloads this page" beside a board that never moves is the same lie
 * as a "Live" word on a closed connection. Clicking reloads this page now either
 * way; that is the button to press when you want the numbers this second.
 */
export function LiveBadge({ className }: { className?: string }) {
  const { status, everyMs, lastChange, watched } = useLive();
  const pathname = usePathname();

  const seconds = everyMs ? Math.round(everyMs / 1000) : null;
  /** The watch list arrives with the first frame, so before it nothing is known. */
  const told = everyMs !== null;
  const feeds = areasFeeding(watched, pathname);
  /** A change in a table that does not feed this screen is not a change here. */
  const movedAreas = areasThatReached(watched, lastChange?.areas ?? [], pathname);
  const movedHere = lastChange && movedAreas.length > 0 ? lastChange : null;
  const changedElsewhere = lastChange && movedAreas.length === 0 ? lastChange : null;

  const title = [
    status === "paused"
      ? "This tab is in the background, so the portal stopped checking; it reloads when you come back to it."
      : status === "stalled"
        ? "The portal cannot reach the change check right now, so this page may be out of date."
        : !told
          ? "Connecting to the live channel, so whether this page is watched is not known yet."
          : feeds.length > 0
            ? `Checks ${feeds.join(", ")} every ${seconds ?? "few"} seconds and reloads this page when one of them moves.`
            : "No watched table feeds this page, so nothing reloads it when the hiring data moves.",
    movedHere
      ? `Last change here: ${movedAreas.join(", ")} at ${clock(movedHere.at)}.`
      : changedElsewhere
        ? `The portal last moved (${changedElsewhere.areas.join(", ")}) at ${clock(changedElsewhere.at)}, which does not feed this page.`
        : "Nothing has moved since you opened this page.",
    "Click to reload now.",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={reloadLivePage}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-xl border border-brand-line bg-white px-2.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink",
        className
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        {status === "live" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", DOT[status])} />
      </span>
      <span className="hidden sm:block">{WORD[status]}</span>
      {movedHere && status === "live" && (
        <span className="hidden text-[11px] font-normal text-brand-ink/45 md:block">
          {clock(movedHere.at)}
        </span>
      )}
    </button>
  );
}
