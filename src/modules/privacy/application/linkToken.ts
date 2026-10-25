import { createHmac, timingSafeEqual } from "node:crypto";

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
 */
export const PRIVACY_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const VERSION = "v1";
const PURPOSE = "privacy";
const KEY_CONTEXT = "privacy-link:v1";

function configuredSecret(): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? "").trim();
  if (secret.length < 32) {
    throw new Error(
      "AUTH_JWT_SECRET is missing or shorter than 32 characters, so a privacy link " +
        "cannot be signed. See docker/.env.example."
    );
  }
  return secret;
}

/** The derived key, exported so a proof can forge a token for another purpose. */
export function privacySigningKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_CONTEXT).digest();
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", privacySigningKey(secret)).update(body).digest("base64url");

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
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? PRIVACY_LINK_TTL_SECONDS;
  const secret = input.secret ?? configuredSecret();
  const body = Buffer.from(
    JSON.stringify({ a: applicationId, e: now + ttl, p: PURPOSE })
  ).toString("base64url");
  const signed = `${VERSION}.${body}`;
  return `${signed}.${sign(signed, secret)}`;
}

export type PrivacyTokenResult =
  | { ok: true; applicationId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

/**
 * A bad token is a reason, never an exception.
 *
 * The page calls this on whatever arrived in the query string, so the contract
 * is total: every input, including a number or an object, comes back as one of
 * three reasons. The signature is checked before the body is trusted or even
 * parsed, and the purpose is inside the signed body, so it cannot be added to a
 * token that was minted for something else.
 */
export function verifyPrivacyToken(
  token: unknown,
  options: { now?: number; secret?: string } = {}
): PrivacyTokenResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [version, body, signature] = parts;
  const secret = options.secret ?? configuredSecret();

  try {
    const expected = Buffer.from(sign(`${version}.${body}`, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: "signature" };
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      a?: unknown;
      e?: unknown;
      p?: unknown;
    };
    if (
      payload.p !== PURPOSE ||
      typeof payload.a !== "string" ||
      payload.a.length === 0 ||
      !Number.isInteger(payload.e)
    ) {
      return { ok: false, reason: "malformed" };
    }

    const now = options.now ?? Math.floor(Date.now() / 1000);
    if ((payload.e as number) <= now) return { ok: false, reason: "expired" };
    return { ok: true, applicationId: payload.a, expiresAt: payload.e as number };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** The public page's address, carrying the token. A blank origin is relative. */
export function privacyLink(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/privacy?token=${encodeURIComponent(token)}`;
}
