"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";

import { recordActivity } from "@/modules/activity/application/record";
import { emailSpellings } from "@/modules/candidates/domain/personIdentity";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { sendAccessCopy } from "@/modules/privacy/application/accessCopy";
import { erasePerson } from "@/modules/privacy/application/erasure";
import {
  PRIVACY_WRITE_REFUSAL,
  canDecidePrivacyRequest,
  canExecuteErasure,
  canReadPrivacyDesk,
  canVerifyPrivacyRequest,
  nextRequestState,
  type PrivacyRequestAction,
  type PrivacyRequestState,
} from "@/modules/privacy/domain/privacy";
import {
  readPrivacyDesk,
  type PrivacyDesk,
} from "@/modules/privacy/infrastructure/privacyReader";

/**
 * The desk's two doors: read it, and move a request one step.
 *
 * Nobody wears the same hat at every step. Checking that the person asking is
 * the person on the record is a recruiter's job; approving what happens next and
 * running the destructive part is the owner's. Those three gates are repeated by
 * the UPDATE policy in 041, so a request that reaches the database another way is
 * still refused — a role check that lives only here is one direct call away from
 * being no check at all.
 *
 * A write never names the requester in the trail. The trail outlives an erasure,
 * and a summary saying who was erased would put the identity back in the one
 * table nobody clears.
 */

export type RetentionPageData =
  | { denied: true; desk: null }
  | { denied: false; desk: PrivacyDesk };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS: readonly PrivacyRequestAction[] = ["verify", "approve", "decline", "execute"];

function isAction(value: unknown): value is PrivacyRequestAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function failure(error: { code?: string | null; message?: string | null }): string {
  return isMissingSchemaError(error)
    ? PRIVACY_WRITE_REFUSAL
    : error.message ?? "The write did not land.";
}

/** What `/retention` renders, read in the page render rather than on first click. */
export async function getRetentionDesk(): Promise<RetentionPageData> {
  const user = await requireStaff("/retention");
  if (!canReadPrivacyDesk(user.role)) {
    return { denied: true, desk: null };
  }
  const restClient = await createServerRestClient();
  return { denied: false, desk: await readPrivacyDesk(restClient, { role: user.role }) };
}

export interface PrivacyMutation {
  ok: boolean;
  error?: string;
  message?: string;
}

type RequestRow = {
  id: string;
  kind: string;
  email: string;
  state: PrivacyRequestState;
  application_id: string | null;
};

function refusalFor(action: PrivacyRequestAction, role: string): string | null {
  if (action === "verify" && !canVerifyPrivacyRequest(role)) {
    return "Only a recruiter or the owner can verify a request.";
  }
  if ((action === "approve" || action === "decline") && !canDecidePrivacyRequest(role)) {
    return "Only the owner can approve or decline a request.";
  }
  if (action === "execute" && !canExecuteErasure(role)) {
    return "Only the owner can run a request.";
  }
  return null;
}

/**
 * Move one request to its next state, doing the work that state means.
 *
 * `nextRequestState` is the only source of what is allowed: a request cannot be
 * approved before it is verified, executed before it is approved, or moved after
 * it is executed or declined. The database's transition is the same table, so a
 * second tab racing this one is refused rather than silently re-run.
 */
export async function actOnPrivacyRequest(input: {
  requestId: unknown;
  action: unknown;
}): Promise<PrivacyMutation> {
  const user = await requireStaff("/retention");
  if (!canReadPrivacyDesk(user.role)) {
    return { ok: false, error: "Only a recruiter or the owner can act on a privacy request." };
  }

  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!UUID_PATTERN.test(requestId)) {
    return { ok: false, error: "That request no longer exists." };
  }
  if (!isAction(input.action)) {
    return { ok: false, error: "That is not a step this desk performs." };
  }
  const action = input.action;

  const denied = refusalFor(action, user.role);
  if (denied) return { ok: false, error: denied };

  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("privacy_requests")
    .select("id, kind, email, state, application_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error) return { ok: false, error: failure(error) };
  if (!data) return { ok: false, error: "That request no longer exists." };

  const row = data as RequestRow;
  const next = nextRequestState(row.state, action);
  if (!next) {
    return {
      ok: false,
      error: `A request that is ${row.state.toLowerCase()} cannot be ${action}d. Reload the desk.`,
    };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { state: next };

  if (action === "verify") {
    const { data: match, error: matchError } = await restClient
      .from("applications")
      .select("id")
      .in("email", emailSpellings(row.email))
      .is("erased_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (matchError) return { ok: false, error: failure(matchError) };
    if (!match) {
      return {
        ok: false,
        error:
          "No application on file carries that address, so there is nothing to answer. " +
          "Decline the request, or check the address with the person who filed it.",
      };
    }
    patch.application_id = String((match as Record<string, unknown>).id);
    patch.verified_by = user.profileId;
    patch.verified_at = now;
  }

  if (action === "approve" || action === "decline") {
    patch.decided_by = user.profileId;
    patch.decided_at = now;
  }

  /*
   * Execution happens before the row says EXECUTED: a failed mail or a held
   * erasure must leave the request where it was, retryable, rather than claim a
   * result that did not happen.
   */
  if (action === "execute") {
    if (row.kind === "erasure") {
      const outcome = await erasePerson({
        email: row.email,
        actorId: user.profileId,
        actorLabel: user.fullName,
        via: "console",
      });
      if (!outcome.ok) {
        await recordActivity({
          area: "privacy",
          action: "privacy_erasure_held",
          entity: "application",
          entityId: row.application_id,
          summary: "A privacy erasure was held because a record could not be erased.",
          detail: {
            request_id: requestId,
            erased: outcome.erased,
            held: outcome.held.length,
          },
        });
        revalidatePath("/retention");
        return { ok: false, error: outcome.error ?? "The erasure did not run." };
      }
      patch.executed_at = now;
    } else {
      const sent = await sendAccessCopy({ email: row.email, requestId });
      if (!sent.ok) {
        return { ok: false, error: sent.error ?? "The copy could not be sent." };
      }
      patch.executed_at = now;
    }
  }

  const { error: writeError } = await restClient
    .from("privacy_requests")
    .update(patch)
    .eq("id", requestId);

  if (writeError) return { ok: false, error: failure(writeError) };

  await recordActivity({
    area: "privacy",
    action:
      action === "verify"
        ? "privacy_request_verified"
        : action === "approve"
          ? "privacy_request_approved"
          : action === "decline"
            ? "privacy_request_declined"
            : "privacy_request_executed",
    entity: "application",
    entityId: (patch.application_id as string | undefined) ?? row.application_id,
    summary:
      action === "verify"
        ? "Verified a privacy request and matched it to an application on file."
        : action === "approve"
          ? "Approved a privacy request for execution."
          : action === "decline"
            ? "Declined a privacy request."
            : row.kind === "erasure"
              ? "Ran a privacy erasure request."
              : "Sent a copy of the data held for a privacy request.",
    detail: {
      request_id: requestId,
      kind: row.kind,
      state: next,
    },
  });

  revalidatePath("/retention");
  return {
    ok: true,
    message:
      action === "verify"
        ? "Verified. The owner can now approve or decline it."
        : action === "approve"
          ? row.kind === "erasure"
            ? "Approved. Executing it erases the person's data and keeps the judgment."
            : "Approved. Executing it mails the person a copy of what is held."
          : action === "decline"
            ? "Declined. Nothing on the record was changed."
            : "Done.",
  };
}
