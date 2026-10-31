/**
 * `applications` — one application for one opening, as the row is stored.
 *
 * Every field is the column, named as the column is named, in the order the
 * database holds them. Timestamps arrive as ISO strings through REST and
 * `null` where the column is nullable and unset.
 */

import type { ApplicationSource, ApplicationStage } from "./vocabularies";

/**
 * The soft-skill read the screening engine leaves in `ai_soft_skills`.
 *
 * What a score surface prints, so it carries no model name — the engine's own
 * result type adds that and the extra key never reaches this column.
 */
export interface SoftSkillReport {
  emotional_intelligence: number;
  communication: number;
  leadership_potential: number;
  cultural_fit: number;
  overall_sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  sentiment_score: number;
  summary: string;
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
  rejection_reason: string | null;
  hired_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Viability gate answers as scored when the application arrived, or null when
   * the role asked no questions. Stored, never recomputed — the recruiter reads
   * what the candidate actually answered.
   *
   * Read through `parseGateAnswers`, which drops an entry that arrived without a
   * question or an answer instead of trusting the column.
   */
  gate_answers: unknown;
  /**
   * Staff filing door. Set means the record is hidden from every staff surface
   * but kept whole — answers, notices and scores included — and can be restored.
   */
  archived_at: string | null;
  /**
   * The person this application belongs to.
   *
   * Set by the spine writers once the applicant's email matches a stored
   * profile; a null means the application stands on its own row alone.
   */
  person_id: string | null;
  processing_consent_at: string | null;
  talent_pool_consent_at: string | null;
  notice_version: string | null;
  /** Set by the erasure engine: the row is emptied of PII but its id survives. */
  erased_at: string | null;
  retention_warned_at: string | null;
  /**
   * The form snapshot — what the candidate answered, in the labels the form
   * used at submit time.
   *
   * Read through `parseSnapshot`, which returns null for a row whose encoding
   * it does not recognise rather than inventing answers.
   */
  form_answers: unknown;
}
