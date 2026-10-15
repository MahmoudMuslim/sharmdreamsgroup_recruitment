"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAiProvider } from "@/lib/config.server";
import { requireStaff, STAFF_ROLES } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting, getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { scoresAreMaskedForCurrentUser } from "@/modules/settings/application/scoreVisibility";
import { generateInterviewQuestions } from "@/modules/screening/infrastructure/openRouterEngine";
import type { CvScreeningResult, GeneratedInterviewQuestions } from "@/types";
import { formatInZone } from "@/lib/timezone";
import { recordActivity } from "@/modules/activity/application/record";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import {
  notifyInterviewUpdate,
  type MessagingReport,
} from "@/modules/omnichannel/application/candidate-notifications";
import { INTERVIEW_SELECT, toInterviewRecord, type InterviewRecord } from "./interviews-model";

export type { InterviewRecord } from "./interviews-model";

export interface InterviewerOption {
  id: string;
  full_name: string;
  role: string;
}

export interface InterviewMutation {
  ok: boolean;
  error?: string;
  interviews?: InterviewRecord[];
  /** True when a WhatsApp notice reached the candidate's queue. */
  notified?: boolean;
  /** What each channel did with this notice, so the UI can say it out loud. */
  channels?: MessagingReport;
}

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;

async function interviewsFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  applicationId: string
): Promise<InterviewRecord[]> {
  const { data } = await supabase
    .from("interview_schedules")
    .select(INTERVIEW_SELECT)
    .eq("application_id", applicationId)
    .order("scheduled_at", { ascending: true });

  return ((data ?? []) as Record<string, unknown>[]).map(toInterviewRecord);
}

/** Staff session + write permission, or a message explaining which is missing. */
async function requireWriteAccess(): Promise<
  { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> } | { error: string }
> {
  await requireStaff("/candidates");
  if (!(await hasPermissionForUser("candidates.write"))) {
    return { error: "You need the Edit candidates permission." };
  }
  return { supabase: await createSupabaseServerClient() };
}

/**
 * Validates the slot a recruiter picked.
 *
 * The panel converts its `datetime-local` value to an absolute instant before
 * sending it, because a bare wall-clock string would otherwise be resolved in
 * the *server's* timezone and silently move the interview for anyone not
 * already on UTC.
 */
function readSlot(input: {
  scheduledAt: string;
  durationMinutes: number;
  meetingLink?: string | null;
}): { iso: string; duration: number; link: string | null } | { error: string } {
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Pick a valid interview date and time." };
  if (when.getTime() <= Date.now()) return { error: "Pick a time in the future." };
  if (when.getTime() > Date.now() + 1000 * 60 * 60 * 24 * 365) {
    return { error: "Interviews can only be scheduled up to a year ahead." };
  }

  const duration = Math.round(input.durationMinutes);
  if (!Number.isFinite(duration) || duration < MIN_MINUTES || duration > MAX_MINUTES) {
    return { error: `Duration must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.` };
  }

  const raw = input.meetingLink?.trim() ?? "";
  if (raw && !/^https?:\/\/\S+$/i.test(raw)) {
    return { error: "The meeting link must be a full URL starting with http(s)://." };
  }

  return { iso: when.toISOString(), duration, link: raw.length > 0 ? raw.slice(0, 500) : null };
}

/**
 * An instant rendered the way the recruiter reads it.
 *
 * A trail summary that quotes the raw ISO string drops the trailing `Z` and so
 * prints a UTC instant as though it were local time — which is a lie about when
 * the panel was booked.
 */
