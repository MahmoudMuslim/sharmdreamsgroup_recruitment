"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { canManageStaffUsers } from "@/modules/settings/infrastructure/permissions";
import { getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";
import {
  ASSIGNABLE_ROLE_KEYS,
  DEFAULT_PASSWORD_MIN_LENGTH,
} from "@/modules/settings/domain/schema";
import type { AssignableStaffRole, StaffInvite } from "@/modules/settings/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordActivity } from "@/modules/activity/application/record";

/** A role as the trail names it, so a demotion reads as a sentence. */
const ROLE_WORDS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  SUBSIDIARY_HR_MANAGER: "Subsidiary HR Manager",
  INTERVIEWER: "Interviewer",
};

function roleWord(role: string): string {
  return ROLE_WORDS[role] ?? role;
}

/**
 * The company an account belongs to, by name.
 *
 * A trail row that says `tenant_id: 9f2c…` cannot be read by the person checking
 * who moved a colleague between companies, so the two ids an edit swaps are
 * looked up in one pass and printed as the names the Team console shows.
 */
async function companyNames(
  supabase: SupabaseClient,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((each): each is string => Boolean(each)))];
  if (wanted.length === 0) return new Map();

  const { data } = await supabase
    .from("tenants_and_companies")
    .select("id, name")
    .in("id", wanted);

  return new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
}

/**
 * GoTrue parses `ban_duration` as a Go duration string, so it accepts units of
 * ns/us/ms/s/m/h and rejects words like "permanent". A hundred years is the
 * longest value that stays inside Go's int64 overflow limit and is what an
 * admin means by "disabled until someone re-enables it".
 */
const PERMANENT_BAN = "876000h";

/**
 * A CSPRNG password long enough to clear the configured minimum.
 *
 * base64url turns n bytes into ceil(n * 4 / 3) characters, so the byte count is
 * solved from the required length instead of assumed. The fixed tail guarantees
 * a symbol, a digit and mixed case, which the alphabet alone may miss.
 */
function generateStaffPassword(minLength: number): string {
  const tail = "Aa1!";
  const bytes = Math.max(16, Math.ceil(((minLength - tail.length) * 3) / 4));
  return `${randomBytes(bytes).toString("base64url")}${tail}`;
}

export interface StaffActionResult {
  ok: boolean;
  error?: string;
  user_id?: string;
  /** Returned once, never stored — a generated password to hand over personally. */
  temp_password?: string;
}

export interface CreateUserPayload {
  email: string;
  full_name: string;
  role: AssignableStaffRole;
  company_id?: string | null;
  /** Record a pending invite instead of creating the account now. */
  send_invite?: boolean;
  /** Temporary password if not sending an invite. */
  password?: string;
}

export interface CreateUserResult extends StaffActionResult {
  invite_id?: string;
}

interface Actor {
  profileId: string;
}

/**
 * Authorises a staff write and identifies who made it.
 *
 * Every action in this module writes with the service-role client, so RLS cannot
 * be the gate — this check is. `actor.profileId` both feeds the audit row and
 * lets the guards below refuse self-lockout.
 */
async function requireStaffManager(): Promise<Actor | null> {
  const session = await requireStaff("/settings");
  if (!(await canManageStaffUsers())) return null;

  const supabase = getSupabaseServiceClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  return profile ? { profileId: profile.id as string } : null;
}

/** Auth ids whose ban is still in force — the real source of "deactivated". */
async function bannedAuthIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return new Set();
  const now = Date.now();
  return new Set(
    data.users
      .filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now)
      .map((u) => u.id)
  );
}

/**
 * Super Admin accounts that can still sign in.
 *
 * Deactivating, demoting or deleting the last one would leave nobody who can
 * grant the permission back, so the guards refuse when the count is one.
 */
