import "server-only";

import { randomBytes } from "crypto";
import { getServiceRestClient } from "@/lib/data-api/service";
import { engineActivityActor, recordActivity } from "@/modules/activity/application/record";
import { notifyAssessmentInvite } from "@/modules/omnichannel/application/candidate-notifications";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import {
  followUpBandText,
  followUpPercent,
  inFollowUpBand,
  isMissingFollowUpColumnError,
  readFollowUpRule,
} from "@/modules/assessment/domain/followUp";

/**
 * Issues a suite's second test when a finished paper lands inside its band.
 *
 * The one writer that turns a stored rule into a real link. It runs wherever an
 * attempt crosses into GRADED — the AI passes behind a submission, the cron
 * sweep that revisits stuck papers, and a recruiter awarding the last hand mark
 * from the report — because those are three doors into the same state and a
 * rule that only fires behind one of them is a rule with a silent exception.
 *
 * Everything about the decision is re-read here rather than passed in: the
 * suite's rule may have been rewritten between grading starting and finishing,
 * and the candidate may have been archived in that window. The insert then
 * carries `follow_up_of_attempt_id`, and the partial unique index behind it is
 * the final word — two grading paths crossing the same attempt at once can
 * both reach the insert, and exactly one may win.
 *
 * A skip is not an error. Most attempts are not inside a band, most suites have
 * no rule, and on a database where 035 is unapplied there is no rule column to
 * read at all. Only a routed link is worth a trail row; the rest would bury the
 * console in "nothing happened" entries.
 */

export interface FollowUpOutcome {
  routed: boolean;
  /** The suite issued, when one was. */
  target?: string;
  /** Why nothing was issued, when the answer is worth stating. */
  skipped?: string;
}

/** PostgREST answers a to-one embed as an object or a one-row array. */
function one<T extends object>(value: T | T[] | null | undefined): T | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row ?? null;
}

interface SourceAttemptRow {
  id: string;
  application_id: string;
  template_id: string;
  status: string;
  total_score: number | null;
  max_score: number | null;
  applications?:
    | {
        full_name?: string | null;
        archived_at?: string | null;
        job_openings?: { title?: string } | { title?: string }[] | null;
      }
    | {
        full_name?: string | null;
        archived_at?: string | null;
        job_openings?: { title?: string } | { title?: string }[] | null;
      }[]
    | null;
  assessment_templates?:
    | {
        id?: string;
        name?: string;
        tenant_id?: string;
        is_active?: boolean;
        follow_up_template_id?: string | null;
        follow_up_min_percent?: number | string | null;
        follow_up_max_percent?: number | string | null;
      }
    | {
        id?: string;
        name?: string;
        tenant_id?: string;
        is_active?: boolean;
        follow_up_template_id?: string | null;
        follow_up_min_percent?: number | string | null;
        follow_up_max_percent?: number | string | null;
      }[]
    | null;
}

interface TargetTemplateRow {
  id: string;
  name: string;
  tenant_id: string;
  is_active: boolean;
  time_limit_minutes: number | null;
  assessment_questions?: { id?: string }[] | null;
}

export async function routeFollowUp(sourceAttemptId: string): Promise<FollowUpOutcome> {
  try {
    return await route(sourceAttemptId);
  } catch (error) {
    // The caller is a grading pass: a router failure must never mark the marks
    // it just wrote as a failed pass, so it is logged and answered, not thrown.
    console.error(`Follow-up routing failed for attempt ${sourceAttemptId}:`, error);
    return {
      routed: false,
      skipped: error instanceof Error ? error.message : "The follow-up router failed.",
    };
  }
}

