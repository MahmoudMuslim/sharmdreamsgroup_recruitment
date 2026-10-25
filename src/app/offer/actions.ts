"use server";

import { getServiceRestClient } from "@/lib/data-api/service";
import { formatInZone } from "@/lib/timezone";

import { recordActivity } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import {
  decideOffer,
  offerStanding,
  type OfferStanding,
} from "@/modules/offers/domain/offer";
import { verifyOfferToken } from "@/modules/offers/application/offerToken";
import { readOfferForLink } from "@/modules/offers/infrastructure/offerReader";

/**
 * The public half of an offer: what a mailed link opens, and the two answers it
 * takes.
 *
 * The link is the credential. Its signature and purpose are checked before
 * either id is trusted, and the pair (application, offer) inside that signed
 * body is the only thing read or written — so a link from an older, withdrawn
 * offer cannot answer a newer one. Nothing here takes an id from the browser.
 *
 * The answer itself is a conditional write on the same conditions the page was
 * rendered under: the offer must still be `SENT` and its deadline must still be
 * ahead. Two clicks racing at the deadline cannot both win, and losing the race
 * is reported as a refusal rather than dressed up as a success.
 */

const UNREACHABLE =
  "This offer cannot be opened just now. Contact the recruiter who sent it to you.";

function refusal(reason: "malformed" | "signature" | "expired"): string {
  return reason === "expired"
    ? "That link has expired. Ask the recruiter who sent it for a new one."
    : "That link is not one this portal issued, or it has been changed. Ask the recruiter who sent it for a new one.";
}

export type OfferDoorDescription =
  | {
      ok: true;
      applicationId: string;
      offerId: string;
      fullName: string;
      jobTitle: string | null;
      standing: OfferStanding;
      /** The deadline on the group's own clock, for the sentence on the page. */
      expiresOn: string;
    }
  | { ok: false; message: string };

/**
 * What a link is allowed to show, or why it shows nothing.
 *
 * The reader runs with the service role because the holder has no session; the
 * link's signature was checked first and names exactly one offer. An application
 * that has since been erased answers as a bad link: there is no person left for
 * an offer to be made to.
 */
export async function describeOfferLink(token: unknown): Promise<OfferDoorDescription> {
  const verified = verifyOfferToken(token);
  if (!verified.ok) return { ok: false, message: refusal(verified.reason) };

  const service = getServiceRestClient();
  const { data: application, error: applicationError } = await service
    .from("applications")
    .select("id, full_name, erased_at, job_openings ( title )")
    .eq("id", verified.applicationId)
    .maybeSingle();

  if (applicationError) {
    console.error("[offers] link read refused:", applicationError.message);
    return {
      ok: false,
      message: isMissingSchemaError(applicationError)
        ? UNREACHABLE
        : "This offer could not be read just now. Try again in a moment.",
    };
  }

  const person = application as Record<string, unknown> | null;
  if (!person || person.erased_at != null) {
    return {
      ok: false,
      message: "That offer is no longer available. Contact the recruiter who sent it to you.",
    };
  }

  const read = await readOfferForLink(verified.applicationId, verified.offerId);
  if (!read.ok) return { ok: false, message: UNREACHABLE };
  if (!read.offer) {
    return {
      ok: false,
      message: "That offer is no longer available. Contact the recruiter who sent it to you.",
    };
  }

  const job = Array.isArray(person.job_openings) ? person.job_openings[0] : person.job_openings;
  const expiresOn = formatInZone(
    read.offer.expiresAt,
    await getOrganisationTimeZone(),
    { dateStyle: "long", timeStyle: "short" }
  );

  return {
    ok: true,
    applicationId: verified.applicationId,
    offerId: verified.offerId,
    fullName: String(person.full_name ?? "there"),
    jobTitle: (job as Record<string, unknown> | null)?.title
      ? String((job as Record<string, unknown>).title)
      : null,
    standing: offerStanding({
      state: read.offer.state,
      expiresAt: read.offer.expiresAt,
      now: new Date(),
    }),
    expiresOn,
  };
}

export interface OfferAnswerResult {
  ok: boolean;
  /** What the candidate reads. The same words the page would have shown. */
  message: string;
}