async function activeSuperAdminIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data: admins } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id")
    .eq("role", "SUPER_ADMIN");
  if (!admins?.length) return new Set();

  const banned = await bannedAuthIds(supabase);
  return new Set(
    admins
      .filter((a) => !banned.has(a.auth_user_id as string))
      .map((a) => a.id as string)
  );
}

async function auditStaffChange(
  supabase: SupabaseClient,
  entry: { key: string; previous: unknown; next: unknown; changedBy: string }
): Promise<void> {
  await supabase.from("settings_audit_log").insert({
    key: entry.key,
    previous_value: entry.previous ?? null,
    next_value: entry.next ?? null,
    changed_by: entry.changedBy,
  });
}

interface NewStaffAccount {
  email: string;
  fullName: string;
  role: AssignableStaffRole;
  companyId: string | null;
  password: string;
}

/**
 * Creates the auth user and the profile that carries their RBAC role.
 *
 * The profile insert is rolled back by deleting the auth user, because a half
 * account can sign in but has no role, and `getSessionUser()` then treats them as
 * having no session at all.
 */
async function createStaffAccount(
  supabase: SupabaseClient,
  account: NewStaffAccount
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
  });

  if (authError) return { ok: false, error: authError.message };
  const userId = authUser.user.id;

  const { error: profileError } = await supabase.from("user_profiles").insert({
    auth_user_id: userId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    tenant_id: account.companyId,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId);
    if (profileError.code === "23505") {
      return { ok: false, error: "That email is already in use." };
    }
    return { ok: false, error: profileError.message };
  }

  return { ok: true, userId };
}

/**
 * The only two ways a new staff account comes into existence.
 *
 * - `send_invite: true` records a `user_invites` row. No email leaves the
 *   platform: the invite is listed under Settings → Team until someone presses
 *   "Create account", which then generates the credentials.
 * - otherwise the account is created now with the supplied password, or a
 *   generated one, and the caller must hand the credentials over personally.
 */
