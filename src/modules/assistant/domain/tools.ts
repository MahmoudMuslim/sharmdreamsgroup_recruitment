import { getDashboardAnalytics } from "@/app/(admin)/dashboard/actions";
import { getCandidateList, getCandidateTally } from "@/app/(admin)/candidates/actions";
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
  getProspectPool,
  importProspects,
  saveProspect,
  setProspectStage,
} from "@/app/(admin)/sourcing/actions";
import {
  PROSPECT_STAGES,
  poolScopeNote,
  prospectSearchWords,
  searchPool,
  type ProspectStage,
} from "@/app/(admin)/sourcing/pool-model";
import { cancelWhatsAppJob, getOutbox, queueWhatsAppMessage } from "@/app/(admin)/whatsapp/actions";
import {
  OUTBOX_BUCKETS,
  emailScopeNote,
  emailSearchWords,
  outboxScopeNote,
  queueSearchWords,
  searchEmails,
  searchQueue,
  type OutboxBucket,
} from "@/app/(admin)/whatsapp/outbox-model";
import { loadAuditLog, loadSettings, saveSettings } from "@/app/(admin)/settings/actions";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import {
  getModelCatalogue,
  listModelRouting,
  saveModelRouting,
} from "@/modules/settings/application/credential-actions";
import { AI_CAPABILITIES } from "@/modules/settings/domain/providers";
import {
  modelReadNote,
  modelSearchWords,
  searchModels,
} from "@/modules/settings/domain/modelSearch";
import { SECTORS } from "@/modules/settings/domain/vocabularies";
import { JOB_STATUSES, openingReadNote } from "@/modules/jobs/domain/hireable";
import { openingSearchWords, searchOpenings } from "@/modules/jobs/domain/openingSearch";
import {
  APPLICATION_SOURCES,
  PIPELINE_STAGES,
  candidateScopeNote,
  candidateSearchWords,
  filterCandidates,
} from "@/modules/candidates/domain/listFilters";
import {
  companyNameById,
  getJobOpening,
  listJobOpenings,
  type JobReadFilter,
} from "@/modules/assistant/infrastructure/reads";
import { CHART_VIEWS, chartForView, isChartView } from "@/modules/assistant/domain/charts";
import { reachNote } from "@/modules/assistant/domain/reach-note";
import {
  getQuestionsForEditor,
  getTemplateDetail,
} from "@/app/(admin)/assessments/actions";
import {
  searchSuites,
  suiteReadNote,
  suiteSearchWords,
} from "@/modules/assessment/domain/suiteSearch";
import {
  deleteTemplate,
  saveTemplate,
  setTemplateActive,
} from "@/app/(admin)/assessments/assessment-actions";
import {
  deleteQuestion,
  moveQuestion,
  saveQuestion,
  type ChoiceDraft,
  type QuestionDraft,
} from "@/app/(admin)/assessments/question-actions";
import {
  deleteAttempt,
  extendAttemptLink,
  reissueAttemptLink,
  revokeAttempt,
} from "@/app/(admin)/candidates/attempt-actions";
import {
  getAttemptGrades,
  retryAttemptGrading,
  scoreAttemptResponse,
} from "@/app/(admin)/candidates/assessment-actions";
import { deleteAttachment } from "@/app/(admin)/candidates/attachment-actions";
import {
  createCandidate,
  sendBulkEmail,
  sendBulkWhatsApp,
  sendCandidateFeedback,
  setCandidateArchive,
  updateCandidateContact,
} from "@/app/(admin)/candidates/candidate-actions";
import { getCandidateDossier } from "@/app/(admin)/candidates/dossier-actions";
import { readAttachmentAsCv, readRecordCv } from "@/app/(admin)/candidates/cv-actions";
import {
  generateInterviewGuide,
  rescheduleInterview,
  scheduleInterview,
  setInterviewStatus,
} from "@/app/(admin)/candidates/interview-actions";
import {
  deleteGateQuestion,
  getGateConsoleData,
  moveGateQuestion,
  saveGateQuestion,
  setGateQuestionActive,
} from "@/app/(admin)/apply-questions/actions";
import { deleteStoredFile, getFileBrowserData, openFolder } from "@/app/(admin)/files/actions";
import {
  fileSearchWords,
  folderReadNote,
  searchFiles,
} from "@/app/(admin)/files/file-search";
import { BUCKETS } from "@/app/(admin)/files/file-browser-types";
import { LIST_LIMIT } from "@/app/(admin)/files/storage-list";
import { getInterviewAgenda } from "@/app/(admin)/interviews/actions";
import {
  AGENDA_CHAT_ROW_LIMIT,
  agendaReadNote,
  agendaWindowDays,
} from "@/app/(admin)/interviews/agenda-model";
import { getOnboardingData } from "@/app/(admin)/onboarding/actions";
import { generateOnboardingPlan } from "@/app/(admin)/onboarding/onboarding-actions";
import { deleteTask, saveTask, setTaskCompleted } from "@/app/(admin)/onboarding/task-actions";
import {
  deleteNotificationTemplate,
  resetNotificationTemplate,
  saveNotificationTemplate,
  updateRolePermission,
} from "@/app/(admin)/settings/actions";
import { convertProspect, sendProspectOutreach } from "@/app/(admin)/sourcing/actions";
import { getProspectProfile, pasteProspectProfile } from "@/app/(admin)/sourcing/profile-actions";
import { getAnalyticsReport } from "@/app/(admin)/analytics/actions";
import { getRowReport } from "@/app/(admin)/reports/actions";
import { REPORTS } from "@/modules/analytics/domain/documents";
import { ANALYTICS_WINDOWS } from "@/modules/analytics/domain/report";
import {
  getEmailOutbox,
  resendEmailMessage,
  retryWhatsAppJob,
  updateWhatsAppJob,
} from "@/app/(admin)/whatsapp/actions";
import {
  createMasterRecord,
  deleteMasterRecord,
  updateMasterRecord,
} from "@/modules/settings/application/master-data-actions";
import {
  deleteStaffAccount,
  loadStaffConsole,
  setStaffActive,
  updateStaffCompany,
  updateStaffDetails,
  updateStaffRole,
} from "@/modules/settings/application/user-actions";
import { TASK_CATEGORIES, TASK_OWNERS } from "@/app/(admin)/onboarding/checklist";
import type { GateOption } from "@/modules/careers/gate-questions";
import type { AssignableStaffRole, MasterEntity, MasterPayload } from "@/modules/settings/domain/types";
import type { QuestionConfig, QuestionType } from "@/types";

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

/** Ids reach the database as ids, so a name typed into an id argument is refused here. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An id that is shaped like one, or `null` when the argument was left out.
 *
 * A company *name* passed as an id would otherwise reach Postgres and come back
 * as "invalid input syntax for type uuid" — true, but useless to a model that has
 * to retry. This says which argument is wrong and what it wants.
 */
function optionalId(args: ToolArgs, key: string): string | null {
  const value = optionalStr(args, key);
  if (value === undefined) return null;
  if (!UUID_SHAPE.test(value)) {
    throw new ToolArgumentError(
      `"${key}" must be an id exactly as a read tool returned it — 36 characters, dashes included.`
    );
  }
  return value;
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

/**
 * Rows one answer lists.
 *
 * A tool result is clipped to 6000 characters on the way back to the model, and
 * a JSON blob cut mid-row reads to the model as a shorter list, not a broken
 * one. Every list tool bounds its own answer with this and says so in its scope
 * note, so the number named is the number the recruiter is told about.
 */
const ANSWER_ROWS = 50;

/**
 * The other caps in this registry, named so each one's read can quote it.
 *
 * `ANSWER_ROWS` covers the list tools that filter a set; these four bound the
 * long tails hanging off a single record — a dossier's message history, the
 * hires still without a checklist, one folder's files, the openings a gate
 * question can be scoped to.
 */
const DOSSIER_ALERT_ROWS = 20;
const UNPLANNED_HIRE_ROWS = 20;
const FOLDER_FILE_ROWS = 60;
const ROOT_FILE_ROWS = 40;
const GATE_JOB_ROWS = 40;

/**
 * Rows one catalogue answer lists.
 *
 * Below `ANSWER_ROWS` because a model row carries a qualified id, two prices and
 * a context length, and fifty of them overflow the clip a result is cut at — a
 * cut reads to the model as a shorter list, not a broken one.
 */
const MODEL_ROWS = 30;

/**
 * The storage cap sitting behind a folder answer, said once for both listings.
 *
 * `folderReadNote` can only describe the rows the tool was handed; this is the
 * fact one level out — the listing itself stopped counting, so every file number
 * in the answer is a floor rather than the folder.
 */
function listingCapNote(truncated: boolean): string {
  return truncated
    ? ` The listing that filled this answer stops at ${LIST_LIMIT.toLocaleString()} entries, so the total it counted is itself a floor.`
    : "";
}

/**
 * An optional argument that has to name one of a set.
 *
 * Refused rather than ignored: the pages let a bad `?stage=` narrow nothing so a
 * recruiter never loses rows by accident, but a model that typed the wrong word
 * needs the list back, not an empty answer it will report as "none".
 */
function optionalChoice(args: ToolArgs, key: string, words: readonly string[]): string | null {
  const value = optionalStr(args, key);
  if (value === undefined) return null;
  const upper = value.toUpperCase();
  if (!words.includes(upper)) {
    throw new ToolArgumentError(`"${key}" must be one of: ${words.join(", ")}.`);
  }
  return upper;
}

/** The set an openings read counted, in the words its scope note quotes back. */
function openingScopeWords(filter: JobReadFilter, company: string | null = null): string {
  const at = company ? ` at ${company}` : "";
  if (!filter) return `openings${at}`;
  return filter === "HIREABLE"
    ? `openings you can still hire for${at}`
    : `openings marked ${filter}${at}`;
}

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

/* ----------------------------- Argument readers ----------------------------- */

/** An array of objects, e.g. a multiple-choice question's options. */
function objArray(args: ToolArgs, key: string): Record<string, unknown>[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "object" || entry === null)) {
    throw new ToolArgumentError(`"${key}" must be an array of objects.`);
  }
  return value as Record<string, unknown>[];
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function flagField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value === true || value === "true";
}

/** `[{ text, is_correct }, …]` as the question editor expects it. */
function choiceDrafts(args: ToolArgs): ChoiceDraft[] {
  return objArray(args, "options").map((option) => ({
    text: textField(option, "text"),
    is_correct: flagField(option, "is_correct"),
  }));
}

