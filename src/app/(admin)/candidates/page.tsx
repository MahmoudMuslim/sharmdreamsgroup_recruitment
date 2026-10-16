import { CalendarDays, Sparkles, Upload } from "lucide-react";
import { getCandidateByRef, getCandidateList, getCvCoverage, type CvCoverage } from "./actions";
import { CandidateBrowser } from "./CandidateBrowser";
import { NewCandidateDrawer } from "./NewCandidateDrawer";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting, getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
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

/**
 * Deep links arrive from the job opening's applicant list (`?c=SDG-…`), the
 * interview agenda (`?c=…`) and the assistant (`?application=<id>`).
 * `?archived=1` opens the archive the filing door emptied.
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

  const [candidates, canWrite, canExport, timeZone, canGenerateQuestions, coverage] =
    await Promise.all([
      getCandidateList(showArchived),
      hasPermissionForUser("candidates.write"),
      hasPermissionForUser("analytics.export"),
      getOrganisationTimeZone(),
      getBoolSetting("ai.interview_questions", true),
      getCvCoverage(),
    ]);

  // The table only loads the newest 50 applications; a link to anyone older is
  // fetched on its own so the profile can still open.
  const rows =
    focused && !candidates.some((c) => c.id === focused.id)
      ? [focused, ...candidates]
      : candidates;

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Talent database"
        title="Candidates"
        description="Every application across the group, with bias-reduced AI screening scores and assessment status — and the filtered list as a CSV, Excel or PDF download."
        actions={canWrite ? <NewCandidateDrawer /> : undefined}
      />

      <CandidateBrowser
        candidates={rows}
        archivedView={showArchived}
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
            Every pipeline move emails the candidate, queues a WhatsApp where one is enabled, and
            leaves a notice in their portal inbox.
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