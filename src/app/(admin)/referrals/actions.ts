"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { recordActivity } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  REFERRAL_WRITE_REFUSAL,
  canDecideBonus,
  canReassignReferral,
  planBonusDecision,
  planHandEntry,
} from "@/modules/referrals/domain/referral";
import {
  readReferralDesk,
  type ReferralDesk,
} from "@/modules/referrals/infrastructure/referralReader";

/**
 * The referral book's writes, behind the same staff door as its page.
 *
 * Three rules are enforced here, and each also has a wall behind it:
 *
 *   - a claim is filed by the signed-in staff member, never by a profile id the
 *     browser sends — the insert binds `referrer_profile_id` from the session and
 *     the RLS policy repeats the check;
 *   - first claim wins is the database's unique index on (lower(email), job), not
 *     a read-then-insert here — two tabs can both find nothing, and the second
 *     write is answered with 23505 and the claimant's name;
 *   - reassignment and the bonus decision are a recruiter's two doors. The role
 *     gates below refuse a hiring manager before any row is read, and the UPDATE
 *     policy is the copy that holds for a request that arrives another way.
 */

export interface ReferralMutation {
  ok: boolean;
  error?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = new Set(["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"]);

/** What the board renders, read in the page render rather than on first click. */
export async function getReferralBoard(): Promise<ReferralDesk> {
  const user = await requireStaff("/referrals");
  const restClient = await createServerRestClient();
  return readReferralDesk(restClient, { profileId: user.profileId, role: user.role });
}

function failure(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error) ? REFERRAL_WRITE_REFUSAL : error.message ?? "The write did not land.";
}

/**
 * Files a claim on somebody who applied another way, or was referred before the
 * link existed. The email is the key, folded the way the claim's index folds it.
 */
export async function fileReferral(input: {
  email: unknown;
  fullName?: unknown;
  jobId: unknown;
  note?: unknown;
}): Promise<ReferralMutation> {
  const user = await requireStaff("/referrals");

  const plan = planHandEntry(input);
  if (!plan.ok) return { ok: false, error: plan.error };

  const restClient = await createServerRestClient();
  const { data: job, error: jobError } = await restClient
    .from("job_openings")
    .select("id, title, tenant_id")
    .eq("id", plan.jobId)
    .maybeSingle();

  if (jobError) return { ok: false, error: jobError.message };
  if (!job) {
    return { ok: false, error: "That role is not one this portal can file against." };
  }

  const { error } = await restClient.from("referrals").insert({
    tenant_id: (job as Record<string, unknown>).tenant_id ?? user.tenantId,
    job_id: plan.jobId,
    email: plan.email,
    full_name: plan.fullName,
    referrer_profile_id: user.profileId,
    note: plan.note,
  });

  if (error) {
    if (isMissingSchemaError(error)) return { ok: false, error: REFERRAL_WRITE_REFUSAL };
    if (error.code === "23505") {
      // Name the claimant rather than saying "duplicate": the sentence a person
      // needs is who already has this person, and what a recruiter can do about it.
      const { data: held } = await restClient
        .from("referrals")
        .select("referrer:user_profiles!referrals_referrer_profile_id_fkey ( full_name )")
        .eq("job_id", plan.jobId)
        .eq("email", plan.email)
        .maybeSingle();
      const referrer = Array.isArray((held as Record<string, unknown> | null)?.referrer)
        ? ((held as Record<string, unknown>).referrer as Record<string, unknown>[])[0]
        : ((held as Record<string, unknown> | null)?.referrer as Record<string, unknown> | undefined);
      const name = referrer?.full_name ? String(referrer.full_name) : "another staff member";
      return {
        ok: false,
        error: `${plan.email} is already credited to ${name} for ${String(
          (job as Record<string, unknown>).title ?? "that role"
        )}. A recruiter can reassign the claim.`,
      };
    }
    return { ok: false, error: failure(error) };
  }

  await recordActivity({
    area: "referrals",
    action: "referral_filed",
    entity: "referral",
    entityId: null,
    summary: `Credited ${plan.fullName ?? plan.email} to ${user.fullName} for ${String(
      (job as Record<string, unknown>).title ?? "a role"
    )}.`,
    detail: {
      email: plan.email,
      job_id: plan.jobId,
      referrer_profile_id: user.profileId,
      note_length: plan.note?.length ?? 0,
    },
  });

  revalidatePath("/referrals");
  return { ok: true };
}

/**
 * Moves a claim from one staff member to another.
 *
 * This is the escape from first-claim-wins: a recruiter can correct a claim that
 * was filed by the wrong person, and the trail keeps both names. The claim's email,
 * role and application are untouched — only who is credited moves.
 */
