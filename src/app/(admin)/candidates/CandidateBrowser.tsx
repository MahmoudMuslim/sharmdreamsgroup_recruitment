"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Lock,
  Search,
  Send,
  Sparkles,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { Badge, Button, Card, EmptyState, FilterRail, Meter } from "@/modules/analytics/presentation/ui";
import {
  CANDIDATE_COUNT_SCAN_LIMIT,
  CANDIDATE_ROW_LIMIT,
  GRADING_QUEUE_LIMIT,
  PIPELINE_STAGES as STAGES,
  candidateSearchWords,
  filterCandidates,
  sortCandidates,
  tallyCandidates,
  tallyCompanies,
  type CandidateSort,
  type CandidateTally,
} from "@/modules/candidates/domain/listFilters";
import {
  draftCandidateFeedback,
  draftRejectionReason,
  screenApplication,
  sendBulkEmail,
  sendBulkWhatsApp,
  sendCandidateFeedback,
  setCandidateArchive,
  updateApplicationStage,
  updateCandidateContact,
  type PipelineStage,
} from "./candidate-actions";
import type { CandidateRow } from "./actions";
import { CandidateDossier } from "./CandidateDossier";
import { IntegrityPanel } from "./IntegrityPanel";
import { InterviewPanel } from "./InterviewPanel";
import { cn } from "@/lib/utils";
import type { SoftSkillReport } from "@/types";

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

/** Stands in for an AI score the signed-in staff member may not read. */
function LockedScore() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
      <Lock className="h-3 w-3" aria-hidden />
      Hidden
    </span>
  );
}

/**
 * Files a candidate out of the pipeline, or brings them back.
 *
 * One control for both directions so its label always states what pressing it
 * does; the row it acts on is never removed by the click itself, only by the
 * view it belongs to.
 */
function ArchiveButton({
  candidate,
  pending,
  onToggle,
}: {
  candidate: CandidateRow;
  pending: boolean;
  onToggle: () => void;
}) {
  const archived = Boolean(candidate.archived_at);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      title={
        archived
          ? "Return this candidate to the pipeline"
          : "File this candidate away — the record and everything on it stays"
      }
      className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : archived ? (
        <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Archive className="h-3.5 w-3.5" aria-hidden />
      )}
      {archived ? "Restore" : "Archive"}
    </button>
  );
}

/** Forward move used by the one-click "Advance" buttons. */
const NEXT_STAGE: Record<string, PipelineStage | null> = {
  NEW: "AI_SCREENING",
  AI_SCREENING: "ASSESSMENT",
  ASSESSMENT: "INTERVIEW",
  INTERVIEW: "OFFER",
  OFFER: "HIRED",
  HIRED: null,
  REJECTED: null,
};

/**
 * Draft copy for the bulk composer. `body` is sent on whichever channel the
 * recruiter picks; `subject` only matters for email, which cannot be delivered
 * without one.
 */
const TEMPLATES = [
  {
    id: "STATUS_UPDATE",
    label: "Status update",
    subject: "Your application for {{job_title}}",
    body: "Hi {{candidate_name}}, your application for {{job_title}} is now at the {{stage}} stage. We will be in touch with the next steps.",
  },
  {
    id: "INTERVIEW_INVITE",
    label: "Interview invitation",
    subject: "Interview for {{job_title}}",
    body: "Hi {{candidate_name}}, we would like to invite you to interview for {{job_title}}. Please reply with two times that suit you this week.",
  },
  {
    id: "ASSESSMENT_REMINDER",
    label: "Assessment reminder",
    subject: "Your {{job_title}} assessment is still open",
    body: "Hi {{candidate_name}}, a reminder that your assessment for {{job_title}} is still open: {{assessment_link}}",
  },
];

