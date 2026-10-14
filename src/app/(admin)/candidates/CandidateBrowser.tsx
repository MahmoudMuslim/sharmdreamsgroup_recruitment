"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, FileText, Loader2, Lock, Search, Send, Sparkles, X } from "lucide-react";
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
  draftCandidateFeedback,
  screenApplication,
  sendBulkEmail,
  sendBulkWhatsApp,
  updateApplicationStage,
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

const STAGES = ["NEW", "AI_SCREENING", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];

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
          <span className="w-36 shrink-0 text-xs text-brand-ink/60">{label}</span>
          <Meter value={value} className="flex-1" />
          <span className="w-8 text-right text-xs font-bold">{value}</span>
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
 */
export function CandidateBrowser({
  candidates,
  canWrite,
  focusId,
  unresolvedRef,
  timeZone,
  canGenerateQuestions,
}: {
  candidates: CandidateRow[];
  canWrite: boolean;
  focusId: string | null;
  unresolvedRef: string | null;
  /** `organisation.timezone` — the wall clock interviews are booked against. */
  timeZone: string;
  /** `ai.interview_questions` — decides whether the drawer can ask the model. */
  canGenerateQuestions: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // `?c=` arrives from the interviews agenda and `?q=`/`?stage=` from the
  // dashboard board: open the page already filtered to what the recruiter
  // was looking at.
  const trackedCode = params.get("c");
  const [query, setQuery] = useState(params.get("q") ?? trackedCode ?? "");
  const [stageFilter, setStageFilter] = useState(params.get("stage") ?? "");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "fit" | "name">("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<CandidateRow | null>(
    () => candidates.find((c) => c.id === focusId) ?? null
  );
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null);

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

  /** Stage → count, for the rail. Computed over the unfiltered list. */
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
    return counts;
  }, [candidates]);

  /** Source → count, busiest first, for the channel rail. */
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [candidates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = candidates.filter((c) => {
      if (stageFilter && c.stage !== stageFilter) return false;
      if (sourceFilter && c.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.job_title ?? "").toLowerCase().includes(q) ||
        c.tracking_code.toLowerCase().includes(q)
      );
    });
    // The server returns newest first, so "recent" needs no re-sort.
    if (sortBy === "fit") {
      rows.sort((a, b) => (b.ai_match_score ?? -1) - (a.ai_match_score ?? -1));
    } else if (sortBy === "name") {
      rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
    }
    return rows;
  }, [candidates, query, stageFilter, sourceFilter, sortBy]);

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
    return (
      <Card>
        <EmptyState
          title="No applications yet"
          description="New submissions appear here as soon as they arrive, newest first."
        />
      </Card>
    );
  }

  return (
    <>
      {unresolvedRef && (
        <div className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink/65">
          No candidate matches <span className="font-semibold">{unresolvedRef}</span>. The record
          may have been deleted, or the link may predate it.
        </div>
      )}

      {/* Toolbar — sticks below the mobile header so filters stay reachable */}
      <div className="sticky top-[57px] z-20 -mx-4 mb-4 space-y-2.5 border-b border-brand-line bg-brand-ivory/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10">
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
              placeholder="Search name, email, role or tracking code"
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

          <span className="text-xs text-brand-ink/50">
            {filtered.length} of {candidates.length}
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

          <button
            type="button"
            onClick={() => setBroadcastOpen(true)}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden />
            Bulk message{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>

        {/* Stage rail */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
          <FilterRail
            label="All stages"
            count={candidates.length}
            active={stageFilter === ""}
            onClick={() => setStageFilter("")}
          />
          {STAGES.map((s) => (
            <FilterRail
              key={s}
              label={s.replace("_", " ")}
              count={stageCounts.get(s) ?? 0}
              active={stageFilter === s}
              onClick={() => setStageFilter(stageFilter === s ? "" : s)}
            />
          ))}
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
                active={sourceFilter === source}
                onClick={() => setSourceFilter(sourceFilter === source ? "" : source)}
              />
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No matches"
            description="Adjust the search or stage filter to see candidates again."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      aria-label="Select all visible candidates"
                      className="h-4 w-4 rounded border-brand-line"
                    />
                  </th>
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
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.full_name}`}
                        className="h-4 w-4 rounded border-brand-line"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold">{c.full_name}</p>
                      <p className="text-xs text-brand-ink/50">{c.email}</p>
                      <p className="font-mono text-[11px] text-brand-ink/40">{c.tracking_code}</p>
                    </td>
                    <td className="px-4 py-4 text-brand-ink/65">{c.job_title ?? "—"}</td>
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
                      <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
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
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.full_name}`}
                      className="mt-1 h-4 w-4 rounded border-brand-line"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.full_name}</span>
                      <span className="block truncate text-xs text-brand-ink/55">{c.email}</span>
                    </span>
                  </label>
                  <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
                </div>

                <div className="space-y-1.5">
                  <p className="truncate text-sm text-brand-ink/65">{c.job_title ?? "—"}</p>
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

      <ProfileDrawer
        candidate={liveProfile}
        canWrite={canWrite}
        timeZone={timeZone}
        canGenerateQuestions={canGenerateQuestions}
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

function ProfileDrawer({
  candidate,
  canWrite,
  timeZone,
  canGenerateQuestions,
  onClose,
}: {
  candidate: CandidateRow | null;
  canWrite: boolean;
  timeZone: string;
  canGenerateQuestions: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const report = candidate?.ai_soft_skills as SoftSkillReport | null;
  const strengths = candidate?.ai_strengths ?? [];
  const gaps = candidate?.ai_gaps ?? [];

  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [screenPending, setScreenPending] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(candidate.stage)}>{candidate.stage.replace("_", " ")}</Badge>
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
                  <TextArea
                    id="reject-reason"
                    rows={2}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why is this candidate not moving forward?"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void confirmReject()}
                      disabled={pendingStage !== null}
                      className="bg-rose-600 text-white hover:bg-rose-700"
                    >
                      {pendingStage === "REJECTED" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      )}
                      Confirm rejection
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

          <CandidateDossier key={`dossier-${candidate.id}`} applicationId={candidate.id} />

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

            <FormMessage error={error} success={done} />
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
            </section>
          )}

          {candidate.rejection_reason && (
            <section>
              <h3 className="mb-1.5 font-display text-sm font-bold">Rejection reason</h3>
              <p className="text-sm leading-relaxed text-rose-700">{candidate.rejection_reason}</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
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