export async function reassignReferral(input: {
  referralId: unknown;
  profileId: unknown;
}): Promise<ReferralMutation> {
  const user = await requireStaff("/referrals");
  if (!canReassignReferral(user.role)) {
    return { ok: false, error: "Only a recruiter or the owner can reassign a referral." };
  }

  const referralId = typeof input.referralId === "string" ? input.referralId.trim() : "";
  const profileId = typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!UUID_PATTERN.test(referralId) || !UUID_PATTERN.test(profileId)) {
    return { ok: false, error: "Choose a staff member to credit." };
  }

  const restClient = await createServerRestClient();

  const { data: target, error: targetError } = await restClient
    .from("user_profiles")
    .select("id, full_name, role")
    .eq("id", profileId)
    .maybeSingle();

  if (targetError) return { ok: false, error: targetError.message };
  if (!target || !STAFF_ROLES.has(String((target as Record<string, unknown>).role))) {
    return { ok: false, error: "A referral can only be credited to a member of staff." };
  }

  const { data: held, error: readError } = await restClient
    .from("referrals")
    .select(
      "id, email, job_id, referrer_profile_id, job_openings ( title ), " +
        "referrer:user_profiles!referrals_referrer_profile_id_fkey ( full_name )"
    )
    .eq("id", referralId)
    .maybeSingle();

  if (readError) return { ok: false, error: failure(readError) };
  if (!held) return { ok: false, error: "That referral no longer exists." };

  const row = held as Record<string, unknown>;
  if (String(row.referrer_profile_id) === profileId) {
    return { ok: false, error: "That claim is already credited to this person." };
  }

  const { error } = await restClient
    .from("referrals")
    .update({ referrer_profile_id: profileId })
    .eq("id", referralId);

  if (error) return { ok: false, error: failure(error) };

  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const before = Array.isArray(row.referrer) ? row.referrer[0] : row.referrer;
  const jobTitle = (job as Record<string, unknown> | null)?.title ?? "a role";

  await recordActivity({
    area: "referrals",
    action: "referral_reassigned",
    entity: "referral",
    entityId: referralId,
    summary: `Moved the referral of ${String(row.email)} for ${String(jobTitle)} from ${
      (before as Record<string, unknown> | null)?.full_name ?? "a former staff member"
    } to ${String((target as Record<string, unknown>).full_name)}.`,
    detail: {
      email: row.email,
      job_id: row.job_id,
      previous_referrer_profile_id: row.referrer_profile_id,
      referrer_profile_id: profileId,
    },
  });

  revalidatePath("/referrals");
  return { ok: true };
}

/**
 * Records what the programme decided the claim is worth. A record, not a payment:
 * the state and its note are stored, and the trail keeps who said so and when.
 */
export async function decideReferralBonus(input: {
  referralId: unknown;
  state: unknown;
  note?: unknown;
}): Promise<ReferralMutation> {
  const user = await requireStaff("/referrals");
  if (!canDecideBonus(user.role)) {
    return { ok: false, error: "Only a recruiter or the owner can record a bonus decision." };
  }

  const referralId = typeof input.referralId === "string" ? input.referralId.trim() : "";
  if (!UUID_PATTERN.test(referralId)) {
    return { ok: false, error: "That referral no longer exists." };
  }

  const plan = planBonusDecision({ state: input.state, note: input.note });
  if (!plan.ok) return { ok: false, error: plan.error };

  const restClient = await createServerRestClient();
  const decidedAt = new Date().toISOString();

  const { data: held, error: readError } = await restClient
    .from("referrals")
    .select("id, email, bonus_state, job_openings ( title )")
    .eq("id", referralId)
    .maybeSingle();

  if (readError) return { ok: false, error: failure(readError) };
  if (!held) return { ok: false, error: "That referral no longer exists." };

  const { error } = await restClient
    .from("referrals")
    .update({
      bonus_state: plan.state,
      bonus_note: plan.note,
      bonus_decided_by: user.profileId,
      bonus_decided_at: decidedAt,
    })
    .eq("id", referralId);

  if (error) return { ok: false, error: failure(error) };

  const row = held as Record<string, unknown>;
  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;

  await recordActivity({
    area: "referrals",
    action: "referral_bonus",
    entity: "referral",
    entityId: referralId,
    summary: `Recorded the referral bonus for ${String(row.email)} on ${String(
      (job as Record<string, unknown> | null)?.title ?? "a role"
    )} as ${plan.state}.`,
    detail: {
      email: row.email,
      previous_state: row.bonus_state,
      bonus_state: plan.state,
      note_length: plan.note?.length ?? 0,
    },
  });

  revalidatePath("/referrals");
  return { ok: true };
}
