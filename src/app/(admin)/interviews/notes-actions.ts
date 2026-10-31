"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { formatInZone } from "@/lib/timezone";
import { recordActivity } from "@/modules/activity/application/record";
import {
  NOTES_WRITE_REFUSAL,
  appendInterviewGuide,
  clipNoteBody,
  noteWriteRefusal,
  readNoteBody,
  type GuideQuestionInput,
  type InterviewNotesLayer,
} from "@/modules/interviews/domain/interviewNotes";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { readInterviewNotesLayer } from "@/modules/interviews/infrastructure/notesReader";

/**
 * What an interviewer wrote down, behind the same staff door as the agenda.
 *
 * Writing a note needs no permission beyond a staff session, for the reason the
 * scorecard desk was built the same way: the person who sat the panel is often a
 * hiring manager with no `candidates.write` grant, and their account of the hour is
 * the thing this exists to keep. What the action does enforce is authorship — the
 * writer is the session's profile, never a value sent by the browser, on the insert
 * and again on the two scoping filters of the update and the delete. The RLS policy
 * repeats the check, which is a second wall rather than the reason this one is safe.
 *
 * A blank clears the row instead of refusing, and clearing is on the record: an
 * interviewer who reads back what they typed and decides it should not stand leaves
 * an empty note and a trail line saying so.
 */

export interface NotesMutation {
  ok: boolean;
  error?: string;
  /** The panel's slot when the write found one — the chat's link picks its range from it. */
  scheduledAt?: string;
}

/** What one panel's notes read found, with the panel itself settled first. */
export interface PanelNotesRead {
  /** False only when the schedule query answered and held no such row. */
  found: boolean;
  /** The panel read's own failure: a failed read proves nothing about existence. */
  error: string | null;
  status: string | null;
  scheduledAt: string | null;
  /** The signed-in reader, so the chat can mark the note they may change. */
  viewerId: string;
  layer: InterviewNotesLayer;
}

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

/**
 * One panel's notes for the chat, which has only an id to go on.
 *
 * The agenda already knows its rows exist, so `readInterviewNotesLayer` never had to
 * tell a missing panel from a quiet one. The chat does: an id typed or remembered
 * wrongly would come back as "nobody wrote notes" — a claim about a panel that is not
 * there. The existence probe lives here rather than in the shared reader so the page
 * pays no extra query per view for an answer only the chat asks.
 *
 * A failed schedule read is reported as a failure, not as a missing panel: the same
 * rule the scorecard layer follows, because a query that did not answer proves
 * nothing about which rows exist.
 */
export async function getInterviewNotesForPanel(interviewId: string): Promise<PanelNotesRead> {
  const user = await requireStaff("/interviews");
  const restClient = await createServerRestClient();

  const [panel, layer] = await Promise.all([
    restClient
      .from("interview_schedules")
      .select("id, status, scheduled_at")
      .eq("id", interviewId)
      .maybeSingle(),
    readInterviewNotesLayer(restClient, [interviewId]),
  ]);

  const record = (panel.data ?? null) as Record<string, unknown> | null;
  return {
    found: record !== null,
    error: panel.error ? (panel.error.message ?? "the database did not answer") : null,
    status: record?.status == null ? null : String(record.status),
    scheduledAt: record?.scheduled_at == null ? null : String(record.scheduled_at),
    viewerId: user.profileId,
    layer,
  };
}

/** Every interviewer's notes on the panels the agenda is about to draw. */
export async function getInterviewNotesLayer(
  interviewIds: readonly string[]
): Promise<InterviewNotesLayer> {
  await requireStaff("/interviews");
  const restClient = await createServerRestClient();
  return readInterviewNotesLayer(restClient, interviewIds);
}

