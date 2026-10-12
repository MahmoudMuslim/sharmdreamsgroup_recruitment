"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

export interface CreateUserPayload {
  email: string;
  full_name: string;
  role: "SUPER_ADMIN" | "SUBSIDIARY_HR_MANAGER" | "RECRUITER" | "HIRING_MANAGER" | "INTERVIEWER";
  company_id?: string | null;
  /** Send an invite email instead of setting a password directly. */
  send_invite?: boolean;
  /** Temporary password if not sending an invite. */
  password?: string;
}

export interface CreateUserResult {
  ok: boolean;
  error?: string;
  user_id?: string;
  invite_id?: string;
}

/**
 * Creates a new staff user.
 *
 * Two modes:
 * - send_invite=true:  creates a `user_invites` row (status=PENDING). The recipient
 *   receives an email with a magic link to set their password and accept.
 * - send_invite=false: creates the auth user immediately with the provided password
 *   (or a generated one) and links the profile. The inviter must communicate the
 *   credentials securely.
 *
 * Only users with `users.manage` or `settings.manage_platform` may call this.
 */
export async function createUser(
  payload: CreateUserPayload
): Promise<CreateUserResult> {
  await requireStaff("/settings");
  if (!(await hasPermissionForUser("users.manage")) && !(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "You need the Manage users permission." };
  }

  const supabase = getSupabaseServiceClient();

  // Basic validation
  const email = payload.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "A valid email is required." };
  }
  const fullName = payload.full_name.trim();
  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }
  const validRoles = [
    "SUPER_ADMIN",
    "SUBSIDIARY_HR_MANAGER",
    "RECRUITER",
    "HIRING_MANAGER",
    "INTERVIEWER",
  ] as const;
  if (!validRoles.includes(payload.role)) {
    return { ok: false, error: "Invalid role." };
  }

  // Check email uniqueness across auth and profiles
  const { data: existingAuth } = await supabase.auth.admin.listUsers();
  const emailTaken = existingAuth.users.some((u) => u.email?.toLowerCase() === email);
  if (emailTaken) {
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

    // TODO: Send the actual invite email via your email provider.
    // For now the invite sits in the DB with status=PENDING.

    revalidatePath("/settings");
    return { ok: true, invite_id: invite.id };
  }

  // Direct create: make the auth user, then the profile.
  const tempPassword =
    payload.password?.trim() ?? Math.random().toString(36).slice(-12) + "Aa1!";

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    return { ok: false, error: authError.message };
  }

  const { error: profileError } = await supabase.from("user_profiles").insert({
    auth_user_id: authUser.user.id,
    email,
    full_name: fullName,
    role: payload.role,
    tenant_id: companyId,
  });

  if (profileError) {
    // Rollback the auth user if profile creation fails.
    await supabase.auth.admin.deleteUser(authUser.user.id);
    if (profileError.code === "23505") {
      return { ok: false, error: "That email is already in use." };
    }
    return { ok: false, error: profileError.message };
  }

  revalidatePath("/settings");
  return { ok: true, user_id: authUser.user.id };
}