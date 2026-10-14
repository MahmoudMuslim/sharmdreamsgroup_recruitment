"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { notifyAssessmentInvite } from "@/modules/omnichannel/application/candidate-notifications";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";

export interface TemplateResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface TemplatePayload {
  id: string | null;
  /** Owning company. Required when creating. */
  tenant_id: string;
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  block_copy_paste: boolean;
}

/** Creates or updates an assessment suite. Requires `assessments.create`. */
export async function saveTemplate(payload: TemplatePayload): Promise<TemplateResult> {
  await requireStaff("/assessments");

  const creating = payload.id === null;
  if (creating && !(await hasPermissionForUser("assessments.create"))) {
    return { ok: false, error: "You need the Create assessments permission." };
  }

  const name = payload.name.trim();
  if (!name) return { ok: false, error: "A suite name is required." };

  const minutes = payload.time_limit_minutes;
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return { ok: false, error: "Duration must be between 5 and 480 minutes." };
  }

  const supabase = await createSupabaseServerClient();

  const row = {
    name,
    description: payload.description.trim(),
    role_family: payload.role_family,
    time_limit_minutes: minutes,
    randomize_questions: payload.randomize_questions,
    randomize_options: payload.randomize_options,
    block_copy_paste: payload.block_copy_paste,
  };

  if (creating) {
    if (!payload.tenant_id) {
      return { ok: false, error: "Choose the company this suite belongs to." };
    }
    const { data, error } = await supabase
      .from("assessment_templates")
      .insert({ ...row, tenant_id: payload.tenant_id as string })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    revalidatePath("/assessments");
    return { ok: true, id: data?.id };
  }

  const { error } = await supabase
    .from("assessment_templates")
    .update(row)
    .eq("id", payload.id as string);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/assessments");
  return { ok: true, id: payload.id ?? undefined };
}

export interface TemplateStatusResult {
  ok: boolean;
  error?: string;
}

/**
 * Pause or resume a suite.
 *
 * Pausing closes the assign door; a link already in a candidate's inbox stays
 * open, because a recruiter's toggle must not lock someone out mid-test.
 */
export async function setTemplateActive(
  templateId: string,
  active: boolean
): Promise<TemplateStatusResult> {
  await requireStaff("/assessments");

  if (!(await hasPermissionForUser("assessments.create"))) {
    return { ok: false, error: "You need the Create assessments permission." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("assessment_templates")
    .update({ is_active: active })
    .eq("id", templateId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/assessments");
  return { ok: true };
}

/**
 * Delete a suite, and with it its questions.
 *
 * Refused as soon as a candidate holds a link: the attempt is the record of what
 * that person was asked, so the answer to "get rid of this suite" is to pause it.
 */
export async function deleteTemplate(templateId: string): Promise<TemplateStatusResult> {
  await requireStaff("/assessments");

  if (!(await hasPermissionForUser("assessments.create"))) {
    return { ok: false, error: "You need the Create assessments permission." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: issued } = await supabase
    .from("candidate_attempts")
    .select("id")
    .eq("template_id", templateId)
    .limit(1);

  if ((issued ?? []).length > 0) {
    return {
      ok: false,
      error:
        "Candidates already hold links for this suite, so it cannot be deleted. Pause it instead: new assignments stop, issued tests stay open.",
    };
  }

  const { error } = await supabase.from("assessment_templates").delete().eq("id", templateId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/assessments");
  return { ok: true };
}

export interface AssignResult {
  ok: boolean;
  error?: string;
  created?: number;
}
/**
 * Issues an assessment attempt for each selected application.
 *
 * Each attempt gets a cryptographically random access token — the candidate
 * portal is authorised by that token alone, so it must be unguessable.
 * Everyone who receives a new attempt is then invited on the channels that are
 * switched on, because the token is only useful once the candidate has it.
 */
export async function assignTemplate(input: {
  templateId: string;
  applicationIds: string[];
  timeLimitMinutes: number;
}): Promise<AssignResult> {
  await requireStaff("/assessments");

  if (!(await hasPermissionForUser("assessments.assign"))) {
    return { ok: false, error: "You need the Assign assessments permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Select at least one candidate." };

  const minutes = input.timeLimitMinutes;
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return { ok: false, error: "Time limit must be between 5 and 480 minutes." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from("assessment_templates")
    .select("id, is_active")
    .eq("id", input.templateId)
    .maybeSingle();

  if (!template) return { ok: false, error: "That assessment suite no longer exists." };
  if (template.is_active === false) {
    return {
      ok: false,
      error: "This suite is paused. Resume it before assigning it to anyone.",
    };
  }

  // Skip anyone who already has a live attempt on this suite.
  const { data: existing } = await supabase
    .from("candidate_attempts")
    .select("application_id, status")
    .eq("template_id", input.templateId)
    .in("application_id", ids)
    .not("status", "in", "(SUBMITTED,GRADED,EXPIRED)");

  const busy = new Set((existing ?? []).map((a) => a.application_id));

  const rows = ids
    .filter((id) => !busy.has(id))
    .map((applicationId) => ({
      application_id: applicationId,
      template_id: input.templateId,
      // 32 bytes of CSPRNG output, URL-safe.
      access_token: randomBytes(32).toString("base64url"),
      status: "NOT_STARTED" as const,
      time_limit_minutes: minutes,
    }));

  if (rows.length === 0) {
    return {
      ok: false,
      error: "Every selected candidate already has an open attempt for this suite.",
    };
  }

  const { error } = await supabase.from("candidate_attempts").insert(rows);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "One of those candidates already has an attempt." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/assessments");
  revalidatePath("/candidates");

  // Issuing the test is the news the candidate actually needs: the stage alert
  // usually went out before any attempt existed, so its link token was empty.
  // Letters and portal notices are written after the recruiter's click has been
  // answered, and one candidate's relay refusal must not stop the rest.
  const invitations = rows.map((row) => ({
    applicationId: row.application_id,
    accessToken: row.access_token,
  }));

  after(async () => {
    for (const invitation of invitations) {
      try {
        await notifyAssessmentInvite(invitation);
      } catch {
        // Recorded nowhere else: the outbox still shows the WhatsApp queue.
      }
    }
    await processDueWhatsAppJobs(invitations.length);
  });

  return { ok: true, created: rows.length };
}