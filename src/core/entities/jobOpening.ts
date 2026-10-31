/**
 * `job_openings` — one vacancy a recruiter can file applicants against.
 */

import type {
  BusinessSector,
  EmploymentType,
  ExperienceLevel,
  JobStatus,
} from "./vocabularies";

export interface JobOpening {
  id: string;
  tenant_id: string;
  title: string;
  department: string;
  sector: BusinessSector;
  location: string;
  /**
   * `text` with a CHECK, so a row filed before Remote and Hybrid existed, or
   * hand-edited past the vocabulary, can hold a word `EmploymentType` does not
   * name. The board shows what is stored; the authoring door offers the list.
   */
  employment_type: EmploymentType;
  description: string;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  status: JobStatus;
  posted_at: string | null;
  closing_at: string | null;
  created_by: string | null;
  created_at: string;
  /** The currency the two salary columns are counted in. */
  salary_currency: string;
  /** The position definition this opening inherited its copy from, if any. */
  position_id: string | null;
  /** How many people this opening is allowed to hire; null is unset, not one. */
  positions_needed: number | null;
  experience_level: ExperienceLevel | null;
}