async function slotLabel(iso: string): Promise<string> {
  return formatInZone(iso, await getOrganisationTimeZone(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

/** The candidate on the other side of an interview — a trail row reads as a person. */
function candidateOf(row: unknown): { applicationId: string; fullName: string } {
  const raw = row as {
    application_id?: string | null;
    applications?: { full_name?: string } | { full_name?: string }[] | null;
  };
  const embedded = raw.applications;
  return {
    applicationId: raw.application_id ?? "",
    fullName: (Array.isArray(embedded) ? embedded[0]?.full_name : embedded?.full_name) ?? "a candidate",
  };
}

/**
 * Books an interview and tells the candidate.
 *
 * The insert is the recruiter's action; the notice rides the same queue the
 * stage alerts use, so Meta is only ever talked to from one place and the send
 * happens after the response is on its way back.
 */
export async function scheduleInterview(input: {
  applicationId: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingLink?: string | null;
  interviewerProfileId?: string | null;
}): Promise<InterviewMutation> {
  const access = await requireWriteAccess();
  if ("error" in access) return { ok: false, error: access.error };
  const { supabase } = access;

  const slot = readSlot(input);
  if ("error" in slot) return { ok: false, error: slot.error };

  const { data: application } = await supabase
    .from("applications")
    .select("id, stage, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "This candidate no longer exists." };
  if (application.stage === "REJECTED") {
    return { ok: false, error: "This candidate is rejected — move them back into the pipeline first." };
  }

  const interviewerId = input.interviewerProfileId?.trim() || null;
  if (interviewerId) {
    const { data: interviewer } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", interviewerId)
      .in("role", [...STAFF_ROLES])
      .maybeSingle();
    if (!interviewer) return { ok: false, error: "That interviewer is not a staff member." };
  }

  const { data: booked, error: insertError } = await supabase
    .from("interview_schedules")
    .insert({
      application_id: input.applicationId,
      interviewer_profile_id: interviewerId,
      scheduled_at: slot.iso,
      duration_minutes: slot.duration,
      meeting_link: slot.link,
      calendar_provider: "MANUAL",
      status: "SCHEDULED",
    })
    .select("id")
    .maybeSingle();

  if (insertError) return { ok: false, error: insertError.message };

  await recordActivity({
    area: "interviews",
    action: "interview_book",
    entity: "interview",
    entityId: (booked?.id as string | undefined) ?? null,
    summary: `Booked a panel with ${application.full_name ?? "a candidate"} for ${await slotLabel(slot.iso)} (${slot.duration} min)`,
    detail: {
      application_id: input.applicationId,
      scheduled_at: slot.iso,
      duration_minutes: slot.duration,
      interviewer_profile_id: interviewerId,
    },
  });

  const channels = await notifyInterviewUpdate({
    applicationId: input.applicationId,
    kind: "SCHEDULED",
    scheduledAt: slot.iso,
    durationMinutes: slot.duration,
    meetingLink: slot.link,
  });

  if (channels.whatsapp === "queued") after(() => processDueWhatsAppJobs(5).then(() => undefined));

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, input.applicationId),
    notified: channels.whatsapp === "queued",
    channels,
  };
}

/** Moves an upcoming interview. The candidate is told it moved, not re-invited. */
export async function rescheduleInterview(input: {
  interviewId: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingLink?: string | null;
  interviewerProfileId?: string | null;
}): Promise<InterviewMutation> {
  const access = await requireWriteAccess();
  if ("error" in access) return { ok: false, error: access.error };
  const { supabase } = access;

  const slot = readSlot(input);
  if ("error" in slot) return { ok: false, error: slot.error };

  const { data: existing } = await supabase
    .from("interview_schedules")
    .select(
      "id, application_id, status, scheduled_at, duration_minutes, meeting_link, interviewer_profile_id, applications(full_name)"
    )
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That interview no longer exists." };
  if (existing.status !== "SCHEDULED") {
    return { ok: false, error: `This interview is already ${existing.status.toLowerCase()}.` };
  }
  const owner = candidateOf(existing);

  const interviewerId = input.interviewerProfileId?.trim() || null;
  if (interviewerId) {
    const { data: interviewer } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", interviewerId)
      .in("role", [...STAFF_ROLES])
      .maybeSingle();
    if (!interviewer) return { ok: false, error: "That interviewer is not a staff member." };
  }

  const { error } = await supabase
    .from("interview_schedules")
    .update({
      scheduled_at: slot.iso,
      duration_minutes: slot.duration,
      meeting_link: slot.link,
      interviewer_profile_id: interviewerId,
    })
    .eq("id", input.interviewId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "interviews",
    action: "interview_reschedule",
    entity: "interview",
    entityId: input.interviewId,
    summary: `Moved ${owner.fullName}'s panel from ${await slotLabel(existing.scheduled_at)} to ${await slotLabel(slot.iso)} (${slot.duration} min)`,
    detail: {
      application_id: owner.applicationId,
      previous_scheduled_at: existing.scheduled_at,
      scheduled_at: slot.iso,
      previous_duration_minutes: existing.duration_minutes,
      duration_minutes: slot.duration,
      previous_interviewer_profile_id: existing.interviewer_profile_id ?? null,
      interviewer_profile_id: interviewerId,
      meeting_link_changed: (existing.meeting_link ?? "") !== (slot.link ?? ""),
    },
  });

  const channels = await notifyInterviewUpdate({
    applicationId: owner.applicationId,
    kind: "CHANGED",
    scheduledAt: slot.iso,
    durationMinutes: slot.duration,
    meetingLink: slot.link,
  });

  if (channels.whatsapp === "queued") after(() => processDueWhatsAppJobs(5).then(() => undefined));

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, owner.applicationId),
    notified: channels.whatsapp === "queued",
    channels,
  };
}

