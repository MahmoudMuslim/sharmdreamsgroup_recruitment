"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Download,
  FileText,
  LayoutGrid,
  Loader2,
  Search,
  Send,
  Table,
  Users,
  X,
} from "lucide-react";
import { navForward } from "@/modules/shell/domain/navTransition";
import { signalNavigationPending } from "@/modules/shell/presentation/NavigationPending";
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
import { setCandidateArchive, updateApplicationStage } from "./candidate-actions";
import type { CandidateRow } from "./actions";
import { CandidateBoard } from "./CandidateBoard";
import { ArchiveButton, LockedScore, NEXT_STAGE, attemptTone, stageTone } from "./CandidateBrowserBits";
import { BroadcastDrawer } from "./BroadcastDrawer";
import { ProfileDrawer } from "./ProfileDrawer";
import { cn } from "@/lib/utils";

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
  /**
   * Which surface the rails' rows are drawn on, read from the URL like the rails
   * themselves, so the assistant, the Guide and a bookmarked address all land on
   * the board or the table the link names rather than always the table.
   */
  const boardView = params.get("view") === "board";
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

  /**
   * Ask the server for the same page under a different query.
   *
   * A rail, a view or the board/table switch is a real read — the rows change, not
   * just the address — and because no anchor is involved the shell's own click
   * listener cannot see it. So the wait is announced here, the one place that
   * knows a push is about to happen.
   */
  function pushScreen(href: string) {
    signalNavigationPending();
    router.push(href);
  }

  /**
   * Table or board — the same rails, the same rows, a different drawing.
   *
   * Kept in the URL rather than local state so a link can name the surface the
   * way it names a stage, and so switching views never looks like a filter to the
   * server: the query behind both is byte for byte the same.
   */
  function setSurface(board: boolean) {
    const search = new URLSearchParams();
    if (gradingView) search.set("ungraded", "1");
    else if (archivedView) search.set("archived", "1");
    if (railStage) search.set("stage", railStage);
    if (railSource) search.set("source", railSource);
    if (railCompany) search.set("company", railCompany);
    if (board) search.set("view", "board");
    const qs = search.toString();
    pushScreen(`/candidates${qs ? `?${qs}` : ""}`);
  }

  /** The two views never mix, so switching one clears the other's selection. */
  function openView(archived: boolean) {
    setSelected(new Set());
    setArchiveNote(null);
    if (archived) pushScreen(boardView ? "/candidates?archived=1&view=board" : "/candidates?archived=1");
    else pushScreen(boardView ? "/candidates?view=board" : "/candidates");
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
    if (boardView) search.set("view", "board");
    const qs = search.toString();
    pushScreen(`/candidates${qs ? `?${qs}` : ""}`);
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

          {/* Which surface the rails' rows are drawn on. Both read the same query
              and the same stage write, so this changes only the drawing. */}
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Choose how the list is drawn"
          >
            {[
              { board: false, label: "Table", icon: Table },
              { board: true, label: "Board", icon: LayoutGrid },
            ].map((surface) => (
              <button
                key={surface.label}
                type="button"
                onClick={() => setSurface(surface.board)}
                aria-pressed={boardView === surface.board}
                title={
                  surface.board
                    ? "Show the pipeline as columns you can drag a candidate between"
                    : "Show the pipeline as a list"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition",
                  boardView === surface.board
                    ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                    : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand"
                )}
              >
                <surface.icon className="h-3.5 w-3.5" aria-hidden />
                {surface.label}
              </button>
            ))}
          </div>

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
            {archivedView ? "filed" : "live"} applications. This {boardView ? "board" : "table"}{" "}
            lists the newest {CANDIDATE_ROW_LIMIT} of them, so a stage can count rows that are not
            on the page.
            {tally.truncated &&
              ` Past the newest ${CANDIDATE_COUNT_SCAN_LIMIT.toLocaleString()} applications even the counts stop being exact.`}
          </p>
        )}

        {canExport && (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            A file is built when you click, from every application matching these filters — this{" "}
            {boardView ? "board" : "table"} only lists the most recent ones, so a download can hold
            more rows than you can see.
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
      ) : boardView ? (
        <>
          <p className="mb-3 text-[11px] leading-relaxed text-brand-ink/50">
            {canWrite
              ? "Drag a card into another column, or use Move to… on the card — both run the same stage write the table’s Advance button and the profile’s stage buttons run, so the change trail, the candidate’s notice and the hired-on stamp are identical whichever door was used. A card changes column only once the page has re-read the record, so the board shows the stage the database holds rather than where a drop last landed. Rejected asks for a reason first: cancelling that step leaves the candidate exactly where they were."
              : "The pipeline as columns. Moving a candidate needs the Edit candidates permission, so these cards do not drag and carry no move control."}
          </p>
          <CandidateBoard
            rows={filtered}
            canWrite={canWrite}
            canSelect={!archivedView}
            selected={selected}
            stageCounts={tally ? stageCounts : null}
            onToggleSelect={toggle}
            onOpenProfile={setProfile}
          />
        </>
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
                  <th className="px-4 py-3 text-right">Desk</th>
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
                      <Link
                        href={`/candidates/${c.id}`}
                        transitionTypes={navForward}
                        className="font-semibold hover:text-brand-gold-dark hover:underline"
                        title={`${c.full_name}'s profile — everything filed about them, on any opening`}
                      >
                        {c.full_name}
                      </Link>
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
                      <Link
                        href={`/candidates/${c.id}`}
                        transitionTypes={navForward}
                        className="block truncate font-semibold hover:text-brand-gold-dark hover:underline"
                        title={`${c.full_name}'s profile — everything filed about them, on any opening`}
                      >
                        {c.full_name}
                      </Link>
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
                      Desk
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
