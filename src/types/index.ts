/**
 * Shared domain interfaces & DTOs for the entire platform.
 * Every entity, payload, and state object is strictly typed — no `any`.
 */

import type { GateAnswer } from "@/modules/careers/gate-questions";

// ---------------------------------------------------------------------------
// Enums (mirrored in db/schema.sql)
// ---------------------------------------------------------------------------

export type UserRole = "SUPER_ADMIN" | "RECRUITER" | "HIRING_MANAGER" | "CANDIDATE";

export type BusinessSector = "HOSPITALITY" | "REAL_ESTATE" | "COMMERCIAL_DEVELOPMENT" | "CORPORATE";

export type JobStatus = "DRAFT" | "PUBLISHED" | "PAUSED" | "CLOSED";

export type ApplicationStage =
  | "NEW"
  | "AI_SCREENING"
  | "ASSESSMENT"
  | "INTERVIEW"
  | "OFFER"
  | "HIRED"
  | "REJECTED";

export type ApplicationSource = "LINKEDIN" | "WHATSAPP" | "JOB_BOARD" | "CAREER_SITE" | "REFERRAL" | "ATS_IMPORT";

export type QuestionType =
  | "EXCEL_MODEL"
  | "VIDEO_PITCH"
  | "CASE_STUDY"
  | "MULTIPLE_CHOICE"
  | "SITUATIONAL_JUDGMENT";

export type AttemptStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "EXPIRED";

export type MessageChannel = "WHATSAPP" | "EMAIL" | "IN_APP";

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type Locale = "en" | "ar" | "ru" | "de";

// ---------------------------------------------------------------------------
// Database entities
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  sector: BusinessSector;
  country: string;
  created_at: string;
}

export interface UserProfile {
  id: string;
  auth_user_id: string;
  tenant_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  locale: Locale;
  created_at: string;
}

