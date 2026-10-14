"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban,
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge, Button, Meter } from "@/modules/analytics/presentation/ui";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { formatDateTime, sourceLabel, truncate } from "@/lib/utils";
import { humanizeStage } from "@/modules/settings/domain/templates";
import { getCandidateDossier, type CandidateDossier as DossierData } from "./dossier-actions";
import type { DossierAttempt } from "./dossier-actions";
import { AttachmentPanel } from "./AttachmentPanel";
import {
  deleteAttempt,
  extendAttemptLink,
  reissueAttemptLink,
  revokeAttempt,
  type AttemptResult,
} from "./attempt-actions";

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  IN_APP: "Portal notice",
};

function attemptTone(status: string) {
  if (status === "GRADED") return "success" as const;
  if (status === "EXPIRED") return "danger" as const;
  if (status === "SUBMITTED") return "info" as const;
  if (status === "IN_PROGRESS") return "gold" as const;
  return "neutral" as const;
}

const ALERT_PRESENTATION = {
  delivered: { label: "Delivered", tone: "success" as const },
  failed: { label: "Failed", tone: "danger" as const },
  queued: { label: "Queued", tone: "gold" as const },
};

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-brand-line pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-brand-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

const EXTENSIONS = [
  { hours: "24", label: "24 hours" },
  { hours: "48", label: "2 days" },
  { hours: "168", label: "7 days" },
];

const LINK_ACTION =
  "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

/**
 * One issued assessment link, with the recruiter's controls over it.
 *
 * The deadline is the organisation's own clock: whatever the last extension
 * stamped, otherwise issue time plus Settings → Assessments → Link validity.
 */
