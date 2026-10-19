"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, GripVertical, Loader2 } from "lucide-react";
import { Badge, Card, Meter } from "@/modules/analytics/presentation/ui";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { navForward } from "@/modules/shell/domain/navTransition";
import { PIPELINE_STAGES as STAGES } from "@/modules/candidates/domain/listFilters";
import { updateApplicationStage, type PipelineStage } from "./candidate-actions";
import { RejectReasonForm } from "./RejectReasonForm";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import type { CandidateRow } from "./actions";
import { cn } from "@/lib/utils";

function attemptTone(status: string) {
  if (status === "GRADED") return "success" as const;
  if (status === "EXPIRED") return "danger" as const;
  if (status === "SUBMITTED") return "info" as const;
  if (status === "IN_PROGRESS") return "gold" as const;
  return "neutral" as const;
}

const humanize = (stage: string) => stage.replace("_", " ").toLowerCase();

/**
 * One card per application, in the column for the stage it is actually at.
 *
 * A card is a `CandidateRow` — the same object the table draws — and the columns
 * are built from the rows the page was given, so a move only changes the picture
 * when the server has re-read the record. There is no local stage to flip: a
 * board that drew the destination before the write answered would show a
 * pipeline the database does not hold, and a failed write would leave a card in
 * the wrong column with nothing on screen to say so.
 */
