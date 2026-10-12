export interface JobPosition {
  id: string;
  title: string;
  department: string;
  company: string;
  business_sector: 'Hospitality & Resort Ops' | 'Real Estate & Development' | 'Corporate & Finance' | 'Digital & Engineering';
  location: string;
  type: 'Full-time' | 'Contract' | 'Remote' | 'Hybrid';
  salary_range: string;
  required_skills: string[];
  preferred_skills: string[];
  cultural_values: string[];
  description: string;
  status: 'Active' | 'Draft' | 'Closed';
  applicants_count: number;
  created_at: string;
}

export interface InterviewSchedule {
  id: string;
  round_name: string;
  interviewer_name: string;
  interviewer_role: string;
  scheduled_datetime: string;
  location_or_link: string;
  platform: 'Google Meet' | 'Microsoft Teams' | 'On-Site' | 'WhatsApp Video';
  status: 'Scheduled' | 'Completed' | 'Rescheduled' | 'Cancelled';
  sentiment_score?: number;
  sentiment_summary?: string;
  interviewer_feedback?: string;
}

export interface CandidateOnboardingItem {
  id: string;
  task: string;
  category: 'Compliance' | 'Training' | 'Team Intro' | 'Milestone';
  phase: 'Pre-boarding' | 'Day 1' | 'Week 1' | 'Month 1' | 'Month 3';
  status: 'Pending' | 'In Progress' | 'Completed';
  target_date?: string;
}

export interface JobApplicant {
  id: string;
  applicant_name: string;
  email_address: string;
  phone_number: string;
  company: string;
  custom_business_sector: 'Hospitality & Resort Ops' | 'Real Estate & Development' | 'Corporate & Finance';
  job_title: string;
  custom_acquisition_source: 'LinkedIn' | 'Wuzzuf/Bayt' | 'WhatsApp Chatbot' | 'Direct Career Portal' | 'Email Ingestion' | 'Greenhouse' | 'Lever';
  status: 'Applied' | 'AI Screened' | 'Interview Scheduled' | 'Shortlisted' | 'Offered' | 'Hired' | 'Rejected';
  
  // Multi-dimensional AI Matching
  custom_ai_score: number | null; // Overall fit score
  skill_match_score: number;
  cultural_fit_score: number;
  soft_skills_score: number;
  radar_scores: {
    technical: number;
    domain: number;
    cultural: number;
    leadership: number;
    adaptability: number;
  };
  
  matched_skills: string[];
  missing_skills: string[];
  
  // AI Evaluations
  custom_ai_summary: string | null;
  custom_ai_strengths: string | null;
  custom_ai_red_flags: string | null;
  custom_suggested_interview_questions: string | null;
  custom_raw_cv_text: string;
  custom_whatsapp_chat_id?: string;
  
  // ATS Sync State
  ats_sync?: {
    greenhouse_id?: string;
    lever_id?: string;
    last_synced?: string;
    sync_status?: 'Synced' | 'Pending' | 'Error';
  };
  
  // Interviews & Scheduling
  interviews: InterviewSchedule[];
  
  // Sentiment Analysis
  sentiment_analysis?: {
    tone: string;
    confidence_level: number;
    sentiment_index: number;
    behavioral_cues: string[];
    risk_flags: string[];
  };
  
  // Onboarding Roadmap
  onboarding_checklist?: CandidateOnboardingItem[];
  
  // Candidate Feedback Loop
  personalized_feedback?: string;
  candidate_survey?: {
    rating: number;
    feedback: string;
    submitted_at: string;
  };

  // Canditech Assessment score
  assessment_score?: number;
  assessment_status?: 'Not Assigned' | 'Pending' | 'Completed';
  
  created_at: string;
}

export interface FrappeSourceFile {
  name: string;
  path: string;
  description: string;
  deliverableNumber: number;
  language: 'json' | 'python' | 'javascript' | 'toml' | 'markdown';
  content: string;
}

export type RecruiterRole = 'Head of Talent / Super Admin' | 'Lead Recruiter' | 'Hiring Manager' | 'Candidate Self-Service';
export type SupportedLanguage = 'en' | 'ar' | 'fr' | 'de';

// Canditech Pre-Employment Assessment Types
export interface AssessmentTask {
  id: string;
  title: string;
  type: 'video' | 'spreadsheet' | 'written' | 'mcq';
  description: string;
  time_limit_minutes: number;
  prompt: string;
  options?: string[];
  correct_option?: number;
  spreadsheet_data?: Array<Array<string | number>>;
  rubric_criteria?: string[];
}

export interface AssessmentTemplate {
  id: string;
  title: string;
  role: string;
  sector: string;
  company: string;
  duration_minutes: number;
  tasks_count: number;
  difficulty: 'Entry' | 'Mid' | 'Senior' | 'Executive';
  skills_tested: string[];
  tasks: AssessmentTask[];
}

export interface AssessmentSubmission {
  id: string;
  assessment_id: string;
  assessment_title: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  submitted_at: string;
  time_spent_seconds: number;
  overall_score: number; // 0-100
  percentile: number; // 0-100
  recommendation: 'Strong Hire' | 'Hire' | 'Borderline' | 'Do Not Hire';
  section_scores: {
    role_competency: number;
    problem_solving: number;
    communication: number;
    integrity_culture: number;
  };
  proctoring: {
    tab_switches: number;
    copy_paste_events: number;
    integrity_score: number;
  };
  ai_feedback: string;
  task_responses: Record<string, any>;
}

export type PortalMode = 'admin' | 'jobs';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
  statusMessage?: string;
  lastSynced?: string;
  recordCounts?: {
    jobs: number;
    applicants: number;
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  isConnected: boolean;
  statusMessage?: string;
  lastTested?: string;
}
