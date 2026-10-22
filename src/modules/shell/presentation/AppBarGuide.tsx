"use client";

import {
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Search
} from "lucide-react";
import { NAV, navSections } from "@/modules/analytics/presentation/nav";
import {
  GUIDE_SECTION_LABELS,
  GUIDE_SECTIONS,
  PAGE_GUIDE,
  openLists,
  routeOf,
  searchGuide,
  type GuideSection
} from "@/modules/shell/domain/pageGuide";
import type { StaffRoute } from "@/lib/auth/staffRoutes";
import {
  CHORD_LABEL_MAC,
  CLOSE_KEY,
  GUIDE_KEY_LABEL,
  HELP_KEY,
  SEARCH_KEY,
  keyLabelFor
} from "@/modules/shell/domain/quickKeys";
import { useLive } from "@/modules/live/presentation/Live";
import { navForward } from "@/modules/shell/domain/navTransition";
import { areasFeeding } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Kbd, Note, type Panel, PanelShell, PanelTitle } from "./AppBarPrimitives";

/* -------------------------------------------------------------------------- */
/* Guide                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One list of a page's manual, folded under its heading.
 *
 * The count sits on the summary because a heading that hides sixteen sentences is
 * the difference between a limit a recruiter reads and one they walk past: the
 * fold is only honest if it says how much it is holding. Which lists start open is
 * the panel's decision, not this one's — searching the manual opens the lists that
 * carry the words and leaves the rest shut.
 */
