"use client";

import { useState } from "react";
import { Loader2, NotebookPen } from "lucide-react";
import { Button } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, Select, TextArea } from "@/modules/analytics/presentation/Form";
import { formatInZone } from "@/lib/timezone";
import {
  SCORECARD_CRITERIA,
  SCORECARD_FEEDBACK_LIMIT,
  averageLabel,
  panelAverage,
  scorecardAverage,
  type InterviewScorecard,
  type ScorecardCriterion,
} from "@/modules/interviews/domain/interviewScorecard";
import { saveInterviewScorecard } from "./scorecard-actions";

const RATING_OPTIONS = [
  { value: "1", label: "1 — weak" },
  { value: "2", label: "2 — below the bar" },
  { value: "3", label: "3 — meets the bar" },
  { value: "4", label: "4 — strong" },
  { value: "5", label: "5 — exceptional" },
] as const;

type Marks = Record<ScorecardCriterion, string>;

const EMPTY_MARKS: Marks = {
  technical: "",
  communication: "",
  problemSolving: "",
  culture: "",
};

function ratingLine(card: InterviewScorecard): string {
  return SCORECARD_CRITERIA.map(
    (criterion) => `${criterion.label} ${card[criterion.key]}`
  ).join(" · ");
}

/**
 * One panel's opinions, and the form for adding the signed-in interviewer's own.
 *
 * A scorecard is evidence about the interview, so every staff member reads them
 * — a hiring manager should know what the technical interviewer thought before
 * deciding. Editing is narrower: the action and the RLS policy both bind a row
 * to its author, which is why the button says "your scorecard" and never
 * "edit" for someone else's row.
 *
 * The four marks start blank rather than at 3. A prefilled middle would be
 * saved by anyone in a hurry, and the panel's record would then hold a judgement
 * nobody made.
 */
export function ScorecardDesk({
  interviewId,
  viewerId,
  cards,
  timeZone,
  onSaved,
}: {
  interviewId: string;
  viewerId: string;
  cards: InterviewScorecard[];
  timeZone: string;
  /** Re-reads the agenda and this panel's cards after a save. */
  onSaved: () => Promise<void>;
}) {
  const mine = cards.find((card) => card.authorProfileId === viewerId) ?? null;
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Marks>(EMPTY_MARKS);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const average = panelAverage(cards);
  const ready = SCORECARD_CRITERIA.every((criterion) => marks[criterion.key] !== "");

  function start() {
    setError(null);
    setNotice(null);
    setMarks(
      mine
        ? {
            technical: String(mine.technical),
            communication: String(mine.communication),
            problemSolving: String(mine.problemSolving),
            culture: String(mine.culture),
          }
        : EMPTY_MARKS
    );
    setFeedback(mine?.feedback ?? "");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setMarks(EMPTY_MARKS);
    setFeedback("");
  }

  async function save() {
    if (!ready) {
      setError("Pick a mark for all four criteria.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveInterviewScorecard({
        interviewId,
        technical: Number(marks.technical),
        communication: Number(marks.communication),
        problemSolving: Number(marks.problemSolving),
        culture: Number(marks.culture),
        feedback,
      });
      if (!result.ok) {
        setError(result.error ?? "The scorecard was not saved.");
        return;
      }
      setNotice(mine ? "Your scorecard was updated." : "Your scorecard was saved.");
      close();
      await onSaved();
    } catch {
      setError("The portal did not answer, so the scorecard is unchanged.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 border-t border-brand-line/70 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.12em] text-brand-ink/50">
          <NotebookPen className="h-3.5 w-3.5" aria-hidden />
          Scorecards
        </span>
        <span className="text-xs text-brand-ink/55">
          {cards.length === 0
            ? "Not scored yet."
            : `${cards.length} on record · panel average ${averageLabel(average)}`}
        </span>
        <Button
          size="sm"
          variant={open ? "ghost" : "outline"}
          disabled={pending}
          onClick={() => (open ? close() : start())}
          className="ml-auto"
          title={
            mine
              ? "Your scorecard is the only one you can change."
              : "Add your own opinion. Every staff member's marks are kept separately."
          }
        >
          {open ? "Close" : mine ? "Edit your scorecard" : "Add a scorecard"}
        </Button>
      </div>

      <FormMessage error={error} success={notice} />

      {open && (
        <form
          className="mt-3 rounded-xl border border-brand-line bg-brand-cream/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {SCORECARD_CRITERIA.map((criterion) => {
              const id = `score-${criterion.key}-${interviewId}`;
              return (
                <Field key={criterion.key} label={criterion.label} htmlFor={id} required>
                  <Select
                    id={id}
                    value={marks[criterion.key]}
                    onChange={(event) =>
                      setMarks((current) => ({ ...current, [criterion.key]: event.target.value }))
                    }
                  >
                    <option value="">Pick 1 to 5</option>
                    {RATING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            })}
          </div>
          <Field
            label="What you thought"
            htmlFor={`score-feedback-${interviewId}`}
            className="mt-3"
            hint={`Optional, up to ${SCORECARD_FEEDBACK_LIMIT.toLocaleString()} characters. Every staff member can read it; only you can edit it.`}
          >
            <TextArea
              id={`score-feedback-${interviewId}`}
              rows={3}
              maxLength={SCORECARD_FEEDBACK_LIMIT}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="What convinced you, what worried you, what to probe in the next round…"
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-brand-ink/45">
              Only you can change this scorecard. The candidate is never shown it.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={pending || !ready}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {mine ? "Save changes" : "Save scorecard"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {cards.length > 0 && (
        <ul className="mt-3 space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="rounded-lg border border-brand-line bg-white px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">
                  {card.authorProfileId === viewerId
                    ? "You"
                    : (card.authorName ?? "A former staff member")}
                </span>
                <span className="rounded-md bg-brand-gold/15 px-1.5 py-0.5 text-[11px] font-bold text-brand-gold-dark">
                  {averageLabel(scorecardAverage(card))} / 5
                </span>
                <span className="ml-auto text-[11px] text-brand-ink/40">
                  {formatInZone(card.updatedAt, timeZone, { dateStyle: "medium" })}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-brand-ink/55">{ratingLine(card)}</p>
              {card.feedback && (
                <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-brand-ink/70">
                  {card.feedback}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