/** `[{ label, passes }, …]` as the viability gate expects it. */
function gateOptions(args: ToolArgs): GateOption[] {
  return objArray(args, "options").map((option) => ({
    label: textField(option, "label"),
    passes: option.passes === undefined ? true : flagField(option, "passes"),
  }));
}

const QUESTION_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "CASE_STUDY", "EXCEL_MODEL", "VIDEO_PITCH"];
const STAFF_ROLES: AssignableStaffRole[] = ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"];
const INTERVIEW_OUTCOMES = ["COMPLETED", "NO_SHOW", "CANCELLED"] as const;
const MASTER_ENTITIES: MasterEntity[] = [
  "companies",
  "departments",
  "locations",
  "role_families",
  "skills",
  "currencies",
];

function questionType(value: string): QuestionType {
  const upper = value.toUpperCase();
  if (!QUESTION_TYPES.includes(upper as QuestionType)) {
    throw new ToolArgumentError(
      `"question_type" must be one of: ${QUESTION_TYPES.join(", ")}. Got "${value}".`
    );
  }
  return upper as QuestionType;
}

/**
 * The question as the editor's own draft shape.
 *
 * `saveQuestion` writes the whole row, so a half-filled call would blank the
 * prompt of an existing question. The fields a caller cannot know — the type
 * config for a spreadsheet task — come back as `preserve_config`, and the tool
 * description tells the model to read the question first and send that object
 * straight back.
 */
function questionDraftFrom(args: ToolArgs): QuestionDraft {
  const type = questionType(str(args, "question_type"));
  const options = type === "MULTIPLE_CHOICE" ? choiceDrafts(args) : [];
  if (type === "MULTIPLE_CHOICE" && !args.options) {
    throw new ToolArgumentError(
      '"options" is required for a MULTIPLE_CHOICE question: [{"text","is_correct"}, …].'
    );
  }

  return {
    id: optionalStr(args, "id") ?? null,
    template_id: str(args, "template_id"),
    question_type: type,
    title: str(args, "title"),
    prompt: str(args, "prompt"),
    instructions: optionalStr(args, "instructions") ?? "",
    points: num(args, "points"),
    position: args.position === undefined ? 0 : num(args, "position"),
    time_limit_minutes:
      args.time_limit_minutes === undefined ? null : num(args, "time_limit_minutes"),
    shuffle_options: bool(args, "shuffle_options", false),
    options,
    context: optionalStr(args, "context") ?? "",
    min_words: args.min_words === undefined ? null : num(args, "min_words"),
    min_duration_seconds:
      args.min_duration_seconds === undefined ? null : num(args, "min_duration_seconds"),
    max_duration_seconds:
      args.max_duration_seconds === undefined ? null : num(args, "max_duration_seconds"),
    preserve_config:
      args.preserve_config && typeof args.preserve_config === "object"
        ? (args.preserve_config as QuestionConfig)
        : null,
  };
}

/** One ISO date-time, refused before it reaches an action that would store garbage. */
function isoDateTime(args: ToolArgs, key: string): string {
  const value = str(args, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolArgumentError(
      `"${key}" must be an ISO date-time carrying its own offset, e.g. 2026-11-02T10:30:00Z or 2026-11-02T10:30:00+03:00.`
    );
  }
  return parsed.toISOString();
}

/* ------------------------------- Questions ------------------------------- */

/**
 * A question the recruiter answers by choosing, rather than by typing.
 *
 * It is a value object, not a tool result: the chat renders it as buttons, both
 * engine loops end their turn on it, and it is stored inside the step it belongs
 * to so a conversation reopened tomorrow still shows what was on offer.
 */
export interface AssistantQuestion {
  question: string;
  /** Why the assistant is asking, when it explained itself. */
  context: string | null;
  options: string[];
}

const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 90;

/**
 * Reads `ask_question`'s arguments into an `AssistantQuestion`.
 *
 * A model that offers three choices and sends two blank strings, or one that
 * pastes a paragraph as an option, would put unusable buttons on screen, so the
 * list is trimmed, length-capped and refused below two real answers.
 */
export function questionFrom(args: ToolArgs): AssistantQuestion {
  const question = str(args, "question").replace(/\s+/g, " ");
  const raw = args.options;
  if (!Array.isArray(raw)) {
    throw new ToolArgumentError('"options" must be an array of 2 to 6 short answers.');
  }

  const options = raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, MAX_OPTION_CHARS))
    .filter((entry) => entry.length > 0 && entry !== "…")
    .slice(0, MAX_OPTIONS);

  if (options.length < 2) {
    throw new ToolArgumentError(
      `"options" needs at least two non-empty answers, got ${options.length}.`
    );
  }

  const context = optionalStr(args, "context");
  return { question, context: context ? clip(context.replace(/\s+/g, " "), 600) : null, options };
}

/** The same shape read back out of a tool result, or null when it is not one. */
export function asQuestion(value: unknown): AssistantQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== false && typeof record.question === "string" && Array.isArray(record.options)) {
    const options = record.options
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, MAX_OPTIONS);
    if (options.length >= 2) {
      return {
        question: record.question.trim(),
        context: typeof record.context === "string" ? record.context : null,
        options,
      };
    }
  }
  return null;
}

/**
 * The question as the model sees it on the next turn.
 *
 * The chat renders the choices as buttons, but the history sent back to the
 * model is only message text — so the numbered list has to be in the stored
 * reply, otherwise the recruiter's one-line answer arrives with nothing to
 * answer.
 */
