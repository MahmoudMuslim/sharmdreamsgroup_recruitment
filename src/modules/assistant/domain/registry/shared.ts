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
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  isExperienceLevel,
} from "@/modules/jobs/domain/openingTerms";
import {
  DEFAULT_REQUIRED_LEVEL,
  MAX_REQUIRED_SKILLS,
  MAX_SKILL_LEVEL,
  MIN_SKILL_LEVEL,
  OPENING_SKILLS_MIGRATION,
  SKILL_SOURCES,
} from "@/modules/jobs/domain/openingSkills";
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
  ACTIVITY_AREAS,
  ACTIVITY_ENTITIES,
  ACTIVITY_SURFACES,
  ACTOR_KINDS,
  TRAIL_WINDOWS,
  describeActor,
} from "@/modules/activity/domain/trail";
import { TRAIL_PAGE_ROWS } from "@/modules/activity/domain/trailQuery";
import {
  CATEGORY_LABEL,
  DEFAULT_WINDOW,
  TIME_SCOPES,
  TIME_WINDOWS,
  byCategory,
  elapsedSeconds,
  formatSpan,
  isRunning,
  ledgerReachNote,
  subjectOf,
  timeWindow,
  totalSeconds,
} from "@/modules/timelog/domain/ledger";
import {
  searchSuites,
  suiteReadNote,
  suiteSearchWords,
} from "@/modules/assessment/domain/suiteSearch";
import { followUpBandText } from "@/modules/assessment/domain/followUp";
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
import type { RubricDraftRow } from "@/modules/assessment/domain/rubric";
import type { QuestionConfig, QuestionType } from "@/types";
import {
  getDashboardAnalytics,
  getCandidateList,
  getCandidateTally,
  draftCandidateFeedback,
  screenApplication,
  updateApplicationStage,
  type PipelineStage,
  getFollowUpRules,
  getTemplates,
  getTrail,
  getLedger,
  assignTemplate,
  createJobOpening,
  deleteJobOpening,
  refileFiling,
  setJobStatus,
  updateJobOpening,
  type JobDraft,
  getApplicantSubmission,
  getJobApplicants,
  saveOpeningSkills,
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
  getTemplateItemStats,
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
  getInterviewRoundSupport,
  getInterviewScorecardLayer,
  saveInterviewScorecard,
  getInterviewNotesForPanel,
  saveInterviewNotes,
  NOTES_BODY_LIMIT,
  NOTES_CHAT_CLIP,
  NOTES_SCHEMA_NOTE,
  clipNoteBody,
  notesFor,
  INTERVIEW_ROUNDS,
  INTERVIEW_ROUND_LABELS,
  panelAverage,
  roundLabel,
  scorecardAverage,
  scorecardsFor,
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
 * Questions one item-statistics answer lists.
 *
 * The smallest cap in this file, because an item row is the wordiest thing the
 * registry hands back: a uuid, the question's title at its own 160-character
 * ceiling, four figures and the longest note the statistics domain writes (267
 * characters, measured). Eight of those beside the answer's own scope notes come
 * to 5,106 characters against the 6,000 clip — ten would not fit, so the window
 * is what keeps the answer whole. The suite's totals are tallied over every item,
 * never over the listed ones, so a clipped window cannot shrink the claim.
 */
const ITEM_STAT_ROWS = 8;

/**
 * Rows one change-trail answer lists.
 *
 * The second-smallest cap here, because a trail row is the second-wordiest thing
 * the registry hands back after an item statistic: the `summary` column's own
 * ceiling is 400 characters, `actor_label` 160, `entity_id` 64, and the actor
 * line is clipped at 240 so a joined account name cannot widen it without bound.
 * A fabricated row built from those ceilings and the longest words the
 * vocabulary holds serialises to 932 characters; four of them beside this
 * answer's own scope, page and reach notes measure 4,971 against the 6,000 clip.
 * Five would fit only at 5,904 — 96 characters is not a bound once a summary
 * quotes anything — and six overflow, which would make the envelope drop a row
 * after the note had promised it. The page behind the read is the console's own
 * 40 rows, and `total`, `pages` and the tally are counted over the whole cut,
 * never over the listed ones, so a short window cannot shrink the claim.
 */
const ACTIVITY_TRAIL_ROWS = 4;

/**
 * Spans one ledger answer lists.
 *
 * Four, not the trail's four for the trail's reason: a ledger row is the wordiest
 * thing the chat lists, carrying both the task (the column's 160-character
 * ceiling) and the note (clipped at 200) where a trail row carries one summary.
 * A measured maximal answer — a capped 1,001-span read, every text at its
 * ceiling — is 4,463 characters with four rows; a fifth takes it to 5,394 and a
 * sixth past the 6,000-character budget, so four keeps real headroom for the
 * note and the category split. The note states the cut's count, the loaded rows
 * and the listed rows separately, so this cap cannot be read as the window. The
 * screen behind the link holds the rest.
 */
const TIME_LEDGER_ROWS = 4;

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

/**
 * The same refusal for a vocabulary spelled in lowercase, sometimes with spaces.
 *
 * `optionalChoice` upper-cases, which would refuse every value of a set stored
 * the way the trail stores its areas and surfaces (`"career site"`). The string
 * is handed back exactly as the vocabulary spells it, because that is what the
 * database filter compares against — a "career-site" guess would match nothing.
 */
function optionalWord(args: ToolArgs, key: string, words: readonly string[]): string | null {
  const value = optionalStr(args, key);
  if (value === undefined) return null;
  const lower = value.toLowerCase();
  if (!words.includes(lower)) {
    throw new ToolArgumentError(`"${key}" must be one of: ${words.join(", ")}.`);
  }
  return lower;
}

/** The set an openings read counted, in the words its scope note quotes back. */
function openingScopeWords(filter: JobReadFilter, company: string | null = null): string {
  const at = company ? ` at ${company}` : "";
  if (!filter) return `openings${at}`;
  return filter === "HIREABLE"
    ? `openings you can still hire for${at}`
    : `openings marked ${filter}${at}`;
}

/**
 * Everything `create_job` / `update_job` write, so both paths stay identical.
 *
 * `fromPosition` is set only by `create_job`. It relaxes the fields a position
 * supplies — title, company, department, sector, description — and carries the
 * `position_id` the write inherits from, so a chat can open a role with just a
 * position, a location and a type. `update_job` never passes it: an edit rewrites
 * the whole record and never moves the link.
 */
function jobDraft(args: ToolArgs, opts: { fromPosition?: boolean } = {}): JobDraft {
  const positionId = opts.fromPosition ? optionalStr(args, "position_id") : undefined;
  // A field the position fills may be absent; every other path keeps the old
  // requirement, so a chat that forgets the title on an edit is still refused here.
  const text = (key: string) => (positionId ? optionalStr(args, key) ?? "" : str(args, key));

  const sector = text("sector").toUpperCase();
  if (sector && !SECTORS.includes(sector as (typeof SECTORS)[number])) {
    throw new ToolArgumentError(`"sector" must be one of: ${SECTORS.join(", ")}.`);
  }

  // Three states, not two. An absent argument has to stay absent: while 033 is
  // unapplied a chat has no level to send, and a null would name a column the
  // database does not have and fail the whole write. `null` is the model asking
  // to clear a recorded level; a word is the level itself.
  const rawLevel = args.experience_level;
  let experienceLevel: string | null | undefined;
  if (rawLevel !== undefined) {
    if (rawLevel === null || rawLevel === "") {
      experienceLevel = null;
    } else if (
      typeof rawLevel === "string" &&
      isExperienceLevel(rawLevel.trim().toUpperCase())
    ) {
      experienceLevel = rawLevel.trim().toUpperCase();
    } else {
      throw new ToolArgumentError(
        `"experience_level" must be one of: ${EXPERIENCE_LEVEL_VALUES.join(", ")}, or null to clear it.`
      );
    }
  }

  return {
    ...(positionId ? { position_id: positionId } : {}),
    title: text("title"),
    tenant_id: text("tenant_id"),
    department: text("department"),
    sector,
    // A position defines a post, not where it sits: the location is still the
    // caller's to name.
    location: str(args, "location"),
    employment_type: (
      positionId ? optionalStr(args, "employment_type") ?? "FULL_TIME" : str(args, "employment_type")
    ).toUpperCase(),
    ...(experienceLevel !== undefined ? { experience_level: experienceLevel } : {}),
    description: text("description"),
    requirements: args.requirements === undefined ? [] : strArray(args, "requirements"),
    min_salary_usd: optionalStr(args, "min_salary_usd") ?? "",
    max_salary_usd: optionalStr(args, "max_salary_usd") ?? "",
    salary_currency: optionalStr(args, "salary_currency") ?? "USD",
    status: (positionId ? optionalStr(args, "status") ?? "DRAFT" : str(args, "status")).toUpperCase(),
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

/** `[{ text, is_correct? , score? }, …]` as the question editor expects it. */
function choiceDrafts(args: ToolArgs): ChoiceDraft[] {
  return objArray(args, "options").map((option) => ({
    text: textField(option, "text"),
    is_correct: flagField(option, "is_correct"),
    score: scoreField(option),
  }));
}

/** A judgment response's 0–100 percentage, or null when the caller sent none. */
function scoreField(record: Record<string, unknown>): number | null {
  const value = record.score;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `[{ label, passes }, …]` as the viability gate expects it. */
function gateOptions(args: ToolArgs): GateOption[] {
  return objArray(args, "options").map((option) => ({
    label: textField(option, "label"),
    passes: option.passes === undefined ? true : flagField(option, "passes"),
  }));
}

/**
 * `[{ label, weight, description? }, …]` as the question editor expects it.
 *
 * A chat model quotes a number as `"40"` as often as it sends `40`, so a numeric
 * string is read as the number it stands for. Anything else is passed through
 * unread — `readRubricDraft` owns the rule about what a weight may be, and its
 * refusal names the criterion the model actually mistyped.
 */
function rubricDrafts(args: ToolArgs): RubricDraftRow[] {
  return objArray(args, "rubric").map((row) => ({
    label: textField(row, "label"),
    weight: numberField(row.weight),
    description: textField(row, "description"),
    // The id only: the write door resolves the catalogue's spelling, so a chat
    // model cannot name a skill the catalogue does not hold.
    skill_id: textField(row, "skill_id"),
  }));
}

function numberField(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `[{ skill_id, required_level?, source? }, …]` as the requisition's skill list.
 *
 * A chat model quotes a level as `"4"` as often as it sends `4`, so a numeric
 * string is read as the number it stands for. A level that is not a number is
 * passed through as something the save will refuse, never as nothing: an absent
 * key there means "take the column's default", so a reader that turned
 * `"advanced"` into `undefined` would store a level 3 nobody chose and print it
 * back to the recruiter as theirs. `readRequiredSkills` owns the rule.
 */
function requiredSkillDrafts(args: ToolArgs): Record<string, unknown>[] {
  return objArray(args, "skills").map((row) => {
    const given = row.required_level;
    return {
      skill_id: row.skill_id,
      required_level: typeof given === "string" ? Number(given) : given,
      ...(row.source === undefined ? {} : { source: row.source }),
    };
  });
}

const QUESTION_TYPES: QuestionType[] = [
  "MULTIPLE_CHOICE",
  "SITUATIONAL_JUDGMENT",
  "CASE_STUDY",
  "EXCEL_MODEL",
  "VIDEO_PITCH",
  "CODING",
];
const STAFF_ROLES: AssignableStaffRole[] = ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"];
const INTERVIEW_OUTCOMES = ["COMPLETED", "NO_SHOW", "CANCELLED"] as const;
const MASTER_ENTITIES: MasterEntity[] = [
  "companies",
  "departments",
  "locations",
  "role_families",
  "positions",
  "skills",
  "currencies",
];

/**
 * One of the seven vocabularies, or a refusal that names the seven.
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
  const picksOptions = type === "MULTIPLE_CHOICE" || type === "SITUATIONAL_JUDGMENT";
  const options = picksOptions ? choiceDrafts(args) : [];
  if (picksOptions && !args.options) {
    throw new ToolArgumentError(
      type === "SITUATIONAL_JUDGMENT"
        ? '"options" is required for a SITUATIONAL_JUDGMENT question: [{"text","score"}, …], at least two with different scores.'
        : '"options" is required for a MULTIPLE_CHOICE question: [{"text","is_correct"}, …].'
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
    language: optionalStr(args, "language"),
    starter_code: optionalStr(args, "starter_code"),
    min_duration_seconds:
      args.min_duration_seconds === undefined ? null : num(args, "min_duration_seconds"),
    max_duration_seconds:
      args.max_duration_seconds === undefined ? null : num(args, "max_duration_seconds"),
    preserve_config:
      args.preserve_config && typeof args.preserve_config === "object"
        ? (args.preserve_config as QuestionConfig)
        : null,
    // Only present when the caller spoke of it: an absent key tells the writer to
    // leave the stored scheme alone, while a list — even an empty one, which is
    // how a cleared panel arrives — is an instruction about the scheme itself.
    ...(args.rubric === undefined ? {} : { rubric: rubricDrafts(args) }),
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

export { ANSWER_ROWS, ACTIVITY_TRAIL_ROWS, DOSSIER_ALERT_ROWS, FOLDER_FILE_ROWS, GATE_JOB_ROWS, INTERVIEW_OUTCOMES, ITEM_STAT_ROWS, MASTER_ENTITIES, MAX_OPTIONS, MAX_OPTION_CHARS, MODEL_ROWS, QUESTION_TYPES, ROOT_FILE_ROWS, STAFF_ROLES, ToolArgumentError, UNPLANNED_HIRE_ROWS, UUID_SHAPE, bool, choiceDrafts, clip, filedEntity, flagField, gateOptions, isoDateTime, jobDraft, listingCapNote, masterEntity, num, objArray, openingScopeWords, optionalChoice, optionalId, optionalStr, optionalWord, questionDraftFrom, questionType, report, requiredSkillDrafts, str, strArray, textField };

export { ACTIVITY_AREAS };
export { ACTIVITY_ENTITIES };
export { ACTIVITY_SURFACES };
export { ACTOR_KINDS };
export { describeActor };
export { AGENDA_CHAT_ROW_LIMIT };
export { followUpBandText };
export { AI_CAPABILITIES };
export { ALL_SETTINGS };
export { ANALYTICS_WINDOWS };
export { APPLICATION_SOURCES };
export { BUCKETS };
export { CATEGORY_LABEL };
export { CHART_VIEWS };
export { DEFAULT_WINDOW };
export { EMPLOYMENT_TYPE_VALUES };
export { EXPERIENCE_LEVEL_VALUES };
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
export {
  DEFAULT_REQUIRED_LEVEL,
  MAX_REQUIRED_SKILLS,
  MAX_SKILL_LEVEL,
  MIN_SKILL_LEVEL,
  OPENING_SKILLS_MIGRATION,
  SKILL_SOURCES,
};
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
export { TRAIL_PAGE_ROWS };
export { TIME_LEDGER_ROWS };
export { TIME_SCOPES };
export { TIME_WINDOWS };
export { timeWindow };
export { TRAIL_WINDOWS };
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
export { byCategory };
export { elapsedSeconds };
export { formatSpan };
export { isRunning };
export { ledgerReachNote };
export { subjectOf };
export { totalSeconds };
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
export { getInterviewRoundSupport };
export { getInterviewScorecardLayer };
export { saveInterviewScorecard };
export { getInterviewNotesForPanel };
export { saveInterviewNotes };
export { NOTES_BODY_LIMIT };
export { NOTES_CHAT_CLIP };
export { NOTES_SCHEMA_NOTE };
export { clipNoteBody };
export { notesFor };
export { INTERVIEW_ROUNDS };
export { INTERVIEW_ROUND_LABELS };
export { panelAverage };
export { roundLabel };
export { scorecardAverage };
export { scorecardsFor };
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
export { getTemplateItemStats };
export { getFollowUpRules };
export { getTemplates };
export { getLedger };
export { getTrail };
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
export { saveOpeningSkills };
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