function AttemptRow({
  attempt,
  scoresMasked,
  canManage,
  onChanged,
}: {
  attempt: DossierAttempt;
  scoresMasked: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState("24");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = attempt.status === "NOT_STARTED" || attempt.status === "IN_PROGRESS";
  const untouched = !attempt.started_at && !attempt.submitted_at;

  async function run(action: string, fn: () => Promise<AttemptResult>) {
    setPending(action);
    setError(null);
    setCopied(false);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? `Could not ${action.toLowerCase()}.`);
        return;
      }
      if (result.access_token) {
        setLink(`${window.location.origin}/test/${result.access_token}`);
      }
      onChanged();
    } catch {
      setError(`Something went wrong while trying to ${action.toLowerCase()}.`);
    } finally {
      setPending(null);
    }
  }

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setError("Your browser blocked the copy — select the link below and copy it by hand.")
    );
  }

  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{attempt.template_name ?? "Assessment"}</p>
          <p className="mt-0.5 text-[11px] text-brand-ink/50">
            Assigned {formatDateTime(attempt.created_at)}
            {attempt.started_at ? ` · started ${formatDateTime(attempt.started_at)}` : ""}
            {attempt.submitted_at ? ` · submitted ${formatDateTime(attempt.submitted_at)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {scoresMasked ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
              Score hidden
            </span>
          ) : (
            attempt.score !== null && (
              <span className="font-display text-sm font-bold text-brand-gold-dark">
                {attempt.score}
                {attempt.max_score !== null ? `/${attempt.max_score}` : ""}
              </span>
            )
          )}
          <Badge tone={attemptTone(attempt.status)}>{humanizeStage(attempt.status)}</Badge>
        </div>
      </div>

      {(open || attempt.status === "EXPIRED") && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-brand-ink/50">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {attempt.status === "IN_PROGRESS"
            ? `Must be handed in by ${attempt.deadline}`
            : open
              ? `Link closes ${attempt.deadline}`
              : `Link closed ${attempt.deadline}`}
          {attempt.time_limit_minutes > 0
            ? ` · ${attempt.time_limit_minutes} min to answer`
            : ""}
        </p>
      )}

      {canManage && (open || untouched) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {open && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/55">
                Extend by
                <select
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="rounded-lg border border-brand-line bg-white px-2 py-1 text-xs font-semibold"
                >
                  {EXTENSIONS.map((option) => (
                    <option key={option.hours} value={option.hours}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => run("Extend link", () => extendAttemptLink(attempt.id, Number(hours)))}
                className={LINK_ACTION}
              >
                {pending === "Extend link" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                Apply
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Revoke this link?\n\nThe candidate can no longer open the test. Anything they already answered is kept."
                    )
                  )
                    return;
                  run("Revoke link", () => revokeAttempt(attempt.id));
                }}
                className={`${LINK_ACTION} text-rose-700 hover:bg-rose-50`}
              >
                {pending === "Revoke link" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                )}
                Revoke
              </button>
            </>
          )}
          {untouched && (
            <>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Re-issue this link?\n\nThe link the candidate holds stops working at once and a fresh one is sent on the channels that are switched on."
                    )
                  )
                    return;
                  run("Re-issue link", () => reissueAttemptLink(attempt.id));
                }}
                className={LINK_ACTION}
              >
                {pending === "Re-issue link" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                )}
                Re-issue link
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Delete this attempt?\n\nThe record of the assignment goes with it. Attempts that already have answers are refused — revoke those instead."
                    )
                  )
                    return;
                  run("Delete attempt", () => deleteAttempt(attempt.id));
                }}
                className={`${LINK_ACTION} text-rose-700 hover:bg-rose-50`}
              >
                {pending === "Delete attempt" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {link && (
        <div className="mt-2.5 rounded-xl border border-brand-line bg-brand-cream p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            New link · sent to the candidate
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 font-mono text-[11px]"
            />
            <button type="button" onClick={copyLink} className={LINK_ACTION}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Everything about one candidate that is too heavy for the table: the form as
 * they submitted it, the viability questions and their answers, the assessments,
 * every message they were sent, their onboarding plan and their other
 * applications.
 *
 * Loaded once when the profile drawer opens rather than with the list, so the
 * CV text of fifty candidates is never fetched to draw fifty rows.
 */
export function CandidateDossier({
  applicationId,
  reloadKey = 0,
}: {
  applicationId: string;
  /** Bumped by an edit above it, so the two never disagree about the name. */
  reloadKey?: number;
}) {
  const [dossier, setDossier] = useState<DossierData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    getCandidateDossier(applicationId).then(
      (result) => {
        if (!active) return;
        setPending(false);
        if (result.ok) {
          setDossier(result.dossier);
          setError(null);
        } else {
          setError(result.error);
        }
      },
      () => {
        // A rejected action call is a session or transport failure, not a
        // recruiter error, so it reads the same as a retry would.
        if (!active) return;
        setPending(false);
        setError("This candidate record could not be loaded. Please retry.");
      }
    );
    return () => {
      active = false;
    };
  }, [applicationId, retry, reloadKey]);

  function reload() {
    setPending(true);
    setRetry((n) => n + 1);
  }

  if (pending && !dossier) {
    return (
      <p className="flex items-center gap-2 border-t border-brand-line pt-4 text-xs text-brand-ink/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading this candidate&apos;s full record…
      </p>
    );
  }

  if (!dossier) {
    return (
      <div className="space-y-3 border-t border-brand-line pt-4">
        <FormMessage error={error ?? "This candidate record could not be loaded."} />
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  const app = dossier.application;

  return (
    <div className="space-y-4">
      {error && (
        <FormMessage
          error={`${error} The details below are from the last load.`}
        />
      )}

      <Section
        title="Submitted application"
        aside={
          <Button variant="outline" size="sm" onClick={reload} disabled={pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Reload
          </Button>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Detail label="Full name" value={app.full_name} />
          <Detail label="Email" value={app.email} />
          <Detail label="Phone" value={app.phone ?? "Not given"} />
          <Detail label="Applied through" value={sourceLabel(app.source)} />
          <Detail label="Tracking code" value={app.tracking_code} />
          <Detail label="Applied on" value={formatDateTime(app.applied_at)} />
          <Detail label="Role" value={app.job_title ?? "—"} />
          <Detail label="Department" value={app.job_department ?? "Not given"} />
          <Detail label="Location" value={app.job_location ?? "Not given"} />
        </dl>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
              {app.cv_name ? "Attached CV" : "CV text"}
            </p>
            {app.cv_url && (
              <div className="flex items-center gap-2">
                <a
                  href={app.cv_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Open CV
                </a>
                {app.cv_download_url && (
                  <a
                    href={app.cv_download_url}
                    download={app.cv_name ?? undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download
                  </a>
                )}
              </div>
            )}
          </div>

          {app.cv_name && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-ink/55">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate" title={app.cv_name}>
                {app.cv_name}
              </span>
            </p>
          )}

          {app.cv_error && <p className="mt-1.5 text-xs text-rose-700">{app.cv_error}</p>}

          {app.cv_text ? (
            <pre className="rail-scroll mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-brand-line bg-white p-3 font-mono text-[11px] leading-relaxed text-brand-ink/75">
              {app.cv_text}
            </pre>
          ) : (
            !app.cv_error && (
              <p className="mt-2 text-xs text-brand-ink/50">
                {app.cv_name
                  ? "No text could be read from this file — open it to read the CV as submitted."
                  : "No CV was attached to this application."}
              </p>
            )
          )}
        </div>
      </Section>

      <Section title="Files added by staff">
        <AttachmentPanel
          applicationId={app.id}
          attachments={dossier.attachments}
          canWrite={dossier.can_write}
          onChanged={reload}
        />
      </Section>

      {dossier.gate_answers.length > 0 && (
        <Section title="Viability questions">
          <ul className="space-y-2">
            {dossier.gate_answers.map((answer) => (
              <li key={answer.question} className="rounded-xl bg-brand-cream p-3">
                <p className="text-sm leading-snug text-brand-ink/75">{answer.question}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone={answer.passed ? "success" : "danger"}>
                    {answer.passed ? "Accepted" : "Rules out"}
                  </Badge>
                  <span className="text-sm font-semibold">{answer.answer}</span>
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {dossier.attempts.length > 0 && (
        <Section title="Assessments">
          <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
            {dossier.attempts.map((attempt) => (
              <AttemptRow
                key={attempt.id}
                attempt={attempt}
                scoresMasked={dossier.scores_masked}
                canManage={dossier.can_manage_links}
                onChanged={reload}
              />
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/45">
            Per-question marks, feedback and integrity signals open from the Integrity button above.
          </p>
        </Section>
      )}

      <Section title="Candidate alerts">
        {dossier.alerts.length === 0 ? (
          <p className="text-sm text-brand-ink/45">
            Nothing has been sent to this candidate yet. Pipeline moves, interviews and bulk
            messages all land here.
          </p>
        ) : (
          <ul className="rail-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
            {dossier.alerts.map((alert) => {
              const presentation = ALERT_PRESENTATION[alert.status];
              return (
                <li key={alert.id} className="rounded-xl border border-brand-line bg-white p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone={presentation.tone}>{presentation.label}</Badge>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                      {CHANNEL_LABELS[alert.channel] ?? humanizeStage(alert.channel)}
                    </span>
                    {alert.read_at && (
                      <span className="text-[11px] text-emerald-700">Read by candidate</span>
                    )}
                    <span className="ml-auto text-[11px] text-brand-ink/40">
                      {formatDateTime(alert.occurred_at)}
                    </span>
                  </p>
                  {alert.subject && <p className="mt-1.5 text-sm font-semibold">{alert.subject}</p>}
                  <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">
                    {truncate(alert.body, 220)}
                  </p>
                  <p className="mt-1 text-[11px] text-brand-ink/40">
                    {alert.direction === "INBOUND" ? "From" : "To"} {alert.recipient}
                  </p>
                  {alert.error && <p className="mt-1 text-[11px] text-rose-700">{alert.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {dossier.onboarding && (
        <Section
          title="Onboarding"
          aside={
            <Link
              href="/onboarding"
              className="text-[11px] font-semibold text-brand-gold-dark underline underline-offset-4"
            >
              Open plan
            </Link>
          }
        >
          <div className="flex items-center gap-3">
            <span className="w-12 text-right font-display text-lg font-extrabold text-brand-gold-dark">
              {Math.round(dossier.onboarding.progress)}%
            </span>
            <Meter value={dossier.onboarding.progress} className="flex-1" />
          </div>
          <p className="mt-2 text-xs text-brand-ink/55">
            {dossier.onboarding.tasks_done} of {dossier.onboarding.tasks_total} tasks done
            {dossier.onboarding.risk_score !== null
              ? ` · retention risk ${Math.round(dossier.onboarding.risk_score)}%`
              : ""}
            {` · planned ${dossier.onboarding.generated_by_ai ? "by AI" : "by hand"} on ${formatDateTime(
              dossier.onboarding.created_at
            )}`}
          </p>
        </Section>
      )}

      {dossier.other_applications.length > 0 && (
        <Section title="Other applications">
          <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
            {dossier.other_applications.map((sibling) => (
              <li key={sibling.id}>
                <Link
                  href={`/candidates?application=${sibling.id}`}
                  className="flex items-center justify-between gap-3 p-3 transition hover:bg-brand-cream"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {sibling.job_title ?? "Closed opening"}
                    </span>
                    <span className="block text-[11px] text-brand-ink/50">
                      {sibling.tracking_code} · applied {formatDateTime(sibling.applied_at)}
                    </span>
                  </span>
                  <Badge tone="neutral">{humanizeStage(sibling.stage)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
