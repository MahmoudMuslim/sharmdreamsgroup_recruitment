/**
 * `tenants_and_companies` — one company in the group, and the careers profile
 * printed under its name.
 *
 * Master data: the console edits these rows and the pickers file openings, suites
 * and people under them. `sector` is the `business_sector` enum, not free text.
 *
 * The profile columns (`tagline` down to `cover_url`) arrive with 031 and are
 * blank until somebody files them — blank means "not filed yet", and the public
 * page prints no placeholder for one. `is_group_profile` marks the single row
 * whose story is the whole group's: the careers header reads it, and the pickers
 * a job or a suite is filed under leave it out.
 *
 * `Tenant` in `src/types` stays the six-column projection the staff session
 * reads; this is the row itself, in the order the database holds it.
 */

import type { BusinessSector } from "./vocabularies";

/** One item of a company's history, as the profile editor stores it. */
export interface Milestone {
  year: number | null;
  title: string;
  detail: string | null;
}

/** One item of a company's "why work here" list, as the group's own site writes it. */
export interface CompanyBenefit {
  title: string;
  text: string | null;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  sector: BusinessSector;
  country: string;
  created_at: string;
  legal_name: string | null;
  logo_url: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  is_active: boolean;
  sort_order: number;
  tagline: string | null;
  description: string | null;
  history: string | null;
  careers_pitch: string | null;
  founded_year: number | null;
  ownership_type: string | null;
  employee_range: string | null;
  headquarters: string | null;
  milestones: Milestone[] | null;
  benefits: CompanyBenefit[] | null;
  cover_url: string | null;
  is_group_profile: boolean;
}