/**
 * Records the candidate's answer to the one offer a link names.
 *
 * The deadline check is made twice on purpose. `decideOffer` gives the sentence
 * that matches the offer's actual position — withdrawn, already answered, past
 * its deadline — and the update repeats the two conditions in SQL so the answer
 * cannot land on an offer that changed between the read and the write. A zero-row
 * result is the race being lost, and it is answered by re-reading rather than by
 * guessing.
 */
export async function answerOffer(input: {
  token: unknown;
  decision: unknown;
}): Promise<OfferAnswerResult> {
  const verified = verifyOfferToken(input.token);
  if (!verified.ok) return { ok: false, message: refusal(verified.reason) };

  const service = getServiceRestClient();
  const { data: application, error: applicationError } = await service
    .from("applications")
    .select("id, erased_at, tenant_id")
    .eq("id", verified.applicationId)
    .maybeSingle();

  if (applicationError) {
    console.error("[offers] answer read refused:", applicationError.message);
    return { ok: false, message: UNREACHABLE };
  }

  const person = application as Record<string, unknown> | null;
  if (!person || person.erased_at != null) {
    return {
      ok: false,
      message: "That offer is no longer available. Contact the recruiter who sent it to you.",
    };
  }

  const read = await readOfferForLink(verified.applicationId, verified.offerId);
  if (!read.ok) return { ok: false, message: UNREACHABLE };
  if (!read.offer) {
    return {
      ok: false,
      message: "That offer is no longer available. Contact the recruiter who sent it to you.",
    };
  }

  const now = new Date();
  const plan = decideOffer({
    state: read.offer.state,
    expiresAt: read.offer.expiresAt,
    decision: input.decision,
    now,
  });
  if (!plan.ok) return { ok: false, message: plan.error };

  const { data, error } = await service
    .from("application_offers")
    .update({ state: plan.state, decided_at: now.toISOString() })
    .eq("id", verified.offerId)
    .eq("application_id", verified.applicationId)
    .eq("state", "SENT")
    .gt("expires_at", now.toISOString())
    .select("id");

  if (error) {
    console.error("[offers] answer refused:", error.message);
    return {
      ok: false,
      message: isMissingSchemaError(error)
        ? UNREACHABLE
        : "Your answer could not be recorded just now. Try again in a moment.",
    };
  }

  if (!Array.isArray(data) || data.length === 0) {
    // The read and the write disagreed. Ask the database again rather than
    // assuming which of the two conditions moved.
    const again = await readOfferForLink(verified.applicationId, verified.offerId);
    if (again.ok && again.offer) {
      const current = decideOffer({
        state: again.offer.state,
        expiresAt: again.offer.expiresAt,
        decision: input.decision,
        now: new Date(),
      });
      if (!current.ok) return { ok: false, message: current.error };
    }
    return {
      ok: false,
      message: "Your answer did not reach us. Please try again in a moment.",
    };
  }

  // The answer is the candidate's activity on the record, so the retention
  // window restarts here. Best effort: the answer is already recorded, and a
  // failed timestamp must not turn it into an error on screen.
  const touched = await service
    .from("applications")
    .update({ updated_at: now.toISOString() })
    .eq("id", verified.applicationId);
  if (touched.error) {
    console.error("[offers] activity stamp failed:", touched.error.message);
  }

  // The person is not named: this trail outlives the application, and the offer
  // id is enough for the desk to say which document was answered.
  await recordActivity({
    area: "candidates",
    action: "offer_answered",
    entity: "application",
    entityId: verified.applicationId,
    summary:
      plan.state === "ACCEPTED" ? "Accepted an offer through the mailed link" : "Declined an offer through the mailed link",
    detail: { offer_id: verified.offerId, decision: input.decision },
    actorKind: "CANDIDATE",
    actorLabel: "Offer answer",
    actorId: null,
    via: "career site",
    companyId: (person.tenant_id as string | null) ?? null,
  });

  return {
    ok: true,
    message:
      plan.state === "ACCEPTED"
        ? "Thank you — your acceptance is recorded. A recruiter will confirm the next steps with you directly."
        : "Thank you for telling us. Your decision is recorded, and a recruiter will be in touch.",
  };
}
