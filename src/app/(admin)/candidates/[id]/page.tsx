import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  Mail,
  MessagesSquare,
  ShieldAlert,
  Sparkles,
  UserRoundSearch,
} from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { formatInZone } from "@/lib/timezone";
import { Badge, Card, CardHeader, PageHeader } from "@/modules/analytics/presentation/ui";
import { navBack } from "@/modules/shell/domain/navTransition";
import type { GateAnswer } from "@/modules/careers/gate-questions";
import { getCandidateProfile } from "./profile";
import type {
  ProfileApplication,
  ProfileAttempt,
  ProfileChange,
  ProfileFile,
  ProfileInterview,
  ProfileMessage,
  ProfilePlan,
} from "./profile";

export const metadata = {
  title: "Candidate profile",
  description: "The one page that holds everything filed about a candidate.",
};

/**
 * The page reads one record behind a live session, so a navigation into it can
 * never be instant — which is what opting out of `instant` validation states,
 * rather than a claim that nothing is ever fetched ahead of the click.
 */
export const instant = false;

/**
 * The candidate's own page.
 *
 * `applications` is one row per person per opening, which is why a recruiter
 * used to meet the same human being several times: each row was its own drawer,
 * each drawer its own half of the story. This page is keyed by the *person* — any
 * of their row ids lands here, and the profile's address is their oldest live
 * row, so one candidate cannot accumulate two URLs.
 *
 * It reads and does not write. Stage moves, grading, test links and uploads stay
 * in the desk, which the footer says out loud rather than letting a recruiter
 * hunt for a button this page deliberately does not have.
 */
