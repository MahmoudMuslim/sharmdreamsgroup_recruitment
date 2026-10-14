import { getDashboardAnalytics } from "@/app/(admin)/dashboard/actions";
import { getCandidateList } from "@/app/(admin)/candidates/actions";
import {
  draftCandidateFeedback,
  screenApplication,
  updateApplicationStage,
  type PipelineStage,
} from "@/app/(admin)/candidates/candidate-actions";
import { getTemplates } from "@/app/(admin)/assessments/actions";
import { assignTemplate } from "@/app/(admin)/assessments/assessment-actions";
import {
  createJobOpening,
  deleteJobOpening,
  setJobStatus,
  updateJobOpening,
  type JobDraft,
} from "@/app/(admin)/jobs/job-actions";
import {
  getApplicantSubmission,
  getJobApplicants,
} from "@/app/(admin)/jobs/applicant-actions";
import {
  deleteProspect,
  getProspects,
  saveProspect,
  setProspectStage,
} from "@/app/(admin)/sourcing/actions";
import { cancelWhatsAppJob, getOutbox, queueWhatsAppMessage } from "@/app/(admin)/whatsapp/actions";
import { loadAuditLog, loadSettings, saveSettings } from "@/app/(admin)/settings/actions";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import {
  listModelRouting,
  saveModelRouting,
} from "@/modules/settings/application/credential-actions";
import { AI_CAPABILITIES } from "@/modules/settings/domain/providers";
import { SECTORS } from "@/modules/settings/domain/vocabularies";
import { getJobOpening, listJobOpenings } from "@/modules/assistant/infrastructure/reads";

/**
 * The assistant's tool registry.
 *
 * Every handler delegates to the server action the equivalent button on the
 * screen already calls, so the permission checks, validation, audit writes and
 * `revalidatePath` calls that protect those actions protect the chat too. The
 * assistant gets no private route into the database: if a recruiter cannot
 * publish a job from /jobs, they cannot publish one by asking for it here.
 *
 * Handlers return deliberately small payloads. The reply goes back into the
 * model's context, and a full `applications` row would spend the whole budget
 * on columns nobody asked about.
 */

export type ToolArgs = Record<string, unknown>;

export interface AssistantTool {
  name: string;
  /** Short human label, shown as a chip in the chat while the tool runs. */
  label: string;
  description: string;
  /** Argument name → "type — what it is". Rendered into the system prompt. */
  args: Record<string, string>;
  /** Refused unless the operator has switched destructive changes on. */
  destructive?: boolean;
  run: (args: ToolArgs) => Promise<unknown>;
}

/** Thrown for a bad argument so the model can read why and try again. */
class ToolArgumentError extends Error {}

