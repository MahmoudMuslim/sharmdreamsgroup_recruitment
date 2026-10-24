"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, CalendarClock, MapPin, Search, Users } from "lucide-react";
import { Badge, Card, EmptyState, FilterRail, Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import { formatSalaryRange } from "@/lib/currency";
import { openingSearchWords, searchOpenings } from "@/modules/jobs/domain/openingSearch";
import { gridWindowNote, isHireable } from "@/modules/jobs/domain/hireable";
import {
  demandLine,
  demandUnavailableNote,
  type HiringDemand,
} from "@/modules/jobs/domain/hiringDemand";
import {
  EMPLOYMENT_LABELS,
  experienceLabel,
} from "@/modules/jobs/domain/openingTerms";
import { Pagination } from "@/modules/analytics/presentation/Pagination";
import { PAGE_PARAM, PAGE_ROWS, clampPage, pageFromParams, pageSlice, pageWindow } from "@/lib/paging";
import { JobCardActions } from "./JobCardActions";
import { JobApplicantsDrawer } from "./JobApplicantsDrawer";
import type { JobForEdit, JobFormOptions } from "./JobFormDrawer";

export interface JobRow extends JobForEdit {
  requirements: string[] | null;
  posted_at: string | null;
  closing_at: string | null;
  /** Everyone live (not filed out) — the badge and the drawer count this. */
  applicants: { count: number }[];
  /** Applicants still in the working stages — a population now, not a movement. */
  pipeline: { count: number }[];
  /** Applicants who reached HIRED. */
  hired: { count: number }[];
  /** The `positions_needed` target, or null when none was recorded — or the column
   * is not applied yet, which the grid flags separately via `headcountUnavailable`. */
  positions_needed: number | null;
}

const STATUSES = ["PUBLISHED", "DRAFT", "PAUSED", "CLOSED"] as const;

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "danger"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  PAUSED: "gold",
  CLOSED: "danger",
};

function applicantsOf(job: JobRow) {
  return job.applicants?.[0]?.count ?? 0;
}

/** The three demand figures for one opening, read off its aliased embeds. */
function demandOf(job: JobRow): HiringDemand {
  return {
    needed: job.positions_needed,
    inPipeline: job.pipeline?.[0]?.count ?? 0,
    hired: job.hired?.[0]?.count ?? 0,
  };
}

/**
 * Whether an opening sits under the rail the grid is showing.
 *
 * `HIREABLE` is not a `job_status` — it is the set a person may still be filed
 * under, which is what the assistant's own `status` argument calls it. It has a
 * rail here so an answer that counted those roles links to a grid holding them,
 * rather than to one where the recruiter has to add up three chips to see the
 * same set.
 */
function onRail(job: JobRow, rail: string): boolean {
  if (!rail) return true;
  return rail === "HIREABLE" ? isHireable(job.status) : job.status === rail;
}

/** Which rails `?status=` may name: the four statuses, plus the hireable set. */
const RAIL_TOKENS: readonly string[] = [...STATUSES, "HIREABLE"];

/**
 * The rail a query parameter asks for.
 *
 * A token the grid has no chip for is dropped rather than kept: a parameter the
 * page cannot show would leave the link looking filtered while every opening
 * stayed on screen.
 */
function railToken(value: string | null): string {
  const token = value?.trim().toUpperCase() ?? "";
  return RAIL_TOKENS.includes(token) ? token : "";
}

