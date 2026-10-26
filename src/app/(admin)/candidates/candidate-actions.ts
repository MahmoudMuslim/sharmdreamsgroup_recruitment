"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { publicBaseUrl } from "@/lib/public-url";
import { requireStaff } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";
import { hasPermissionForUser, permissionsForCurrentUser } from "@/modules/settings/infrastructure/permissions";
import { getBoolSetting, getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
import {
  EmailConnector,
  type EmailOutboundMessage,
} from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  humanizeStage,
  renderTemplate,
  type TemplateVars,
} from "@/modules/settings/domain/templates";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { isApplicationSource } from "@/modules/candidates/domain/listFilters";
import {
  MISSING_ROW_ERROR,
  bulkStageSummaryMessage,
  planBulkStageMove,
  summarizeBulkStageMoves,
  type BulkStageRowOutcome,
} from "@/modules/candidates/domain/bulkStage";
import {
  alreadyOnFile,
  emailSpellings,
  normalizePersonEmail,
} from "@/modules/candidates/domain/personIdentity";
import {
  personField,
  visibleFields,
  type PersonField,
  type PersonFieldGroup,
  type PersonFieldTier,
} from "@/modules/candidates/domain/person-fields";
import {
  applyPersonField,
  defaultConsentChecker,
  recordPersonConsent,
  resolveOrCreatePerson,
  setPersonPhoto,
  PERSON_SPINE_MISSING_NOTE,
  type PersonFieldChange,
} from "@/modules/candidates/application/personWriter";
import {
  extractPersonProfileWithReport,
  describeExtractionFailure,
  type ExtractedPersonProfile,
} from "@/modules/candidates/infrastructure/cvProfileExtract";
import { extractCvText } from "@/modules/screening/infrastructure/cvParser";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  CV_MAX_BYTES,
  CV_TEXT_MIN_CHARS,
  CV_TYPE_ERROR,
  cvContentError,
  cvSizeError,
  isAcceptedCvType,
} from "@/modules/careers/cv-rules";
import {
  attachmentRule,
  personPhotoPath,
  photoContentError,
} from "@/modules/careers/attachment-rules";
import { HIREABLE_STATUSES, PICKER_LIMIT } from "@/modules/jobs/domain/hireable";
import { requireHireableOpening } from "@/modules/jobs/infrastructure/hireableOpening";
import { notifyStageChange, sendCandidateFeedbackLetter } from "@/modules/omnichannel/application/candidate-notifications";
import {
  draftRejectionReasonForApplication,
  generateFeedbackForApplication,
  screenApplicationById,
} from "@/modules/screening/application/screen-application";
import { recordActivity } from "@/modules/activity/application/record";
import type { WhatsAppOutboundMessage } from "@/types";

export interface BulkWhatsAppResult {
  ok: boolean;
  error?: string;
  queued?: number;
  skipped?: number;
  failed?: number;
}

/**
 * Sends a templated WhatsApp message to a selected set of applications.
 *
 * Placeholders in double braces are substituted per recipient so each message
 * names the right person and role. Candidates with no phone number are counted
 * as skipped rather than silently dropped, and a failure on one recipient never
 * blocks the rest of the batch. Every attempt is written to `communication_logs`
 * so the campaign appears on the outbox beside the automatic alerts.
 */
export async function sendBulkWhatsApp(input: {
  applicationIds: string[];
  templateKey: string;
  message: string;
}): Promise<BulkWhatsAppResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, error: "Select at least one candidate." };
  }
  if (ids.length > 200) {
    return { ok: false, error: "Send to at most 200 candidates at a time." };
  }

  const body = input.message?.trim();
  if (!body) {
    return { ok: false, error: "The message cannot be empty." };
  }

  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("applications")
    .select("id, full_name, phone, stage, job_openings(title), candidate_attempts(access_token)")
    .in("id", ids)
    .is("archived_at", null);

  if (error) {
    return { ok: false, error: error.message };
  }

  const siteUrl = await publicBaseUrl();
  const messages: WhatsAppOutboundMessage[] = [];
  const copies = new Map<string, { applicationId: string; body: string }>();
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
      id: string;
      full_name: string;
      phone: string | null;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
      candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
    };

    if (!application.phone) {
      skipped += 1;
      continue;
    }

    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    const attempt = Array.isArray(application.candidate_attempts)
      ? application.candidate_attempts[0]
      : application.candidate_attempts;

    const text = body
      .replace(/\{\{\s*candidate_name\s*\}\}/g, application.full_name)
      .replace(/\{\{\s*job_title\s*\}\}/g, job?.title ?? "the role")
      .replace(/\{\{\s*stage\s*\}\}/g, application.stage.replace(/_/g, " ").toLowerCase())
      .replace(
        /\{\{\s*assessment_link\s*\}\}/g,
        attempt?.access_token ? `${siteUrl}/test/${attempt.access_token}` : "your candidate portal"
      );

    messages.push({
      to: application.phone,
      text,
    });
    copies.set(application.phone, { applicationId: application.id, body: text });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have a phone number on file (${skipped} skipped).`,
    };
  }

  const outcome = await WhatsAppConnector.sendBulk(messages);

  // A campaign that leaves no history row is invisible twice over: the outbox
  // cannot show or retry it, and the candidate's portal inbox never saw it. The
  // notice is written whether or not Meta accepted the message — the inbox copy
  // is what survives a refused send.
  const inAppEnabled = await getBoolSetting("notifications.in_app_enabled", true);

  const { error: logError } = await restClient.from("communication_logs").insert(
    outcome.results.flatMap((result) => {
      const copy = copies.get(result.to);
      const row = {
        application_id: copy?.applicationId ?? null,
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        recipient: result.to,
        subject: null,
        body: copy?.body ?? "",
        delivered: result.success,
        error_message: result.error ?? null,
      };
      if (!inAppEnabled || !copy) return [row];
      return [row, { ...row, channel: "IN_APP", delivered: true, error_message: null }];
    })
  );

  if (logError) {
    console.error("[candidates] WhatsApp campaign could not be written to the send record:", logError.message);
  }

  await recordActivity({
    area: "messaging",
    action: "bulk_whatsapp",
    entity: "message",
    summary: `WhatsApp campaign to ${messages.length} candidate${messages.length === 1 ? "" : "s"} — ${outcome.success} accepted, ${outcome.failed} rejected${skipped ? `, ${skipped} without a number` : ""}${
      inAppEnabled ? `, ${messages.length} copied into the portal inbox` : ", no portal copy because in-app notices are switched off"
    }`,
    detail: {
      template_key: input.templateKey,
      recipients: messages.length,
      accepted: outcome.success,
      rejected: outcome.failed,
      skipped_no_phone: skipped,
      portal_copies: inAppEnabled ? messages.length : 0,
      body: "[withheld]",
    },
  });

  if (outcome.success === 0 && outcome.failed > 0) {
    return {
      ok: false,
      error: "WhatsApp rejected every message. Check the integration credentials.",
      failed: outcome.failed,
      skipped,
    };
  }

  return {
    ok: true,
    queued: outcome.success,
    failed: outcome.failed,
    skipped,
  };
}

export interface BulkEmailResult {
  ok: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
}

/**
 * Sends a written email campaign to a selected set of applications.
 *
 * Placeholders go through the same `renderTemplate` the Settings preview uses,
 * so what the recruiter reads in the drawer is what the candidate receives.
 * Every attempt lands in `communication_logs`, failures included — that is what
 * the outbox lists and re-sends from.
 */
export async function sendBulkEmail(input: {
  applicationIds: string[];
  subject: string;
  message: string;
}): Promise<BulkEmailResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Select at least one candidate." };
  if (ids.length > 200) return { ok: false, error: "Send to at most 200 candidates at a time." };

  const body = input.message?.trim();
  const subject = input.subject?.trim();
  if (!body) return { ok: false, error: "The message cannot be empty." };
  if (!subject) return { ok: false, error: "Email needs a subject line." };

  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("applications")
    .select("id, full_name, email, stage, job_openings(title), candidate_attempts(access_token)")
    .in("id", ids)
    .is("archived_at", null);

  if (error) return { ok: false, error: error.message };

  const companyName = await getStringSetting("organisation.name", "Sharm Dreams Group");
  const siteUrl = await publicBaseUrl();
  const messages: EmailOutboundMessage[] = [];
  const copies = new Map<string, { applicationId: string; subject: string; body: string }>();
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
      id: string;
      full_name: string;
      email: string | null;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
      candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
    };

    const to = application.email?.trim();
    if (!to) {
      skipped += 1;
      continue;
    }

    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    const attempt = Array.isArray(application.candidate_attempts)
      ? application.candidate_attempts[0]
      : application.candidate_attempts;

    const vars = {
      candidate_name: application.full_name,
      job_title: job?.title ?? "the role",
      stage: humanizeStage(application.stage),
      company_name: companyName,
      assessment_link: attempt?.access_token
        ? `${siteUrl}/test/${attempt.access_token}`
        : "your candidate portal",
      interview_when: "",
      interview_duration: "",
      interview_link: "",
    } satisfies TemplateVars;

    const renderedSubject = renderTemplate(subject, vars).trim();
    const renderedBody = renderTemplate(body, vars).trim();

    messages.push({ to, subject: renderedSubject, text: renderedBody });
    copies.set(to.toLowerCase(), {
      applicationId: application.id,
      subject: renderedSubject,
      body: renderedBody,
    });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have an email address on file (${skipped} skipped).`,
    };
  }

  const outcome = await EmailConnector.sendBulk(messages);

  // The row must carry the copy that was actually sent, not the template the
  // recruiter typed — the outbox re-sends from this body, and the portal notice
  // is the copy the candidate keeps when the relay refuses the email.
  const inAppEnabled = await getBoolSetting("notifications.in_app_enabled", true);

  const { error: logError } = await restClient.from("communication_logs").insert(
    outcome.results.flatMap((result) => {
      const copy = copies.get(result.to.toLowerCase());
      const row = {
        application_id: copy?.applicationId ?? null,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: result.to,
        subject: copy?.subject ?? subject,
        body: copy?.body ?? "",
        delivered: result.success,
        error_message: result.error ?? null,
      };
      if (!inAppEnabled || !copy) return [row];
      return [row, { ...row, channel: "IN_APP", delivered: true, error_message: null }];
    })
  );

  if (logError) {
    console.error("[candidates] Email campaign could not be written to the send record:", logError.message);
  }

  await recordActivity({
    area: "messaging",
    action: "bulk_email",
    entity: "message",
    summary: `Emailed ${messages.length} candidate${messages.length === 1 ? "" : "s"} — “${subject}” — ${outcome.success} delivered, ${outcome.failed} refused${skipped ? `, ${skipped} without an address` : ""}${
      inAppEnabled ? `, ${messages.length} copied into the portal inbox` : ", no portal copy because in-app notices are switched off"
    }`,
    detail: {
      subject,
      recipients: messages.length,
      delivered: outcome.success,
      refused: outcome.failed,
      skipped_no_email: skipped,
      portal_copies: inAppEnabled ? messages.length : 0,
      body: "[withheld]",
    },
  });

  if (outcome.success === 0) {
    return {
      ok: false,
      error: outcome.firstError ?? "The relay rejected every message.",
      failed: outcome.failed,
      skipped,
    };
  }

  return { ok: true, sent: outcome.success, failed: outcome.failed, skipped };
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

