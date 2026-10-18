"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import {
  EMPTY_FILTERS,
  FACETS,
  activeFacetCount,
  employmentLabel,
  facetOptions,
  filterJobs,
  readFilters,
  sectorLabel,
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

/**
 * The applicant-facing job board: search, filters, and the openings they narrow,
 * grouped by the company hiring for them.
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
  const salary = formatSalaryRange({
    min: job.min_salary_usd,
    max: job.max_salary_usd,
    currency: job.salary_currency,
  });

  const tags = [
    job.department,
    job.sector ? sectorLabel(job.sector) : "",
    job.employment_type ? employmentLabel(job.employment_type) : "",
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
          View &amp; apply
          <ArrowRight
            className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

/**
 * The anchor a company block is jumped to by.
 *
 * Built from the row's own slug where the page has one, so an address a candidate
 * shares names the company rather than a numbered section that shifts when the
 * board is filtered.
 */
function anchorFor(section: CompanySection): string {
  const folded = (section.company?.slug || section.name)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `company-${folded || "unlisted"}`;
}

/**
 * One company on the board: who it is, and what it is hiring for.
 *
 * The prose is the company's own, read from the row the recruiter edits in
 * Settings → Master data → Companies, so a company that has never had its story
 * written shows its name and its roles rather than a paragraph invented here.
 */
function CompanyBlock({ section }: { section: CompanySection }) {
  const { company, name, jobs } = section;
  const atAGlance = company ? companyAtAGlance(company) : [];
  const paragraphs = company ? splitParagraphs(company.history) : [];
  const opening = company ? splitParagraphs(company.description) : [];

  return (
    <section
      id={anchorFor(section)}
      className="mt-10 scroll-mt-24 first:mt-8"
      aria-label={`${name} — open roles`}
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
            <div key={figure.label} className="flex items-baseline gap-1.5">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                {figure.label}
              </dt>
              <dd className="text-xs font-semibold text-brand-ink/70">{figure.value}</dd>
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
        {jobs.length === 1 ? "1 open role" : `${jobs.length} open roles`}
      </h3>
      <ul className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CareersBoard({
  jobs,
  companies,
}: {
  jobs: PublicJob[];
  companies: PublicCompany[];
}) {
  const filters = useSyncExternalStore(
    subscribe,
    () => filtersForSearch(window.location.search),
    () => EMPTY_FILTERS
  );

  const shown = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);

  // Grouped after filtering, not before: a company whose every opening the
  // applicant has just filtered out has no section on screen, so the page never
  // shows a heading over an empty list of roles.
  const sections = useMemo(
    () => sectionsForBoard(shown, companies),
    [shown, companies]
  );

  // A facet offering one value filters nothing, so it is not offered at all; it
  // appears as soon as the board holds two kinds of role to tell apart.
  const facets = useMemo(
    () =>
      FACETS.map((facet) => ({
        ...facet,
        options: facetOptions(jobs, facet.field),
      })).filter((facet) => facet.options.length > 1),
    [jobs]
  );

  const narrowed = Boolean(filters.q.trim()) || activeFacetCount(filters) > 0;

  return (
    <>
      {jobs.length > 0 && (
        <section
          aria-label="Search and filter open roles"
          className="mt-10 rounded-2xl border border-brand-line bg-white p-4 shadow-soft sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <span className="sr-only">Search open roles</span>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/35"
                aria-hidden
              />
              <input
                value={filters.q}
                onChange={(event) => publish({ ...filters, q: event.target.value })}
                placeholder="Search a role, team, city or company"
                className="w-full rounded-xl border border-brand-line bg-brand-cream/40 py-2.5 pl-10 pr-9 text-sm outline-none transition placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white"
              />
              {filters.q && (
                <button
                  type="button"
                  onClick={() => publish({ ...filters, q: "" })}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink"
                  aria-label="Clear the search text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </label>

            <div className="flex flex-wrap gap-2">
              {facets.map((facet) => (
                <label key={facet.field} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                    {facet.label}
                  </span>
                  <select
                    value={filters[facet.field]}
                    onChange={(event) =>
                      publish({ ...filters, [facet.field]: event.target.value })
                    }
                    className="rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold text-brand-ink/70 outline-none transition focus:border-brand-gold"
                  >
                    <option value="">Any</option>
                    {facet.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.count})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-brand-ink/55">
            <p aria-live="polite">
              <span className="font-bold text-brand-ink">{shown.length}</span>{" "}
              {shown.length === 1 ? "role" : "roles"}
              {narrowed ? ` of ${jobs.length} open` : " open"}
            </p>
            {narrowed ? (
              <button
                type="button"
                onClick={() => publish(EMPTY_FILTERS)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-2.5 py-1 font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden />
                Clear filters
              </button>
            ) : (
              facets.length > 0 && (
                <span className="text-brand-ink/40">
                  Filter by {facets.map((facet) => facet.label.toLowerCase()).join(", ")}
                </span>
              )
            )}
          </div>
        </section>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<BriefcaseBusiness className="h-8 w-8" aria-hidden />}
          title="No open roles right now"
          description="Please check back soon — new openings are posted here as soon as they are approved."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" aria-hidden />}
          title="Nothing matches that search"
          description={`None of the ${jobs.length} open ${jobs.length === 1 ? "role" : "roles"} fit the words and filters you chose. Clear them to see the whole board.`}
        />
      ) : (
        <>
          {/* The board is one page per company now, so the names are offered as
              links before the list: a candidate who knows which company they want
              jumps there instead of scrolling through the others' openings. */}
          {sections.length > 1 && (
            <nav
              aria-label="Companies with open roles"
              className="mt-8 flex flex-wrap gap-2"
            >
              {sections.map((section) => (
                <a
                  key={anchorFor(section)}
                  href={`#${anchorFor(section)}`}
                  className="rounded-full border border-brand-line bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:border-brand-gold/50 hover:text-brand-ink"
                >
                  {section.name}
                  <span className="ml-1.5 text-brand-ink/40">{section.jobs.length}</span>
                </a>
              ))}
            </nav>
          )}

          {sections.map((section) => (
            <CompanyBlock key={anchorFor(section)} section={section} />
          ))}
        </>
      )}
    </>
  );
}
