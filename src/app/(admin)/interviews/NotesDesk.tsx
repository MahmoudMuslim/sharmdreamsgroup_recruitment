"use client";

import { useState } from "react";
import { Loader2, ScrollText } from "lucide-react";
import { Button } from "@/modules/analytics/presentation/ui";
import { FormMessage, TextArea } from "@/modules/analytics/presentation/Form";
import { formatInZone } from "@/lib/timezone";
import {
  NOTES_BODY_LIMIT,
  type InterviewNote,
} from "@/modules/interviews/domain/interviewNotes";
import { saveInterviewNotes } from "./notes-actions";

/** How much of the draft is left, in the words the box prints under itself. */
function roomLabel(body: string): string {
  const left = NOTES_BODY_LIMIT - body.trim().length;
  return left === 0
    ? `At the ${NOTES_BODY_LIMIT.toLocaleString()}-character limit.`
    : `${left.toLocaleString()} of ${NOTES_BODY_LIMIT.toLocaleString()} characters left.`;
}

/**
 * What the interviewers wrote down about one panel, and the box to add your own.
 *
 * Every staff member reads them; only the author can change theirs. That split is
 * the whole point of the row's key — the panel and the person — so two interviewers
 * on one panel leave two accounts instead of overwriting each other, and a hiring
 * manager can see that the technical interviewer was unsure before they were.
 *
 * The candidate never sees this. A scorecard is a rating of them; this is what
 * happened in the room, including the parts that never reached a rating.
 *
 * Saving a blank box removes your note rather than refusing it. An interviewer who
 * reads back what they typed and decides it should not stand leaves an empty record,
 * and the trail says who cleared it.
 */
export function NotesDesk({
  interviewId,
  viewerId,
  notes,
  timeZone,
  canWrite,
  onSaved,
}: {
  interviewId: string;
  viewerId: string;
  /** Every interviewer's notes on this panel, oldest first. */
  notes: InterviewNote[];
  timeZone: string;
  /** False once a panel is beside the point: its notes stay readable, not editable. */
  canWrite: boolean;
  /** Re-reads the agenda and this panel's notes after a save. */
  onSaved: () => Promise<void>;
}) {
  const mine = notes.find((note) => note.authorProfileId === viewerId) ?? null;
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A blank box on a note that exists is a removal, so the button says which of the
  // two it is about to do rather than leaving it to a hint below.
  const removing = Boolean(mine) && body.trim().length === 0;

  function start() {
    setError(null);
    setNotice(null);
    setBody(mine?.body ?? "");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setBody("");
  }

  async function save() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveInterviewNotes({ interviewId, body });
      if (!result.ok) {
        setError(result.error ?? "The notes were not saved.");
        return;
      }
      setNotice(
        removing
          ? "Your notes were removed from this panel."
          : mine
            ? "Your notes were updated."
            : "Your notes were saved."
      );
      close();
      try {
        await onSaved();
      } catch {
        // The write already landed; saying it did not would invite a second save.
        setError("Your notes were saved, but the calendar did not refresh. Reload to see them.");
      }
    } catch {
      setError("The portal did not answer, so the notes are unchanged.");
    } finally {
      setPending(false);
    }
  }

  if (!canWrite && notes.length === 0) return null;

  return (
    <div className="mt-3 border-t border-brand-line/70 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.12em] text-brand-ink/50">
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          Notes
        </span>
        <span className="text-xs text-brand-ink/55">
          {notes.length === 0
            ? "Nothing written down yet."
            : `${notes.length} on record${mine ? " · yours is one of them" : ""}`}
        </span>
        {canWrite && (
          <Button
            size="sm"
            variant={open ? "ghost" : "outline"}
            disabled={pending}
            onClick={() => (open ? close() : start())}
            className="ml-auto"
            title={
              mine
                ? "Your notes are the only ones you can change."
                : "Add your own account of the panel. Every interviewer's notes are kept separately."
            }
          >
            {open ? "Close" : mine ? "Edit my notes" : "Add my notes"}
          </Button>
        )}
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
          <TextArea
            id={`notes-${interviewId}`}
            rows={5}
            maxLength={NOTES_BODY_LIMIT}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What they said, what you asked, what you would probe in the next round…"
            aria-label="Your notes on this panel"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-brand-ink/45">
              {roomLabel(body)} Only you can change this; every staff member can read it, and the
              candidate never sees it.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
                Discard
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || (mine === null && body.trim().length === 0)}
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {removing ? "Remove these notes" : "Save notes"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li
              key={`${note.interviewId}|${note.authorProfileId}`}
              className="rounded-lg border border-brand-line bg-white px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">
                  {note.authorProfileId === viewerId
                    ? "You"
                    : (note.authorName ?? "A former staff member")}
                </span>
                <span className="ml-auto text-[11px] text-brand-ink/40">
                  {formatInZone(note.updatedAt, timeZone, { dateStyle: "medium" })}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-brand-ink/70">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
