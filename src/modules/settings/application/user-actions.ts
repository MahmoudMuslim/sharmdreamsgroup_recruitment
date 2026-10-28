"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getServiceRestClient } from "@/lib/data-api/service";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import {
  canCreateStaffUsers,
  canManageStaffUsers,
  hasPermissionForUser,
} from "@/modules/settings/infrastructure/permissions";
import { getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";
import {
  ASSIGNABLE_ROLE_KEYS,
  DEFAULT_PASSWORD_MIN_LENGTH,
} from "@/modules/settings/domain/schema";
import {
  PERMISSION_OVERRIDES_TABLE,
  isMissingTable,
  overrideTrail,
  overrideWriteProblem,
  type OverrideSource,
} from "@/modules/settings/domain/accountGrants";
import type {
  AssignableStaffRole,
  PermissionKey,
  StaffInvite,
} from "@/modules/settings/domain/types";
/**
 * The service client, typed from the seam itself rather than from the vendor.
 *
 * Both halves of this handle are local now: the thirteen `auth.admin.*` calls
 * run on `authAdmin` (`src/lib/auth/admin-users.ts`), four parameterised `pg`
 * statements, because no HTTP route may reach `auth.users`; the row calls beside
 * them are our own `RestClient` over `src/lib/rest`. Nothing on this object
 * is passed through to GoTrue any more.
 */
type ServiceClient = ReturnType<typeof getServiceRestClient>;
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, scalarEdits } from "@/modules/activity/domain/trail";

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
  restClient: ServiceClient,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((each): each is string => Boolean(each)))];
  if (wanted.length === 0) return new Map();

  const { data } = await restClient
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

  const restClient = getServiceRestClient();
  const { data: profile } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  return profile ? { profileId: profile.id as string } : null;
}

/**
 * Identifies the signed-in staff member for a per-account permission write.
 *
 * The permission itself is not checked here: `overrideWriteProblem` below is what
 * refuses, so the console shows the domain's sentence rather than a second copy of
 * the same rule. What this does have to prove is that the caller is a staff account
 * with a profile, because `isSelf` — one of 048's three fences — is a comparison
 * against that id, and it cannot be answered from a request body.
 */
async function requireStaffActor(): Promise<Actor | null> {
  const session = await requireStaff("/settings");

  const restClient = getServiceRestClient();
  const { data: profile } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  return profile ? { profileId: profile.id as string } : null;
}

/**
 * Auth ids whose ban is still in force — the real source of "deactivated".
 *
 * The failure is returned rather than swallowed because both of this module's
 * safety guards are decided from this set. An empty set reads as "nobody is
 * blocked", which counts every banned Super Admin as active, lets the last-admin
 * protection pass, and would delete an account that was never deactivated.
 */
async function bannedAuthIds(
  restClient: ServiceClient
): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await restClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return { ids: new Set(), error: error.message };
  const now = Date.now();
  return {
    ids: new Set(
      data.users
        .filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now)
        .map((u) => u.id)
    ),
    error: null,
  };
}

/**
 * Super Admin accounts that can still sign in.
 *
 * Deactivating, demoting or deleting the last one would leave nobody who can
 * grant the permission back, so the guards refuse when the count is one — and
 * refuse when the directory could not be read, because then the count is unknown.
 */
async function activeSuperAdminIds(
  restClient: ServiceClient
): Promise<{ ids: Set<string>; error: string | null }> {
  const { data: admins, error } = await restClient
    .from("user_profiles")
    .select("id, auth_user_id")
    .eq("role", "SUPER_ADMIN");
  if (error) return { ids: new Set(), error: error.message };

  const banned = await bannedAuthIds(restClient);
  if (banned.error) return banned;

  return {
    ids: new Set(
      (admins ?? [])
        .filter((a) => !banned.ids.has(a.auth_user_id as string))
        .map((a) => a.id as string)
    ),
    error: null,
  };
}