export interface JobOpening {
  id: string;
  tenant_id: string;
  title: string;
  department: string;
  sector: BusinessSector;
  location: string;
  employment_type: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP";
  description: string;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  status: JobStatus;
  posted_at: string | null;
  closing_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Application {
  id: string;
  job_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  cv_file_path: string | null;
  cv_text: string | null;
  tracking_code: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  ai_match_score: number | null;
  ai_screening_summary: string | null;
  ai_strengths: string[] | null;
  ai_gaps: string[] | null;
  ai_soft_skills: SoftSkillReport | null;
  ai_feedback: string | null;
  diversity_flags: Record<string, string> | null;
  /**
   * Viability gate answers as scored when the application arrived, or null when
   * the role asked no questions. Stored, never recomputed — the recruiter reads
   * what the candidate actually answered.
   */
  gate_answers: GateAnswer[] | null;
  rejection_reason: string | null;
  hired_at: string | null;
  /**
   * Staff filing door. Set means the record is hidden from every staff surface
   * but kept whole — answers, notices and scores included — and can be restored.
   */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SoftSkillReport {
  emotional_intelligence: number;
  communication: number;
  leadership_potential: number;
  cultural_fit: number;
  overall_sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  sentiment_score: number;
  summary: string;
}

export interface AssessmentTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  is_active: boolean;
  created_at: string;
}

export interface AssessmentQuestion {
  id: string;
  template_id: string;
  question_type: QuestionType;
  title: string;
  prompt: string;
  config: QuestionConfig;
  points: number;
  position: number;
}

export interface MultipleChoiceOption {
  label: string;
  text: string;
  is_correct: boolean;
  /**
   * SITUATIONAL_JUDGMENT only: how effective this response is, 0–100.
   *
   * A judgment scene has no single correct option — every response earns a
   * share of the question's marks — so the quiz's `is_correct` is left false and
   * this percentage is what the submit route scores. Older quiz rows have no
   * score, and the sanitizer strips both before a candidate sees the options.
   */
  score?: number;
}

export interface SpreadsheetCellData {
  value: string | number | null;
}

export interface QuestionConfig {
  /** EXCEL_MODEL: initial grid + expected outputs */
  initial_sheet?: { data: (string | number | null)[][]; col_widths?: number[] };
  expected_outputs?: { cell: string; formula_hint?: string; description: string }[];
  /** VIDEO_PITCH */
  max_duration_seconds?: number;
  min_duration_seconds?: number;
  /** CASE_STUDY */
  context?: string;
  min_words?: number;
  /** MULTIPLE_CHOICE, SITUATIONAL_JUDGMENT */
  options?: MultipleChoiceOption[];
}

export interface CandidateAttempt {
  id: string;
  application_id: string;
  template_id: string;
  access_token: string;
  status: AttemptStatus;
  time_limit_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  total_score: number | null;
  max_score: number | null;
  draft_saved_at: string | null;
  created_at: string;
}

export interface CandidateResponse {
  id: string;
  attempt_id: string;
  question_id: string;
  answer_text: string | null;
  spreadsheet_state: Record<string, SpreadsheetCellData> | null;
  video_path: string | null;
  video_duration_seconds: number | null;
  transcript: string | null;
  score: number | null;
  max_score: number;
  ai_evaluation: QuestionEvaluation | null;
  updated_at: string;
}

export interface QuestionEvaluation {
  score: number;
  rationale: string;
  strengths: string[];
  improvements: string[];
}

export interface CommunicationLog {
  id: string;
  application_id: string | null;
  channel: MessageChannel;
  direction: MessageDirection;
  recipient: string;
  body: string;
  delivered: boolean;
  error_message: string | null;
  created_at: string;
}

export interface InterviewSchedule {
  id: string;
  application_id: string;
  interviewer_profile_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  calendar_provider: "GOOGLE" | "MICROSCSOFT" | "MANUAL" | "MICROSOFT";
  calendar_event_id: string | null;
  meeting_link: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  created_at: string;
}

export interface OnboardingPlan {
  id: string;
  application_id: string;
  tenant_id: string;
  checklist: OnboardingChecklistItem[];
  skill_gaps: SkillGap[];
  internal_mobility_suggestions: string[];
  retention_risk_score: number | null;
  progress: number;
  generated_by_ai: boolean;
  created_at: string;
}

export interface OnboardingChecklistItem {
  id: string;
  title: string;
  description: string;
  category: "ADMIN" | "IT" | "TRAINING" | "CULTURE" | "ROLE_SPECIFIC";
  due_offset_days: number;
  completed: boolean;
}

export interface SkillGap {
  skill: string;
  current_level: number;
  required_level: number;
  recommended_action: string;
}

// ---------------------------------------------------------------------------
// AI engine DTOs
// ---------------------------------------------------------------------------

export interface CvScreeningResult {
  match_score: number;
  decision: "ADVANCE" | "BORDERLINE" | "REJECT";
  summary: string;
  key_competencies: string[];
  strengths: string[];
  gaps: string[];
  anonymization_applied: boolean;
  model_used: string;
}

export interface SentimentAnalysisResult {
  emotional_intelligence: number;
  communication: number;
  leadership_potential: number;
  cultural_fit: number;
  sentiment_score: number;
  overall_sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  summary: string;
  model_used: string;
}

export interface FeedbackReport {
  greeting: string;
  overall_assessment: string;
  strengths: string[];
  development_areas: string[];
  next_steps: string;
  closing: string;
}

export interface GeneratedInterviewQuestions {
  questions: { question: string; rationale: string; skill_probed: string }[];
}

export interface AiEvaluationRequest {
  job_title: string;
  job_requirements: string[];
  cv_text: string;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: { message: { role: string; content: string } | null; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message: string; code?: number };
}

// ---------------------------------------------------------------------------
// Assessment store DTOs
// ---------------------------------------------------------------------------

export interface AttemptDraft {
  attempt_id: string;
  current_question_index: number;
  time_remaining_seconds: number;
  spreadsheet_data_map: Record<string, Record<string, SpreadsheetCellData>>;
  case_study_answers_map: Record<string, string>;
  choice_answers_map: Record<string, string>;
  video_paths_map: Record<string, string>;
  saved_at: string;
}

// ---------------------------------------------------------------------------
// Analytics DTOs
// ---------------------------------------------------------------------------

export interface PipelineFunnelStep {
  stage: ApplicationStage;
  count: number;
  /** Share of every live application sitting here. Each one counts at one stage only. */
  share_of_pipeline: number;
  /**
   * This count measured against the population of the stage listed before it.
   * Both figures are who is sitting somewhere *now*, not a record of who moved,
   * so the denominator travels with it. Null where the comparison would describe
   * nothing: New has no stage before it, and Rejected's is Hired — rejections
   * happen at every stage, so rejected ÷ hired is neither a pass rate nor a
   * drop-out rate.
   */
  vs_previous_stage: { stage: ApplicationStage; count: number; percent: number } | null;
}

export interface ChannelEffectiveness {
  source: ApplicationSource;
  applications: number;
  hires: number;
  conversion_rate: number;
}

export interface FitScoreBucket {
  range: string;
  count: number;
}

export interface TimeToHirePoint {
  month: string;
  avg_days: number;
}

/** One row of the dashboard candidate board. */
export interface DashboardCandidate {
  application_id: string;
  full_name: string;
  job_title: string;
  department: string;
  /** Null when unscored, or when `security.mask_scores_for_reviewers` hides it. */
  match_score: number | null;
  stage: ApplicationStage;
  source: ApplicationSource;
  applied_at: string | null;
  has_assessment: boolean;
  assessment_score: number | null;
}

/** One job opening with the pipeline that is sitting on it. */
export interface DashboardRoleRow {
  job_id: string;
  title: string;
  department: string;
  status: string;
  applications: number;
  hires: number;
  /** Null when nothing on this role is scored, or when scores are masked. */
  avg_fit: number | null;
  /** Days the oldest live application has been waiting; null when none is. */
  oldest_waiting_days: number | null;
  closing_at: string | null;
}

/** A live application that has been in a non-terminal stage the longest. */
export interface DashboardWaitingRow {
  application_id: string;
  full_name: string;
  job_title: string;
  stage: ApplicationStage;
  applied_at: string;
  waiting_days: number;
  match_score: number | null;
}

export interface DashboardAnalytics {
  total_applications: number;
  active_jobs: number;
  hires_this_quarter: number;
  avg_time_to_hire_days: number;
  avg_fit_score: number;
  scored_applications: number;
  /** True when `security.mask_scores_for_reviewers` hid every AI score above. */
  scores_masked: boolean;
  applications_last_14_days: { date: string; count: number }[];
  pipeline: PipelineFunnelStep[];
  channels: ChannelEffectiveness[];
  fit_distribution: FitScoreBucket[];
  time_to_hire_trend: TimeToHirePoint[];
  candidates: DashboardCandidate[];
  /** Every opening the board knows about, busiest first. */
  roles: DashboardRoleRow[];
  /** Applications still sitting in a non-terminal stage, oldest first. */
  oldest_waiting: DashboardWaitingRow[];
  /** How many applications are still waiting, including the ones not listed. */
  waiting_total: number;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface ScreenRequest {
  application_id: string;
}

export interface ScreenResponse {
  ok: boolean;
  result?: CvScreeningResult;
  error?: string;
}

export interface SentimentRequest {
  application_id: string;
  use_video_transcript?: boolean;
}

export interface FeedbackRequest {
  application_id: string;
}

export interface InterviewQuestionsRequest {
  application_id: string;
}

export interface WhatsAppOutboundMessage {
  to: string;
  template?: string;
  text?: string;
}

// ---------------------------------------------------------------------------
// Job application form (public)
// ---------------------------------------------------------------------------

export interface JobApplicationPayload {
  job_id: string;
  full_name: string;
  email: string;
  phone: string;
  cv_file_name: string;
  cv_file_mime: string;
  cv_file_b64: string;
}
