"use client";

import { useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarClock, MapPin, Search, Users } from "lucide-react";
import { Badge, Card, EmptyState, FilterRail, Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import { formatSalaryRange } from "@/lib/currency";
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
 * anything.
 */
export function JobsBrowser({
  jobs,
  options,
  canManage,
}: {
  jobs: JobRow[];
  options: JobFormOptions;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<string>("");
  const [company, setCompany] = useState<string>("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "applicants" | "title">("newest");
  const [applicantsJob, setApplicantsJob] = useState<JobRow | null>(null);

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = jobs.filter(
      (job) =>
        (!status || job.status === status) &&
        (!company || job.tenant_id === company) &&
        (!q ||
          job.title.toLowerCase().includes(q) ||
          job.department.toLowerCase().includes(q) ||
          job.location.toLowerCase().includes(q) ||
          companyNames(job.tenant_id).toLowerCase().includes(q))
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
              placeholder="Search title, department, location or company"
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
          <FilterRail
            label="All"
            count={jobs.length}
            active={status === ""}
            onClick={() => setStatus("")}
          />
          {STATUSES.map((s) => (
            <FilterRail
              key={s}
              label={s.charAt(0) + s.slice(1).toLowerCase()}
              count={statusCounts.get(s) ?? 0}
              active={status === s}
              onClick={() => setStatus(status === s ? "" : s)}
            />
          ))}
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
                onClick={() => setCompany(company === id ? "" : id)}
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
              <Card key={job.id} className="flex flex-col gap-4 p-5 sm:p-6">
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
          onClose={() => setApplicantsJob(null)}
        />
      )}
    </div>
  );
}
