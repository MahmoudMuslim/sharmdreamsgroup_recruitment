"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import { FormMessage, Select } from "@/modules/analytics/presentation/Form";
import { Badge, Button } from "@/modules/analytics/presentation/ui";
import type { BankWrites, BankEntry } from "./bankView";
import {
  KIND_LABELS,
  SHARED_SCOPE,
  bankCrossStoreReason,
  bankPermissionWords,
  bankTargetsFor,
  type BankQuestion,
  type BankStore,
  type BankTarget,
} from "@/modules/questions/bank";

/**
 * One question in the bank's list: what it asks, where it is asked, and every
 * control the store that holds it actually answers to.
 *
 * A form row and a suite row are drawn by the same component because the bank
 * promises one list of questions, not two tables bolted together — but the two
 * halves are not the same set of buttons. A form question is switched off rather
 * than deleted, and reordered by the arrows that swap `position` with the
 * neighbour the form asks next. A test question has neither control here: its
 * order belongs to the paper, and its delete is refused once a candidate has
 * answered it, so both live inside the suite's own editor, which this row opens.
 */

/** A target picker keyed the way the URL and the scope filter key a place. */
function targetKeyOf(target: BankTarget): string {
  return `${target.store}:${target.placeKey}`;
}

/** Why a store holds no destination for this question, in the recruiter's words. */
function absenceWords(
  question: BankQuestion,
  store: BankStore,
  permitted: boolean
): string | null {
  if (!permitted) return bankPermissionWords(store);
  if (store === question.store) {
    return store === "gate"
      ? "Every published role already asks this question, or there is another open role to ask it on."
      : "No other test suite is switched on to copy it into.";
  }
  return bankCrossStoreReason(question, store);
}

