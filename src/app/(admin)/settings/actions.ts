"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, STAFF_ROLES } from "@/lib/auth/session";
import { ALLOWED_SETTING_KEYS } from "@/modules/settings/domain/schema";
import { shippedTemplate } from "@/modules/settings/domain/templates";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import { printableValue } from "@/modules/activity/domain/trail";
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
      supabase.from("user_profiles").select("id, auth_user_id, full_name, email, role, tenant_id, phone, created_at").in("role", STAFF_ROLES),
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
 * `app_settings.updated_by` and `settings_audit_log.changed_by` both reference
 * `user_profiles(id)`, not the auth id, so the session user has to be resolved
 * to their profile row before either column can name them.
 */
async function staffProfileId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  authUserId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The channel a template row belongs to, in the words a trail row uses. */
function channelWord(channel: string): string {
  if (channel === "WHATSAPP") return "WhatsApp";
  if (channel === "IN_APP") return "in-app";
  return "email";
}

/**
 * What a template's copy is worth in the trail: that it moved, and how far.
 *
 * The wording itself is what a recruiter edits, and the trail is read by more
 * people than Settings is, so a row records character counts rather than the
 * message a candidate will receive.
 */
function copyEdits(
  before: { subject: string | null; body: string; is_active: boolean },
  next: { subject: string | null; body: string; is_active: boolean }
): Record<string, string> {
  const edits: Record<string, string> = {};
  if ((before.subject ?? null) !== next.subject) {
    edits.subject = `${printableValue(before.subject)} → ${printableValue(next.subject)}`;
  }
  if (before.body !== next.body) {
    edits.copy_characters = `${before.body.length} → ${next.body.length}`;
  }
  if (before.is_active !== next.is_active) {
    edits.is_active = `${before.is_active ? "sending" : "paused"} → ${next.is_active ? "sending" : "paused"}`;
  }
  return edits;
}

/**
 * Persists a batch of settings.
 *
 * Only keys declared in `SETTINGS_SCHEMA` are accepted, so the client cannot
 * write arbitrary rows. Each change is written to `settings_audit_log` before
 * the upsert so the previous value is never lost.
 *
 * The permission check is not optional polish: `app_settings_write` in RLS only
 * lets `settings.manage_platform` through, and an UPDATE refused by RLS returns
 * no error at all. Without the check below a recruiter's save would have read as
 * a success while changing nothing.
 */
export async function saveSettings(
  payload: Record<string, unknown>
): Promise<SaveSettingsResult> {
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return {
      ok: false,
      saved: [],
      error: "Editing settings requires the Manage platform settings permission.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const entries = Object.entries(payload).filter(([key]) => ALLOWED_SETTING_KEYS.has(key));

  if (entries.length === 0) {
    return { ok: false, saved: [], error: "No recognised settings were supplied." };
  }

  const changedBy = await staffProfileId(supabase, user.authUserId);

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
      changed_by: changedBy,
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
      updated_by: changedBy,
    }));

  const inserts = entries
    .filter(([key]) => !known.has(key))
    .map(([key, value]) => ({
      scope: "GLOBAL",
      company_id: null,
      key,
      value,
      updated_by: changedBy,
    }));

  if (updates.length > 0) {
    const { error } = await supabase.from("app_settings").upsert(updates, { onConflict: "id" });
    if (error) return { ok: false, saved: [], error: error.message };
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("app_settings").insert(inserts);
    if (error) return { ok: false, saved: [], error: error.message };
  }

  // One row for the batch the console sent, listing only what moved: a save that
  // resubmitted six untouched numbers should not read as six changes.
  const edits: Record<string, string> = {};
  for (const [key, value] of entries) {
    const before = previous.get(key) ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    edits[key] = `${printableValue(before)} → ${printableValue(value)}`;
  }

  if (Object.keys(edits).length > 0) {
    await recordActivity({
      area: "settings",
      action: "settings_save",
      entity: "setting",
      entityId: entries[0][0],
      summary: `Saved ${Object.keys(edits).length} setting${
        Object.keys(edits).length === 1 ? "" : "s"
      } (${Object.keys(edits).slice(0, 4).join(", ")}${Object.keys(edits).length > 4 ? ", …" : ""})`,
      detail: edits,
      actorId: changedBy,
    });
  }

  revalidatePath("/settings");
  // The settings read is cached for everyone, so say out loud that it changed:
  // evicting the tag is what makes the number you just saved the one the next
  // render sees, instead of the one from up to a minute ago.
  updateTag("app-settings");
  return { ok: true, saved: entries.map(([key]) => key), error: undefined };
}