function SoftSkillBars({ report }: { report: SoftSkillReport }) {
  const rows = [
    ["Emotional intelligence", report.emotional_intelligence],
    ["Communication", report.communication],
    ["Leadership potential", report.leadership_potential],
    ["Cultural fit", report.cultural_fit],
  ] as const;

  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-3">
          {/*
            Capped, not fixed: 144px of label plus the number and the gaps leaves
            a drawer on a phone with almost no bar left to read. The cap is a
            share of the row, so the meter keeps the wider half at any width.
          */}
          <span className="w-36 max-w-[45%] shrink-0 text-xs text-brand-ink/60">{label}</span>
          <Meter value={value} className="min-w-0 flex-1" />
          <span className="w-8 shrink-0 text-right text-xs font-bold">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Candidate table with working search, selection, pipeline and profile view.
 *
 * Search filters live, selection drives the broadcast, the profile drawer runs
 * AI screening and moves candidates between stages, and every row has a
 * one-click forward move for the common case.
 *
 * `focusId` is the application a deep link named, resolved to a row on the
 * server, so the profile opens by itself instead of landing on an unfiltered
 * table. `unresolvedRef` is that same link when nothing matched it.
 *
 * `gradingView` means the server loaded only the candidates whose assessment came
 * back from the grading engine without marks — the set the Bell counts. Search and
 * the three rails then filter inside that queue, and the download carries it too.
 *
 * `railStage` / `railSource` / `railCompany` are the three rails read back out of
 * the URL, and `tally` is how many applications the rails' set really holds. A
 * chip click writes the parameter and the server narrows the query, so a number
 * on a rail is the size of the stage rather than the size of whatever this page
 * loaded. `tally` is null inside the grading queue, where the rows on the page
 * *are* the set.
 */
export function CandidateBrowser({
  candidates,
  archivedView,
  gradingView,
  railStage,
  railSource,
  railCompany,
  tally,
  canWrite,
  canExport,
  exportFormats,
  focusId,
  unresolvedRef,
  timeZone,
  canGenerateQuestions,
}: {
  candidates: CandidateRow[];
  /** True when this is the archive, not the live pipeline. */
  archivedView: boolean;
  /** True when the server loaded only the ungraded-assessment queue. */
  gradingView: boolean;
  /** The stage the URL asks for, already validated against the pipeline. */
  railStage: string | null;
  /** The channel the URL asks for, already validated against the sources. */
  railSource: string | null;
  /** The company the URL asks for, already validated as an id. */
  railCompany: string | null;
  /** Counts over the set the rails filter, or null for the queue's own rows. */
  tally: CandidateTally | null;
  canWrite: boolean;
  /** `analytics.export` — the same grant the download route re-checks. */
  canExport: boolean;
  /** Passed as plain data: the export module itself is server-only. */
  exportFormats: { key: string; label: string; hint: string }[];
  focusId: string | null;
  unresolvedRef: string | null;
  /** `organisation.timezone` — the wall clock interviews are booked against. */
  timeZone: string;
  /** `ai.interview_questions` — decides whether the drawer can ask the model. */
  canGenerateQuestions: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // `?c=` arrives from the interviews agenda and `?q=` from the dashboard board:
  // open the page already showing what the recruiter was looking at.
  const trackedCode = params.get("c");
  const [query, setQuery] = useState(params.get("q") ?? trackedCode ?? "");
  const [sortBy, setSortBy] = useState<CandidateSort>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<CandidateRow | null>(
    () => candidates.find((c) => c.id === focusId) ?? null
  );
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  const [archiveNote, setArchiveNote] = useState<string | null>(null);

  // Arriving with a different focus (the assistant's link, or "Other
  // applications" inside an open drawer) re-renders this component rather than
  // remounting it, so the incoming id is applied here as well as above.
  const [lastAppliedFocus, setLastAppliedFocus] = useState(focusId);
  if (focusId && focusId !== lastAppliedFocus) {
    setLastAppliedFocus(focusId);
    setProfile(candidates.find((c) => c.id === focusId) ?? profile);
  }

  // The drawer keeps the row it was opened with; after router.refresh() the
  // fresh server data lives in `candidates`, so re-resolve by id to avoid
  // showing a stale score or stage behind the drawer.
  const liveProfile = profile
    ? candidates.find((c) => c.id === profile.id) ?? profile
    : null;

  async function quickAdvance(candidate: CandidateRow) {
    const next = NEXT_STAGE[candidate.stage];
    if (!next) return;
    setPendingAdvance(candidate.id);
    try {
      const result = await updateApplicationStage({
        applicationId: candidate.id,
        stage: next,
      });
      if (result.ok) router.refresh();
    } finally {
      setPendingAdvance(null);
    }
  }

  /**
   * Files a candidate out of the pipeline, or brings one back.
   *
   * A refusal comes back as a sentence — an open assessment link or an
   * interview still on the calendar has to be cleared first — and is shown
   * above the table instead of disappearing, because the row looks unchanged
   * either way.
   */
  async function toggleArchive(candidate: CandidateRow) {
    setPendingArchive(candidate.id);
    setArchiveNote(null);
    try {
      const result = await setCandidateArchive({
        applicationId: candidate.id,
        archived: !candidate.archived_at,
      });
      if (result.ok) router.refresh();
      else setArchiveNote(result.error ?? "That candidate could not be filed.");
    } finally {
      setPendingArchive(null);
    }
  }

  /** The two views never mix, so switching one clears the other's selection. */
  function openView(archived: boolean) {
    setSelected(new Set());
    setArchiveNote(null);
    router.push(archived ? "/candidates?archived=1" : "/candidates");
  }

  /**
   * Move a rail and let the server answer for the rows.
   *
   * The filter goes in the URL rather than in local state, so the chips, the table,
   * the attention feed's count and the download all read one query — and a link the
   * assistant hands out lands on exactly the rows a recruiter gets by clicking the
   * chip. The deep link's own focus (`?application=` / `?c=`) is dropped: a rail is
   * a question about a set, not about one candidate. All three rails are named at
   * every call so lighting one never quietly drops the other two.
   */
  function openRail(next: {
    stage: string | null;
    source: string | null;
    company: string | null;
  }) {
    const search = new URLSearchParams();
    if (gradingView) search.set("ungraded", "1");
    else if (archivedView) search.set("archived", "1");
    if (next.stage) search.set("stage", next.stage);
    if (next.source) search.set("source", next.source);
    if (next.company) search.set("company", next.company);
    const qs = search.toString();
    router.push(`/candidates${qs ? `?${qs}` : ""}`);
  }

  /**
   * Company → count, busiest first, for the third rail.
   *
   * The tally counts the whole view and is not narrowed by this rail, so its
   * numbers stay comparable while one company is lit. Inside the grading queue
   * there is no tally, and the queue's own rows are the set.
   */
  const companyCounts = useMemo(
    () => tally?.companies ?? tallyCompanies(candidates),
    [tally, candidates]
  );

  /** The lit company's name, for the empty state that has to say whose rows it looked for. */
  const railCompanyName =
    companyCounts.find((entry) => entry.id === railCompany)?.name ?? null;

  /**
   * Stage → count, for the rail.
   *
   * These are the whole set behind the view, not the rows this page loaded, so the
   * number on "New" is the number the attention feed counts and the database holds.
   */
  const stageCounts = useMemo(
    () => new Map(Object.entries(tally?.stages ?? tallyCandidates(candidates).stages)),
    [tally, candidates]
  );

  /** Source → count, busiest first, for the channel rail. */
  const sourceCounts = useMemo(() => {
    const counts = tally?.sources ?? tallyCandidates(candidates).sources;
    return [...Object.entries(counts)].sort((a, b) => b[1] - a[1]);
  }, [tally, candidates]);

  /* One predicate with the export: the file a recruiter downloads from this
   * toolbar answers the filters they are looking at, not a near-copy of them. The
   * rails have already narrowed the rows on the server, so this pass keeps the
   * search box and the sort working inside them. */
  const filtered = useMemo(
    () =>
      sortCandidates(
        filterCandidates(candidates, {
          stage: railStage,
          source: railSource,
          query,
          sort: sortBy,
        }),
        sortBy
      ),
    [candidates, query, railStage, railSource, sortBy]
  );

  /* The href carries the filters exactly as this toolbar holds them, and the
   * route re-reads the rows from the database on click — a download is never a
   * copy of whatever this page happened to load. */
  const exportQuery = new URLSearchParams({ report: "candidates", sort: sortBy });
  if (railStage) exportQuery.set("stage", railStage);
  if (railSource) exportQuery.set("source", railSource);
  if (railCompany) exportQuery.set("company", railCompany);
  if (query.trim()) exportQuery.set("q", query.trim());
  if (archivedView) exportQuery.set("archived", "1");
  if (gradingView) exportQuery.set("ungraded", "1");
  const exportHref = (format: string) =>
    `/api/reports/export?${exportQuery.toString()}&format=${format}`;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((c) => c.id)));

  if (candidates.length === 0) {
    const railed = Boolean(railStage || railSource || railCompany);
    const railWords = [
      railStage ? `stage ${railStage}` : null,
      railSource ? `channel ${railSource}` : null,
      // An id no company carries still narrows the query to nothing, so the
      // answer names where it looked without inventing a name for it.
      railCompany
        ? railCompanyName
          ? `company ${railCompanyName}`
          : "the company in the address bar"
        : null,
    ].filter((word): word is string => word !== null);
    const andList = (words: string[]) =>
      words.length <= 1
        ? words.join("")
        : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
    return (
      <Card>
        <EmptyState
          title={
            gradingView
              ? "Nothing is waiting to be graded"
              : railed
                ? "No application matches this filter"
                : archivedView
                  ? "Nothing is filed away"
                  : "No applications yet"
          }
          description={
            gradingView
              ? "Every assessment a candidate submitted has its marks. A queue appears here the moment the grading engine leaves an answer unscored — and it stays until a person or a retry closes it."
              : railed
                ? `The rails narrow the query in the database, so this is the honest answer: none of the ${tally?.total ?? 0} applications this view counts sits at ${andList(railWords)}.`
                : archivedView
                  ? "Filing a candidate takes them out of the pipeline without erasing their answers, scores or the notices they were sent. Anything filed shows up here."
                  : "New submissions appear here as soon as they arrive, newest first."
          }
        />
        {(archivedView || gradingView || railed) && (
          <div className="flex justify-center pb-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                railed && !archivedView && !gradingView
                  ? openRail({ stage: null, source: null, company: null })
                  : openView(false)
              }
            >
              {gradingView
                ? "Show the whole pipeline"
                : railed && !archivedView
                  ? "Clear the filters"
                  : "Back to the live pipeline"}
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      {unresolvedRef && (
        <div className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink/65">
          No candidate matches <span className="font-semibold">{unresolvedRef}</span>. The record
          may have been filed away, or the link may predate it.
        </div>
      )}

      {archiveNote && !liveProfile && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {archiveNote}
        </div>
      )}

      {gradingView && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-gold/45 bg-brand-gold/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-brand-ink/70">
            <span className="font-semibold text-brand-ink">Grading queue.</span> Only the
            candidates whose assessment is still sitting in Submitted — the state an attempt is
            left in when the grading engine never finished scoring it, whatever pipeline stage
            the candidate has reached since. Open a profile&rsquo;s Integrity report to see which
            answers are open and what you can do about them.
            {candidates.length >= GRADING_QUEUE_LIMIT && (
              <>
                {" "}
                This queue holds more than {GRADING_QUEUE_LIMIT} candidates, so these are the
                newest — a download of the same filters reads every one of them.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => openView(false)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
          >
            <Users className="h-3.5 w-3.5" aria-hidden />
            Show the whole pipeline
          </button>
        </div>
      )}

      {/* Toolbar — sticks below the app bar so filters stay reachable */}
      <div className="sticky top-[57px] z-20 -mx-4 mb-4 space-y-2.5 border-b border-brand-line bg-brand-ivory/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
              aria-hidden
            />
            <input
              id="candidate-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${candidateSearchWords()}`}
              aria-label="Search candidates"
              className="w-full rounded-xl border border-brand-line bg-white py-2.5 pl-10 pr-3 text-sm focus:border-brand-gold focus:outline-none"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort candidates"
            className="rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="recent">Newest first</option>
            <option value="fit">Highest AI fit</option>
            <option value="name">Name A–Z</option>
          </select>

          <span
            className="text-xs text-brand-ink/50"
            title="Rows on this page, out of the rows the query listed. The rail counts are the whole set behind it."
          >
            {filtered.length} of {candidates.length} listed
          </span>

          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          )}

          {canExport && (
            <div className="flex items-center gap-1.5" role="group" aria-label="Download this list">
              {exportFormats.map((format) => (
                <a
                  key={format.key}
                  href={exportHref(format.key)}
                  title={`${format.label}: ${format.hint}. Built from every application matching these filters.`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {format.label}
                </a>
              ))}
            </div>
          )}

          {!archivedView && (
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
              Bulk message{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          )}
        </div>

        {/* Stage rail */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
          <FilterRail
            label="All stages"
            count={tally?.total ?? candidates.length}
            active={!railStage}
            onClick={() => openRail({ stage: null, source: railSource, company: railCompany })}
          />
          {STAGES.map((s) => (
            <FilterRail
              key={s}
              label={s.replace("_", " ")}
              count={stageCounts.get(s) ?? 0}
              active={railStage === s}
              onClick={() =>
                openRail({
                  stage: railStage === s ? null : s,
                  source: railSource,
                  company: railCompany,
                })
              }
            />
          ))}

          {/* The other view's count is not loaded, so this chip states no
              number rather than inventing one. */}
          <button
            type="button"
            onClick={() => openView(!archivedView)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
          >
            {archivedView ? (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Archive className="h-3.5 w-3.5" aria-hidden />
            )}
            {archivedView ? "Live pipeline" : "Archived"}
          </button>
        </div>

        {/* Channel rail */}
        {sourceCounts.length > 1 && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
              Sourced
            </span>
            {sourceCounts.map(([source, count]) => (
              <FilterRail
                key={source}
                label={source.replace("_", " ")}
                count={count}
                tone="muted"
                active={railSource === source}
                onClick={() =>
                  openRail({
                    stage: railStage,
                    source: railSource === source ? null : source,
                    company: railCompany,
                  })
                }
              />
            ))}
          </div>
        )}

        {/* Company rail — which group the candidate's opening sits under. Counted
            over the whole view by the same tally, so lighting one company leaves
            the other chips describing the set they always described. */}
        {companyCounts.length > 1 && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
              Company
            </span>
            {companyCounts.map((entry) => (
              <FilterRail
                key={entry.id}
                label={entry.name}
                count={entry.count}
                tone="muted"
                active={railCompany === entry.id}
                onClick={() =>
                  openRail({
                    stage: railStage,
                    source: railSource,
                    company: railCompany === entry.id ? null : entry.id,
                  })
                }
              />
            ))}
          </div>
        )}

        {/* A rail counts the whole stage; this table lists the newest rows the query
            returns. When those two numbers differ the page names which one it is
            showing, instead of letting a recruiter count rows against a chip that
            promised more. */}
        {tally && tally.total > candidates.length && (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            The rail counts cover all {tally.total.toLocaleString()}{" "}
            {archivedView ? "filed" : "live"} applications. This table lists the newest{" "}
            {CANDIDATE_ROW_LIMIT} of them, so a stage can count rows that are not on the page.
            {tally.truncated &&
              ` Past the newest ${CANDIDATE_COUNT_SCAN_LIMIT.toLocaleString()} applications even the counts stop being exact.`}
          </p>
        )}

        {canExport && (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            A file is built when you click, from every application matching these filters — this
            table only lists the most recent ones, so a download can hold more rows than you can see.
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No matches"
            description={`None of the ${candidates.length.toLocaleString()} application${
              candidates.length === 1 ? "" : "s"
            } these rails leave on the page holds “${query.trim()}” in ${candidateSearchWords()}. A rail
            narrows the query in the database; this box only reads the rows already listed, so an
            application older than the newest ${CANDIDATE_ROW_LIMIT} cannot be found from here.`}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                <tr>
                  {!archivedView && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="Select all visible candidates"
                        className="h-4 w-4 rounded border-brand-line"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Applied</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">AI match</th>
                  <th className="px-4 py-3">Assessment</th>
                  <th className="px-4 py-3 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition hover:bg-brand-cream">
                    {!archivedView && (
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          aria-label={`Select ${c.full_name}`}
                          className="h-4 w-4 rounded border-brand-line"
                        />
                      </td>
                    )}
                    <td className="px-4 py-4">
                      <p className="font-semibold">{c.full_name}</p>
                      <p className="text-xs text-brand-ink/50">{c.email}</p>
                      <p className="font-mono text-[11px] text-brand-ink/40">{c.tracking_code}</p>
                    </td>
                    <td className="px-4 py-4 text-brand-ink/65">
                      <p className="max-w-56 truncate">{c.job_title ?? "—"}</p>
                      {/* Whose role it is: the company rail and the search box both
                          reach this column, so a row matched on it says so. */}
                      {c.company_name && (
                        <p className="max-w-56 truncate text-[11px] text-brand-ink/40">
                          {c.company_name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs uppercase tracking-wide text-brand-ink/55">
                      {c.source.replace("_", " ")}
                    </td>
                    <td className="px-4 py-4 text-xs text-brand-ink/55">
                      {new Date(c.created_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
                        {c.archived_at && <Badge tone="neutral">Filed</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {c.scores_masked ? (
                        <LockedScore />
                      ) : c.ai_match_score !== null ? (
                        <div className="flex w-32 items-center gap-2">
                          <span className="w-9 text-right font-display font-bold text-brand-gold-dark">
                            {c.ai_match_score}%
                          </span>
                          <Meter value={c.ai_match_score} className="flex-1" />
                        </div>
                      ) : (
                        <span className="text-xs text-brand-ink/35">Not screened</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {c.attempt_token ? (
                        <div className="flex items-center gap-2">
                          <Badge tone={attemptTone(c.attempt_status ?? "NOT_STARTED")}>
                            {(c.attempt_status ?? "NOT_STARTED").replace("_", " ")}
                          </Badge>
                          {c.attempt_score !== null && (
                            <span className="font-display text-sm font-bold">
                              {c.attempt_score}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-brand-ink/35">Not assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canWrite && NEXT_STAGE[c.stage] && (
                          <button
                            type="button"
                            onClick={() => void quickAdvance(c)}
                            disabled={pendingAdvance === c.id}
                            title={`Move to ${NEXT_STAGE[c.stage]?.replace("_", " ").toLowerCase()}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand-gold/15 px-2.5 py-1 text-xs font-semibold text-brand-gold-dark transition hover:bg-brand-gold/25 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pendingAdvance === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Advance
                          </button>
                        )}
                        {canWrite && (
                          <ArchiveButton
                            candidate={c}
                            pending={pendingArchive === c.id}
                            onToggle={() => void toggleArchive(c)}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setProfile(c)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tablet + mobile cards */}
          <ul className="divide-y divide-brand-line lg:hidden">
            {filtered.map((c) => (
              <li key={c.id} className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {!archivedView && (
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.full_name}`}
                        className="mt-1 h-4 w-4 rounded border-brand-line"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.full_name}</span>
                      <span className="block truncate text-xs text-brand-ink/55">{c.email}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
                    {c.archived_at && <Badge tone="neutral">Filed</Badge>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="truncate text-sm text-brand-ink/65">
                    {c.job_title ?? "—"}
                    {c.company_name && (
                      <span className="text-[11px] text-brand-ink/40"> · {c.company_name}</span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-wide text-brand-ink/45">
                    <span>{c.source.replace("_", " ")}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {new Date(c.created_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    {c.attempt_token && (
                      <>
                        <span aria-hidden>·</span>
                        <Badge tone={attemptTone(c.attempt_status ?? "NOT_STARTED")}>
                          {(c.attempt_status ?? "NOT_STARTED").replace("_", " ")}
                        </Badge>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-10 text-right text-sm font-display font-bold text-brand-gold-dark">
                    {c.scores_masked ? "—" : c.ai_match_score !== null ? `${c.ai_match_score}%` : "—"}
                  </span>
                  {c.scores_masked ? (
                    <span className="flex-1 text-[11px] uppercase tracking-wide text-brand-ink/35">
                      Scores hidden
                    </span>
                  ) : (
                    <Meter value={c.ai_match_score ?? 0} className="flex-1" />
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-brand-ink/40">{c.tracking_code}</span>
                  <div className="flex items-center gap-2">
                    {canWrite && NEXT_STAGE[c.stage] && (
                      <button
                        type="button"
                        onClick={() => void quickAdvance(c)}
                        disabled={pendingAdvance === c.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-gold/15 px-2.5 py-1 text-xs font-semibold text-brand-gold-dark transition hover:bg-brand-gold/25 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingAdvance === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Advance
                      </button>
                    )}
                    {canWrite && (
                      <ArchiveButton
                        candidate={c}
                        pending={pendingArchive === c.id}
                        onToggle={() => void toggleArchive(c)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setProfile(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      View profile
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Keyed by candidate, because a deep link out of "Other applications"
          repoints this drawer without unmounting it — the tab you were reading
          must not carry over onto somebody else's record. */}
      <ProfileDrawer
        key={liveProfile?.id ?? "none"}
        candidate={liveProfile}
        canWrite={canWrite}
        timeZone={timeZone}
        canGenerateQuestions={canGenerateQuestions}
        pendingArchive={pendingArchive}
        archiveNote={archiveNote}
        onArchive={(c) => void toggleArchive(c)}
        onClose={() => setProfile(null)}
      />

      <BroadcastDrawer
        open={broadcastOpen}
        recipients={candidates.filter((c) => selected.has(c.id))}
        onClose={() => setBroadcastOpen(false)}
        onSent={() => setSelected(new Set())}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** The three panels the profile drawer is split into. */
type ProfileTab = "overview" | "record" | "ai";

/**
 * One candidate across three tabs: the pipeline decisions, the record they
 * applied with, and what the AI made of it. Everything the drawer used to stack
 * into one long scroll is still rendered — only the order and the fold changed.
 */
function ProfileDrawer({
  candidate,
  canWrite,
  timeZone,
  canGenerateQuestions,
  pendingArchive,
  archiveNote,
  onArchive,
  onClose,
}: {
  candidate: CandidateRow | null;
  canWrite: boolean;
  timeZone: string;
  canGenerateQuestions: boolean;
  pendingArchive: string | null;
  archiveNote: string | null;
  onArchive: (candidate: CandidateRow) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const report = candidate?.ai_soft_skills as SoftSkillReport | null;
  const strengths = candidate?.ai_strengths ?? [];
  const gaps = candidate?.ai_gaps ?? [];

  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reasonDrafting, setReasonDrafting] = useState(false);
  const [screenPending, setScreenPending] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Bumped by a contact edit so the record on the Application tab re-reads the row. */
  const [contactRev, setContactRev] = useState(0);

  /**
   * The drawer opens on Overview. "Application" is a second read of its own, so
   * the dossier is fetched the first time that tab is opened rather than on every
   * profile someone peeks at — and every panel stays mounted once seen, so a
   * half-typed rejection reason survives a switch away and back.
   */
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [dossierSeen, setDossierSeen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);

  function selectTab(next: ProfileTab) {
    setTab(next);
    if (next === "record") setDossierSeen(true);
    // The panels differ wildly in height, so a switch starts the next one at its
    // own top rather than wherever the last one left the drawer scrolled to.
    headRef.current?.scrollIntoView({ block: "start" });
  }

  const tabs: { key: ProfileTab; label: string; icon: LucideIcon }[] = [
    { key: "overview", label: "Overview", icon: User },
    { key: "record", label: "Application", icon: FileText },
    { key: "ai", label: "AI screening", icon: Sparkles },
  ];

  async function moveTo(stage: PipelineStage) {
    if (!candidate || stage === candidate.stage) return;
    if (stage === "REJECTED") {
      setRejectOpen(true);
      return;
    }
    setPendingStage(stage);
    setError(null);
    setDone(null);
    try {
      const result = await updateApplicationStage({ applicationId: candidate.id, stage });
      if (result.ok) {
        setDone(`Moved to ${stage.replace("_", " ").toLowerCase()}.`);
        router.refresh();
      } else {
        setError(result.error ?? "Could not move the candidate.");
      }
    } catch {
      setError("Something went wrong moving the candidate.");
    } finally {
      setPendingStage(null);
    }
  }

  async function confirmReject() {
    if (!candidate) return;
    setPendingStage("REJECTED");
    setError(null);
    setDone(null);
    try {
      const result = await updateApplicationStage({
        applicationId: candidate.id,
        stage: "REJECTED",
        reason: rejectReason,
      });
      if (result.ok) {
        setRejectOpen(false);
        setRejectReason("");
        setDone(
          result.auto_feedback
            ? "Candidate rejected. A feedback draft is being written in the background."
            : "Candidate rejected. Personalised feedback is switched off in Settings, so no draft was written — use Draft feedback whenever you want one."
        );
        router.refresh();
      } else {
        setError(result.error ?? "Could not reject the candidate.");
      }
    } catch {
      setError("Something went wrong rejecting the candidate.");
    } finally {
      setPendingStage(null);
    }
  }

  /**
   * Writes the model's reason into the textarea, replacing what is there.
   *
   * Overwrite is the honest behaviour for a button labelled "draft": a partially
   * typed reason is the recruiter's own words and they are about to read the
   * machine's beside the Confirm button, not have them silently merged.
   */
  async function draftReason() {
    if (!candidate) return;
    setReasonDrafting(true);
    setError(null);
    setDone(null);
    try {
      const result = await draftRejectionReason(candidate.id);
      if (result.ok && result.reason) {
        setRejectReason(result.reason);
        setDone("Drafted from this file's evidence. Read it and edit before confirming — nothing is saved yet.");
      } else {
        setError(result.error ?? "Could not draft a reason.");
      }
    } catch {
      setError("The portal did not answer, so no reason was drafted.");
    } finally {
      setReasonDrafting(false);
    }
  }

  async function runScreen() {
    if (!candidate) return;
    setScreenPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await screenApplication(candidate.id);
      if (result.ok) {
        setDone(
          `Screened: ${result.score}% fit${result.decision ? ` — ${result.decision.toLowerCase()}` : ""}.` +
            (result.auto_stage
              ? ` The score crossed your AI thresholds, so the candidate moved to ${result.auto_stage.toLowerCase()} automatically.`
              : "")
        );
        router.refresh();
      } else {
        setError(result.error ?? "Screening failed.");
      }
    } catch {
      setError("Something went wrong running the screening.");
    } finally {
      setScreenPending(false);
    }
  }

  async function draftFeedback() {
    if (!candidate) return;
    setFeedbackPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await draftCandidateFeedback(candidate.id);
      if (result.ok) {
        setDone("Feedback draft written.");
        router.refresh();
      } else {
        setError(result.error ?? "Could not draft feedback.");
      }
    } catch {
      setError("Something went wrong drafting the feedback.");
    } finally {
      setFeedbackPending(false);
    }
  }

  async function sendFeedback() {
    if (!candidate) return;
    setSendPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await sendCandidateFeedback(candidate.id);
      if (result.ok) {
        setDone(
          `Sent to ${result.recipient} — ${result.characters} characters, exactly the text above.` +
            (result.inApp === "sent"
              ? " Copied into the candidate's portal inbox."
              : " In-app notices are switched off, so only the email went out.")
        );
        router.refresh();
      } else {
        setError(result.error ?? "Could not send the feedback.");
      }
    } catch {
      setError("Something went wrong sending the feedback.");
    } finally {
      setSendPending(false);
    }
  }

  return (
    <Drawer
      open={candidate !== null}
      onClose={onClose}
      width="max-w-lg"
      eyebrow={candidate?.tracking_code}
      title={candidate?.full_name ?? ""}
      subtitle={candidate?.email}
    >
      {candidate && (
        <div className="space-y-5">
          <div ref={headRef} className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(candidate.stage)}>{candidate.stage.replace("_", " ")}</Badge>
            {candidate.archived_at && <Badge tone="neutral">Filed away</Badge>}
            {candidate.job_title && <Badge tone="neutral">{candidate.job_title}</Badge>}
            {candidate.phone && <Badge tone="neutral">{candidate.phone}</Badge>}
            {candidate.attempt_token && (
              <IntegrityPanel
                key={`integrity-${candidate.id}`}
                accessToken={candidate.attempt_token}
                candidateName={candidate.full_name}
              />
            )}
            <InterviewPanel
              key={`interviews-${candidate.id}`}
              applicationId={candidate.id}
              candidateName={candidate.full_name}
              jobTitle={candidate.job_title}
              initialInterviews={candidate.interviews}
              canWrite={canWrite}
              timeZone={timeZone}
              canGenerateQuestions={canGenerateQuestions}
            />
          </div>

          {/* Integrity and interviews each open a full-screen report of their own,
              so they stay on the identity row rather than behind a tab that would
              hold nothing but the trigger. */}
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Candidate profile sections"
          >
            {tabs.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                id={`profile-tab-${option.key}`}
                aria-selected={tab === option.key}
                aria-controls={`profile-panel-${option.key}`}
                onClick={() => selectTab(option.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                  tab === option.key
                    ? "bg-brand-ink text-brand-cream shadow-soft"
                    : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>

          {/* One message slot outside the panels, so the answer to a stage move or
              a screen run is read wherever the recruiter happens to be looking. */}
          <FormMessage error={error} success={done} />

          <section
            role="tabpanel"
            id="profile-panel-overview"
            aria-labelledby="profile-tab-overview"
            className={cn("space-y-5", tab !== "overview" && "hidden")}
          >
            {canWrite && (
              <ContactSection
                key={`contact-${candidate.id}`}
                candidate={candidate}
                onSaved={() => setContactRev((n) => n + 1)}
              />
            )}

            {canWrite && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold">Pipeline</h3>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((stage) => {
                    const active = candidate.stage === stage;
                    const isReject = stage === "REJECTED";
                    const blocked = active || pendingStage !== null;
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
                        {pendingStage === stage && (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        )}
                        {stage.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>

                {rejectOpen && (
                  <div className="mt-3 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
                    <label htmlFor="reject-reason" className="block text-xs font-bold text-rose-900">
                      Rejection reason
                    </label>
                    <p className="text-[11px] leading-relaxed text-rose-900/70">
                      For the file: this note shows on the candidate profile and in the reports export.
                      The letter the candidate receives is written from Settings → Notifications and
                      does not use it.
                    </p>
                    <TextArea
                      id="reject-reason"
                      rows={3}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Why is this candidate not moving forward?"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void confirmReject()}
                        disabled={pendingStage !== null}
                        className="bg-rose-600 text-brand-on-accent hover:bg-rose-700"
                      >
                        {pendingStage === "REJECTED" && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        )}
                        Confirm rejection
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void draftReason()}
                        disabled={reasonDrafting || pendingStage !== null}
                      >
                        {reasonDrafting && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        )}
                        {!reasonDrafting && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                        Draft from file
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRejectOpen(false);
                          setRejectReason("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {canWrite && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold">Filing</h3>
                <p className="mb-2.5 text-xs leading-relaxed text-brand-ink/55">
                  {candidate.archived_at
                    ? "Filed away: out of the pipeline, the dashboard and the job’s applicant list, with nothing deleted. Restore returns the record exactly where it was."
                    : "Filing takes this candidate out of the pipeline, the dashboard and the job’s applicant list without erasing anything — their answers, scores and the notices they were sent all stay on the record."}
                </p>
                {candidate.archived_at && (
                  <p className="mb-2.5 text-xs text-brand-ink/45">
                    Filed on{" "}
                    {new Date(candidate.archived_at).toLocaleDateString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    .
                  </p>
                )}
                {archiveNote && (
                  <p
                    role="alert"
                    className="mb-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    {archiveNote}
                  </p>
                )}
                <ArchiveButton
                  candidate={candidate}
                  pending={pendingArchive === candidate.id}
                  onToggle={() => onArchive(candidate)}
                />
                {!candidate.archived_at && (
                  <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/40">
                    An open assessment link or an interview still on the calendar is cleared first —
                    the button says which one is holding the record in place.
                  </p>
                )}
              </section>
            )}

            {candidate.rejection_reason && (
              <section>
                <h3 className="mb-1.5 font-display text-sm font-bold">Rejection reason</h3>
                <p className="text-sm leading-relaxed text-rose-700">{candidate.rejection_reason}</p>
              </section>
            )}
          </section>

          <section
            role="tabpanel"
            id="profile-panel-record"
            aria-labelledby="profile-tab-record"
            className={cn(tab !== "record" && "hidden")}
          >
            {dossierSeen && (
              <CandidateDossier
                key={`dossier-${candidate.id}`}
                applicationId={candidate.id}
                reloadKey={contactRev}
              />
            )}
          </section>

          <section
            role="tabpanel"
            id="profile-panel-ai"
            aria-labelledby="profile-tab-ai"
            className={cn("space-y-5", tab !== "ai" && "hidden")}
          >
            <section>
              <h3 className="mb-2 font-display text-sm font-bold">AI screening</h3>
              {candidate.scores_masked ? (
                <p className="text-sm text-brand-ink/45">
                  Scores are hidden for your role. Ask an administrator for the
                  &ldquo;View unmasked scores&rdquo; permission, or switch
                  &ldquo;Mask scores for interviewers&rdquo; off in Settings.
                </p>
              ) : candidate.ai_match_score !== null ? (
                <div className="flex items-center gap-3">
                  <span className="w-12 text-right font-display text-2xl font-extrabold text-brand-gold-dark">
                    {candidate.ai_match_score}%
                  </span>
                  <Meter value={candidate.ai_match_score} className="flex-1" />
                </div>
              ) : (
                <p className="text-sm text-brand-ink/45">
                  This candidate has not been screened yet.
                </p>
              )}
              {candidate.ai_screening_summary && (
                <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">
                  {candidate.ai_screening_summary}
                </p>
              )}
              {/* Recorded by the screen itself, so it reports the bias-reduction
                  setting as it stood when this score was produced. */}
              {candidate.screened &&
                candidate.diversity_flags?.cv_anonymization && (
                  <p className="mt-2 text-xs text-brand-ink/45">
                    {candidate.diversity_flags.cv_anonymization === "applied"
                      ? "Demographic markers were stripped from the CV before the model scored it."
                      : "Bias reduction was switched off for this screen — the model saw the CV as submitted."}
                  </p>
                )}

              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void runScreen()}
                    disabled={screenPending || pendingStage !== null}
                  >
                    {screenPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {candidate.screened ? "Re-screen" : "Screen with AI"}
                  </Button>
                  {candidate.screened && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void draftFeedback()}
                      disabled={feedbackPending}
                    >
                      {feedbackPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      )}
                      {candidate.ai_feedback ? "Redraft feedback" : "Draft feedback"}
                    </Button>
                  )}
                </div>
              )}
            </section>

            {(strengths.length > 0 || gaps.length > 0) && (
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {strengths.length > 0 && (
                  <div className="rounded-xl bg-brand-cream p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Strengths
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-brand-ink/70">
                      {strengths.map((s) => (
                        <li key={s}>• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {gaps.length > 0 && (
                  <div className="rounded-xl bg-brand-cream p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Gaps
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-brand-ink/70">
                      {gaps.map((g) => (
                        <li key={g}>• {g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {report && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold">Soft skills</h3>
                <SoftSkillBars report={report} />
                {report.summary && (
                  <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">{report.summary}</p>
                )}
              </section>
            )}

            {candidate.ai_feedback && (
              <section>
                <h3 className="mb-1.5 font-display text-sm font-bold">Candidate feedback</h3>
                <p className="text-sm leading-relaxed text-brand-ink/65">{candidate.ai_feedback}</p>
                {canWrite && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void sendFeedback()}
                      disabled={sendPending || feedbackPending}
                    >
                      {sendPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Email this to the candidate
                    </Button>
                    <p className="mt-1.5 text-xs text-brand-ink/45">
                      {candidate.email
                        ? `Goes to ${candidate.email} as written above, under the subject “Feedback on your application — ${candidate.job_title ?? "the role"}”. WhatsApp is not used for this letter.`
                        : "This candidate has no email address on the record, so there is nowhere to send it."}
                    </p>
                  </div>
                )}
              </section>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The three columns every outbound message is addressed to. The caller keys
 * this by candidate id, so half-typed text in one profile never leaks into the
 * next one opened, and renders it only for someone who can write.
 */
function ContactSection({
  candidate,
  onSaved,
}: {
  candidate: CandidateRow;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(candidate.full_name);
  const [email, setEmail] = useState(candidate.email);
  const [phone, setPhone] = useState(candidate.phone ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function startEdit() {
    setFullName(candidate.full_name);
    setEmail(candidate.email);
    setPhone(candidate.phone ?? "");
    setError(null);
    setSaved(null);
    setEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setEditing(false);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await updateCandidateContact({
        applicationId: candidate.id,
        fullName,
        email,
        phone,
      });
      if (!result.ok || !result.contact) {
        // A refused write keeps the form and its text on screen, so the reason
        // reads against what was typed instead of forcing a retype from memory.
        setError(result.error ?? "Could not save the contact details.");
        return;
      }
      setSaved(
        `Saved: ${result.contact.full_name} · ${result.contact.email}` +
          (result.contact.phone ? ` · ${result.contact.phone}` : "")
      );
      setEditing(false);
      onSaved();
      router.refresh();
    } catch {
      setError("Something went wrong saving the contact details.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3">
        {saved ? (
          <p role="status" className="text-xs font-semibold text-emerald-800">
            {saved}
          </p>
        ) : (
          <p className="text-xs text-brand-ink/50">
            Every notice, email and WhatsApp to this candidate goes to these details.
          </p>
        )}
        <Button variant="outline" size="sm" onClick={startEdit}>
          Edit contact details
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-brand-line bg-white p-3.5">
      <h3 className="font-display text-sm font-bold">Contact details</h3>

      <Field label="Full name" htmlFor="contact-name" required>
        <TextInput
          id="contact-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Email" htmlFor="contact-email" required hint="Stored lowercase, like the apply form writes it.">
        <TextInput
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Phone" htmlFor="contact-phone" hint="Leave empty when the candidate has no number on file.">
        <TextInput
          id="contact-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
        />
      </Field>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={cancelEdit} disabled={pending}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

type BroadcastChannel = "WHATSAPP" | "EMAIL" | "BOTH";

const CHANNEL_CHOICES: { id: BroadcastChannel; label: string; blurb: string }[] = [
  { id: "WHATSAPP", label: "WhatsApp", blurb: "Chat message to the number on file." },
  { id: "EMAIL", label: "Email", blurb: "Letter through the SMTP relay in Settings → API keys." },
  { id: "BOTH", label: "Both", blurb: "Each candidate gets whichever of the two they have." },
];

function BroadcastDrawer({
  open,
  recipients,
  onClose,
  onSent,
}: {
  open: boolean;
  recipients: CandidateRow[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [body, setBody] = useState(TEMPLATES[0].body);
  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [channel, setChannel] = useState<BroadcastChannel>("WHATSAPP");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const needsSubject = channel !== "WHATSAPP";
  const withoutEmail = recipients.filter((r) => !r.email).length;
  const withoutPhone = recipients.filter((r) => !r.phone).length;

  function pickTemplate(id: string) {
    const found = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
    setTemplate(found.id);
    setBody(found.body);
    setSubject(found.subject);
    if (error) setError(null);
  }

  async function send() {
    if (recipients.length === 0) {
      setError("Select at least one candidate first.");
      return;
    }
    if (!body.trim()) {
      setError("The message cannot be empty.");
      return;
    }
    if (needsSubject && !subject.trim()) {
      setError("Email needs a subject line.");
      return;
    }

    setPending(true);
    setError(null);
    setDone(null);
    const ids = recipients.map((r) => r.id);
    const delivered: string[] = [];
    let problem: string | null = null;

    try {
      if (channel !== "EMAIL") {
        const whatsapp = await sendBulkWhatsApp({
          applicationIds: ids,
          templateKey: template,
          message: body,
        });
        if (whatsapp.ok) delivered.push(`WhatsApp queued for ${whatsapp.queued ?? 0}`);
        else problem = whatsapp.error ?? "Could not send the WhatsApp batch.";
      }

      if (channel !== "WHATSAPP") {
        const email = await sendBulkEmail({
          applicationIds: ids,
          subject,
          message: body,
        });
        if (email.ok) {
          delivered.push(
            `email delivered to ${email.sent ?? 0}${email.failed ? `, rejected for ${email.failed}` : ""}`
          );
        } else {
          problem = [problem, email.error].filter(Boolean).join(" ");
        }
      }

      if (delivered.length > 0) {
        setDone(`Sent — ${delivered.join(" and ")}.`);
        setTimeout(() => {
          setDone(null);
          onSent();
          onClose();
        }, 2600);
      } else {
        setError(problem ?? "Nothing was sent.");
        setPending(false);
        return;
      }
    } catch {
      setError("Something went wrong sending the broadcast.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Messaging"
      title="Bulk message"
      subtitle={`${recipients.length} recipient${recipients.length === 1 ? "" : "s"} selected`}
      onSubmit={send}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={`Send to ${recipients.length}`}
          pending={pending}
          note="Placeholders are filled per candidate."
        />
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
            Channel
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHANNEL_CHOICES.map((choice) => (
              <label
                key={choice.id}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${
                  channel === choice.id
                    ? "border-brand-gold bg-brand-gold/10 font-semibold"
                    : "border-brand-line bg-white hover:bg-brand-cream"
                }`}
              >
                <input
                  type="radio"
                  name="broadcast-channel"
                  value={choice.id}
                  checked={channel === choice.id}
                  onChange={() => setChannel(choice.id)}
                  className="sr-only"
                />
                {choice.label}
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-brand-ink/55">
                  {choice.blurb}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Template" htmlFor="wa-template">
          <Select id="wa-template" value={template} onChange={(e) => pickTemplate(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        {needsSubject && (
          <Field
            label="Subject"
            htmlFor="bulk-subject"
            required
            hint="{{job_title}} and {{candidate_name}} are replaced per recipient."
          >
            <TextInput id="bulk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}

        <Field
          label="Message"
          htmlFor="wa-body"
          required
          hint="{{candidate_name}}, {{job_title}}, {{stage}} and {{assessment_link}} are replaced per recipient."
        >
          <TextArea id="wa-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <div className="rounded-xl bg-brand-cream p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Recipients
          </p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-sm text-brand-ink/70">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{r.full_name}</span>
                {channel !== "EMAIL" && !r.phone && (
                  <span className="shrink-0 text-[11px] text-rose-600">no number</span>
                )}
                {channel !== "WHATSAPP" && !r.email && (
                  <span className="shrink-0 text-[11px] text-rose-600">no email</span>
                )}
              </li>
            ))}
          </ul>
          {(withoutEmail > 0 || withoutPhone > 0) && channel === "BOTH" && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
              {withoutPhone > 0 && `${withoutPhone} without a number `}
              {withoutPhone > 0 && withoutEmail > 0 && "and "}
              {withoutEmail > 0 && `${withoutEmail} without an email `}
              will be skipped on that channel.
            </p>
          )}
          {channel !== "WHATSAPP" && recipients.length > 40 && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
              Email is handed to the relay one message at a time, so this batch will take a minute or
              two. Gmail accounts also cap out near 500 recipients a day.
            </p>
          )}
        </div>

        <FormMessage error={error} success={done} />
      </div>
    </Drawer>
  );
}