export function BankRow({
  entry,
  order,
  isFirst,
  isLast,
  canReorder,
  writes,
}: {
  entry: BankEntry;
  order: number;
  isFirst: boolean;
  isLast: boolean;
  /** Whether this view holds the group complete, so a swap means what it says. */
  canReorder: boolean;
  writes: BankWrites;
}) {
  const { question } = entry;
  const gateRow = entry.store === "gate" ? entry.row : null;
  const suiteRow = entry.store === "suite" ? entry.row : null;

  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);

  /**
   * Targets the recruiter behind this console may actually use.
   *
   * A destination this person has no permission for is not offered at all: a
   * picker that lists a role and then refuses the write is a control that lies
   * about what the account can do.
   */
  const targets = useMemo(
    () =>
      bankTargetsFor(question, writes.places.jobs, writes.places.suites).filter((target) =>
        target.store === "gate" ? writes.can.form : writes.can.suites
      ),
    [question, writes.places, writes.can]
  );

  const selected = targets[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const target = targets.find((item) => targetKeyOf(item) === chosen) ?? selected;

  /**
   * Why each half of the portal holds nowhere to put this question.
   *
   * The picker can only show destinations, so the recruiter who sees two options
   * out of nine is owed the reason the rest are missing. Printed whether or not
   * the panel is open.
   */
  const blocked = useMemo(() => {
    const absent = (["gate", "suite"] as const).filter(
      (store) => !targets.some((item) => item.store === store)
    );
    if (absent.length === 0) return null;
    const words = absent
      .map((store) =>
        absenceWords(question, store, store === "gate" ? writes.can.form : writes.can.suites)
      )
      .filter(Boolean)
      .join(" ");
    return words || null;
  }, [question, targets, writes.can]);

  const busy = writes.pending;

  /** One Edit button, two editors — each question is rewritten where it is stored. */
  function edit() {
    if (gateRow) writes.editGate(gateRow);
    else if (suiteRow) writes.editSuite(suiteRow);
  }

  function toggle() {
    setLocalError(null);
    setLanded(null);
    setOpen((current) => !current);
  }

  async function copy() {
    if (!target) return;
    const outcome = await writes.copy(question, target);
    setLocalError(outcome.ok ? null : outcome.message);
    setLanded(outcome.ok ? outcome.message : null);
    if (outcome.ok) setOpen(false);
  }

  const held = canReorder
    ? undefined
    : "Held while the bank is filtered or grouped another way — a move swaps with the question the form asks next in its own scope, which this view may be hiding.";

  // The best-rated response, so a judgment scene reads at a glance the way the
  // review desk prints it. Everything else in the bank is a key, not a scale.
  const bestScore =
    question.kind === "judgment"
      ? question.answers.reduce<number | null>(
          (top, answer) =>
            answer.score === null ? top : Math.max(top ?? 0, answer.score),
          null
        )
      : null;

  return (
    <div
      className={`rounded-2xl border border-brand-line bg-white p-4 shadow-soft transition sm:p-5 ${
        gateRow && !gateRow.isActive ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-sand text-xs font-bold text-brand-ink/60"
          title={
            question.store === "gate"
              ? `Number ${order} in the order this form asks it`
              : `Question ${order} of the paper`
          }
        >
          {order}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={question.store === "gate" ? "gold" : "info"}>
              {question.store === "gate" ? "Apply form" : "Test suite"}
            </Badge>
            <Badge>{KIND_LABELS[question.kind]}</Badge>
            {question.points !== null && <Badge>{question.points} marks</Badge>}
            {question.isLive ? (
              <Badge tone="success">Asked right now</Badge>
            ) : (
              <Badge tone="danger">Nothing asks it now</Badge>
            )}
            {gateRow && !gateRow.isActive && <Badge tone="neutral">Switched off</Badge>}
          </div>

          <p className="mt-2.5 text-sm font-semibold leading-snug">{question.text}</p>
          {question.guidance && (
            <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">{question.guidance}</p>
          )}

          {question.answers.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {question.answers.map((answer, index) => {
                const strongest = bestScore !== null && answer.score === bestScore;
                return (
                  <li
                    key={`${index}-${answer.text}`}
                    className={
                      answer.accepted || strongest
                        ? "rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"
                        : "rounded-lg border border-brand-line bg-brand-sand px-2 py-1 text-[11px] text-brand-ink/60"
                    }
                  >
                    {answer.text}
                    <span className="ml-1.5 font-normal opacity-70">
                      {question.kind === "judgment"
                        ? answer.score === null
                          ? "not scored"
                          : strongest
                            ? `${answer.score}% — strongest response`
                            : `${answer.score}% effective`
                        : question.store === "gate"
                          ? answer.accepted
                            ? "keeps them in the running"
                            : "rules them out"
                          : answer.accepted
                            ? "right answer"
                            : "wrong"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {question.kind === "judgment" && question.answers.length > 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/45">
              Each response earns its percentage of the marks; none is simply right or wrong.
            </p>
          )}

          <p className="mt-2.5 text-[11px] text-brand-ink/45">
            Asked on <span className="font-semibold text-brand-ink/65">{question.where}</span>
            {question.store === "gate" && question.scopeKey === SHARED_SCOPE
              ? " — the same question every published role asks"
              : ""}
            {suiteRow ? " — open the suite to change its order or marks" : ""}.
          </p>
        </div>

        {gateRow && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => writes.move(gateRow, "up")}
              disabled={busy || !canReorder || isFirst}
              aria-label={`Move “${question.text}” up`}
              title={held ?? "Move this question up the form, past the one asked before it"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => writes.move(gateRow, "down")}
              disabled={busy || !canReorder || isLast}
              aria-label={`Move “${question.text}” down`}
              title={held ?? "Move this question down the form, past the one asked after it"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={edit}
            disabled={busy}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Button>
          {gateRow && (
            <Button variant="ghost" size="sm" onClick={() => writes.toggleActive(gateRow)} disabled={busy}>
              {gateRow.isActive ? "Stop asking" : "Ask again"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => writes.remove(question)} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
          <Button
            variant={targets.length === 0 ? "ghost" : "outline"}
            size="sm"
            onClick={toggle}
            aria-expanded={open}
            disabled={busy || (targets.length === 0 && !blocked)}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {targets.length === 0 ? "No place to copy it" : "Use it here"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 rounded-2xl border border-brand-line bg-brand-sand/60 p-4">
          {targets.length === 0 ? (
            <p className="text-xs leading-relaxed text-brand-ink/65">
              {blocked ??
                "There is no other role, shared scope or suite for this question to be copied onto."}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label
                  htmlFor={`bank-copy-${question.key}`}
                  className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                >
                  Copy it onto
                </label>
                <Select
                  id={`bank-copy-${question.key}`}
                  value={target ? targetKeyOf(target) : ""}
                  onChange={(event) => setChosen(event.target.value)}
                  className="mt-1.5"
                >
                  {targets.map((item) => (
                    <option key={targetKeyOf(item)} value={targetKeyOf(item)}>
                      {item.store === "gate" ? "Apply form" : "Test suite"} · {item.label}
                    </option>
                  ))}
                </Select>
                {target && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/55">
                    {target.note}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggle} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={copy} disabled={busy || !target}>
                  {busy ? "Copying…" : "Copy the question"}
                </Button>
              </div>
            </div>
          )}

          {blocked && targets.length > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/50">{blocked}</p>
          )}

          <FormMessage error={localError} success={landed} />
        </div>
      )}
    </div>
  );
}
