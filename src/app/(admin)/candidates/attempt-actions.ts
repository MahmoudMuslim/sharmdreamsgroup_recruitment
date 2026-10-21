"use server";

import { randomBytes } from "crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { assessmentUrl } from "@/lib/public-url";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";
import { notifyAssessmentInvite } from "@/modules/omnichannel/application/candidate-notifications";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { DEFAULT_LINK_VALIDITY_HOURS } from "@/modules/assessment/application/linkValidity";
import { recordActivity } from "@/modules/activity/application/record";

export interface AttemptResult {
  ok: boolean;
  error?: string;
  /**
   * The whole address, present after a re-issue so the recruiter can copy the
   * only working link. Built here rather than in the browser: the drawer runs on
   * whatever host the recruiter typed, and a link pasted into WhatsApp has to be
   * the one the candidate's phone can reach — the same address the invitation
   * this action queues carries.
   */
  link?: string;
}

const OPEN = new Set(["NOT_STARTED", "IN_PROGRESS"]);

async function refusal(): Promise<string | null> {
  if (await hasPermissionForUser("assessments.assign")) return null;
  return "You need the Assign assessments permission to change an issued link.";
}

interface LoadedAttempt {
  id: string;
  status: string;
  started_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  created_at: string;
  application_id: string;
  /** Joined in from `applications` so a trail row reads as a person, not a UUID. */
  full_name: string;
}

async function loadAttempt(attemptId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("candidate_attempts")
    .select(
      "id, status, started_at, submitted_at, expires_at, created_at, application_id, applications(full_name)"
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (!data) return { supabase, attempt: null as LoadedAttempt | null };

  const row = data as unknown as Omit<LoadedAttempt, "full_name"> & {
    applications?: { full_name?: string } | { full_name?: string }[] | null;
  };
  const embedded = row.applications;
  const name = Array.isArray(embedded) ? embedded[0]?.full_name : embedded?.full_name;

  return {
    supabase,
    attempt: {
      id: row.id,
      status: row.status,
      started_at: row.started_at,
      submitted_at: row.submitted_at,
      expires_at: row.expires_at,
      created_at: row.created_at,
      application_id: row.application_id,
      full_name: name ?? "a candidate",
    } satisfies LoadedAttempt,
  };
}

/**
 * Stop an open link: NOT_STARTED or IN_PROGRESS attempts become EXPIRED, which
 * the runner, the start route and the integrity route all already refuse.
 *
 * Answers already in are kept, which is exactly why a submitted test cannot be
 * revoked — the record of what the candidate handed in must survive.
 */
export async function revokeAttempt(attemptId: string): Promise<AttemptResult> {
  await requireStaff("/candidates");
  const denied = await refusal();
  if (denied) return { ok: false, error: denied };

  const { supabase, attempt } = await loadAttempt(attemptId);
  if (!attempt) return { ok: false, error: "That attempt no longer exists." };
  if (!OPEN.has(attempt.status)) {
    return {
      ok: false,
      error: `A ${attempt.status.toLowerCase()} attempt cannot be revoked — its answers are already in.`,
    };
  }

  const { error } = await supabase
    .from("candidate_attempts")
    .update({ status: "EXPIRED", expires_at: new Date().toISOString() })
    .eq("id", attemptId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "attempt_revoke",
    entity: "attempt",
    entityId: attemptId,
    summary: `Revoked ${attempt.full_name}'s assessment link — closed from ${attempt.status.toLowerCase()} with its answers kept`,
    detail: {
      from_status: attempt.status,
      to_status: "EXPIRED",
      application_id: attempt.application_id,
    },
  });

  revalidatePath("/candidates");
  return { ok: true };
}

/**
 * Buy more time on an open link.
 *
 * The extra hours are added to whatever deadline is currently in force, so
 * extending twice does not silently reset the clock to the first extension.
 *
 * On a NOT_STARTED attempt that deadline is the end of the invitation window;
 * once the candidate has opened the test, `expires_at` holds the hand-in time
 * instead, so the same button gives them longer to finish what they started.
 */