const PIPELINE_STAGES = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageResult {
  ok: boolean;
  error?: string;
  stage?: PipelineStage;
  /** True when Settings asked for a feedback draft to be written after this move. */
  auto_feedback?: boolean;
}

/**
 * Moves an application to another pipeline stage.
 *
 * Transitions are intentionally unrestricted — a recruiter must be able to
 * reject from any stage and reopen a rejected candidate — but rejecting
 * requires a stored reason, and hiring stamps `hired_at` so time-to-hire
 * analytics stay honest. Leaving REJECTED clears the stale reason.
 *
 * `notify` is the one switch a caller outside the single-row dialog needs. The
 * candidate notice is what this writer costs a person, so a caller moving a
 * batch says so and the notice stays home; leaving it out means "tell them",
 * which is what every existing caller wants.
 */
export async function updateApplicationStage(input: {
  applicationId: string;
  stage: PipelineStage;
  reason?: string;
  notify?: boolean;
}): Promise<StageResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  if (!PIPELINE_STAGES.includes(input.stage)) {
    return { ok: false, error: "Unknown pipeline stage." };
  }

  const reason = input.reason?.trim() ?? "";
  if (input.stage === "REJECTED" && reason.length < 4) {
    return {
      ok: false,
      error: "Add a short rejection reason — it is shown on the candidate's profile.",
    };
  }

  const restClient = await createServerRestClient();

  // Read before writing: the trail records the move as `Applied → Interview`,
  // and the row only holds the destination afterwards.
  const { data: before } = await restClient
    .from("applications")
    .select("stage, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();

  const { error } = await restClient
    .from("applications")
    .update({
      stage: input.stage,
      rejection_reason: input.stage === "REJECTED" ? reason : null,
      hired_at: input.stage === "HIRED" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId);

  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "candidates",
    action: "stage_move",
    entity: "application",
    entityId: input.applicationId,
    summary: `${before?.full_name ?? "A candidate"} moved from ${humanizeStage(before?.stage ?? "—")} to ${humanizeStage(input.stage)}${reason && input.stage === "REJECTED" ? ` — ${reason}` : ""}`,
    detail: {
      from: before?.stage ?? null,
      to: input.stage,
      ...(input.stage === "REJECTED" ? { reason } : {}),
    },
  });

  // The candidate is told about the move after the response is sent, on every
  // channel Settings → Notifications allows: WhatsApp goes through its queue and
  // is drained immediately, email is handed to the relay, and a portal notice is
  // recorded so the update survives a filtered inbox. A notification failure
  // never affects the stage move itself. A batch that did not opt in leaves both
  // automations alone — forty rows is forty letters and forty model calls.
  const notify = input.notify !== false;

  if (notify) {
    after(async () => {
      const report = await notifyStageChange(input.applicationId, input.stage);
      if (report.whatsapp === "queued") await processDueWhatsAppJobs(5);
    });
  }

  // Selection decisions get a feedback draft written after the response is
  // sent, so the recruiter is never kept waiting on a model call and a failed
  // generation never fails the stage move. Settings → AI & screening →
  // Personalised feedback switches this automation off; the "Draft feedback"
  // button stays available whatever the toggle says, because pressing it is a
  // deliberate request rather than an automatic follow-up.
  const autoFeedback =
    notify &&
    (input.stage === "REJECTED" || input.stage === "HIRED") &&
    (await getBoolSetting("ai.generate_feedback", true));

  if (autoFeedback) {
    after(() => generateFeedbackForApplication(input.applicationId).then(() => undefined));
  }

  /* The all-group table shows this row's stage and the dashboard counts where the
   * pipeline sits, so a move taken from anywhere has to invalidate both. Before
   * the opening's drawer wrote stages, only the table's own refresh hid the gap. */
  revalidatePath("/candidates");
  revalidatePath("/dashboard");

  return { ok: true, stage: input.stage, auto_feedback: autoFeedback };
}

export interface BulkStageResult {
  ok: boolean;
  error?: string;
  moved?: number;
  failed?: number;
  total?: number;
  /** One sentence the panel prints above the list. */
  message?: string;
  failures?: { name: string | null; error: string }[];
}

/**
 * Moves a selected set of applications to one stage.
 *
 * Each row still goes through `updateApplicationStage`, because that is where
 * the stage vocabulary, the rejection reason, the `hired_at` stamp, the activity
 * trail and the candidate notice live. A batch is not a second implementation of
 * those rules — it is one click repeating them — so it cannot drift from the
 * drawer's behaviour, and a row the single-row writer refuses reports the same
 * sentence here.
 *
 * Two things a single move never has to decide are decided here. The selection is
 * read once up front: a row that does not come back (archived, deleted, or filed
 * under a company this recruiter cannot see) is reported as not moved rather than
 * counted, since an update over a missing id answers without error. And the
 * notice is off unless the recruiter opted in — the writer's own default is
 * unchanged, so every one-row caller still tells the candidate.
 *
 * The writes run one after another on purpose. Fifty rows is a hundred-odd
 * gateway round-trips either way; firing them concurrently would only make the
 * fifty activity rows arrive in an order nobody can read.
 */
