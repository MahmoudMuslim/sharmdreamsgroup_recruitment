"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  listSettingsTrail,
  type SettingsTrailEntryView,
  type SettingsTrailRead,
} from "@/modules/settings/application/settings-trail-actions";
import {
  SETTINGS_TRAIL_LIMIT,
  settingsTrailNote,
  trailFind,
  trailGroup,
  trailGroupById,
  trailPage,
  trailPageCount,
} from "@/modules/settings/domain/settingsTrail";

/**
 * Write the scope, the page and the words into the address bar.
 *
 * `replaceState` rather than a router push: the point is that the bar matches what
 * is on screen, and a push would remount this panel through the page's own read and
 * throw away the rows the reader is looking at. Page 1 and an empty box write
 * nothing, so the bar never carries a parameter that changed nothing.
 */
function writeUrl(
  pathname: string,
  nextGroup: string | null,
  nextPage: number,
  nextFind: string | null
) {
  const search = new URLSearchParams(window.location.search);
  if (nextGroup === null) search.delete("trail");
  else search.set("trail", nextGroup);
  if (nextPage <= 1) search.delete("page");
  else search.set("page", String(nextPage));
  if (nextFind === null) search.delete("find");
  else search.set("find", nextFind);
  window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
}

/**
 * Everything the section shows comes from one read of `settings_audit_log`, so the
 * counts under the heading and the rows beneath them are taken from the same query
 * with the same predicate. A list that said "152 recorded" beside 15 rows invited
 * the reader to divide one by the other.
 *
 * The trail is 152 rows deep and a page is 15, so the only honest question after
 * the first page is "what about the rest?". This answers it with a pager rather
 * than a bigger cap: "Show earlier changes" moves to the next 15 rows of the same
 * scope, the address bar carries the page, and the note names the page it is
 * standing on. The same `listSettingsTrail` the chat calls serves both, so a
 * screen and an answer cannot be looking at different rows.
 *
 * The search box matches the rows the console prints — a key, the label beside it,
 * either stored value, an actor's name — and it is a search of the same read, not a
 * filter of what happens to be on screen, because a match is usually on a page the
 * reader has not walked to. That is why it commits on submit rather than on every
 * keystroke: each commit is a server read over a window of rows, and the /activity
 * console's box runs by the same rule. Words, scope and page all live in the URL, so
 * a chat answer about "the timeout change" links to the rows it searched out.
 *
 * A refused read arrives as `read` rather than as an empty trail, because "nobody
 * has changed anything" and "you are not shown what people changed" are different
 * sentences — and only one of them is a fact about the reader's permissions.
 */
