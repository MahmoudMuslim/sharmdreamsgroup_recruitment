"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, STAFF_ROLES } from "@/lib/auth/session";
import { ALLOWED_SETTING_KEYS } from "@/modules/settings/domain/schema";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import type {
  AppRole,
  AuditEntry,
  Company,
  NotificationTemplate,
  Permission,
  Role,
  RoleGrant,
  SaveSettingsResult,
  SettingsBundle,
  StaffMember,
} from "@/modules/settings/domain/types";

/**
 * Loads everything the settings screen needs in one round trip.
 *
 * Reads go through the caller's session client so Row Level Security applies:
 * a recruiter without `settings.manage_users` sees staff rows filtered out by
 * the database rather than by client-side guesswork.
 */
export async function loadSettings(): Promise<SettingsBundle> {
  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const [settingsResult, rolesResult, permsResult, grantsResult, companiesResult, staffResult, templatesResult] =
    await Promise.all([
      supabase.from("app_settings").select("key, value, description, company_id, scope").eq("scope", "GLOBAL"),
      supabase.from("roles").select("key, label, description, is_system").order("label"),
      supabase.from("permissions").select("key, label, group_name, description").order("group_name"),
      supabase.from("role_permissions").select("role_key, permission_key, granted"),
      supabase.from("tenants_and_companies").select("id, name, slug, sector, country").order("name"),
      supabase.from("user_profiles").select("id, auth_user_id, full_name, email, role, tenant_id, created_at").in("role", STAFF_ROLES),
      supabase.from("notification_templates").select("id, key, channel, subject, body, is_active").order("key"),
    ]);

  const values: Record<string, unknown> = {};
  for (const row of settingsResult.data ?? []) {
    values[row.key] = row.value;
  }

  return {
    values,
    roles: (rolesResult.data ?? []) as Role[],
    permissions: (permsResult.data ?? []) as Permission[],
    grants: (grantsResult.data ?? []) as RoleGrant[],
    companies: (companiesResult.data ?? []) as Company[],
    staff: (staffResult.data ?? []) as StaffMember[],
    templates: (templatesResult.data ?? []) as NotificationTemplate[],
  };
}

/**
 * Persists a batch of settings.
 *
 * Only keys declared in `SETTINGS_SCHEMA` are accepted, so the client cannot
 * write arbitrary rows. Each change is written to `settings_audit_log` before
 * the upsert so the previous value is never lost.
 */
export async function saveSettings(
  payload: Record<string, unknown>
): Promise<SaveSettingsResult> {
  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const entries = Object.entries(payload).filter(([key]) => ALLOWED_SETTING_KEYS.has(key));

  if (entries.length === 0) {
    return { ok: false, saved: [], error: "No recognised settings were supplied." };
  }

  // Record the change with the current value before overwriting.
  const { data: existing } = await supabase
    .from("app_settings")
    .select("id, key, value")
    .eq("scope", "GLOBAL")
    .in(
      "key",
      entries.map(([key]) => key)
    );

  const previous = new Map((existing ?? []).map((row) => [row.key, row.value]));

  const { error: auditError } = await supabase.from("settings_audit_log").insert(
    entries.map(([key, value]) => ({
      key,
      previous_value: previous.get(key) ?? null,
      next_value: value,
      changed_by: null,
    }))
  );

  if (auditError) {
    return { ok: false, saved: [], error: auditError.message };
  }

  // Split by whether the row exists, because PostgREST fills a key that is
  // missing from only some rows of a bulk write with an explicit NULL. Mixed
  // shapes therefore sent `id = NULL` for the new settings and skipped the
  // column's `gen_random_uuid()` default — a not-null violation.
  const known = new Map((existing ?? []).map((row) => [row.key, row]));

  const updates = entries
    .filter(([key]) => known.has(key))
    .map(([key, value]) => ({
      id: known.get(key)!.id,
      scope: "GLOBAL",
      company_id: null,
      key,
      value,
      updated_by: null,
    }));

  const inserts = entries
    .filter(([key]) => !known.has(key))
    .map(([key, value]) => ({
      scope: "GLOBAL",
      company_id: null,
      key,
      value,
      updated_by: null,
    }));

  if (updates.length > 0) {
    const { error } = await supabase.from("app_settings").upsert(updates, { onConflict: "id" });
    if (error) return { ok: false, saved: [], error: error.message };
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("app_settings").insert(inserts);
    if (error) return { ok: false, saved: [], error: error.message };
  }

  revalidatePath("/settings");
  return { ok: true, saved: entries.map(([key]) => key), error: undefined };
}

/** Grants or revokes a single permission for a role. */
export async function updateRolePermission(
  roleKey: AppRole,
  permissionKey: string,
  granted: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("role_permissions")
    .upsert({ role_key: roleKey, permission_key: permissionKey, granted });

  if (error) return { ok: false, error: error.message };

  await supabase.from("settings_audit_log").insert({
    key: `role_permission:${roleKey}`,
    previous_value: null,
    next_value: { permissionKey, granted },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Saves one notification template row.
 *
 * The WhatsApp dispatch path reads these bodies verbatim, so a recruiter edit
 * here is the next message a candidate receives. RLS already limits writes to
 * `settings.manage_platform`; the check below turns that into a readable error
 * instead of a silent zero-row update.
 */
export async function saveNotificationTemplate(input: {
  id: string;
  subject: string | null;
  body: string;
  is_active: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Editing templates requires settings.manage_platform." };
  }

  const body = input.body.trim();
  if (!body) return { ok: false, error: "A template needs message copy." };
  if (body.length > 4000) return { ok: false, error: "Keep templates under 4000 characters." };

  const supabase = await createSupabaseServerClient();

  const { data: previous } = await supabase
    .from("notification_templates")
    .select("key, subject, body, is_active")
    .eq("id", input.id)
    .maybeSingle();

  if (!previous) return { ok: false, error: "That template no longer exists." };

  const subject = input.subject?.trim() || null;

  const { error } = await supabase
    .from("notification_templates")
    .update({ subject, body, is_active: input.is_active })
    .eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  await supabase.from("settings_audit_log").insert({
    key: `notification_template:${previous.key}`,
    previous_value: { subject: previous.subject, body: previous.body, is_active: previous.is_active },
    next_value: { subject, body, is_active: input.is_active },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Recent settings activity, newest first. */
export async function loadAuditLog(limit = 25): Promise<AuditEntry[]> {  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("settings_audit_log")
    .select("id, key, previous_value, next_value, changed_at, changed_by")
    .order("changed_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as AuditEntry[];
}