export async function moveApplicationsStageBulk(input: {
  applicationIds: readonly unknown[];
  stage: unknown;
  reason?: unknown;
  notify?: unknown;
}): Promise<BulkStageResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const plan = planBulkStageMove(input);
  if (!plan.ok) return { ok: false, error: plan.error };

  const restClient = await createServerRestClient();

  // Names come from this read so a refusal can say who it happened to.
  const { data, error } = await restClient
    .from("applications")
    .select("id, full_name")
    .in("id", plan.ids);

  if (error) return { ok: false, error: error.message };

  const rows = new Map<string, string>(
    (data ?? []).map((row) => {
      const application = row as { id: string; full_name: string };
      return [application.id, application.full_name];
    })
  );

  const outcomes: BulkStageRowOutcome[] = [];
  for (const applicationId of plan.ids) {
    if (!rows.has(applicationId)) {
      outcomes.push({ id: applicationId, name: null, ok: false, error: MISSING_ROW_ERROR });
      continue;
    }
    const result = await updateApplicationStage({
      applicationId,
      stage: plan.stage,
      ...(plan.reason === null ? {} : { reason: plan.reason }),
      notify: plan.notify,
    });
    outcomes.push({
      id: applicationId,
      name: rows.get(applicationId) ?? null,
      ok: result.ok,
      error: result.error ?? null,
    });
  }

  const summary = summarizeBulkStageMoves(outcomes);

  return {
    ok: true,
    moved: summary.moved,
    failed: summary.failed,
    total: summary.total,
    message: bulkStageSummaryMessage(summary, plan.stage),
    failures: summary.failures,
  };
}

export interface ScreenResult {
  ok: boolean;
  error?: string;
  score?: number;
  decision?: string;
  /** Present when the score thresholds moved the candidate on their own. */
  auto_stage?: "ASSESSMENT" | "REJECTED" | null;
}

/** Runs the AI screening engine on one application and stores the result. */
export async function screenApplication(applicationId: string): Promise<ScreenResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  return screenApplicationById(applicationId);
}

/** Writes (or refreshes) the personalized feedback draft for a candidate. */
export async function draftCandidateFeedback(applicationId: string): Promise<ScreenResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  return generateFeedbackForApplication(applicationId);
}

export interface RejectionReasonResult {
  ok: boolean;
  error?: string;
  reason?: string;
}

/**
 * Puts a drafted rejection reason in the reject panel's textarea.
 *
 * Returns text only. The reason reaches `applications.rejection_reason` through
 * `updateApplicationStage`, so the same rule applies whatever the model wrote:
 * rejecting needs a reason a recruiter chose, the trail row records the human
 * move, and the candidate is told on the channels Settings allows.
 */
export async function draftRejectionReason(
  applicationId: string
): Promise<RejectionReasonResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  return draftRejectionReasonForApplication(applicationId);
}

export interface SendFeedbackResult {
  ok: boolean;
  error?: string;
  recipient?: string;
  characters?: number;
  inApp?: "sent" | "off";
}

/**
 * Emails the stored feedback draft to the candidate, as written.
 *
 * Drafting and sending are two actions on purpose. The letter is generated from
 * the screening score, so a recruiter who fires off every draft the model wrote
 * would be sending machine prose to real people without reading it; the drawer
 * shows the same text this sends, so reading it is the step before the click.
 *
 * A failure is reported, never swallowed: "the letter was not sent" has to be
 * distinguishable from "the candidate was told", because the record now carries a
 * `communication_logs` row either way.
 */
export async function sendCandidateFeedback(
  applicationId: string
): Promise<SendFeedbackResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const result = await sendCandidateFeedbackLetter(applicationId);

  await recordActivity({
    area: "messaging",
    action: "feedback_sent",
    entity: "application",
    entityId: applicationId,
    summary: result.ok
      ? `Emailed the drafted feedback to ${result.recipient ?? "the candidate"} — ${result.characters} characters${
          result.inApp === "sent" ? ", copied into the portal inbox" : ", no portal copy because in-app notices are switched off"
        }`
      : `Feedback send refused — ${result.error ?? "the letter could not be delivered"}`,
    detail: {
      delivered: result.ok,
      recipient: result.recipient ?? null,
      characters: result.characters ?? 0,
      portal_copy: result.inApp === "sent",
      body: "[withheld]",
    },
  });

  // The outbox reads `communication_logs`, so the row this just wrote belongs on
  // it without a reload; /candidates refreshes the drawer's own state.
  revalidatePath("/candidates");
  revalidatePath("/whatsapp");

  return result;
}

/* -------------------------------------------------------------------------- */
/* Manual entry                                                                */
/* -------------------------------------------------------------------------- */

export interface ManualOpeningOption {
  id: string;
  title: string;
  department: string;
  status: string;
}

export interface ManualOpeningsResult {
  ok: boolean;
  error?: string;
  openings: ManualOpeningOption[];
  /** Openings the group can still hire for, counted by the database. */
  total: number;
}

/**
 * The openings a walk-in can be filed under.
 *
 * Read when the drawer opens rather than in the page render: recording someone
 * by hand is rare next to the table, and an extra query on every Candidates
 * load would tax it for everyone.
 *
 * The failure is reported rather than folded into an empty list — a recruiter
 * who saw no options would otherwise conclude the group has no openings.
 *
 * Closed roles are filtered out by the query, the same rule the sourcing
 * pickers apply: filing a person under a role the group stopped hiring for puts
 * them in a pipeline with no end, and every closed row on the list spends room
 * the hiring ones need. `total` is that filtered set's own count, so a dropdown
 * that ran out of room can say how many roles it dropped.
 */
export async function listManualOpenings(): Promise<ManualOpeningsResult> {
  await requireStaff("/candidates");
  const restClient = await createServerRestClient();

  const [rows, count] = await Promise.all([
    restClient
      .from("job_openings")
      .select("id, title, department, status")
      .in("status", [...HIREABLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(PICKER_LIMIT),
    restClient
      .from("job_openings")
      .select("id", { count: "exact", head: true })
      .in("status", [...HIREABLE_STATUSES]),
  ]);
  const { data, error } = rows;

  if (error) {
    console.error("[candidates] manual entry openings failed:", error.message);
    return { ok: false, error: error.message, openings: [], total: 0 };
  }

  return {
    ok: true,
    openings: (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      department: String(row.department ?? ""),
      status: String(row.status ?? "DRAFT"),
    })),
    total: count.count ?? 0,
  };
}

export interface CreatedCandidate {
  id: string;
  full_name: string;
  email: string;
  tracking_code: string;
  job_title: string;
}

/**
 * A hand-recorded person field, as the drawer sends it: a registry key and the
 * value. The door (`door`), the actor (`actorId` / `actorKind`) and the trust
 * rung are all stamped SERVER-SIDE from the session — a client-sent `door` could
 * otherwise promote itself to `privacy_page` (rung 40) or claim to be a
 * candidate, which is exactly the impersonation the precedence ladder exists to
 * refuse (spec §3.3). So the wire type is only key + value.
 */
export interface PersonFieldValue {
  key: string;
  value: unknown;
}

export interface CreateCandidateInput {
  jobId: string;
  fullName: string;
  email: string;
  phone?: string;
  source: string;
  /** A CV attached at the door; stored in `candidate-cvs` and read for `cv_text`. */
  cvFile?: File | null;
  /** A profile photo; stored in `candidate-photos` and named by `person_profiles.photo_path`. */
  photoFile?: File | null;
  /** Structured person fields the recruiter filled, keyed by registry key. */
  person?: PersonFieldValue[];
}

export interface CreateCandidateResult {
  ok: boolean;
  error?: string;
  candidate?: CreatedCandidate;
  /** Set when the address was already live in another opening — filed, not refused. */
  notice?: string | null;
  /**
   * One honest line about the person half: a migration-043 degrade note, or the
   * person/photo fields the door refused — named, with why they were refused.
   */
  note?: string | null;
}

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The title off an embedded `job_openings` row.
 *
 * PostgREST returns a to-one embed as an object, but an array is possible, and a
 * door that names an opening for a recruiter would rather read both shapes than
 * print a blank where a role name belongs.
 */