/**
 * Records how an interview went, or calls it off.
 *
 * COMPLETED and NO_SHOW are outcomes, so they never message the candidate —
 * only a cancellation does, and it deliberately carries no internal reason.
 */
export async function setInterviewStatus(input: {
  interviewId: string;
  status: "COMPLETED" | "NO_SHOW" | "CANCELLED";
}): Promise<InterviewMutation> {
  const access = await requireWriteAccess();
  if ("error" in access) return { ok: false, error: access.error };
  const { supabase } = access;

  const { data: existing } = await supabase
    .from("interview_schedules")
    .select(
      "id, application_id, scheduled_at, duration_minutes, meeting_link, status, applications(full_name)"
    )
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That interview no longer exists." };
  if (existing.status === input.status) {
    return {
      ok: true,
      interviews: await interviewsFor(supabase, existing.application_id),
    };
  }
  if (existing.status === "CANCELLED") {
    return { ok: false, error: "This interview was already cancelled — book a new slot instead." };
  }

  const { error } = await supabase
    .from("interview_schedules")
    .update({ status: input.status })
    .eq("id", input.interviewId);

  if (error) return { ok: false, error: error.message };

  const owner = candidateOf(existing);
  const outcome =
    input.status === "CANCELLED"
      ? `Cancelled ${owner.fullName}'s panel on ${await slotLabel(existing.scheduled_at)}`
      : `Recorded ${input.status === "NO_SHOW" ? "a no-show" : "a completed interview"} for ${owner.fullName}'s panel on ${await slotLabel(existing.scheduled_at)}`;

  await recordActivity({
    area: "interviews",
    action: "interview_status",
    entity: "interview",
    entityId: input.interviewId,
    summary: outcome,
    detail: {
      application_id: existing.application_id,
      scheduled_at: existing.scheduled_at,
      from: existing.status,
      to: input.status,
    },
  });

  let notified = false;
  let channels: MessagingReport | undefined;
  if (input.status === "CANCELLED") {
    channels = await notifyInterviewUpdate({
      applicationId: existing.application_id,
      kind: "CANCELLED",
      scheduledAt: existing.scheduled_at,
      durationMinutes: existing.duration_minutes,
      meetingLink: existing.meeting_link,
    });
    notified = channels.whatsapp === "queued";
    if (channels.whatsapp === "queued") after(() => processDueWhatsAppJobs(5).then(() => undefined));
  }

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, existing.application_id),
    notified,
    channels,
  };
}

/** Who can sit on the panel — staff in the recruiter's company, or all staff. */
export async function listInterviewers(): Promise<InterviewerOption[]> {
  const user = await requireStaff("/candidates");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("user_profiles")
    .select("id, full_name, role")
    .in("role", [...STAFF_ROLES])
    .order("full_name", { ascending: true })
    .limit(60);

  if (user.tenantId) query = query.or(`tenant_id.eq.${user.tenantId},tenant_id.is.null`);

  const { data } = await query;
  return ((data ?? []) as InterviewerOption[]).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    role: row.role,
  }));
}

export interface InterviewGuideQuestion {
  question: string;
  rationale: string;
  skill_probed: string;
}

