/**
 * Settings domain model.
 *
 * Settings are stored as key/value rows (`app_settings`) so new options can be
 * introduced without a migration, while the TypeScript schema below keeps the
 * surface type-safe and gives the UI a single place to declare its shape.
 */

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
  | "users.create";

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

export interface Company {
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

export interface NotificationTemplate {
  id: string;
  key: string;
  channel: "EMAIL" | "WHATSAPP" | "IN_APP";
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
 * ----------------------------------------------------------------------- */

export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  sector: string;
  country: string;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number;
}

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

/** The controlled vocabularies that can be added, edited and retired. */
export type MasterEntity =
  | "companies"
  | "departments"
  | "locations"
  | "role_families"
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
  skills: Skill[];
  currencies: Currency[];
}

export interface AuditEntry {
  id: string;
  key: string;
  previous_value: unknown;
  next_value: unknown;
  changed_at: string;
  changed_by: string | null;
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
  companies: Company[];
  staff: StaffMember[];
  templates: NotificationTemplate[];
}

export interface SaveSettingsResult {
  ok: boolean;
  saved: string[];
  error?: string;
}