import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one small signed body the portal puts in a mailed link.
 *
 * A mailed link is a credential that arrives without a session: the privacy door
 * uses one to speak about an application, and the offer door uses one to answer
 * a particular offer. Both need the same three properties, and writing them twice
 * would mean fixing a timing-safe comparison in two places:
 *
 *   - the key is derived from the signing secret with a context of its own, so a
 *     link minted for one door can never be replayed at the other even if the
 *     payload shapes were confused;
 *   - the purpose sits inside the signed body, so it cannot be added to a token
 *     that was minted for something else;
 *   - a bad token is a reason, never an exception — the caller receives whatever
 *     arrived in a query string.
 *
 * The secret is passed in rather than read here: each door names what it could
 * not sign, and that sentence is worth more than one shared error.
 */

export interface SignedLinkSpec {
  /** Written inside the signed body, so a token cannot be replayed elsewhere. */
  purpose: string;
  /** Folded into the derived key, so two doors never share a signing key. */
  keyContext: string;
  /** The `v1` prefix. A future revision can mint v2 while old links keep working. */
  version?: string;
}

export const DEFAULT_SIGNED_LINK_VERSION = "v1";

export type SignedLinkFailure = "malformed" | "signature" | "expired";

export type SignedLinkResult =
  | { ok: true; payload: Record<string, unknown>; expiresAt: number }
  | { ok: false; reason: SignedLinkFailure };

/** The signing secret, or the sentence that says the door cannot sign today. */
export function configuredLinkSecret(what: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? "").trim();
  if (secret.length < 32) {
    throw new Error(
      `AUTH_JWT_SECRET is missing or shorter than 32 characters, so ${what} ` +
        "cannot be signed. See docker/.env.example."
    );
  }
  return secret;
}

/** The derived key, exported so a proof can forge a token for another purpose. */
export function deriveSignedLinkKey(secret: string, keyContext: string): Buffer {
  return createHmac("sha256", secret).update(keyContext).digest();
}

function sign(signed: string, key: Buffer): string {
  return createHmac("sha256", key).update(signed).digest("base64url");
}

/**
 * Mints `v1.<body>.<signature>` for the payload and the spec's purpose.
 *
 * `expiresAt` is stored as epoch seconds under `e` and the purpose under `p`.
 * A payload may use any other short keys; those two are reserved so a caller
 * cannot write a token that verifies as a different kind.
 */
export function mintSignedLink(input: {
  spec: SignedLinkSpec;
  payload: Record<string, unknown>;
  ttlSeconds: number;
  now?: number;
  secret: string;
}): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      ...input.payload,
      e: now + input.ttlSeconds,
      p: input.spec.purpose,
    })
  ).toString("base64url");
  const version = input.spec.version ?? DEFAULT_SIGNED_LINK_VERSION;
  const signed = `${version}.${body}`;
  return `${signed}.${sign(signed, deriveSignedLinkKey(input.secret, input.spec.keyContext))}`;
}

/**
 * What a token says, or why it says nothing.
 *
 * The signature is checked before the body is trusted or even parsed, so a
 * mangled body cannot reach JSON.parse with a shape it was never signed with.
 * A genuine token whose purpose differs is reported as `malformed`: it was not
 * minted for this door, and saying "bad signature" would misdescribe a correctly
 * signed artefact.
 */
export function verifySignedLink(input: {
  token: unknown;
  spec: SignedLinkSpec;
  now?: number;
  secret: string;
}): SignedLinkResult {
  if (typeof input.token !== "string" || input.token.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const version = input.spec.version ?? DEFAULT_SIGNED_LINK_VERSION;
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== version) {
    return { ok: false, reason: "malformed" };
  }

  const [, body, signature] = parts;
  const key = deriveSignedLinkKey(input.secret, input.spec.keyContext);

  try {
    const expected = Buffer.from(sign(`${version}.${body}`, key));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: "signature" };
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (payload.p !== input.spec.purpose || !Number.isInteger(payload.e)) {
      return { ok: false, reason: "malformed" };
    }

    const now = input.now ?? Math.floor(Date.now() / 1000);
    if ((payload.e as number) <= now) return { ok: false, reason: "expired" };
    return { ok: true, payload, expiresAt: payload.e as number };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