export async function createUser(payload: CreateUserPayload): Promise<CreateUserResult> {
  if (!(await requireStaffManager())) {
    return { ok: false, error: "You need the Manage users permission." };
  }

  const supabase = getSupabaseServiceClient();

  const email = payload.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "A valid email is required." };
  }
  const fullName = payload.full_name.trim();
  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }
  if (!ASSIGNABLE_ROLE_KEYS.has(payload.role)) {
    return { ok: false, error: "That role cannot be assigned yet — see the note under Role." };
  }

  // `listUsers` is one page of GoTrue's pagination, so ask for a page big enough
  // to be the whole directory — otherwise a duplicate hides on page two.
  const { data: existingAuth } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingAuth?.users.some((u) => u.email?.toLowerCase() === email)) {
    return { ok: false, error: "A user with that email already exists." };
  }
  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    return { ok: false, error: "A profile with that email already exists." };
  }
  const { data: existingInvite } = await supabase
    .from("user_invites")
    .select("id, status")
    .eq("email", email)
    .maybeSingle();
  if (existingInvite) {
    return { ok: false, error: `An invite for that email already exists (${existingInvite.status.toLowerCase()}).` };
  }

  const companyId = payload.company_id && payload.company_id !== "" ? payload.company_id : null;

  if (payload.send_invite) {
    // The service-role client carries no session, so the current user must come
    // from the cookie-backed client — otherwise invited_by is always null and the
    // audit trail of who invited whom is lost.
    const sessionClient = await createSupabaseServerClient();
    const { data: sessionData } = await sessionClient.auth.getUser();

    // `user_invites.invited_by` references user_profiles(id), NOT auth.users(id),
    // so the auth id must be resolved to the profile row.
    let invitedBy: string | null = null;
    if (sessionData.user) {
      const { data: inviterProfile } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", sessionData.user.id)
        .maybeSingle();
      invitedBy = inviterProfile?.id ?? null;
    }

    const { data: invite, error: inviteError } = await supabase
      .from("user_invites")
      .insert({
        email,
        full_name: fullName,
        role: payload.role,
        company_id: companyId,
        invited_by: invitedBy,
      })
      .select("id")
      .single();

    if (inviteError) {
      if (inviteError.code === "23505") {
        return { ok: false, error: "An invite for that email already exists." };
      }
      return { ok: false, error: inviteError.message };
    }

    await recordActivity({
      area: "team",
      action: "staff_invite",
      entity: "user invite",
      entityId: invite.id,
      summary: `Recorded an invite for ${fullName} (${email}) to join as a ${roleWord(payload.role)}`,
      detail: {
        email,
        role: payload.role,
        company_id: companyId,
        status: "PENDING",
        note: "Nothing was emailed — the invite waits under Settings → Team.",
      },
    });

    revalidatePath("/settings");
    return { ok: true, invite_id: invite.id };
  }

  // Settings → Security → Minimum password length is enforced here, at the only
  // place a staff password is written, rather than in the form that posts it.
  const minLength = await getNumberSetting(
    "security.password_min_length",
    DEFAULT_PASSWORD_MIN_LENGTH
  );
  const supplied = payload.password?.trim() ?? "";
  if (supplied && supplied.length < minLength) {
    return {
      ok: false,
      error: `Password must be at least ${minLength} characters — set under Settings → Security.`,
    };
  }

  const tempPassword = supplied || generateStaffPassword(minLength);
  const created = await createStaffAccount(supabase, {
    email,
    fullName,
    role: payload.role,
    companyId,
    password: tempPassword,
  });
  if (!created.ok) return { ok: false, error: created.error };

  await recordActivity({
    area: "team",
    action: "staff_create",
    entity: "staff user",
    entityId: created.userId,
    summary: `Created the ${roleWord(payload.role)} account ${fullName} (${email})${
      supplied ? "" : ", with a generated password"
    }`,
    detail: {
      email,
      role: payload.role,
      company_id: companyId,
      issued_with: supplied ? "a password the inviter typed" : "a generated password shown once",
      note: "The password itself is never written down.",
    },
  });

  revalidatePath("/settings");
  return {
    ok: true,
    user_id: created.userId,
    // Only when we invented it — a password the inviter typed is theirs already.
    temp_password: supplied ? undefined : tempPassword,
  };
}

/** Profile fields and the live sign-in state for every staff account. */
export interface StaffConsoleState {
  invites: StaffInvite[];
  /** profile id → `banned_until`, or absent when the account was never banned. */
  access: Record<string, string | null>;
}

const STAFF_ROLE_KEYS = ["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"];

/**
 * Everything the team console needs beyond `user_profiles`: pending invites and
 * whether each account is currently blocked from signing in.
 *
 * Sign-in state is read from Auth rather than from a column because
 * `user_profiles` has no active flag: the ban *is* the enforcement, so the badge
 * can never disagree with it. Profile ids come from the database, never from the
 * caller, and a viewer without the staff-management permission gets an empty
 * console rather than an error.
 */
export async function loadStaffConsole(): Promise<StaffConsoleState> {
  await requireStaff("/settings");
  if (!(await canManageStaffUsers())) return { invites: [], access: {} };

  const supabase = getSupabaseServiceClient();

  const [{ data: invites }, { data: profiles }] = await Promise.all([
    supabase
      .from("user_invites")
      .select("id, email, full_name, role, company_id, status, expires_at, created_at")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false }),
    supabase
      .from("user_profiles")
      .select("id, auth_user_id")
      .in("role", STAFF_ROLE_KEYS),
  ]);

  const access: Record<string, string | null> = {};
  if (profiles?.length) {
    const byAuthId = new Map(profiles.map((p) => [p.auth_user_id as string, p.id as string]));
    const { data: directory } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const now = Date.now();
    for (const user of directory?.users ?? []) {
      const profileId = byAuthId.get(user.id);
      if (!profileId) continue;
      // A temporary ban that has already run out means the account can sign in
      // again, so it must not still be badged as Disabled.
      const outstanding = user.banned_until && new Date(user.banned_until).getTime() > now;
      access[profileId] = outstanding ? (user.banned_until as string) : null;
    }
  }

  return { invites: (invites ?? []) as StaffInvite[], access };
}