/**
 * Saves the signed-in interviewer's own note on one panel.
 *
 * The read before the write is not the race protection — two tabs can both find
 * nothing and both insert, and the primary key answers the second with 23505, which
 * is reported as "you already have notes there" rather than as a database error.
 * It is there so an update is an update and the trail can say which of the two
 * happened.
 *
 * The panel must not be CANCELLED or a NO_SHOW: nothing was said at a conversation
 * that did not happen, and a note on one would read as a record that it did.
 */
export async function saveInterviewNotes(input: {
  interviewId: string;
  body: unknown;
}): Promise<NotesMutation> {
  const user = await requireStaff("/interviews");

  const note = readNoteBody(input.body);
  if (!note.ok) return { ok: false, error: note.error };

  const restClient = await createServerRestClient();
  const { data: interview } = await restClient
    .from("interview_schedules")
    .select("id, application_id, status, scheduled_at, applications(full_name)")
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!interview) return { ok: false, error: "That panel no longer exists." };
  const refusal = noteWriteRefusal(interview.status);
  if (refusal) return { ok: false, error: refusal };

  const { data: existing, error: readError } = await restClient
    .from("interview_notes")
    .select("body")
    .eq("interview_id", input.interviewId)
    .eq("author_profile_id", user.profileId)
    .maybeSingle();

  if (readError) {
    return {
      ok: false,
      error: isMissingSchemaError(readError)
        ? NOTES_WRITE_REFUSAL
        : `The notes could not be read: ${readError.message}`,
    };
  }

  const cleared = note.body === null;
  let action: "cleared" | "updated" | "wrote" = "wrote";
  const slot = interview.scheduled_at ? String(interview.scheduled_at) : undefined;

  if (cleared) {
    if (!existing) return { ok: true, scheduledAt: slot };
    const { error } = await restClient
      .from("interview_notes")
      .delete()
      .eq("interview_id", input.interviewId)
      .eq("author_profile_id", user.profileId);
    if (error) {
      return {
        ok: false,
        error: isMissingSchemaError(error) ? NOTES_WRITE_REFUSAL : error.message,
      };
    }
    action = "cleared";
  } else if (existing) {
    const { error } = await restClient
      .from("interview_notes")
      .update({ body: note.body })
      .eq("interview_id", input.interviewId)
      .eq("author_profile_id", user.profileId);
    if (error) {
      return {
        ok: false,
        error: isMissingSchemaError(error) ? NOTES_WRITE_REFUSAL : error.message,
      };
    }
    action = "updated";
  } else {
    const { error } = await restClient
      .from("interview_notes")
      .insert({ interview_id: input.interviewId, author_profile_id: user.profileId, body: note.body });
    if (error) {
      if (isMissingSchemaError(error)) return { ok: false, error: NOTES_WRITE_REFUSAL };
      if (error.code === "23505") {
        return {
          ok: false,
          error: "You already have notes on this panel. Reopen them to change your words.",
        };
      }
      return { ok: false, error: error.message };
    }
  }

  const candidate = nested<{ full_name?: string }>(
    (interview as Record<string, unknown>).applications
  );
  const when = formatInZone(
    String(interview.scheduled_at),
    await getOrganisationTimeZone(),
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }
  );
  const verb = action === "cleared" ? "Removed" : action === "updated" ? "Updated" : "Wrote";
  const about = `${candidate?.full_name ?? "a candidate"}'s panel of ${when}`;

  await recordActivity({
    area: "interviews",
    action: "interview_notes",
    entity: "interview",
    entityId: input.interviewId,
    summary:
      action === "cleared"
        ? `${verb} the notes on ${about}.`
        : `${verb} notes on ${about}: ${clipNoteBody(note.body ?? "").text}`,
    detail: {
      application_id: interview.application_id,
      scheduled_at: interview.scheduled_at,
      interview_status: interview.status,
      body_length: note.body?.length ?? 0,
      edited: action === "updated",
      cleared: action === "cleared",
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/candidates");
  return { ok: true, scheduledAt: slot };
}

/**
 * Files the model's generated guide under the interviewer's own note.
 *
 * The guide has nowhere else to live. It is drafted from the CV's gaps while the
 * panel is being booked, and until now the screen said so — "copy what you need
 * into your notes before closing this panel" — which is a note that never gets
 * written. Saving it into the note keeps one account per person per panel, with
 * the interviewer's own words first and the draft labelled underneath as the
 * model's, so nobody later reads a generated question as someone's judgement.
 *
 * A guide that does not fit is refused with the room that is left, before the row
 * is touched: a truncated save would delete part of what the person already wrote.
 */
export async function saveInterviewGuideInNotes(input: {
  interviewId: string;
  questions: readonly GuideQuestionInput[] | null | undefined;
}): Promise<NotesMutation> {
  const user = await requireStaff("/interviews");

  // The domain owns the refusal words, so the door asks it for them instead of
  // copying the sentence. The body it builds here is thrown away: nothing is known
  // about the panel or the existing note yet, and an empty guide stops before either
  // is read.
  const ask = appendInterviewGuide(null, input.questions);
  if (!ask.ok) return { ok: false, error: ask.error };

  const restClient = await createServerRestClient();
  const { data: interview } = await restClient
    .from("interview_schedules")
    .select("id, application_id, status, scheduled_at, applications(full_name)")
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!interview) return { ok: false, error: "That panel no longer exists." };
  const refusal = noteWriteRefusal(interview.status);
  if (refusal) return { ok: false, error: refusal };

  const { data: existing, error: readError } = await restClient
    .from("interview_notes")
    .select("body")
    .eq("interview_id", input.interviewId)
    .eq("author_profile_id", user.profileId)
    .maybeSingle();

  if (readError) {
    return {
      ok: false,
      error: isMissingSchemaError(readError)
        ? NOTES_WRITE_REFUSAL
        : `The notes could not be read: ${readError.message}`,
    };
  }

  const held = existing ? String((existing as Record<string, unknown>).body ?? "") : "";
  const guide = appendInterviewGuide(held, input.questions);
  if (!guide.ok) return { ok: false, error: guide.error };

  const action = held.length > 0 ? "updated" : "wrote";
  if (held.length > 0) {
    const { error } = await restClient
      .from("interview_notes")
      .update({ body: guide.body })
      .eq("interview_id", input.interviewId)
      .eq("author_profile_id", user.profileId);
    if (error) {
      return {
        ok: false,
        error: isMissingSchemaError(error) ? NOTES_WRITE_REFUSAL : error.message,
      };
    }
  } else {
    const { error } = await restClient
      .from("interview_notes")
      .insert({
        interview_id: input.interviewId,
        author_profile_id: user.profileId,
        body: guide.body,
      });
    if (error) {
      if (isMissingSchemaError(error)) return { ok: false, error: NOTES_WRITE_REFUSAL };
      if (error.code === "23505") {
        return {
          ok: false,
          error: "You already have notes on this panel. Reopen them to add the guide.",
        };
      }
      return { ok: false, error: error.message };
    }
  }

  const candidate = nested<{ full_name?: string }>(
    (interview as Record<string, unknown>).applications
  );
  const when = formatInZone(
    String(interview.scheduled_at),
    await getOrganisationTimeZone(),
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }
  );
  const about = `${candidate?.full_name ?? "a candidate"}'s panel of ${when}`;

  await recordActivity({
    area: "interviews",
    action: "interview_notes",
    entity: "interview",
    entityId: input.interviewId,
    summary:
      action === "updated"
        ? `Added the interview guide to the notes on ${about}.`
        : `Wrote the interview guide as the first notes on ${about}.`,
    detail: {
      application_id: interview.application_id,
      scheduled_at: interview.scheduled_at,
      interview_status: interview.status,
      body_length: guide.body.length,
      guide_questions: input.questions?.length ?? 0,
      edited: action === "updated",
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/candidates");
  return {
    ok: true,
    scheduledAt: interview.scheduled_at ? String(interview.scheduled_at) : undefined,
  };
}