export function questionAsReply(ask: AssistantQuestion): string {
  const lead = ask.context ? `${ask.context}\n\n${ask.question}` : ask.question;
  return `${lead}\n\nChoose one:\n${ask.options
    .map((option, index) => `${index + 1}. ${option}`)
    .join("\n")}`;
}

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  /* ------------------------------ Questions ----------------------------- */
  {
    name: "ask_question",
    label: "Asking you to choose",
    description:
      "Stop and ask the recruiter to pick between 2 to 6 short answers, shown as buttons under your question. Use it when a request could mean several records — the real names from a read tool, never invented ones. This ends the turn: their choice arrives as the next message, so do not answer it yourself.",
    args: {
      question: "string — what you need decided, one line",
      options: `string[] — 2 to ${MAX_OPTIONS} short answers (under ${MAX_OPTION_CHARS} characters each) drawn from a tool result`,
      context: "string — optional, why you are asking",
    },
    run: async (args) => ({ ok: true, ...questionFrom(args) }),
  },

  /* ------------------------------ Reads ------------------------------ */
  {
    name: "dashboard_analytics",
    label: "Reading hiring metrics",
    description:
      "Group-wide hiring analytics: totals, the pipeline as stage-by-stage populations with each stage's share of live applications, channel effectiveness, AI fit-score distribution, 14-day application volume and time-to-hire trend. Read `pipeline_note` and `candidates_note` before describing either: the stage figures are who sits somewhere now, not who moved. Pass `chart` when the answer is a shape — the chart is drawn from these figures on the recruiter's screen, not from anything you write, so say what it shows instead of reciting every row.",
    args: {
      chart: `string — optional, draw one of ${CHART_VIEWS.join(", ")} as a chart under your answer`,
    },
    run: async (args) => {
      const analytics = await getDashboardAnalytics();
      const requested = typeof args.chart === "string" ? args.chart.trim().toLowerCase() : "";
      const result: Record<string, unknown> = {
        // Both caveats lead, because a long result is clipped before the model
        // reads it and a sentence that falls off the end was never said.
        //
        // A stage count read as a transition is the oldest lie on this board, so
        // the read says what the figures are before the model can guess.
        pipeline_note: `${analytics.total_applications} live applications, each sitting at exactly one stage. These are current populations, not moves: vs_previous_stage compares two counts taken now, and Rejected carries none because it closes applications at every stage. Never describe any of these as a conversion rate.`,
        // The board's read is capped and ranked, and a masked caller is not
        // ranked at all — so name which ten these are instead of calling them
        // "top" and letting the count be inferred.
        candidates_note: `These ${Math.min(10, analytics.candidates.length)} of the ${analytics.candidates.length} applications the board loads (${analytics.total_applications} live in the pipeline) are the ${
          analytics.scores_masked ? "newest, because fit scores are masked for you" : "best-matching by AI fit"
        }.`,
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

      if (!requested) return result;
      // A bad view name is a mistake about an option, not a failed read: the
      // figures above still answer the question, so this reports the choice that
      // exists rather than refusing the call.
      if (!isChartView(requested)) {
        return {
          ...result,
          chart_error: `No chart is called “${requested}”. Draw one of: ${CHART_VIEWS.join(", ")}.`,
        };
      }
      const build = chartForView(requested, result);
      if (!build.chart) {
        // The reason travels, so the reply says the picture could not be drawn
        // and why, instead of leaving a gap the recruiter fills in themselves.
        return { ...result, chart_view: requested, chart_unavailable: build.reason };
      }
      return { ...result, chart_view: requested };
    },
  },
  {
    name: "get_report",
    label: "Reading a report table",
    description:
      "One row-level report from /reports — the same list the page shows and every CSV, Excel and PDF export is built from. Returns the columns, the first rows and the caveats that list carries, so a figure quoted from here is quoted with what it leaves out. Totals come from dashboard_analytics; this is the detail behind them.",
    args: {
      report: `string — one of ${REPORTS.map((report) => report.id).join(", ")}`,
      window: `string — one of ${ANALYTICS_WINDOWS.map((option) => option.key).join(", ")}, where all is every record`,
    },
    run: async (args) => {
      const preview = await getRowReport(
        str(args, "report").toLowerCase(),
        str(args, "window").toLowerCase()
      );
      if (!preview.ok || !preview.sheet) {
        return { ok: false, error: preview.error ?? "That report could not be read." };
      }
      const rows = preview.sheet.rows.slice(0, 12);
      return {
        ok: true,
        report: preview.report,
        sheet: preview.sheet.name,
        scope: preview.scope ?? null,
        columns: preview.sheet.columns,
        rows: rows.map((row) => row.map((cell) => cell ?? "—")),
        rows_returned: rows.length,
        /** The page previews more rows than a reply carries, and says so. */
        total_rows: preview.totalRows ?? 0,
        limitations: preview.limitations ?? [],
      };
    },
  },
  {
    name: "get_analytics_report",
    label: "Reading the analytics report",
    description:
      "The aggregate figures /analytics draws for one window: tests issued → opened → finished with the median score, sourcing contacted → replied → converted, messages counted per channel, and interview panels with their no-shows. `complete` is false when a source hit its row cap, and the caveats say which, so a rate from here is never quoted as a full history it does not have. A portal notice is counted as read, never as delivered — only email and WhatsApp pass a relay.",
    args: {
      window: `string — one of ${ANALYTICS_WINDOWS.map((option) => option.key).join(", ")}, where all is every record`,
    },
    run: async (args) => {
      const result = await getAnalyticsReport(str(args, "window").toLowerCase());
      if (!result.ok || !result.report) {
        return { ok: false, error: result.error ?? "The report could not be built." };
      }
      const report = result.report;
      const { assessments, sourcing, messages, interviews } = report;
      return {
        ok: true,
        window: report.windowLabel,
        as_of: report.generatedAt,
        time_zone: report.timeZone,
        complete: report.complete,
        scores_hidden: report.scoresHidden,
        limitations: report.limitations,
        assessments: {
          issued: assessments.issued,
          opened: assessments.opened,
          submitted: assessments.submitted,
          graded: assessments.graded,
          in_progress: assessments.inProgress,
          expired: assessments.expired,
          open_rate: assessments.openRate,
          finish_rate: assessments.finishRate,
          median_invite_to_open_hours: assessments.medianInviteToOpenHours,
          median_time_on_test_minutes: assessments.medianTimeOnTestMinutes,
          median_score_percent: assessments.medianScorePercent,
          score_bands: assessments.scoreBands,
        },
        sourcing: {
          total: sourcing.total,
          contacted: sourcing.contacted,
          replied: sourcing.replied,
          interviewing: sourcing.interviewing,
          converted: sourcing.converted,
          reply_rate: sourcing.replyRate,
          conversion_rate: sourcing.conversionRate,
          stages: sourcing.stages,
        },
        messages: {
          scanned: messages.scanned,
          delivered: messages.delivered,
          undelivered: messages.undelivered,
          read: messages.read,
          by_channel: messages.byChannel,
        },
        interviews: {
          booked: interviews.booked,
          completed: interviews.completed,
          cancelled: interviews.cancelled,
          no_show: interviews.noShow,
          upcoming: interviews.upcoming,
          no_show_rate: interviews.noShowRate,
          median_lead_days: interviews.medianLeadDays,
          by_interviewer: interviews.byInterviewer,
        },
      };
    },
  },
  {
    name: "list_jobs",
    label: "Reading job openings",
    description:
      "Job openings newest first, with their status, company, department, location, salary band and applicant count. `status` and `company` are answered by the database, so `scope_note` counts that set; the search words are the openings grid's own box, matched over the rows this read carries. Quote `scope_note` whenever openings are counted or a role is reported missing — the read is a window into the set, and the note says what a search could reach.",
    args: {
      status: `string — optional, one of ${JOB_STATUSES.join(
        ", "
      )}, or HIREABLE for every role a person may still be filed under. Omit for all four.`,
      company:
        "string — optional, one company's id from get_master_data (its id, not its name), so the count is that company's openings rather than the group's",
      query: `string — optional, the grid's own search box: ${openingSearchWords()}, matched over the openings this read carries`,
    },
    run: async (args) => {
      const word = optionalStr(args, "status")?.toUpperCase() ?? null;
      if (word && word !== "HIREABLE" && !(JOB_STATUSES as readonly string[]).includes(word)) {
        throw new ToolArgumentError(
          `"status" must be one of: ${JOB_STATUSES.join(", ")}, or HIREABLE.`
        );
      }
      const filter = (word ?? null) as JobReadFilter;
      const company = optionalId(args, "company");
      const query = optionalStr(args, "query")?.trim() ?? "";
      // Status and company are answered by the query itself, in the database, so
      // the count is the set's size rather than the window's. Only the words are
      // applied here — through the grid's own predicate, so a role the chat finds
      // is a role the recruiter can find by typing the same letters.
      const { jobs, total, companyName, unknownCompany } = await listJobOpenings(filter, company);
      if (unknownCompany) {
        throw new ToolArgumentError(
          "No company carries that id. get_master_data lists the group's companies with their ids."
        );
      }
      const matched = searchOpenings(jobs, query);
      return {
        scope_note: openingReadNote(
          total,
          jobs.length,
          openingScopeWords(filter, company ? companyName : null),
          matched.length,
          query || null
        ),
        openings: matched.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company_name,
          status: job.status,
          department: job.department,
          location: job.location,
          employment_type: job.employment_type,
          sector: job.sector,
          salary: `${job.min_salary_usd ?? "?"}–${job.max_salary_usd ?? "?"} ${job.salary_currency ?? ""}`.trim(),
          applicants: job.applicants,
        })),
      };
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
      "The most recent applications with their pipeline stage, AI match score, job, company, assessment attempt and tracking code, filtered the way the candidates page's rails and search box filter. `stage`, `source` and `company` are answered by the database, so `scope_note` counts that set. Quote `scope_note` whenever the pipeline is counted or somebody is reported missing: the rows listed are a window, the note holds the counts and says what a search could have reached.",
    args: {
      stage: `string — optional, one of ${PIPELINE_STAGES.join(", ")} — the stage rail`,
      source: `string — optional, one of ${APPLICATION_SOURCES.join(", ")} — the channel rail`,
      company:
        "string — optional, one company's id from get_master_data (its id, not its name) — the company rail, so the set counted is that company's applications rather than the group's",
      archived:
        "boolean — optional, true for the archive the delete door files into instead of the live pipeline",
      query: `string — optional, the table's own search box: ${candidateSearchWords()}, matched over the rows the read carries`,
    },
    run: async (args) => {
      const stage = optionalChoice(args, "stage", PIPELINE_STAGES);
      const source = optionalChoice(args, "source", APPLICATION_SOURCES);
      const company = optionalId(args, "company");
      const archived = bool(args, "archived", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const [named, rows, tally] = await Promise.all([
        // Named in the same breath as the reads, and refused below before the
        // answer is written: an id no company carries must not come back as "that
        // company has no applications", which is what an empty read also looks like.
        company ? companyNameById(company) : Promise.resolve<string | null>(null),
        getCandidateList(archived, stage, source, company),
        getCandidateTally(archived),
      ]);
      if (company && !named) {
        throw new ToolArgumentError(
          "No company carries that id. get_master_data lists the group's companies with their ids."
        );
      }
      const scoped = company && named ? { id: company, name: named } : null;
      // The rails already narrowed the query in the database, so only the text
      // half is applied here — through the table's own predicate, so a match in
      // the chat is a match the recruiter can reproduce by typing the words.
      const matched = filterCandidates(rows, { stage: null, source: null, query, sort: "recent" });
      const shown = matched.slice(0, ANSWER_ROWS);
      return {
        scope_note: candidateScopeNote({
          archived,
          stage,
          source,
          company: scoped,
          shown: shown.length,
          loaded: rows.length,
          tally,
          query: query || null,
        }),
        // So a hidden score is never described to the recruiter as "not screened".
        scores_masked: rows[0]?.scores_masked ?? false,
        candidates: shown.map((row) => ({
          id: row.id,
          tracking_code: row.tracking_code,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          stage: row.stage,
          job_title: row.job_title,
          company: row.company_name,
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
      "Every assessment suite with its question count, total points, time limit, whether it is active, and how many attempts it has. This read carries the whole catalogue rather than a window, so `suites_note` can say outright that a suite missing from the list has not been created — quote it whenever a suite is reported missing.",
    args: {
      query: `string — optional, the grid's own search box: ${suiteSearchWords()}, matched over every suite the catalogue holds`,
    },
    run: async (args) => {
      const query = optionalStr(args, "query")?.trim() ?? "";
      const templates = await getTemplates();
      const matched = searchSuites(templates, query);
      return {
        suites_note: suiteReadNote(templates.length, matched.length, query || null),
        suites: matched.map((template) => ({
          id: template.id,
          name: template.name,
          role_family: template.role_family,
          is_active: template.is_active,
          question_count: template.question_count,
          total_points: template.total_points,
          time_limit_minutes: template.time_limit_minutes,
          attempts: template.attempts,
          completed: template.completed,
        })),
      };
    },
  },
  {
    name: "list_prospects",
    label: "Reading sourcing pool",
    description:
      "The sourced-prospect pool with each prospect's stage, origin and linked opening, filtered the way the board's rails and search box filter. Quote `pool_note` whenever the size of the pool is stated or a person is reported missing: the rows listed are a window, the counts in the note are the pool, and a search only reaches rows inside it.",
    args: {
      stage: `string — optional, one of ${PROSPECT_STAGES.join(", ")} — the rail to read`,
      query: `string — optional, the board's own search box: ${prospectSearchWords()}, matched over the rows the read carries`,
    },
    run: async (args) => {
      const stage = optionalChoice(args, "stage", PROSPECT_STAGES) as ProspectStage | null;
      const query = optionalStr(args, "query")?.trim() ?? "";
      const { prospects, totals } = await getProspectPool({ stage });
      const matched = searchPool(prospects, query);
      const shown = matched.slice(0, ANSWER_ROWS);
      return {
        pool_note: poolScopeNote(totals, stage, shown.length, query || null),
        by_stage: totals.byStage,
        prospects: shown.map((prospect) => ({
          id: prospect.id,
          full_name: prospect.full_name,
          headline: prospect.headline,
          company: prospect.company,
          stage: prospect.stage,
          origin: prospect.origin,
          job_title: prospect.job_title,
          messages: prospect.messages,
        })),
      };
    },
  },
  {
    name: "get_prospect_profile",
    label: "Reading a stored prospect profile",
    description:
      "The structured profile stored on a sourced prospect — headline, company, location, skills, experience, education — with how it was captured and when. Nothing here reaches LinkedIn: a profile exists only because a recruiter pasted or uploaded the text themselves.",
    args: { id: "string — prospect id from list_prospects" },
    run: async (args) => {
      const stored = await getProspectProfile(str(args, "id"));
      if (!stored) return { ok: false, error: "That prospect is no longer in the pool." };
      if (!stored.profile) {
        return {
          ok: true,
          profile: null,
          last_error: stored.error,
          note: stored.error
            ? "No structured profile is stored, and the read that produced this error is named above."
            : "No profile has been read for this prospect yet.",
        };
      }
      return {
        ok: true,
        full_name: stored.full_name,
        headline: stored.headline,
        company: stored.company,
        captured_by: stored.source,
        captured_at: stored.captured_at,
        profile: stored.profile,
      };
    },
  },
  {
    name: "list_outbox",
    label: "Reading message outbox",
    description:
      "The WhatsApp outbox: queued and sent jobs with their status and attempts, plus the most recent delivery log. `bucket` is the queue's own column rail and is answered by the database; `failed` narrows the delivery log to the rows the channel refused. They are the two rails /whatsapp reads off its address bar, so pass them and the click-through shows the same set. `totals` counts every job and every undelivered log row whether a rail is lit or not, and the two rails narrow two different tables — so quote `scope_note` rather than counting the rows returned here.",
    args: {
      bucket: `string — optional, one of ${OUTBOX_BUCKETS.join(", ")} — the queue column to read, ALL for every column`,
      failed:
        "boolean — optional, true for the delivery-log rows the channel refused, which is what the alerts count",
      query: `string — optional, the queue's own search box: ${queueSearchWords()}, matched over the jobs this read carries`,
    },
    run: async (args) => {
      const bucket = optionalChoice(args, "bucket", OUTBOX_BUCKETS) as OutboxBucket | null;
      const failed = bool(args, "failed", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const outbox = await getOutbox({ bucket, failed });
      // The words narrow the queue the way the panel's box does, before the
      // answer slices it: a search that ran after the slice would report "matched
      // 3" while the box on screen finds five.
      const matched = searchQueue(outbox.jobs, query);
      const queued = matched.slice(0, 40);
      const deliveries = outbox.history.slice(0, 15);
      return {
        scope_note: outboxScopeNote({
          bucket: bucket ?? "ALL",
          failed,
          shown: queued.length,
          loaded: outbox.jobs.length,
          logShown: deliveries.length,
          logLoaded: outbox.history.length,
          buckets: outbox.buckets,
          failedLogTotal: outbox.failedLogTotal,
          search: query || null,
          matched: matched.length,
        }),
        totals: {
          ...outbox.buckets,
          undelivered_log_rows: outbox.failedLogTotal,
        },
        queued: queued.map((job) => ({
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
        recent_deliveries: deliveries.map((row) => ({
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
    name: "list_models",
    label: "Reading the model catalogue",
    description:
      `The models this portal can actually call, with the qualified id a routing row is written with, its provider, prices and context length — the same list the AI models console searches and its routing pickers offer. Read it before save_model_routing: a model id invented here is a capability that fails on the next screening. \`query\` is the console's own box and runs over every callable model, so a search that names nothing says nothing about what the vendors list.`,
    args: {
      query: `string — optional, the console's own search box: ${modelSearchWords()}, matched over every model this portal can call`,
    },
    run: async (args) => {
      const query = optionalStr(args, "query")?.trim() ?? "";
      const catalogue = await getModelCatalogue();
      const labels = new Map(catalogue.sources.map((source) => [source.id, source.displayName]));
      // What the console's pickers offer, for the same reason: a model with no
      // caller in the gateway, or one the account switched off, cannot be routed
      // to, so listing it would invite exactly the routing row that breaks.
      const callable = catalogue.models.filter(
        (model) => model.routable && model.enabled !== false
      );
      const matched = searchModels(callable, query, labels);
      const models = matched.slice(0, MODEL_ROWS).map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        provider_label: labels.get(model.provider) ?? model.provider,
        free: model.free,
        prompt_price: model.promptPrice,
        completion_price: model.completionPrice,
        context_length: model.contextLength,
        detail: model.detail ?? null,
      }));
      return {
        // Leads for the same reason every other capped read does: the numbers a
        // recruiter acts on are the set searched, not the rows below them.
        models_note: `${modelReadNote({
          carried: catalogue.models.length,
          callable: callable.length,
          matched: matched.length,
          shown: models.length,
          cap: MODEL_ROWS,
          search: query || null,
          degradedSources: catalogue.sources.filter((source) => source.status === "degraded").length,
          silentSources: catalogue.sources.filter(
            (source) => source.status !== "ok" && source.status !== "degraded"
          ).length,
        })} The read is ${catalogue.degraded ? "partly a built-in fallback list" : "a live provider read"} as of ${catalogue.fetchedAt}.`,
        models,
        providers: catalogue.sources.map((source) => ({
          id: source.id,
          label: source.displayName,
          models: source.count,
          status: source.status,
          routable: source.routable,
        })),
      };
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
  {
    name: "get_candidate_dossier",
    label: "Reading a candidate dossier",
    description:
      "Everything on one application: what they submitted, their viability-gate answers, every assessment attempt with its status and deadline, every alert on the record with its status (delivered or failed for email and WhatsApp, queued for a WhatsApp still waiting, written for a portal notice — a notice is an inbox entry, nothing sent it through a relay), attached files, onboarding progress, and their other applications. This is where attempt, attachment and alert ids come from. `alerts_note` says whether the message list below is the whole history or only its first rows.",
    args: { application_id: "string — the application's id" },
    run: async (args) => {
      const applicationId = str(args, "application_id");
      const result = await getCandidateDossier(applicationId);
      if (!result.ok) return { ok: false, error: result.error };
      const dossier = result.dossier;

      // A start link is the only thing standing between a stranger and this
      // person's test, and a chat transcript is stored — so the token never
      // leaves the dossier screen that shows it in a copy field.
      const alerts = dossier.alerts.slice(0, DOSSIER_ALERT_ROWS).map((alert) => ({
        id: alert.id,
        channel: alert.channel,
        status: alert.status,
        subject: alert.subject,
        body: clip(alert.body, 240),
        error: alert.error,
        occurred_at: alert.occurred_at,
      }));

      return {
        // Leads the result because a dossier this long is clipped before the
        // model reads it, and the rows the note is about sit at the end of it.
        alerts_note: reachNote("message attempts on this record", dossier.alerts.length, alerts.length),
        ok: true,
        application: {
          id: dossier.application.id,
          full_name: dossier.application.full_name,
          email: dossier.application.email,
          phone: dossier.application.phone,
          tracking_code: dossier.application.tracking_code,
          source: dossier.application.source,
          applied_at: dossier.application.applied_at,
          job_title: dossier.application.job_title,
          department: dossier.application.job_department,
          location: dossier.application.job_location,
          cv_name: dossier.application.cv_name,
          cv_error: dossier.application.cv_error,
        },
        scores_masked: dossier.scores_masked,
        may_manage_links: dossier.can_manage_links,
        may_write: dossier.can_write,
        gate_answers: dossier.gate_answers.map((answer) => ({
          question: answer.question,
          answer: answer.answer,
          passed: answer.passed,
        })),
        attempts: dossier.attempts.map((attempt) => ({
          id: attempt.id,
          suite: attempt.template_name,
          status: attempt.status,
          score: attempt.score,
          max_score: attempt.max_score,
          time_limit_minutes: attempt.time_limit_minutes,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
          deadline: attempt.deadline,
        })),
        attachments: dossier.attachments.map((file) => ({
          id: file.id,
          label: file.label,
          name: file.name,
          bucket: file.bucket,
          bytes: file.bytes,
          uploaded_at: file.uploaded_at,
          uploaded_by: file.uploaded_by,
        })),
        alerts,
        onboarding: dossier.onboarding,
        other_applications: dossier.other_applications,
      };
    },
  },
  {
    name: "get_assessment_suite",
    label: "Reading one assessment suite",
    description:
      "One suite with every question in it — type, title, prompt, instructions, points, position, and the per-type config (options with their correct flags for multiple choice, context and word minimum for a case study, recording limits for a video pitch). Read this before editing or deleting a question.",
    args: { template_id: "string — suite id from list_assessment_suites" },
    run: async (args) => {
      const templateId = str(args, "template_id");
      const [detail, grouped] = await Promise.all([
        getTemplateDetail(templateId),
        getQuestionsForEditor(),
      ]);
      if (!detail) return { ok: false, error: "No assessment suite has that id." };

      return {
        ok: true,
        suite: {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          role_family: detail.role_family,
          time_limit_minutes: detail.time_limit_minutes,
          is_active: detail.is_active,
        },
        questions: (grouped[templateId] ?? []).map((question) => ({
          id: question.id,
          position: question.position,
          type: question.question_type,
          title: question.title,
          prompt: clip(question.prompt, 1200),
          instructions: question.instructions,
          points: question.points,
          time_limit_minutes: question.time_limit_minutes,
          shuffle_options: question.shuffle_options,
          config: question.config,
        })),
      };
    },
  },
  {
    name: "get_attempt_grades",
    label: "Reading an attempt's grades",
    description:
      "One assessment attempt answer by answer, in the order the exam was sat: the question, the candidate's own words, the transcript of a recording, the mark and whose verdict it is, and what the AI said for and against it. Also reports how many answers carry no mark at all, whether this recruiter may award them, and whether the engine can be asked to try again. Read this before award_marks or retry_grading: both the response id and the points bound a mark may come from are here, nowhere else.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => {
      const attemptId = str(args, "attempt_id");
      const grades = await getAttemptGrades(attemptId);
      if (!grades) return { ok: false, error: "No assessment attempt has that id." };

      return {
        ok: true,
        attempt_id: grades.attempt_id,
        application_id: grades.application_id,
        suite: grades.template_name,
        status: grades.status,
        scores_masked: grades.scores_masked,
        total_score: grades.total_score,
        max_score: grades.max_score,
        unscored: grades.unscored,
        may_award_marks: grades.can_score,
        may_retry_grading: grades.can_retry,
        ai_grading: grades.ai_grading,
        answers: grades.grades.map((grade) => ({
          response_id: grade.response_id,
          title: grade.title,
          type: grade.question_type,
          score: grade.score,
          max_score: grade.max_score,
          awarded_by: grade.awarded_by,
          answer: clip(grade.answer_preview, 700),
          transcript: clip(grade.transcript, 500),
          // A signed playback URL is an hour-long door into a private bucket and
          // a chat transcript is stored, so the answer here is that a recording
          // exists — the recruiter watches it on the report itself.
          has_recording: Boolean(grade.video_url),
          rationale: clip(grade.rationale, 500),
          strengths: grade.strengths,
          improvements: grade.improvements,
        })),
      };
    },
  },
  {
    name: "list_interviews",
    label: "Reading the interview agenda",
    description:
      "Interviews booked around today with candidate, role, interviewer, time, length, meeting link and status (SCHEDULED, COMPLETED, NO_SHOW, CANCELLED). Gives the interview ids that reschedule and outcome tools need. Read `agenda_note` before saying \"all\" or counting these rows: it names the window asked for, whether that window is wider than the agenda page can list, and whether the list was cut.",
    args: {
      past_days:
        "number — optional, how many days back to include, defaults to the agenda's own 30",
      future_days:
        "number — optional, how many days forward, defaults to the agenda's own 90; a wider read is real but partly off the board, and `agenda_note` says so",
    },
    run: async (args) => {
      const days = agendaWindowDays({
        pastDays: args.past_days === undefined ? undefined : num(args, "past_days"),
        futureDays: args.future_days === undefined ? undefined : num(args, "future_days"),
      });
      const rows = await getInterviewAgenda(days);
      const shown = rows.slice(0, AGENDA_CHAT_ROW_LIMIT).map((row) => ({
        id: row.id,
        application_id: row.application_id,
        candidate: row.candidate_name,
        tracking_code: row.tracking_code,
        job_title: row.job_title,
        interviewer: row.interviewer_name,
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        meeting_link: row.meeting_link,
        status: row.status,
      }));
      return {
        // First key on purpose: the result handed to the model is clipped, so a
        // note that sat behind eighty panels could be cut off along with them.
        agenda_note: agendaReadNote({ ...days, total: rows.length, shown: shown.length }),
        interviews: shown,
      };
    },
  },
  {
    name: "list_onboarding_plans",
    label: "Reading onboarding plans",
    description:
      "Every hire's checklist with progress, each task's id, title, owner, category, due offset and completion, plus the hires who have no plan yet. Task ids come from here. `unplanned_note` says whether the waiting list below names every hire without a checklist or only its first rows.",
    args: {},
    run: async () => {
      const data = await getOnboardingData();
      const unplanned = data.unplanned.slice(0, UNPLANNED_HIRE_ROWS);
      return {
        // Leads because the plans below are long — a hire waiting for a
        // checklist could otherwise be reported as one that does not exist.
        unplanned_note: reachNote(
          "hires with no checklist yet",
          data.unplanned.length,
          unplanned.length
        ),
        summary: data.summary,
        unplanned,
        plans: data.plans.map((plan) => ({
          id: plan.id,
          application_id: plan.application_id,
          candidate: plan.candidate_name,
          job_title: plan.job_title,
          company: plan.company_name,
          hired_at: plan.hired_at,
          progress: plan.progress,
          done: plan.checklist_done,
          total: plan.checklist_total,
          skill_gaps: plan.skill_gap_count,
          tasks: plan.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            category: task.category,
            owner: task.owner,
            due_offset_days: task.due_offset_days,
            completed: task.completed,
          })),
        })),
      };
    },
  },
  {
    name: "list_files",
    label: "Reading stored files",
    description:
      "The storage buckets this portal writes, with file counts, and the folder listing inside one bucket. Without arguments it opens the CV bucket's root. `listing_note`/`root_note` name how many files the read actually carries — a folder's own `truncated` flag only describes the listing behind it, not this answer. `query` is the browser's own box and runs over the files the listing carries, so a search that names nothing says nothing about the bucket.",
    args: {
      // Derived from the bucket table the File Manager renders, so a bucket a
      // recruiter can click into is never one the chat has never heard of — the
      // hand-written list this replaces had three of the four and silently kept
      // the video pitches out of reach.
      bucket: `string — optional, one of ${BUCKETS.map((bucket) => bucket.key).join(", ")} — the bucket to read; omitted reads the CV bucket's root`,
      prefix: "string — optional, a folder path ending in /",
      query: `string — optional, the browser's own search box: ${fileSearchWords()}, matched over the files the listing carries`,
    },
    run: async (args) => {
      const bucket = optionalStr(args, "bucket");
      const query = optionalStr(args, "query")?.trim() ?? "";
      if (bucket) {
        const view = await openFolder(bucket, optionalStr(args, "prefix") ?? "");
        if (!view.ok) return { ok: false, error: view.error };
        // Words narrow the folder the way the box on screen does, before the
        // answer slices it, so a search never reports fewer files than the page finds.
        const matched = searchFiles(view.listing.files, query);
        const files = matched.slice(0, FOLDER_FILE_ROWS).map((file) => ({
          path: file.path,
          name: file.name,
          bytes: file.bytes,
          mime_type: file.mimeType,
          modified_at: file.modifiedAt,
          owner: file.owner,
        }));
        return {
          // The page's `truncated` flag only describes the storage listing's own
          // cap, so a folder of exactly 200 files read as complete from here
          // after this answer had dropped 140 of them. Both cuts are named.
          listing_note: `${folderReadNote({
            loaded: view.listing.files.length,
            matched: matched.length,
            shown: files.length,
            listingTruncated: view.listing.truncated,
            search: query || null,
          })}${listingCapNote(view.listing.truncated)}`,
          bucket: view.listing.bucketLabel,
          prefix: view.listing.prefix,
          folders: view.listing.folders.map((folder) => folder.prefix),
          files,
          truncated: view.listing.truncated,
        };
      }

      const { buckets, view } = await getFileBrowserData();
      const rootMatched = view.ok ? searchFiles(view.listing.files, query) : [];
      const rootFiles = view.ok
        ? rootMatched.slice(0, ROOT_FILE_ROWS).map((file) => ({
            path: file.path,
            name: file.name,
            bytes: file.bytes,
            owner: file.owner,
          }))
        : null;
      return {
        // Leads for the same reason: the bucket tile counts every object, and a
        // root listing hands back a fraction of them.
        root_note: view.ok
          ? `${folderReadNote({
              loaded: view.listing.files.length,
              matched: rootMatched.length,
              shown: rootFiles?.length ?? 0,
              listingTruncated: view.listing.truncated,
              search: query || null,
            })}${listingCapNote(view.listing.truncated)}`
          : "The root folder could not be listed, so no files are named.",
        buckets: buckets.map((each) => ({
          key: each.key,
          label: each.label,
          files: each.files,
          exact_count: each.exact,
        })),
        root: view.ok ? rootFiles : { error: view.error },
      };
    },
  },
  {
    name: "list_gate_questions",
    label: "Reading viability gate questions",
    description:
      "The questions the public apply form asks, which options keep an application in the running, which role each is asked on, and the openings they can be scoped to. Every question is listed; `jobs_note` says whether the openings beside them are all the console holds.",
    args: {},
    run: async () => {
      const console_ = await getGateConsoleData();
      const jobs = console_.jobs.slice(0, GATE_JOB_ROWS);
      return {
        // The questions below are uncapped, so an opening missing from this
        // list is a scoping limit of the read, not a role with no gate.
        jobs_note: reachNote("openings in the gate console", console_.jobs.length, jobs.length),
        questions: console_.questions.map((question) => ({
          id: question.id,
          question: question.question,
          help_text: question.helpText,
          job_id: question.jobId,
          scope: question.jobId ? "one role" : "every role",
          position: question.position,
          is_active: question.isActive,
          options: question.options,
        })),
        jobs,
      };
    },
  },
  {
    name: "list_team",
    label: "Reading the staff roster",
    description:
      "Every staff account with its profile id, role, company and whether sign-in is currently blocked, plus outstanding invites. These ids drive the team tools; the roster in get_settings does not show invite or ban state.",
    args: {},
    run: async () => {
      const [bundle, team] = await Promise.all([loadSettings(), loadStaffConsole()]);
      return {
        members: bundle.staff.map((member) => ({
          profile_id: member.id,
          full_name: member.full_name,
          email: member.email,
          role: member.role,
          company_id: member.tenant_id ?? null,
          blocked_until: team.access[member.id] ?? null,
        })),
        invites: team.invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          full_name: invite.full_name,
          role: invite.role,
          status: invite.status,
          expires_at: invite.expires_at,
          created_at: invite.created_at,
        })),
        access_error: team.accessError,
      };
    },
  },
  {
    name: "list_email_outbox",
    label: "Reading the email outbox",
    description:
      "The most recent emails the portal tried to send, with recipient, subject, delivered flag and the error when it failed. `failed` narrows the read to the mails the relay refused — the same rail `?failed=1` opens on the outbox page. `totals` counts every email and notice in the log, delivered or not, whether the rail is lit or not, so quote `scope_note` with it: it says which half of the log the rows are from and that portal notices are inbox rows, not mail.",
    args: {
      failed: "boolean — optional, true for the sends the relay refused",
      query: `string — optional, the email panel's own search box: ${emailSearchWords()}, matched over the attempts this read carries`,
    },
    run: async (args) => {
      const failed = bool(args, "failed", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const outbox = await getEmailOutbox({ failed });
      const matched = searchEmails(outbox.emails, query);
      const listed = matched.slice(0, 30);
      return {
        scope_note: emailScopeNote({
          failed,
          shown: listed.length,
          loaded: outbox.emails.length,
          totals: outbox.totals,
          search: query || null,
          matched: matched.length,
        }),
        totals: outbox.totals,
        emails: listed.map((row) => ({
          id: row.id,
          recipient: row.recipient,
          candidate_name: row.candidate_name,
          subject: row.subject,
          delivered: row.delivered,
          error_message: row.error_message,
          created_at: row.created_at,
        })),
      };
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
    name: "send_candidate_feedback",
    label: "Emailing the drafted feedback",
    description:
      "Email a candidate the personalised feedback letter already stored on their record, word for word as the profile shows it. Refuses when no draft exists, when the candidate has no email address, or when email is switched off in Settings. Not sent on WhatsApp.",
    args: { application_id: "string" },
    run: async (args) => {
      const sent = await sendCandidateFeedback(str(args, "application_id"));
      return sent.ok
        ? {
            ...sent,
            note: `Emailed to ${sent.recipient} exactly as the profile displays it${
              sent.inApp === "sent" ? ", and copied into the candidate's portal inbox" : ""
            }.`,
          }
        : sent;
    },
  },
  {
    name: "set_candidate_stage",
    label: "Moving a candidate's stage",
    description:
      "Move an application to another pipeline stage. Rejecting needs a reason of at least four characters. The candidate is notified on the channels Settings allows.",
    args: {
      application_id: "string",
      stage: `string — one of ${PIPELINE_STAGES.join(", ")}`,
      reason: "string — required when stage is REJECTED",
    },
    run: async (args) => {
      const stage = str(args, "stage").toUpperCase() as PipelineStage;
      if (!(PIPELINE_STAGES as readonly string[]).includes(stage)) {
        throw new ToolArgumentError(`"stage" must be one of: ${PIPELINE_STAGES.join(", ")}.`);
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
      if (!(PROSPECT_STAGES as readonly string[]).includes(stage)) {
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
    args: { values: "object — setting key to new value, e.g. {\"ai.match_threshold_advance\": 75}" },
    run: async (args) => {
      const values = args.values;
      if (typeof values !== "object" || values === null || Array.isArray(values)) {
        throw new ToolArgumentError('"values" must be an object of setting keys to values.');
      }
      return report(await saveSettings(values as Record<string, unknown>));
    },
  },

  /* --------------------------- Authoring tests -------------------------- */
  {
    name: "save_assessment_suite",
    label: "Saving an assessment suite",
    description:
      "Create an assessment suite, or rewrite one when suite_id is given. A suite is only useful once it has questions — add them with save_question, then assign the suite with assign_assessment.",
    args: {
      suite_id: "string — optional, the suite being edited",
      tenant_id: "string — company id from get_master_data, required when creating",
      name: "string",
      description: "string — optional",
      role_family: "string — role family from get_master_data",
      time_limit_minutes: "number — for the whole suite",
      randomize_questions: "boolean — optional, defaults to false",
      randomize_options: "boolean — optional, defaults to false",
      block_copy_paste: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(
        await saveTemplate({
          id: optionalStr(args, "suite_id") ?? null,
          tenant_id: str(args, "tenant_id"),
          name: str(args, "name"),
          description: optionalStr(args, "description") ?? "",
          role_family: str(args, "role_family"),
          time_limit_minutes: num(args, "time_limit_minutes"),
          randomize_questions: bool(args, "randomize_questions", false),
          randomize_options: bool(args, "randomize_options", false),
          block_copy_paste: bool(args, "block_copy_paste", true),
        })
      ),
  },
  {
    name: "set_assessment_suite_active",
    label: "Pausing or resuming a suite",
    description:
      "Publish or pause a suite. Pausing closes the assign door; a link already in a candidate's inbox keeps working, which is why this is the way to retire a suite that has been sat.",
    args: {
      suite_id: "string — suite id from list_assessment_suites",
      active: "boolean — true to publish, false to pause",
    },
    run: async (args) =>
      report(await setTemplateActive(str(args, "suite_id"), bool(args, "active", true))),
  },
  {
    name: "save_question",
    label: "Saving a question",
    description:
      "Add a question to a suite, or rewrite one when id is given. Read the suite with get_assessment_suite first: a save writes the whole question, and an EXCEL_MODEL question must come back with its config in preserve_config or the spreadsheet definition is lost.",
    args: {
      id: "string — optional, the question being edited",
      template_id: "string — suite id",
      question_type: `string — one of ${QUESTION_TYPES.join(", ")}`,
      title: "string",
      prompt: "string — what the candidate is asked",
      instructions: "string — optional",
      points: "number",
      position: "number — optional, order in the suite",
      time_limit_minutes: "number — optional, per question",
      shuffle_options: "boolean — optional",
      options:
        "object[] — for MULTIPLE_CHOICE: [{\"text\":\"answer\",\"is_correct\":true}, …], at least two",
      context: "string — optional, the case study brief",
      min_words: "number — optional, case study minimum",
      min_duration_seconds: "number — optional, video pitch minimum",
      max_duration_seconds: "number — optional, video pitch maximum",
      preserve_config: "object — optional, the config object exactly as read back",
    },
    run: async (args) => report(await saveQuestion(questionDraftFrom(args))),
  },
  {
    name: "move_question",
    label: "Reordering a question",
    description: "Move one question one slot up or down; the suite is renumbered after it.",
    args: {
      question_id: "string",
      template_id: "string — the suite it belongs to",
      direction: "string — up or down",
    },
    run: async (args) => {
      const direction = str(args, "direction").toLowerCase();
      if (direction !== "up" && direction !== "down") {
        throw new ToolArgumentError('"direction" must be "up" or "down".');
      }
      return report(await moveQuestion(str(args, "question_id"), str(args, "template_id"), direction));
    },
  },

  /* ----------------------- Assessment link control ---------------------- */
  {
    name: "revoke_attempt",
    label: "Revoking an assessment link",
    description:
      "Stop an open assessment link: the candidate can no longer start or continue it. Answers already given stay on the record, which is why a submitted attempt cannot be revoked.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await revokeAttempt(str(args, "attempt_id"))),
  },
  {
    name: "extend_attempt",
    label: "Extending an assessment deadline",
    description:
      "Buy more time on an open link, added to whatever deadline is already in force. Works on an invitation not yet opened and on a test already in progress.",
    args: {
      attempt_id: "string — from get_candidate_dossier",
      hours: "number — 1 to 336",
    },
    run: async (args) =>
      report(await extendAttemptLink(str(args, "attempt_id"), num(args, "hours"))),
  },
  {
    name: "reissue_attempt",
    label: "Re-issuing an assessment link",
    description:
      "Replace a link the candidate never opened with a fresh one and send the invitation again — for the invite that bounced, expired or was lost. The old address stops resolving the moment this runs. A test that was already opened is refused, because a second link would hand a second sitting of the same paper.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await reissueAttemptLink(str(args, "attempt_id"))),
  },
  /* ----------------------------- Grading ------------------------------- */
  {
    name: "award_marks",
    label: "Awarding marks by hand",
    description:
      "Put a mark on one answer, exactly as the mark editor on the candidate's Integrity report does. For an answer the AI left unscored or parked for review, after reading it with get_attempt_grades: the number is whole points out of that answer's own max_score, never a percentage, and the note is saved as the reason a person decided. Refused when the recruiter's role has its marks withheld — that is the same rule that hides the editor on screen.",
    args: {
      response_id: "string — from get_attempt_grades",
      score: "number — whole points, from 0 up to that answer's max_score",
      note: "string — why, in the recruiter's words. Optional",
    },
    run: async (args) =>
      report(
        await scoreAttemptResponse({
          responseId: str(args, "response_id"),
          score: num(args, "score"),
          note: optionalStr(args, "note") ?? "",
        })
      ),
  },
  {
    name: "retry_grading",
    label: "Re-running the AI grading",
    description:
      "One more pass by the grading engine over an attempt's unscored answers — the same run the report's “Ask the AI again” button starts. It is the only way marks come back from the AI on an attempt that was already submitted, since nothing schedules the timed sweep. Marks it writes are the engine's own; the trail also records that this person asked. Refused when AI grading is off or no provider is configured, which get_attempt_grades reports in advance.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => report(await retryAttemptGrading(str(args, "attempt_id"))),
  },

  /* ----------------------------- Interviews ------------------------------ */
  {
    name: "schedule_interview",
    label: "Booking an interview",
    description:
      "Book an interview for a candidate and tell them about it on the channels that are switched on. The interviewer is named from list_team.",
    args: {
      application_id: "string",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional, staff profile id from list_team",
    },
    run: async (args) =>
      report(
        await scheduleInterview({
          applicationId: str(args, "application_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
        })
      ),
  },
  {
    name: "reschedule_interview",
    label: "Moving an interview",
    description:
      "Change when an interview happens. The candidate is told it moved rather than re-invited.",
    args: {
      interview_id: "string — from list_interviews",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional",
    },
    run: async (args) =>
      report(
        await rescheduleInterview({
          interviewId: str(args, "interview_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
        })
      ),
  },
  {
    name: "set_interview_status",
    label: "Recording an interview outcome",
    description:
      "Mark an interview COMPLETED or NO_SHOW, or CANCELLED it. Only a cancellation messages the candidate, and it carries no internal reason.",
    args: {
      interview_id: "string — from list_interviews",
      status: "string — COMPLETED, NO_SHOW or CANCELLED",
    },
    run: async (args) => {
      const status = str(args, "status").toUpperCase();
      if (!INTERVIEW_OUTCOMES.includes(status as (typeof INTERVIEW_OUTCOMES)[number])) {
        throw new ToolArgumentError('"status" must be COMPLETED, NO_SHOW or CANCELLED.');
      }
      return report(
        await setInterviewStatus({
          interviewId: str(args, "interview_id"),
          status: status as (typeof INTERVIEW_OUTCOMES)[number],
        })
      );
    },
  },
  {
    name: "draft_interview_guide",
    label: "Drafting interview questions",
    description:
      "Write a question set for one candidate from what AI screening found and what they wrote in their assessment. Needs the ai.interview_questions switch on, and nothing is stored — the guide lives in this conversation.",
    args: { application_id: "string" },
    run: async (args) => {
      const guide = await generateInterviewGuide({ applicationId: str(args, "application_id") });
      return {
        ok: guide.ok !== false,
        error: guide.error,
        questions: guide.questions ?? null,
        stored: false,
        note: "Nothing was written to the record — this is a draft for the recruiter to use.",
      };
    },
  },

  /* ----------------------------- Onboarding ------------------------------ */
  {
    name: "generate_onboarding_plan",
    label: "Generating an onboarding plan",
    description:
      "Build a hire's checklist from their role, assessment and screening. Refuses when the application already has a plan.",
    args: {
      application_id: "string — a HIRED application",
      job_title: "string — optional override for the role text",
    },
    run: async (args) =>
      report(
        await generateOnboardingPlan(
          str(args, "application_id"),
          optionalStr(args, "job_title") ?? null
        )
      ),
  },
  {
    name: "save_onboarding_task",
    label: "Saving an onboarding task",
    description:
      "Add a task to a hire's checklist, or edit the named one. Completion is a separate call so the trail records a tick as a tick.",
    args: {
      plan_id: "string — from list_onboarding_plans",
      task_id: "string — optional, the task being edited",
      title: "string",
      category: `string — one of ${TASK_CATEGORIES.join(", ")} or your own`,
      owner: `string — one of ${TASK_OWNERS.join(", ")} or your own`,
      due_offset_days: "number — days from the hire's start date, negative is before day one",
    },
    run: async (args) =>
      report(
        await saveTask(str(args, "plan_id"), optionalStr(args, "task_id") ?? null, {
          title: str(args, "title"),
          category: str(args, "category"),
          owner: str(args, "owner"),
          due_offset_days: num(args, "due_offset_days"),
        })
      ),
  },
  {
    name: "complete_onboarding_task",
    label: "Ticking an onboarding task",
    description: "Mark a checklist task done, or reopen it. Progress is recalculated from the list.",
    args: {
      plan_id: "string",
      task_id: "string",
      completed: "boolean",
    },
    run: async (args) =>
      report(
        await setTaskCompleted(str(args, "plan_id"), str(args, "task_id"), bool(args, "completed", true))
      ),
  },

  /* --------------------------- Candidate records ------------------------- */
  {
    name: "record_candidate",
    label: "Recording a candidate by hand",
    description:
      "File an applicant who never came through the careers site — a mailed CV, a name from a phone screen, a row from an old spreadsheet. Starts them at New with a tracking code. Nothing is messaged: they didn't apply, so a confirmation would be wrong. A second live record for the same address in the same opening is refused.",
    args: {
      job_id: "string — from list_jobs",
      full_name: "string — at least two characters",
      email: "string — stored lowercase",
      phone: "string — optional; needed for WhatsApp notices",
      source: `string — one of ${APPLICATION_SOURCES.join(", ")}`,
    },
    run: async (args) =>
      report(
        await createCandidate({
          jobId: str(args, "job_id"),
          fullName: str(args, "full_name"),
          email: str(args, "email"),
          phone: optionalStr(args, "phone"),
          source: str(args, "source"),
        })
      ),
  },
  {
    name: "edit_candidate_contact",
    label: "Correcting candidate details",
    description:
      "Fix the name, email or phone a candidate arrived with. Every notice, bulk message and portal sign-in reads these columns, so this changes where future messages go.",
    args: {
      application_id: "string",
      full_name: "string",
      email: "string",
      phone: "string — optional; blank clears the stored number",
    },
    run: async (args) =>
      report(
        await updateCandidateContact({
          applicationId: str(args, "application_id"),
          fullName: str(args, "full_name"),
          email: str(args, "email"),
          phone: optionalStr(args, "phone"),
        })
      ),
  },
  {
    name: "set_candidate_archive",
    label: "Filing a candidate in or out",
    description:
      "File a candidate out of the pipeline, or bring them back. This is not a delete — answers, scores and notices all stay on the record. An open assessment link or a live interview is refused first.",
    args: {
      application_id: "string",
      archived: "boolean — true to file away, false to restore",
    },
    run: async (args) =>
      report(await setCandidateArchive({ applicationId: str(args, "application_id"), archived: bool(args, "archived", true) })),
  },
  {
    name: "read_candidate_cv",
    label: "Reading a CV into the record",
    description:
      "Parse a CV file already held for a candidate and store its text on the row, which is what AI screening and the profile read. Give an attachment_id for a file staff attached, or leave it out to read the CV the applicant submitted with their application. Refuses when the record already holds CV text — that replacement is a decision for the recruiter on their own screen, so tell them to use Read as CV there.",
    args: {
      application_id: "string",
      attachment_id: "string — optional, from list_files or the candidate dossier; omit for the CV on the record",
    },
    run: async (args) => {
      const applicationId = str(args, "application_id");
      const attachmentId = optionalStr(args, "attachment_id");
      return report(
        attachmentId
          ? await readAttachmentAsCv({ applicationId, attachmentId })
          : await readRecordCv({ applicationId })
      );
    },
  },
  {
    name: "message_candidates",
    label: "Sending a bulk campaign",
    description:
      "Send one written message to a set of candidates by email or WhatsApp. Placeholders in double braces are filled per recipient. Everyone named on the list receives it — send only what the recruiter has actually written.",
    args: {
      channel: "string — EMAIL or WHATSAPP",
      application_ids: "string[] — from list_candidates or get_job_applicants",
      subject: "string — email only",
      message: "string — the body",
      template_key: "string — optional, the WhatsApp template key to send under",
    },
    run: async (args) => {
      const channel = str(args, "channel").toUpperCase();
      const ids = strArray(args, "application_ids");
      const message = str(args, "message");

      if (channel === "EMAIL") {
        return report(await sendBulkEmail({ applicationIds: ids, subject: str(args, "subject"), message }));
      }
      if (channel === "WHATSAPP") {
        return report(
          await sendBulkWhatsApp({
            applicationIds: ids,
            templateKey: optionalStr(args, "template_key") ?? "generic",
            message,
          })
        );
      }
      throw new ToolArgumentError('"channel" must be EMAIL or WHATSAPP.');
    },
  },

  /* ------------------------------- Sourcing ------------------------------- */
  {
    name: "convert_prospect",
    label: "Converting a prospect",
    description:
      "Turn a sourced prospect into an application against an opening, carrying their captured profile into the new record.",
    args: {
      id: "string — prospect id from list_prospects",
      job_id: "string — opening to apply them to",
    },
    run: async (args) => report(await convertProspect({ id: str(args, "id"), job_id: str(args, "job_id") })),
  },
  {
    name: "import_prospects",
    label: "Importing a prospect list",
    description:
      "Load a pasted list into the sourcing pool: one LinkedIn profile URL per line, or a CSV with a header row. The server re-parses the text and skips anyone already in the pool by profile URL or email, so pasting the same list twice adds nobody twice. It stores the list only — no profile is read and no message is sent.",
    args: {
      raw: "string — the list as pasted, one profile per line or a CSV with a header row",
      origin: "string — LINKEDIN or CSV, whichever the text is",
      job_id: "string — optional opening to attach the pool to",
    },
    run: async (args) => {
      const origin = str(args, "origin").toUpperCase();
      if (origin !== "LINKEDIN" && origin !== "CSV") {
        throw new ToolArgumentError('"origin" must be LINKEDIN or CSV.');
      }
      return report(
        await importProspects({
          raw: str(args, "raw"),
          origin,
          job_id: optionalStr(args, "job_id") ?? null,
        })
      );
    },
  },
  {
    name: "read_prospect_profile",
    label: "Structuring a pasted profile",
    description:
      "Structure the profile text a recruiter copied and store it on the prospect. This is the door that always works: a LinkedIn page is behind a login for any automated request, so nothing is fetched on the recruiter's behalf — only the text they pasted is sent to the model, and the stored profile names the model that structured it. Too little text to read a person out of is refused rather than guessed at.",
    args: {
      id: "string — prospect id from list_prospects",
      text: "string — the whole copied page, history and education included",
    },
    run: async (args) =>
      report(await pasteProspectProfile({ id: str(args, "id"), text: str(args, "text") })),
  },
  {
    name: "message_prospects",
    label: "Messaging prospects",
    description:
      "Send outreach copy to a set of prospects by email or WhatsApp and log each attempt on their record. At most 200 at a time. A non-empty `closed_roles` still means the send went through — quote those opening names and tell the recruiter to reopen the role, edit the copy or refile the prospects.",
    args: {
      ids: "string[] — prospect ids",
      channel: "string — EMAIL or WHATSAPP",
      body: "string — the message",
      subject: "string — optional, email only",
    },
    run: async (args) => {
      const channel = str(args, "channel").toUpperCase();
      if (channel !== "EMAIL" && channel !== "WHATSAPP") {
        throw new ToolArgumentError('"channel" must be EMAIL or WHATSAPP.');
      }
      return report(
        await sendProspectOutreach({
          ids: strArray(args, "ids"),
          channel: channel as "EMAIL" | "WHATSAPP",
          body: str(args, "body"),
          subject: optionalStr(args, "subject"),
        })
      );
    },
  },

  /* -------------------------------- Outbox -------------------------------- */
  {
    name: "retry_outbox_message",
    label: "Retrying a queued message",
    description: "Re-arm a WhatsApp job that failed or is still queued so the scheduler tries it again.",
    args: { id: "string — outbox job id from list_outbox" },
    run: async (args) => report(await retryWhatsAppJob(str(args, "id"))),
  },
  {
    name: "edit_outbox_message",
    label: "Rewriting a queued message",
    description:
      "Change the text or the send time of a WhatsApp message that has not gone out yet. A sent message is history and cannot be edited.",
    args: {
      id: "string — outbox job id",
      text: "string — the new body",
      scheduled_for: "string — ISO date-time",
    },
    run: async (args) =>
      report(
        await updateWhatsAppJob(str(args, "id"), {
          text: str(args, "text"),
          scheduledFor: isoDateTime(args, "scheduled_for"),
        })
      ),
  },
  {
    name: "resend_email",
    label: "Resending a failed email",
    description:
      "Re-send one email that failed, using the copy already stored on the log row. A delivered message is refused — it would mail the candidate twice.",
    args: { id: "string — communication log id from list_email_outbox" },
    run: async (args) => report(await resendEmailMessage(str(args, "id"))),
  },

  /* --------------------------- Gate and templates ------------------------- */
  {
    name: "save_gate_question",
    label: "Saving a viability gate question",
    description:
      "Create or edit a question the public apply form asks. Options marked as not passing make the application politely declined. Applies to one role, or to every published role when job_id is left out.",
    args: {
      id: "string — optional, the question being edited",
      job_id: "string — optional opening id, omit to ask on every role",
      question: "string",
      help_text: "string — optional",
      options: "object[] — [{\"label\":\"answer\",\"passes\":true}, …]",
      is_active: "boolean — optional, defaults to true",
      position: "number — optional, order on the form",
    },
    run: async (args) =>
      report(
        await saveGateQuestion({
          id: optionalStr(args, "id") ?? null,
          job_id: optionalStr(args, "job_id") ?? null,
          question: str(args, "question"),
          help_text: optionalStr(args, "help_text") ?? "",
          options: gateOptions(args),
          is_active: bool(args, "is_active", true),
          position: args.position === undefined ? 0 : num(args, "position"),
        })
      ),
  },
  {
    name: "set_gate_question_active",
    label: "Switching a gate question on or off",
    description: "Hide a viability question from applicants, or put it back, without deleting it.",
    args: {
      question_id: "string",
      active: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(await setGateQuestionActive(str(args, "question_id"), bool(args, "active", true))),
  },
  {
    name: "move_gate_question",
    label: "Reordering a gate question",
    description: "Move one viability question one slot up or down on the apply form.",
    args: {
      question_id: "string",
      direction: "string — up or down",
    },
    run: async (args) => {
      const direction = str(args, "direction").toLowerCase();
      if (direction !== "up" && direction !== "down") {
        throw new ToolArgumentError('"direction" must be "up" or "down".');
      }
      return report(await moveGateQuestion(str(args, "question_id"), direction));
    },
  },
  {
    name: "save_notification_template",
    label: "Editing a notification template",
    description:
      "Rewrite one message template. The dispatch paths send this copy verbatim, so the next stage alert a candidate receives is whatever is written here.",
    args: {
      id: "string — template row id from get_settings",
      subject: "string — optional, email subject",
      body: "string — under 4000 characters",
      is_active: "boolean — optional, defaults to true",
    },
    run: async (args) =>
      report(
        await saveNotificationTemplate({
          id: str(args, "id"),
          subject: optionalStr(args, "subject") ?? null,
          body: str(args, "body"),
          is_active: bool(args, "is_active", true),
        })
      ),
  },
  {
    name: "reset_notification_template",
    label: "Resetting a template to shipped copy",
    description:
      "Put one template back to the wording the portal ships with and switch it on. The row survives; only its text and switch are rewritten.",
    args: { id: "string — template row id from get_settings" },
    run: async (args) => report(await resetNotificationTemplate({ id: str(args, "id") })),
  },

  /* -------------------------------- Master data ------------------------------ */
  {
    name: "save_master_record",
    label: "Saving a master-data record",
    description:
      "Add or edit one entry in a controlled vocabulary — a company, department, location, role family, skill or currency. Jobs and prospects can only use values that exist here.",
    args: {
      entity: `string — one of ${MASTER_ENTITIES.join(", ")}`,
      id: "string — optional, the record being edited",
      fields: "object — the columns to write, e.g. {\"name\":\"Housekeeping\"} or {\"label\":\"US Dollar\"} for a currency",
    },
    run: async (args) => {
      const entity = str(args, "entity").toLowerCase();
      if (!MASTER_ENTITIES.includes(entity as MasterEntity)) {
        throw new ToolArgumentError(
          `"entity" must be one of: ${MASTER_ENTITIES.join(", ")}.`
        );
      }
      const fields = args.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new ToolArgumentError('"fields" must be an object of column names to values.');
      }
      const payload = fields as MasterPayload;
      const id = optionalStr(args, "id");
      return report(
        id
          ? await updateMasterRecord(entity as MasterEntity, id, payload)
          : await createMasterRecord(entity as MasterEntity, payload)
      );
    },
  },
  {
    name: "set_role_permission",
    label: "Granting or revoking a permission",
    description:
      "Turn one permission on or off for one role. This changes what every account with that role — and this assistant — is allowed to do.",
    args: {
      role_key: "string — role key from get_settings",
      permission_key: "string — permission key, e.g. candidates.write",
      granted: "boolean",
    },
    run: async (args) =>
      report(
        await updateRolePermission(
          str(args, "role_key") as Parameters<typeof updateRolePermission>[0],
          str(args, "permission_key"),
          bool(args, "granted", true)
        )
      ),
  },

  /* --------------------------------- Team ---------------------------------- */
  {
    name: "edit_staff_member",
    label: "Editing a team record",
    description:
      "Change a staff member's name, email or phone, their role, or the company they belong to. Only the fields sent are written. Sign-in is blocked with set_staff_active, not here.",
    args: {
      profile_id: "string — from list_team",
      full_name: "string — optional",
      email: "string — optional",
      phone: "string — optional",
      role: `string — optional, one of ${STAFF_ROLES.join(", ")}`,
      company_id: "string — optional company id, or blank to clear",
    },
    run: async (args) => {
      const profileId = str(args, "profile_id");
      const results: Record<string, unknown> = { ok: true, profile_id: profileId };

      const name = optionalStr(args, "full_name");
      const email = optionalStr(args, "email");
      if (name || email) {
        const bundle = await loadSettings();
        const member = bundle.staff.find((each) => each.id === profileId);
        if (!member) return { ok: false, error: "No staff account has that profile id." };
        const written = report(
          await updateStaffDetails(profileId, {
            full_name: name ?? member.full_name,
            email: email ?? member.email,
            phone: optionalStr(args, "phone") ?? member.phone ?? null,
          })
        );
        if (!written.ok) return written;
        results.details = written;
      }

      const role = optionalStr(args, "role");
      if (role) {
        const upper = role.toUpperCase();
        if (!STAFF_ROLES.includes(upper as AssignableStaffRole)) {
          throw new ToolArgumentError(`"role" must be one of: ${STAFF_ROLES.join(", ")}.`);
        }
        results.role = report(await updateStaffRole(profileId, upper as AssignableStaffRole));
      }

      if (args.company_id !== undefined) {
        results.company = report(
          await updateStaffCompany(profileId, optionalStr(args, "company_id") ?? null)
        );
      }

      if (!results.details && !results.role && !results.company) {
        return { ok: false, error: "Nothing to change — send full_name, email, role or company_id." };
      }
      return results;
    },
  },
  {
    name: "set_staff_active",
    label: "Activating or blocking a staff account",
    description:
      "Let a team member sign in, or block them. Blocking keeps their answers, applications and interview attribution — it is the offered path over deleting a person.",
    args: {
      profile_id: "string — from list_team",
      active: "boolean — true to allow sign-in, false to block",
    },
    run: async (args) =>
      report(await setStaffActive(str(args, "profile_id"), bool(args, "active", true))),
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
  {
    name: "delete_assessment_suite",
    label: "Deleting an assessment suite",
    description:
      "Permanently delete a suite and its questions. Refused as soon as any candidate holds a link — pause it instead, because the attempt is the record of what that person was asked.",
    args: { suite_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteTemplate(str(args, "suite_id"))),
  },
  {
    name: "delete_question",
    label: "Deleting a question",
    description:
      "Remove a question from a suite. Refused once a candidate has answered it, since their graded work would disappear with the question.",
    args: {
      question_id: "string",
      template_id: "string — the suite it belongs to",
    },
    destructive: true,
    run: async (args) =>
      report(await deleteQuestion(str(args, "question_id"), str(args, "template_id"))),
  },
  {
    name: "delete_attempt",
    label: "Deleting an assessment attempt",
    description:
      "Remove an attempt that was never opened, and with it the link the candidate was sent. Anything with answers attached is refused.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    destructive: true,
    run: async (args) => report(await deleteAttempt(str(args, "attempt_id"))),
  },
  {
    name: "delete_onboarding_task",
    label: "Deleting an onboarding task",
    description:
      "Remove one task from a hire's checklist. The plan itself is never deleted — a hire's checklist history stays on the record.",
    args: { plan_id: "string", task_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteTask(str(args, "plan_id"), str(args, "task_id"))),
  },
  {
    name: "delete_attachment",
    label: "Removing an attached file",
    description:
      "Delete one file staff attached to a candidate record — the stored object and the row that names it, so no dead download is offered.",
    args: { attachment_id: "string — from get_candidate_dossier" },
    destructive: true,
    run: async (args) => report(await deleteAttachment(str(args, "attachment_id"))),
  },
  {
    name: "delete_stored_file",
    label: "Deleting a stored file",
    description:
      "Permanently remove one object from a storage bucket by its full path. Stricter than the file browser: a candidate's upload is evidence, so this needs platform settings permission, and some buckets refuse staff deletes.",
    args: {
      bucket: "string — bucket key from list_files",
      path: "string — full storage key, e.g. applications/<id>/<file>.pdf",
    },
    destructive: true,
    run: async (args) => report(await deleteStoredFile(str(args, "bucket"), str(args, "path"))),
  },
  {
    name: "delete_gate_question",
    label: "Deleting a gate question",
    description:
      "Remove a viability question. Applications already carry its answer as text, so past records keep what was asked.",
    args: { question_id: "string" },
    destructive: true,
    run: async (args) => report(await deleteGateQuestion(str(args, "question_id"))),
  },
  {
    name: "delete_notification_template",
    label: "Deleting a message template",
    description:
      "Remove a template row. Prefer reset_notification_template: a deleted row is one nobody can look at again, and the copy only survives in the audit log.",
    args: { id: "string — template row id from get_settings" },
    destructive: true,
    run: async (args) => report(await deleteNotificationTemplate({ id: str(args, "id") })),
  },
  {
    name: "delete_master_record",
    label: "Deleting a master-data record",
    description:
      "Remove one company, department, location, role family, skill or currency. Refused while any opening, candidate or setting still points at it.",
    args: {
      entity: `string — one of ${MASTER_ENTITIES.join(", ")}`,
      id: "string — record id",
    },
    destructive: true,
    run: async (args) => {
      const entity = str(args, "entity").toLowerCase();
      if (!MASTER_ENTITIES.includes(entity as MasterEntity)) {
        throw new ToolArgumentError(`"entity" must be one of: ${MASTER_ENTITIES.join(", ")}.`);
      }
      return report(await deleteMasterRecord(entity as MasterEntity, str(args, "id")));
    },
  },
  {
    name: "delete_staff_account",
    label: "Deleting a staff account",
    description:
      "Permanently delete a team member's account and profile. Their interviews and audit rows survive with the name blanked; set_staff_active is the reversible answer and is what a recruiter usually means.",
    args: { profile_id: "string — from list_team" },
    destructive: true,
    run: async (args) => report(await deleteStaffAccount(str(args, "profile_id"))),
  },
];

export function toolByName(name: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.name === name);
}

/**
 * The tools that change nothing, so a turn can run them without a click.
 *
 * This is an exception list, not a description of the registry: a tool that is
 * not named here is treated as a write and waits for approval. That is the
 * fail-safe direction, because the risk nobody notices is the new tool someone
 * adds next month and forgets to classify — a read accidentally listed as a
 * write only costs recruiter a click, while a write accidentally listed as a
 * read is a change nobody approved.
 *
 * Three names here are worth explaining, because they look like writes:
 * - `ask_question` ends the turn on a button the recruiter has to press, so it
 *   is already the confirmation;
 * - `draft_interview_guide` generates text and stores nothing (`stored: false`);
 * - `read_candidate_cv` sounds like a read and is NOT listed, because it writes
 *   the parsed text onto the candidate row.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
  "ask_question",
  "dashboard_analytics",
  "get_report",
  "get_analytics_report",
  "list_jobs",
  "get_job",
  "list_candidates",
  "get_job_applicants",
  "get_application",
  "list_assessment_suites",
  "list_prospects",
  "get_prospect_profile",
  "list_outbox",
  "get_settings",
  "get_master_data",
  "list_model_routing",
  "get_audit_log",
  "get_candidate_dossier",
  "get_assessment_suite",
  "get_attempt_grades",
  "list_interviews",
  "list_onboarding_plans",
  "list_files",
  "list_gate_questions",
  "list_team",
  "list_email_outbox",
  "draft_interview_guide",
];

export { ToolArgumentError };
