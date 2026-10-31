import {
  configuredLinkSecret,
  deriveSignedLinkKey,
  mintSignedLink,
  verifySignedLink,
  type SignedLinkSpec,
} from "@/lib/signed-link";
import { OFFER_DEFAULT_DAYS } from "@/modules/offers/domain/offer";

/**
 * The mailed link that opens one offer.
 *
 * It names both the application and the offer. Naming the application alone
 * would let a link from an older, withdrawn offer answer a newer one that the
 * candidate never read; naming the offer means an answer lands on the document
 * that was actually sent to them.
 *
 * The key is derived from `AUTH_JWT_SECRET` under an offer-only context, so a
 * privacy link and an offer link can never be replayed as each other even if
 * their payloads were confused.
 *
 * The link outlives the deadline by one day. The deadline decides whether an
 * answer counts — `decideOffer` and the conditional write both enforce it — and
 * the extra day is what lets a candidate who clicks the morning after still see
 * that the offer expired instead of a broken link. The page never guesses: it
 * says expired, and offers the contact address.
 */
const SPEC: SignedLinkSpec = { purpose: "offer", keyContext: "offer-link:v1" };

export const OFFER_LINK_GRACE_DAYS = 1;

/** How long a link for an offer with `days` to answer stays open. */
export function offerLinkSeconds(days: number): number {
  return (days + OFFER_LINK_GRACE_DAYS) * 86_400;
}

/** The derived key, exported so a proof can compare it with the privacy key. */
export function offerSigningKey(secret: string): Buffer {
  return deriveSignedLinkKey(secret, SPEC.keyContext);
}

export interface OfferTokenInput {
  applicationId: string;
  offerId: string;
  /** Epoch seconds. Injected so a proof can pin the clock. */
  now?: number;
  secret?: string;
  ttlSeconds?: number;
}

export function mintOfferToken(input: OfferTokenInput): string {
  const applicationId = input.applicationId?.trim();
  const offerId = input.offerId?.trim();
  if (!applicationId) throw new Error("An offer link needs an application id.");
  if (!offerId) throw new Error("An offer link needs an offer id.");

  return mintSignedLink({
    spec: SPEC,
    payload: { a: applicationId, o: offerId },
    ttlSeconds: input.ttlSeconds ?? offerLinkSeconds(OFFER_DEFAULT_DAYS),
    now: input.now,
    secret: input.secret ?? configuredLinkSecret("an offer link"),
  });
}

export type OfferTokenResult =
  | { ok: true; applicationId: string; offerId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

/**
 * A bad token is a reason, never an exception, because the page passes whatever
 * arrived in the query string. The signature and purpose are checked before
 * either id is trusted.
 */
export function verifyOfferToken(
  token: unknown,
  options: { now?: number; secret?: string } = {}
): OfferTokenResult {
  const verified = verifySignedLink({
    token,
    spec: SPEC,
    now: options.now,
    secret: options.secret ?? configuredLinkSecret("an offer link"),
  });
  if (!verified.ok) return verified;

  const applicationId = verified.payload.a;
  const offerId = verified.payload.o;
  if (
    typeof applicationId !== "string" ||
    applicationId.length === 0 ||
    typeof offerId !== "string" ||
    offerId.length === 0
  ) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, applicationId, offerId, expiresAt: verified.expiresAt };
}

/** The public page's address, carrying the token. A blank origin is relative. */
export function offerLink(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/offer?token=${encodeURIComponent(token)}`;
}