/** Returned when a guard could not be answered at all, rather than answered wrongly. */
const ACCESS_UNKNOWN =
  "Who can still sign in could not be read, so this change is refused — try again.";

async function auditStaffChange(
  restClient: ServiceClient,
  entry: { key: string; previous: unknown; next: unknown; changedBy: string }
): Promise<void> {
  await restClient.from("settings_audit_log").insert({
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
  restClient: ServiceClient,
  account: NewStaffAccount
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { data: authUser, error: authError } = await restClient.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
  });

  if (authError) return { ok: false, error: authError.message };
  const userId = authUser.user.id;

  const { error: profileError } = await restClient.from("user_profiles").insert({
    auth_user_id: userId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    tenant_id: account.companyId,
  });

  if (profileError) {
    await restClient.auth.admin.deleteUser(userId);
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
  // The door the "Add member" button opens: `users.create` is its own box in the
  // matrix, so a role that holds the manage grant but not this one is refused here,
  // exactly where the page already hid the button.
  if (!(await canCreateStaffUsers())) {
    return {
      ok: false,
      error: "Opening a new account needs both the Manage users and Create users permissions.",
    };
  }

  const restClient = getServiceRestClient();

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
  const { data: existingAuth } = await restClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingAuth?.users.some((u) => u.email?.toLowerCase() === email)) {
    return { ok: false, error: "A user with that email already exists." };
  }
  const { data: existingProfile } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    return { ok: false, error: "A profile with that email already exists." };
  }
  // Only a *pending* invite blocks a new one — the database's unique index is
  // partial for exactly this reason, so an address whose earlier invite was
  // accepted or expired must stay invitable.
  const { data: existingInvite } = await restClient
    .from("user_invites")
    .select("id, status")
    .eq("email", email)
    .eq("status", "PENDING")
    .maybeSingle();
  if (existingInvite) {
    return { ok: false, error: `An invite for that email already exists (${existingInvite.status.toLowerCase()}).` };
  }

  const companyId = payload.company_id && payload.company_id !== "" ? payload.company_id : null;

  if (payload.send_invite) {
    // The service-role client carries no session, so the current user must come
    // from the cookie-backed client — otherwise invited_by is always null and the
    // audit trail of who invited whom is lost.
    const sessionClient = await createServerRestClient();
    const { data: sessionData } = await sessionClient.auth.getUser();

    // `user_invites.invited_by` references user_profiles(id), NOT auth.users(id),
    // so the auth id must be resolved to the profile row.
    let invitedBy: string | null = null;
    if (sessionData.user) {
      const { data: inviterProfile } = await restClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", sessionData.user.id)
        .maybeSingle();
      invitedBy = inviterProfile?.id ?? null;
    }

    const { data: invite, error: inviteError } = await restClient
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
  const created = await createStaffAccount(restClient, {
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
  /**
   * Why the sign-in directory could not be read, or null.
   *
   * Without this a failed Auth read leaves `access` empty, and every disabled
   * account renders the "Active" badge — the console would be saying something
   * the database never told it.
   */
  accessError: string | null;
  /** Why pending invites could not be read, or null. */
  invitesError: string | null;
  /**
   * profile id → that account's own lines, exactly as the table holds them.
   *
   * Every member's lines come back in one read because the console lists them all;
   * a panel for one row is a slice of this map, never a query of its own. Absent
   * for a member who has never been given a line, which is most of them — and
   * that is the role standing as seeded, not a refusal.
   */
  overrides: Record<string, StaffPermissionLine[]>;
  /** Whether the per-account layer could be consulted at all. */
  overridesSource: OverrideSource;
}

/** One line of `user_permission_overrides`, as the console reads it. */
export interface StaffPermissionLine {
  permission_key: PermissionKey;
  granted: boolean;
  note: string | null;
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
  if (!(await canManageStaffUsers())) {
    // Nothing was consulted, so nothing is claimed. `unreadable` is the honest
    // answer: the panel shows the role's decision and refuses to show a line as
    // absent, which is the same fail-closed reading the resolver gives.
    return {
      invites: [],
      access: {},
      accessError: null,
      invitesError: null,
      overrides: {},
      overridesSource: "unreadable",
    };
  }

  const restClient = getServiceRestClient();

  const [inviteRead, profileRead, overrideRead] = await Promise.all([
    restClient
      .from("user_invites")
      .select("id, email, full_name, role, company_id, status, expires_at, created_at")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false }),
    restClient
      .from("user_profiles")
      .select("id, auth_user_id")
      .in("role", STAFF_ROLE_KEYS),
    restClient
      .from(PERMISSION_OVERRIDES_TABLE)
      .select("profile_id, permission_key, granted, note, updated_at"),
  ]);

  // Two failures, two answers — the same reading the resolver makes, through the
  // same helper. A missing table leaves every account its role and tells the
  // console which file would change that; an outage says only that nothing is known.
  const overridesSource: OverrideSource = !overrideRead.error
    ? "applied"
    : isMissingTable(String(overrideRead.error.message))
      ? "absent"
      : "unreadable";

  const overrides: Record<string, StaffPermissionLine[]> = {};
  for (const row of overrideRead.data ?? []) {
    const profileId = row.profile_id as string;
    const lines = overrides[profileId] ?? [];
    lines.push({
      permission_key: row.permission_key as PermissionKey,
      granted: Boolean(row.granted),
      note: (row.note as string | null) ?? null,
    });
    overrides[profileId] = lines;
  }

  const access: Record<string, string | null> = {};
  let accessError: string | null = profileRead.error?.message ?? null;

  if (profileRead.data?.length) {
    const byAuthId = new Map(
      profileRead.data.map((p) => [p.auth_user_id as string, p.id as string])
    );
    const { data: directory, error } = await restClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) {
      accessError = error.message;
    } else {
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
  }

  return {
    invites: (inviteRead.data ?? []) as StaffInvite[],
    access,
    accessError,
    invitesError: inviteRead.error?.message ?? null,
    overrides,
    overridesSource,
  };
}

