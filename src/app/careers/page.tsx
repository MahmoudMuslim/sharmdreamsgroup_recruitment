import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, MapPin } from "lucide-react";
import { getPublicJobs } from "./actions";
import { formatSalaryRange } from "@/lib/currency";
import { Card } from "@/modules/analytics/presentation/ui";

export const metadata = {
  title: "Open roles",
  description:
    "Current openings across the Sharm Dreams Group — hospitality, real estate, development and corporate services.",
};

/**
 * Public job board.
 *
 * The data is public by policy (`jobs_public_read` only exposes PUBLISHED rows),
 * so this page needs no session and no `await connection()` — it is fully
 * cacheable and every visitor sees the same list.
 */

const SECTOR_LABELS: Record<string, string> = {
  HOSPITALITY: "Hospitality",
  REAL_ESTATE: "Real estate",
  DEVELOPMENT: "Development",
  CORPORATE: "Corporate services",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
};

export default async function CareersPage() {
  const jobs = await getPublicJobs();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-4 py-1.5 text-xs font-semibold text-brand-gold-dark shadow-soft">
          <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden />
          We are hiring
        </span>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Open roles across the group
        </h1>
        <p className="mt-4 text-base leading-relaxed text-brand-ink/65">
          Sharm Dreams Group spans hospitality, real estate and development in Sharm El Sheikh,
          Hurghada and Cairo. Pick a role, apply online, and track your progress with the
          tracking code you receive.
        </p>
      </header>

      {jobs.length === 0 ? (
        <Card className="mt-12 p-12 text-center">
          <BriefcaseBusiness className="mx-auto mb-3 h-8 w-8 text-brand-gold" aria-hidden />
          <p className="font-display text-lg font-bold">No open roles right now</p>
          <p className="mt-1 text-sm text-brand-ink/55">
            Please check back soon — new openings are posted here as soon as they are approved.
          </p>
        </Card>
      ) : (
        <ul className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {jobs.map((job) => {
            const salary = formatSalaryRange({
              min: job.min_salary_usd,
              max: job.max_salary_usd,
              currency: job.salary_currency,
            });

            return (
              <li key={job.id}>
                <Link
                  href={`/careers/${job.id}`}
                  className="group flex h-full flex-col rounded-2xl border border-brand-line bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:shadow-lift"
                >
                  {job.company_name && (
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
                      {job.company_name}
                    </p>
                  )}

                  <h2 className="mt-1 font-display text-xl font-bold leading-snug">
                    {job.title}
                  </h2>

                  <p className="mt-2 flex items-center gap-1.5 text-sm text-brand-ink/55">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {job.location}
                  </p>

                  <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-brand-ink/65">
                    {job.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-brand-ink/55">
                    {job.department && (
                      <span className="rounded-full bg-brand-sand px-2.5 py-1">
                        {job.department}
                      </span>
                    )}
                    {SECTOR_LABELS[job.sector] && (
                      <span className="rounded-full bg-brand-sand px-2.5 py-1">
                        {SECTOR_LABELS[job.sector]}
                      </span>
                    )}
                    {EMPLOYMENT_LABELS[job.employment_type] && (
                      <span className="rounded-full bg-brand-sand px-2.5 py-1">
                        {EMPLOYMENT_LABELS[job.employment_type]}
                      </span>
                    )}
                  </div>

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
              </li>
            );
          })}
        </ul>
      )}

      <aside className="mt-14 rounded-2xl border border-brand-line bg-brand-cream p-6">
        <h2 className="font-display text-base font-bold">Already applied?</h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-ink/60">
          Enter the tracking code you received when you applied to see your current stage,
          upcoming interviews and next steps.
        </p>
        <Link
          href="/portal"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
        >
          Track my application
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </aside>
    </div>
  );
}