export function SettingsTrailConsole({
  read,
  scope,
  page: seededPage,
  find: seededFind,
}: {
  /** The page's own read, so the first paint costs no round trip. */
  read: SettingsTrailRead;
  /** The group `?trail=` asked for, already validated by the page. */
  scope: string | null;
  /** The page `?page=` asked for, already validated by the page. */
  page: number;
  /** The words `?find=` asked for, already normalized by the page. */
  find: string | null;
}) {
  const params = useSearchParams();
  const pathname = usePathname();

  /**
   * `?trail=`, `?page=` and `?find=` all narrow the listing, and all three are
   * written by two doors: a chat link, and a control in this panel. Because the same
   * route reached again re-renders rather than remounts, the triplet last taken from
   * the address bar is tracked and applied, so a link that arrives while the section
   * is already open still moves the listing — exactly how the keys console scopes its
   * own trail.
   */
  const incomingGroup = trailGroup(params.get("trail"));
  const incomingPage = trailPage(params.get("page"));
  const incomingFind = trailFind(params.get("find"));
  const incoming = `${incomingGroup ?? ""}|${incomingPage}|${incomingFind ?? ""}`;
  const [applied, setApplied] = useState(incoming);
  const [group, setGroup] = useState<string | null>(scope);
  const [page, setPage] = useState(read.ok ? read.page : seededPage);
  const [find, setFind] = useState<string | null>(seededFind);
  const [words, setWords] = useState(seededFind ?? "");
  if (incoming !== applied) {
    setApplied(incoming);
    setGroup(incomingGroup);
    setPage(incomingPage);
    setFind(incomingFind);
    setWords(incomingFind ?? "");
  }

  const [rows, setRows] = useState<SettingsTrailEntryView[]>(read.ok ? read.entries : []);
  const [count, setCount] = useState(read.ok ? read.total : 0);
  const [withActor, setWithActor] = useState(read.ok ? read.named : 0);
  // The note has to say how far a search looked, so the listing keeps the window it
  // was searched over and the scope's own size, not just the rows that matched.
  const [scanned, setScanned] = useState(read.ok ? read.scanned : 0);
  const [scopeRows, setScopeRows] = useState(read.ok ? read.scopeRows : 0);
  const [failure, setFailure] = useState<string | null>(read.ok ? null : read.error);
  const [pending, setPending] = useState(false);
  const readKey = useRef(`${group}|${page}|${find ?? ""}`);

  // The bar always carries what is on screen, including on the first paint: a
  // bookmark for a page the trail has outgrown is served as its oldest page, and
  // that is the number the bar keeps.
  useEffect(() => {
    writeUrl(pathname, group, page, find);
  }, [group, page, find, pathname]);

  useEffect(() => {
    const key = `${group}|${page}|${find ?? ""}`;
    if (readKey.current === key) return;
    readKey.current = key;
    let live = true;
    setPending(true);
    listSettingsTrail({ group, page, find })
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setRows(result.entries);
          setCount(result.total);
          setWithActor(result.named);
          setScanned(result.scanned);
          setScopeRows(result.scopeRows);
          setFailure(null);
          // A bookmark to a page the trail no longer holds is clamped by the read;
          // the listing follows onto the page it actually served, and the bar
          // follows the listing, so it never keeps naming rows nobody showed.
          if (result.page !== page) {
            readKey.current = `${group}|${result.page}|${find ?? ""}`;
            setPage(result.page);
          }
        } else {
          // A refused read has no rows, so the listing is cleared rather than left
          // showing an unscoped page under a scoped heading.
          setRows([]);
          setCount(0);
          setWithActor(0);
          setScanned(0);
          setScopeRows(0);
          setFailure(result.error);
        }
      })
      .catch(() => {
        if (!live) return;
        setRows([]);
        setCount(0);
        setWithActor(0);
        setScanned(0);
        setScopeRows(0);
        setFailure("The change trail could not be read.");
      })
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
  }, [group, page, find]);

  /** A new scope is a new trail, so it starts again at its newest page. */
  function openScope(next: string | null) {
    setGroup(next);
    setPage(1);
  }

  /** A new search is a new listing, and the words narrow whatever scope is open. */
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFind(trailFind(words));
    setPage(1);
  }

  function clearSearch() {
    setWords("");
    setFind(null);
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
  }

  const definition = trailGroupById(group);
  const label = definition?.label ?? null;
  const pages = trailPageCount(count);
  const lastRow = (page - 1) * SETTINGS_TRAIL_LIMIT + rows.length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-base font-bold">
          {`${find ? `Changes matching “${find}”` : page > 1 ? "Change history" : "Recent changes"}${label ? ` — ${label}` : ""}`}
        </h3>
        {group !== null && (
          <button
            type="button"
            onClick={() => openScope(null)}
            className="text-xs font-semibold text-brand-gold-dark underline underline-offset-2"
          >
            Show every change
          </button>
        )}
        {pending && (
          <span className="text-xs text-brand-ink/40" role="status">
            Loading…
          </span>
        )}
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-ink/35"
            aria-hidden
          />
          <input
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="Search a key, its name, a value, or who changed it"
            aria-label="Search the change trail"
            className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-3 text-xs text-brand-ink/80 outline-none focus:border-brand-gold"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-brand-line px-3.5 py-2 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
        >
          Search
        </button>
        {(find !== null || words !== "") && (
          <button
            type="button"
            onClick={clearSearch}
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-brand-ink/50 hover:bg-brand-sand"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </form>

      <p className="text-xs leading-relaxed text-brand-ink/55">
        {failure
          ? failure
          : settingsTrailNote({
              groupId: group,
              total: count,
              loaded: rows.length,
              named: withActor,
              page,
              search: find === null ? null : { words: find, scanned, scopeRows },
            })}
        {!failure && rows.length > 0 && (
          <span className="text-brand-ink/40">
            {" "}
            Pick a part of the console in a row to read only its changes.
          </span>
        )}
      </p>

      {!failure && rows.length > 0 && (
        <ul className="divide-y divide-brand-line rounded-2xl border border-brand-line bg-white">
          {rows.map((entry) => {
            const entryGroup = trailGroupById(entry.group);
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                {entryGroup ? (
                  <button
                    type="button"
                    onClick={() => openScope(entryGroup.id)}
                    title={`Show only ${entryGroup.label} changes`}
                    className="rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60 underline underline-offset-2 hover:text-brand-gold-dark"
                  >
                    {entryGroup.label}
                  </button>
                ) : (
                  <span
                    title="No control in this console is keyed that way, so nothing here can scope to it"
                    className="rounded-full bg-brand-cream px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45"
                  >
                    Unfiled
                  </span>
                )}
                <span className="min-w-[14rem] flex-1">
                  <span className="block text-sm font-semibold text-brand-ink/80" title={entry.key}>
                    {entry.label ?? entry.key}
                  </span>
                  <span className="block text-xs text-brand-ink/55">
                    {entry.from} <span aria-hidden>→</span> {entry.to}
                  </span>
                  {entry.label && (
                    <span className="block text-[11px] text-brand-ink/35">{entry.key}</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-brand-ink/40">
                  {entry.actor ?? "no actor recorded"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!failure && pages > 1 && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {page > 1 && (
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={pending}
              className="rounded-xl border border-brand-line px-3.5 py-2 font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
            >
              {`Newer changes (page ${page - 1})`}
            </button>
          )}
          {lastRow < count && (
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={pending}
              className="rounded-xl border border-brand-line px-3.5 py-2 font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
            >
              {`Show ${Math.min(SETTINGS_TRAIL_LIMIT, count - lastRow)} earlier changes`}
            </button>
          )}
          <span className="text-brand-ink/40">
            {`Page ${page} of ${pages}`}
            {count > SETTINGS_TRAIL_LIMIT
              ? ` — ${SETTINGS_TRAIL_LIMIT} rows a page, newest first`
              : ""}
          </span>
        </div>
      )}
    </section>
  );
}
