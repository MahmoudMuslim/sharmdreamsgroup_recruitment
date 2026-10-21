"use client";

import {
  useEffect,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search
} from "lucide-react";
import { NAV } from "@/modules/analytics/presentation/nav";
import {
  SEARCH_INPUT_ID,
  SEARCH_KEY
} from "@/modules/shell/domain/quickKeys";
import { navForward } from "@/modules/shell/domain/navTransition";
import {
  searchPortal,
  type PortalSearchResult,
  type SearchHit
} from "@/modules/shell/application/shell-actions";
import { Note, PanelShell } from "./AppBarPrimitives";

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
      transitionTypes={navForward}
      className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white hover:shadow-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{hit.title}</span>
        <span className="block truncate text-[11px] text-brand-ink/50">{hit.subtitle}</span>
      </span>
    </Link>
  );
}

export function SearchField({
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
    router.push(href, { transitionTypes: navForward });
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
