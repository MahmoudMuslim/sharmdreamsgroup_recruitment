"use client";

import { useEffect, useState } from "react";
import { GripVertical, Loader2, Pencil, Plus } from "lucide-react";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { Badge, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import {
  KIND_LABELS,
  bankPlaceScope,
  type BankColumn,
  type BankQuestion,
  type BankStore,
} from "@/modules/questions/bank";
import type { BankEntry, BankWrites } from "./bankView";

/**
 * How long the card that just landed keeps its settle animation's class.
 *
 * The same window the pipeline board pays for: the animation is 620ms in
 * globals.css and the rest is the gap between the class being applied and the
 * frame that starts it.
 */
const SETTLE_MS = 900;

/** How long a written move stays worth flashing before the board forgets it. */
const ARM_GIVE_UP_MS = 10_000;

/** What a card's keyboard alternative is called, since the two stores differ. */
function dropVerb(store: BankStore): string {
  return store === "gate" ? "Move to" : "Copy into";
}

function BankCard({
  question,
  entry,
  canWrite,
  store,
  others,
  busy,
  dragging,
  settled,
  writes,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  question: BankQuestion;
  entry: BankEntry | undefined;
  canWrite: boolean;
  store: BankStore;
  /** The other columns a card could be written to from here. */
  others: readonly BankColumn[];
  busy: boolean;
  dragging: boolean;
  settled: boolean;
  writes: BankWrites;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (columnKey: string) => void;
}) {
  return (
    <article
      draggable={canWrite}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", question.key);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "min-w-0 space-y-2 rounded-xl border border-brand-line bg-white p-3 shadow-soft transition",
        canWrite && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        busy && "opacity-70",
        settled && "card-settle",
        !question.isLive && "border-dashed"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug">
          {question.text}
        </p>
        {canWrite && <GripVertical className="h-4 w-4 shrink-0 text-brand-ink/25" aria-hidden />}
      </div>

      {question.guidance && (
        <p className="line-clamp-2 break-words text-[11px] leading-relaxed text-brand-ink/55">
          {question.guidance}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className="max-w-full">{KIND_LABELS[question.kind]}</Badge>
        {question.points !== null && <Badge>{question.points} marks</Badge>}
        {question.isLive ? (
          <Badge tone="success">Asked</Badge>
        ) : (
          <Badge tone="danger">Not asked now</Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {canWrite && others.length > 0 ? (
          <label className="contents">
            <span className="sr-only">
              {dropVerb(store)} “{question.text}” to another {store === "gate" ? "role" : "suite"}
            </span>
            {/* `min-w-0 flex-1` is what keeps the card inside its column. A select
                sizes itself to its widest option, and the options here are job and
                suite titles a recruiter wrote — one long name used to push the row
                past the card's border and over the column beside it. The dropdown
                still shows every title in full. */}
            <select
              value=""
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                if (next) onDrop(next);
              }}
              className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-ink/65 focus:border-brand-gold focus:outline-none disabled:opacity-60"
            >
              <option value="">{dropVerb(store)}…</option>
              {others.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="min-w-0 flex-1 break-words text-[11px] text-brand-ink/35">
            {canWrite ? "Nowhere else to drop it" : "Read only"}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold-dark" aria-hidden />}
          <button
            type="button"
            onClick={() => {
              if (!entry) return;
              if (entry.store === "gate") writes.editGate(entry.row);
              else writes.editSuite(entry.row);
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold transition hover:bg-brand-sand disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            Edit
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * The bank as columns, one store's places at a time.
 *
 * A drop means something different in each half, and the column says which. An
 * apply-form question's place is a column on its own row, so dropping it is a
 * move — it stops being asked where it was. A test question's place is its suite,
 * and re-pointing that would pull the question out of the paper of every candidate
 * who already sat it, so dropping one *copies* it and leaves the original where it
 * was. Nothing here pretends the two are the same gesture.
 *
 * A drop never writes through local state: the card changes column only when the
 * page has re-read the row from the database, so a refused write leaves the board
 * showing exactly what the portal still holds.
 */
export function BankColumns({
  store,
  columns,
  entries,
  writes,
  onAdd,
}: {
  store: BankStore;
  columns: readonly BankColumn[];
  entries: ReadonlyMap<string, BankEntry>;
  writes: BankWrites;
  /** Add a question into this column's place. */
  onAdd: (scopeKey: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** A move that has been written but not yet drawn by the server's re-read. */
  const [armed, setArmed] = useState<{ key: string; columnKey: string } | null>(null);

  const canWrite = store === "gate" ? writes.can.form : writes.can.suites;

  // The flash is paid for by the data, not by the pointer. A move is only on
  // screen when the row arrives in the column it was written to — and a copy has
  // no card to arm, because the row that lands is a new one the write cannot name.
  const settledKey =
    armed &&
    store === "gate" &&
    (columns.find((column) => column.key === armed.columnKey)?.rows.some(
      (question) => question.key === armed.key
    ) ??
      false)
      ? armed.key
      : null;

  useEffect(() => {
    if (!settledKey) return;
    const timer = window.setTimeout(() => setArmed(null), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settledKey]);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARM_GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  function findCard(key: string): BankQuestion | null {
    for (const column of columns) {
      const found = column.rows.find((question) => question.key === key);
      if (found) return found;
    }
    return null;
  }

  async function write(question: BankQuestion, column: BankColumn) {
    if (question.scopeKey === bankPlaceScope(column.key) && store === "gate") return;
    setPending(question.key);
    setError(null);
    setDone(null);
    const outcome = await writes.relocate(question, column.key);
    setPending(null);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setDone(outcome.message);
    setArmed({ key: question.key, columnKey: column.key });
  }

  function drop(column: BankColumn) {
    setOver(null);
    if (pending || !column.acceptsDrop) return;
    const key = dragging;
    setDragging(null);
    if (!key) return;
    // Resolved against the columns the server last drew, so a card that has
    // already moved on a re-read cannot be dropped by a stale copy of itself.
    const question = findCard(key);
    if (question) void write(question, column);
  }

  return (
    <Card className="p-4">
      <FormMessage error={error} success={done} />

      <div
        className="board-cols flex gap-3 overflow-x-auto pb-2"
        tabIndex={0}
        aria-label={`Question bank board. Scroll sideways to see every ${store === "gate" ? "role" : "suite"}.`}
      >
        {columns.map((column) => {
          const others = columns.filter(
            (other) => other.key !== column.key && other.acceptsDrop
          );
          const scopeKey = bankPlaceScope(column.key);

          return (
            <section
              key={column.key}
              onDragOver={
                column.acceptsDrop
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setOver(column.key);
                    }
                  : undefined
              }
              onDragLeave={() => setOver((current) => (current === column.key ? null : current))}
              onDrop={
                column.acceptsDrop
                  ? (event) => {
                      event.preventDefault();
                      drop(column);
                    }
                  : undefined
              }
              className={cn(
                "board-in flex w-[280px] shrink-0 flex-col gap-2 rounded-2xl border p-2.5 transition",
                over === column.key
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-brand-line bg-brand-cream/60"
              )}
            >
              <header className="space-y-1 px-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-brand-ink/55">
                    {column.label}
                  </h3>
                  <span className="shrink-0 text-[11px] font-semibold text-brand-ink/45">
                    {column.rows.length}
                  </span>
                </div>
                <p className="text-[10px] uppercase tracking-wide text-brand-ink/35">
                  {column.state}
                </p>
                <p
                  className="break-words text-[11px] leading-relaxed text-brand-ink/45"
                  title={column.refuse ? `${column.note} ${column.refuse}` : column.note}
                >
                  {column.refuse ?? column.note}
                </p>
                {column.acceptsDrop && (
                  <button
                    type="button"
                    onClick={() => onAdd(scopeKey)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-ink/60 underline transition hover:text-brand-ink"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    Add a question
                  </button>
                )}
              </header>

              {column.rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-brand-line px-3 py-6 text-center text-[11px] leading-relaxed text-brand-ink/40">
                  {column.acceptsDrop
                    ? store === "gate"
                      ? "Drop a card here to ask it on this role."
                      : "Drop a card here to copy it into this suite."
                    : "Nothing asked here."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {column.rows.map((question) => (
                    <li key={question.key}>
                      <BankCard
                        question={question}
                        entry={entries.get(question.key)}
                        canWrite={canWrite}
                        store={store}
                        others={others}
                        busy={pending === question.key}
                        dragging={dragging === question.key}
                        settled={settledKey === question.key}
                        writes={writes}
                        onDragStart={() => setDragging(question.key)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onDrop={(nextKey) => {
                          const target = columns.find((other) => other.key === nextKey);
                          if (target) void write(question, target);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
