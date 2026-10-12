"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

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
    .select("id")
    .eq("id", input.templateId)
    .maybeSingle();

  if (!template) return { ok: false, error: "That assessment suite no longer exists." };

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
  return { ok: true, created: rows.length };
}