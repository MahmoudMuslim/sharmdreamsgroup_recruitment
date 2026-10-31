/**
 * `candidate_attempts` — one sitting of one assessment suite.
 */

import type { AttemptStatus } from "./vocabularies";

export interface CandidateAttempt {
  id: string;
  application_id: string;
  template_id: string;
  /** The unguessable half of the candidate link; nobody signs in to sit a paper. */
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
  /**
   * The question the candidate was last looking at, kept so a returning
   * candidate resumes where they left rather than at the top.
   */
  current_index_hint: number;
  /** Null until the integrity read has run over the attempt's events. */
  integrity_score: number | null;
  /** Count of flagged events, not a verdict — the review desk reads the events. */
  integrity_flags: number;
  /** The dealt question order. Null means the paper was dealt in suite order. */
  question_order: string[] | null;
  /** Per-question option order, keyed by question id, for a shuffled paper. */
  option_order: Record<string, string[]> | null;
  /** Set when this paper is the follow-up a first result routed the candidate into. */
  follow_up_of_attempt_id: string | null;
}