export interface InterviewGuide {
  ok: boolean;
  error?: string;
  questions?: InterviewGuideQuestion[];
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/**
 * Writes an interview guide for one candidate, on demand.
 *
 * Gated on `ai.interview_questions`: with that switch off the recruiter gets
 * the setting named in the reply rather than a model call behind their back.
 * The questions are built from the gaps AI screening recorded, so screening has
 * to have run, and from whatever the candidate wrote in their assessment — with
 * score masking on, only the writing is offered to the model.
 * Nothing is stored — there is no column for a guide — so the panel keeps the
 * result in the open drawer and says so.
 */
export async function generateInterviewGuide(input: {
  applicationId: string;
}): Promise<InterviewGuide> {
  await requireStaff("/candidates");

  if (!(await getBoolSetting("ai.interview_questions", true))) {
    return {
      ok: false,
      error:
        "Question generation is switched off — turn on Settings → AI & screening → Generate interview questions.",
    };
  }
  if (!hasAiProvider()) return { ok: false, error: "No AI provider key is configured." };

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("applications")
    .select(
      "id, cv_text, ai_match_score, ai_screening_summary, ai_strengths, ai_gaps, ai_soft_skills, diversity_flags, job_openings(title, requirements)"
    )
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!data) return { ok: false, error: "This candidate no longer exists." };

  const application = data as unknown as {
    cv_text: string | null;
    ai_match_score: number | null;
    ai_screening_summary: string | null;
    ai_strengths: unknown;
    ai_gaps: unknown;
    diversity_flags?: Record<string, string> | null;
    job_openings?: { title?: string; requirements?: unknown } | { title?: string; requirements?: unknown }[] | null;
  };

  if (application.ai_match_score === null) {
    return {
      ok: false,
      error: "Run AI screening first — the questions probe the gaps that screening found.",
    };
  }
  if (!application.cv_text?.trim()) {
    return { ok: false, error: "No CV text is stored for this candidate, so there are no gaps to probe." };
  }

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;

  const screening: CvScreeningResult = {
    match_score: Number(application.ai_match_score),
    decision: "BORDERLINE",
    summary: application.ai_screening_summary ?? "",
    key_competencies: [],
    strengths: toStringList(application.ai_strengths),
    gaps: toStringList(application.ai_gaps),
    anonymization_applied: application.diversity_flags?.cv_anonymization === "applied",
    model_used: "stored screening result",
  };

  // The candidate's own latest attempt, so a weak answer becomes a question.
  const { data: attempt } = await supabase
    .from("candidate_attempts")
    .select("id")
    .eq("application_id", input.applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: rows } = attempt
    ? await supabase
        .from("candidate_responses")
        .select("answer_text, score, max_score, assessment_questions(title)")
        .eq("attempt_id", attempt.id)
        .limit(20)
    : { data: null };

  // A masked reviewer's guide must not be able to quote marks the console
  // just hid from them, so the model is never given a number to echo back.
  const masked = await scoresAreMaskedForCurrentUser();

  const responses = ((rows ?? []) as {
    answer_text: string | null;
    score: number | null;
    max_score: number | null;
    assessment_questions?: { title?: string } | null;
  }[]).map((row) => ({
    questionTitle: row.assessment_questions?.title ?? "Question",
    answerPreview: row.answer_text ?? "(no written answer)",
    score:
      !masked && row.score !== null && row.max_score
        ? Math.round((row.score / row.max_score) * 100)
        : null,
  }));

  let guide: GeneratedInterviewQuestions;
  try {
    guide = await generateInterviewQuestions(
      job?.title ?? "the role",
      toStringList(job?.requirements),
      application.cv_text,
      screening,
      responses
    );
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "The model did not return a guide.",
    };
  }

  const questions = (guide.questions ?? [])
    .filter((item) => typeof item?.question === "string" && item.question.trim().length > 0)
    .map((item) => ({
      question: item.question.trim(),
      rationale: (item.rationale ?? "").trim(),
      skill_probed: (item.skill_probed ?? "").trim(),
    }))
    .slice(0, 10);

  if (questions.length === 0) {
    return { ok: false, error: "The model returned no usable questions — try again." };
  }

  return { ok: true, questions };
}
