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
 *
 * The tool bodies live one file per section under ./registry — a tool list
 * stopped being a 3,400-line read. This file only stitches them together and
 * re-exports the types, helpers and value objects the registry depends on.
 */

export { AGENDA_CHAT_ROW_LIMIT } from "./registry/shared";
export { AI_CAPABILITIES } from "./registry/shared";
export { ALL_SETTINGS } from "./registry/shared";
export { ANALYTICS_WINDOWS } from "./registry/shared";
export { ANSWER_ROWS } from "./registry/shared";
export { APPLICATION_SOURCES } from "./registry/shared";
export type { AssignableStaffRole } from "./registry/shared";
export type { AssistantQuestion } from "./registry/shared";
export type { AssistantTool } from "./registry/shared";
export { BUCKETS } from "./registry/shared";
export { CHART_VIEWS } from "./registry/shared";
export type { ChoiceDraft } from "./registry/shared";
export { DOSSIER_ALERT_ROWS } from "./registry/shared";
export { FILED_ENTITIES } from "./registry/shared";
export { FOLDER_FILE_ROWS } from "./registry/shared";
export type { FiledEntity } from "./registry/shared";
export { GATE_JOB_ROWS } from "./registry/shared";
export { GENERATED_FORMATS } from "./registry/shared";
export { GENERATED_FORMAT_LABEL } from "./registry/shared";
export type { GateOption } from "./registry/shared";
export { INTERVIEW_OUTCOMES } from "./registry/shared";
export { JOB_STATUSES } from "./registry/shared";
export type { JobDraft } from "./registry/shared";
export type { JobReadFilter } from "./registry/shared";
export { LIST_LIMIT } from "./registry/shared";
export { MASTER_ENTITIES } from "./registry/shared";
export { MAX_FILE_COLUMNS } from "./registry/shared";
export { MAX_FILE_LINES_PER_SECTION } from "./registry/shared";
export { MAX_FILE_ROWS_PER_SHEET } from "./registry/shared";
export { MAX_FILE_SECTIONS } from "./registry/shared";
export { MAX_FILE_SHEETS } from "./registry/shared";
export { MAX_OPTIONS } from "./registry/shared";
export { MAX_OPTION_CHARS } from "./registry/shared";
export { MODEL_ROWS } from "./registry/shared";
export type { MasterEntity } from "./registry/shared";
export type { MasterPayload } from "./registry/shared";
export { OUTBOX_BUCKETS } from "./registry/shared";
export type { OutboxBucket } from "./registry/shared";
export { PIPELINE_STAGES } from "./registry/shared";
export { PROSPECT_STAGES } from "./registry/shared";
export { PROVIDER_GROUPS } from "./registry/shared";
export type { PipelineStage } from "./registry/shared";
export type { ProspectStage } from "./registry/shared";
export { QUESTION_TYPES } from "./registry/shared";
export type { QuestionConfig } from "./registry/shared";
export type { QuestionDraft } from "./registry/shared";
export type { QuestionType } from "./registry/shared";
export { REPORTS } from "./registry/shared";
export { ROOT_FILE_ROWS } from "./registry/shared";
export { SECTORS } from "./registry/shared";
export { SETTINGS_TRAIL_GROUPS } from "./registry/shared";
export { SETTINGS_TRAIL_LIMIT } from "./registry/shared";
export { SETTINGS_TRAIL_SEARCH_SCAN } from "./registry/shared";
export { STAFF_ROLES } from "./registry/shared";
export { TASK_CATEGORIES } from "./registry/shared";
export { TASK_OWNERS } from "./registry/shared";
export { TRAIL_LIMIT } from "./registry/shared";
export { TRAIL_SEARCH_SCAN } from "./registry/shared";
export type { ToolArgs } from "./registry/shared";
export { ToolArgumentError } from "./registry/shared";
export { UNPLANNED_HIRE_ROWS } from "./registry/shared";
export { UUID_SHAPE } from "./registry/shared";
export { agendaReadNote } from "./registry/shared";
export { agendaWindowDays } from "./registry/shared";
export { asQuestion } from "./registry/shared";
export { assignTemplate } from "./registry/shared";
export { bool } from "./registry/shared";
export { cancelWhatsAppJob } from "./registry/shared";
export { candidateScopeNote } from "./registry/shared";
export { candidateSearchWords } from "./registry/shared";
export { chartForView } from "./registry/shared";
export { choiceDrafts } from "./registry/shared";
export { clip } from "./registry/shared";
export { companyNameById } from "./registry/shared";
export { convertProspect } from "./registry/shared";
export { createCandidate } from "./registry/shared";
export { createJobOpening } from "./registry/shared";
export { createMasterRecord } from "./registry/shared";
export { credentialsTab } from "./registry/shared";
export { deleteAttachment } from "./registry/shared";
export { deleteAttempt } from "./registry/shared";
export { deleteCredential } from "./registry/shared";
export { deleteGateQuestion } from "./registry/shared";
export { deleteJobOpening } from "./registry/shared";
export { deleteMasterRecord } from "./registry/shared";
export { deleteNotificationTemplate } from "./registry/shared";
export { deleteProspect } from "./registry/shared";
export { deleteQuestion } from "./registry/shared";
export { deleteStaffAccount } from "./registry/shared";
export { deleteStoredFile } from "./registry/shared";
export { deleteTask } from "./registry/shared";
export { deleteTemplate } from "./registry/shared";
export { draftCandidateFeedback } from "./registry/shared";
export { emailScopeNote } from "./registry/shared";
export { emailSearchWords } from "./registry/shared";
export { extendAttemptLink } from "./registry/shared";
export { fileSearchWords } from "./registry/shared";
export { filedEntity } from "./registry/shared";
export { filterCandidates } from "./registry/shared";
export { flagField } from "./registry/shared";
export { folderReadNote } from "./registry/shared";
export { formatBytes } from "./registry/shared";
export { gateOptions } from "./registry/shared";
export { generateInterviewGuide } from "./registry/shared";
export { generateOnboardingPlan } from "./registry/shared";
export { getAnalyticsReport } from "./registry/shared";
export { getApplicantSubmission } from "./registry/shared";
export { getAttemptGrades } from "./registry/shared";
export { getCandidateDossier } from "./registry/shared";
export { getCandidateList } from "./registry/shared";
export { getCandidateTally } from "./registry/shared";
export { getDashboardAnalytics } from "./registry/shared";
export { getEmailOutbox } from "./registry/shared";
export { getFileBrowserData } from "./registry/shared";
export { getGateConsoleData } from "./registry/shared";
export { getInterviewAgenda } from "./registry/shared";
export { getJobApplicants } from "./registry/shared";
export { getJobOpening } from "./registry/shared";
export { getMasterData } from "./registry/shared";
export { getModelCatalogue } from "./registry/shared";
export { getOnboardingData } from "./registry/shared";
export { getOutbox } from "./registry/shared";
export { getProspectPool } from "./registry/shared";
export { getProspectProfile } from "./registry/shared";
export { getQuestionsForEditor } from "./registry/shared";
export { getRowReport } from "./registry/shared";
export { getTemplateDetail } from "./registry/shared";
export { getTemplates } from "./registry/shared";
export { importProspects } from "./registry/shared";
export { isChartView } from "./registry/shared";
export { isFiledEntity } from "./registry/shared";
export { isoDateTime } from "./registry/shared";
export { jobDraft } from "./registry/shared";
export { listCredentialAudit } from "./registry/shared";
export { listCredentials } from "./registry/shared";
export { listJobOpenings } from "./registry/shared";
export { listModelRouting } from "./registry/shared";
export { listSettingsTrail } from "./registry/shared";
export { listingCapNote } from "./registry/shared";
export { loadSettings } from "./registry/shared";
export { loadStaffConsole } from "./registry/shared";
export { masterEntity } from "./registry/shared";
export { masterListCounts } from "./registry/shared";
export { masterListNote } from "./registry/shared";
export { modelReadNote } from "./registry/shared";
export { modelSearchWords } from "./registry/shared";
export { moveGateQuestion } from "./registry/shared";
export { moveQuestion } from "./registry/shared";
export { noDriftSentence } from "./registry/shared";
export { num } from "./registry/shared";
export { objArray } from "./registry/shared";
export { openFolder } from "./registry/shared";
export { openingReadNote } from "./registry/shared";
export { openingScopeWords } from "./registry/shared";
export { openingSearchWords } from "./registry/shared";
export { optionalChoice } from "./registry/shared";
export { optionalId } from "./registry/shared";
export { optionalStr } from "./registry/shared";
export { outboxScopeNote } from "./registry/shared";
export { parseFileSpec } from "./registry/shared";
export { pasteProspectProfile } from "./registry/shared";
export { poolScopeNote } from "./registry/shared";
export { projectMasterList } from "./registry/shared";
export { prospectSearchWords } from "./registry/shared";
export { providerById } from "./registry/shared";
export { questionAsReply } from "./registry/shared";
export { questionDraftFrom } from "./registry/shared";
export { questionFrom } from "./registry/shared";
export { questionType } from "./registry/shared";
export { queueSearchWords } from "./registry/shared";
export { queueWhatsAppMessage } from "./registry/shared";
export { reachNote } from "./registry/shared";
export { readAttachmentAsCv } from "./registry/shared";
export { readFilingDrift } from "./registry/shared";
export { readRecordCv } from "./registry/shared";
export { readWebPage } from "./registry/shared";
export { refileFiling } from "./registry/shared";
export { reissueAttemptLink } from "./registry/shared";
export { report } from "./registry/shared";
export { rescheduleInterview } from "./registry/shared";
export { resendEmailMessage } from "./registry/shared";
export { resetNotificationTemplate } from "./registry/shared";
export { retryAttemptGrading } from "./registry/shared";
export { retryWhatsAppJob } from "./registry/shared";
export { revokeAttempt } from "./registry/shared";
export { saveCredential } from "./registry/shared";
export { saveGateQuestion } from "./registry/shared";
export { saveModelRouting } from "./registry/shared";
export { saveNotificationTemplate } from "./registry/shared";
export { saveProspect } from "./registry/shared";
export { saveQuestion } from "./registry/shared";
export { saveSettings } from "./registry/shared";
export { saveTask } from "./registry/shared";
export { saveTemplate } from "./registry/shared";
export { scheduleInterview } from "./registry/shared";
export { scoreAttemptResponse } from "./registry/shared";
export { screenApplication } from "./registry/shared";
export { searchEmails } from "./registry/shared";
export { searchFiles } from "./registry/shared";
export { searchModels } from "./registry/shared";
export { searchOpenings } from "./registry/shared";
export { searchPool } from "./registry/shared";
export { searchQueue } from "./registry/shared";
export { searchSettings } from "./registry/shared";
export { searchSuites } from "./registry/shared";
export { searchWeb } from "./registry/shared";
export { sendBulkEmail } from "./registry/shared";
export { sendBulkWhatsApp } from "./registry/shared";
export { sendCandidateFeedback } from "./registry/shared";
export { sendProspectOutreach } from "./registry/shared";
export { setCandidateArchive } from "./registry/shared";
export { setGateQuestionActive } from "./registry/shared";
export { setInterviewStatus } from "./registry/shared";
export { setJobStatus } from "./registry/shared";
export { setProspectStage } from "./registry/shared";
export { setStaffActive } from "./registry/shared";
export { setTaskCompleted } from "./registry/shared";
export { setTemplateActive } from "./registry/shared";
export { settingReadNote } from "./registry/shared";
export { settingSearchWords } from "./registry/shared";
export { settingsTrailNote } from "./registry/shared";
export { str } from "./registry/shared";
export { strArray } from "./registry/shared";
export { suiteReadNote } from "./registry/shared";
export { suiteSearchWords } from "./registry/shared";
export { textField } from "./registry/shared";
export { trailFind } from "./registry/shared";
export { trailGroup } from "./registry/shared";
export { trailNumber } from "./registry/shared";
export { trailPage } from "./registry/shared";
export { trailPageCount } from "./registry/shared";
export { trailPages } from "./registry/shared";
export { trailScope } from "./registry/shared";
export { trailScopeNote } from "./registry/shared";
export { trailWords } from "./registry/shared";
export { updateApplicationStage } from "./registry/shared";
export { updateCandidateContact } from "./registry/shared";
export { updateJobOpening } from "./registry/shared";
export { updateMasterRecord } from "./registry/shared";
export { updateRolePermission } from "./registry/shared";
export { updateStaffCompany } from "./registry/shared";
export { updateStaffDetails } from "./registry/shared";
export { updateStaffRole } from "./registry/shared";
export { updateWhatsAppJob } from "./registry/shared";
export { verifyCredential } from "./registry/shared";
export { writeAssistantFile } from "./registry/shared";