function embeddedTitle(job: unknown): string {
  const row = Array.isArray(job) ? job[0] : job;
  const title = (row as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "";
}

async function otherOpeningsOnFile(
  restClient: StaffClient,
  emailRaw: string,
  jobId: string
): Promise<string[]> {
  const { data } = await restClient
    .from("applications")
    .select("job_id, job_openings(title)")
    .in("email", emailSpellings(emailRaw))
    .is("archived_at", null)
    .neq("job_id", jobId)
    .limit(20);

  return (data ?? [])
    .map((row: Record<string, unknown>) => embeddedTitle(row.job_openings))
    .filter(Boolean);
}

/**
 * The extension→mime map the career-site apply path uses, so a CV filed at this
 * door is read for `cv_text` exactly as one uploaded from the public form. The
 * browser's declared type only follows the filename, so the stored extension is
 * the fallback and the magic-byte check below is the real answer.
 */
function cvMimeFromExt(ext: string): string {
  return ext === "pdf"
    ? "application/pdf"
    : ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : ext === "doc"
        ? "application/msword"
        : ext === "txt"
          ? "text/plain"
          : "application/pdf";
}

/** The stored leaf name: client path stripped, sanitised, bounded — as the upload route does. */
function cvLeaf(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "cv";
}

/**
 * Records an applicant who never came through the career site, and now finally
 * accepts the CV file, the photo and the structured person fields the owner's
 * record door needs (spec §4).
 *
 * The nine steps run in the spec's stated order, and the order is load-bearing:
 * the person half is resolved before a byte is written, so a rejected field never
 * leaves a CV sitting on disk under a path nobody references. Steps 4–8 are one
 * unit under the failure rule: if the `applications` insert fails after the CV
 * byte landed, the byte is removed before returning.
 *
 * Migration 043 is authored, NOT applied (spec §9). So on the local stack the
 * person half degrades: `resolveOrCreatePerson` says the tables are missing,
 * `personId` stays null, the photo and the structured fields refuse with the one
 * "Person details need migration 043." note, and the application row itself is
 * still created (that path exists today) with the CV landed. Only the person
 * write refuses — never the record.
 *
 * Nothing is messaged. The recruiter wrote this record; the candidate never
 * applied, so an auto-confirmed "thanks for your application" would be a lie.
 */
export async function createCandidate(input: CreateCandidateInput): Promise<CreateCandidateResult> {
  const staff = await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() ?? "";
  const source = isApplicationSource(input.source);

  if (fullName.length < 2) return { ok: false, error: "The name needs at least two characters." };
  if (fullName.length > 160) return { ok: false, error: "The name is too long." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email.length > 254) return { ok: false, error: "The email address is too long." };
  if (phone.length > 40) return { ok: false, error: "The phone number is too long." };
  if (!source) return { ok: false, error: "Pick where this applicant came from." };

  // — Step 2: validate the person changes against the registry + the caller's
  //   grants BEFORE any byte is stored. Unknown keys and fields whose Tier-3
  //   grant the recruiter lacks are refused here and never reach the writer. The
  //   door stamps the server-side trust; the client only supplied key + value.
  const granted = await permissionsForCurrentUser();
  const actorId = staff.profileId;
  const personChanges: PersonFieldChange[] = [];
  const personRefusals: { key: string; reason: string }[] = [];
  for (const entry of input.person ?? []) {
    const field = personField(entry.key);
    if (!field) {
      personRefusals.push({ key: entry.key, reason: "not a person-field key" });
      continue;
    }
    if (field.permission && !granted.has(field.permission)) {
      personRefusals.push({ key: entry.key, reason: `${field.label} needs the ${field.permission} grant` });
      continue;
    }
    personChanges.push({
      key: entry.key,
      value: entry.value,
      door: "hand_record",
      actorId,
      actorKind: "staff",
    });
  }

  // — Step 4 pre-flight: validate the CV bytes before they touch disk, so a
  //   refused file never lands and never needs the failure-rule cleanup.
  let cvBuffer: ArrayBuffer | null = null;
  let cvMime = "";
  let cvName = "";
  if (input.cvFile) {
    const file = input.cvFile;
    cvName = file.name;
    const cvExt = (file.name.split(".").pop() ?? "").toLowerCase();
    cvMime = file.type || cvMimeFromExt(cvExt);
    if (file.size === 0) return { ok: false, error: "The attached CV is empty." };
    if (file.size > CV_MAX_BYTES) return { ok: false, error: cvSizeError() };
    if (!isAcceptedCvType(cvMime)) return { ok: false, error: CV_TYPE_ERROR };
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const contentError = cvContentError(head, cvMime);
    if (contentError) return { ok: false, error: contentError };
    cvBuffer = await file.arrayBuffer();
  }

  // — Step 4 pre-flight (photo): same rule — validate bytes before disk. The
  //   path needs a person id, so a photo only proceeds once step 3 resolves one;
  //   an invalid photo refuses here, before anything else is written.
  let photoBuffer: ArrayBuffer | null = null;
  let photoMime = "";
  if (input.photoFile) {
    const file = input.photoFile;
    const photoRule = attachmentRule("candidate-photos");
    photoMime = file.type;
    if (file.size === 0) return { ok: false, error: "The attached photo is empty." };
    if (!photoRule) return { ok: false, error: "Photo storage is not configured." };
    if (file.size > photoRule.maxBytes) {
      return { ok: false, error: `That photo is larger than ${Math.round(photoRule.maxBytes / (1024 * 1024))} MB.` };
    }
    if (!(photoRule.allowedMimeTypes as readonly string[]).includes(photoMime)) {
      return { ok: false, error: photoRule.hint };
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const contentError = photoContentError(head, photoMime);
    if (contentError) return { ok: false, error: contentError };
    photoBuffer = await file.arrayBuffer();
  }

  // The opening is read through RLS before anything is written, so a recruiter can
  // only file someone under a role their own scope reaches — and a closed role is
  // refused here rather than merely left off the dropdown, because the assistant
  // records a candidate with no dropdown behind it at all.
  const restClient = await createServerRestClient();
  const opening = await requireHireableOpening(restClient, input.jobId);
  if (!opening.ok) return { ok: false, error: opening.error };

  // — Step 3: resolve the person the application belongs to. On a missing
  //   spine (043 not applied) `personId` stays null and the person half degrades
  //   with the one §9 note; the record still gets created below.
  let personId: string | null = null;
  let note: string | null = null;
  const normalizedEmail = normalizePersonEmail(email);
  if (normalizedEmail) {
    const resolved = await resolveOrCreatePerson(normalizedEmail, fullName, phone || null);
    if ("personId" in resolved) {
      personId = resolved.personId;
    } else {
      // A missing table degrades to the §9 note; any other resolution failure is
      // reported the same way so the record still lands — the person half simply
      // does not. Neither blocks the application, which exists without the spine.
      note = resolved.error;
    }
  }

  const files = await getFileStore();

  // — Step 4: store the CV in `candidate-cvs` at applications/<jobId>/<uuid>-<leaf>.
  let cvFilePath: string | null = null;
  if (cvBuffer) {
    cvFilePath = `applications/${input.jobId}/${crypto.randomUUID()}-${cvLeaf(cvName)}`;
    const { error } = await files.upload({
      bucket: "candidate-cvs",
      path: cvFilePath,
      body: cvBuffer,
      contentType: cvMime,
      upsert: false,
    });
    if (error) return { ok: false, error: "The CV could not be stored. Nothing was recorded." };
  }

  // — Step 5: extract `cv_text` with the apply path's silent-failure tolerance:
  //   a CV nobody can parse still leaves a record, it just leaves no text.
  let cvText: string | null = null;
  if (cvFilePath && cvBuffer) {
    try {
      const extracted = await extractCvText(Buffer.from(cvBuffer), cvMime);
      if (!extracted.empty) cvText = extracted.text;
    } catch (extractionError) {
      console.error("[candidates] hand-record CV extraction failed:", extractionError);
    }
  }

  // — Step 6: insert the application, linking the person when one was resolved.
  //   `person_id` is only sent when known, so an unapplied 043 does not turn the
  //   record insert itself into a schema error.
  const applicationValues: Record<string, unknown> = {
    job_id: input.jobId,
    full_name: fullName,
    email,
    phone: phone || null,
    source,
  };
  if (cvFilePath) applicationValues.cv_file_path = cvFilePath;
  if (cvText) applicationValues.cv_text = cvText;
  if (personId) applicationValues.person_id = personId;

  const { error } = await restClient.from("applications").insert(applicationValues);

  if (error) {
    // Failure rule: the byte landed but the record did not — remove it before
    // returning. A CV on disk that no application references is a file no
    // erasure path will find.
    if (cvFilePath) {
      await files.remove({ bucket: "candidate-cvs", paths: [cvFilePath] }).catch(() => undefined);
    }
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          alreadyOnFile({ openings: [], sameOpening: opening.title }).refusal ??
          "That address already has a live application for this opening.",
      };
    }
    return { ok: false, error: error.message };
  }

  // Read back what landed: PostgREST reports a write an RLS policy refused as a
  // success with no rows, so an insert that nothing answered is reported as a
  // failure rather than as a candidate the list never shows.
  const { data: created } = await restClient
    .from("applications")
    .select("id, full_name, email, tracking_code")
    .eq("job_id", input.jobId)
    .eq("email", email)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!created) {
    if (cvFilePath) {
      await files.remove({ bucket: "candidate-cvs", paths: [cvFilePath] }).catch(() => undefined);
    }
    return {
      ok: false,
      error: "The record was refused — this opening may sit outside your company's scope.",
    };
  }

  const candidate: CreatedCandidate = {
    id: String(created.id),
    full_name: String(created.full_name),
    email: String(created.email),
    tracking_code: String(created.tracking_code),
    job_title: opening.title,
  };

  // — Step 7: the photo, which needs the person id. Stored into `candidate-photos`
  //   and named by `person_profiles.photo_path`. No person → no photo path, so it
  //   refuses with the same §9 note rather than orphaning a byte.
  let photoStored = false;
  if (photoBuffer) {
    if (!personId) {
      note = note ?? PERSON_SPINE_MISSING_NOTE;
    } else {
      try {
        const photoPath = personPhotoPath(personId, photoMime);
        const { error: photoError } = await files.upload({
          bucket: "candidate-photos",
          path: photoPath,
          body: photoBuffer,
          contentType: photoMime,
          upsert: false,
        });
        if (photoError) {
          note = "The photo could not be stored; the record was still created.";
        } else {
          const stamped = await setPersonPhoto(personId, photoPath, photoMime);
          if ("error" in stamped) {
            await files.remove({ bucket: "candidate-photos", paths: [photoPath] }).catch(() => undefined);
            note = stamped.error;
          } else {
            photoStored = true;
          }
        }
      } catch {
        note = "The photo could not be stored; the record was still created.";
      }
    }
  }

  // — Step 8: apply the structured person changes through the one writer, at the
  //   `hand_record` rung. Consent, precedence and limits are enforced there (spec
  //   §3), so a hand-set value never gets silently overwritten and a field without
  //   its consent refuses, named. No person → every field refuses with the §9 note.
  let personFiled = 0;
  const personAppliedKeys: string[] = [];
  if (personChanges.length) {
    if (!personId) {
      for (const change of personChanges) {
        personRefusals.push({ key: change.key, reason: PERSON_SPINE_MISSING_NOTE });
      }
    } else {
      const consent = await defaultConsentChecker();
      const write = await applyPersonField(personId, personChanges, consent);
      if ("error" in write) {
        note = note ?? write.error;
      } else {
        personAppliedKeys.push(...write.applied);
        personFiled = write.applied.length;
        for (const refusal of write.refused) {
          personRefusals.push({ key: refusal.key, reason: refusal.reason });
        }
      }
    }
  }

  const noteLine = buildDoorNote(note, personRefusals, Boolean(cvFilePath), photoStored, personFiled);

  await recordActivity({
    area: "candidates",
    action: "candidate_create",
    entity: "application",
    entityId: candidate.id,
    summary: `Recorded ${candidate.full_name} by hand for ${opening.title} (${source.replace(/_/g, " ").toLowerCase()})${
      cvFilePath ? ", with a CV attached" : ""
    }${photoStored ? ", with a photo" : ""}${
      personFiled ? `, with ${personFiled} person field(s) filed` : ""
    }`,
    detail: {
      job_id: input.jobId,
      email: candidate.email,
      phone: phone || null,
      source,
      stage: "NEW",
      tracking_code: candidate.tracking_code,
      cv_attached: Boolean(cvFilePath),
      photo_attached: photoStored,
      person_id: personId,
      person_fields_filed: personFiled,
      person_fields_applied: personAppliedKeys,
      person_fields_refused: personRefusals.map((r) => r.key),
    },
  });

  // Three consoles read this row: the table, the openings' applicant counts and
  // the pipeline figures on the dashboard. The person half reaches the profile
  // page, so that too revalidates.
  revalidatePath("/candidates");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath(`/candidates/${candidate.id}`);

  const notice = alreadyOnFile({
    openings: await otherOpeningsOnFile(restClient, input.email, input.jobId),
    sameOpening: null,
  }).notice;

  return { ok: true, candidate, notice, note: noteLine };
}

