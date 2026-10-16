import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, MapPin } from "lucide-react";
import { getPublicJob, getPublicJobs } from "../actions";
import { formatSalaryRange } from "@/lib/currency";
import { ApplyForm } from "../ApplyForm";
import { Badge } from "@/modules/analytics/presentation/ui";

/**
 * Public job detail and application form.
 *
 * Draft and closed roles are invisible: `getPublicJob` filters on
 * `status = 'PUBLISHED'` and returns null, which renders a 404 rather than
 * revealing that the role exists.
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

export async function generateMetadata({
  params,
}: PageProps<"/careers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const job = await getPublicJob(id);
  if (!job) return { title: "Role not found" };
  return {
    title: job.title,
    description: `${job.title} at ${job.company_name ?? "Sharm Dreams Group"} — ${job.location}.`,
  };
}

/**
 * Which role is on screen comes from the URL, and a role published after the
 * build is only known on request — so navigating into this page is not instant,
 * exactly like every other dynamic route here.
 */
export const instant = false;

export async function generateStaticParams() {
  // Prerenders every published role at build time. A role published later is
  // picked up on the first request via dynamicParams.
  const jobs = await getPublicJobs();
  
  // During build without valid Supabase credentials, return a dummy job
  // to satisfy Next.js static param validation. The real job data will
  // be fetched at request time via dynamicParams.
  if (jobs.length === 0) {
    return [{ id: "build-time-placeholder" }];
  }
  
  return jobs.map((job) => ({ id: job.id }));
}

export default async function CareerDetailPage({ params }: PageProps<"/careers/[id]">) {
  const { id } = await params;
  const job = await getPublicJob(id);

  if (!job) notFound();

  const salary = formatSalaryRange({
    min: job.min_salary_usd,
    max: job.max_salary_usd,
    currency: job.salary_currency,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/careers"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink/55 transition hover:text-brand-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All open roles
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-start">
        {/* ------------------------------------------------------ the role */}
        <div className="min-w-0">
          {job.company_name && (
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
              {job.company_name}
            </p>
          )}

          <h1 className="mt-1 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {job.title}
          </h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-brand-ink/60">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {job.location}
            </span>
            {EMPLOYMENT_LABELS[job.employment_type] && (
              <span>{EMPLOYMENT_LABELS[job.employment_type]}</span>
            )}
            {salary && <span className="font-mono">{salary}</span>}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {job.department && (
              <Badge tone="gold">{job.department}</Badge>
            )}
            {SECTOR_LABELS[job.sector] && (
              <Badge tone="neutral">{SECTOR_LABELS[job.sector]}</Badge>
            )}
          </div>

          <section className="mt-8">
            <h2 className="font-display text-lg font-bold">About this role</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-brand-ink/70">
              {job.description}
            </p>
          </section>

          {job.requirements.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold">What we are looking for</h2>
              <ul className="mt-3 space-y-2">
                {job.requirements.map((requirement, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm leading-relaxed text-brand-ink/70">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark"
                      aria-hidden
                    />
                    {requirement}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-display text-lg font-bold">How hiring works here</h2>
            <ol className="mt-3 space-y-3">
              {[
                "Apply with your CV. You get a tracking code immediately.",
                "Our AI screening reads your CV against the role's requirements.",
                "If there is a fit, we open an assessment and you start it from the portal with your code.",
                "Your recruiter books the interview and confirms the time and joining link with you.",
              ].map((step, index) => (
                <li key={index} className="flex items-start gap-3 text-sm leading-relaxed text-brand-ink/70">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold/15 text-[11px] font-bold text-brand-gold-dark">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* ---------------------------------------------------- the form */}
        <div className="lg:sticky lg:top-24">
          <ApplyForm jobId={job.id} jobTitle={job.title} />
        </div>
      </div>
    </div>
  );
}