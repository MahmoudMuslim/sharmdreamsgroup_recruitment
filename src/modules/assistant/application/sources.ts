/**
 * The assistant's one seam to the screens: every server action and page model
 * the tool registry runs through, imported from `@/app/(admin)/**` exactly once
 * and handed back out here.
 *
 * This file exists so `domain/` never imports the presentation layer. A tool
 * handler still runs the same action the button on the screen runs — same
 * permission checks, same audit writes — it just arrives through this door.
 * Nothing here wraps, re-implements or re-checks anything.
 */

import { getDashboardAnalytics } from "@/app/(admin)/dashboard/actions";
import { getCandidateList, getCandidateTally } from "@/app/(admin)/candidates/actions";
import {
  draftCandidateFeedback,
  screenApplication,
  updateApplicationStage,
  type PipelineStage,
} from "@/app/(admin)/candidates/candidate-actions";
import { getFollowUpRules, getTemplates } from "@/app/(admin)/assessments/actions";
import { assignTemplate } from "@/app/(admin)/assessments/assessment-actions";
import {
  createJobOpening,
  deleteJobOpening,
  refileFiling,
  setJobStatus,
  updateJobOpening,
  type JobDraft,
} from "@/app/(admin)/jobs/job-actions";
import {
  getApplicantSubmission,
  getJobApplicants,
} from "@/app/(admin)/jobs/applicant-actions";
import { saveOpeningSkills } from "@/app/(admin)/jobs/opening-skills-actions";
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
import { loadSettings, saveSettings } from "@/app/(admin)/settings/actions";
import {
  getQuestionsForEditor,
  getTemplateDetail,
  getTemplateItemStats,
} from "@/app/(admin)/assessments/actions";
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
  moveApplicationsStageBulk,
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
  copyBankQuestion,
  deleteGateQuestion,
  getGateConsoleData,
  moveGateQuestion,
  saveGateQuestion,
  setGateQuestionActive,
} from "@/app/(admin)/questions/actions";
import { recommendTests } from "@/app/(admin)/assessments/recommendation-actions";
import {
  confirmOfferHire,
  issueOffer,
  readOfferPanel,
  withdrawOffer,
} from "@/app/(admin)/candidates/offer-actions";
import { actOnPrivacyRequest, getRetentionDesk } from "@/app/(admin)/retention/actions";
import {
  decideReferralBonus,
  fileReferral,
  getReferralBoard,
  reassignReferral,
} from "@/app/(admin)/referrals/actions";
import {
  addTime,
  deleteTime,
  discardTime,
  editTime,
  getLedger,
  startTime,
  stopTime,
} from "@/app/(admin)/time/actions";
import { deleteStoredFile, getFileBrowserData, openFolder } from "@/app/(admin)/files/actions";
import {
  fileSearchWords,
  folderReadNote,
  searchFiles,
} from "@/app/(admin)/files/file-search";
import { BUCKETS, bucketInfo } from "@/app/(admin)/files/file-browser-types";
import { LIST_LIMIT } from "@/app/(admin)/files/storage-list";
import { getInterviewAgenda } from "@/app/(admin)/interviews/actions";
import {
  AGENDA_CHAT_ROW_LIMIT,
  agendaReadNote,
  agendaWindowDays,
} from "@/app/(admin)/interviews/agenda-model";
import {
  getInterviewRoundSupport,
  getInterviewScorecardLayer,
  saveInterviewScorecard,
} from "@/app/(admin)/interviews/scorecard-actions";
import {
  getInterviewNotesForPanel,
  saveInterviewNotes,
} from "@/app/(admin)/interviews/notes-actions";
import {
  INTERVIEW_ROUND_LABELS,
  INTERVIEW_ROUNDS,
  panelAverage,
  roundLabel,
  scorecardAverage,
  scorecardsFor,
} from "@/modules/interviews/domain/interviewScorecard";
import {
  NOTES_BODY_LIMIT,
  NOTES_CHAT_CLIP,
  NOTES_SCHEMA_NOTE,
  clipNoteBody,
  notesFor,
} from "@/modules/interviews/domain/interviewNotes";
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
import {
  getEmailOutbox,
  resendEmailMessage,
  retryWhatsAppJob,
  updateWhatsAppJob,
} from "@/app/(admin)/whatsapp/actions";
import { TASK_CATEGORIES, TASK_OWNERS } from "@/app/(admin)/onboarding/checklist";
import { getTrail } from "@/app/(admin)/activity/actions";
import { BONUS_STATES } from "@/modules/referrals/domain/referral";
import { TIME_CATEGORIES } from "@/modules/timelog/domain/ledger";

