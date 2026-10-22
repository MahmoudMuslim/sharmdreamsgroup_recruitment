"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  EMPTY_FILTERS,
  FACETS,
  activeFacetCount,
  employmentLabel,
  experienceLabel,
  facetOptions,
  filterJobs,
  isTicked,
  readFilters,
  sectorLabel,
  toggleFacet,
  writeFilters,
  type BoardFilters,
  type PublicJob,
} from "@/modules/careers/job-board";
import {
  companyAtAGlance,
  sectionsForBoard,
  splitParagraphs,
  type CompanySection,
  type PublicCompany,
} from "@/modules/careers/company-profile";
import { formatSalaryRange } from "@/lib/currency";
import { EmptyState } from "@/modules/analytics/presentation/ui";
import { hasKey, translate } from "@/lib/i18n";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types";

/**
 * The applicant-facing job board: a sidebar of search and ticked filters, the
 * group's companies as a strip of tabs, and the openings those choices leave in
 * the column beside them.
 *
 * Filtering runs here rather than on the server because `getPublicJobs` already
 * returns every PUBLISHED opening — the read carries no limit — so the whole
 * board is in hand and a keystroke needs no round trip. That is what makes the
 * search live instead of a form to submit, and it keeps `/careers` prerendered
 * rather than turning a public page into a per-visit server render.
 */

/* The address bar holds the board's state, so a filtered view is a link an
 * applicant can send someone and a back button can return to. `useSyncExternalStore`
 * reads it as a store: on the server the board is unfiltered, and the client's
 * own query string replaces that the moment hydration finishes. */

const listeners = new Set<() => void>();

// One-entry memo, because `readFilters` would otherwise hand out a new object on
// every read and React treats an unstable snapshot as a store in an update loop.
let cachedSearch: string | null = null;
let cachedFilters: BoardFilters = EMPTY_FILTERS;

function filtersForSearch(search: string): BoardFilters {
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedFilters = readFilters(search);
  }
  return cachedFilters;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function publish(filters: BoardFilters): void {
  const query = writeFilters(filters);
  const search = query ? `?${query}` : "";
  if (window.location.search === search) return;
  window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  // `replaceState` fires no event of its own, so the board is told to re-read.
  for (const listener of listeners) listener();
}

