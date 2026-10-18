import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, CheckCircle2, MapPin } from "lucide-react";
import { getPublicCompanies, getPublicJob, getPublicJobs } from "../actions";
import { employmentLabel, sectorLabel } from "@/modules/careers/job-board";
import {
  companyAtAGlance,
  companyOfJob,
  splitParagraphs,
  type PublicCompany,
} from "@/modules/careers/company-profile";
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

/**
 * Who would be hiring, in the words they filed for themselves.
 *
 * Printed under the role rather than above it because an applicant reads the job
 * first and then asks who it is with — and because a company whose profile was
 * never written contributes nothing here, which is the honest outcome: the panel
 * is not rendered, and no sentence is invented to fill its place.
 */
function CompanyPanel({ company }: { company: PublicCompany }) {
  const atAGlance = companyAtAGlance(company);
  const paragraphs = splitParagraphs(company.history);
  const opening = splitParagraphs(company.description);

  if (!company.tagline && !company.careers_pitch && opening.length === 0 && !atAGlance.length)
    return null;

  return (
    <section className="mt-10 rounded-2xl border border-brand-line bg-brand-cream p-6 sm:p-7">
      <h2 className="font-display text-lg font-bold">About {company.name}</h2>
      {company.legal_name && company.legal_name !== company.name && (
        <p className="mt-1 text-xs text-brand-ink/45">{company.legal_name}</p>
      )}

      {company.tagline && (
        <p className="mt-3 text-sm font-semibold text-brand-gold-dark">{company.tagline}</p>
      )}

      {atAGlance.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
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

      {(company.careers_pitch ?? null) && (
        <p className="mt-4 text-sm leading-relaxed text-brand-ink/70">{company.careers_pitch}</p>
      )}

      {opening.map((paragraph, index) => (
        <p
          key={`opening-${index}`}
          className="mt-3 whitespace-pre-line text-sm leading-relaxed text-brand-ink/65"
        >
          {paragraph}
        </p>
      ))}

      {paragraphs.length > 0 && (
        <div className="mt-5 border-t border-brand-line pt-5">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
            Their story
          </h3>
          {paragraphs.map((paragraph, index) => (
            <p
              key={`history-${index}`}
              className="mt-3 whitespace-pre-line text-sm leading-relaxed text-brand-ink/65"
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {company.milestones.length > 0 && (
        <ul className="mt-5 space-y-2 border-l border-brand-line pl-4">
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

      {company.website && (
        <a
          href={company.website}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark"
        >
          {company.name} online
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </section>
  );
}

export default async function CareerDetailPage({ params }: PageProps<"/careers/[id]">) {
  const { id } = await params;
  const [job, jobs, companies] = await Promise.all([
    getPublicJob(id),
    getPublicJobs(),
    getPublicCompanies(),
  ]);

  if (!job) notFound();

  const company = companyOfJob(job, companies);
  // Openings from the same company row, so the applicant who is not right for this
  // one is sent somewhere real rather than back to the whole board.
  const siblings = job.company_id
    ? jobs.filter((each) => each.company_id === job.company_id && each.id !== job.id)
    : [];

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
            {job.employment_type && <span>{employmentLabel(job.employment_type)}</span>}
            {salary && <span className="font-mono">{salary}</span>}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {job.department && (
              <Badge tone="gold">{job.department}</Badge>
            )}
            {job.sector && <Badge tone="neutral">{sectorLabel(job.sector)}</Badge>}
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

          {company && <CompanyPanel company={company} />}

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

          {siblings.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold">
                Other roles at {company?.name ?? "us"}
              </h2>
              <ul className="mt-3 divide-y divide-brand-line rounded-2xl border border-brand-line bg-white">
                {siblings.map((each) => (
                  <li key={each.id}>
                    <Link
                      href={`/careers/${each.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-brand-cream"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{each.title}</span>
                        <span className="block text-xs text-brand-ink/50">
                          {each.location} · {employmentLabel(each.employment_type)}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ---------------------------------------------------- the form */}
        <div className="lg:sticky lg:top-24">
          <ApplyForm jobId={job.id} jobTitle={job.title} />
        </div>
      </div>
    </div>
  );
}