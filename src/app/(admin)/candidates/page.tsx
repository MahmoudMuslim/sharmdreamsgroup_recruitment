import { CalendarDays, Sparkles, Upload } from "lucide-react";
import {
  getCandidateByRef,
  getCandidateList,
  getCandidateTally,
  getCvCoverage,
  getUngradedAssessmentQueue,
  type CvCoverage,
} from "./actions";
import { CandidateBrowser } from "./CandidateBrowser";
import { NewCandidateDrawer } from "./NewCandidateDrawer";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting, getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import {
  isApplicationSource,
  isPipelineStage,
  type CandidateTally,
} from "@/modules/candidates/domain/listFilters";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { EXPORT_FORMATS } from "@/modules/analytics/domain/exportDocument";
import { connection } from "next/server";

export const metadata = {
  title: "Candidate Database",
  description: "All applications with AI screening summaries and assessment status",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

/**
 * The screening card quotes what the pipeline can actually be scored on.
 *
 * Screening reads the CV *text* stored on a record, so a file nobody parsed and
 * a record with no CV at all are not covered by the old promise that parsing
 * "runs on every application". The counts are read live, in the same render as
 * the table, so the sentence cannot drift from the pipeline it describes.
 */
function describeCvCoverage(coverage: CvCoverage): string {
  if (coverage.total === 0) return "No live applications yet, so nothing has been screened.";
  if (coverage.withText === coverage.total)
    return `CV parsing with demographic anonymisation and match scoring reads the CV text stored on each application — all ${coverage.total} live records carry it.`;

  const sentences = [
    `CV parsing with demographic anonymisation and match scoring reads the CV text stored on each application. ${coverage.withText} of ${coverage.total} live records carry it.`,
  ];
  if (coverage.fileNotRead > 0)
    sentences.push(
      `${coverage.fileNotRead} hold a CV file whose text has never been read out — open the candidate and choose "Read the stored CV".`
    );
  if (coverage.noCv > 0)
    sentences.push(
      `${coverage.noCv} have no CV on file at all, so screening has nothing to read for them.`
    );
  return sentences.join(" ");
}

/** The four switches `notifyStageChange` reads before it tells anybody anything. */
interface AlertSwitches {
  stageAlerts: boolean;
  email: boolean;
  inApp: boolean;
  whatsapp: boolean;
}

/**
 * The alerts card names the switches the dispatcher actually reads.
 *
 * "Every pipeline move emails the candidate" was not true in two ways: each
 * channel sits behind its own Settings switch, and the one stage move that
 * never notifies is the candidate submitting their own test — the pipeline
 * advances, and telling them about it would be noise. Defaults here mirror the
 * dispatcher exactly, WhatsApp included, which stays off until credentials are
 * set up.
 */
function describeAlerts(switches: AlertSwitches): string {
  if (!switches.stageAlerts)
    return "Stage-change alerts are switched off in Settings → Notifications, so a pipeline move sends no email, leaves no notice and queues no WhatsApp.";

  const routes = [
    switches.email ? "an email with the live template copy" : null,
    switches.inApp ? "a notice in their portal inbox" : null,
    switches.whatsapp ? "a WhatsApp queued for the next dispatcher pass" : null,
  ].filter((line): line is string => line !== null);

  if (routes.length === 0)
    return "Every candidate channel is switched off in Settings → Notifications, so a pipeline move tells the candidate nothing at all.";

  const reached =
    routes.length === 1 ? routes[0] : `${routes.slice(0, -1).join(", ")} and ${routes[routes.length - 1]}`;

  return `Every move staff or the AI engine makes reaches the candidate as ${reached}. What each send actually did — accepted, refused, or never attempted because no SMTP relay is set — is on the Candidate messaging page, and the one move that stays silent is the candidate's own test submission.`;
}

/** The four switches, read the way the dispatcher reads them. */
async function readAlertSwitches(): Promise<AlertSwitches> {
  const [stageAlerts, email, inApp, whatsapp] = await Promise.all([
    getBoolSetting("notifications.notify_on_stage_change", true),
    getBoolSetting("notifications.email_enabled", true),
    getBoolSetting("notifications.in_app_enabled", true),
    getBoolSetting("notifications.whatsapp_enabled", false),
  ]);
  return { stageAlerts, email, inApp, whatsapp };
}

/**
 * Deep links arrive from the job opening's applicant list (`?c=SDG-…`), the
 * interview agenda (`?c=…`) and the assistant (`?application=<id>`).
 * `?archived=1` opens the archive the filing door emptied, and `?ungraded=1`
 * opens the grading queue the Bell counts — see `getUngradedAssessmentQueue`.
 * `?stage=` and `?source=` are the two rails' own filters, applied in the
 * database over every matching application: the attention feed links by stage,
 * so the rows a recruiter lands on have to be the rows that count described.
 * Both are read through the domain's validators, so a parameter that names no
 * stage narrows nothing rather than silently emptying the table.
 */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Admin content is per-session; stop the static shell before any rendering.
  await connection();
  const user = await requireStaff("/candidates");

  const params = await searchParams;
  const ref = {
    id: typeof params.application === "string" ? params.application : undefined,
    trackingCode: typeof params.c === "string" ? params.c : undefined,
  };
  const hasRef = Boolean(ref.id || ref.trackingCode);

  // Resolved before the table so a link to a filed candidate can open the
  // archive instead of landing the recruiter on a live list with no such row.
  const focused = hasRef ? await getCandidateByRef(ref) : null;
  const showArchived = params.archived === "1" || Boolean(focused?.archived_at);
  // The queue the attention feed counts and links here. The archive outranks it
  // when both arrive: a filed-away record is not work waiting on a person.
  const gradingView = !showArchived && params.ungraded === "1";
  const railStage = isPipelineStage(params.stage);
  const railSource = isApplicationSource(params.source);

  const [candidates, tally, canWrite, canExport, timeZone, canGenerateQuestions, coverage, switches] =
    await Promise.all([
      gradingView
        ? getUngradedAssessmentQueue(railStage, railSource)
        : getCandidateList(showArchived, railStage, railSource),
      // The queue is a set the page already holds in full, so its rails count
      // those rows; the pipeline and the archive count everything they match.
      gradingView ? Promise.resolve<CandidateTally | null>(null) : getCandidateTally(showArchived),
      hasPermissionForUser("candidates.write"),
      hasPermissionForUser("analytics.export"),
      getOrganisationTimeZone(),
      getBoolSetting("ai.interview_questions", true),
      getCvCoverage(),
      readAlertSwitches(),
    ]);

  // The pipeline loads only the newest rows it holds; a link to anyone older is
  // fetched on its own so the profile can still open.
  const rows =
    focused && !candidates.some((c) => c.id === focused.id)
      ? [focused, ...candidates]
      : candidates;

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow={gradingView ? "Grading queue" : "Talent database"}
        title="Candidates"
        description={
          gradingView
            ? "Only the candidates whose assessment is still sitting in Submitted — the state the grading engine leaves an attempt in when it never finished scoring it. Open a profile to ask the AI again or award the marks yourself."
            : "Every application across the group, with bias-reduced AI screening scores and assessment status — and the filtered list as a CSV, Excel or PDF download."
        }
        actions={canWrite ? <NewCandidateDrawer /> : undefined}
      />

      <CandidateBrowser
        candidates={rows}
        archivedView={showArchived}
        gradingView={gradingView}
        railStage={railStage}
        railSource={railSource}
        tally={tally}
        canWrite={canWrite}
        canExport={canExport}
        exportFormats={EXPORT_FORMATS}
        focusId={focused?.id ?? null}
        unresolvedRef={hasRef && !focused ? (ref.trackingCode ?? ref.id ?? null) : null}
        timeZone={timeZone}
        canGenerateQuestions={canGenerateQuestions}
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <h3 className="font-display text-base font-bold">AI screening</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            {describeCvCoverage(coverage)}
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <Upload className="h-5 w-5" aria-hidden />
          </div>
          <h3 className="font-display text-base font-bold">Candidate alerts</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            {describeAlerts(switches)}
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </div>
          <h3 className="font-display text-base font-bold">Interview scheduling</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            Book a panel with an interviewer and a joining link, then record the outcome. The
            day-grouped agenda lives under Interviews.
          </p>
        </Card>
      </div>
    </AdminShell>
  );
}