export async function extendAttemptLink(
  attemptId: string,
  hours: number
): Promise<AttemptResult> {
  await requireStaff("/candidates");
  const denied = await refusal();
  if (denied) return { ok: false, error: denied };

  const amount = Number(hours);
  if (!Number.isFinite(amount) || amount < 1 || amount > 336) {
    return { ok: false, error: "Extend by between 1 and 336 hours." };
  }

  const { supabase, attempt } = await loadAttempt(attemptId);
  if (!attempt) return { ok: false, error: "That attempt no longer exists." };
  if (!OPEN.has(attempt.status)) {
    return { ok: false, error: "Only an open attempt can be extended." };
  }

  const validityHours = await getNumberSetting(
    "assessment.link_validity_hours",
    DEFAULT_LINK_VALIDITY_HOURS
  );
  const currentDeadline =
    attempt.expires_at ??
    new Date(new Date(attempt.created_at).getTime() + validityHours * 3_600_000).toISOString();

  const base = Math.max(Date.now(), new Date(currentDeadline).getTime());

  const { error } = await supabase
    .from("candidate_attempts")
    .update({ expires_at: new Date(base + amount * 3_600_000).toISOString() })
    .eq("id", attemptId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "attempt_extend",
    entity: "attempt",
    entityId: attemptId,
    summary: `Gave ${attempt.full_name} ${amount} more hour${amount === 1 ? "" : "s"} on the assessment link`,
    detail: {
      hours_added: amount,
      previous_deadline: attempt.expires_at,
      new_deadline: new Date(base + amount * 3_600_000).toISOString(),
      application_id: attempt.application_id,
    },
  });

  revalidatePath("/candidates");
  return { ok: true };
}

/**
 * Replace a link nobody can use — leaked, or left to expire before the
 * candidate ever opened it — with a fresh one and send it again.
 *
 * The old token stops resolving because the portal authorises by token alone.
 * A test that was already opened is refused: re-issuing it would hand a second
 * sitting to someone who has seen the paper.
 */
export async function reissueAttemptLink(attemptId: string): Promise<AttemptResult> {
  await requireStaff("/candidates");
  const denied = await refusal();
  if (denied) return { ok: false, error: denied };

  const { supabase, attempt } = await loadAttempt(attemptId);
  if (!attempt) return { ok: false, error: "That attempt no longer exists." };
  if (attempt.started_at || attempt.submitted_at) {
    return {
      ok: false,
      error:
        "This candidate already opened the test, so its link cannot be re-issued. Assign a fresh attempt instead.",
    };
  }

  const accessToken = randomBytes(32).toString("base64url");
  const validityHours = await getNumberSetting(
    "assessment.link_validity_hours",
    DEFAULT_LINK_VALIDITY_HOURS
  );

  const { error } = await supabase
    .from("candidate_attempts")
    .update({
      access_token: accessToken,
      status: "NOT_STARTED",
      expires_at: new Date(Date.now() + validityHours * 3_600_000).toISOString(),
    })
    .eq("id", attemptId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "attempt_reissue",
    entity: "attempt",
    entityId: attemptId,
    summary: `Re-issued ${attempt.full_name}'s assessment link — the old address stops working and a fresh invitation is sent`,
    detail: {
      previous_status: attempt.status,
      to_status: "NOT_STARTED",
      validity_hours: validityHours,
      application_id: attempt.application_id,
    },
  });

  revalidatePath("/candidates");

  const applicationId = attempt.application_id;
  const link = await assessmentUrl(accessToken);

  after(async () => {
    try {
      await notifyAssessmentInvite({ applicationId, accessToken });
    } catch {
      // The outbox still shows whatever the channels recorded.
    }
    await processDueWhatsAppJobs(1);
  });

  return { ok: true, link };
}

/**
 * Remove an attempt that was never opened, and with it the link the candidate
 * was sent. Anything with answers attached is refused.
 */
export async function deleteAttempt(attemptId: string): Promise<AttemptResult> {
  await requireStaff("/candidates");
  const denied = await refusal();
  if (denied) return { ok: false, error: denied };

  const { supabase, attempt } = await loadAttempt(attemptId);
  if (!attempt) return { ok: false, error: "That attempt no longer exists." };

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select("id")
    .eq("attempt_id", attemptId)
    .limit(1);

  if ((responses ?? []).length > 0) {
    return {
      ok: false,
      error:
        "This attempt has answers on file, so it cannot be deleted. Revoke it to close the link and keep the record.",
    };
  }

  const { error } = await supabase.from("candidate_attempts").delete().eq("id", attemptId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "attempt_delete",
    entity: "attempt",
    entityId: attemptId,
    summary: `Deleted ${attempt.full_name}'s assessment link — it was never opened, so no answers were lost`,
    detail: {
      status_at_delete: attempt.status,
      issued_at: attempt.created_at,
      application_id: attempt.application_id,
    },
  });

  revalidatePath("/candidates");
  return { ok: true };
}