/** Deadline copy, or null when the opening has no closing date. */
function closingLabel(closingAt: string | null) {
  if (!closingAt) return null;
  const days = Math.round((new Date(closingAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Closed ${Math.abs(days)}d ago`;
  if (days === 0) return "Closes today";
  return `Closes in ${days}d`;
}

/**
 * Openings browser.
 *
 * Status and company are rails rather than a dropdown because the counts are
 * the information: a recruiter scanning for "what is still in draft, and how
 * much of the pipeline sits under one company" should see it without opening
 * anything. Which rail is lit is held in the address bar, so the view a
 * recruiter lands on from the chat — or from a link pasted into a call — is the
 * view the grid shows.
 */
export function JobsBrowser({
  jobs,
  scopeTotal,
  headcountUnavailable,
  termsNote,
  options,
  canManage,
  canDecide,
}: {
  jobs: JobRow[];
  /**
   * Every opening the scope holds, including the ones this bounded read did not
   * carry. The strip counts this; the rails and the search count `jobs`.
   */
  scopeTotal: number;
  /** The `positions_needed` column could not be read at all (not applied yet), so
   * every card showing "no target set" is a read failure, not a recruiter's blank. */
  headcountUnavailable: boolean;
  /**
   * Why the seniority levels are missing, or null when the column was read.
   * Named once above the grid so a card's silence is not read as "no level was
   * recorded" when the database has nowhere to record one.
   */
  termsNote: string | null;
  options: JobFormOptions;
  canManage: boolean;
  /** `candidates.write` — who may move an applicant between stages from the drawer. */
  canDecide: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();

  /*
   * The two rails are read out of the address bar instead of held in local
   * state, so the chip that is lit, the openings under it and the link a
   * recruiter can copy describe one set — and an assistant answer that counted
   * the DRAFT roles lands on DRAFT rather than on a grid holding everything.
   */
  const status = railToken(params.get("status"));
  const company = params.get("company") ?? "";
  const page = pageFromParams(params);

  // `?job=` is where the assistant's "View the opening" link lands. The opening
  // is ringed and brought into view rather than filtered to, so the recruiter
  // still sees where it sits among the rest.
  const focusId = params.get("job");

  // `?q=` seeds the box, so an assistant answer that searched for a role links to
  // a grid showing the same openings. The words stay local while they are typed:
  // the box is written into the URL by the next rail click, not per keystroke.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sortBy, setSortBy] = useState<"newest" | "applicants" | "title">("newest");
  const [applicantsJob, setApplicantsJob] = useState<JobRow | null>(null);
  /** Which `?job=` link this grid has already turned a page for. */
  const jumpedFor = useRef<string | null>(null);

  // Arriving on the same route with different words — a chat link clicked while
  // the grid is already open — re-renders this component rather than remounting
  // it, so an incoming `?q=` is applied to the box here as well as above. Typing
  // wins until the URL itself changes, which is why the last value taken from
  // the address bar is tracked rather than compared to what is in the box.
  const incomingQuery = params.get("q");
  const [lastAppliedQuery, setLastAppliedQuery] = useState(incomingQuery);
  if (incomingQuery !== lastAppliedQuery) {
    setLastAppliedQuery(incomingQuery);
    setQuery(incomingQuery ?? "");
  }

  /**
   * Put the view into the URL.
   *
   * `history.replaceState` is enough here and is chosen over a router push on
   * purpose: this Next build patches those calls into the router, so
   * `useSearchParams` re-renders with the new query while the openings the
   * client already holds do the filtering — a rail on this grid is a view of
   * rows already loaded, not a fresh question to the database. It replaces the
   * history entry, so Back leaves the page instead of replaying chips, and it
   * carries the search words and the page along because all three are the grid's
   * own. A rail drops `?job=`, and with it the applicants drawer: a rail is a
   * question about the set, not about one opening, and the ring or the open
   * drawer may be pointing at a row the new rail no longer shows. A new word or a
   * page keeps it, because the reader is still looking for that one role.
   *
   * Omitting `page` is not "keep the page" — it is page 1, which is what a rail
   * click or a new word means. The pager is the only caller that names one.
   */
  function writeView(
    view: {
      status?: string;
      company?: string;
      query?: string;
      page?: number;
      /** `null` drops the ringed opening; omitted means the link stays. */
      job?: string | null;
    } = {}
  ) {
    const statusToken = "status" in view ? (view.status ?? "") : status;
    const companyToken = "company" in view ? (view.company ?? "") : company;
    const words = "query" in view ? (view.query ?? "") : query;
    const target = "page" in view ? (view.page ?? 1) : 1;
    const next = new URLSearchParams();
    if (statusToken) next.set("status", statusToken);
    if (companyToken) next.set("company", companyToken);
    if (words.trim()) next.set("q", words);
    if (target > 1) next.set(PAGE_PARAM, String(target));
    const ringed = "job" in view ? view.job : focusId;
    if (ringed) next.set("job", ringed);
    const search = next.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  }

  /** A rail is a question about the set, so it starts at page 1 and drops the ring. */
  function openRail(rail: { status?: string; company?: string }) {
    setApplicantsJob(null);
    writeView({ ...rail, job: null });
  }

  const companyNames = useMemo(() => {
    const map = new Map(options.companies.map((c) => [c.id, c.name]));
    return (tenantId: string) => map.get(tenantId) ?? "Unassigned company";
  }, [options.companies]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    return counts;
  }, [jobs]);

  const companyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.tenant_id, (counts.get(job.tenant_id) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const totalApplicants = useMemo(() => jobs.reduce((sum, j) => sum + applicantsOf(j), 0), [jobs]);
  const maxApplicants = Math.max(...jobs.map(applicantsOf), 1);
  /** The last chip's own count — the same predicate `onRail` answers for it. */
  const hireableCount = useMemo(() => jobs.filter((job) => onRail(job, "HIREABLE")).length, [jobs]);

  /**
   * Rails, then the shared text search, then the order.
   *
   * The predicate lives in the openings module because the assistant runs the
   * same words over the openings its own read carries: an opening the chat cannot
   * find by title must not be one the grid finds seconds later. A company is
   * resolved to its name first, because that is what a recruiter types.
   */
  /*
   * No `useMemo` here: the compiler memoizes this on its own, and the manual
   * memo could not be preserved once the page arithmetic below read the array —
   * a grid of at most a few hundred rows is not the thing worth guarding.
   */
  const visible = searchOpenings(
    jobs
      .filter((job) => onRail(job, status) && (!company || job.tenant_id === company))
      .map((job) => ({ ...job, company_name: companyNames(job.tenant_id) })),
    query
  );
  if (sortBy === "applicants") visible.sort((a, b) => applicantsOf(b) - applicantsOf(a));
  else if (sortBy === "title") visible.sort((a, b) => a.title.localeCompare(b.title));

  /**
   * One page of whatever the rails and the words match.
   *
   * The shared page size, because the grid is a wall of cards and 25 of them is
   * already a long scroll. A `?page=` past the end of the filtered set comes back
   * as the last page that has openings — an address a recruiter copied from an
   * older, wider view should show rows, not an empty grid with a pager on it.
   */
  const shownPage = clampPage(page, visible.length);
  const pageRows = pageSlice(visible, shownPage);
  const pager = pageWindow(shownPage, visible.length, pageRows.length);
  const windowNote = gridWindowNote(scopeTotal, jobs.length);

  /**
   * Which page of the matched set the ringed opening sits on, 0 when the link
   * names a row this view does not hold. A number rather than the row, so the
   * effect below depends on arithmetic and not on the grid's own array.
   */
  const focusIndex = focusId ? visible.findIndex((job) => job.id === focusId) : -1;
  const focusPage = focusIndex < 0 ? 0 : Math.floor(focusIndex / PAGE_ROWS) + 1;

  useEffect(() => {
    if (!focusId) return;
    const target = document.getElementById(`opening-${focusId}`);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    /*
     * The ringed opening is in the set but not on this page — new since the grid
     * was paginated, and the one case where a link has to move the view rather
     * than point at it. Jump once: `jumpedFor` keeps the pager usable afterwards,
     * so a reader who clicks "Older" is not pulled back onto the linked row.
     */
    if (jumpedFor.current === focusId || !focusPage || focusPage === shownPage) return;
    jumpedFor.current = focusId;
    writeView({ page: focusPage });
    // `writeView` is a plain closure over this render's address bar, and the jump
    // is guarded by `jumpedFor`, so it runs once per link — naming it as a
    // dependency would re-run the effect on every render and re-scroll the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusPage, shownPage]);

  if (jobs.length === 0) {
    return (
      <Card className="p-10 text-center">
        <BriefcaseBusiness className="mx-auto mb-3 h-8 w-8 text-brand-gold" aria-hidden />
        <p className="font-display font-bold">No openings yet</p>
        <p className="mt-1 text-sm text-brand-ink/55">
          Create a role to start receiving applications.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-brand-line bg-white px-5 py-3.5 shadow-soft">
        <span className="text-sm text-brand-ink/60">
          <strong className="font-display text-lg text-brand-ink">
            {scopeTotal.toLocaleString()}
          </strong>{" "}
          openings
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-brand-ink/60">
          <Users className="h-4 w-4 text-brand-gold-dark" aria-hidden />
          <strong className="font-display text-base text-brand-ink">{totalApplicants}</strong>{" "}
          {windowNote ? "applicants in the rows here" : "applicants in total"}
        </span>
        {STATUSES.map((s) =>
          (statusCounts.get(s) ?? 0) > 0 ? (
            <span key={s} className="text-xs text-brand-ink/45">
              {statusCounts.get(s)} {s.toLowerCase()}
            </span>
          ) : null
        )}
      </div>

      {/* The strip's own asterisk: the total above is the database's, the chips
          under it are the newest rows this browser holds, and when those are two
          different sets the grid has to say so rather than let the reader find
          out by searching for a role that is not on the page. */}
      {windowNote && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">{windowNote}</p>
      )}

      {/* When the target column is simply not there yet, every card would say "no
          target set" — and that is a fact about the database, not the openings.
          The grid says so once here so the per-card copy is not read as "nobody
          set a headcount". */}
      {headcountUnavailable && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">{demandUnavailableNote()}</p>
      )}

      {/* The same rule for seniority: while 033 is unapplied there is no column to
          hold a level, so no card can say "not recorded" about a value nobody could
          have set. The grid says why once here. */}
      {termsNote && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">{termsNote}</p>
      )}

      {/* Toolbar */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // A deep page belongs to the words that produced it. New words
                // are a new front of the list, so the page goes back in the URL
                // with them — once, on the keystroke that leaves a page behind.
                if (shownPage > 1) writeView({ query: e.target.value });
              }}
              placeholder={`Search ${openingSearchWords()}`}
              aria-label="Search openings"
              className="w-full rounded-xl border border-brand-line bg-white py-2.5 pl-10 pr-3 text-sm focus:border-brand-gold focus:outline-none"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort openings"
            className="rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="applicants">Most applicants</option>
            <option value="title">Title A–Z</option>
          </select>
          <span className="text-xs text-brand-ink/50" title={`Of ${jobs.length} in this browser`}>
            {visible.length} of {jobs.length}
          </span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <FilterRail label="All" count={jobs.length} active={status === ""} onClick={() => openRail({ status: "" })} />
          {STATUSES.map((s) => (
            <FilterRail
              key={s}
              label={s.charAt(0) + s.slice(1).toLowerCase()}
              count={statusCounts.get(s) ?? 0}
              active={status === s}
              onClick={() => openRail({ status: status === s ? "" : s })}
            />
          ))}
          {/* A role nobody may be filed under is not a vacancy, so the set that
              is still live gets its own chip — and the assistant's `HIREABLE`
              answer, which counts exactly this, has a rail to land on. */}
          <FilterRail
            label="Still hiring"
            count={hireableCount}
            active={status === "HIREABLE"}
            onClick={() => openRail({ status: status === "HIREABLE" ? "" : "HIREABLE" })}
          />
        </div>

        {companyCounts.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
              Company
            </span>
            {companyCounts.map(([id, count]) => (
              <FilterRail
                key={id}
                label={companyNames(id)}
                count={count}
                tone="muted"
                active={company === id}
                onClick={() => openRail({ company: company === id ? "" : id })}
              />
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="No openings match"
            description="Clear a filter or widen the search to see the roles again."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {pageRows.map((job) => {
            const applicants = applicantsOf(job);
            const demand = demandOf(job);
            const closes = job.status === "PUBLISHED" ? closingLabel(job.closing_at) : null;
            const salary = formatSalaryRange(
              {
                min: job.min_salary_usd,
                max: job.max_salary_usd,
                // Pre-dating the currency column every row was USD.
                currency: job.salary_currency || "USD",
              },
              options.currencies
            );
            return (
              <Card
                key={job.id}
                id={`opening-${job.id}`}
                className={cn(
                  "flex flex-col gap-4 p-5 sm:p-6",
                  job.id === focusId && "ring-2 ring-brand-gold"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                      {companyNames(job.tenant_id)}
                    </p>
                    <h2 className="mt-0.5 font-display text-lg font-bold leading-snug">
                      {job.title}
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-ink/55">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        {job.location}
                      </span>
                      {closes && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-semibold",
                            closes.startsWith("Closed") ? "text-rose-700" : "text-brand-gold-dark"
                          )}
                        >
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                          {closes}
                        </span>
                      )}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-brand-ink/55">
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">{job.department}</span>
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">
                    {EMPLOYMENT_LABELS[job.employment_type] ??
                      job.employment_type.replace(/_/g, " ")}
                  </span>
                  {/* A level nobody recorded gets no chip: a "not recorded" pill on
                      every pre-033 opening would be noise, not a fact. */}
                  {job.experience_level && (
                    <span className="rounded-full bg-brand-sand px-2.5 py-1">
                      {experienceLabel(job.experience_level)}
                    </span>
                  )}
                  <span className="rounded-full bg-brand-sand px-2.5 py-1">
                    {job.sector.replace(/_/g, " ")}
                  </span>
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => setApplicantsJob(job)}
                      title="Everyone who applied to this role, and what they submitted"
                      className="group inline-flex items-baseline gap-1.5 text-brand-ink/60 transition hover:text-brand-ink"
                    >
                      <Users className="h-3.5 w-3.5 self-center text-brand-gold-dark" aria-hidden />
                      <strong className="font-display text-base text-brand-ink underline-offset-4 group-hover:underline">
                        {applicants}
                      </strong>
                      applicant{applicants === 1 ? "" : "s"}
                    </button>
                    {salary && (
                      <span className="font-mono text-xs text-brand-ink/50">{salary}</span>
                    )}
                  </div>
                  <Meter
                    value={applicants}
                    max={maxApplicants}
                    tone={applicants > 0 ? "gold" : "ink"}
                  />
                  {/* The demand read: the target beside the two populations that sit
                      in the funnel now. `hiringDemand` says they are counts at this
                      instant, never a rate or a movement. */}
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-brand-ink/50">
                    {demandLine(demand)}
                  </p>
                </div>

                {canManage && (
                  <JobCardActions job={job} options={options} applicants={applicants} />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* The pager sits outside that choice on purpose: an empty set has no page
          to turn, and `Pagination` answers a one-page scope by drawing nothing —
          so the same line serves the grid and stays out of the way of the empty
          state above it. */}
      <Pagination
        window={pager}
        noun="openings"
        onChange={(next) => writeView({ page: next })}
      />

      {applicantsJob && (
        <JobApplicantsDrawer
          key={applicantsJob.id}
          job={applicantsJob}
          canDecide={canDecide}
          // The catalogue the match lines are named from — the same vocabulary the
          // editor's picker uses, so a skill reads the same in both drawers.
          skillLabels={options.skillLabels}
          onClose={() => setApplicantsJob(null)}
        />
      )}
    </div>
  );
}
