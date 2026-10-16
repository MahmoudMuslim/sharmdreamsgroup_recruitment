"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, CalendarClock, MapPin, Search, Users } from "lucide-react";
import { Badge, Card, EmptyState, FilterRail, Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import { formatSalaryRange } from "@/lib/currency";
import { openingSearchWords, searchOpenings } from "@/modules/jobs/domain/openingSearch";
import { isHireable } from "@/modules/jobs/domain/hireable";
import { JobCardActions } from "./JobCardActions";
import { JobApplicantsDrawer } from "./JobApplicantsDrawer";
import type { JobForEdit, JobFormOptions } from "./JobFormDrawer";

export interface JobRow extends JobForEdit {
  requirements: string[] | null;
  posted_at: string | null;
  closing_at: string | null;
  applications: { count: number }[];
}

const STATUSES = ["PUBLISHED", "DRAFT", "PAUSED", "CLOSED"] as const;

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "danger"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  PAUSED: "gold",
  CLOSED: "danger",
};

function applicantsOf(job: JobRow) {
  return job.applications?.[0]?.count ?? 0;
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
  options,
  canManage,
  canDecide,
}: {
  jobs: JobRow[];
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

  // `?q=` seeds the box, so an assistant answer that searched for a role links to
  // a grid showing the same openings. The words stay local while they are typed:
  // the box is written into the URL by the next rail click, not per keystroke.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sortBy, setSortBy] = useState<"newest" | "applicants" | "title">("newest");
  const [applicantsJob, setApplicantsJob] = useState<JobRow | null>(null);

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
   * Move a rail and put the view into the URL.
   *
   * `history.replaceState` is enough here and is chosen over a router push on
   * purpose: this Next build patches those calls into the router, so
   * `useSearchParams` re-renders with the new query while the openings the
   * client already holds do the filtering — a rail on this grid is a view of
   * rows already loaded, not a fresh question to the database. A rail click
   * replaces the history entry, so Back leaves the page instead of replaying
   * chips, and it carries the search words along because both filters are the
   * grid's own. `?job=` goes, and with it the applicants drawer: a rail is a
   * question about the set, not about one opening, and the ring or the open
   * drawer may be pointing at a row the new rail no longer shows.
   */
  function openRail(rail: { status?: string; company?: string }) {
    setApplicantsJob(null);
    const next = new URLSearchParams();
    const statusToken = "status" in rail ? (rail.status ?? "") : status;
    const companyToken = "company" in rail ? (rail.company ?? "") : company;
    if (statusToken) next.set("status", statusToken);
    if (companyToken) next.set("company", companyToken);
    if (query.trim()) next.set("q", query);
    const search = next.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  }

  // `?job=` is where the assistant's "View the opening" link lands. The opening
  // is ringed and brought into view rather than filtered to, so the recruiter
  // still sees where it sits among the rest.
  const focusId = params.get("job");

  useEffect(() => {
    if (!focusId) return;
    document
      .getElementById(`opening-${focusId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId]);

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
  const visible = useMemo(() => {
    const rows = searchOpenings(
      jobs
        .filter((job) => onRail(job, status) && (!company || job.tenant_id === company))
        .map((job) => ({ ...job, company_name: companyNames(job.tenant_id) })),
      query
    );
    if (sortBy === "applicants") rows.sort((a, b) => applicantsOf(b) - applicantsOf(a));
    else if (sortBy === "title") rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows;
  }, [jobs, status, company, query, sortBy, companyNames]);

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
          <strong className="font-display text-lg text-brand-ink">{jobs.length}</strong> openings
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-brand-ink/60">
          <Users className="h-4 w-4 text-brand-gold-dark" aria-hidden />
          <strong className="font-display text-base text-brand-ink">{totalApplicants}</strong>{" "}
          applicants in total
        </span>
        {STATUSES.map((s) =>
          (statusCounts.get(s) ?? 0) > 0 ? (
            <span key={s} className="text-xs text-brand-ink/45">
              {statusCounts.get(s)} {s.toLowerCase()}
            </span>
          ) : null
        )}
      </div>

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
              onChange={(e) => setQuery(e.target.value)}
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
          <span className="text-xs text-brand-ink/50">
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
          {visible.map((job) => {
            const applicants = applicantsOf(job);
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
                    {job.employment_type.replace(/_/g, " ")}
                  </span>
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
                </div>

                {canManage && (
                  <JobCardActions job={job} options={options} applicants={applicants} />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {applicantsJob && (
        <JobApplicantsDrawer
          key={applicantsJob.id}
          job={applicantsJob}
          canDecide={canDecide}
          onClose={() => setApplicantsJob(null)}
        />
      )}
    </div>
  );
}