async function loadTargetProfile(restClient: ServiceClient, profileId: string) {
  const { data } = await restClient
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, tenant_id, phone")
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
        phone: string | null;
      }
    | null;
}

/**
 * Blocks or un-blocks sign-in without deleting anything.
 *
 * A ban stops new sign-ins; nothing here revokes sessions that already
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

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (!active) {
    if (actor.profileId === profileId) {
      return { ok: false, error: "You cannot disable your own account." };
    }
    if (target.role === "SUPER_ADMIN") {
      const admins = await activeSuperAdminIds(restClient);
      if (admins.error) return { ok: false, error: ACCESS_UNKNOWN };
      if (admins.ids.size <= 1) {
        return {
          ok: false,
          error: "This is the only active Super Admin. Make another account a Super Admin first.",
        };
      }
    }
  }

  const { error } = await restClient.auth.admin.updateUserById(target.auth_user_id, {
    ban_duration: active ? "none" : PERMANENT_BAN,
  });
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(restClient, {
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
 * invite-acceptance route — so an emailed recovery link would be a dead URL. The
 * generated password is therefore shown in the panel that asked for it, and the
 * caller shares it the same way they share any other credential. It is never
 * written to the audit log.
 */
export async function resetStaffPassword(profileId: string): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  const minLength = await getNumberSetting(
    "security.password_min_length",
    DEFAULT_PASSWORD_MIN_LENGTH
  );
  const tempPassword = generateStaffPassword(minLength);

  const { error } = await restClient.auth.admin.updateUserById(target.auth_user_id, {
    password: tempPassword,
  });
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(restClient, {
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

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (target.role === role) return { ok: true };

  // Changing your own role is how an admin locks themselves out of the screen
  // that changes roles, so the last Super Admin is protected either way.
  if (target.role === "SUPER_ADMIN") {
    const admins = await activeSuperAdminIds(restClient);
    if (admins.error) return { ok: false, error: ACCESS_UNKNOWN };
    if (admins.ids.size <= 1) {
      return { ok: false, error: "This is the only active Super Admin account." };
    }
  }

  const { data: updated, error } = await restClient
    .from("user_profiles")
    .update({ role })
    .eq("id", profileId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // The write runs as the service role, so RLS cannot report a zero-row update;
  // without this check a vanished row would still read as "saved".
  if (!updated?.length) return { ok: false, error: "That team member no longer exists." };

  await auditStaffChange(restClient, {
    key: `staff.role:${profileId}`,
    previous: { role: target.role },
    next: { role },
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "staff_role_change",
    entity: "staff user",
    entityId: profileId,
    summary: `Changed ${target.full_name}’s role from ${roleWord(target.role)} to ${roleWord(role)}`,
    detail: { email: target.email, role: `${roleWord(target.role)} → ${roleWord(role)}` },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Puts, changes or clears one line on one account's permissions.
 *
 * Three fences stand in front of this write and all three are re-read here before
 * the ask goes out, because 048's own policies enforce exactly them: the caller
 * holds `settings.manage_roles`, the line is not on the caller's own account, and
 * the account is not a Super Admin's. Re-reading is not courtesy toward the
 * database — a click that the policy refuses comes back as a PostgREST code, and
 * the member sitting at the console has no way to work out from `42501` that the
 * person they were editing is the one role that takes no lines. The domain decides
 * the sentence, so the console and the door cannot drift apart on what a refusal
 * is called.
 *
 * `granted: null` is the third answer and the one an editor forgets: it deletes
 * the line, which hands the permission back to the role rather than revoking it.
 * The trail records it that way for the same reason — an auditor who reads
 * "Revoked Export data" would go looking for a decision nobody made.
 */
export async function setStaffPermission(
  profileId: string,
  permissionKey: PermissionKey,
  granted: boolean | null,
  note?: string | null
): Promise<StaffActionResult> {
  const actor = await requireStaffActor();
  if (!actor) return { ok: false, error: "Sign in as a staff member to edit permissions." };

  // The gate is the key 048's policies check, and the refusal is the domain's
  // sentence — `updateRolePermission` answers to the same key for the same reason.
  const canManageRoles = await hasPermissionForUser("settings.manage_roles");

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  // The label comes from the catalogue rather than from the caller, so the trail
  // quotes the words the permission matrix shows; the same read answers whether
  // the key is one the portal offers at all.
  const { data: permission } = await restClient
    .from("permissions")
    .select("key, label, group_name")
    .eq("key", permissionKey)
    .maybeSingle();

  // The layer's condition and the line's own answer, from one read of this
  // account's lines. Only a missing table is refused from the condition: an
  // unreadable one may still take the write, and a write that fails has its own
  // reason to report.
  const linesRead = await restClient
    .from(PERMISSION_OVERRIDES_TABLE)
    .select("permission_key, granted")
    .eq("profile_id", profileId);
  const source: OverrideSource = !linesRead.error
    ? "applied"
    : isMissingTable(String(linesRead.error.message))
      ? "absent"
      : "unreadable";
  const held = (linesRead.data ?? []).find((row) => row.permission_key === permissionKey);
  const from = held ? Boolean(held.granted) : null;

  const problem = overrideWriteProblem({
    canManageRoles,
    isSelf: profileId === actor.profileId,
    targetIsSuperAdmin: target.role === "SUPER_ADMIN",
    source,
    keyIsKnown: Boolean(permission),
    note: note ?? null,
  });
  if (problem) return { ok: false, error: problem };

  // Setting a line to what it already says writes nothing and records nothing: a
  // trail row for a no-op would have an auditor read a decision that changed no
  // answer.
  if (from === granted) return { ok: true };

  const { error } =
    granted === null
      ? await restClient
          .from(PERMISSION_OVERRIDES_TABLE)
          .delete()
          .eq("profile_id", profileId)
          .eq("permission_key", permissionKey)
      : await restClient
          .from(PERMISSION_OVERRIDES_TABLE)
          .upsert(
            {
              profile_id: profileId,
              permission_key: permissionKey,
              granted,
              note: note ?? null,
              updated_by: actor.profileId,
            },
            { onConflict: "profile_id, permission_key" }
          );
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(restClient, {
    key: `staff.permissions:${profileId}:${permissionKey}`,
    previous: { granted: from },
    next: { granted },
    changedBy: actor.profileId,
  });

  const trail = overrideTrail({
    memberName: target.full_name,
    roleKey: target.role,
    roleLabel: roleWord(target.role),
    permissionKey,
    permissionLabel: (permission?.label as string | undefined) ?? permissionKey,
    from,
    to: granted,
  });
  await recordActivity({
    area: "access",
    action: trail.action,
    entity: "staff user",
    entityId: profileId,
    summary: trail.summary,
    detail: trail.detail,
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

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };
  if (target.tenant_id === companyId) return { ok: true };

  const { data: updated, error } = await restClient
    .from("user_profiles")
    .update({ tenant_id: companyId })
    .eq("id", profileId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: "That team member no longer exists." };

  await auditStaffChange(restClient, {
    key: `staff.company:${profileId}`,
    previous: { tenant_id: target.tenant_id },
    next: { tenant_id: companyId },
    changedBy: actor.profileId,
  });

  const names = await companyNames(restClient, [target.tenant_id, companyId]);
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

/** The contact half of a team record — everything except role and company. */
export interface UpdateStaffDetailsInput {
  full_name: string;
  email: string;
  phone?: string | null;
}

/**
 * Edits the person behind an account: name, sign-in address and phone.
 *
 * `user_profiles.locale` is deliberately not offered here — nothing reads it. The
 * candidate portal's language comes from the two organisation settings, and the
 * staff portal only ever renders in English, so an editor for that column would
 * be a control that changes a value nobody consumes.
 *
 * Two stores have to move together. `user_profiles` is what the portal prints and
 * what `getSessionUser()` reads first, while GoTrue's `auth.users` is what
 * actually signs them in. Change one and the other keeps the old address, so a
 * colleague can be told to sign in with an email that no longer works — therefore
 * Auth is written first and put back if the profile write fails, which is the
 * only order that can leave a working account rather than a dead credential.
 *
 * `email_confirm: true` is not a shortcut: this portal has no address-verification
 * route, so a confirmation ticket sent to the new address would be the only way
 * to finish the change and there is nothing here to receive it.
 */
export async function updateStaffDetails(
  profileId: string,
  input: UpdateStaffDetailsInput
): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const fullName = input.full_name.trim();
  if (!fullName) return { ok: false, error: "Full name is required." };

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || email.startsWith("@") || email.includes("@@")) {
    return { ok: false, error: "A valid email is required." };
  }

  const phone = input.phone?.trim() ?? "";
  if (phone.length > 32) {
    return { ok: false, error: "Phone numbers are kept to 32 characters." };
  }

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  const emailChanged = target.email.toLowerCase() !== email;
  if (emailChanged) {
    const { data: directory, error: directoryError } = await restClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (directoryError) {
      return { ok: false, error: `The sign-in directory could not be checked: ${directoryError.message}` };
    }
    if (directory.users.some((u) => u.email?.toLowerCase() === email && u.id !== target.auth_user_id)) {
      return { ok: false, error: "Another account already signs in with that email." };
    }
    const { data: clash } = await restClient
      .from("user_profiles")
      .select("id")
      .eq("email", email)
      .neq("id", profileId)
      .maybeSingle();
    if (clash) return { ok: false, error: "Another team record already uses that email." };
  }

  const patch = { full_name: fullName, email, phone: phone || null };
  const edits = scalarEdits(
    { full_name: target.full_name, email: target.email, phone: target.phone },
    patch
  );
  if (Object.keys(edits).length === 0) return { ok: true };

  const { error: authError } = await restClient.auth.admin.updateUserById(target.auth_user_id, {
    ...(emailChanged ? { email, email_confirm: true } : {}),
    // The display name is copied into Auth metadata at creation; left behind it
    // is what any screen reading the auth record directly would print.
    user_metadata: { full_name: fullName },
  });
  if (authError) return { ok: false, error: authError.message };

  const { data: updated, error } = await restClient
    .from("user_profiles")
    .update(patch)
    .eq("id", profileId)
    .select("id");

  if (error || !updated?.length) {
    const reason =
      error?.code === "23505"
        ? "That email belongs to another team record."
        : (error?.message ?? "That team member no longer exists.");
    if (!emailChanged) return { ok: false, error: reason };

    // Auth moved but the profile did not, so undo the half-change.
    const back = await restClient.auth.admin.updateUserById(target.auth_user_id, {
      email: target.email,
      email_confirm: true,
    });
    return {
      ok: false,
      error: back.error
        ? `${reason} The sign-in address had already moved and could not be put back: ${back.error.message}`
        : `${reason} — the sign-in address was put back, so nothing was left half-changed.`,
    };
  }

  await auditStaffChange(restClient, {
    key: `staff.details:${profileId}`,
    previous: {
      full_name: target.full_name,
      email: target.email,
      phone: target.phone,
    },
    next: patch,
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "staff_update",
    entity: "staff user",
    entityId: profileId,
    summary: `Updated ${fullName}’s team record — ${changePhrase(edits)}${
      emailChanged ? ", and that is now the address they sign in with" : ""
    }`,
    detail: edits,
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

  const restClient = getServiceRestClient();
  const target = await loadTargetProfile(restClient, profileId);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  if (actor.profileId === profileId) {
    return { ok: false, error: "You cannot delete your own account." };
  }
  if (target.role === "SUPER_ADMIN") {
    const admins = await activeSuperAdminIds(restClient);
    if (admins.error) return { ok: false, error: ACCESS_UNKNOWN };
    if (admins.ids.has(profileId) && admins.ids.size <= 1) {
      return { ok: false, error: "This is the only active Super Admin account." };
    }
  }

  const banned = await bannedAuthIds(restClient);
  if (banned.error) return { ok: false, error: ACCESS_UNKNOWN };
  if (!banned.ids.has(target.auth_user_id)) {
    return {
      ok: false,
      error: "Deactivate this account first — deleting it is permanent.",
    };
  }

  const { error } = await restClient.auth.admin.deleteUser(target.auth_user_id);
  if (error) return { ok: false, error: error.message };

  await auditStaffChange(restClient, {
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

/** What a recorded invite can still be corrected to. */
export interface UpdateStaffInviteInput {
  email: string;
  full_name: string;
  role: AssignableStaffRole;
  company_id?: string | null;
}

/**
 * Corrects a pending invite in place.
 *
 * Until now the only way to fix a typo, or to move an invite onto a role an
 * account can actually hold, was to cancel it and record it again — which loses
 * who invited it and when, and reads as a cancellation followed by a new invite
 * in the trail. Only a PENDING invite can be edited: an accepted one already
 * became an account, and rewriting it would describe a person who exists.
 */
export async function updateStaffInvite(
  inviteId: string,
  input: UpdateStaffInviteInput
): Promise<StaffActionResult> {
  const actor = await requireStaffManager();
  if (!actor) return { ok: false, error: "You need the Manage users permission." };

  const fullName = input.full_name.trim();
  if (!fullName) return { ok: false, error: "Full name is required." };

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || email.startsWith("@") || email.includes("@@")) {
    return { ok: false, error: "A valid email is required." };
  }
  if (!ASSIGNABLE_ROLE_KEYS.has(input.role)) {
    return { ok: false, error: "That role cannot be assigned yet — see the note under Role." };
  }

  const restClient = getServiceRestClient();
  const { data: invite } = await restClient
    .from("user_invites")
    .select("id, email, full_name, role, company_id, status")
    .eq("id", inviteId)
    .maybeSingle();

  if (!invite) return { ok: false, error: "That invite no longer exists." };
  if (invite.status !== "PENDING") {
    return { ok: false, error: `That invite is already ${String(invite.status).toLowerCase()} — it cannot be edited.` };
  }

  const companyId = input.company_id ? input.company_id : null;
  const row = { email, full_name: fullName, role: input.role, company_id: companyId };
  const edits = scalarEdits(
    {
      email: invite.email as string,
      full_name: invite.full_name as string,
      role: invite.role as string,
      company_id: invite.company_id as string | null,
    },
    row
  );
  if (Object.keys(edits).length === 0) return { ok: true };

  if (email !== String(invite.email).toLowerCase()) {
    const { data: directory, error: directoryError } = await restClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (directoryError) {
      return { ok: false, error: `The sign-in directory could not be checked: ${directoryError.message}` };
    }
    if (directory.users.some((u) => u.email?.toLowerCase() === email)) {
      return { ok: false, error: "An account already signs in with that email." };
    }
    const { data: clash } = await restClient
      .from("user_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (clash) return { ok: false, error: "A team record already uses that email." };

    const { data: pendingClash } = await restClient
      .from("user_invites")
      .select("id")
      .eq("email", email)
      .eq("status", "PENDING")
      .neq("id", inviteId)
      .maybeSingle();
    if (pendingClash) return { ok: false, error: "That email already has another pending invite." };
  }

  const { data: updated, error } = await restClient
    .from("user_invites")
    .update(row)
    .eq("id", inviteId)
    .eq("status", "PENDING")
    .select("id");

  if (error || !updated?.length) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "That email already has another pending invite."
          : (error?.message ?? "That invite is no longer pending."),
    };
  }

  await auditStaffChange(restClient, {
    key: `staff.invite:${inviteId}`,
    previous: {
      email: invite.email,
      full_name: invite.full_name,
      role: invite.role,
      company_id: invite.company_id,
    },
    next: row,
    changedBy: actor.profileId,
  });

  await recordActivity({
    area: "team",
    action: "invite_update",
    entity: "user invite",
    entityId: inviteId,
    summary: `Corrected the pending invite for ${fullName} (${email}) — ${changePhrase(edits)}`,
    detail: edits,
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

  const restClient = getServiceRestClient();
  const { data: invite } = await restClient
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
      error: "This invite asks for a role that cannot be assigned yet — correct it with Edit first.",
    };
  }

  const email = (invite.email as string).toLowerCase();
  const { data: existingAuth } = await restClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingAuth?.users.some((u) => u.email?.toLowerCase() === email)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const minLength = await getNumberSetting(
    "security.password_min_length",
    DEFAULT_PASSWORD_MIN_LENGTH
  );
  const tempPassword = generateStaffPassword(minLength);
  const created = await createStaffAccount(restClient, {
    email,
    fullName: invite.full_name as string,
    role: invite.role as AssignableStaffRole,
    companyId: invite.company_id as string | null,
    password: tempPassword,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const { error: inviteError } = await restClient
    .from("user_invites")
    .update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
    .eq("id", inviteId);

  await auditStaffChange(restClient, {
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

  const restClient = getServiceRestClient();
  const { data: removed, error } = await restClient
    .from("user_invites")
    .delete()
    .eq("id", inviteId)
    .eq("status", "PENDING")
    .select("id, email, full_name, role, company_id");

  if (error) return { ok: false, error: error.message };
  if (!removed?.length) return { ok: false, error: "That invite is no longer pending." };

  await auditStaffChange(restClient, {
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
