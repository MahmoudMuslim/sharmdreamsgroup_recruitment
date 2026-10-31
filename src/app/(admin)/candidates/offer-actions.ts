"use server";

import { revalidatePath } from "next/cache";

import { readApplicationForStageDoor } from "@/infrastructure/repositories/application";
import { createServerRestClient } from "@/lib/data-api/server";
import { publicBaseUrl } from "@/lib/public-url";
import { formatInZone } from "@/lib/timezone";
import { requireStaff } from "@/lib/auth/session";
import { recordActivity } from "@/modules/activity/application/record";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { sendOfferNotice } from "@/modules/omnichannel/application/candidate-notifications";
import {
  OFFER_DEFAULT_DAYS,
  OFFER_SCHEMA_NOTE,
  OFFER_WRITE_REFUSAL,
  canIssueOffer,
  offerExpiry,
  offerStanding,
  readOfferDays,
  type OfferStanding,
} from "@/modules/offers/domain/offer";
import {
  offerLink,
  offerLinkSeconds,
  mintOfferToken,
} from "@/modules/offers/application/offerToken";
import {
  readLatestOffer,
  type OfferRecord,
} from "@/modules/offers/infrastructure/offerReader";
import { updateApplicationStage } from "./candidate-actions";

/**
 * The desk's half of an offer.
 *
 * An offer is a document with a deadline, not a stage. Issuing one mails the
 * letter with the link the candidate answers from, and only then writes the row:
 * a letter that never went leaves nothing behind, so nobody holds a link to an
 * offer the database never heard of. Accepting is the candidate's answer; turning
 * that answer into a hire is this desk's separate decision.
 *
 * The drawer that calls these lives on `/candidates`, which is where a person is
 * worked on. The public answer lives on `/offer` and never touches this file.
 */

export type OfferPanelState =
  | {
      ok: true;
      offer: OfferRecord | null;
      standing: OfferStanding | null;
      defaultDays: number;
    }
  | { ok: false; error: string };

/**
 * The newest offer on one application, and where it stands right now.
 *
 * A missing table is reported as a failed read rather than "no offer": the two
 * facts lead a recruiter to opposite actions, and only one of them is true.
 */
export async function readOfferPanel(applicationId: string): Promise<OfferPanelState> {
  await requireStaff("/candidates");

  const read = await readLatestOffer(applicationId);
  if (!read.ok) {
    return { ok: false, error: read.missingSchema ? OFFER_SCHEMA_NOTE : read.error };
  }

  const standing = read.offer
    ? offerStanding({
        state: read.offer.state,
        expiresAt: read.offer.expiresAt,
        now: new Date(),
      })
    : null;

  return { ok: true, offer: read.offer, standing, defaultDays: OFFER_DEFAULT_DAYS };
}

export interface OfferActionResult {
  ok: boolean;
  error?: string;
  /** Something worth saying even though the action itself succeeded. */
  warning?: string;
  /** The address the letter reached, echoed by the sender. */
  recipient?: string;
  /** The deadline as the desk reads it. */
  expiresOn?: string;
}

/**
 * Issues one offer: mails the letter and its link, then records the offer.
 *
 * The order is the rule. `sendOfferNotice` is called before the row is written,
 * so a relay refusal, a switched-off channel or a record with no address ends
 * here with nothing stored — rather than a row whose link never reached anybody.
 *
 * A second open offer is refused before the send, because the unique index would
 * refuse the write afterwards and the letter would already be on its way. So is
 * an expired one, which the index still counts as open, and an accepted one,
 * which has an answer to act on instead. The read is not a lock; if two
 * recruiters cross anyway, the index still holds and the loser is told the truth
 * instead of being shown a success.
 */
