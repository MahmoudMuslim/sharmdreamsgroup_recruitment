"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  ChevronDown,
  Menu
} from "lucide-react";
import {
  CLOSE_KEY,
  GUIDE_KEY_LABEL,
  SEARCH_INPUT_ID,
  handleQuickKey,
  isTypingTarget
} from "@/modules/shell/domain/quickKeys";
import { LiveBadge, useLive } from "@/modules/live/presentation/Live";
import { navForward } from "@/modules/shell/domain/navTransition";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import {
  getStaffAlerts,
  type StaffAlert
} from "@/modules/shell/application/shell-actions";
import {
  acksOnServer,
  partitionAlerts,
  readAcks,
  subscribeAcks
} from "@/lib/alert-ack";
import {
  NEXT_PALETTE,
  PALETTE_LABEL
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { AccountMenu } from "./AppBarAccount";
import { AlertsPanel } from "./AppBarAlerts";
import { AppBarClock } from "./AppBarClock";
import { GuidePanel } from "./AppBarGuide";
import { BarButton, type Panel } from "./AppBarPrimitives";
import { SearchField } from "./AppBarSearch";
import { PALETTE_ICON, useTheme } from "./AppBarTheme";

/* -------------------------------------------------------------------------- */
/* The bar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Portal-wide top bar: the organisation's clock, search, guide, attention feed,
 * palette and account.
 *
 * One panel opens at a time, and everything that closes one — Escape, a click
 * outside the bar, a route change — closes whichever happens to be open, so two
 * dropdowns can never stack.
 */
export function AppBar({
  user,
  onOpenNavigation,
  timeZone,
}: {
  user: SessionUser;
  onOpenNavigation: () => void;
  /** The organisation's wall clock, read once by the layout and named by the clock's tooltip. */
  timeZone: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [theme, setTheme] = useTheme();
  const PaletteIcon = PALETTE_ICON[theme];
  const [alerts, setAlerts] = useState<StaffAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsReadAt, setAlertsReadAt] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { lastChange } = useLive();

  const acks = useSyncExternalStore(
    subscribeAcks,
    () => readAcks(user.authUserId),
    acksOnServer
  );

  const loadAlerts = useCallback(() => {
    void getStaffAlerts().then((result) => {
      if (result.ok) {
        setAlerts(result.alerts);
        setAlertsError(null);
        setAlertsReadAt(new Date().toISOString());
      } else {
        setAlerts(null);
        setAlertsError(result.error ?? "The attention feed is unavailable.");
      }
    });
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // The waiting numbers are counted from the same tables the live channel
  // watches, so a colleague's stage move re-counts the Bell instead of leaving
  // a badge that only lies until somebody opens it.
  useEffect(() => {
    if (lastChange) loadAlerts();
  }, [lastChange, loadAlerts]);

  // Arriving on a new page closes the bar, exactly as it closes the drawer.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (panel) setPanel(null);
  }

  // The badge counts only what this browser has not been shown yet, so "Read
  // all" visibly silences the Bell instead of advertising a number that is
  // already acknowledged. The panel itself still states the full waiting total.
  const unseenAlerts = useMemo(
    () => partitionAlerts(alerts?.filter((alert) => alert.count > 0) ?? [], acks).unseen,
    [alerts, acks]
  );
  const unseenTotal = unseenAlerts.reduce((sum, alert) => sum + alert.count, 0);

  function toggle(next: Exclude<Panel, null>) {
    if (panel === next) {
      setPanel(null);
      return;
    }
    // Opening the feed is the moment a recruiter expects fresh numbers.
    if (next === "alerts") loadAlerts();
    setPanel(next);
  }

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === CLOSE_KEY) setPanel(null);
    };
    // Dismissal is a document listener rather than a full-screen overlay sheet:
    // an overlay would swallow the click meant for the navigation rail, forcing
    // a recruiter to click twice to change page.
    const onPointerDown = (event: PointerEvent) => {
      const bar = barRef.current;
      if (bar && !bar.contains(event.target as Node)) setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [panel]);

  /**
   * Quick keys: `Ctrl+Alt+G` or `?` opens this Guide, `/` drops the caret into
   * the search box, and `Ctrl+Alt` plus one letter per admin page goes straight
   * there.
   *
   * The chord is `Ctrl+Alt` rather than the plain `Ctrl` the request named
   * because the browser already owns every plain `Ctrl+letter` that matters
   * here — copy, print, reload, a new tab, find — and a portal that swallowed
   * them would be the app that broke the keyboard. `event.code` travels with the
   * stroke so an AltGr layout still lands on the letter the row printed, and
   * `event.shiftKey` is read because `Ctrl+Alt+Shift+letter` is somebody else's
   * shortcut.
   *
   * The bindings and the chords printed on the Guide's rows come from the same
   * table, so a key cannot exist on screen that the bar does not answer to — or
   * the other way round, which is the version that makes a manual wrong. The rule
   * itself lives in `domain/quickKeys`, which decides from the keystroke alone;
   * this effect is the DOM around it.
   */
  useEffect(() => {
    const onQuickKey = (event: KeyboardEvent) => {
      const consumed = handleQuickKey(
        {
          key: event.key,
          code: event.code,
          typing: isTypingTarget(event.target),
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        },
        {
          toggleGuide: () => setPanel((current) => (current === "guide" ? null : "guide")),
          focusSearch: () => {
            (document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null)?.focus();
          },
          goto: (route) => router.push(route, { transitionTypes: navForward }),
        }
      );
      if (consumed) event.preventDefault();
    };
    window.addEventListener("keydown", onQuickKey);
    return () => window.removeEventListener("keydown", onQuickKey);
  }, [router]);

  return (
    <header
      ref={barRef}
      style={{ viewTransitionName: "sdg-bar" }}
      className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-brand-line bg-brand-cream/95 px-3 backdrop-blur-md sm:gap-3 sm:px-4"
    >
      <button
        type="button"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink transition hover:bg-brand-sand lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <span className="shrink-0 sm:hidden">
        <SdgLockup compact />
      </span>
      <span className="hidden shrink-0 sm:block">
        <SdgLockup />
      </span>

      <SearchField
        open={panel === "search"}
        onOpen={() => setPanel("search")}
        onClose={() => setPanel(null)}
      />

      <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
        <AppBarClock timeZone={timeZone} />
        <LiveBadge />
        <BarButton
          label="Guide"
          active={panel === "guide"}
          onClick={() => toggle("guide")}
          keyName={GUIDE_KEY_LABEL}
        >
          <BookOpen className="h-4 w-4" aria-hidden />
        </BarButton>
        <BarButton
          label={alertsError ? "Attention feed unavailable" : "Needs attention"}
          active={panel === "alerts"}
          onClick={() => toggle("alerts")}
          badge={unseenTotal}
        >
          <Bell className="h-4 w-4" aria-hidden />
        </BarButton>
        <button
          type="button"
          onClick={() => setTheme(NEXT_PALETTE[theme])}
          aria-label={`Switch to the ${PALETTE_LABEL[NEXT_PALETTE[theme]].toLowerCase()} theme`}
          title={`${PALETTE_LABEL[theme]} theme — click for ${PALETTE_LABEL[
            NEXT_PALETTE[theme]
          ].toLowerCase()}`}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <PaletteIcon className="h-4 w-4" aria-hidden />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggle("account")}
            aria-expanded={panel === "account"}
            aria-controls="appbar-account"
            aria-haspopup="dialog"
            title={user.fullName}
            className={cn(
              "flex h-9 items-center gap-2 rounded-xl border px-2 transition",
              panel === "account"
                ? "border-brand-gold/60 bg-brand-gold/15"
                : "border-brand-line bg-white hover:bg-brand-sand"
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold/25 font-display text-[11px] font-bold text-brand-gold-dark">
              {user.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-[140px] truncate text-xs font-semibold sm:block">
              {user.fullName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-brand-ink/45" aria-hidden />
          </button>
          <AccountMenu user={user} open={panel} />
        </div>

        <GuidePanel open={panel} />
        <AlertsPanel
          open={panel}
          alerts={alerts}
          acks={acks}
          userId={user.authUserId}
          error={alertsError}
          readAt={alertsReadAt}
          onReload={loadAlerts}
        />
      </div>
    </header>
  );
}
