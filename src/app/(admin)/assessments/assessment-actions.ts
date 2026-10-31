"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomBytes } from "crypto";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { notifyAssessmentInvite } from "@/modules/omnichannel/application/candidate-notifications";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { changePhrase, changedFields } from "@/modules/activity/domain/trail";
import { recordActivity } from "@/modules/activity/application/record";
import { readFollowUpAvailability } from "@/modules/assessment/application/followUpAvailability";
import { readSuiteById } from "@/infrastructure/repositories/assessmentTemplate";
import {
  FOLLOW_UP_WRITE_REFUSAL,
  followUpLoop,
  readFollowUpRuleInput,
  type FollowUpRule,
  type FollowUpRuleInput,
} from "@/modules/assessment/domain/followUp";

export interface TemplateResult {
  ok: boolean;
  error?: string;
  id?: string;
  /**
   * The suite was saved but one part of the form was not, phrased for the
   * recruiter. Today that is only a second-test rule on a database where
   * migration 035 is unapplied: refusing the whole save over an optional
   * feature would lose the name and description they just typed.
   */
  warning?: string;
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
  /**
   * The second-test rule as the suite form holds it.
   *
   * Omitted means "leave the stored rule alone". That is the answer for every
   * caller that does not show the field — the assistant's tool and the AI
   * suite drafter both edit suites without one, and an undefined field must
   * not silently clear a rule a recruiter wrote. The form always sends it,
   * with blank strings to switch the rule off.
   */
  follow_up?: FollowUpRuleInput;
}

/**
 * Whether a rule may point at `rule.templateId` from a suite in `tenantId`.
 *
 * Three refusals: the target must exist, it must belong to the same company
 * (a candidate is never routed across companies by a rule), and the chain must
 * not come back to this suite. The loop read is skipped for a suite that does
 * not exist yet — a new row cannot already be part of a chain.
 */
async function checkFollowUpTarget(
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  rule: FollowUpRule,
  sourceId: string | null,
  tenantId: string
): Promise<string | null> {
  const { data: target } = await restClient
    .from("assessment_templates")
    .select("id, tenant_id, name")
    .eq("id", rule.templateId)
    .maybeSingle();

  const row = target as { id: string; tenant_id: string; name: string } | null;
  if (!row) return "The suite this rule names no longer exists.";
  if (row.tenant_id !== tenantId) {
    return "The second test must belong to the same company as this suite — a rule never sends a candidate to another company's test.";
  }

  if (sourceId) {
    const { data: all } = await restClient
      .from("assessment_templates")
      .select("id, name, follow_up_template_id");
    const rows = (all ?? []) as unknown as {
      id: string;
      name: string;
      follow_up_template_id?: string | null;
    }[];
    const targetOf = new Map(
      rows.map((entry) => [entry.id, entry.follow_up_template_id ?? null])
    );
    const loop = followUpLoop(sourceId, rule.templateId, targetOf);
    if (loop) {
      const names = new Map(rows.map((entry) => [entry.id, entry.name]));
      return `That rule would send candidates in a loop: ${loop
        .map((id) => names.get(id) ?? "a suite")
        .join(" → ")}. A chain of second tests has to end somewhere.`;
    }
  }

  return null;
}