export { getTrail };
export { getLedger };
export { readOfferPanel };
export { issueOffer };
export { withdrawOffer };
export { confirmOfferHire };
export { getRetentionDesk };
export { actOnPrivacyRequest };
export { getReferralBoard };
export { fileReferral };
export { reassignReferral };
export { decideReferralBonus };
export { startTime };
export { stopTime };
export { discardTime };
export { addTime };
export { editTime };
export { deleteTime };
export { copyBankQuestion };
export { recommendTests };
export { BONUS_STATES };
export { TIME_CATEGORIES };
export { getDashboardAnalytics };
export { getCandidateList };
export { getCandidateTally };
export { draftCandidateFeedback };
export { screenApplication };
export { updateApplicationStage };
export { moveApplicationsStageBulk };
export { getFollowUpRules };
export { getTemplates };
export { assignTemplate };
export { createJobOpening };
export { deleteJobOpening };
export { refileFiling };
export { setJobStatus };
export { updateJobOpening };
export { getApplicantSubmission };
export { getJobApplicants };
export { saveOpeningSkills };
export { deleteProspect };
export { getProspectPool };
export { importProspects };
export { saveProspect };
export { setProspectStage };
export { PROSPECT_STAGES };
export { poolScopeNote };
export { prospectSearchWords };
export { searchPool };
export { cancelWhatsAppJob };
export { getOutbox };
export { queueWhatsAppMessage };
export { OUTBOX_BUCKETS };
export { emailScopeNote };
export { emailSearchWords };
export { outboxScopeNote };
export { queueSearchWords };
export { searchEmails };
export { searchQueue };
export { loadSettings };
export { saveSettings };
export { getQuestionsForEditor };
export { getTemplateDetail };
export { getTemplateItemStats };
export { deleteTemplate };
export { saveTemplate };
export { setTemplateActive };
export { deleteQuestion };
export { moveQuestion };
export { saveQuestion };
export { deleteAttempt };
export { extendAttemptLink };
export { reissueAttemptLink };
export { revokeAttempt };
export { getAttemptGrades };
export { retryAttemptGrading };
export { scoreAttemptResponse };
export { deleteAttachment };
export { createCandidate };
export { sendBulkEmail };
export { sendBulkWhatsApp };
export { sendCandidateFeedback };
export { setCandidateArchive };
export { updateCandidateContact };
export { getCandidateDossier };
export { readAttachmentAsCv };
export { readRecordCv };
export { generateInterviewGuide };
export { rescheduleInterview };
export { scheduleInterview };
export { setInterviewStatus };
export { deleteGateQuestion };
export { getGateConsoleData };
export { moveGateQuestion };
export { saveGateQuestion };
export { setGateQuestionActive };
export { deleteStoredFile };
export { getFileBrowserData };
export { openFolder };
export { fileSearchWords };
export { folderReadNote };
export { searchFiles };
export { BUCKETS };
export { bucketInfo };
export { LIST_LIMIT };
export { getInterviewAgenda };
export { AGENDA_CHAT_ROW_LIMIT };
export { agendaReadNote };
export { agendaWindowDays };
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
export { getOnboardingData };
export { generateOnboardingPlan };
export { deleteTask };
export { saveTask };
export { setTaskCompleted };
export { deleteNotificationTemplate };
export { resetNotificationTemplate };
export { saveNotificationTemplate };
export { updateRolePermission };
export { convertProspect };
export { sendProspectOutreach };
export { getProspectProfile };
export { pasteProspectProfile };
export { getAnalyticsReport };
export { getRowReport };
export { getEmailOutbox };
export { resendEmailMessage };
export { retryWhatsAppJob };
export { updateWhatsAppJob };
export { TASK_CATEGORIES };
export { TASK_OWNERS };
export type { PipelineStage };
export type { JobDraft };
export type { ProspectStage };
export type { OutboxBucket };
export type { ChoiceDraft };
export type { QuestionDraft };