import { ask_question } from "./registry/ask_question";
import { reads } from "./registry/reads";
import { credentials } from "./registry/credentials";
import { writes } from "./registry/writes";
import { authoring } from "./registry/authoring";
import { links } from "./registry/links";
import { grading } from "./registry/grading";
import { interviews } from "./registry/interviews";
import { onboarding } from "./registry/onboarding";
import { candidates } from "./registry/candidates";
import { sourcing } from "./registry/sourcing";
import { outbox } from "./registry/outbox";
import { gateTemplates } from "./registry/gateTemplates";
import { masterData } from "./registry/masterData";
import { team } from "./registry/team";
import { web } from "./registry/web";
import { files } from "./registry/files";
import { offers } from "./registry/offers";
import { privacy } from "./registry/privacy";
import { referrals } from "./registry/referrals";
import { time } from "./registry/time";
import { destructive } from "./registry/destructive";
import type { AssistantTool } from "./registry/shared";

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  ...ask_question,
  ...reads,
  ...credentials,
  ...writes,
  ...authoring,
  ...links,
  ...grading,
  ...interviews,
  ...onboarding,
  ...candidates,
  ...sourcing,
  ...outbox,
  ...gateTemplates,
  ...masterData,
  ...team,
  ...web,
  ...files,
  ...offers,
  ...privacy,
  ...referrals,
  ...time,
  ...destructive,
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
 * A few names here are worth explaining, because they look like writes:
 * - `ask_question` ends the turn on a button the recruiter has to press, so it
 *   is already the confirmation;
 * - `draft_interview_guide` generates text and stores nothing (`stored: false`);
 * - `recommend_tests` reads an opening and the suite catalogue and returns a
 *   recommendation; it writes no row and changes no status;
 * - `create_file` hands the recruiter a download and touches no row — the bytes are
 *   not stored anywhere, only the card that names the file;
 * - `read_candidate_cv` sounds like a read and is NOT listed, because it writes
 *   the parsed text onto the candidate row.
 *
 * `search_web` and `read_web_page` are listed even though they leave the building:
 * an approval card exists to stop a record being changed without a person, and a
 * lookup changes no record. What guards those two is the web switch itself.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
  "ask_question",
  "search_web",
  "read_web_page",
  "dashboard_analytics",
  "get_report",
  "get_analytics_report",
  "list_jobs",
  "get_job",
  "list_candidates",
  "get_job_applicants",
  "rank_candidates",
  "get_application",
  "read_offer",
  "list_assessment_suites",
  "list_prospects",
  "get_prospect_profile",
  "list_outbox",
  "get_settings",
  "get_master_data",
  "get_filing_drift",
  "list_model_routing",
  "get_audit_log",
  "get_activity_trail",
  "get_retention_desk",
  "get_referral_board",
  "get_time_ledger",
  "list_credentials",
  "get_credential_audit",
  "get_candidate_dossier",
  "get_assessment_suite",
  "get_item_statistics",
  "get_attempt_grades",
  "list_interviews",
  "read_interview_scorecards",
  "read_interview_notes",
  "list_onboarding_plans",
  "list_files",
  "list_gate_questions",
  "list_team",
  "list_email_outbox",
  "draft_interview_guide",
  "recommend_tests",
  "create_file",
];

