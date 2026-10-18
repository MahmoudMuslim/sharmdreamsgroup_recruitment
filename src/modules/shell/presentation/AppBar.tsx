"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  Droplets,
  Eraser,
  GlassWater,
  Languages,
  Layers,
  Loader2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { NAV, ROLE_LABEL, navSections } from "@/modules/analytics/presentation/nav";
import {
  GUIDE_HEADINGS,
  PAGE_GUIDE,
  routeOf,
} from "@/modules/shell/domain/pageGuide";
import type { StaffRoute } from "@/lib/auth/staffRoutes";
import {
  CLOSE_KEY,
  GUIDE_KEYS,
  SEARCH_INPUT_ID,
  SEARCH_KEY,
  handleQuickKey,
  isTypingTarget,
  keyForRoute,
} from "@/modules/shell/domain/quickKeys";
import { LiveBadge, useLive } from "@/modules/live/presentation/Live";
import { areasFeeding } from "@/lib/live";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import {
  getMyProfile,
  getStaffAlerts,
  searchPortal,
  type MyProfile,
  type PortalSearchResult,
  type SearchHit,
  type StaffAlert,
} from "@/modules/shell/application/shell-actions";
import {
  expandedOnServer,
  readCollapsed,
  setRailFolded,
  subscribeCollapsed,
} from "@/lib/rail";
import {
  acknowledgeAlerts,
  acknowledgeOneAlert,
  acksOnServer,
  partitionAlerts,
  readAcks,
  subscribeAcks,
  type AlertAckMap,
} from "@/lib/alert-ack";
import {
  applyTheme,
  choiceOf,
  lightOnServer,
  NEXT_PALETTE,
  PALETTE_LABEL,
  parentOf,
  PARENTS,
  readTheme,
  subscribeTheme,
  toneOf,
  TONES,
  writeTheme,
  type ThemeChoice,
  type ThemeParent,
  type ThemeTone,
} from "@/lib/theme";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

type Panel = "search" | "guide" | "alerts" | "account" | null;

/* -------------------------------------------------------------------------- */
/* Bar pieces                                                                 */
/* -------------------------------------------------------------------------- */

