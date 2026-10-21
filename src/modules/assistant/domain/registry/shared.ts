import { listSettingsTrail } from "@/modules/settings/application/settings-trail-actions";
import { getMasterData } from "@/modules/settings/application/master-data-actions";
import {
  masterListCounts,
  masterListNote,
  projectMasterList,
} from "@/modules/settings/domain/masterDataLists";
import {
  FILED_ENTITIES,
  isFiledEntity,
  noDriftSentence,
  type FiledEntity,
} from "@/modules/settings/domain/masterDataFiling";
import { readFilingDrift } from "@/modules/jobs/application/filingVocabularies";
import {
  deleteCredential,
  getModelCatalogue,
  listCredentialAudit,
  listCredentials,
  listModelRouting,
  saveCredential,
  saveModelRouting,
  verifyCredential,
} from "@/modules/settings/application/credential-actions";
import {
  AI_CAPABILITIES,
  PROVIDER_GROUPS,
  providerById,
} from "@/modules/settings/domain/providers";
import { credentialsTab } from "@/modules/settings/domain/settingsNav";
import {
  TRAIL_LIMIT,
  TRAIL_SEARCH_SCAN,
  trailNumber,
  trailPages,
  trailScope,
  trailScopeNote,
  trailWords,
} from "@/modules/settings/domain/credentialTrail";
import {
  SETTINGS_TRAIL_GROUPS,
  SETTINGS_TRAIL_LIMIT,
  SETTINGS_TRAIL_SEARCH_SCAN,
  settingsTrailNote,
  trailFind,
  trailGroup,
  trailPage,
  trailPageCount,
} from "@/modules/settings/domain/settingsTrail";
import {
  modelReadNote,
  modelSearchWords,
  searchModels,
} from "@/modules/settings/domain/modelSearch";
import {
  ALL_SETTINGS,
  searchSettings,
  settingReadNote,
  settingSearchWords,
} from "@/modules/settings/domain/settingSearch";
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
import {
  GENERATED_FORMATS,
  GENERATED_FORMAT_LABEL,
  MAX_FILE_COLUMNS,
  MAX_FILE_LINES_PER_SECTION,
  MAX_FILE_ROWS_PER_SHEET,
  MAX_FILE_SECTIONS,
  MAX_FILE_SHEETS,
  formatBytes,
  parseFileSpec,
} from "@/modules/assistant/domain/generatedFiles";
import { writeAssistantFile } from "@/modules/assistant/infrastructure/fileWriter";
import { reachNote } from "@/modules/assistant/domain/reach-note";
import {
  searchSuites,
  suiteReadNote,
  suiteSearchWords,
} from "@/modules/assessment/domain/suiteSearch";
import { REPORTS } from "@/modules/analytics/domain/documents";
import { ANALYTICS_WINDOWS } from "@/modules/analytics/domain/report";
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
import { searchWeb, readWebPage } from "@/modules/assistant/infrastructure/webLookup";
import type { GateOption } from "@/modules/careers/gate-questions";
import type { AssignableStaffRole, MasterEntity, MasterPayload } from "@/modules/settings/domain/types";
import type { QuestionConfig, QuestionType } from "@/types";
import {
  getDashboardAnalytics,
  getCandidateList,
  getCandidateTally,
  draftCandidateFeedback,
  screenApplication,
  updateApplicationStage,
  type PipelineStage,
  getTemplates,
  assignTemplate,
  createJobOpening,
  deleteJobOpening,
  refileFiling,
  setJobStatus,
  updateJobOpening,
  type JobDraft,
  getApplicantSubmission,
  getJobApplicants,
  deleteProspect,
  getProspectPool,
  importProspects,
  saveProspect,
  setProspectStage,
  PROSPECT_STAGES,
  poolScopeNote,
  prospectSearchWords,
  searchPool,
  type ProspectStage,
  cancelWhatsAppJob,
  getOutbox,
  queueWhatsAppMessage,
  OUTBOX_BUCKETS,
  emailScopeNote,
  emailSearchWords,
  outboxScopeNote,
  queueSearchWords,
  searchEmails,
  searchQueue,
  type OutboxBucket,
  loadSettings,
  saveSettings,
  getQuestionsForEditor,
  getTemplateDetail,
  deleteTemplate,
  saveTemplate,
  setTemplateActive,
  deleteQuestion,
  moveQuestion,
  saveQuestion,
  type ChoiceDraft,
  type QuestionDraft,
  deleteAttempt,
  extendAttemptLink,
  reissueAttemptLink,
  revokeAttempt,
  getAttemptGrades,
  retryAttemptGrading,
  scoreAttemptResponse,
  deleteAttachment,
  createCandidate,
  sendBulkEmail,
  sendBulkWhatsApp,
  sendCandidateFeedback,
  setCandidateArchive,
  updateCandidateContact,
  getCandidateDossier,
  readAttachmentAsCv,
  readRecordCv,
  generateInterviewGuide,
  rescheduleInterview,
  scheduleInterview,
  setInterviewStatus,
  deleteGateQuestion,
  getGateConsoleData,
  moveGateQuestion,
  saveGateQuestion,
  setGateQuestionActive,
  deleteStoredFile,
  getFileBrowserData,
  openFolder,
  fileSearchWords,
  folderReadNote,
  searchFiles,
  BUCKETS,
  LIST_LIMIT,
  getInterviewAgenda,
  AGENDA_CHAT_ROW_LIMIT,
  agendaReadNote,
  agendaWindowDays,
  getOnboardingData,
  generateOnboardingPlan,
  deleteTask,
  saveTask,
  setTaskCompleted,
  deleteNotificationTemplate,
  resetNotificationTemplate,
  saveNotificationTemplate,
  updateRolePermission,
  convertProspect,
  sendProspectOutreach,
  getProspectProfile,
  pasteProspectProfile,
  getAnalyticsReport,
  getRowReport,
  getEmailOutbox,
  resendEmailMessage,
  retryWhatsAppJob,
  updateWhatsAppJob,
  TASK_CATEGORIES,
  TASK_OWNERS,
} from "@/modules/assistant/application/sources";

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
  /**
   * Refused unless the recruiter has the web switch on.
   *
   * These two leave the portal, so they are gated separately from a permission:
   * no recruiter role grants or withholds the public internet here, only the
   * switch in the panel does.
   */
  web?: boolean;
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

