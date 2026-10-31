/**
 * `sourced_prospects` — one person in the sourcing pool before they applied.
 *
 * A prospect is not a candidate: no application row exists until a recruiter
 * converts them, and the outreach ladder this row sits on is its own
 * vocabulary, separate from the pipeline stages.
 */

import type { ProspectOrigin, ProspectProfileSource, ProspectStage } from "./vocabularies";

export interface SourcedProspect {
  id: string;
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  origin: ProspectOrigin;
  stage: ProspectStage;
  /** The opening they were sourced for, when the recruiter picked one. */
  job_id: string | null;
  /** Set when the conversion filed the application; the prospect keeps its own row. */
  application_id: string | null;
  created_by: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The captured profile — headline, roles, education — as the reader stored it.
   *
   * Read through `normalizeProspectProfile`, which drops an entry it cannot
   * place rather than rendering half a structure; the column is jsonb because
   * the AI read returns whatever the page gave it.
   */
  profile: unknown;
  profile_url: string | null;
  profile_source: ProspectProfileSource | null;
  profile_captured_at: string | null;
  /** Why the last capture failed, so the drawer can say it instead of showing nothing. */
  profile_error: string | null;
}