/** Creates or updates an assessment suite. Requires `assessments.create`. */
export async function saveTemplate(payload: TemplatePayload): Promise<TemplateResult> {
  await requireStaff("/assessments");

  const creating = payload.id === null;
  // The same key guards both halves: RLS lets any staff member write this table,
  // so a suite is as easy to rewrite as to create, and "edit the test everyone
  // is sitting" needs the same trust as "invent a new one".
  if (!(await hasPermissionForUser("assessments.create"))) {
    return {
      ok: false,
      error: creating
        ? "You need the Create assessments permission."
        : "You need the Create assessments permission to change a suite.",
    };
  }

  const name = payload.name.trim();
  if (!name) return { ok: false, error: "A suite name is required." };

  const minutes = payload.time_limit_minutes;
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return { ok: false, error: "Duration must be between 5 and 480 minutes." };
  }

  const restClient = await createServerRestClient();

  const row = {
    name,
    description: payload.description.trim(),
    role_family: payload.role_family,
    time_limit_minutes: minutes,
    randomize_questions: payload.randomize_questions,
    randomize_options: payload.randomize_options,
    block_copy_paste: payload.block_copy_paste,
  };

  // A rule, no rule, or an untouched rule. The last is what an omitted field
  // means: callers that do not show the control must not clear it by accident.
  let rule: FollowUpRule | null = null;
  let writeRule = false;
  let warning: string | undefined;

  if (payload.follow_up !== undefined) {
    const parsed = readFollowUpRuleInput(payload.follow_up, payload.id);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    rule = parsed.rule;

    const availability = await readFollowUpAvailability(restClient);
    if (parsed.rule && availability.rules && availability.routing) {
      writeRule = true;
    } else if (parsed.rule === null && availability.rules) {
      // Clearing needs only the columns; a half-applied database may still hold
      // a rule someone wants to switch off.
      writeRule = true;
    } else if (parsed.rule && !availability.rules) {
      warning = FOLLOW_UP_WRITE_REFUSAL;
    } else if (parsed.rule) {
      warning = `The suite was saved, but its second-test rule was not: ${
        availability.note ?? "this database cannot record a routed link yet."
      }`;
    }
  }

  if (creating) {
    if (!payload.tenant_id) {
      return { ok: false, error: "Choose the company this suite belongs to." };
    }
    if (writeRule && rule) {
      const refusal = await checkFollowUpTarget(
        restClient,
        rule,
        null,
        payload.tenant_id as string
      );
      if (refusal) return { ok: false, error: refusal };
    }
    const { data, error } = await restClient
      .from("assessment_templates")
      .insert(
        writeRule
          ? {
              ...row,
              tenant_id: payload.tenant_id as string,
              follow_up_template_id: rule?.templateId ?? null,
              follow_up_min_percent: rule?.minPercent ?? null,
              follow_up_max_percent: rule?.maxPercent ?? null,
            }
          : { ...row, tenant_id: payload.tenant_id as string }
      )
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    await recordActivity({
      area: "assessments",
      action: "suite_create",
      entity: "assessment template",
      entityId: data?.id ?? null,
      summary: `Built the test suite “${name}” for ${minutes} minutes${
        row.block_copy_paste ? ", with copy-paste blocked" : ""
      }${rule ? `, sending ${rule.minPercent}–${rule.maxPercent}% on to a second test` : ""}`,
      detail: {
        ...row,
        tenant_id: payload.tenant_id,
        ...(writeRule
          ? {
              follow_up_template_id: rule?.templateId ?? null,
              follow_up_min_percent: rule?.minPercent ?? null,
              follow_up_max_percent: rule?.maxPercent ?? null,
            }
          : {}),
      },
    });

    revalidatePath("/assessments");
    return { ok: true, id: data?.id, warning };
  }

  const { data: previous } = await restClient
    .from("assessment_templates")
    .select(
      `id, tenant_id, name, description, role_family, time_limit_minutes, randomize_questions, randomize_options, block_copy_paste, is_active${
        writeRule ? ", follow_up_template_id, follow_up_min_percent, follow_up_max_percent" : ""
      }`
    )
    .eq("id", payload.id as string)
    .maybeSingle();
  if (!previous) return { ok: false, error: "That suite no longer exists." };

  if (writeRule && rule) {
    const refusal = await checkFollowUpTarget(
      restClient,
      rule,
      payload.id,
      previous.tenant_id as string
    );
    if (refusal) return { ok: false, error: refusal };
  }

  const update = writeRule
    ? {
        ...row,
        follow_up_template_id: rule?.templateId ?? null,
        follow_up_min_percent: rule?.minPercent ?? null,
        follow_up_max_percent: rule?.maxPercent ?? null,
      }
    : row;

  const { error } = await restClient
    .from("assessment_templates")
    .update(update)
    .eq("id", payload.id as string);

  if (error) return { ok: false, error: error.message };

  const edits = changedFields(previous as Record<string, unknown>, update);
  await recordActivity({
    area: "assessments",
    action: "suite_edit",
    entity: "assessment template",
    entityId: payload.id ?? undefined,
    summary: `Edited the test suite “${name}” — ${changePhrase(edits)}`,
    detail: edits,
  });

  revalidatePath("/assessments");
  return { ok: true, id: payload.id ?? undefined, warning };
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

  const restClient = await createServerRestClient();

  const found = await readSuiteById(restClient, templateId);
  if (!found.ok) return { ok: false, error: found.error };
  const suite = found.suite;
  if (!suite) return { ok: false, error: "That suite no longer exists." };

  const { error } = await restClient
    .from("assessment_templates")
    .update({ is_active: active })
    .eq("id", templateId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "suite_status",
    entity: "assessment template",
    entityId: templateId,
    summary: `${active ? "Resumed" : "Paused"} the test suite “${suite.name}” — ${
      active ? "it can be assigned again" : "issued links stay open"
    }`,
    detail: { from_active: suite.is_active, to_active: active },
  });

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

  const restClient = await createServerRestClient();

  const { data: issued } = await restClient
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

  const { data: suite } = await restClient
    .from("assessment_templates")
    .select("id, name, time_limit_minutes")
    .eq("id", templateId)
    .maybeSingle();
  if (!suite) return { ok: false, error: "That suite no longer exists." };

  const { count: questions } = await restClient
    .from("assessment_questions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);

  const { error } = await restClient.from("assessment_templates").delete().eq("id", templateId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "assessments",
    action: "suite_delete",
    entity: "assessment template",
    entityId: templateId,
    summary: `Deleted the test suite “${suite.name}” with ${questions ?? 0} question${
      questions === 1 ? "" : "s"
    } in it — no candidate had ever been sent it`,
    detail: {
      name: suite.name,
      time_limit_minutes: suite.time_limit_minutes,
      questions_removed: questions ?? 0,
    },
  });

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

  const restClient = await createServerRestClient();

  const found = await readSuiteById(restClient, input.templateId);
  if (!found.ok) return { ok: false, error: found.error };
  const template = found.suite;

  if (!template) return { ok: false, error: "That assessment suite no longer exists." };
  if (template.is_active === false) {
    return {
      ok: false,
      error: "This suite is paused. Resume it before assigning it to anyone.",
    };
  }

  // Skip anyone who already has a live attempt on this suite.
  const { data: existing } = await restClient
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

  const { error } = await restClient.from("candidate_attempts").insert(rows);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "One of those candidates already has an attempt." };
    }
    return { ok: false, error: error.message };
  }

  // One row for the batch, not one per candidate: a 200-person assign would
  // otherwise bury the trail, and each issued link still has its own history
  // from the moment anyone revokes, extends or re-issues it.
  await recordActivity({
    area: "assessments",
    action: "suite_assign",
    entity: "assessment template",
    entityId: input.templateId,
    summary: `Sent the “${template.name}” test to ${rows.length} candidate${
      rows.length === 1 ? "" : "s"
    } for ${minutes} minutes${ids.length - rows.length > 0 ? `, skipped ${ids.length - rows.length} already sitting it` : ""}`,
    detail: {
      created: rows.length,
      requested: ids.length,
      already_open: ids.length - rows.length,
      time_limit_minutes: minutes,
    },
  });

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