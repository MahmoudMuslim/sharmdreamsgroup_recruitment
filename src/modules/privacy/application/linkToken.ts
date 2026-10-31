import {
  configuredLinkSecret,
  deriveSignedLinkKey,
  mintSignedLink,
  verifySignedLink,
  type SignedLinkSpec,
} from "@/lib/signed-link";

/**
 * The mailed link that opens the privacy request page.
 *
 * The portal's session is a staff session or a candidate tracking code, and
 * neither is the right key for "I am the person on this application and I want
 * my data". A link that carried the tracking code would work, but a tracking
 * code is also what the candidate types on the portal and shares with anybody
 * helping them; a request to erase should need an artefact that was mailed to the
 * address on the record, expires, and grants nothing else.
 *
 * So the token is a small signed body: which application, when it stops being
 * valid, and what it is for. The key is derived from `AUTH_JWT_SECRET` with its
 * own context string rather than reusing the session-signing key directly, so a
 * token minted here can never be replayed as a session even if the payload
 * shapes were somehow confused.
 *
 * Seven days is a deliberate ceiling: long enough for somebody to open their mail
 * at the weekend, short enough that a forwarded inbox stops working quickly.
 *
 * The signing itself lives in `@/lib/signed-link` because the offer door mints
 * the same shape for a different purpose. This file owns the privacy vocabulary:
 * the context, the seven days, and the sentence a caller sees when the secret is
 * missing.
 */
export const PRIVACY_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const SPEC: SignedLinkSpec = { purpose: "privacy", keyContext: "privacy-link:v1" };

/** The derived key, exported so a proof can forge a token for another purpose. */
export function privacySigningKey(secret: string): Buffer {
  return deriveSignedLinkKey(secret, SPEC.keyContext);
}

export interface PrivacyTokenInput {
  applicationId: string;
  /** Epoch seconds. Injected so a proof can pin the clock. */
  now?: number;
  secret?: string;
  ttlSeconds?: number;
}

/**
 * `v1.<body>.<signature>`.
 *
 * The version carries the context, so a future change can mint `v2` links while
 * `v1` links in old mailboxes keep verifying — or stop, deliberately, by
 * refusing the old version. It is not a place to smuggle key material.
 */
export function mintPrivacyToken(input: PrivacyTokenInput): string {
  const applicationId = input.applicationId?.trim();
  if (!applicationId) throw new Error("A privacy link needs an application id.");
  return mintSignedLink({
    spec: SPEC,
    payload: { a: applicationId },
    ttlSeconds: input.ttlSeconds ?? PRIVACY_LINK_TTL_SECONDS,
    now: input.now,
    secret: input.secret ?? configuredLinkSecret("a privacy link"),
  });
}

export type PrivacyTokenResult =
  | { ok: true; applicationId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

/**
 * A bad token is a reason, never an exception.
 *
 * The page calls this on whatever arrived in the query string, so the contract
 * is total: every input, including a number or an object, comes back as one of
 * three reasons.
 */
export function verifyPrivacyToken(
  token: unknown,
  options: { now?: number; secret?: string } = {}
): PrivacyTokenResult {
  const verified = verifySignedLink({
    token,
    spec: SPEC,
    now: options.now,
    secret: options.secret ?? configuredLinkSecret("a privacy link"),
  });
  if (!verified.ok) return verified;

  const applicationId = verified.payload.a;
  if (typeof applicationId !== "string" || applicationId.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, applicationId, expiresAt: verified.expiresAt };
}

/** The public page's address, carrying the token. A blank origin is relative. */
export function privacyLink(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/privacy?token=${encodeURIComponent(token)}`;
}