/**
 * One honest sentence for the person half of the record — the §9 note, a refused-
 * fields count, or a confirmation the CV/photo landed. A recruiter must never be
 * left guessing whether a structured field they typed actually saved.
 */
function buildDoorNote(
  baseNote: string | null,
  refusals: { key: string; reason: string }[],
  cvStored: boolean,
  photoStored: boolean,
  personFiled: number
): string | null {
  const parts: string[] = [];
  if (baseNote) parts.push(baseNote);
  if (cvStored) parts.push("The CV is attached and will be read for screening.");
  if (photoStored) parts.push("The photo is stored on the profile.");
  if (personFiled) parts.push(`${personFiled} person field(s) saved.`);
  if (refusals.length) {
    const migration = refusals.filter((r) => r.reason === PERSON_SPINE_MISSING_NOTE).length;
    if (migration) parts.push(`${migration} person field(s) need migration 043.`);
    const other = refusals.filter((r) => r.reason !== PERSON_SPINE_MISSING_NOTE);
    if (other.length) {
      // Spec §9: a refused field refuses *named*. A count alone leaves the
      // recruiter guessing which answer did not save.
      const named = other.map((r) => personField(r.key)?.label ?? r.key).slice(0, 6).join(", ");
      const more = other.length > 6 ? ` +${other.length - 6} more` : "";
      parts.push(
        `${other.length} person field(s) were refused — ${named}${more} — usually because that group has no live consent yet.`
      );
    }
  }
  return parts.length ? parts.join(" ") : null;
}

/* -------------------------------------------------------------------------- */
/* Structure it from the CV (spec §5 — it is a click, never a side effect)     */
/* -------------------------------------------------------------------------- */

/** What the preview shows a recruiter before anything is written. */
export interface ExtractPreviewSummary {
  applicationId: string;
  /** N roles, M schools, … — the headline the drawer prints. */
  counts: { roles: number; schools: number; languages: number; skills: number; certifications: number };
  /** The validated profile, so `commitExtractionPreview` writes exactly what was previewed. */
  profile: ExtractedPersonProfile;
  /** Fields the extractor returned that it is not allowed to write, named (spec §5:857). */
  dropped: string[];
}

export interface ExtractPreviewResult {
  ok: boolean;
  error?: string;
  preview?: ExtractPreviewSummary;
}

/**
 * Reads a record's stored `cv_text` through the extractor and returns a preview.
 *
 * Nothing writes (spec §5). A free-tier chain that 429s mid-read must not be on
 * the critical path of a record, and a recruiter filing a name and email must not
 * have a person's CV sent to a model they never asked for — so this is the one
 * deliberate click, and its result only previews.
 *
 * It needs a person: an extraction fills empty fields on the profile, and with
 * the spine not applied (`person_id` null) there is nothing to fill, so the
 * refuse names migration 043 rather than running a model call for no target.
 */