function BoardCard({
  candidate,
  canWrite,
  canSelect,
  selected,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onSelect,
  onOpen,
}: {
  candidate: CandidateRow;
  canWrite: boolean;
  /** The pipeline offers bulk messaging; the archive does not, so its cards carry no box. */
  canSelect: boolean;
  selected: boolean;
  busy: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stage: PipelineStage) => void;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      draggable={canWrite}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", candidate.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "space-y-2 rounded-xl border border-brand-line bg-white p-3 shadow-soft transition",
        canWrite && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        busy && "opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-2">
          {canSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              aria-label={`Select ${candidate.full_name} for a bulk message`}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-brand-line"
            />
          )}
          <Link
            href={`/candidates/${candidate.id}`}
            transitionTypes={navForward}
            className="min-w-0 truncate text-sm font-semibold hover:text-brand-gold-dark hover:underline"
            title={`${candidate.full_name}'s profile — everything filed about them, on any opening`}
          >
            {candidate.full_name}
          </Link>
        </span>
        {canWrite && <GripVertical className="h-4 w-4 shrink-0 text-brand-ink/25" aria-hidden />}
      </div>

      <p className="truncate text-xs text-brand-ink/60" title={candidate.job_title ?? undefined}>
        {candidate.job_title ?? "—"}
        {candidate.company_name && (
          <span className="text-[11px] text-brand-ink/40"> · {candidate.company_name}</span>
        )}
      </p>

      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 text-right text-[11px] font-display font-bold text-brand-gold-dark">
          {candidate.scores_masked
            ? "—"
            : candidate.ai_match_score !== null
              ? `${candidate.ai_match_score}%`
              : "—"}
        </span>
        {candidate.scores_masked ? (
          <span className="flex-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
            Scores hidden
          </span>
        ) : candidate.ai_match_score !== null ? (
          <Meter value={candidate.ai_match_score} className="min-w-0 flex-1" />
        ) : (
          <span className="flex-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
            Not screened
          </span>
        )}
        {candidate.attempt_token && (
          <Badge tone={attemptTone(candidate.attempt_status ?? "NOT_STARTED")}>
            {(candidate.attempt_status ?? "NOT_STARTED").replace("_", " ")}
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-brand-ink/40">{candidate.tracking_code}</span>
        <div className="flex items-center gap-1.5">
          {canWrite && (
            <label className="contents">
              <span className="sr-only">Move {candidate.full_name} to another pipeline stage</span>
              <select
                value=""
                disabled={busy}
                onChange={(event) => {
                  const stage = event.target.value as PipelineStage;
                  if (stage) onMove(stage);
                }}
                className="rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-ink/65 focus:border-brand-gold focus:outline-none disabled:opacity-60"
              >
                <option value="">Move to…</option>
                {STAGES.filter((stage) => stage !== candidate.stage).map((stage) => (
                  <option key={stage} value={stage}>
                    {humanize(stage)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold-dark" aria-hidden />}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold transition hover:bg-brand-sand"
          >
            <FileText className="h-3 w-3" aria-hidden />
            Desk
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * The pipeline as columns, with the stage write the table already performs.
 *
 * Two ways to move a candidate, one action behind both: a drop and the card's
 * "Move to…" control call `updateApplicationStage`, the same server action the
 * table's Advance button and the profile drawer's stage buttons call, so the
 * trail entry, the rejection reason rule, the `hired_at` stamp and the
 * notification dispatch are identical whichever door a recruiter used.
 *
 * The drop never writes a stage directly. REJECTED is refused by the action
 * without a reason, so dropping there opens the reason step instead and the
 * candidate stays in their column until it is confirmed — cancelling changes
 * nothing at all.
 *
 * Without `candidates.write` the board is still a picture of the pipeline, but
 * the cards stop dragging and the move control disappears, because the action
 * would refuse every attempt and a control that always answers "no" is not a
 * control.
 */
export function CandidateBoard({
  rows,
  canWrite,
  canSelect,
  selected,
  stageCounts,
  onToggleSelect,
  onOpenProfile,
}: {
  rows: CandidateRow[];
  canWrite: boolean;
  /** Whether the bulk-message selection is offered here (never in the archive). */
  canSelect: boolean;
  selected: Set<string>;
  /** How many applications the rails' set holds per stage, or null when these rows are the set. */
  stageCounts: Map<string, number> | null;
  onToggleSelect: (id: string) => void;
  onOpenProfile: (candidate: CandidateRow) => void;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CandidateRow | null>(null);

  async function moveTo(candidate: CandidateRow, stage: PipelineStage) {
    if (!canWrite || stage === candidate.stage) return;
    if (stage === "REJECTED") {
      setRejecting(candidate);
      return;
    }
    setPending(candidate.id);
    setError(null);
    setDone(null);
    try {
      const result = await updateApplicationStage({ applicationId: candidate.id, stage });
      if (result.ok) {
        setDone(`${candidate.full_name} moved to ${humanize(stage)}.`);
        router.refresh();
      } else {
        setError(result.error ?? `${candidate.full_name} did not move.`);
      }
    } catch {
      setError("The portal did not answer, so nobody moved.");
    } finally {
      setPending(null);
    }
  }

  function drop(stage: PipelineStage) {
    setOver(null);
    if (pending) return;
    // The id is read from the drag payload and resolved against the rows the
    // server last sent, so a card that has already moved on a re-read cannot be
    // dragged by a stale copy of itself.
    const id = dragging;
    setDragging(null);
    if (!id) return;
    const candidate = rows.find((row) => row.id === id);
    if (candidate) void moveTo(candidate, stage);
  }

  return (
    <Card className="p-4">
      <FormMessage error={error} success={done} />

      <div
        className="flex gap-3 overflow-x-auto pb-2"
        tabIndex={0}
        aria-label="Pipeline board. Scroll sideways to see every stage."
      >
        {STAGES.map((stage) => {
          const cards = rows.filter((row) => row.stage === stage);
          const total = stageCounts?.get(stage);
          return (
            <section
              key={stage}
              onDragOver={
                canWrite
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setOver(stage);
                    }
                  : undefined
              }
              onDragLeave={() => setOver((current) => (current === stage ? null : current))}
              onDrop={
                canWrite
                  ? (event) => {
                      event.preventDefault();
                      drop(stage);
                    }
                  : undefined
              }
              className={cn(
                "flex w-[280px] shrink-0 flex-col gap-2 rounded-2xl border p-2.5 transition",
                over === stage
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-brand-line bg-brand-cream/60"
              )}
            >
              <header className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/55">
                  {humanize(stage)}
                </h3>
                <span
                  className="text-[11px] font-semibold text-brand-ink/45"
                  title={
                    total !== undefined && total !== cards.length
                      ? `${cards.length} listed here, ${total} in this stage across the filters`
                      : undefined
                  }
                >
                  {cards.length}
                  {total !== undefined && total !== cards.length ? ` / ${total}` : ""}
                </span>
              </header>

              {cards.length === 0 ? (
                <p className="rounded-xl border border-dashed border-brand-line px-3 py-6 text-center text-[11px] leading-relaxed text-brand-ink/40">
                  {canWrite ? "Drop a card here to move it." : "Nothing listed in this stage."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {cards.map((candidate) => (
                    <li key={candidate.id}>
                      <BoardCard
                        candidate={candidate}
                        canWrite={canWrite}
                        canSelect={canSelect}
                        selected={selected.has(candidate.id)}
                        busy={pending === candidate.id}
                        dragging={dragging === candidate.id}
                        onDragStart={() => setDragging(candidate.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onMove={(next) => void moveTo(candidate, next)}
                        onSelect={() => onToggleSelect(candidate.id)}
                        onOpen={() => onOpenProfile(candidate)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {rejecting && (
        <Drawer
          open
          onClose={() => setRejecting(null)}
          eyebrow="Reject"
          title={rejecting.full_name}
          subtitle={`Filed against ${rejecting.job_title ?? "an opening"} — the reason goes on the record, not in the letter.`}
        >
          <RejectReasonForm
            candidate={rejecting}
            onCancel={() => setRejecting(null)}
            onMoved={(autoFeedback) => {
              setRejecting(null);
              setDone(
                autoFeedback
                  ? `${rejecting.full_name} rejected. A feedback draft is being written in the background.`
                  : `${rejecting.full_name} rejected. Personalised feedback is switched off in Settings, so no draft was written.`
              );
              router.refresh();
            }}
          />
        </Drawer>
      )}
    </Card>
  );
}