async function loadTargetProfile(supabase: SupabaseClient, profileId: string) {
  const { data } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, tenant_id")
    .eq("id", profileId)
    .maybeSingle();
  return data as
    | {
        id: string;
        auth_user_id: string;
        full_name: string;
        email: string;
        role: string;
        tenant_id: string | null;
      }
    | null;
}

/**
 * Blocks or un-blocks sign-in without deleting anything.
 *
 * A ban stops new sign-ins; Supabase does not revoke sessions that already
 * exist, so a laptop left open keeps its session until it expires — the UI says
 * this rather than promising an instant kick. Answers, applications and interview
 * attribution all stay intact, which is why this is the offered path over delete.
 */
export async function setStaffActive(
  profileId: string,
  active: boolean
): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const target = await loadTargetProfile(supabase, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (!active) {
    if (actor.profileId === profileId) {
      return { ok: false, error: "You cannot disable your own account." };
    }
    if (target.role === "SUPER_ADMIN") {
      const admins = await activeSuperAdminIds(supabase);
      if (admins.size <= 1) {
        return {
          ok: false,
          error: "This is the only active Super Admin. Make another account a Super Admin first.",
        };
      }
    }
  }

  const { error } = await supabase.auth.admin.updateUserById(target.auth_user_id, {
    ban_duration: active ? "none" : PERMANENT_BAN,
  });
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(supabase, {
    key: `staff.access:${profileId}`,
    previous: { active: !active },
    next: { active, email: target.email },
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: active ? "staff_reactivate" : "staff_deactivate",
    entity: "staff user",
    entityId: profileId,
    summary: active
      ? `Re-enabled ${target.full_name}’s sign-in`
      : `Disabled ${target.full_name}’s account so they cannot sign in`,
    detail: {
      email: target.email,
      role: roleWord(target.role),
      ...(active
        ? {}
        : { note: "A session already open keeps working until it expires, and nothing they wrote was touched." }),
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Mints a new password and returns it once.
 *
 * There is no self-service reset page in this app — no `/forgot-password` and no
 * invite-acceptance route — so a Supabase recovery link would be a dead URL. The
 * generated password is therefore shown in the panel that asked for it, and the
 * caller shares it the same way they share any other credential. It is never
 * written to the audit log.
 */
export async function resetStaffPassword(profileId: string): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const target = await loadTargetProfile(supabase, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  const minLength = await getNumberSetting(
    "security.password_min_length",
    DEFAULT_PASSWORD_MIN_LENGTH
  );
  const tempPassword = generateStaffPassword(minLength);

  const { error } = await supabase.auth.admin.updateUserById(target.auth_user_id, {
    password: tempPassword,
  });
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(supabase, {
    key: `staff.password:${profileId}`,
    previous: null,
    next: { reset_by: actor.profileId, min_length: minLength },
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "staff_password_reset",
    entity: "staff user",
    entityId: profileId,
    summary: `Issued ${target.full_name} a new ${tempPassword.length}-character password, shown once on screen`,
    detail: { email: target.email, role: roleWord(target.role), min_length: minLength },
  });

  return { ok: true, temp_password: tempPassword };
}

/** Moves a member between the roles an account can actually hold. */
export async function updateStaffRole(
  profileId: string,
  role: AssignableStaffRole
): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  if (!ASSIGNABLE_ROLE_KEYS.has(role)) {
    return { ok: false, error: "That role cannot be assigned yet." };
  }

  const supabase = getSupabaseServiceClient();
  const target = await loadTargetProfile(supabase, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (target.role === role) return { ok: true };

  // Changing your own role is how an admin locks themselves out of the screen
  // that changes roles, so the last Super Admin is protected either way.
  if (target.role === "SUPER_ADMIN") {
    const admins = await activeSuperAdminIds(supabase);
    if (admins.size <= 1) {
      return { ok: false, error: "This is the only active Super Admin account." };
    }
  }

  const { data: updated, error } = await supabase
    .from("user_profiles")
    .update({ role })
    .eq("id", profileId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // The write runs as the service role, so RLS cannot report a zero-row update;
  // without this check a vanished row would still read as "saved".
  if (!updated?.length) return { ok: false, error: "That team member no longer exists." };

  await auditStaffChange(supabase, {
    key: `staff.role:${profileId}`,
    previous: { role: target.role },
    next: { role },
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "access",
    action: "staff_role_change",
    entity: "staff user",
    entityId: profileId,
    summary: `Changed ${target.full_name}’s role from ${roleWord(target.role)} to ${roleWord(role)}`,
    detail: { email: target.email, role: `${roleWord(target.role)} → ${roleWord(role)}` },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Assigns, or clears, the company a member belongs to. */
export async function updateStaffCompany(
  profileId: string,
  companyId: string | null
): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const target = await loadTargetProfile(supabase, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };
  if (target.tenant_id === companyId) return { ok: true };

  const { data: updated, error } = await supabase
    .from("user_profiles")
    .update({ tenant_id: companyId })
    .eq("id", profileId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: "That team member no longer exists." };

  await auditStaffChange(supabase, {
    key: `staff.company:${profileId}`,
    previous: { tenant_id: target.tenant_id },
    next: { tenant_id: companyId },
    changedBy: actor.profileId,
  });

  const names = await companyNames(supabase, [target.tenant_id, companyId]);
  const word = (id: string | null) =>
    id ? names.get(id) ?? "a company that is no longer listed" : "no company";

  await recordActivity({
    area: "team",
    action: "staff_company_change",
    entity: "staff user",
    entityId: profileId,
    summary: `Moved ${target.full_name} to ${word(companyId)}${
      target.tenant_id ? ` from ${word(target.tenant_id)}` : ""
    }`,
    detail: {
      email: target.email,
      role: roleWord(target.role),
      company: `${word(target.tenant_id)} → ${word(companyId)}`,
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Permanently removes an account.
 *
 * Deactivation is the offered path, so deletion is refused while the person can
 * still sign in — an irreversible step needs a deliberate pause. Deleting the
 * auth user cascades the profile row; every other reference to it
 * (`interview_schedules.interviewer_profile_id`, audit rows, invites) is
 * `on delete set null`, so their history survives with the name blanked.
 */
export async function deleteStaffAccount(profileId: string): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const target = await loadTargetProfile(supabase, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (actor.profileId === profileId) {
    return { ok: false, error: "You cannot delete your own account." };
  }
  if (target.role === "SUPER_ADMIN") {
    const admins = await activeSuperAdminIds(supabase);
    if (admins.has(profileId) && admins.size <= 1) {
      return { ok: false, error: "This is the only active Super Admin account." };
    }
  }

  const banned = await bannedAuthIds(supabase);
  if (!banned.has(target.auth_user_id)) {
    return {
      ok: false,
      error: "Deactivate this account first — deleting it is permanent.",
    };
  }

  const { error } = await supabase.auth.admin.deleteUser(target.auth_user_id);
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(supabase, {
    key: `staff.deleted:${profileId}`,
    previous: { email: target.email, role: target.role, tenant_id: target.tenant_id },
    next: null,
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "staff_delete",
    entity: "staff user",
    entityId: profileId,
    summary: `Deleted ${target.full_name} (${target.email}) from the team — sign-in and their profile row are gone`,
    detail: {
      role: roleWord(target.role),
      company_id: target.tenant_id,
      note: "Interviews and audit rows that named them keep their ids with the name blanked.",
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Turns a recorded invite into a real account.
 *
 * Nothing else can accept an invite — there is no token column on `user_invites`
 * and no public acceptance page — so this is the button that closes the loop:
 * the person named on the invite gets an account and a generated password to be
 * handed over, and the invite row is kept as ACCEPTED for the audit trail.
 */
export async function provisionInvite(inviteId: string): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const { data: invite } = await supabase
    .from("user_invites")
    .select("id, email, full_name, role, company_id, status")
    .eq("id", inviteId)
    .maybeSingle();

  if (!invite) return { ok: false, error: "That invite no longer exists." };
  if (invite.status !== "PENDING") {
    return { ok: false, error: `That invite is already ${invite.status.toLowerCase()}.` };
  }
  if (!ASSIGNABLE_ROLE_KEYS.has(invite.role)) {
    return {
      ok: false,
      error: "This invite asks for a role that cannot be assigned yet — change it by cancelling and re-inviting.",
    };
  }

  const email = (invite.email as string).toLowerCase();
  const { data: existingAuth } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingAuth?.users.some((u) => u.email?.toLowerCase() === email)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const minLength = await getNumberSetting(
    "security.password_min_length",
    DEFAULT_PASSWORD_MIN_LENGTH
  );
  const tempPassword = generateStaffPassword(minLength);
  const created = await createStaffAccount(supabase, {
    email,
    fullName: invite.full_name as string,
    role: invite.role as AssignableStaffRole,
    companyId: invite.company_id as string | null,
    password: tempPassword,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const { error: inviteError } = await supabase
    .from("user_invites")
    .update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
    .eq("id", inviteId);

  await auditStaffChange(supabase, {
    key: `staff.invite:${inviteId}`,
    previous: { status: "PENDING" },
    next: { status: inviteError ? "PENDING" : "ACCEPTED", email, user_id: created.userId },
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "invite_provision",
    entity: "staff user",
    entityId: created.userId,
    summary: `Turned the invite for ${invite.full_name as string} (${email}) into a ${roleWord(
      invite.role as string
    )} account`,
    detail: {
      email,
      role: roleWord(invite.role as string),
      company_id: invite.company_id,
      invite_status: inviteError ? "left PENDING" : "ACCEPTED",
    },
  });

  revalidatePath("/settings");

  if (inviteError) {
    // The account exists and works, so this must not read as a failure — but the
    // password is the only way into it, so it still has to be shown.
    return {
      ok: true,
      user_id: created.userId,
      temp_password: tempPassword,
      error: `The account was created, but the invite stayed pending: ${inviteError.message}`,
    };
  }

  return { ok: true, user_id: created.userId, temp_password: tempPassword };
}

/**
 * Discards a pending invite.
 *
 * The row is deleted rather than flipped to REVOKED because `user_invites` has a
 * unique constraint on email: a revoked row would block re-inviting the same
 * person, leaving no way to recover from a typo.
 */
export async function cancelInvite(inviteId: string): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const supabase = getSupabaseServiceClient();
  const { data: removed, error } = await supabase
    .from("user_invites")
    .delete()
    .eq("id", inviteId)
    .eq("status", "PENDING")
    .select("id, email, full_name, role, company_id");

  if (error) return { ok: false, error: error.message };
  if (!removed?.length) return { ok: false, error: "That invite is no longer pending." };

  await auditStaffChange(supabase, {
    key: `staff.invite:${inviteId}`,
    previous: { status: "PENDING" },
    next: null,
    changedBy: actor.profileId,
  });

  // Read out of the deleted row, because this is the last moment it exists.
  const gone = removed[0] as Record<string, unknown>;
  await recordActivity({
    area: "team",
    action: "invite_cancel",
    entity: "user invite",
    entityId: inviteId,
    summary: `Cancelled the invite for ${String(gone.email ?? "an address that is no longer recorded")}`,
    detail: {
      email: gone.email,
      full_name: gone.full_name,
      role: roleWord(String(gone.role ?? "")),
      company_id: gone.company_id,
      note: "The row was deleted, not marked revoked, so the same email can be invited again.",
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}