export async function structurePersonFromCv(applicationId: string): Promise<ExtractPreviewResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();
  const { data, error: readError } = await restClient
    .from("applications")
    .select("full_name, email, cv_text, person_id")
    .eq("id", applicationId)
    .maybeSingle();

  // A missing `person_id` column is the unapplied spine, not a missing record:
  // the read re-checks existence without it, so a live record degrades to the
  // §9 note and a gone one still says so (spec §9 — reads degrade, never a
  // fabricated fact about a person). With no person there is nothing for an
  // extraction to fill, so the refuse lands before any model call.
  if (readError && isMissingSchemaError(readError)) {
    const { data: exists } = await restClient
      .from("applications")
      .select("id")
      .eq("id", applicationId)
      .maybeSingle();
    return { ok: false, error: exists ? PERSON_SPINE_MISSING_NOTE : "This candidate record is no longer here." };
  }

  if (!data) return { ok: false, error: "This candidate record is no longer here." };
  const row = data as { full_name: string; email: string; cv_text: string | null; person_id: string | null };

  if (!row.person_id) {
    return { ok: false, error: PERSON_SPINE_MISSING_NOTE };
  }

  // An extraction is its own processing purpose (spec §3.2): handing the CV to a
  // model needs the candidate's agreement on record, and a refusal is the same
  // gate as a missing answer. The free-tier chain below would otherwise read a
  // document on the strength of a persona the candidate never agreed to share.
  const consent = await defaultConsentChecker();
  if (!(await consent.consentAlive(row.person_id, "extraction"))) {
    return {
      ok: false,
      error:
        "This CV cannot be handed to a model yet: the candidate has not agreed to the CV-structuring notice, or agreed against an older version. Record the answer on their profile first.",
    };
  }

  const cvText = (row.cv_text ?? "").trim();
  if (cvText.length < CV_TEXT_MIN_CHARS) {
    return { ok: false, error: "This record has no CV text to structure yet. Attach a CV first." };
  }

  let extracted: { value: ExtractedPersonProfile; dropped: string[] };
  try {
    extracted = await extractPersonProfileWithReport(cvText, { name: row.full_name, email: row.email });
  } catch (error) {
    return { ok: false, error: describeExtractionFailure(error) };
  }

  return {
    ok: true,
    preview: {
      applicationId,
      counts: {
        roles: extracted.value.experience.length,
        schools: extracted.value.education.length,
        languages: extracted.value.languages.length,
        skills: extracted.value.skills.length,
        certifications: extracted.value.certifications.length,
      },
      profile: extracted.value,
      dropped: extracted.dropped,
    },
  };
}

/**
 * Turns a validated `ExtractedPersonProfile` (camelCase) into the collection rows
 * `applyPersonField` appends (snake_case, per the writer's column whitelists).
 *
 * The names meet only here: the extractor's whole point is dates as
 * `startYear`/`startMonth` numbers, and the store's columns are `start_year`/
 * `start_month`. The writer trims and case-folds duplicates itself, so the exact
 * `PERSON_FIELDS` `employment`/`education`/… keys are what append to the matching
 * collections, and `current_city` carries the one scalar the extractor returns.
 */
function extractionChanges(
  profile: ExtractedPersonProfile,
  actorId: string | null
): PersonFieldChange[] {
  const changes: PersonFieldChange[] = [];
  const stamp = (key: string, value: unknown): PersonFieldChange => ({
    key,
    value,
    door: "cv_extraction",
    actorId,
    actorKind: "extractor",
  });

  if (profile.experience.length) {
    changes.push(
      stamp(
        "employment",
        profile.experience.map((e) => ({
          employer: e.employer,
          title: e.title,
          location: e.location,
          start_year: e.startYear,
          start_month: e.startMonth,
          end_year: e.endYear,
          end_month: e.endMonth,
          ongoing: e.ongoing,
          duties: e.duties,
          as_written: e.asWritten,
        }))
      )
    );
  }
  if (profile.education.length) {
    changes.push(
      stamp(
        "education",
        profile.education.map((e) => ({
          institution: e.institution,
          level: e.level,
          degree: e.degree,
          field: e.field,
          graduation_year: e.graduationYear,
          gpa: e.gpa,
          honors: e.honors,
          as_written: e.asWritten,
        }))
      )
    );
  }
  if (profile.languages.length) {
    changes.push(stamp("languages", profile.languages.map((l) => ({ language: l.language, proficiency: l.proficiency }))));
  }
  if (profile.skills.length) {
    changes.push(
      stamp("skills", profile.skills.map((s) => ({ skill: s.skill, proficiency: s.proficiency, as_written: s.asWritten })))
    );
  }
  if (profile.certifications.length) {
    changes.push(
      stamp(
        "certifications",
        profile.certifications.map((c) => ({ title: c.title, issuer: c.issuer, year: c.year, as_written: c.asWritten }))
      )
    );
  }
  if (profile.location) {
    changes.push(stamp("current_city", profile.location));
  }
  return changes;
}

export interface CommitPreviewInput {
  applicationId: string;
  profile: ExtractedPersonProfile;
}

export interface CommitPreviewResult {
  ok: boolean;
  error?: string;
  applied?: string[];
  refused?: { key: string; reason: string }[];
  conflicts?: { key: string; held: string; incoming: string; winner: string }[];
}

/**
 * Writes a confirmed extraction at the `cv_extraction` rung (spec §5).
 *
 * The recruiter pressed "Structure it", read the preview and confirmed it, so the
 * values cross into the store now — but only into empty fields. An extractor may
 * fill what the person does not yet hold and never overwrite a recruiter's row,
 * because `cv_extraction` sits at rung 10 (spec §3.3) and the writer enforces
 * that; a collection a human already filled conflicts and the held rows win.
 *
 * The `profile` arrives back from the preview rather than being re-read, so a
 * second model call is never spent re-extracting what the recruiter just
 * approved — and what is written is exactly what was shown.
 */
export async function commitExtractionPreview(input: CommitPreviewInput): Promise<CommitPreviewResult> {
  const staff = await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();
  const { data, error: readError } = await restClient
    .from("applications")
    .select("person_id")
    .eq("id", input.applicationId)
    .maybeSingle();

  // Re-read server-side — the client's person id is never trusted. A missing
  // column re-reads without it, so a live record still answers honestly: an
  // extraction writes at the person level only, and with no spine there is no
  // person to write to (spec §9 refuses with the note; §5 fills a person's
  // empty fields, and an absent profile has none).
  let personId: string | null | undefined;
  if (readError && isMissingSchemaError(readError)) {
    const { data: withoutPerson } = await restClient
      .from("applications")
      .select("id")
      .eq("id", input.applicationId)
      .maybeSingle();
    if (!withoutPerson) return { ok: false, error: "This candidate record is no longer here." };
    personId = null;
  } else if (!data) {
    return { ok: false, error: "This candidate record is no longer here." };
  } else {
    personId = (data as { person_id: string | null }).person_id;
  }
  if (!personId) return { ok: false, error: PERSON_SPINE_MISSING_NOTE };

  const changes = extractionChanges(input.profile, staff.profileId);
  if (changes.length === 0) {
    return { ok: true, applied: [], refused: [], conflicts: [] };
  }

  const consent = await defaultConsentChecker();
  const result = await applyPersonField(personId, changes, consent);
  if ("error" in result) return { ok: false, error: result.error };

  await recordActivity({
    area: "candidates",
    action: "person_extract",
    entity: "application",
    entityId: input.applicationId,
    summary: `Structured the CV into ${result.applied.length} person section(s) for the candidate${
      result.refused.length ? `, ${result.refused.length} refused` : ""
    }${result.conflicts.length ? `, ${result.conflicts.length} already held by a human` : ""}`,
    detail: {
      person_id: personId,
      applied: result.applied,
      refused: result.refused.map((r) => r.key),
      conflicts: result.conflicts.map((c) => c.key),
    },
  });

  revalidatePath(`/candidates/${input.applicationId}`);
  revalidatePath("/candidates");

  return {
    ok: true,
    applied: result.applied,
    refused: result.refused,
    conflicts: result.conflicts,
  };
}

/* -------------------------------------------------------------------------- */
/* The drawer's person fields (generated from the registry, not hand-mirrored) */
/* -------------------------------------------------------------------------- */

/** One registry field, pared to what the drawer needs to render its control. */
export interface DrawerPersonField {
  key: string;
  label: string;
  group: PersonFieldGroup;
  tier: PersonFieldTier;
  input: "text" | "date" | "number" | "select" | "textarea";
  options?: readonly string[];
  maxChars?: number;
}

export interface DrawerPersonFieldsResult {
  ok: boolean;
  error?: string;
  /** The fields this recruiter may see, Tier-3 sections gated by their grants. */
  fields: DrawerPersonField[];
}

/**
 * The structured person fields the record drawer should render.
 *
 * Built from `visibleFields(granted)` (spec §2) so the controls are generated
 * from the registry rather than mirrored by hand: a Tier-3 group shows only for
 * its grant-holder, and a field added to the registry appears here without a
 * drawer change. List-collection fields and the photo are excluded from the hand
 * form — the CV extractor and the photo control own those, and a quick walk-in
 * record is not where a recruiter types an employment history by hand.
 *
 * Read when the drawer opens, not on every Candidates load, exactly like the
 * openings picker. The fields always come from the pure registry, so they are
 * offered whatever the migration state; the door refuses with the §9 note when
 * 043 is not applied (spec §9).
 */
