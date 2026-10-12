"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, STAFF_ROLES } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import {
  enqueueInterviewNotice,
  processDueWhatsAppJobs,
} from "@/modules/omnichannel/application/whatsapp-dispatch";
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
    .select("id, stage")
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

  const { error: insertError } = await supabase.from("interview_schedules").insert({
    application_id: input.applicationId,
    interviewer_profile_id: interviewerId,
    scheduled_at: slot.iso,
    duration_minutes: slot.duration,
    meeting_link: slot.link,
    calendar_provider: "MANUAL",
    status: "SCHEDULED",
  });

  if (insertError) return { ok: false, error: insertError.message };

  const notice = await enqueueInterviewNotice({
    applicationId: input.applicationId,
    kind: "SCHEDULED",
    scheduledAt: slot.iso,
    durationMinutes: slot.duration,
    meetingLink: slot.link,
  });

  if (notice.queued) after(() => processDueWhatsAppJobs(5).then(() => undefined));

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, input.applicationId),
    notified: notice.queued,
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
    .select("id, application_id, status")
    .eq("id", input.interviewId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That interview no longer exists." };
  if (existing.status !== "SCHEDULED") {
    return { ok: false, error: `This interview is already ${existing.status.toLowerCase()}.` };
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

  const notice = await enqueueInterviewNotice({
    applicationId: existing.application_id,
    kind: "CHANGED",
    scheduledAt: slot.iso,
    durationMinutes: slot.duration,
    meetingLink: slot.link,
  });

  if (notice.queued) after(() => processDueWhatsAppJobs(5).then(() => undefined));

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, existing.application_id),
    notified: notice.queued,
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
    .select("id, application_id, scheduled_at, duration_minutes, meeting_link, status")
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

  let notified = false;
  if (input.status === "CANCELLED") {
    const notice = await enqueueInterviewNotice({
      applicationId: existing.application_id,
      kind: "CANCELLED",
      scheduledAt: existing.scheduled_at,
      durationMinutes: existing.duration_minutes,
      meetingLink: existing.meeting_link,
    });
    notified = notice.queued;
    if (notice.queued) after(() => processDueWhatsAppJobs(5).then(() => undefined));
  }

  revalidatePath("/candidates");
  return {
    ok: true,
    interviews: await interviewsFor(supabase, existing.application_id),
    notified,
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
