"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { Badge, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { humanizeStage } from "@/modules/settings/domain/templates";
import { formatDateTime, sourceLabel } from "@/lib/utils";
import {
  getApplicantSubmission,
  getJobApplicants,
  type ApplicantSubmission,
  type JobApplicant,
} from "./applicant-actions";

function stageTone(stage: string) {
  if (stage === "HIRED") return "success" as const;
  if (stage === "REJECTED") return "danger" as const;
  if (stage === "OFFER" || stage === "INTERVIEW") return "gold" as const;
  return "info" as const;
}

function attemptTone(status: string) {
  if (status === "GRADED") return "success" as const;
  if (status === "EXPIRED") return "danger" as const;
  if (status === "SUBMITTED") return "info" as const;
  if (status === "IN_PROGRESS") return "gold" as const;
  return "neutral" as const;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-brand-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One applicant's own submission: the details they typed into the application
 * form, the CV they attached (original file plus the text we read out of it),
 * the AI screening verdict and their assessment attempt.
 *
 * The heavy fields arrive on demand — `getApplicantSubmission` is called the
 * first time a row is opened and its result is kept for the rest of the visit.
 */
function ApplicantDetail({
  applicant,
  submission,
  error,
}: {
  applicant: JobApplicant;
  submission: ApplicantSubmission | null;
  error: string | null;
}) {
  if (error) return <FormMessage error={error} />;
  if (!submission) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-brand-ink/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading this submission…
      </p>
    );
  }

  return (
    <div className="space-y-5 border-t border-brand-line bg-brand-cream/60 px-4 py-4">
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          What they entered
        </h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
          <Detail label="Full name" value={applicant.full_name} />
          <Detail label="Email" value={applicant.email} />
          <Detail label="Phone" value={applicant.phone ?? "Not given"} />
          <Detail
            label="Where they found it"
            value={sourceLabel(applicant.source)}
          />
          <Detail label="Tracking code" value={applicant.tracking_code} />
          <Detail label="Applied on" value={formatDateTime(applicant.applied_at)} />
        </dl>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            {applicant.cv_name ? "Attached CV" : "CV text"}
          </h4>
          {submission.cv_url && (
            <div className="flex items-center gap-2">
              <a
                href={submission.cv_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open CV
              </a>
              {submission.cv_download_url && (
                <a
                  href={submission.cv_download_url}
                  download={applicant.cv_name ?? undefined}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download
                </a>
              )}
            </div>
          )}
        </div>

        {applicant.cv_name && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-ink/55">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate" title={applicant.cv_name}>
              {applicant.cv_name}
            </span>
          </p>
        )}

        {submission.cv_text ? (
          <pre className="rail-scroll mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-brand-line bg-white p-3 font-mono text-[11px] leading-relaxed text-brand-ink/75">
            {submission.cv_text}
          </pre>
        ) : applicant.cv_name ? (
          <p className="mt-2 text-xs text-brand-ink/50">
            No text could be read from this file — open it to read the CV as submitted.
          </p>
        ) : (
          <p className="mt-2 text-xs text-brand-ink/50">No CV was attached to this application.</p>
        )}
      </section>

      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          AI screening
        </h4>
        {applicant.scores_masked ? (
          <p className="mt-2 text-xs text-brand-ink/50">
            Hidden — your role is not granted &ldquo;View unmasked scores&rdquo;.
          </p>
        ) : applicant.ai_match_score !== null ? (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-10 font-display text-sm font-bold text-brand-gold-dark">
              {applicant.ai_match_score}%
            </span>
            <Meter value={applicant.ai_match_score} className="flex-1" />
          </div>
        ) : (
          <p className="mt-2 text-xs text-brand-ink/50">Not screened yet.</p>
        )}
        {submission.screening_summary && (
          <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
            {submission.screening_summary}
          </p>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            Assessment
          </h4>
          {applicant.attempt_token ? (
            <>
              <Badge tone={attemptTone(applicant.attempt_status ?? "NOT_STARTED")}>
                {humanizeStage(applicant.attempt_status ?? "NOT_STARTED")}
              </Badge>
              <span className="text-xs text-brand-ink/55">
                {applicant.template_name ?? "Assessment"}
                {applicant.attempt_score !== null
                  ? ` · ${applicant.attempt_score}/${applicant.attempt_max ?? "?"}`
                  : ""}
              </span>
            </>
          ) : (
            <span className="text-xs text-brand-ink/50">No assessment assigned.</span>
          )}
        </div>

        <Link
          href={`/candidates?c=${encodeURIComponent(applicant.tracking_code)}`}
          className="text-xs font-semibold text-brand-gold-dark underline underline-offset-4"
        >
          Full profile in Candidates
        </Link>
      </section>
    </div>
  );
}

/**
 * Every applicant for one opening, with their submission.
 *
 * Mounted from a job card so a recruiter reads a role's shortlist without
 * filtering the all-group candidate table by hand.
 */
export function JobApplicantsDrawer({
  job,
  onClose,
}: {
  job: { id: string; title: string; status: string };
  onClose: () => void;
}) {
  const [applicants, setApplicants] = useState<JobApplicant[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, ApplicantSubmission | null>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  // Load on open. The shortlist belongs to the opening that was clicked, so a
  // new drawer instance always fetches its own rather than reusing a stale list.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getJobApplicants(job.id);
      if (!active) return;
      setListError(result.ok ? null : result.error);
      setApplicants(result.ok ? result.applicants : []);
    })();
    return () => {
      active = false;
    };
  }, [job.id]);

  async function toggle(applicant: JobApplicant) {
    if (openId === applicant.id) {
      setOpenId(null);
      return;
    }
    setOpenId(applicant.id);
    if (submissions[applicant.id] !== undefined) return;

    setSubmissions((current) => ({ ...current, [applicant.id]: null }));
    const result = await getApplicantSubmission(applicant.id);
    if (result.ok) {
      setSubmissions((current) => ({ ...current, [applicant.id]: result.submission }));
    } else {
      setDetailErrors((current) => ({ ...current, [applicant.id]: result.error }));
      setSubmissions((current) => {
        const retry = { ...current };
        // Dropping the key lets a re-click retry instead of caching the failure.
        delete retry[applicant.id];
        return retry;
      });
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={humanizeStage(job.status)}
      title={job.title}
      subtitle="Everyone who applied to this role, and what they submitted"
      width="max-w-2xl"
      footer={
        <>
          <p className="text-xs text-brand-ink/55">
            {applicants ? `${applicants.length} applicant${applicants.length === 1 ? "" : "s"}` : "Loading…"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-semibold transition hover:bg-brand-sand"
          >
            Close
          </button>
        </>
      }
    >
      <FormMessage error={listError} />

      {!applicants && !listError && (
        <p className="flex items-center gap-2 py-6 text-sm text-brand-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading applicants…
        </p>
      )}

      {applicants && applicants.length === 0 && !listError && (
        <EmptyState
          icon={<FileText className="h-6 w-6" aria-hidden />}
          title="No applications yet"
          description="Nobody has applied to this opening. Published roles accept applications through the careers site."
        />
      )}

      {applicants && applicants.length > 0 && (
        <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
          {applicants.map((applicant) => {
            const expanded = openId === applicant.id;
            return (
              <li key={applicant.id}>
                <button
                  type="button"
                  onClick={() => void toggle(applicant)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-brand-cream"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold">
                      {applicant.full_name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-brand-ink/55">
                      {applicant.email} · applied {formatDateTime(applicant.applied_at)}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {applicant.attempt_token && (
                      <Badge tone={attemptTone(applicant.attempt_status ?? "NOT_STARTED")}>
                        {humanizeStage(applicant.attempt_status ?? "NOT_STARTED")}
                      </Badge>
                    )}
                    <Badge tone={stageTone(applicant.stage)}>{humanizeStage(applicant.stage)}</Badge>
                  </span>
                </button>

                {expanded && (
                  <ApplicantDetail
                    applicant={applicant}
                    submission={submissions[applicant.id] ?? null}
                    error={detailErrors[applicant.id] ?? null}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