export async function listDrawerPersonFields(): Promise<DrawerPersonFieldsResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission.", fields: [] };
  }

  const granted = await permissionsForCurrentUser();
  const excluded = new Set<string>([
    "legal_name",
    "phone",
    "photo_path",
    "photo_mime",
    "employment",
    "education",
    "languages",
    "skills",
    "certifications",
    "dependants",
    "emergency_contacts",
  ]);

  const fields: DrawerPersonField[] = visibleFields(granted)
    .filter((field) => field.input !== "list" && field.input !== "photo" && !excluded.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      group: field.group,
      tier: field.tier,
      input: field.input as DrawerPersonField["input"],
      ...(field.options ? { options: field.options } : {}),
      ...(field.maxChars ? { maxChars: field.maxChars } : {}),
    }));

  return { ok: true, fields };
}

/* -------------------------------------------------------------------------- */
/* The profile desk: hand edits and the candidate's consent answers             */
/* -------------------------------------------------------------------------- */

/** The fourteen purposes 043's CHECK admits, in the notice's own order. */
const CONSENT_PURPOSES: readonly PersonFieldGroup[] = [
  "identity",
  "contact",
  "photo",
  "work_history",
  "education",
  "languages",
  "skills",
  "marital_status",
  "family_details",
  "dependants",
  "emergency_contacts",
  "health",
  "housing",
  "extraction",
];

type WritablePerson =
  | { ok: true; personId: string }
  | { ok: false; error: string };

/**
 * The person profile a desk write targets, resolved server-side.
 *
 * `applications.person_id` is preferred and `person_emails` is the fallback, for
 * the same reason the profile reader falls back: an application row written
 * before 043's backfill still carries the address that owns the person. A missing
 * column is the unapplied spine, and it is named rather than reported as "no
 * person" — the two mean different things to whoever reads the refusal.
 */
async function resolveWritablePerson(applicationId: string): Promise<WritablePerson> {
  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("applications")
    .select("person_id, email")
    .eq("id", applicationId)
    .maybeSingle();

  if (error && isMissingSchemaError(error)) {
    return { ok: false, error: PERSON_SPINE_MISSING_NOTE };
  }
  if (error) return { ok: false, error: `The record could not be read: ${error.message}` };
  if (!data) return { ok: false, error: "This candidate record is no longer here." };

  const row = data as { person_id?: string | null; email?: string | null };
  if (row.person_id) return { ok: true, personId: row.person_id };

  const email = (row.email ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "This record is not linked to a person profile yet." };
  }

  const { data: owned, error: ownedError } = await restClient
    .from("person_emails")
    .select("person_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (isMissingSchemaError(ownedError)) {
    return { ok: false, error: PERSON_SPINE_MISSING_NOTE };
  }
  if (ownedError) return { ok: false, error: `The person lookup failed: ${ownedError.message}` };

  const personId = (owned as { person_id?: string | null } | null)?.person_id ?? null;
  if (!personId) {
    return {
      ok: false,
      error:
        "This record is not linked to a person profile yet. Record the candidate again, or apply 043's backfill, before editing their details.",
    };
  }
  return { ok: true, personId };
}

/** One scalar value coerced to what its column takes, or the reason it cannot be. */
function coercePersonValue(
  field: PersonField,
  raw: string
): { ok: true; value: string | number | null } | { ok: false; reason: string } {
  const trimmed = raw.trim();

  if (field.maxChars && trimmed.length > field.maxChars) {
    return { ok: false, reason: `That is longer than ${field.maxChars} characters.` };
  }
  if (trimmed === "") return { ok: true, value: null };

  if (field.input === "select") {
    const allowed = field.options ?? [];
    return allowed.includes(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false, reason: `"${trimmed}" is not one of the answers this field accepts.` };
  }

  if (field.input === "number") {
    const n = Number(trimmed);
    return Number.isInteger(n)
      ? { ok: true, value: n }
      : { ok: false, reason: "This field takes a whole number." };
  }

  if (field.input === "date") {
    const stamp = Date.parse(`${trimmed}T00:00:00Z`);
    const real =
      /^\d{4}-\d{2}-\d{2}$/.test(trimmed) &&
      Number.isFinite(stamp) &&
      new Date(stamp).toISOString().startsWith(trimmed);
    return real
      ? { ok: true, value: trimmed }
      : { ok: false, reason: "This field takes a date as YYYY-MM-DD." };
  }

  return { ok: true, value: trimmed };
}

export interface PersonFieldDraft {
  key: string;
  value: string;
}

export interface SavePersonFieldsInput {
  applicationId: string;
  fields: PersonFieldDraft[];
}

export interface SavePersonFieldsResult {
  ok: boolean;
  error?: string;
  applied?: string[];
  refused?: { key: string; reason: string }[];
  conflicts?: { key: string; held: string; incoming: string; winner: string }[];
}

/**
 * Writes a recruiter's hand edits at the `profile_edit` rung.
 *
 * Only the fields the form actually changed are sent, so an untouched value is
 * never rewritten: rewriting it would stamp an event that says a person changed
 * something they did not. Every key is resolved through the registry first (an
 * unknown key is refused, not written), the value is coerced to its column's own
 * shape, and then `applyPersonField` owns consent, the precedence ladder and the
 * event — this door decides no sensitivity and no precedence itself.
 *
 * A group without a live consent is refused by the writer and named back to the
 * caller; the desk records the candidate's answer through `savePersonConsent`,
 * never by writing a guess here.
 */
export async function savePersonFields(input: SavePersonFieldsInput): Promise<SavePersonFieldsResult> {
  const staff = await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    return { ok: false, error: "There is nothing to save." };
  }

  const target = await resolveWritablePerson(input.applicationId);
  if (!target.ok) return { ok: false, error: target.error };

  const changes: PersonFieldChange[] = [];
  const refused: { key: string; reason: string }[] = [];

  for (const draft of input.fields) {
    const field = personField(draft.key);
    if (!field) {
      refused.push({ key: draft.key, reason: "This is not a field the profile desk can write." });
      continue;
    }
    if (field.input === "list" || field.input === "photo") {
      refused.push({ key: draft.key, reason: "This field is not written one value at a time." });
      continue;
    }

    const coerced = coercePersonValue(field, typeof draft.value === "string" ? draft.value : "");
    if (!coerced.ok) {
      refused.push({ key: draft.key, reason: coerced.reason });
      continue;
    }

    changes.push({
      key: field.key,
      value: coerced.value,
      door: "profile_edit",
      actorId: staff.profileId,
      actorKind: "staff",
    });
  }

  if (changes.length === 0) {
    return { ok: false, error: "None of these fields could be saved.", refused };
  }

  const consent = await defaultConsentChecker();
  const result = await applyPersonField(target.personId, changes, consent);
  if ("error" in result) return { ok: false, error: result.error, refused };

  const allRefused = [...refused, ...result.refused];
  const applied = result.applied;

  await recordActivity({
    area: "candidates",
    action: "person_edit",
    entity: "application",
    entityId: input.applicationId,
    summary: `Edited ${applied.length} person field${applied.length === 1 ? "" : "s"} by hand${
      allRefused.length ? `, ${allRefused.length} refused` : ""
    }${result.conflicts.length ? `, ${result.conflicts.length} held by a higher door` : ""}`,
    detail: {
      person_id: target.personId,
      applied,
      refused: allRefused.map((r) => r.key),
      conflicts: result.conflicts.map((c) => c.key),
    },
  });

  if (applied.length) {
    revalidatePath(`/candidates/${input.applicationId}`);
    revalidatePath("/candidates");
  }

  return { ok: true, applied, refused: allRefused, conflicts: result.conflicts };
}

export interface SavePersonConsentInput {
  applicationId: string;
  purpose: PersonFieldGroup;
  granted: boolean;
}

export interface SavePersonConsentResult {
  ok: boolean;
  error?: string;
}