function str(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolArgumentError(`"${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalStr(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolArgumentError(`"${key}" must be a string.`);
  return value.trim();
}

function num(args: ToolArgs, key: string): number {
  const value = args[key];
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new ToolArgumentError(`"${key}" must be a number.`);
  }
  return parsed;
}

function bool(args: ToolArgs, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ToolArgumentError(`"${key}" must be true or false.`);
}

function strArray(args: ToolArgs, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ToolArgumentError(`"${key}" must be an array of strings.`);
  }
  return value as string[];
}

/**
 * Passes a small action result straight back to the model.
 *
 * Kept whole on success because the ids and counts in it (`create_job`'s new
 * id, `save_settings`' list of saved keys) are what the assistant has to report;
 * normalised on failure so every refusal reads the same.
 */
function report<T extends { ok: boolean; error?: string }>(
  result: T
): T | { ok: false; error: string } {
  return result.ok ? result : { ok: false, error: result.error ?? "Refused." };
}

const STAGES = ["NEW", "AI_SCREENING", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];
const JOB_STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"];
const PROSPECT_STAGES = ["NEW", "CONTACTED", "REPLIED", "INTERVIEW", "CONVERTED", "PASSED"];

/** Everything `create_job` / `update_job` write, so both paths stay identical. */
function jobDraft(args: ToolArgs): JobDraft {
  const sector = str(args, "sector").toUpperCase();
  if (!SECTORS.includes(sector as (typeof SECTORS)[number])) {
    throw new ToolArgumentError(`"sector" must be one of: ${SECTORS.join(", ")}.`);
  }
  return {
    title: str(args, "title"),
    tenant_id: str(args, "tenant_id"),
    department: str(args, "department"),
    sector,
    location: str(args, "location"),
    employment_type: str(args, "employment_type").toUpperCase(),
    description: str(args, "description"),
    requirements: args.requirements === undefined ? [] : strArray(args, "requirements"),
    min_salary_usd: optionalStr(args, "min_salary_usd") ?? "",
    max_salary_usd: optionalStr(args, "max_salary_usd") ?? "",
    salary_currency: optionalStr(args, "salary_currency") ?? "USD",
    status: str(args, "status").toUpperCase(),
  };
}

/** Long free text is clipped before it goes back into the model's context. */
function clip(text: string | null, max = 4000): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  /* ------------------------------ Reads ------------------------------ */
  {
    name: "dashboard_analytics",
    label: "Reading hiring metrics",
    description:
      "Group-wide hiring analytics: totals, the stage funnel with conversion rates, channel effectiveness, AI fit-score distribution, 14-day application volume and time-to-hire trend.",
    args: {},
    run: async () => {
      const analytics = await getDashboardAnalytics();
      return {
        total_applications: analytics.total_applications,
        active_jobs: analytics.active_jobs,
        hires_this_quarter: analytics.hires_this_quarter,
        avg_fit_score: analytics.avg_fit_score,
        scored_applications: analytics.scored_applications,
        // When masked the two figures above are withheld, not zero — say so.
        scores_masked: analytics.scores_masked,
        avg_time_to_hire_days: analytics.avg_time_to_hire_days,
        pipeline: analytics.pipeline,
        channels: analytics.channels,
        fit_distribution: analytics.fit_distribution,
        time_to_hire_trend: analytics.time_to_hire_trend,
        applications_last_14_days: analytics.applications_last_14_days,
        top_candidates: analytics.candidates.slice(0, 10).map((candidate) => ({
          application_id: candidate.application_id,
          full_name: candidate.full_name,
          job_title: candidate.job_title,
          match_score: candidate.match_score,
          stage: candidate.stage,
        })),
      };
    },
  },
  {
    name: "list_jobs",
    label: "Reading job openings",
    description:
      "Every job opening with its status, department, location, salary band and applicant count.",
    args: {},
    run: async () => {
      const jobs = await listJobOpenings();
      return jobs.map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        department: job.department,
        location: job.location,
        employment_type: job.employment_type,
        sector: job.sector,
        salary: `${job.min_salary_usd ?? "?"}–${job.max_salary_usd ?? "?"} ${job.salary_currency ?? ""}`.trim(),
        applicants: job.applicants,
      }));
    },
  },
  {
    name: "get_job",
    label: "Reading one opening",
    description:
      "One opening in full, including its description and requirement list. Read this before editing so unchanged fields are not lost.",
    args: { job_id: "string — the opening's id from list_jobs" },
    run: async (args) => {
      const job = await getJobOpening(str(args, "job_id"));
      if (!job) return { ok: false, error: "No opening has that id." };
      return { ok: true, job };
    },
  },
  {
    name: "list_candidates",
    label: "Reading candidates",
    description:
      "The 50 most recent applications with their pipeline stage, AI match score, job, assessment attempt and tracking code.",
    args: {},
    run: async () => {
      const rows = await getCandidateList();
      return {
        // So a hidden score is never described to the recruiter as "not screened".
        scores_masked: rows[0]?.scores_masked ?? false,
        candidates: rows.map((row) => ({
          id: row.id,
          tracking_code: row.tracking_code,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          stage: row.stage,
          job_title: row.job_title,
          ai_match_score: row.ai_match_score,
          attempt_status: row.attempt_status,
          attempt_score: row.attempt_score,
          interviews: row.interviews.length,
        })),
      };
    },
  },
  {
    name: "get_job_applicants",
    label: "Reading applicants",
    description: "Everyone who applied to one opening, with their stage and assessment status.",
    args: { job_id: "string — the opening's id" },
    run: async (args) => {
      const result = await getJobApplicants(str(args, "job_id"));
      return result.ok ? result.applicants : { ok: false, error: result.error };
    },
  },
  {
    name: "get_application",
    label: "Reading one application",
    description:
      "What one candidate actually submitted: the CV text extracted from their file, a short-lived link to the file itself, and the AI screening summary.",
    args: { application_id: "string — the application's id" },
    run: async (args) => {
      const result = await getApplicantSubmission(str(args, "application_id"));
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        cv_text: clip(result.submission.cv_text),
        cv_url: result.submission.cv_url,
        screening_summary: clip(result.submission.screening_summary, 2000),
      };
    },
  },
  {
    name: "list_assessment_suites",
    label: "Reading assessment suites",
    description:
      "Every assessment suite with its question count, total points, time limit, whether it is active, and how many attempts it has.",
    args: {},
    run: async () => {
      const templates = await getTemplates();
      return templates.map((template) => ({
        id: template.id,
        name: template.name,
        role_family: template.role_family,
        is_active: template.is_active,
        question_count: template.question_count,
        total_points: template.total_points,
        time_limit_minutes: template.time_limit_minutes,
        attempts: template.attempts,
        completed: template.completed,
      }));
    },
  },
  {
    name: "list_prospects",
    label: "Reading sourcing pool",
    description: "The sourced-prospect pool with each prospect's stage, origin and linked opening.",
    args: {},
    run: async () => {
      const prospects = await getProspects();
      return prospects.slice(0, 100).map((prospect) => ({
        id: prospect.id,
        full_name: prospect.full_name,
        headline: prospect.headline,
        company: prospect.company,
        stage: prospect.stage,
        origin: prospect.origin,
        job_title: prospect.job_title,
        messages: prospect.messages,
      }));
    },
  },
  {
    name: "list_outbox",
    label: "Reading message outbox",
    description:
      "The WhatsApp outbox: queued and sent jobs with their status and attempts, plus the most recent delivery log.",
    args: {},
    run: async () => {
      const outbox = await getOutbox();
      return {
        queued: outbox.jobs.slice(0, 40).map((job) => ({
          id: job.id,
          candidate_name: job.candidate_name,
          recipient_phone: job.recipient_phone,
          status: job.status,
          attempts: job.attempts,
          scheduled_for: job.scheduled_for,
          sent_at: job.sent_at,
          error_log: job.error_log,
          text: clip(job.text, 300),
        })),
        recent_deliveries: outbox.history.slice(0, 15).map((row) => ({
          recipient: row.recipient,
          candidate_name: row.candidate_name,
          delivered: row.delivered,
          error_message: row.error_message,
          created_at: row.created_at,
        })),
      };
    },
  },
  {
    name: "get_settings",
    label: "Reading settings",
    description:
      "Organisation, assessment, security and AI settings currently in force, plus the staff roster, role permission grants and notification templates.",
    args: {},
    run: async () => {
      const bundle = await loadSettings();
      return {
        values: bundle.values,
        companies: bundle.companies.map((company) => ({
          id: company.id,
          name: company.name,
          sector: company.sector,
        })),
        staff: bundle.staff.map((member) => ({
          id: member.id,
          full_name: member.full_name,
          email: member.email,
          role: member.role,
        })),
        roles: bundle.roles.map((role) => role.key),
        permission_grants: bundle.grants
          .filter((grant) => grant.granted)
          .map((grant) => `${grant.role_key}:${grant.permission_key}`),
        notification_templates: bundle.templates.map((template) => ({
          key: template.key,
          channel: template.channel,
          is_active: template.is_active,
        })),
      };
    },
  },
  {
    name: "get_master_data",
    label: "Reading master data",
    description:
      "The picklists a job or prospect record must use: companies (with their id and sector), departments, locations, currencies, role families and skills. Needed before creating or editing a job.",
    args: {},
    run: () => getMasterOptions(),
  },
  {
    name: "list_model_routing",
    label: "Reading AI model routing",
    description:
      "Which model each AI capability is routed to, its fallback, temperature, max tokens and whether it is enabled.",
    args: {},
    run: async () => {
      const rows = await listModelRouting();
      return AI_CAPABILITIES.map((capability) => {
        const row = rows.find((entry) => entry.capability === capability.id);
        return {
          capability: capability.id,
          label: capability.label,
          description: capability.description,
          primary_model: row?.primaryModel ?? null,
          fallback_model: row?.fallbackModel ?? null,
          temperature: row?.temperature ?? null,
          max_tokens: row?.maxTokens ?? null,
          is_enabled: row?.isEnabled ?? null,
          configured: Boolean(row),
        };
      });
    },
  },
  {
    name: "get_audit_log",
    label: "Reading settings audit log",
    description: "The most recent settings changes: which key, previous value, new value, when.",
    args: { limit: "number — optional, defaults to 15, maximum 50" },
    run: async (args) => {
      const limit = args.limit === undefined ? 15 : Math.min(num(args, "limit"), 50);
      return loadAuditLog(limit);
    },
  },

  /* ------------------------------ Writes ----------------------------- */
  {
    name: "create_job",
    label: "Creating a job opening",
    description:
      "Create a job opening. Call get_master_data first for a valid tenant_id, department, location and currency.",
    args: {
      title: "string",
      tenant_id: "string — company id from get_master_data",
      department: "string — department name from get_master_data",
      sector: `string — one of ${SECTORS.join(", ")}`,
      location: "string — location name from get_master_data",
      employment_type: "string — FULL_TIME, PART_TIME, CONTRACT or INTERNSHIP",
      description: "string",
      requirements: "string[] — optional list of requirement lines",
      min_salary_usd: "string — optional number",
      max_salary_usd: "string — optional number",
      salary_currency: "string — optional 3-letter code, defaults to USD",
      status: `string — one of ${JOB_STATUSES.join(", ")}`,
    },
    run: async (args) => report(await createJobOpening(jobDraft(args))),
  },
  {
    name: "update_job",
    label: "Editing a job opening",
    description:
      "Rewrite a job opening. Every field is written, so read the opening with get_job first and send back the full record with only the intended changes.",
    args: {
      job_id: "string — the opening's id",
      title: "string",
      tenant_id: "string",
      department: "string",
      sector: "string",
      location: "string",
      employment_type: "string",
      description: "string",
      requirements: "string[]",
      min_salary_usd: "string — optional",
      max_salary_usd: "string — optional",
      salary_currency: "string — optional",
      status: "string",
    },
    run: async (args) => report(await updateJobOpening(str(args, "job_id"), jobDraft(args))),
  },
  {
    name: "set_job_status",
    label: "Changing a job's status",
    description:
      "Publish, pause or close an opening without touching any other field. Closing keeps applicants and their records.",
    args: {
      job_id: "string — the opening's id",
      status: `string — one of ${JOB_STATUSES.join(", ")}`,
    },
    run: async (args) =>
      report(await setJobStatus(str(args, "job_id"), str(args, "status").toUpperCase())),
  },
  {
    name: "screen_candidate",
    label: "Running AI screening",
    description:
      "Run the AI screening engine on one application now and store the score, decision, strengths and gaps.",
    args: { application_id: "string" },
    run: async (args) => screenApplication(str(args, "application_id")),
  },
  {
    name: "draft_candidate_feedback",
    label: "Drafting candidate feedback",
    description: "Write or refresh the personalised feedback draft for one application.",
    args: { application_id: "string" },
    run: async (args) => draftCandidateFeedback(str(args, "application_id")),
  },
  {
    name: "set_candidate_stage",
    label: "Moving a candidate's stage",
    description:
      "Move an application to another pipeline stage. Rejecting needs a reason of at least four characters. The candidate is notified on the channels Settings allows.",
    args: {
      application_id: "string",
      stage: `string — one of ${STAGES.join(", ")}`,
      reason: "string — required when stage is REJECTED",
    },
    run: async (args) => {
      const stage = str(args, "stage").toUpperCase() as PipelineStage;
      if (!STAGES.includes(stage)) {
        throw new ToolArgumentError(`"stage" must be one of: ${STAGES.join(", ")}.`);
      }
      return updateApplicationStage({
        applicationId: str(args, "application_id"),
        stage,
        reason: optionalStr(args, "reason"),
      });
    },
  },
  {
    name: "assign_assessment",
    label: "Assigning an assessment",
    description:
      "Issue an assessment attempt to one or more applications. Candidates who already have an open attempt on that suite are skipped. Everyone who gets a new attempt is then invited by the channels that are switched on, and the invitation carries the start link.",
    args: {
      template_id: "string — suite id from list_assessment_suites",
      application_ids: "string[] — application ids",
      time_limit_minutes: "number — between 5 and 480",
    },
    run: async (args) =>
      assignTemplate({
        templateId: str(args, "template_id"),
        applicationIds: strArray(args, "application_ids"),
        timeLimitMinutes: num(args, "time_limit_minutes"),
      }),
  },
  {
    name: "save_model_routing",
    label: "Changing AI model routing",
    description:
      "Point an AI capability at a different model. Model ids containing a slash go to OpenRouter; ids without one go to Google AI Studio. Takes effect on the next call.",
    args: {
      capability: "string — capability id from list_model_routing",
      primary_model: "string — model id",
      fallback_model: "string — optional model id",
      temperature: "number — 0 to 2",
      max_tokens: "number — 64 to 32000",
      is_enabled: "boolean",
    },
    run: async (args) => {
      const capability = str(args, "capability");
      if (!AI_CAPABILITIES.some((entry) => entry.id === capability)) {
        throw new ToolArgumentError(
          `"capability" must be one of: ${AI_CAPABILITIES.map((entry) => entry.id).join(", ")}.`
        );
      }
      return report(
        await saveModelRouting({
          capability,
          primaryModel: str(args, "primary_model"),
          fallbackModel: optionalStr(args, "fallback_model") ?? null,
          temperature: num(args, "temperature"),
          maxTokens: num(args, "max_tokens"),
          isEnabled: bool(args, "is_enabled", true),
        })
      );
    },
  },
  {
    name: "queue_whatsapp",
    label: "Queueing a WhatsApp message",
    description:
      "Queue a WhatsApp message to one candidate. Delivery depends on the WhatsApp channel being configured and the number being on Meta's allow-list.",
    args: {
      application_id: "string",
      text: "string — the message body",
      scheduled_for: "string — ISO date-time; use a past or near time to send now",
    },
    run: async (args) =>
      report(
        await queueWhatsAppMessage({
          applicationId: str(args, "application_id"),
          text: str(args, "text"),
          scheduledFor: str(args, "scheduled_for"),
        })
      ),
  },
  {
    name: "save_prospect",
    label: "Saving a prospect",
    description:
      "Create a sourced prospect, or edit one when id is given. Only the fields sent are written.",
    args: {
      id: "string — optional, present when editing",
      full_name: "string — at least two characters",
      headline: "string — optional",
      company: "string — optional",
      location: "string — optional",
      email: "string — optional",
      phone: "string — optional",
      linkedin_url: "string — optional, must be a linkedin.com/in/… link",
      notes: "string — optional",
      job_id: "string — optional opening to link",
    },
    run: async (args) => {
      const result = await saveProspect({
        id: optionalStr(args, "id"),
        full_name: str(args, "full_name"),
        headline: optionalStr(args, "headline") ?? null,
        company: optionalStr(args, "company") ?? null,
        location: optionalStr(args, "location") ?? null,
        email: optionalStr(args, "email") ?? null,
        phone: optionalStr(args, "phone") ?? null,
        linkedin_url: optionalStr(args, "linkedin_url") ?? null,
        notes: optionalStr(args, "notes") ?? null,
        job_id: optionalStr(args, "job_id") ?? null,
        origin: "MANUAL",
      });
      return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
    },
  },
  {
    name: "set_prospect_stage",
    label: "Moving a prospect's stage",
    description: "Move a sourced prospect to another stage in the sourcing pipeline.",
    args: {
      id: "string — prospect id",
      stage: `string — one of ${PROSPECT_STAGES.join(", ")}`,
    },
    run: async (args) => {
      const stage = str(args, "stage").toUpperCase();
      if (!PROSPECT_STAGES.includes(stage)) {
        throw new ToolArgumentError(`"stage" must be one of: ${PROSPECT_STAGES.join(", ")}.`);
      }
      return report(await setProspectStage(str(args, "id"), stage));
    },
  },
  {
    name: "save_settings",
    label: "Changing settings",
    description:
      "Change one or more settings keys. Only keys that already appear in get_settings are accepted; each change is written to the audit log.",
    args: { values: "object — setting key to new value, e.g. {\"ai.auto_advance_threshold\": 75}" },
    run: async (args) => {
      const values = args.values;
      if (typeof values !== "object" || values === null || Array.isArray(values)) {
        throw new ToolArgumentError('"values" must be an object of setting keys to values.');
      }
      return report(await saveSettings(values as Record<string, unknown>));
    },
  },

  /* --------------------------- Destructive ---------------------------- */
  {
    name: "delete_job",
    label: "Deleting a job opening",
    description:
      "Permanently delete a job opening. Refused once candidates have applied — close it instead.",
    args: { job_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteJobOpening(str(args, "job_id"))),
  },
  {
    name: "delete_prospect",
    label: "Deleting a prospect",
    description: "Permanently delete a sourced prospect and their outreach history link.",
    args: { id: "string — prospect id" },
    destructive: true,
    run: async (args) => report(await deleteProspect(str(args, "id"))),
  },
  {
    name: "cancel_outbox_message",
    label: "Cancelling a queued message",
    description: "Cancel a WhatsApp message that is still queued, so it is never sent.",
    args: { id: "string — outbox job id from list_outbox" },
    destructive: true,
    run: async (args) => report(await cancelWhatsAppJob(str(args, "id"))),
  },
];

export function toolByName(name: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.name === name);
}

export { ToolArgumentError };