/** Grants or revokes a single permission for a role. */
export async function updateRolePermission(
  roleKey: AppRole,
  permissionKey: string,
  granted: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Editing roles and permissions requires the Manage platform settings permission." };
  }

  const supabase = await createSupabaseServerClient();
  const changedBy = await staffProfileId(supabase, user.authUserId);

  const { data: before } = await supabase
    .from("role_permissions")
    .select("granted")
    .eq("role_key", roleKey)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  const { error } = await supabase
    .from("role_permissions")
    .upsert({ role_key: roleKey, permission_key: permissionKey, granted });

  if (error) return { ok: false, error: error.message };

  await supabase.from("settings_audit_log").insert({
    key: `role_permission:${roleKey}`,
    previous_value: before ? { permissionKey, granted: before.granted } : null,
    next_value: { permissionKey, granted },
    changed_by: changedBy,
  });

  const from = before ? (before.granted ? "granted" : "revoked") : "unset";
  await recordActivity({
    area: "access",
    action: granted ? "permission_grant" : "permission_revoke",
    entity: "role",
    entityId: roleKey,
    summary: `${granted ? "Granted" : "Revoked"} ${permissionKey} for ${roleKey.replace(/_/g, " ").toLowerCase()}`,
    detail: { role: roleKey, permission: permissionKey, from, to: granted ? "granted" : "revoked" },
    actorId: changedBy,
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
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Editing templates requires settings.manage_platform." };
  }

  const body = input.body.trim();
  if (!body) return { ok: false, error: "A template needs message copy." };
  if (body.length > 4000) return { ok: false, error: "Keep templates under 4000 characters." };

  const supabase = await createSupabaseServerClient();

  const { data: previous } = await supabase
    .from("notification_templates")
    .select("key, channel, subject, body, is_active")
    .eq("id", input.id)
    .maybeSingle();

  if (!previous) return { ok: false, error: "That template no longer exists." };

  const subject = input.subject?.trim() || null;
  const next = { subject, body, is_active: input.is_active };
  const edits = copyEdits(previous, next);

  // The form posts the whole row, so a save that moved nothing is recorded as
  // nothing: an audit row and a trail row for an unchanged template would make
  // the log unreadable without describing a change.
  if (Object.keys(edits).length === 0) return { ok: true };

  const { error } = await supabase
    .from("notification_templates")
    .update(next)
    .eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  const changedBy = await staffProfileId(supabase, user.authUserId);

  await supabase.from("settings_audit_log").insert({
    key: `notification_template:${previous.key}`,
    previous_value: { subject: previous.subject, body: previous.body, is_active: previous.is_active },
    next_value: { subject, body, is_active: input.is_active },
    changed_by: changedBy,
  });

  const switched = edits.is_active ? ` and ${input.is_active ? "set it to send" : "paused it"}` : "";
  await recordActivity({
    area: "messaging",
    action: "template_save",
    entity: "template",
    entityId: previous.key,
    summary: `Edited the ${channelWord(previous.channel)} template “${previous.key}”${
      edits.copy_characters ? ` (${body.length} characters)` : ""
    }${switched}`,
    detail: { ...edits, channel: previous.channel },
    actorId: changedBy,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Puts one template back to the copy shipped in code.
 *
 * The row survives — only its text and its switch are rewritten — because the
 * alternative reading of "reset" would be to delete the row, and a deleted row
 * is not a row a recruiter can look at again. Re-activating is part of the
 * same promise: after a reset the message definitely goes out.
 */
export async function resetNotificationTemplate(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Editing templates requires settings.manage_platform." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("notification_templates")
    .select("key, channel, subject, body, is_active")
    .eq("id", input.id)
    .maybeSingle();

  if (!row) return { ok: false, error: "That template no longer exists." };

  const shipped = shippedTemplate(row.key, row.channel);
  if (!shipped) {
    return { ok: false, error: `No copy is shipped for ${row.key}, so there is nothing to restore.` };
  }

  // Only an EMAIL row has a subject to carry; the others read as blank lines.
  const next = {
    subject: row.channel === "EMAIL" ? shipped.subject || null : null,
    body: shipped.body,
    is_active: true,
  };

  const edits = copyEdits(row, next);
  if (Object.keys(edits).length === 0) return { ok: true };

  const { error } = await supabase
    .from("notification_templates")
    .update(next)
    .eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  const changedBy = await staffProfileId(supabase, user.authUserId);

  await supabase.from("settings_audit_log").insert({
    key: `notification_template:${row.key}`,
    previous_value: { subject: row.subject, body: row.body, is_active: row.is_active },
    next_value: { ...next, reset: true },
    changed_by: changedBy,
  });

  await recordActivity({
    area: "messaging",
    action: "template_reset",
    entity: "template",
    entityId: row.key,
    summary: `Restored the ${channelWord(row.channel)} template “${row.key}” to the copy shipped in code${
      row.is_active ? "" : ", and switched it back on"
    }`,
    detail: { ...edits, channel: row.channel, restored_from: "shipped copy" },
    actorId: changedBy,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Removes one template row.
 *
 * Safe to offer because no dispatch path requires a stored row: each one falls
 * through to the copy shipped in code, so deleting changes the wording a
 * candidate receives and never silences the message. The row is written to the
 * audit log first, which is the only place the deleted text still exists.
 */
export async function deleteNotificationTemplate(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "Deleting templates requires settings.manage_platform." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("notification_templates")
    .select("key, channel, subject, body, is_active")
    .eq("id", input.id)
    .maybeSingle();

  if (!row) return { ok: false, error: "That template no longer exists." };

  const { error } = await supabase.from("notification_templates").delete().eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  const changedBy = await staffProfileId(supabase, user.authUserId);

  await supabase.from("settings_audit_log").insert({
    key: `notification_template:${row.key}`,
    previous_value: { channel: row.channel, subject: row.subject, body: row.body, is_active: row.is_active },
    next_value: { deleted: true },
    changed_by: changedBy,
  });

  await recordActivity({
    area: "messaging",
    action: "template_delete",
    entity: "template",
    entityId: row.key,
    summary: `Deleted the ${channelWord(row.channel)} template “${row.key}”, so ${
      shippedTemplate(row.key, row.channel) ? "candidates get the copy shipped in code" : "that message has no copy left to read"
    }`,
    detail: {
      channel: row.channel,
      subject: printableValue(row.subject),
      copy_characters: row.body?.length ?? 0,
      was_sending: Boolean(row.is_active),
      note: "Its text is kept in the settings audit log.",
    },
    actorId: changedBy,
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