/**
 * Records what the candidate said about one notice at the recruitment desk.
 *
 * Append-only, like every consent trail on this platform: a withdrawal is a later
 * `granted: false` row, never an edit, and nothing here decides that the answer
 * is acceptable — the writer's gate reads the newest row. The door refuses to
 * take an answer for a purpose the notice vocabulary does not carry, so a typo
 * cannot mint a fifteenth purpose the database would then reject.
 */
export async function savePersonConsent(input: SavePersonConsentInput): Promise<SavePersonConsentResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }
  if (!CONSENT_PURPOSES.includes(input.purpose)) {
    return { ok: false, error: "That is not a consent purpose this desk records." };
  }

  const target = await resolveWritablePerson(input.applicationId);
  if (!target.ok) return { ok: false, error: target.error };

  const result = await recordPersonConsent(
    target.personId,
    input.purpose,
    input.granted === true,
    "profile_edit"
  );
  if ("error" in result) return { ok: false, error: result.error };

  const granted = input.granted === true;
  await recordActivity({
    area: "candidates",
    action: "person_consent",
    entity: "application",
    entityId: input.applicationId,
    summary: `Recorded the candidate's ${granted ? "agreement to" : "refusal of"} the ${input.purpose.replace(/_/g, " ")} notice`,
    detail: { person_id: target.personId, purpose: input.purpose, granted },
  });

  revalidatePath(`/candidates/${input.applicationId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Contact details                                                             */
/* -------------------------------------------------------------------------- */

/** The same pattern the public apply form enforces, so an edit cannot store
 *  an address the candidate could never have submitted. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CandidateContact {
  full_name: string;
  email: string;
  phone: string | null;
}

export interface ContactResult {
  ok: boolean;
  error?: string;
  /** What the row now holds, after trimming and lowercasing. */
  contact?: CandidateContact;
  /** Set when the new address is already live in another opening. */
  notice?: string | null;
}

/**
 * Corrects the name, email or phone a candidate arrived with.
 *
 * A typo in a CV upload or a changed number is the one thing a recruiter must
 * be able to fix before the first call goes out, because every notice, bulk
 * message and portal sign-in reads these columns. Normalising here matches the
 * apply flow: name trimmed, email trimmed and lowercased, blank phone stored as
 * null so "no number on file" stays one value rather than two. Only these three
 * columns are touched — stage, job, tracking code and the AI columns each have
 * an action with the right side effects.
 */
export async function updateCandidateContact(input: {
  applicationId: string;
  fullName: string;
  email: string;
  phone?: string;
}): Promise<ContactResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() ?? "";

  if (fullName.length < 2) return { ok: false, error: "The name needs at least two characters." };
  if (fullName.length > 160) return { ok: false, error: "The name is too long." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email.length > 254) return { ok: false, error: "The email address is too long." };
  if (phone.length > 40) return { ok: false, error: "The phone number is too long." };

  const restClient = await createServerRestClient();

  // The row as it stands, including the opening it sits in: the same address in
  // that opening is the duplicate the database refuses, and the same address in
  // any *other* opening is the profile this edit just joined.
  const { data: contactBefore } = await restClient
    .from("applications")
    .select("full_name, email, phone, job_id, job_openings(title)")
    .eq("id", input.applicationId)
    .maybeSingle();

  const { data, error } = await restClient
    .from("applications")
    .update({
      full_name: fullName,
      email,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .select("full_name, email, phone");

  const rowJobId = String((contactBefore as { job_id?: unknown } | null)?.job_id ?? "");
  const rowOpening = embeddedTitle(
    (contactBefore as { job_openings?: unknown } | null)?.job_openings
  );

  if (error) {
    // `applications_one_live_per_job` keeps one live application per address per
    // opening, so a merge of two duplicate rows surfaces here rather than as a
    // raw constraint name.
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          alreadyOnFile({ openings: [], sameOpening: rowOpening }).refusal ??
          "That email already has a live application for this opening.",
      };
    }
    return { ok: false, error: error.message };
  }

  const stored = data?.[0] as CandidateContact | undefined;
  if (!stored) {
    return { ok: false, error: "This candidate record is no longer here." };
  }

  const previous = {
    name: contactBefore?.full_name ?? null,
    email: contactBefore?.email ?? null,
    phone: contactBefore?.phone ?? null,
  };
  const current = { name: stored.full_name, email: stored.email, phone: stored.phone ?? null };

  const edits: Record<string, string> = {};
  for (const field of ["name", "email", "phone"] as const) {
    if ((previous[field] ?? "") !== (current[field] ?? "")) {
      edits[field] = `${previous[field] ?? "—"} → ${current[field] ?? "—"}`;
    }
  }

  await recordActivity({
    area: "candidates",
    action: "contact_edit",
    entity: "application",
    entityId: input.applicationId,
    summary: `Contact details corrected on ${stored.full_name}${
      Object.keys(edits).length ? ` (${Object.keys(edits).join(", ")})` : " — nothing actually changed"
    }`,
    detail: edits,
  });

  revalidatePath("/candidates");

  // Only an address that actually changed can join a profile, so a name fix on
  // someone who happens to be in two openings is not reported as a merge.
  const notice =
    previous.email !== null && previous.email !== current.email
      ? alreadyOnFile({
          openings: rowJobId ? await otherOpeningsOnFile(restClient, input.email, rowJobId) : [],
          sameOpening: null,
        }).notice
      : null;

  return { ok: true, contact: stored, notice };
}

/* -------------------------------------------------------------------------- */
/* Archive                                                                     */
/* -------------------------------------------------------------------------- */

export interface ArchiveResult {
  ok: boolean;
  error?: string;
  /** What `archived_at` holds after the write — null means restored. */
  archived_at?: string | null;
}

/**
 * Files a candidate out of the pipeline, or brings them back.
 *
 * This is the only way a candidate record leaves the console, and it is
 * deliberately not a delete. The row keeps its answers, its scores and every
 * notice already sent to that person, so the group can still account for a real
 * applicant — and a recruiter who filed the wrong person restores them with one
 * click. `updated_at` moves with the write so the audit trail shows when.
 *
 * Two things stop an archive, because both would otherwise leave a live door
 * attached to an invisible record: an open assessment link the candidate can
 * still click (submitting it would write into a hidden pipeline), and an
 * interview still on the calendar (it would vanish from the agenda while the
 * candidate is told about it). Both already have their own controls — revoke
 * the link, cancel the interview — so the refusal names them.
 */
export async function setCandidateArchive(input: {
  applicationId: string;
  archived: boolean;
}): Promise<ArchiveResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();

  const { data: application } = await restClient
    .from("applications")
    .select("id, archived_at, full_name")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "This candidate no longer exists." };

  if (input.archived && !application.archived_at) {
    const [{ count: openAttempts }, { count: bookedInterviews }] = await Promise.all([
      restClient
        .from("candidate_attempts")
        .select("id", { count: "exact", head: true })
        .eq("application_id", input.applicationId)
        .in("status", ["NOT_STARTED", "IN_PROGRESS"]),
      restClient
        .from("interview_schedules")
        .select("id", { count: "exact", head: true })
        .eq("application_id", input.applicationId)
        .eq("status", "SCHEDULED"),
    ]);

    if (openAttempts) {
      return {
        ok: false,
        error:
          "This candidate holds an open assessment link. Revoke it in the drawer first, so the link cannot write into a hidden record.",
      };
    }
    if (bookedInterviews) {
      return {
        ok: false,
        error:
          "This candidate has an interview on the calendar. Record its outcome or cancel it first.",
      };
    }
  }

  const archivedAt = input.archived ? new Date().toISOString() : null;
  const { data, error } = await restClient
    .from("applications")
    .update({ archived_at: archivedAt, updated_at: new Date().toISOString() })
    .eq("id", input.applicationId)
    .select("archived_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This candidate record is no longer here." };

  await recordActivity({
    area: "candidates",
    action: input.archived ? "archive" : "restore",
    entity: "application",
    entityId: input.applicationId,
    summary: `${application.full_name ?? "A candidate"} ${
      input.archived
        ? "filed out of the pipeline — hidden from the boards and the dashboard, still on record"
        : "brought back into the pipeline"
    }`,
    detail: { archived_at: archivedAt, previous_archived_at: application.archived_at },
  });

  // The filed row leaves the dashboard KPIs, the job boards and the candidate
  // table in the same breath, so all three re-render.
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/jobs");

  return { ok: true, archived_at: data.archived_at ?? null };
}