/**
 * One of the six vocabularies, or a refusal that names the six.
 *
 * The read, the save and the retire all address a list by the same word the console
 * uses in its own `?section=`, so one validator keeps a chat answer, a written row and
 * a link pointing at the same list.
 */
function masterEntity(value: string): MasterEntity {
  const lower = value.toLowerCase().trim();
  if (!MASTER_ENTITIES.includes(lower as MasterEntity)) {
    throw new ToolArgumentError(`"entity" must be one of: ${MASTER_ENTITIES.join(", ")}.`);
  }
  return lower as MasterEntity;
}

/**
 * One of the four lists a job opening files itself under, or a refusal that names four.
 *
 * Narrower than `masterEntity` on purpose: a role family and a skill are on a
 * candidate, not on an opening, so a drift read or a refile asked about them would
 * count nothing and say it as if that were a clean result.
 */
function filedEntity(value: string): FiledEntity {
  const lower = value.toLowerCase().trim();
  if (!isFiledEntity(lower)) {
    throw new ToolArgumentError(
      `"entity" must be one of: ${FILED_ENTITIES.join(", ")} — an opening files itself under those four lists.`
    );
  }
  return lower;
}

function questionType(value: string): QuestionType {  const upper = value.toUpperCase();
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

export { ANSWER_ROWS, DOSSIER_ALERT_ROWS, FOLDER_FILE_ROWS, GATE_JOB_ROWS, INTERVIEW_OUTCOMES, MASTER_ENTITIES, MAX_OPTIONS, MAX_OPTION_CHARS, MODEL_ROWS, QUESTION_TYPES, ROOT_FILE_ROWS, STAFF_ROLES, ToolArgumentError, UNPLANNED_HIRE_ROWS, UUID_SHAPE, bool, choiceDrafts, clip, filedEntity, flagField, gateOptions, isoDateTime, jobDraft, listingCapNote, masterEntity, num, objArray, openingScopeWords, optionalChoice, optionalId, optionalStr, questionDraftFrom, questionType, report, str, strArray, textField };

export { AGENDA_CHAT_ROW_LIMIT };
export { AI_CAPABILITIES };
export { ALL_SETTINGS };
export { ANALYTICS_WINDOWS };
export { APPLICATION_SOURCES };
export { BUCKETS };
export { CHART_VIEWS };
export { FILED_ENTITIES };
export { GENERATED_FORMATS };
export { GENERATED_FORMAT_LABEL };
export { JOB_STATUSES };
export { LIST_LIMIT };
export { MAX_FILE_COLUMNS };
export { MAX_FILE_LINES_PER_SECTION };
export { MAX_FILE_ROWS_PER_SHEET };
export { MAX_FILE_SECTIONS };
export { MAX_FILE_SHEETS };
export { OUTBOX_BUCKETS };
export { PIPELINE_STAGES };
export { PROSPECT_STAGES };
export { PROVIDER_GROUPS };
export { REPORTS };
export { SECTORS };
export { SETTINGS_TRAIL_GROUPS };
export { SETTINGS_TRAIL_LIMIT };
export { SETTINGS_TRAIL_SEARCH_SCAN };
export { TASK_CATEGORIES };
export { TASK_OWNERS };
export { TRAIL_LIMIT };
export { TRAIL_SEARCH_SCAN };
export { agendaReadNote };
export { agendaWindowDays };
export { assignTemplate };
export { cancelWhatsAppJob };
export { candidateScopeNote };
export { candidateSearchWords };
export { chartForView };
export { companyNameById };
export { convertProspect };
export { createCandidate };
export { createJobOpening };
export { createMasterRecord };
export { credentialsTab };
export { deleteAttachment };
export { deleteAttempt };
export { deleteCredential };
export { deleteGateQuestion };
export { deleteJobOpening };
export { deleteMasterRecord };
export { deleteNotificationTemplate };
export { deleteProspect };
export { deleteQuestion };
export { deleteStaffAccount };
export { deleteStoredFile };
export { deleteTask };
export { deleteTemplate };
export { draftCandidateFeedback };
export { emailScopeNote };
export { emailSearchWords };
export { extendAttemptLink };
export { fileSearchWords };
export { filterCandidates };
export { folderReadNote };
export { formatBytes };
export { generateInterviewGuide };
export { generateOnboardingPlan };
export { getAnalyticsReport };
export { getApplicantSubmission };
export { getAttemptGrades };
export { getCandidateDossier };
export { getCandidateList };
export { getCandidateTally };
export { getDashboardAnalytics };
export { getEmailOutbox };
export { getFileBrowserData };
export { getGateConsoleData };
export { getInterviewAgenda };
export { getJobApplicants };
export { getJobOpening };
export { getMasterData };
export { getModelCatalogue };
export { getOnboardingData };
export { getOutbox };
export { getProspectPool };
export { getProspectProfile };
export { getQuestionsForEditor };
export { getRowReport };
export { getTemplateDetail };
export { getTemplates };
export { importProspects };
export { isChartView };
export { isFiledEntity };
export { listCredentialAudit };
export { listCredentials };
export { listJobOpenings };
export { listModelRouting };
export { listSettingsTrail };
export { loadSettings };
export { loadStaffConsole };
export { masterListCounts };
export { masterListNote };
export { modelReadNote };
export { modelSearchWords };
export { moveGateQuestion };
export { moveQuestion };
export { noDriftSentence };
export { openFolder };
export { openingReadNote };
export { openingSearchWords };
export { outboxScopeNote };
export { parseFileSpec };
export { pasteProspectProfile };
export { poolScopeNote };
export { projectMasterList };
export { prospectSearchWords };
export { providerById };
export { queueSearchWords };
export { queueWhatsAppMessage };
export { reachNote };
export { readAttachmentAsCv };
export { readFilingDrift };
export { readRecordCv };
export { readWebPage };
export { refileFiling };
export { reissueAttemptLink };
export { rescheduleInterview };
export { resendEmailMessage };
export { resetNotificationTemplate };
export { retryAttemptGrading };
export { retryWhatsAppJob };
export { revokeAttempt };
export { saveCredential };
export { saveGateQuestion };
export { saveModelRouting };
export { saveNotificationTemplate };
export { saveProspect };
export { saveQuestion };
export { saveSettings };
export { saveTask };
export { saveTemplate };
export { scheduleInterview };
export { scoreAttemptResponse };
export { screenApplication };
export { searchEmails };
export { searchFiles };
export { searchModels };
export { searchOpenings };
export { searchPool };
export { searchQueue };
export { searchSettings };
export { searchSuites };
export { searchWeb };
export { sendBulkEmail };
export { sendBulkWhatsApp };
export { sendCandidateFeedback };
export { sendProspectOutreach };
export { setCandidateArchive };
export { setGateQuestionActive };
export { setInterviewStatus };
export { setJobStatus };
export { setProspectStage };
export { setStaffActive };
export { setTaskCompleted };
export { setTemplateActive };
export { settingReadNote };
export { settingSearchWords };
export { settingsTrailNote };
export { suiteReadNote };
export { suiteSearchWords };
export { trailFind };
export { trailGroup };
export { trailNumber };
export { trailPage };
export { trailPageCount };
export { trailPages };
export { trailScope };
export { trailScopeNote };
export { trailWords };
export { updateApplicationStage };
export { updateCandidateContact };
export { updateJobOpening };
export { updateMasterRecord };
export { updateRolePermission };
export { updateStaffCompany };
export { updateStaffDetails };
export { updateStaffRole };
export { updateWhatsAppJob };
export { verifyCredential };
export { writeAssistantFile };
export type { AssignableStaffRole };
export type { ChoiceDraft };
export type { FiledEntity };
export type { GateOption };
export type { JobDraft };
export type { JobReadFilter };
export type { MasterEntity };
export type { MasterPayload };
export type { OutboxBucket };
export type { PipelineStage };
export type { ProspectStage };
export type { QuestionConfig };
export type { QuestionDraft };
export type { QuestionType };