export default async function CandidateProfilePage({
  params,
}: PageProps<"/candidates/[id]">) {
  await connection();
  const { id } = await params;
  await requireStaff(`/candidates/${id}`);

  const result = await getCandidateProfile(id);
  if (!result.ok) notFound();

  // One person, one address. A link that named a newer application is moved to the
  // profile that owns the whole set, so the same candidate never has two pages.
  if (id !== result.canonicalId) redirect(`/candidates/${result.canonicalId}`);

  const { profile } = result;
  const { person, time_zone: zone } = profile;

  return (
    <PageTransition>
        <PageHeader
          eyebrow="Candidate profile"
          title={person.full_name}
          description={`One profile for ${person.email}. They hold ${person.applications} application${
            person.applications === 1 ? "" : "s"
          } across ${person.openings.length || "no"} opening${
            person.openings.length === 1 ? "" : "s"
          }${
            // `applications` is the database's own count; the rows printed below are
            // the newest ones this read is allowed to take. Say which is which.
            person.rows_read < person.applications
              ? ` — this page reads the newest ${person.rows_read} of them`
              : ""
          }. Everything filed against this address is here.`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/candidates"
                transitionTypes={navBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold transition hover:shadow-soft"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                All candidates
              </Link>
              <Link
                href={`/candidates?application=${person.opened_id}`}
                transitionTypes={navBack}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gold px-3 py-2 text-xs font-bold text-brand-on-accent transition hover:shadow-lift"
              >
                <UserRoundSearch className="h-3.5 w-3.5" aria-hidden />
                Open in the desk
              </Link>
            </div>
          }
        />

        {person.repeated && (
          <Card className="mb-6 border-brand-gold/60 bg-brand-sand/50 p-5">
            <p className="flex items-start gap-2 text-sm font-semibold">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
              {person.live} live applications for this one person
              {profile.clipped.applications ? ` among the rows this page reads` : ""}.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/65">
              They are in play for {person.openings.join(", ") || "several openings"} at the same
              time. That is normal — a person may be in two pipelines — but they are still one
              candidate with this one profile, not {person.live} people. Duplicate live records for
              the same opening are refused by the database, so the row you add next cannot repeat
              them.
            </p>
          </Card>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Who they are" meta="contact details and how they arrived" />
            <div className="divide-y divide-brand-line/60">
              <Field label="Email">{person.email}</Field>
              <Field label="Phone">
                {person.phone ?? "not on file"}
                {person.other_phones.length > 0 && (
                  <span className="ml-1 text-brand-ink/55">
                    also filed as {person.other_phones.join(", ")}
                  </span>
                )}
              </Field>
              <Field label="Tracking codes">{person.tracking_codes.join(" · ") || "—"}</Field>
              <Field label="Came through">{person.sources.join(", ") || "—"}</Field>
              <Field label="First seen">{day(person.first_seen, zone)}</Field>
              <Field label="Last activity">{day(person.last_seen, zone)}</Field>
              <Field label="Records">
                {person.applications} application{person.applications === 1 ? "" : "s"}
                {person.archived > 0 && ` · ${person.archived} filed away`}
              </Field>
            </div>
            {person.other_names.length > 0 && (
              <p className="border-t border-brand-line/60 px-5 py-3 text-[11px] leading-relaxed text-brand-ink/55">
                This address is also filed under {person.other_names.join(" and ")}. Same person, one
                profile — the name is whatever the candidate typed on each application.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Every application they hold" meta="one row per opening" />
            <ul className="divide-y divide-brand-line/60">
              {profile.applications.map((app) => (
                <li key={app.id} className="px-5 py-3.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {app.job_title ?? "an opening nobody can read"}
                    <StageBadge stage={app.stage} />
                    {app.archived_at && <Badge tone="neutral">filed away</Badge>}
                    {app.opened && <Badge tone="gold">this URL</Badge>}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                    {app.company_name ?? "no company on the opening"} · {app.source.replace(/_/g, " ")}{" "}
                    · applied {day(app.applied_at, zone)} · {app.tracking_code}
                  </p>
                </li>
              ))}
            </ul>
            {profile.clipped.applications && (
              <p className="border-t border-brand-line/60 px-5 py-3 text-[11px] text-brand-ink/55">
                Only the newest {profile.applications.length} of their applications are read here.
              </p>
            )}
          </Card>
        </section>

        <section className="mt-6 space-y-6">
          {profile.applications.map((app) => (
            <ApplicationCard key={app.id} app={app} zone={zone} masked={profile.scores_masked} />
          ))}
        </section>

        <AssessmentsCard
          attempts={profile.attempts}
          zone={zone}
          masked={profile.scores_masked}
          clipped={profile.clipped.attempts}
        />

        <InterviewsCard interviews={profile.interviews} zone={zone} />

        {profile.plans.length > 0 && <OnboardingCard plans={profile.plans} zone={zone} />}

        <FilesCard files={profile.files} zone={zone} clipped={profile.clipped.files} />

        <MessagesCard messages={profile.messages} zone={zone} clipped={profile.clipped.messages} />

        <ChangesCard changes={profile.changes} zone={zone} />

        <p className="mt-6 text-[11px] leading-relaxed text-brand-ink/50">
          This page reads the record; it does not change it. Stages, AI screening, grading, test
          links and file uploads are on{" "}
          <Link
            href={`/candidates?application=${person.opened_id}`}
            className="font-semibold text-brand-gold-dark underline"
          >
            the candidate desk
          </Link>
          , which is where the buttons that write live.
        </p>
    </PageTransition>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-right text-sm break-words">{children}</span>
    </div>
  );
}

const STAGE_TONES: Record<string, "neutral" | "gold" | "success" | "danger" | "info"> = {
  NEW: "info",
  AI_SCREENING: "gold",
  ASSESSMENT: "gold",
  INTERVIEW: "gold",
  OFFER: "success",
  HIRED: "success",
  REJECTED: "danger",
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge tone={STAGE_TONES[stage] ?? "neutral"}>{stage.replace(/_/g, " ").toLowerCase()}</Badge>
  );
}

/** One opening's own story: what they sent, what the machine said, what it asked. */
function ApplicationCard({
  app,
  zone,
  masked,
}: {
  app: ProfileApplication;
  zone: string;
  masked: boolean;
}) {
  const soft = app.screening.soft_skills;

  return (
    <Card>
      <CardHeader
        title={app.job_title ?? "An opening this session cannot read"}
        meta={`${app.company_name ?? "no company"} · applied ${day(app.applied_at, zone)} · ${
          app.tracking_code
        }`}
      />

      <div className="grid gap-5 px-5 py-4 sm:px-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Briefcase className="h-4 w-4 text-brand-ink/40" aria-hidden />
            {app.stage.replace(/_/g, " ").toLowerCase()}
            <StageBadge stage={app.stage} />
            {app.archived_at && <Badge tone="neutral">filed away {day(app.archived_at, zone)}</Badge>}
            {app.hired_at && <Badge tone="success">hired {day(app.hired_at, zone)}</Badge>}
          </p>
          <p className="text-[11px] leading-relaxed text-brand-ink/55">
            {[app.job_department, app.job_location].filter(Boolean).join(" · ") ||
              "no department or location on the opening"}{" "}
            · came through {app.source.replace(/_/g, " ").toLowerCase()} · last touched{" "}
            {day(app.updated_at, zone)}
          </p>

          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            What they sent
          </p>
          <p className="text-[11px] leading-relaxed text-brand-ink/60">
            {app.cv.stored
              ? app.cv.name
                ? `${app.cv.name}${app.cv.url ? " — " : ""}`
                : "a file on storage"
              : "no CV file was stored for this application"}
            {app.cv.url && (
              <>
                <a
                  href={app.cv.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-brand-gold-dark underline"
                >
                  open
                </a>
                {app.cv.download_url && (
                  <>
                    {" · "}
                    <a
                      href={app.cv.download_url}
                      className="font-semibold text-brand-gold-dark underline"
                    >
                      save
                    </a>
                  </>
                )}
              </>
            )}
          </p>
          {app.cv.error && (
            <p className="rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/60">
              {app.cv.error}
            </p>
          )}

          {app.screening.rejection_reason && (
            <p className="text-[11px] leading-relaxed">
              <span className="font-bold uppercase tracking-[0.14em] text-brand-ink/45">
                Rejection reason ·{" "}
              </span>
              {app.screening.rejection_reason}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            AI screening
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-brand-gold-dark" aria-hidden />
            {masked && app.screening.scored ? (
              <span>
                Scored, but <code className="text-[11px]">security.mask_scores_for_reviewers</code>{" "}
                hides the number from this account.
              </span>
            ) : app.screening.scored ? (
              <span className="font-semibold">{app.screening.score}/100 match</span>
            ) : (
              <span className="text-brand-ink/55">
                never screened — use Screen now in the desk
              </span>
            )}
          </p>
          {app.screening.summary && (
            <p className="text-[11px] leading-relaxed text-brand-ink/65">
              {app.screening.summary}
            </p>
          )}
          {(app.screening.strengths.length > 0 || app.screening.gaps.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {app.screening.strengths.map((item) => (
                <span
                  key={`s-${item}`}
                  className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-[10px] font-semibold text-brand-gold-dark"
                >
                  {item}
                </span>
              ))}
              {app.screening.gaps.map((item) => (
                <span
                  key={`g-${item}`}
                  className="rounded-full bg-brand-sand px-2 py-0.5 text-[10px] font-semibold text-brand-ink/55"
                >
                  gap: {item}
                </span>
              ))}
            </div>
          )}
          {soft && (
            <ul className="space-y-1 text-[11px]">
              {[
                ["Emotional intelligence", soft.emotional_intelligence],
                ["Communication", soft.communication],
                ["Leadership potential", soft.leadership_potential],
                ["Cultural fit", soft.cultural_fit],
              ].map(([label, value]) => (
                <li key={String(label)} className="flex items-center justify-between gap-3">
                  <span className="text-brand-ink/60">{label}</span>
                  <span className="font-semibold">{Number(value)}/5</span>
                </li>
              ))}
              <li className="text-brand-ink/50">
                sentiment {soft.overall_sentiment.toLowerCase()} ·{" "}
                {Math.round(soft.sentiment_score * 100)}% · {soft.summary}
              </li>
            </ul>
          )}
          {app.screening.feedback && (
            <details className="rounded-xl border border-brand-line bg-brand-cream/50 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/55">
                Feedback written to the candidate
              </summary>
              <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-brand-ink/70">
                {app.screening.feedback}
              </p>
            </details>
          )}
          {app.skills.length > 0 && (
            <p className="text-[11px] leading-relaxed text-brand-ink/60">
              <span className="font-bold uppercase tracking-[0.14em] text-brand-ink/45">
                Skills matched ·{" "}
              </span>
              {app.skills.join(", ")}
            </p>
          )}
        </div>
      </div>

      {app.gate_answers.length > 0 && (
        <GateList answers={app.gate_answers} />
      )}

      <div className="border-t border-brand-line/60 px-5 py-3 sm:px-6">
        <Link
          href={`/candidates?application=${app.id}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-dark hover:underline"
        >
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          Work this application in the desk
        </Link>
      </div>
    </Card>
  );
}

/** The viability questions this role asked, and how the answer scored. */
function GateList({ answers }: { answers: GateAnswer[] }) {
  return (
    <div className="border-t border-brand-line/60 px-5 py-4 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/45">
        Viability gate — {answers.length} question{answers.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {answers.map((answer) => (
          <li key={answer.question} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <CheckCircle2
              className={
                answer.passed
                  ? "mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-dark"
                  : "mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500"
              }
              aria-hidden
            />
            <span>
              <span className="font-semibold">{answer.question}</span> — {answer.answer}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssessmentsCard({
  attempts,
  zone,
  masked,
  clipped,
}: {
  attempts: ProfileAttempt[];
  zone: string;
  masked: boolean;
  clipped: boolean;
}) {
  return (
    <Card className="mt-6">
      <CardHeader
        title="Assessment links"
        meta={
          attempts.length === 0
            ? "none issued on any of their applications"
            : `${attempts.length} link${attempts.length === 1 ? "" : "s"} across their records`
        }
        className="rounded-t-2xl"
      />
      {attempts.length === 0 ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/55 sm:px-6">
          No test has been issued to this person on any opening. Issuing one lives in the desk.
        </p>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {attempts.map((attempt) => (
            <li key={attempt.id} className="px-5 py-3 sm:px-6">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-brand-ink/40" aria-hidden />
                {attempt.template_name ?? "a suite this session cannot read"}
                <Badge tone={attempt.status === "GRADED" ? "success" : "neutral"}>
                  {attempt.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                {attempt.job_title ?? "no opening named"} · {attempt.time_limit_minutes} min ·{" "}
                {attempt.started_at ? `started ${stamp(attempt.started_at, zone)}` : "never opened"}
                {" · "}
                {attempt.submitted_at ? `submitted ${stamp(attempt.submitted_at, zone)}` : "not submitted"}
                {" · link dies "}
                {attempt.deadline}
              </p>
              <p className="mt-1 text-[11px]">
                {masked && attempt.score === null ? (
                  <span className="text-brand-ink/55">
                    score hidden from this account by the mask setting
                  </span>
                ) : attempt.score !== null ? (
                  <span className="font-semibold">
                    {attempt.score}
                    {attempt.max_score !== null ? ` / ${attempt.max_score}` : ""}
                  </span>
                ) : (
                  <span className="text-brand-ink/55">no score yet</span>
                )}
                {attempt.integrity_flags > 0 && (
                  <span className="ml-2 text-brand-ink/55">
                    · focus changed {attempt.integrity_flags}×
                    {attempt.integrity_score !== null ? `, integrity ${attempt.integrity_score}` : ""}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {clipped && (
        <p className="border-t border-brand-line/60 px-5 py-3 text-[11px] text-brand-ink/55 sm:px-6">
          Older links are not listed — this page reads {attempts.length} at most.
        </p>
      )}
    </Card>
  );
}

function InterviewsCard({
  interviews,
  zone,
}: {
  interviews: ProfileInterview[];
  zone: string;
}) {
  return (
    <Card className="mt-6">
      <CardHeader
        title="Interviews"
        meta={
          interviews.length === 0
            ? "nothing booked on any of their records"
            : `${interviews.length} booked`
        }
      />
      {interviews.length === 0 ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/55 sm:px-6">
          No interview is on the calendar for this person. Booking one lives in the desk.
        </p>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {interviews.map((interview) => (
            <li key={interview.id} className="px-5 py-3 sm:px-6">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-brand-ink/40" aria-hidden />
                {stamp(interview.scheduled_at, zone)}
                <Badge tone={interview.status === "COMPLETED" ? "success" : "neutral"}>
                  {interview.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                {interview.duration_minutes} min ·{" "}
                {interview.interviewer_name ?? "no interviewer recorded"} ·{" "}
                {interview.job_title ?? "no opening named"}
                {interview.meeting_link && (
                  <>
                    {" · "}
                    <a
                      href={interview.meeting_link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-brand-gold-dark underline"
                    >
                      meeting link
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OnboardingCard({
  plans,
  zone,
}: {
  plans: ProfilePlan[];
  zone: string;
}) {
  return (
    <Card className="mt-6">
      <CardHeader title="Onboarding" meta={`${plans.length} plan${plans.length === 1 ? "" : "s"}`} />
      <ul className="divide-y divide-brand-line/60">
        {plans.map((plan) => (
          <li key={plan.application_id} className="px-5 py-3 sm:px-6">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-brand-ink/40" aria-hidden />
              {plan.tasks_done}/{plan.tasks_total} tasks done · {plan.progress}%
              {plan.generated_by_ai && <Badge tone="gold">written by AI</Badge>}
            </p>
            <p className="mt-1 text-[11px] text-brand-ink/55">
              {plan.job_title ?? "no opening named"} · created {day(plan.created_at, zone)}
              {plan.risk_score !== null && ` · retention risk ${plan.risk_score}`}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FilesCard({
  files,
  zone,
  clipped,
}: {
  files: ProfileFile[];
  zone: string;
  clipped: boolean;
}) {
  return (
    <Card className="mt-6">
      <CardHeader
        title="Files a recruiter attached"
        meta={files.length === 0 ? "nothing attached to any record" : `${files.length} file(s)`}
      />
      {files.length === 0 ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/55 sm:px-6">
          Nothing was attached by hand. The CV each application carried, if any, is listed inside
          that application above.
        </p>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {files.map((file) => (
            <li key={file.id} className="px-5 py-3 sm:px-6">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <FolderOpen className="h-4 w-4 text-brand-ink/40" aria-hidden />
                {file.name}
                <Badge tone="neutral">{file.label}</Badge>
              </p>
              <p className="mt-1 text-[11px] text-brand-ink/55">
                {file.bytes !== null ? `${Math.round(file.bytes / 1024)} KB · ` : ""}
                uploaded {stamp(file.uploaded_at, zone)} by {file.uploaded_by ?? "a departed account"}
                {" · "}
                <Link
                  href={`/api/files/link?bucket=${encodeURIComponent(file.bucket)}&path=${encodeURIComponent(file.path)}`}
                  className="font-semibold text-brand-gold-dark underline"
                >
                  open
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
      {clipped && (
        <p className="border-t border-brand-line/60 px-5 py-3 text-[11px] text-brand-ink/55 sm:px-6">
          Older files are not listed — this page reads {files.length} at most.
        </p>
      )}
    </Card>
  );
}

const MESSAGE_WORDS: Record<ProfileMessage["status"], string> = {
  delivered: "delivered",
  failed: "failed",
  queued: "waiting in the queue",
  written: "written to their portal inbox",
};

function MessagesCard({
  messages,
  zone,
  clipped,
}: {
  messages: ProfileMessage[];
  zone: string;
  clipped: boolean;
}) {
  return (
    <Card className="mt-6">
      <CardHeader
        title="Every message"
        meta={
          messages.length === 0
            ? "nothing sent and nothing received"
            : `${messages.length} on record across their applications`
        }
      />
      {messages.length === 0 ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/55 sm:px-6">
          The group has never written to this address, and nothing came back from it.
        </p>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {messages.map((message) => (
            <li key={message.id} className="px-5 py-3 sm:px-6">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Mail
                  className={
                    message.direction === "INBOUND"
                      ? "h-4 w-4 text-brand-gold-dark"
                      : "h-4 w-4 text-brand-ink/40"
                  }
                  aria-hidden
                />
                {message.channel === "IN_APP" ? (
                  <MessagesSquare className="h-3.5 w-3.5 text-brand-ink/35" aria-hidden />
                ) : null}
                {message.subject ?? message.channel.toLowerCase()}
                <Badge
                  tone={
                    message.status === "delivered"
                      ? "success"
                      : message.status === "failed"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {MESSAGE_WORDS[message.status]}
                </Badge>
              </p>
              <p className="mt-1 text-[11px] text-brand-ink/55">
                {message.direction === "INBOUND" ? "from" : "to"} {message.recipient} ·{" "}
                {stamp(message.occurred_at, zone)} ·{" "}
                {message.job_title ?? "no opening named"}
                {message.read_at && ` · read ${stamp(message.read_at, zone)}`}
              </p>
              {message.error && (
                <p className="mt-1 text-[11px] text-red-600">{message.error}</p>
              )}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] font-semibold text-brand-ink/55 hover:text-brand-ink">
                  read the message
                </summary>
                <p className="mt-1.5 whitespace-pre-line rounded-xl border border-brand-line bg-brand-cream/50 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/70">
                  {message.body}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {clipped && (
        <p className="border-t border-brand-line/60 px-5 py-3 text-[11px] text-brand-ink/55 sm:px-6">
          Older messages are not listed — each of the two reads here stops at {messages.length}.
        </p>
      )}
    </Card>
  );
}

function ChangesCard({
  changes,
  zone,
}: {
  changes: { rows: ProfileChange[]; note: string | null };
  zone: string;
}) {
  return (
    <Card className="mt-6">
      <CardHeader
        title="Changes on the record"
        meta={
          changes.note
            ? "the trail cannot be read yet"
            : `${changes.rows.length} change${changes.rows.length === 1 ? "" : "s"} named`
        }
      />
      {changes.note ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/60 sm:px-6">
          {changes.note}
        </p>
      ) : changes.rows.length === 0 ? (
        <p className="px-5 py-4 text-[11px] leading-relaxed text-brand-ink/55 sm:px-6">
          Nothing has been written about this person since the trail started recording.
        </p>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {changes.rows.map((change) => (
            <li key={change.id} className="px-5 py-2.5 sm:px-6">
              <p className="text-[11px] leading-relaxed">
                {change.summary}
                {change.job_title && (
                  <span className="text-brand-ink/50"> — {change.job_title}</span>
                )}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-brand-ink/45">
                {stamp(change.created_at, zone)} · {change.actor} · {change.area.replace(/_/g, " ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** `19 Mar 2026` in the clock the recruiter works to, or a dash. */
function day(iso: string | null, zone: string): string {
  if (!iso) return "—";
  return formatInZone(iso, zone, { day: "2-digit", month: "short", year: "numeric" });
}

/** The same, with the time, for anything a recruiter acts on. */
function stamp(iso: string, zone: string): string {
  return formatInZone(iso, zone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