function JobCard({ job }: { job: PublicJob }) {
  const lang = usePublicLocale();
  const salary = formatSalaryRange({
    min: job.min_salary_usd,
    max: job.max_salary_usd,
    currency: job.salary_currency,
  });

  const tags = [
    job.department,
    job.sector ? sectorLabel(job.sector, lang) : "",
    job.employment_type ? employmentLabel(job.employment_type, lang) : "",
    // A level nobody recorded prints nothing: the card does not claim a middle
    // tier for every opening that predates the column.
    job.experience_level ? experienceLabel(job.experience_level, lang) : "",
  ].filter(Boolean);

  return (
    <Link
      href={`/careers/${job.id}`}
      className="group flex h-full flex-col rounded-2xl border border-brand-line bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:shadow-lift"
    >
      <h2 className="font-display text-xl font-bold leading-snug">{job.title}</h2>

      <p className="mt-2 flex items-center gap-1.5 text-sm text-brand-ink/55">
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        {job.location}
      </p>

      <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-brand-ink/65">
        {job.description}
      </p>

      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-brand-ink/55">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-brand-sand px-2.5 py-1">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        {salary ? (
          <span className="font-mono text-xs text-brand-ink/50">{salary}</span>
        ) : (
          <span />
        )}
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark">
          {translate(lang, "careers.viewApply")}
          <ArrowRight
            className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

/**
 * The address a company block is jumped to by, and the value its tab is picked
 * by.
 *
 * Both are built from the row's own slug where the page has one, so an address a
 * candidate shares names the company rather than a numbered section that shifts
 * when the board is filtered — and a shared `?company=` link still points at the
 * same employer after a recruiter reorders the group.
 */
function slugFold(text: string): string {
  return text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function anchorFor(section: CompanySection): string {
  return `company-${slugFold(section.company?.slug || section.name) || "unlisted"}`;
}

function tabFor(section: CompanySection): string {
  return section.company?.slug || slugFold(section.name) || "unlisted";
}

/**
 * One company on the board: who it is, and what it is hiring for.
 *
 * The prose is the company's own, read from the row the recruiter edits in
 * Settings → Master data → Companies, so a company that has never had its story
 * written shows its name and its roles rather than a paragraph invented here.
 */
function CompanyBlock({ section }: { section: CompanySection }) {
  const lang = usePublicLocale();
  const { company, name, jobs } = section;
  const atAGlance = company ? companyAtAGlance(company) : [];
  const paragraphs = company ? splitParagraphs(company.history) : [];
  const opening = company ? splitParagraphs(company.description) : [];

  return (
    <section
      id={anchorFor(section)}
      className="mt-8 scroll-mt-24 first:mt-0"
      aria-label={`${name} — ${translate(lang, jobs.length === 1 ? "board.openRole" : "board.openRoles", { count: jobs.length })}`}
    >
      <h2 className="font-display text-2xl font-bold tracking-tight">{name}</h2>
      {company?.legal_name && company.legal_name !== name && (
        <p className="mt-1 text-xs text-brand-ink/45">{company.legal_name}</p>
      )}
      {company?.tagline && (
        <p className="mt-2 text-sm font-semibold text-brand-gold-dark">{company.tagline}</p>
      )}

      {atAGlance.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
          {atAGlance.map((figure) => (
            <div key={figure.labelKey} className="flex items-baseline gap-1.5">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                {translate(lang, figure.labelKey)}
              </dt>
              <dd className="text-xs font-semibold text-brand-ink/70">
                {figure.valueKey && hasKey(figure.valueKey)
                  ? translate(lang, figure.valueKey)
                  : figure.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {(company?.careers_pitch ?? null) && (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-brand-ink/65">
          {company?.careers_pitch}
        </p>
      )}

      {opening.length > 0 && (
        <div className="mt-3 max-w-3xl space-y-3">
          {opening.map((paragraph, index) => (
            <p
              key={index}
              className="whitespace-pre-line text-sm leading-relaxed text-brand-ink/60"
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {company && company.milestones.length > 0 && (
        <ul className="mt-4 max-w-3xl space-y-2 border-l border-brand-line pl-4">
          {company.milestones.map((milestone, index) => (
            <li key={`${milestone.title}-${index}`} className="text-sm leading-relaxed">
              <span className="font-mono text-xs text-brand-gold-dark">
                {milestone.year ? milestone.year : "—"}
              </span>{" "}
              <span className="font-semibold">{milestone.title}</span>
              {milestone.detail && (
                <span className="text-brand-ink/60"> · {milestone.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {paragraphs.length > 0 && (
        <div className="mt-4 max-w-3xl space-y-3">
          {paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="whitespace-pre-line text-sm leading-relaxed text-brand-ink/60"
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}

      <h3 className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
        {translate(lang, jobs.length === 1 ? "board.openRole" : "board.openRoles", {
          count: jobs.length,
        })}
      </h3>
      <ul className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The board: a column of choices beside the openings they leave standing.
 *
 * Search and the ticked facets live in the sidebar, so an applicant narrows the
 * list without ever losing sight of what they have already chosen — the counts
 * next to each box say how many roles each extra tick would cost them. The
 * group's companies are the strip above the list instead: one employer's openings
 * at a time, so a candidate reads a short page rather than scrolling through four
 * companies' headings, histories and role grids stacked one under the next.
 */

/**
 * How many of the board's openings the choices leave standing, and the one
 * button that puts them all back.
 *
 * Rendered twice — in the phone toolbar and above the desktop results column —
 * because on a phone the sidebar sits between this line and the list, and a
 * count that only appears below the panel is a count you have to scroll past
 * the filters to find. The one that is hidden for the current breakpoint is
 * `display: none`, so a screen reader is only ever told the number once.
 *
 * With a company tab picked, the number is that employer's, and naming it here
 * is what keeps the line above the list from claiming more roles than the one
 * block below it actually holds.
 */
function ResultSummary({
  lang,
  filters,
  shown,
  total,
  company,
}: {
  lang: Locale;
  filters: BoardFilters;
  shown: number;
  total: number;
  company: string | null;
}) {
  const narrowed = Boolean(filters.q.trim()) || activeFacetCount(filters) > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p aria-live="polite" className="text-sm font-semibold text-brand-ink">
        {company
          ? translate(
              lang,
              shown === 1 ? "board.showingCompanyOne" : "board.showingCompanyMany",
              { shown, company }
            )
          : translate(lang, narrowed ? "board.showingFiltered" : "board.showingAll", {
              shown,
              total,
            })}
      </p>
      {(narrowed || company) && (
        <button
          type="button"
          onClick={() => publish(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <X className="h-3 w-3" aria-hidden />
          {translate(lang, "board.clearFilters")}
        </button>
      )}
    </div>
  );
}

/**
 * The companies on the board, side by side instead of stacked.
 *
 * Buttons in a strip, not ARIA tabs: an ARIA tablist promises arrow-key movement
 * between its tabs, and a board that is really a filtered list would need a
 * focus manager to keep that promise. As buttons, tab, Enter and the screen
 * reader's own list-of-buttons all work untouched, and `aria-current` says which
 * company is on screen.
 *
 * The strip scrolls sideways rather than wrapping, because three rows of company
 * names would push the first role off the fold on a phone — the point of a tab
 * is that the list starts higher than the page of headings it replaced.
 */
function CompanyTabs({
  lang,
  sections,
  active,
  onPick,
}: {
  lang: Locale;
  sections: CompanySection[];
  active: string;
  onPick: (tab: string) => void;
}) {
  const pill =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition";

  return (
    <nav
      aria-label={translate(lang, "board.companiesAria")}
      className="mb-5 border-b border-brand-line pb-3"
    >
      <ul className="flex gap-2 overflow-x-auto pb-1">
        <li>
          <button
            type="button"
            onClick={() => onPick("")}
            aria-current={active ? undefined : "true"}
            className={cn(
              pill,
              active
                ? "border-brand-line bg-white text-brand-ink/70 hover:bg-brand-sand hover:text-brand-ink"
                : "border-brand-ink bg-brand-ink text-brand-cream"
            )}
          >
            {translate(lang, "board.tabAll")}
          </button>
        </li>
        {sections.map((section) => {
          const tab = tabFor(section);
          const picked = tab === active;
          return (
            <li key={tab}>
              <button
                type="button"
                onClick={() => onPick(picked ? "" : tab)}
                aria-current={picked ? "true" : undefined}
                className={cn(
                  pill,
                  picked
                    ? "border-brand-ink bg-brand-ink text-brand-cream"
                    : "border-brand-line bg-white text-brand-ink/70 hover:bg-brand-sand hover:text-brand-ink"
                )}
              >
                {section.name || translate(lang, "board.tabUnlisted")}
                <span
                  className={cn(
                    "font-mono text-[11px]",
                    picked ? "text-brand-cream/70" : "text-brand-ink/40"
                  )}
                >
                  {section.jobs.length}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CareersBoard({
  jobs,
  companies,
}: {
  jobs: PublicJob[];
  companies: PublicCompany[];
}) {
  const lang = usePublicLocale();
  const filters = useSyncExternalStore(
    subscribe,
    () => filtersForSearch(window.location.search),
    () => EMPTY_FILTERS
  );

  // On a phone the choices would otherwise sit between the heading and the first
  // role, so they are folded away until asked for; from `lg` up the column is
  // beside the list and always open.
  const [panelOpen, setPanelOpen] = useState(false);

  const shown = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);

  // Grouped after filtering, not before: a company whose every opening the
  // applicant has just filtered out has no section on screen, so the page never
  // shows a heading over an empty list of roles.
  const sections = useMemo(() => sectionsForBoard(shown, companies), [shown, companies]);

  // A tab names a company, so it survives a filter change only while that company
  // still has a role on the board. When it does not, the strip falls back to
  // "All companies" rather than leaving a highlighted tab over an empty column —
  // an applicant who arrives on an old shared link sees the whole board, not a
  // page that looks broken.
  const onScreen = sections.find((section) => tabFor(section) === filters.tab) ?? null;
  const activeTab = onScreen ? filters.tab : "";
  const visible = onScreen ? [onScreen] : sections;
  const openHere = visible.reduce((count, section) => count + section.jobs.length, 0);

  // A facet offering one value filters nothing, so it is not offered at all; it
  // appears as soon as the board holds two kinds of role to tell apart.
  const facets = useMemo(
    () =>
      FACETS.map((facet) => ({
        ...facet,
        options: facetOptions(jobs, facet.field, lang),
      })).filter((facet) => facet.options.length > 1),
    [jobs, lang]
  );

  const ticked = activeFacetCount(filters);

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<BriefcaseBusiness className="h-8 w-8" aria-hidden />}
        title={translate(lang, "board.emptyTitle")}
        description={translate(lang, "board.emptyBody")}
      />
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 lg:hidden">
        <ResultSummary
          lang={lang}
          filters={filters}
          shown={openHere}
          total={jobs.length}
          company={onScreen?.name ?? null}
        />
        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-bold text-brand-ink/75 shadow-soft transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {translate(lang, panelOpen ? "board.hideFilters" : "board.filters")}
          {ticked > 0 && (
            <span className="rounded-full bg-brand-ink px-1.5 py-0.5 font-mono text-[10px] text-brand-cream">
              {ticked}
            </span>
          )}
        </button>
      </div>

      <div className="mt-3 lg:mt-0 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* `panel-fold` is the glass marker: `lg:sticky` compiles to a
            `lg\:sticky` class and the stylesheet frosts `.sticky`, so a sidebar
            that only goes sticky at `lg` has to name itself for the film to be
            drawn behind it. */}
        <aside
          aria-label={translate(lang, "board.searchAria")}
          className={cn(
            "panel-fold rounded-2xl border border-brand-line bg-white p-4 shadow-soft",
            "lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto",
            panelOpen ? "block" : "hidden lg:block"
          )}
        >
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
              {translate(lang, "board.searchLabel")}
            </span>
            <span className="relative mt-1.5 block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/35 rtl:left-auto rtl:right-3"
                aria-hidden
              />
              <input
                value={filters.q}
                onChange={(event) => publish({ ...filters, q: event.target.value })}
                placeholder={translate(lang, "board.searchPlaceholder")}
                className="w-full rounded-xl border border-brand-line bg-brand-cream/40 py-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white rtl:pl-8 rtl:pr-9"
              />
              {filters.q && (
                <button
                  type="button"
                  onClick={() => publish({ ...filters, q: "" })}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink rtl:left-1.5 rtl:right-auto"
                  aria-label={translate(lang, "board.clearSearch")}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </span>
          </label>

          {facets.length > 0 && (
            <div className="mt-5 border-t border-brand-line pt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
                {translate(lang, "board.filters")}
              </p>

              <div className="mt-3 space-y-4">
                {facets.map((facet) => (
                  <fieldset key={facet.field}>
                    <legend className="text-xs font-bold text-brand-ink/70">
                      {translate(lang, facet.labelKey)}
                    </legend>
                    <ul className="mt-1.5 space-y-1">
                      {facet.options.map((option) => (
                        <li key={option.value}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-xs transition hover:bg-brand-sand">
                            <input
                              type="checkbox"
                              checked={isTicked(filters[facet.field], option.value)}
                              onChange={() =>
                                publish(toggleFacet(filters, facet.field, option.value))
                              }
                              className="h-3.5 w-3.5 shrink-0 accent-brand-gold"
                            />
                            <span className="min-w-0 flex-1 truncate text-brand-ink/75">
                              {option.label}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-brand-ink/40">
                              {option.count}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                ))}
              </div>
            </div>
          )}

        </aside>

        <div className="mt-6 min-w-0 lg:mt-0">
          {sections.length > 1 && (
            <CompanyTabs
              lang={lang}
              sections={sections}
              active={activeTab}
              onPick={(tab) => publish({ ...filters, tab })}
            />
          )}

          <div className="mb-4 hidden lg:block">
            <ResultSummary
              lang={lang}
              filters={filters}
              shown={openHere}
              total={jobs.length}
              company={onScreen?.name ?? null}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={<Search className="h-8 w-8" aria-hidden />}
              title={translate(lang, "board.emptyMatchTitle")}
              description={translate(lang, "board.emptyMatchBody", { count: jobs.length })}
            />
          ) : (
            visible.map((section) => (
              <CompanyBlock key={anchorFor(section)} section={section} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
