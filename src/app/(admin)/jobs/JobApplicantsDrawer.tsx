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
  Sparkles,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { Badge, Button, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { FormMessage, TextArea } from "@/modules/analytics/presentation/Form";
import { humanizeStage } from "@/modules/settings/domain/templates";
import { PIPELINE_STAGES as STAGES } from "@/modules/candidates/domain/listFilters";
import {
  draftRejectionReason,
  updateApplicationStage,
  type PipelineStage,
} from "@/app/(admin)/candidates/candidate-actions";
import { formatDateTime, sourceLabel, cn } from "@/lib/utils";
import {
  matchRequiredSkills,
  skillMatchSentence,
  type CatalogueSkill,
  type RequiredSkill,
  type SkillMatchLine,
} from "@/modules/jobs/domain/openingSkills";
import {
  skillEvidenceSentence,
  type SkillEvidenceLine,
} from "@/modules/assessment/domain/skillEvidence";
import { shortlistReason } from "@/modules/jobs/domain/shortlist";
import {
  DEFAULT_APPLICANT_ORDER,
  type ApplicantOrder,
} from "@/modules/jobs/domain/applicantOrder";
import {
  getApplicantSubmission,
  getJobApplicants,
  type ApplicantSubmission,
  type JobApplicant,
} from "./applicant-actions";
import { getJobShortlist, type JobShortlist } from "./shortlist-actions";

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
 * One required skill beside what this record shows of it.
 *
 * A skill nobody recorded says "no evidence", never a level and never a missing
 * skill: `candidate_skills` is only filled when screening reads a level out of the
 * CV, so an absent row is a fact about the record, not about the person.
 */
function matchLine(line: SkillMatchLine): string {
  const shown = line.evidence === "no_evidence" ? "no evidence" : `shown ${line.demonstrated_level}`;
  return `${line.name} · required ${line.required_level} · ${shown}`;
}

/** The same ask with the candidate's level left off — what a masked reviewer is granted. */
function askLine(line: SkillMatchLine): string {
  return `${line.name} · required ${line.required_level}`;
}

/**
 * The requisition's skill list, printed against one applicant.
 *
 * Quiet when the opening requires nothing: an empty list is not a candidate who
 * fails on every skill, and a drawer that said "0 of 0" would be inventing a
 * verdict out of an unset field.
 */
function RequiredSkillLines({
  lines,
  masked,
  compact,
}: {
  lines: readonly SkillMatchLine[];
  masked: boolean;
  /** The collapsed row, which is inside a `<button>` and so takes spans, not blocks. */
  compact: boolean;
}) {
  if (lines.length === 0) return null;

  const say = masked
    ? `${skillAskHeadline(lines.length)} — the levels applicants demonstrated are not granted to your role.`
    : skillMatchSentence(lines);
  const item = (line: SkillMatchLine) => (masked ? askLine(line) : matchLine(line));
  const size = compact ? "text-[11px]" : "text-xs";

  if (compact) {
    return (
      <span className="mt-1 block space-y-0.5">
        <span className={`block truncate font-semibold text-brand-ink/60 ${size}`}>{say}</span>
        {lines.map((line) => (
          <span key={line.skill_id} className={`block truncate text-brand-ink/55 ${size}`}>
            {item(line)}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className={`font-semibold text-brand-ink/60 ${size}`}>{say}</p>
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line.skill_id} className={`truncate text-brand-ink/55 ${size}`}>
            {item(line)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Counting sentence for the masked branch, which cannot report what is met. */
function skillAskHeadline(required: number): string {
  return `This opening lists ${required} required ${required === 1 ? "skill" : "skills"}`;
}

/**
 * The pipeline decision, taken from the opening's side.
 *
 * Deliberately the same writer the candidates table uses: one move means one
 * reason rule, one trail row and one notice to the candidate, so a recruiter
 * shortlisting here cannot leave the all-group table saying the person is still
 * new.
 */
function StageDecisions({
  applicant,
  onMoved,
}: {
  applicant: JobApplicant;
  onMoved: (applicationId: string, stage: PipelineStage) => void;
}) {
  const [pending, setPending] = useState<PipelineStage | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function moveTo(stage: PipelineStage) {
    if (stage === applicant.stage) return;
    if (stage === "REJECTED") {
      setError(null);
      setNotice(null);
      setRejectOpen(true);
      return;
    }
    setPending(stage);
    setError(null);
    setNotice(null);
    try {
      const result = await updateApplicationStage({ applicationId: applicant.id, stage });
      if (!result.ok) {
        setError(result.error ?? "The applicant was not moved.");
        return;
      }
      onMoved(applicant.id, stage);
      setNotice(`Moved to ${humanizeStage(stage)}. The candidate is told on the channels Settings allows.`);
    } catch {
      setError("The portal did not answer, so the stage is unchanged.");
    } finally {
      setPending(null);
    }
  }

  async function confirmReject() {
    setPending("REJECTED");
    setError(null);
    setNotice(null);
    try {
      const result = await updateApplicationStage({
        applicationId: applicant.id,
        stage: "REJECTED",
        reason,
      });
      if (!result.ok) {
        setError(result.error ?? "The applicant was not rejected.");
        return;
      }
      onMoved(applicant.id, "REJECTED");
      setRejectOpen(false);
      setReason("");
      setNotice(
        result.auto_feedback
          ? "Rejected. The candidate is told on the channels Settings allows, and a feedback draft is being written."
          : "Rejected. The candidate is told on the channels Settings allows. Feedback drafting is off in Settings, so no draft was written."
      );
    } catch {
      setError("The portal did not answer, so the applicant is unchanged.");
    } finally {
      setPending(null);
    }
  }

  /**
   * Fills the textarea from the applicant's own file.
   *
   * The same writer the candidates table uses, so a draft drafted from the
   * opening's side reads the same screening score and answers as the profile
   * drawer does, and neither one saves anything until Confirm is pressed.
   */
  async function draftReason() {
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await draftRejectionReason(applicant.id);
      if (result.ok && result.reason) {
        setReason(result.reason);
        setNotice("Drafted from this applicant’s file. Edit it before rejecting — nothing is saved yet.");
      } else {
        setError(result.error ?? "No reason could be drafted.");
      }
    } catch {
      setError("The portal did not answer, so no reason was drafted.");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
        Pipeline
      </h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STAGES.map((stage) => {
          const active = applicant.stage === stage;
          const isReject = stage === "REJECTED";
          const blocked = active || pending !== null;
          return (
            <button
              key={stage}
              type="button"
              disabled={blocked}
              aria-pressed={active}
              onClick={() => void moveTo(stage as PipelineStage)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition",
                active
                  ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                  : isReject
                    ? "border-brand-line bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                    : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand",
                blocked && !active && "cursor-not-allowed opacity-60"
              )}
            >
              {pending === stage && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              {stage.replace("_", " ")}
            </button>
          );
        })}
      </div>

      {rejectOpen && (
        <div className="mt-3 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
          <label htmlFor={`reject-${applicant.id}`} className="block text-xs font-bold text-rose-900">
            Rejection reason
          </label>
          <TextArea
            id={`reject-${applicant.id}`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this applicant not moving forward? It is shown on their profile."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending !== null} onClick={() => void confirmReject()}>
              {pending === "REJECTED" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={drafting || pending !== null}
              onClick={() => void draftReason()}
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              Draft from file
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejectOpen(false);
                setReason("");
              }}
            >
              Keep in the pipeline
            </Button>
          </div>
        </div>
      )}

      <FormMessage error={error} success={notice} />
    </section>
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
  canDecide,
  skillLines,
  onMoved,
}: {
  applicant: JobApplicant;
  submission: ApplicantSubmission | null;
  error: string | null;
  canDecide: boolean;
  /** The requisition's requirements beside this record, mapped once for the whole row. */
  skillLines: readonly SkillMatchLine[];
  onMoved: (applicationId: string, stage: PipelineStage) => void;
}) {
  // A decision never waits on the CV: the stage lives on the application row,
  // not in the heavy fields this fetch brings back.
  const decision = canDecide ? <StageDecisions applicant={applicant} onMoved={onMoved} /> : null;
  const wrap = "space-y-5 border-t border-brand-line bg-brand-cream/60 px-4 py-4";

  if (error) {
    return (
      <div className={wrap}>
        {decision}
        <FormMessage error={error} />
      </div>
    );
  }
  if (!submission) {
    return (
      <div className={wrap}>
        {decision}
        <p className="flex items-center gap-2 py-3 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading this submission…
        </p>
      </div>
    );
  }

  /**
   * The context the test line is read against.
   *
   * `getJobApplicants` returns `demonstrated` whole even when this reviewer's
   * scores are withheld, because a masked level is still a recorded level; the
   * grant is applied here, as `RequiredSkillLines` does. The requisition's
   * `required_level` is the ask, not a score, and stays visible either way.
   *
   * The mask is the OR of the two reads: the list row and this submission were
   * fetched separately, so a stale row must not out-vote a submission read that
   * says withheld. When either says so, neither a level nor a figure is printed.
   */
  const withheld = applicant.scores_masked || submission.skill_evidence_masked;
  const contextOf = (line: SkillEvidenceLine) => {
    const match = skillLines.find((row) => row.skill_id === line.skill_id) ?? null;
    return {
      required_level: match?.required_level ?? null,
      demonstrated_level: withheld ? null : (match?.demonstrated_level ?? null),
      figures_withheld: withheld,
    };
  };

  return (
    <div className={wrap}>
      {decision}

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

      {/* Named against the requisition, not against prose: `ai_gaps` used to be the
          only thing this drawer said about skills, and it was a sentence nobody
          could check. These lines are the opening's own rows beside the levels this
          record carries. */}
      {skillLines.length > 0 && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            Against the requisition’s skills
          </h4>
          <RequiredSkillLines lines={skillLines} masked={withheld} compact={false} />
        </section>
      )}

      {/* The test read is separate evidence from the CV read: it never moves the
          meets/below verdict above, and a skill with marks but no CV row is still
          "no evidence" about the CV. The note prints even with nothing to list, so
          a failed or capped read cannot look like an applicant who sat nothing. */}
      {(submission.skill_evidence.length > 0 || submission.skill_evidence_note) && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            From this applicant’s tests
          </h4>
          {submission.skill_evidence.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {submission.skill_evidence.map((line) => (
                <li
                  key={line.skill_id}
                  className="text-xs leading-relaxed text-brand-ink/75"
                >
                  {skillEvidenceSentence(line, contextOf(line))}
                </li>
              ))}
            </ul>
          )}
          {submission.skill_evidence_coverage && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/50">
              {submission.skill_evidence_coverage}
            </p>
          )}
          {submission.skill_evidence_note && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              {submission.skill_evidence_note}
            </p>
          )}
        </section>
      )}

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
        {withheld ? (
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
                {!withheld && applicant.attempt_score !== null
                  ? ` · ${applicant.attempt_score}/${applicant.attempt_max ?? "?"}`
                  : ""}
              </span>
            </>
          ) : (
            <span className="text-xs text-brand-ink/50">No assessment assigned.</span>
          )}
        </div>

        <Link
          href={`/candidates/${applicant.id}`}
          className="text-xs font-semibold text-brand-gold-dark underline underline-offset-4"
        >
          Their whole profile, on every opening
        </Link>
      </section>
    </div>
  );
}

/**
 * The two orders a recruiter can ask this list for — `applicantOrder.ts` defines
 * them and the address that asks for each.
 *
 * The order starts as the address names it, because a chat link can now open this
 * drawer already ranked (`/jobs?job=<id>&order=ranked`). Switching the chip here
 * stays local, like the grid's search box: the address seeds the view a link
 * promises, and typing over it is the recruiter's, not the link's.
 */

/**
 * Every applicant for one opening, with their submission and the stage decision.
 *
 * Mounted from a job card so a recruiter works a role's shortlist in order: read
 * the CV, move the person on or file them out, open the next name — without
 * filtering the all-group candidate table by hand between two applicants.
 */
export function JobApplicantsDrawer({
  job,
  canDecide,
  skillLabels,
  initialOrder = DEFAULT_APPLICANT_ORDER,
  onClose,
}: {
  job: { id: string; title: string; status: string; required_skills: RequiredSkill[] };
  /** `candidates.write` — the grant the stage writer re-checks on the server. */
  canDecide: boolean;
  /** The catalogue with its retired rows, so a required skill is named rather than shown as an id. */
  skillLabels: CatalogueSkill[];
  /** The order the address asked for — ranked when a chat link opened this drawer. */
  initialOrder?: ApplicantOrder;
  onClose: () => void;
}) {
  const [applicants, setApplicants] = useState<JobApplicant[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, ApplicantSubmission | null>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<ApplicantOrder>(initialOrder);
  const [shortlist, setShortlist] = useState<JobShortlist | null>(null);
  const [shortlistError, setShortlistError] = useState<string | null>(null);

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

  // Asked for the ranked order, and only then: the newest-first list is what a
  // recruiter opens the drawer to read, and the second read costs a request.
  useEffect(() => {
    if (order !== "ranked" || shortlist || shortlistError) return;
    let active = true;
    void (async () => {
      const result = await getJobShortlist(job.id);
      if (!active) return;
      if (result.ok) setShortlist(result.shortlist);
      else setShortlistError(result.error);
    })();
    return () => {
      active = false;
    };
  }, [order, job.id, shortlist, shortlistError]);

  /**
   * The list in the order the address bar asked for.
   *
   * The rows stay the drawer's own — email, attempt badge, stage — because the
   * ranking decides only who comes first. An applicant the shortlist does not name
   * keeps their place at the bottom rather than vanishing: a row the read returned
   * has to stay visible for the recruiter to act on it.
   */
  const rows = (() => {
    if (order !== "ranked" || !shortlist || !applicants) return applicants ?? [];
    const position = new Map(shortlist.lines.map((line, index) => [line.applicationId, index]));
    return [...applicants].sort((a, b) => {
      const left = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const right = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.full_name.localeCompare(b.full_name);
    });
  })();
  const lineFor = (applicant: JobApplicant) =>
    order === "ranked"
      ? (shortlist?.lines.find((line) => line.applicationId === applicant.id) ?? null)
      : null;

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

  /**
   * Reflects a saved decision in the list.
   *
   * The row is patched rather than the whole shortlist re-read: the writer already
   * returned the destination, and refetching would drop the submissions cached for
   * the applicants sitting above the one that moved.
   */
  function markMoved(applicationId: string, stage: PipelineStage) {
    setApplicants((current) =>
      (current ?? []).map((row) => (row.id === applicationId ? { ...row, stage } : row))
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={humanizeStage(job.status)}
      title={job.title}
      subtitle={
        canDecide
          ? "Everyone who applied to this role, and what they submitted — decide the next stage from here."
          : "Everyone who applied to this role, and what they submitted."
      }
      width="max-w-2xl"
      footer={
        <>
          <p className="text-xs text-brand-ink/55">
            {!applicants
              ? "Loading…"
              : canDecide
                ? `${applicants.length} applicant${applicants.length === 1 ? "" : "s"}`
                : `${applicants.length} applicant${applicants.length === 1 ? "" : "s"} · reading a move needs the Edit candidates permission`}
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
      <FormMessage error={shortlistError} />

      {applicants && applicants.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-brand-line bg-white p-0.5">
            {(["newest", "ranked"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setOrder(mode)}
                aria-pressed={order === mode}
                className={cn(
                  "rounded-[10px] px-3 py-1.5 text-xs font-semibold transition",
                  order === mode
                    ? "bg-brand-ink text-white"
                    : "text-brand-ink/60 hover:bg-brand-cream"
                )}
              >
                {mode === "newest" ? "Newest first" : "Ranked by fit"}
              </button>
            ))}
          </div>
          {order === "ranked" && !shortlist && !shortlistError && (
            <span className="flex items-center gap-1.5 text-xs text-brand-ink/55">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Ranking…
            </span>
          )}
        </div>
      )}

      {shortlist && (
        <div className="mb-3 space-y-1 rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5">
          <p className="text-xs font-semibold text-brand-ink/75">{shortlist.basis_note}</p>
          {shortlist.note && <p className="text-xs text-brand-ink/60">{shortlist.note}</p>}
        </div>
      )}

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

      {rows.length > 0 && (
        <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
          {rows.map((applicant) => {
            const expanded = openId === applicant.id;
            // Same rule as the detail panel: a stale list row must not out-vote a masked submission read.
            const masked =
              applicant.scores_masked || (submissions[applicant.id]?.skill_evidence_masked ?? false);
            const skillLines = matchRequiredSkills(
              job.required_skills,
              applicant.demonstrated,
              skillLabels
            );
            const line = lineFor(applicant);
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
                    {line && (
                      <span className="mt-1 block text-[11px] text-brand-ink/55">
                        {shortlistReason(line)}
                        {line.gateFailed && " · below the gate"}
                      </span>
                    )}
                    <RequiredSkillLines
                      lines={skillLines}
                      masked={masked}
                      compact
                    />
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {line && (
                      <span
                        className={cn(
                          "font-display text-sm font-bold tabular-nums",
                          line.score === null ? "text-brand-ink/35" : "text-brand-ink"
                        )}
                        title={line.score === null ? "Nothing recorded to rank on" : "Shortlist score"}
                      >
                        {line.score === null ? "—" : `${line.score}%`}
                      </span>
                    )}
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
                    canDecide={canDecide}
                    skillLines={skillLines}
                    onMoved={markMoved}
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