function BarButton({
  label,
  active,
  onClick,
  children,
  badge,
  keyName,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  /** The key that opens this panel. Named on the button so the hint is the same one the bar answers to. */
  keyName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label} (${badge})` : label}
      aria-expanded={active}
      aria-haspopup="dialog"
      aria-keyshortcuts={keyName}
      title={keyName ? `${label} — press ${keyName}` : label}
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition",
        active
          ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold-dark"
          : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink"
      )}
    >
      {children}
      {badge && badge > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-brand-on-accent"
          aria-hidden
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A dropdown hanging from the bar.
 *
 * All four panels stay mounted and are hidden rather than unmounted: the search
 * box keeps its typed term and the account panel keeps the profile it already
 * read, so reopening one is instant instead of another round trip.
 */
function PanelShell({
  id,
  open,
  label,
  width = "w-[min(92vw,420px)]",
  side = "right",
  children,
}: {
  id: Exclude<Panel, null>;
  open: Panel;
  label: string;
  width?: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      id={`appbar-${id}`}
      aria-label={label}
      className={cn(
        "rail-scroll absolute top-full mt-2 max-h-[min(72vh,560px)] overflow-y-auto overscroll-contain rounded-2xl border border-brand-line bg-brand-cream p-4 shadow-lift",
        width,
        side === "right" ? "right-0" : "left-0",
        open !== id && "hidden"
      )}
    >
      {children}
    </div>
  );
}

function PanelTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/45">
        {children}
      </h2>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">{note}</p>}
    </div>
  );
}

/** A key drawn as a key — the only place a shortcut is legible to a recruiter. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-md border border-brand-line bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-brand-ink/70">
      {children}
    </kbd>
  );
}

function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-brand-line bg-white text-brand-ink/55"
      )}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

const MIN_TERM = 2;

function pageMatches(label: string, hint: string, term: string): boolean {
  const needle = term.toLowerCase();
  return label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle);
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={hit.href}
      className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white hover:shadow-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{hit.title}</span>
        <span className="block truncate text-[11px] text-brand-ink/50">{hit.subtitle}</span>
      </span>
    </Link>
  );
}

function SearchField({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [response, setResponse] = useState<{
    for: string;
    result: PortalSearchResult;
  } | null>(null);
  // Each keystroke takes a number and only the newest response is allowed to
  // land, so a slow earlier query cannot overwrite a fast later one.
  const requestId = useRef(0);

  const query = term.trim();
  const tooShort = query.length < MIN_TERM;
  // Whether the box has an answer for the term actually on screen. Anything
  // older is ignored rather than cleared, which keeps this render pure.
  const current = !tooShort && response?.for === query ? response.result : null;
  const searching = !tooShort && current === null;
  const error = current && !current.ok ? current.error ?? "Search failed." : null;

  useEffect(() => {
    if (tooShort) return;
    const id = (requestId.current += 1);
    const timer = window.setTimeout(() => {
      void searchPortal(query).then((result) => {
        if (requestId.current === id) setResponse({ for: query, result });
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, tooShort]);

  const hits = current && current.ok ? current : null;
  const pages = tooShort
    ? []
    : NAV.filter((item) => pageMatches(item.label, item.hint, query)).slice(0, 6);
  const recordCount = hits
    ? hits.candidates.length + hits.jobs.length + hits.prospects.length
    : 0;
  const nothingFound = !tooShort && !searching && pages.length === 0 && recordCount === 0;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function firstHit(): string | null {
    return (
      pages[0]?.href ??
      hits?.candidates[0]?.href ??
      hits?.jobs[0]?.href ??
      hits?.prospects[0]?.href ??
      null
    );
  }

  return (
    <div className="relative min-w-0 max-w-xl flex-1">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const href = firstHit();
          if (href) go(href);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search candidates, jobs and prospects
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
            aria-hidden
          />
          <input
            id={SEARCH_INPUT_ID}
            type="search"
            autoComplete="off"
            aria-keyshortcuts={SEARCH_KEY}
            title="Search candidates, jobs and prospects — press / here"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              onOpen();
            }}
            onFocus={onOpen}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              }
            }}
            placeholder="Search candidates, jobs, prospects…"
            className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-9 text-sm placeholder:text-brand-ink/40 focus:border-brand-gold focus:outline-none"
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand-gold"
              aria-hidden
            />
          )}
        </div>
      </form>

      <PanelShell
        id="search"
        open={open ? "search" : null}
        label="Portal search"
        side="left"
        width="w-[min(94vw,540px)]"
      >
        {tooShort && (
          <Note>
            Type at least {MIN_TERM} characters. Matches candidate names, emails and
            tracking codes, job titles and departments, and prospect names, emails
            and companies; archived candidates are not searched. Any portal page
            whose name or one-line description fits is listed alongside them. Each
            group shows its five newest matches, so narrow the term to see more.
          </Note>
        )}
        {error && <Note tone="danger">{error}</Note>}
        {nothingFound && !error && <Note>Nothing you can see matches “{query}”.</Note>}

        {pages.length > 0 && (
          <div className="mb-1">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Pages
            </p>
            {pages.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white hover:shadow-soft"
              >
                <item.icon className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className="block truncate text-[11px] text-brand-ink/50">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {hits && hits.candidates.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Candidates
            </p>
            {hits.candidates.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
        {hits && hits.jobs.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Jobs
            </p>
            {hits.jobs.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
        {hits && hits.prospects.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Sourced prospects
            </p>
            {hits.prospects.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
      </PanelShell>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Guide                                                                      */
/* -------------------------------------------------------------------------- */

/** One of the three lists inside a page's guide. */
function GuideList({
  heading,
  items,
  tone = "plain",
}: {
  heading: string;
  items: readonly string[];
  tone?: "plain" | "edge";
}) {
  return (
    <div>
      <p
        className={cn(
          "mb-1 text-[10px] font-bold uppercase tracking-[0.16em]",
          tone === "edge" ? "text-brand-gold-dark" : "text-brand-ink/35"
        )}
      >
        {heading}
      </p>
      <ul className="space-y-1">
        {items.map((line) => (
          <li key={line} className="flex gap-2 text-[11px] leading-relaxed text-brand-ink/65">
            <span
              className={cn(
                "mt-[7px] h-1 w-1 shrink-0 rounded-full",
                tone === "edge" ? "bg-brand-gold-dark" : "bg-brand-ink/30"
              )}
              aria-hidden
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuidePanel({ open }: { open: Panel }) {
  const pathname = usePathname();
  const { watched, everyMs } = useLive();

  /**
   * Which page the guide is describing. A pick only holds while the address bar
   * still names the page it was made from, so walking to another screen follows
   * the portal again rather than leaving a guide open for a page nobody is on.
   */
  const here = routeOf(pathname);
  const [pinned, setPinned] = useState<{ from: string; route: StaffRoute } | null>(null);
  const shown = pinned && pinned.from === pathname ? pinned.route : here;
  const guide = shown ? PAGE_GUIDE[shown] : null;
  const entry = shown ? NAV.find((item) => item.href === shown) : undefined;

  /**
   * What the live channel can promise *here*, read from the list that decides
   * reloading. The Guide describing a page it does not refresh is the same
   * over-claim the chip was making, and this panel is rendered on every page.
   */
  const feeds = areasFeeding(watched, pathname);
  const seconds = everyMs ? Math.round(everyMs / 1000) : null;

  return (
    <PanelShell id="guide" open={open} label="Portal guide" width="w-[min(94vw,560px)]">
      <PanelTitle note="Written from each page's own render and actions, so a screen cannot grow a button this guide does not mention.">
        Guide
      </PanelTitle>

      <Note>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-semibold text-brand-ink/70">Keys:</span>
          <Kbd>{GUIDE_KEYS[0]}</Kbd>
          <Kbd>{GUIDE_KEYS[1]}</Kbd>
          <span>this guide,</span>
          <Kbd>{SEARCH_KEY}</Kbd>
          <span>the search box,</span>
          <Kbd>Esc</Kbd>
          <span>close it, and one letter per screen — printed on its row below.</span>
        </span>
        <span className="mt-1 block">
          A key sleeps while the caret is in a field, and a held Ctrl / Cmd / Alt is
          left for the browser, so typing a candidate&apos;s name never moves you off
          the page.
        </span>
      </Note>

      {shown && guide && entry && (
        <section className="rounded-2xl border border-brand-line bg-white p-3 shadow-soft">
          <div className="flex items-start gap-2.5">
            <entry.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight">
                {entry.label}
                <span
                  className={cn(
                    "ml-2 text-[10px] font-bold uppercase tracking-wider",
                    shown === here ? "text-brand-gold-dark" : "text-brand-ink/40"
                  )}
                >
                  {shown === here ? "here now" : "another page"}
                </span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/70">{guide.purpose}</p>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <GuideList heading={GUIDE_HEADINGS.shows} items={guide.shows} />
            <GuideList heading={GUIDE_HEADINGS.use} items={guide.use} />
            <GuideList heading={GUIDE_HEADINGS.edges} items={guide.edges} tone="edge" />
          </div>

          <div className="mt-3 border-t border-brand-line/70 pt-2">
            {shown === here ? (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-brand-ink/45">
                <span>You are on this page —</span>
                <Kbd>{keyForRoute(shown)}</Kbd>
                <span>opens it from anywhere, and picking another screen below reads its guide without leaving.</span>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={shown}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-2.5 py-1.5 text-[11px] font-semibold text-brand-cream transition hover:opacity-90"
                >
                  <entry.icon className="h-3.5 w-3.5" aria-hidden />
                  Open {entry.label}
                </Link>
                <span className="flex items-center gap-1.5 text-[11px] text-brand-ink/45">
                  <Kbd>{keyForRoute(shown)}</Kbd>
                  <span>goes there from anywhere.</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPinned(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  Back to where I am
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <PanelTitle
        note="The same table the navigation rail renders, so this list cannot fall behind the portal."
      >
        <span className="mt-4 block">Every screen — click one to read its guide, or press its letter to go there</span>
      </PanelTitle>

      <div className="space-y-3">
        {navSections().map((group) => (
          <div key={group.title}>
            <p className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/35">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isHere = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const reading = shown === item.href;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => setPinned({ from: pathname, route: item.href })}
                    aria-pressed={reading}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white hover:shadow-soft",
                      reading && "bg-white shadow-soft",
                      isHere && !reading && "bg-brand-sand/60"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        reading ? "text-brand-gold-dark" : "text-brand-ink/40"
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-tight">
                        {item.label}
                        {isHere && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-brand-gold-dark">
                            here now
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] leading-tight text-brand-ink/50">
                        {item.hint}
                      </span>
                    </span>
                    <Kbd>{keyForRoute(item.href)}</Kbd>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-brand-line pt-3">
        <p className="text-[11px] leading-relaxed text-brand-ink/55">
          A candidate moves New → AI screening → Assessment → Interview → Offer →
          Hired, or out to Rejected. Screening, scoring and feedback are
          model-assisted, and offers and hires are always decided by a person.
          The two thresholds in Settings → AI &amp; screening are the exception:
          a screened score at or above the auto-advance threshold (75% as
          shipped) moves an application nobody has touched yet to Assessment,
          and one below the auto-reject threshold (40%) closes it, storing that
          score and summary as the rejection reason the candidate sees. Set
          either to 0 and that side stops.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
          The <span className="font-semibold">Live</span> chip in this bar is the
          portal&rsquo;s own pulse: one connection per tab, re-checking the
          watched hiring tables every {seconds ?? "few"} seconds while the tab is
          in the foreground.{" "}
          {feeds.length > 0 ? (
            <>
              This page reads{" "}
              <span className="font-semibold">{feeds.join(", ")}</span>, so a
              change in one of them lands here without anyone pressing refresh.
            </>
          ) : everyMs === null ? (
            <>
              The channel has not told this page which tables it watches yet, so
              nothing is promised until its first frame arrives.
            </>
          ) : (
            <>
              No watched table feeds this page, so it never reloads itself: the
              chip reports the channel, and your click is what reloads it.
            </>
          )}{" "}
          A background tab stops checking and catches up the moment you come back
          to it. Click the chip to reload now.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
          A theme is a pair: a parent — <span className="font-semibold">Base</span>{" "}
          or <span className="font-semibold">Liquid glass</span> — and a tone,{" "}
          <span className="font-semibold">Light</span> or{" "}
          <span className="font-semibold">Dark</span>, set one after the other in
          Account → Preferences. The button walks all four. The choice is kept on
          this browser only, so a shared machine stays as each person left it.
          Liquid glass paints either tone as translucent film over a moving gold
          backdrop; a browser asked for less transparency gets the same theme as
          flat paint.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
          Two screens above read a table the database does not have yet:{" "}
          <span className="font-semibold">Activity</span> waits on
          supabase/migrations/024_activity_log.sql and{" "}
          <span className="font-semibold">Time Tracker</span> waits on
          supabase/migrations/025_time_entries.sql. Each one says so on the page
          until it is applied; every other screen here reads tables that are
          already live.
        </p>
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Attention feed                                                             */
/* -------------------------------------------------------------------------- */

function FeedAction({
  label,
  note,
  disabled,
  onClick,
  children,
}: {
  label: string;
  note: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={note}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      {label}
    </button>
  );
}

/** The count chip, tinted by how urgent the queue is. */
function AlertCount({ alert, muted }: { alert: StaffAlert; muted?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 grid h-6 min-w-6 shrink-0 place-items-center rounded-lg px-1.5 text-[11px] font-bold",
        muted
          ? "bg-brand-ink/10 text-brand-ink/55"
          : alert.tone === "danger"
            ? "bg-rose-600 text-brand-on-accent"
            : alert.tone === "warn"
              ? "bg-amber-500 text-brand-ink"
              : "bg-brand-ink text-brand-cream"
      )}
    >
      {alert.count > 99 ? "99+" : alert.count}
    </span>
  );
}

function AlertsPanel({
  open,
  alerts,
  acks,
  userId,
  error,
  readAt,
  onReload,
}: {
  open: Panel;
  alerts: StaffAlert[] | null;
  acks: AlertAckMap;
  userId: string;
  error: string | null;
  /** When the counts were last read, as an ISO stamp. */
  readAt: string | null;
  onReload: () => void;
}) {
  const [showCleared, setShowCleared] = useState(false);

  const waiting = alerts?.filter((alert) => alert.count > 0) ?? [];
  const { rows, cleared, unseen } = partitionAlerts(waiting, acks);
  const waitingTotal = waiting.reduce((sum, alert) => sum + alert.count, 0);

  return (
    <PanelShell id="alerts" open={open} label="Notifications">
      {/*
        Sticky under the panel's own scroll, so the toolbar stays reachable while
        a recruiter scrolls a long feed — the header used to scroll away with it.
        The panel scrolls inside its padding box, so `top` is offset by exactly
        that padding and the negative margins pull the strip over it; otherwise
        rows scroll visibly through a gap above the header.
      */}
      <header className="sticky -top-4 z-10 -mx-4 -mt-4 border-b border-brand-line bg-brand-cream px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/45">
              Needs attention
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {readAt
                ? `Live counts, read at ${formatDateTime(readAt)}.`
                : "Live counts from the pipeline."}
            </p>
          </div>
          <button
            type="button"
            onClick={onReload}
            aria-label="Recount what needs attention"
            title="Recount"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/55 transition hover:bg-brand-sand hover:text-brand-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-tight text-brand-ink/55">
            {alerts
              ? `${waitingTotal} waiting in ${rows.length} queue${rows.length === 1 ? "" : "s"}${
                  unseen.length ? ` · ${unseen.length} unseen` : ""
                }`
              : "Counting what the pipeline is holding."}
          </p>
          <FeedAction
            label="Read all"
            note="Mark every queue here as seen. A queue returns when its count grows."
            disabled={unseen.length === 0}
            onClick={() => acknowledgeAlerts(userId, rows, false)}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          </FeedAction>
          <FeedAction
            label="Clear all"
            note="Empty this list. Cleared queues come back on their own when their count grows."
            disabled={rows.length === 0}
            onClick={() => acknowledgeAlerts(userId, rows, true)}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
          </FeedAction>
        </div>
      </header>

      <div className="mt-3">
        {error && <Note tone="danger">{error}</Note>}

        {!alerts && !error && (
          <p className="flex items-center gap-2 py-3 text-sm text-brand-ink/55">
            <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
            Counting…
          </p>
        )}

        {alerts && waiting.length === 0 && (
          <Note>Nothing is waiting on you across the pipeline right now.</Note>
        )}

        {alerts && waiting.length > 0 && rows.length === 0 && (
          <Note>
            You cleared everything that was waiting. Recount to check the pipeline
            again, or a queue returns here by itself once its count grows.
          </Note>
        )}

        {rows.map((alert) => {
          const isUnseen = unseen.includes(alert);
          return (
            <div
              key={alert.id}
              className={cn(
                "group flex items-start gap-1 rounded-xl pr-1 transition hover:bg-white hover:shadow-soft",
                isUnseen && "bg-white/70"
              )}
            >
              <Link
                href={alert.href}
                onClick={() => acknowledgeOneAlert(userId, alert, false)}
                className="flex min-w-0 flex-1 items-start gap-3 px-2.5 py-2"
              >
                <AlertCount alert={alert} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm leading-tight",
                      isUnseen
                        ? "font-bold text-brand-ink"
                        : "font-semibold text-brand-ink/70"
                    )}
                  >
                    {alert.label}
                  </span>
                  <span className="block text-[11px] leading-tight text-brand-ink/50">
                    {alert.detail}
                  </span>
                </span>
                {isUnseen && (
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-gold"
                    title="Unseen"
                    aria-label="Unseen"
                  />
                )}
              </Link>
              <button
                type="button"
                onClick={() => acknowledgeOneAlert(userId, alert, true)}
                aria-label={`Clear ${alert.label} from this list`}
                title="Clear this queue"
                className="mt-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-brand-ink/35 opacity-60 transition hover:bg-brand-sand hover:text-brand-ink group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}

        {cleared.length > 0 && (
          <div className="mt-3 border-t border-brand-line pt-2">
            <button
              type="button"
              onClick={() => setShowCleared((shown) => !shown)}
              aria-expanded={showCleared}
              className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-brand-ink/50 transition hover:text-brand-ink"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition", showCleared && "rotate-180")}
                aria-hidden
              />
              {cleared.length} cleared queue{cleared.length === 1 ? "" : "s"}
            </button>

            {showCleared && (
              <>
                {cleared.map((alert) => (
                  <Link
                    key={alert.id}
                    href={alert.href}
                    className="mt-1 flex items-start gap-3 rounded-xl px-2.5 py-1.5 opacity-70 transition hover:bg-white hover:opacity-100"
                  >
                    <AlertCount alert={alert} muted />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight text-brand-ink/60">
                        {alert.label}
                      </span>
                      <span className="block text-[11px] leading-tight text-brand-ink/45">
                        {alert.detail}
                      </span>
                    </span>
                  </Link>
                ))}
                <div className="mt-2">
                  <FeedAction
                    label="Bring them back"
                    note="Put the cleared queues back in the list."
                    disabled={false}
                    onClick={() => acknowledgeAlerts(userId, cleared, false)}
                  >
                    <Bell className="h-3.5 w-3.5" aria-hidden />
                  </FeedAction>
                </div>
              </>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-3 border-t border-brand-line pt-2 text-[11px] leading-relaxed text-brand-ink/45">
            Each row opens the page where that work is done, and counts are read
            live when this opens: when a queue empties, its row disappears. Read
            all and Clear all quiet the list in this browser, and a queue returns
            by itself as soon as its count grows past the number you saw.
          </p>
        )}
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Theme + rail, shared with the rail's own toggle                            */
/* -------------------------------------------------------------------------- */

/**
 * The icon each theme wears in the app bar.
 *
 * Both glass tones keep a water icon so the parent reads at a glance; the tone
 * is in the label the button carries.
 */
const PALETTE_ICON: Record<ThemeChoice, typeof Sun> = {
  "base-light": Sun,
  "base-dark": Moon,
  "glass-light": GlassWater,
  "glass-dark": Droplets,
};

/** The two controls Preferences shows: a parent, then the tone inside it. */
const PARENT_ICON: Record<ThemeParent, typeof Sun> = { base: Layers, glass: Droplets };
const TONE_ICON: Record<ThemeTone, typeof Sun> = { light: Sun, dark: Moon };

function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, lightOnServer);
  // The head script writes the attribute before this hook exists; syncing here
  // keeps it honest when the operating system flips palettes while a tab is open.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, (next) => writeTheme(next)];
}

/* -------------------------------------------------------------------------- */
/* Install                                                                    */
/* -------------------------------------------------------------------------- */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STANDALONE_QUERY = "(display-mode: standalone)";

// Whether this window runs as an installed app is the browser's fact, not ours,
// so it is read as an external store and follows the media query when it flips.
function subscribeStandalone(onChange: () => void): () => void {
  const list = typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_QUERY) : null;
  if (!list) return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readStandalone(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function notStandaloneOnServer(): boolean {
  return false;
}

function InstallItem() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, notStandaloneOnServer);
  const [note, setNote] = useState<string | null>(null);

  // `beforeinstallprompt` only fires when a manifest is served and the browser
  // considers the page installable, so the item reports that truth rather than
  // offering a button that would do nothing.
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) {
      setNote(
        standalone
          ? "This window is already running the installed app."
          : "This browser has not offered an install prompt for this page yet. In Chrome, use the install icon in the address bar, or the browser menu → Install as app."
      );
      return;
    }
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setPromptEvent(null);
    setNote(
      outcome === "accepted"
        ? "Installing — your browser is adding the shortcut now."
        : "Install dismissed. The offer stays available until the browser withdraws it."
    );
  }

  return (
    <div className="rounded-xl border border-brand-line bg-white px-3 py-2.5">
      <button
        type="button"
        onClick={() => void install()}
        className="flex w-full items-center gap-2.5 text-sm font-semibold text-brand-ink/75 transition hover:text-brand-ink"
      >
        <Download className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
        Install App
        {installed && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
            <Check className="h-3.5 w-3.5" aria-hidden />
            installed
          </span>
        )}
      </button>
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/50">{note}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

function PreferenceChoice({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: { key: string; label: string; icon: typeof Sun; onClick: () => void }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-brand-ink/55">{label}</p>
      <div role="group" aria-label={label} className="grid grid-cols-2 gap-1.5">
        {options.map((option) => {
          const active = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              onClick={option.onClick}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                active
                  ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold-dark"
                  : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink"
              )}
            >
              <option.icon className="h-3.5 w-3.5" aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreferencesSection() {
  const [theme, setTheme] = useTheme();
  const folded = useSyncExternalStore(subscribeCollapsed, readCollapsed, expandedOnServer);
  // The pair is stored as one value, so each control rewrites only its own half
  // and picking glass keeps the tone you were already reading in.
  const parent = parentOf(theme);
  const tone = toneOf(theme);

  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-white px-3 py-3">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Preferences
      </p>
      <PreferenceChoice
        label="Theme — each one comes in light and dark"
        value={parent}
        options={PARENTS.map((option) => ({
          key: option.key,
          label: option.label,
          icon: PARENT_ICON[option.key],
          onClick: () => setTheme(choiceOf(option.key, tone)),
        }))}
      />
      <PreferenceChoice
        label="Tone"
        value={tone}
        options={TONES.map((option) => ({
          key: option.key,
          label: option.label,
          icon: TONE_ICON[option.key],
          onClick: () => setTheme(choiceOf(parent, option.key)),
        }))}
      />
      <PreferenceChoice
        label="Navigation rail — wide screens"
        value={folded ? "folded" : "expanded"}
        options={[
          { key: "expanded", label: "Expanded", icon: PanelLeftOpen, onClick: () => setRailFolded(false) },
          { key: "folded", label: "Folded", icon: PanelLeftClose, onClick: () => setRailFolded(true) },
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] leading-tight">
      <Icon className="h-3.5 w-3.5 shrink-0 text-brand-ink/35" aria-hidden />
      <span className="shrink-0 text-brand-ink/45">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right font-semibold text-brand-ink/75">
        {value}
      </span>
    </div>
  );
}

function AccountMenu({ user, open }: { user: SessionUser; open: Panel }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (open !== "account" || requested.current) return;
    requested.current = true;
    setLoading(true);
    void getMyProfile().then((result) => {
      setLoading(false);
      if (result.ok && result.profile) {
        setProfile(result.profile);
      } else {
        setProfileError(result.error ?? "Your profile could not be read.");
        requested.current = false;
      }
    });
  }, [open]);

  return (
    <PanelShell id="account" open={open} label="Account">
      <PanelTitle>Account</PanelTitle>

      <div className="rounded-xl border border-brand-line bg-white p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-base font-bold text-brand-gold-dark">
            {user.fullName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{user.fullName}</span>
            <span className="block truncate text-[11px] text-brand-ink/55">
              {ROLE_LABEL[user.role]} · {user.email}
            </span>
          </span>
        </div>

        <div className="mt-3 space-y-1.5 border-t border-brand-line pt-3">
          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-brand-ink/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold" aria-hidden />
              Reading your profile…
            </p>
          )}
          {profileError && !loading && (
            <p className="text-[11px] leading-relaxed text-rose-700">{profileError}</p>
          )}
          {profile && (
            <>
              <ProfileRow icon={Phone} label="Phone" value={profile.phone ?? "not recorded"} />
              <ProfileRow
                icon={Building2}
                label="Company"
                value={profile.company ?? "whole group"}
              />
              <ProfileRow icon={Languages} label="Locale" value={profile.locale} />
              <ProfileRow
                icon={CalendarDays}
                label="Member since"
                value={formatDate(profile.since)}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm font-semibold text-brand-ink/75 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <Settings2 className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
          Workspace settings
        </Link>

        <InstallItem />
        <PreferencesSection />

        <SignOutButton className="w-full justify-center border-0 bg-white px-0 py-2.5 text-sm" />
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* The bar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Portal-wide top bar: search, guide, attention feed, palette and account.
 *
 * One panel opens at a time, and everything that closes one — Escape, a click
 * outside the bar, a route change — closes whichever happens to be open, so two
 * dropdowns can never stack.
 */
export function AppBar({
  user,
  onOpenNavigation,
}: {
  user: SessionUser;
  onOpenNavigation: () => void;
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
   * Quick keys: `g` or `?` opens this Guide, `/` drops the caret into the search
   * box, and one letter per admin page goes straight there.
   *
   * The bindings and the letters printed on the Guide's rows come from the same
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
          typing: isTypingTarget(event.target),
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
        {
          toggleGuide: () => setPanel((current) => (current === "guide" ? null : "guide")),
          focusSearch: () => {
            (document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null)?.focus();
          },
          goto: (route) => router.push(route),
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
        <LiveBadge />
        <BarButton
          label="Guide"
          active={panel === "guide"}
          onClick={() => toggle("guide")}
          keyName={GUIDE_KEYS[0]}
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
