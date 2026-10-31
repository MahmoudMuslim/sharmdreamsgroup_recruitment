/**
 * Settings domain model.
 *
 * Settings are stored as key/value rows (`app_settings`) so new options can be
 * introduced without a migration, while the TypeScript schema below keeps the
 * surface type-safe and gives the UI a single place to declare its shape.
 */

import type { Company } from "@/core/entities";

export type AppRole =
  | "SUPER_ADMIN"
  | "SUBSIDIARY_HR_MANAGER"
  | "RECRUITER"
  | "HIRING_MANAGER"
  | "INTERVIEWER"
  | "CANDIDATE";

/** The subset of `AppRole` the `user_role` enum and `is_staff()` accept. */
export type AssignableStaffRole = "SUPER_ADMIN" | "RECRUITER" | "HIRING_MANAGER";

export type PermissionKey =
  | "candidates.read"
  | "candidates.write"
  | "candidates.delete"
  | "candidates.view_scores"
  | "candidates.view_health_data"
  | "candidates.view_family_data"
  | "candidates.view_emergency_contacts"
  | "scores.view_unmasked"
  | "assessments.create"
  | "assessments.grade"
  | "assessments.assign"
  | "jobs.manage"
  | "interviews.schedule"
  | "messages.send"
  | "analytics.view"
  | "analytics.export"
  | "time.track"
  | "settings.manage_users"
  | "settings.manage_roles"
  | "settings.manage_platform"
  | "companies.manage"
  | "users.manage"
  | "users.create"
  | "assistant.commands";

export interface Permission {
  key: PermissionKey;
  label: string;
  group_name: string;
  description: string | null;
}

export interface Role {
  key: AppRole;
  label: string;
  description: string | null;
  is_system: boolean;
}

export interface RoleGrant {
  role_key: AppRole;
  permission_key: PermissionKey;
  granted: boolean;
}

/**
 * The five columns the Team console picks a company out of — deliberately not
 * `Company`, because `loadSettings()` selects exactly these and a cast to the
 * full row would claim a profile that was never read.
 */
export interface CompanyChoice {
  id: string;
  name: string;
  slug: string;
  sector: string;
  country: string;
}

export interface StaffMember {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  tenant_id: string | null;
  phone: string | null;
  created_at: string;
}

/** A pending team invite — no account exists yet, so the person cannot sign in. */
export interface StaffInvite {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  company_id: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expires_at: string;
  created_at: string;
}

/**
 * The channels a notification template can belong to.
 *
 * Named because the templates console's tab strip, the actions that write a row
 * and the links the assistant emits all have to agree on which channels exist —
 * a fourth channel added here must show up as a tab and a link, not silently as
 * a row nobody can reach.
 */
export type NotificationChannel = "EMAIL" | "WHATSAPP" | "IN_APP";

export interface NotificationTemplate {
  id: string;
  key: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
}

export interface SettingRow {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  company_id: string | null;
  scope: "GLOBAL" | "TENANT";
}

/* --------------------------------------------------------------------------
 * Master data — the controlled vocabularies the rest of the app selects from
 * instead of free text.
 *
 * The company row itself is `Company` in `src/core/entities/company.ts`, beside
 * the other row types; this file keeps the lists' own shapes.
 * ----------------------------------------------------------------------- */

export interface Department {
  id: string;
  tenant_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  head_profile_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Location {
  id: string;
  tenant_id: string | null;
  name: string;
  city: string | null;
  governorate: string | null;
  country: string;
  timezone: string;
  address: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface RoleFamily {
  id: string;
  key: string;
  label: string;
  description: string | null;
  department_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

/**
 * An ISO 4217 currency that job salaries can be denominated in.
 *
 * `code` is the identifier stored on job openings; `symbol` is display-only and
 * falls back to the code where no distinct glyph exists (EGP, AED, SAR…).
 */
export interface Currency {
  id: string;
  code: string;
  symbol: string;
  label: string;
  is_active: boolean;
  sort_order: number;
}

/**
 * A post a company or the group hires for, and the copy a new opening inherits.
 *
 * Not a requisition: it carries no location, employment type or status, because
 * those belong to one intake. `department` is the department's own name, exactly
 * as the list spells it, matching what a job opening stores.
 */
export interface Position {
  id: string;
  tenant_id: string | null;
  title: string;
  department: string;
  grade: string | null;
  responsibilities: string | null;
  requirements: string[];
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
  is_active: boolean;
  sort_order: number;
}

/** The columns a job form needs to inherit from a position, and nothing else. */
export type PositionChoice = Pick<
  Position,
  | "id"
  | "tenant_id"
  | "title"
  | "department"
  | "grade"
  | "responsibilities"
  | "requirements"
  | "min_salary_usd"
  | "max_salary_usd"
  | "salary_currency"
>;

/** The controlled vocabularies that can be added, edited and retired. */
export type MasterEntity =
  | "companies"
  | "departments"
  | "locations"
  | "role_families"
  | "positions"
  | "skills"
  | "currencies";

/** Field values submitted by the master-data form. */
export type MasterPayload = Record<string, string | number | boolean | null>;

/** One of the above, keyed for rendering. */
export interface MasterData {
  companies: Company[];
  departments: Department[];
  locations: Location[];
  roleFamilies: RoleFamily[];
  positions: Position[];
  /**
   * False on a database where `db/migrations/026_positions.sql` has never run: the
   * table could not be read, which is not the same as an empty list. The console
   * says so instead of offering a form that would fail on save.
   */
  positionsAvailable: boolean;
  skills: Skill[];
  currencies: Currency[];
}

/** Controls rendered by the UI, grouped into the settings tabs. */
export type SettingControl =
  | { kind: "toggle"; key: string; label: string; help?: string }
  | { kind: "text"; key: string; label: string; help?: string; placeholder?: string }
  | { kind: "email"; key: string; label: string; help?: string }
  | { kind: "number"; key: string; label: string; help?: string; min?: number; max?: number; unit?: string }
  | { kind: "select"; key: string; label: string; help?: string; options: { value: string; label: string }[] }
  | { kind: "multiselect"; key: string; label: string; help?: string; options: { value: string; label: string }[] };

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  controls: SettingControl[];
}

export interface SettingsBundle {
  values: Record<string, unknown>;
  permissions: Permission[];
  roles: Role[];
  grants: RoleGrant[];
  companies: CompanyChoice[];
  staff: StaffMember[];
  templates: NotificationTemplate[];
}

export interface SaveSettingsResult {
  ok: boolean;
  saved: string[];
  error?: string;
}