async function route(sourceAttemptId: string): Promise<FollowUpOutcome> {
  const restClient = getServiceRestClient();

  const { data: found, error } = await restClient
    .from("candidate_attempts")
    .select(
      "id, application_id, template_id, status, total_score, max_score, applications(full_name, archived_at, job_openings(title)), assessment_templates(id, name, tenant_id, is_active, follow_up_template_id, follow_up_min_percent, follow_up_max_percent)"
    )
    .eq("id", sourceAttemptId)
    .maybeSingle();

  if (error) {
    if (isMissingFollowUpColumnError(error)) {
      // 035 is authored and not applied. This is the expected answer on this
      // database, not a fault; every door that shows the rule says so in words.
      return { routed: false };
    }
    console.error(`Follow-up routing could not read attempt ${sourceAttemptId}:`, error.message);
    return { routed: false, skipped: error.message };
  }

  const attempt = found as unknown as SourceAttemptRow | null;
  if (!attempt) return { routed: false, skipped: "That attempt is no longer on file." };

  // Only a finished paper moves anyone on. SUBMITTED may still gain marks, and
  // routing on a partial total would send the wrong band's candidates.
  if (attempt.status !== "GRADED") return { routed: false };

  const source = one(attempt.assessment_templates);
  const rule = readFollowUpRule(source);
  if (!source?.id || !rule) return { routed: false };
  if (source.is_active === false) {
    // A paused source does not invent new links, matching `assignTemplate`.
    return { routed: false, skipped: "The source suite is paused." };
  }

  const percent = followUpPercent(attempt.total_score, attempt.max_score);
  if (percent === null) {
    return { routed: false, skipped: "The attempt carries no marks, so it has no percentage." };
  }
  if (!inFollowUpBand(percent, rule)) {
    return {
      routed: false,
      skipped: `${percent}% is outside the suite's ${followUpBandText(rule)} band.`,
    };
  }

  const application = one(attempt.applications);
  if (!application) return { routed: false, skipped: "The attempt's application is gone." };
  if (application.archived_at) {
    return { routed: false, skipped: "The candidate's record is archived." };
  }

  // Read the target through the service client: the router runs with no staff
  // session behind a submission or a cron sweep, and the rule's own tenant is
  // the only company boundary that matters here.
  const { data: targetRow } = await restClient
    .from("assessment_templates")
    .select("id, name, tenant_id, is_active, time_limit_minutes, assessment_questions(id)")
    .eq("id", rule.templateId)
    .maybeSingle();

  const target = targetRow as unknown as TargetTemplateRow | null;
  if (!target) {
    return { routed: false, skipped: "The suite this rule names no longer exists." };
  }
  if (target.tenant_id !== source.tenant_id) {
    return {
      routed: false,
      skipped: "The second test belongs to a different company from the first.",
    };
  }
  if (target.is_active === false) {
    return { routed: false, skipped: `“${target.name}” is paused, so no link was issued.` };
  }
  if ((target.assessment_questions ?? []).length === 0) {
    return { routed: false, skipped: `“${target.name}” has no questions, so no link was issued.` };
  }

  // Idempotency, first pass. The unique index below is what settles a race; this
  // read is what keeps the common re-grade from even trying to insert.
  const { data: routed } = await restClient
    .from("candidate_attempts")
    .select("id")
    .eq("follow_up_of_attempt_id", sourceAttemptId)
    .limit(1);
  if ((routed ?? []).length > 0) {
    return { routed: false, skipped: "This paper has already sent its follow-up." };
  }

  // The candidate may already hold or have finished the second suite — a
  // recruiter assigned it by hand, or an earlier rule sent them. One paper per
  // suite per application is the same rule `assignTemplate` applies.
  const { data: previous } = await restClient
    .from("candidate_attempts")
    .select("id")
    .eq("application_id", attempt.application_id)
    .eq("template_id", target.id)
    .limit(1);
  if ((previous ?? []).length > 0) {
    return {
      routed: false,
      skipped: `The candidate has already been sent “${target.name}”.`,
    };
  }

  const accessToken = randomBytes(32).toString("base64url");
  const { data: created, error: insertError } = await restClient
    .from("candidate_attempts")
    .insert({
      application_id: attempt.application_id,
      template_id: target.id,
      access_token: accessToken,
      status: "NOT_STARTED",
      time_limit_minutes: target.time_limit_minutes ?? 60,
      follow_up_of_attempt_id: sourceAttemptId,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { routed: false, skipped: "Another grading pass already issued this follow-up." };
    }
    console.error(
      `Follow-up issue failed for attempt ${sourceAttemptId}:`,
      insertError.message
    );
    return { routed: false, skipped: insertError.message };
  }

  const actor = await engineActivityActor("Assessment router");
  await recordActivity({
    ...actor,
    area: "assessments",
    action: "follow_up_assigned",
    entity: "attempt",
    entityId: (created as { id?: string } | null)?.id ?? null,
    summary: `${application.full_name ?? "The candidate"}'s “${source.name}” paper scored ${percent}% — inside ${followUpBandText(rule)} — so the “${target.name}” test was issued automatically`,
    detail: {
      source_attempt_id: sourceAttemptId,
      source_template_id: source.id,
      source_total: Number(attempt.total_score ?? 0),
      source_max: Number(attempt.max_score ?? 0),
      percent,
      band_min: rule.minPercent,
      band_max: rule.maxPercent,
      target_template_id: target.id,
      note: "The rule was written on the source suite, not by a recruiter reading this paper.",
    },
  });

  // The link is the point of the exercise, so the candidate is told on the same
  // channels a manual assignment uses. A relay refusing one message must not
  // undo the attempt that was already written.
  try {
    await notifyAssessmentInvite({
      applicationId: attempt.application_id,
      accessToken,
    });
  } catch (error) {
    console.error(`Follow-up invite for application ${attempt.application_id} failed:`, error);
  }
  try {
    await processDueWhatsAppJobs(1);
  } catch (error) {
    console.error("Follow-up WhatsApp drain failed:", error);
  }

  return { routed: true, target: target.name };
}