export async function issueOffer(input: {
  applicationId: string;
  days?: unknown;
}): Promise<OfferActionResult> {
  const session = await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const days = readOfferDays(input.days);
  const issuedAt = new Date();
  const expires = offerExpiry(issuedAt, days);
  if (!expires) {
    return { ok: false, error: "That deadline could not be read. Try a number of days." };
  }

  const restClient = await createServerRestClient();
  // The same three columns the booking desk starts from, through the one read the
  // repositories layer owns. The refusal sentences stay here, in this desk's own
  // words, and a refused read keeps the database's message rather than borrowing
  // "no record matches that id".
  const applicant = await readApplicationForStageDoor(restClient, input.applicationId);
  if (!applicant.ok) {
    return {
      ok: false,
      error:
        applicant.reason === "read_failed"
          ? applicant.error
          : "No candidate record matches that id.",
    };
  }

  const row = applicant.application;
  if (!canIssueOffer(row.stage)) {
    return {
      ok: false,
      error: `An offer cannot be issued at the ${String(row.stage).replace("_", " ").toLowerCase()} stage.`,
    };
  }

  const existing = await readLatestOffer(input.applicationId);
  if (!existing.ok) return { ok: false, error: existing.error };

  // The open-offer index counts a SENT row even once its deadline has passed,
  // because expiry is a reading of `expires_at`, not a state. Every standing
  // that still holds the index is therefore refused here, before the letter is
  // mailed — otherwise the send succeeds and the insert fails behind it.
  const standing: OfferStanding | null = existing.offer
    ? offerStanding({
        state: existing.offer.state,
        expiresAt: existing.offer.expiresAt,
        now: issuedAt,
      })
    : null;

  if (standing === "open") {
    return {
      ok: false,
      error: "An offer is already open on this application. Withdraw it before sending another.",
    };
  }

  if (standing === "expired") {
    return {
      ok: false,
      error:
        "The last offer is past its deadline but still on the record, so a new one cannot be filed beside it. Close the expired offer first.",
    };
  }

  if (standing === "accepted") {
    return {
      ok: false,
      error:
        "The candidate already accepted this offer. Confirm the hire rather than sending another letter.",
    };
  }

  const offerId = crypto.randomUUID();
  const token = mintOfferToken({
    applicationId: input.applicationId,
    offerId,
    ttlSeconds: offerLinkSeconds(days),
  });
  const link = offerLink(await publicBaseUrl(), token);

  const expiresOn = formatInZone(expires.toISOString(), await getOrganisationTimeZone(), {
    dateStyle: "long",
    timeStyle: "short",
  });

  const sent = await sendOfferNotice({
    applicationId: input.applicationId,
    link,
    expiresOn,
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  const { error: insertError } = await restClient.from("application_offers").insert({
    id: offerId,
    application_id: input.applicationId,
    state: "SENT",
    expires_at: expires.toISOString(),
    issued_by: session.profileId,
  });

  if (insertError) {
    console.error("[offers] offer row refused after the letter was sent:", insertError.message);
    return {
      ok: false,
      error: isMissingSchemaError(insertError)
        ? `The offer letter was sent, but the offer could not be recorded. ${OFFER_WRITE_REFUSAL}`
        : insertError.code === "23505"
          ? "The offer letter was sent, but another replying recruiter opened an offer on this application at the same moment. Check the offer before sending again."
          : `The offer letter was sent, but the offer could not be recorded: ${insertError.message}`,
    };
  }

  // The stage is set by the offer, not by a separate notice: the letter that just
  // went out is the notice, so moving an earlier stage here stays silent.
  let warning: string | undefined;
  if (String(row.stage).toUpperCase() !== "OFFER") {
    const moved = await updateApplicationStage({
      applicationId: input.applicationId,
      stage: "OFFER",
      notify: false,
    });
    if (!moved.ok) {
      warning = `The offer was sent and recorded, but the stage did not move: ${moved.error}`;
    }
  }

  await recordActivity({
    area: "candidates",
    action: "offer_issued",
    entity: "application",
    entityId: input.applicationId,
    summary: `Sent an offer to ${row.full_name ?? "a candidate"}, open until ${expiresOn}`,
    detail: { offer_id: offerId, days, expires_at: expires.toISOString(), recipient: sent.recipient ?? null },
  });

  revalidatePath("/candidates");
  revalidatePath("/dashboard");

  return { ok: true, recipient: sent.recipient, expiresOn, warning };
}

/**
 * Withdraws an offer nobody has answered. The row is still SENT after its
 * deadline passes, so this door also closes an expired offer — which it must,
 * because the open-offer index keeps counting it until it is closed. An answered
 * offer is a fact and is not withdrawn here; a candidate who has already said yes
 * needs a conversation, not a silent state change underneath their answer.
 */
export async function withdrawOffer(input: {
  applicationId: string;
  offerId: string;
}): Promise<OfferActionResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("application_offers")
    .update({ state: "WITHDRAWN", decided_at: new Date().toISOString() })
    .eq("id", input.offerId)
    .eq("application_id", input.applicationId)
    .eq("state", "SENT")
    .select("id");

  if (error) {
    return {
      ok: false,
      error: isMissingSchemaError(error)
        ? OFFER_WRITE_REFUSAL
        : `The offer could not be withdrawn: ${error.message}`,
    };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      error: "That offer has already been answered or withdrawn.",
    };
  }

  await recordActivity({
    area: "candidates",
    action: "offer_withdrawn",
    entity: "application",
    entityId: input.applicationId,
    summary: "Closed an unanswered offer",
    detail: { offer_id: input.offerId },
  });

  revalidatePath("/candidates");
  revalidatePath("/dashboard");

  return { ok: true };
}

/**
 * Confirms an accepted offer as a hire.
 *
 * Acceptance is the candidate's word; a hire is the company's. Only an answer
 * already recorded as ACCEPTED is confirmed, so a stale drawer cannot turn a
 * declined or unanswered offer into an employment record. The stage writer does
 * the move, its trail row and the hired letter — this function adds no second
 * way to change a stage.
 */
export async function confirmOfferHire(input: {
  applicationId: string;
}): Promise<OfferActionResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Edit candidates permission." };
  }

  const read = await readLatestOffer(input.applicationId);
  if (!read.ok) return { ok: false, error: read.error };
  if (!read.offer) {
    return { ok: false, error: "There is no offer on this application to confirm." };
  }

  if (read.offer.state !== "ACCEPTED") {
    return {
      ok: false,
      error: "Only an offer the candidate has accepted can be confirmed as a hire.",
    };
  }

  const moved = await updateApplicationStage({
    applicationId: input.applicationId,
    stage: "HIRED",
  });

  if (!moved.ok) return { ok: false, error: moved.error };

  return { ok: true };
}