function GuideSectionBlock({
  label,
  items,
  open,
  onToggle,
  tone = "plain",
}: {
  label: string;
  items: readonly string[];
  open: boolean;
  onToggle: () => void;
  tone?: "plain" | "edge";
}) {
  const pane = useId();
  return (
    <div
      className={cn(
        "rounded-xl border",
        tone === "edge" ? "border-brand-gold/40 bg-brand-gold/5" : "border-brand-line bg-white"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={pane}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-brand-sand/60"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open ? "rotate-0" : "-rotate-90",
            tone === "edge" ? "text-brand-gold-dark" : "text-brand-ink/40"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.16em]",
            tone === "edge" ? "text-brand-gold-dark" : "text-brand-ink/45"
          )}
        >
          {label}
        </span>
        <span className="shrink-0 rounded-md border border-brand-line bg-brand-cream px-1.5 py-0.5 text-[10px] font-bold text-brand-ink/50">
          {items.length}
        </span>
      </button>
      {open && (
        <ul id={pane} className="space-y-1 px-2.5 pb-2.5">
          {items.map((line, index) => (
            <li key={`${index}-${line}`} className="flex gap-2 text-[11px] leading-relaxed text-brand-ink/65">
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
      )}
    </div>
  );
}

/**
 * The Guide: the portal's manual, one screen at a time.
 *
 * Two panes because one scroll was the complaint — the page you were on, then all
 * sixteen screens, then the portal's own prose, with some screens holding sixteen
 * limit bullets. The list is now beside the manual and narrows as you type, so
 * "where do I re-issue a test link" finds the screen instead of requiring the
 * reader to already know it. The manual lists fold, each summary printing how many
 * sentences it is holding, and searching opens the lists carrying the words.
 */
export function GuidePanel({ open }: { open: Panel }) {
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

  const [typed, setTyped] = useState("");
  /** One word is one word however it was spaced, and a blank box searches nothing. */
  const needle = typed.trim();
  const hits = useMemo(() => searchGuide(needle), [needle]);
  const hitOf = (route: StaffRoute) => hits.find((hit) => hit.route === route) ?? null;
  const shownHit = shown ? hitOf(shown) : null;

  // The row the arrow keys are on, so the list can be read without a mouse.
  const [cursor, setCursor] = useState(0);

  /**
   * What the live channel can promise *here*, read from the list that decides
   * reloading. The Guide describing a page it does not refresh is the same
   * over-claim the chip was making, and this panel is rendered on every page.
   */
  const feeds = areasFeeding(watched, pathname);
  const seconds = everyMs ? Math.round(everyMs / 1000) : null;

  /**
   * Whether a list of a page's manual is open. Someone toggling one wins over
   * everything else; the default for the rest is `openLists`, which is the same
   * rule the probe reads.
   */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  function isOpen(route: StaffRoute, section: GuideSection): boolean {
    const key = `${route}:${section}`;
    if (key in folded) return folded[key] === true;
    return openLists(needle, hitOf(route)).includes(section);
  }

  /**
   * The rows the list shows, in rail order, with the ones the box rules out
   * removed. A screen stays when every word fits its name or its one-line hint, or
   * when its manual says them — the second half being exactly what `searchGuide`
   * answers, so the box never claims to search text it does not read.
   */
  const terms = needle.toLowerCase().split(/\s+/).filter(Boolean);
  const allRows = navSections().flatMap((group) =>
    group.items.map((item) => ({ group: group.title as string, item }))
  );
  const listRows =
    terms.length === 0
      ? allRows
      : allRows.filter(
          ({ item }) =>
            terms.every((term) => `${item.label} ${item.hint}`.toLowerCase().includes(term)) ||
            hitOf(item.href) !== null
        );

  /** Regrouped for the headings, keeping the rail's order rather than the match score. */
  const groups: { title: string; rows: typeof listRows }[] = [];
  for (const row of listRows) {
    const last = groups[groups.length - 1];
    if (last && last.title === row.group) last.rows.push(row);
    else groups.push({ title: row.group, rows: [row] });
  }
  const active = Math.min(cursor, Math.max(listRows.length - 1, 0));
  const rowId = useId();
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  /** Below `lg` the two panes stack, so a pick has to bring the manual back into sight. */
  const manualRef = useRef<HTMLElement | null>(null);

  function moveCursor(down: boolean) {
    if (listRows.length === 0) return;
    const from = Math.min(cursor, listRows.length - 1);
    const next = down
      ? (from + 1) % listRows.length
      : (from - 1 + listRows.length) % listRows.length;
    setCursor(next);
    const href = listRows[next]?.item.href;
    if (href) rowRefs.current[href]?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Read one screen's manual. `block: "nearest"` is what keeps this a no-op on a
   * wide screen, where both panes are already in sight.
   */
  function readPage(route: StaffRoute) {
    setPinned({ from: pathname, route });
    manualRef.current?.scrollIntoView({ block: "nearest" });
  }

  function readCursor() {
    const row = listRows[active];
    if (row) readPage(row.item.href);
  }

  return (
    <PanelShell
      id="guide"
      open={open}
      label="Portal guide"
      width="w-[min(96vw,920px)]"
      maxHeight="max-h-[min(84vh,680px)]"
    >
      <PanelTitle note="Written from each page's own render and actions, so a screen cannot grow a button this guide does not mention.">
        Guide
      </PanelTitle>

      <Note>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-semibold text-brand-ink/70">Keys:</span>
          <Kbd>{GUIDE_KEY_LABEL}</Kbd>
          <span>or</span>
          <Kbd>{HELP_KEY}</Kbd>
          <span>this guide,</span>
          <Kbd>{SEARCH_KEY}</Kbd>
          <span>the search box,</span>
          <Kbd>Esc</Kbd>
          <span>close a panel, and a screen&apos;s letter under</span>
          <Kbd>Ctrl+Alt</Kbd>
          <span>goes straight there — the chord each row prints.</span>
        </span>
        <span className="mt-1 block">
          On a Mac the chord is {CHORD_LABEL_MAC} instead of Ctrl+Alt. Nothing moves while
          the caret is in a field, and a letter on its own does nothing at all: the portal
          only ever takes a key that already has the chord on it, so copy, print, reload
          and the browser&apos;s own tabs stay the browser&apos;s.
        </span>
      </Note>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {shown && guide && entry && (
          <section
          ref={manualRef}
          className="rail-scroll rounded-2xl border border-brand-line bg-white p-3 shadow-soft lg:col-start-2 lg:row-start-1 lg:max-h-[min(56vh,440px)] lg:overflow-y-auto"
        >
            <div className="flex items-start gap-2.5">
              <entry.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold leading-tight">
                  {entry.label}
                  <Kbd>{keyLabelFor(shown)}</Kbd>
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      shown === here ? "text-brand-gold-dark" : "text-brand-ink/40"
                    )}
                  >
                    {shown === here ? "here now" : "another page"}
                  </span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/70">{guide.purpose}</p>
                {needle && shownHit && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-brand-gold-dark">
                    {shownHit.sentences} sentence{shownHit.sentences === 1 ? "" : "s"} of this
                    page carry “{needle}”
                    {shownHit.sections.length > 0 && (
                      <> — under {shownHit.sections.map((s) => GUIDE_SECTION_LABELS[s].short).join(", ")}.</>
                    )}
                    {shownHit.sections.length === 0 && " — in its one-line purpose."}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {GUIDE_SECTIONS.map((section) => (
                <GuideSectionBlock
                  key={section}
                  label={GUIDE_SECTION_LABELS[section].heading}
                  items={guide[section]}
                  tone={section === "edges" ? "edge" : "plain"}
                  open={isOpen(shown, section)}
                  onToggle={() =>
                    setFolded((current) => ({
                      ...current,
                      [`${shown}:${section}`]: !isOpen(shown, section),
                    }))
                  }
                />
              ))}
            </div>

            <div className="mt-3 border-t border-brand-line/70 pt-2">
              {shown === here ? (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-brand-ink/45">
                  <span>You are on this page —</span>
                  <Kbd>{keyLabelFor(shown)}</Kbd>
                  <span>opens it from anywhere, and picking another screen in the list reads its guide without leaving.</span>
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={shown}
                    transitionTypes={navForward}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-2.5 py-1.5 text-[11px] font-semibold text-brand-cream transition hover:opacity-90"
                  >
                    <entry.icon className="h-3.5 w-3.5" aria-hidden />
                    Open {entry.label}
                  </Link>
                  <span className="flex items-center gap-1.5 text-[11px] text-brand-ink/45">
                    <Kbd>{keyLabelFor(shown)}</Kbd>
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

        <aside className="rail-scroll rounded-2xl border border-brand-line bg-brand-cream/50 p-3 lg:col-start-1 lg:row-start-1 lg:max-h-[min(56vh,440px)] lg:overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/35">
            Every screen
          </p>
          <div className="relative mt-1.5">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-ink/40"
              aria-hidden
            />
            <input
              id={`${rowId}-box`}
              type="search"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveCursor(true);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveCursor(false);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  readCursor();
                } else if (event.key === CLOSE_KEY) {
                  if (typed) {
                    event.stopPropagation();
                    setTyped("");
                    setCursor(0);
                  } else {
                    event.currentTarget.blur();
                  }
                }
              }}
              placeholder="Search the manual"
              aria-label="Search the guide — every sentence on every screen"
              aria-controls={`${rowId}-rows`}
              aria-activedescendant={
                listRows[active] ? `${rowId}-${listRows[active].item.href}` : undefined
              }
              className="w-full rounded-xl border border-brand-line bg-white py-2 pl-8 pr-2.5 text-xs leading-tight placeholder:text-brand-ink/35 focus:border-brand-gold focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/45">
            {terms.length === 0 ? (
              <>
                {allRows.length} screens, in the order the rail lists them. Type a word and the
                box reads each page&rsquo;s whole manual, not only its name.{" "}
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> walk the list, <Kbd>Enter</Kbd> reads the screen it is
                standing on.
              </>
            ) : (
              <>
                {listRows.length} of {allRows.length} screens say “{needle}”.{" "}
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Enter</Kbd> to read one, <Kbd>Esc</Kbd> to
                empty the box and again to close the guide.
              </>
            )}
          </p>

          {listRows.length === 0 ? (
            <p className="mt-2 rounded-xl border border-brand-line bg-white px-3 py-2.5 text-[11px] leading-relaxed text-brand-ink/55">
              No page in this guide uses “{needle}”. Try a word off the screen itself — a button
              label, or the thing that page refuses to do.
            </p>
          ) : (
            <div
              id={`${rowId}-rows`}
              role="listbox"
              aria-label="Portal screens"
              className="mt-2 space-y-2.5"
            >
              {groups.map((group) => (
                <div key={group.title} role="group" aria-label={group.title}>
                  <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/35">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.rows.map(({ item }) => {
                      const isHere =
                        pathname === item.href || pathname.startsWith(`${item.href}/`);
                      const reading = shown === item.href;
                      const onCursor = listRows[active]?.item.href === item.href;
                      const hit = hitOf(item.href);
                      const inLabelOrHint = terms.every((term) =>
                        `${item.label} ${item.hint}`.toLowerCase().includes(term)
                      );
                      return (
                        <button
                          key={item.href}
                          id={`${rowId}-${item.href}`}
                          ref={(node) => {
                            rowRefs.current[item.href] = node;
                          }}
                          type="button"
                          role="option"
                          aria-selected={onCursor}
                          onClick={() => readPage(item.href)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white hover:shadow-soft",
                            reading && "bg-white shadow-soft",
                            onCursor && "ring-1 ring-brand-gold",
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
                            <span className="block text-xs font-semibold leading-tight">
                              {item.label}
                              {isHere && (
                                <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-gold-dark">
                                  here
                                </span>
                              )}
                            </span>
                            <span className="block text-[10px] leading-tight text-brand-ink/50">
                              {item.hint}
                            </span>
                            {hit && !inLabelOrHint && (
                              <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-brand-gold-dark">
                                {hit.sentences} sentence
                                {hit.sentences === 1 ? "" : "s"} in its guide
                                {hit.sections.length > 0
                                  ? ` — ${hit.sections
                                      .map((s) => GUIDE_SECTION_LABELS[s].short)
                                      .join(", ")}`
                                  : " — its one-line purpose"}
                              </span>
                            )}
                          </span>
                          <Kbd>{keyLabelFor(item.href)}</Kbd>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <details className="mt-3 border-t border-brand-line pt-2">
        <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45 transition hover:text-brand-ink/70">
          How the portal itself works
        </summary>
        <div className="mt-2">
        <p className="text-[11px] leading-relaxed text-brand-ink/55">
          A candidate moves New → AI screening → Assessment → Interview → Offer →
          Hired, or out to Rejected. Screening, scoring and feedback are
          model-assisted, and offers and hires are always decided by a person.
          The two thresholds in Settings → AI &amp; screening are the exception:
          a screened score at or above the auto-advance threshold (75% as
          shipped) moves an application nobody has touched yet to Assessment,
          and one below the auto-reject threshold (40%) closes it, storing that
          score and summary as the rejection reason on the candidate&rsquo;s
          profile. Set
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
          Two screens sit outside the assistant&rsquo;s reach:{" "}
          <span className="font-semibold">Activity</span> reads the table built by
          db/migrations/024_activity_log.sql and{" "}
          <span className="font-semibold">Time Tracker</span> the one built by
          db/migrations/025_time_entries.sql, and both are applied on this
          database, so each page lists real rows. The chat simply has no tool for
          either. On a database that has not applied one of those two files, its
          page says the table has not been created yet and refuses its writes.
        </p>
        </div>
      </details>
    </PanelShell>
  );
}
