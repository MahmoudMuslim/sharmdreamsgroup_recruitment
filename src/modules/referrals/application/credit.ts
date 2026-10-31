import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { REFERRAL_CODE_PATTERN } from "@/modules/referrals/domain/referral";

/**
 * The public door's half of the referral programme: turning a code on an apply
 * link into a credited claim, without ever costing the applicant their
 * application.
 *
 * Everything here is best-effort. A referral is a fact about who introduced
 * somebody, not a condition of applying, and migration 040 is deliberately
 * unapplied — so a missing table, a missing column or an expired code must fail
 * quietly here and leave the application exactly as it would have been. The
 * caller only uses the result to decide whether to mention a credit in the trail;
 * it never refuses a submission because of it.
 *
 * The lookup runs with the service role because the applicant is anonymous and
 * `user_profiles` is not readable from the public form. The code is the secret,
 * and only a staff member's code resolves: a candidate's own code is refused so a
 * candidate cannot credit themselves by sharing their own link.
 */

const STAFF_ROLE_VALUES = new Set(["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"]);

export interface ReferralClaimant {
  profileId: string;
  name: string;
  tenantId: string | null;
}

/**
 * The staff member a code belongs to, or null when it belongs to nobody here.
 *
 * A code that fails the pattern is refused before the query, so a mistyped link
 * costs no round trip. A candidate's code is refused after it: the row exists, but
 * a candidate is not an employee who can refer anyone.
 */
export async function resolveReferralCode(code: string): Promise<ReferralClaimant | null> {
  const normalised = code.trim().toUpperCase();
  if (!REFERRAL_CODE_PATTERN.test(normalised)) return null;

  const { data, error } = await getServiceRestClient()
    .from("user_profiles")
    .select("id, full_name, tenant_id, role")
    .eq("referral_code", normalised)
    .maybeSingle();

  // A database without migration 040 has no `referral_code` column; that is a
  // feature this portal has not been given yet, not a reason to fail an apply.
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  if (!STAFF_ROLE_VALUES.has(String(row.role))) return null;

  return {
    profileId: String(row.id),
    name: String(row.full_name ?? "A staff member"),
    tenantId: row.tenant_id == null ? null : String(row.tenant_id),
  };
}

export type ReferralCreditReason =
  /** A new claim was written from the code. */
  | "credited"
  /** A hand-entered claim already existed; the application was linked to it. */
  | "linked"
  /** The code names no staff member, or names a candidate. */
  | "unknown-code"
  /** Somebody already claimed this person for this role — first claim wins. */
  | "already-claimed"
  /** The table or column is absent, or the database did not answer. */
  | "unavailable";

export interface ReferralCreditResult {
  credited: boolean;
  reason: ReferralCreditReason;
}

export interface ReferralCreditInput {
  applicationId: string;
  jobId: string;
  email: string;
  fullName: string;
  code: string;
}

/**
 * Credits the application to the code's owner, or links it to an earlier claim.
 *
 * Linking rather than inserting is what makes first-claim-wins real on the public
 * door: a recruiter may have hand-entered this person last week, and a second
 * employee's link cannot take that claim away. The linked row keeps its original
 * referrer; only the application and a missing tenant are filled in.
 *
 * The address is folded here because both write doors fold it, so a claim is
 * looked up by the same key the unique index uses.
 */
export async function creditReferral(
  input: ReferralCreditInput
): Promise<ReferralCreditResult> {
  try {
    const claimant = await resolveReferralCode(input.code);
    if (!claimant) return { credited: false, reason: "unknown-code" };

    const email = input.email.trim().toLowerCase();
    const restClient = getServiceRestClient();

    const { data: existing, error: readError } = await restClient
      .from("referrals")
      .select("id, application_id, tenant_id")
      .eq("job_id", input.jobId)
      .eq("email", email)
      .maybeSingle();

    if (readError) {
      if (!isMissingSchemaError(readError)) {
        console.error("[referrals] claim lookup failed:", readError.message);
      }
      return { credited: false, reason: "unavailable" };
    }

    if (existing) {
      const held = existing as Record<string, unknown>;
      if (held.application_id) return { credited: false, reason: "already-claimed" };

      // The `is(..., null)` predicate is the race's second wall: if another
      // request linked this claim between the read and this update, the update
      // matches no row and the claim is still counted once.
      const { error } = await restClient
        .from("referrals")
        .update({
          application_id: input.applicationId,
          tenant_id: held.tenant_id ?? claimant.tenantId,
        })
        .eq("id", held.id)
        .is("application_id", null);

      if (error) {
        if (error.code === "23505") {
          return { credited: false, reason: "already-claimed" };
        }
        if (!isMissingSchemaError(error)) {
          console.error("[referrals] claim link failed:", error.message);
        }
        return { credited: false, reason: "unavailable" };
      }

      return { credited: true, reason: "linked" };
    }

    const { error } = await restClient.from("referrals").insert({
      tenant_id: claimant.tenantId,
      job_id: input.jobId,
      application_id: input.applicationId,
      email,
      full_name: input.fullName.trim() || null,
      referrer_profile_id: claimant.profileId,
    });

    if (error) {
      if (error.code === "23505") {
        // Another staff member claimed this person for this role first — or this
        // application was already credited by a parallel submit.
        return { credited: false, reason: "already-claimed" };
      }
      if (!isMissingSchemaError(error)) {
        console.error("[referrals] claim insert failed:", error.message);
      }
      return { credited: false, reason: "unavailable" };
    }

    return { credited: true, reason: "credited" };
  } catch (error) {
    // The one rule this function cannot break: an application that was stored is
    // never reported as failed because its referral could not be.
    console.error("[referrals] credit failed:", error);
    return { credited: false, reason: "unavailable" };
  }
}
