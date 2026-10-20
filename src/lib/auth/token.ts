import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed token that replaces GoTrue's. Same shape as the JWTs the ported
 * policies already read — `sub` for the auth user, `role` for the Postgres role
 * PostgREST switches into — but minted and verified here, with our own secret.
 *
 * HS256 on purpose: PostgREST reads PGRST_JWT_SECRET as a symmetric secret and
 * this file must produce a token it accepts, so an asymmetric algorithm would
 * need a different PostgREST configuration and a second key management story.
 */

const ISSUER = "sharm-dreams-local";
const AUDIENCE = "sdg_local";

/** The longest lifetime this module will sign. A staff session is bounded by the
 * idle-timeout layer, so a token that outlives a day is not a legitimate request,
 * it is a misread `AUTH_TOKEN_TTL_SECONDS` — and the misread is silent unless the
 * minter refuses it. See `validTtl`. */
const MAX_TTL_SECONDS = 86_400;

export type TokenRole = "anon" | "authenticated" | "service_role";

export interface Claims {
  sub: string;
  role: TokenRole;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

class TokenConfigError extends Error {}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET ?? "";
  if (s.length < 32) {
    throw new TokenConfigError(
      "AUTH_JWT_SECRET is missing or shorter than 32 characters. It must equal " +
        "PGRST_JWT_SECRET in the Compose stack — see docker/.env.example."
    );
  }
  return s;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/**
 * `AUTH_TOKEN_TTL_SECONDS` arrives as a string, so a typo is not a smaller
 * session, it is no session limit at all: `Number("abc")` is NaN, and a claims
 * object with `exp: now + NaN` serialises to `"exp":null`, which PostgREST
 * accepts as a token that never expires (measured on the gateway — a null-`exp`
 * token signed with the real secret reads back the staff rows). Nothing else in
 * this module can notice, because a null `exp` is a perfectly well-signed token.
 */
function validTtl(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TTL_SECONDS) {
    throw new TokenConfigError(
      `token lifetime must be a whole number of seconds from 1 to ${MAX_TTL_SECONDS}, got ${String(value)}`
    );
  }
  return n;
}

export async function mintSessionToken(
  input: { sub: string; role: TokenRole },
  ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 900)
): Promise<string> {
  const ttl = validTtl(ttlSeconds);
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: input.sub,
    role: input.role,
    aud: AUDIENCE,
    iss: ISSUER,
    iat: now,
    exp: now + ttl,
  });
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** A minted service-role token is the only way a background job bypasses RLS,
 * so it has no cookie and never leaves the process that made it. */
export async function mintServiceToken(ttlSeconds = 60): Promise<string> {
  return mintSessionToken({ sub: "00000000-0000-0000-0000-000000000000", role: "service_role" }, ttlSeconds);
}

export async function verifySessionToken(token: string | undefined | null): Promise<Claims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  try {
    // Reject an algorithm swap before trusting anything in the header: a token
    // that says alg=none is not a token, it is a request to be let in.
    const head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (head.alg !== "HS256") return null;

    // Compared as the base64url TEXT it arrived in, not as decoded bytes, and
    // that is the stricter choice: decoding both sides would accept non-canonical
    // signatures (`+`, `/`, a padding char) that re-encode to the same 32 bytes,
    // making this verifier looser than the PostgREST it has to agree with. Do not
    // "fix" this to compare bytes.
    const expected = Buffer.from(sign(`${header}.${body}`));
    const actual = Buffer.from(signature);
    // Without this length guard, timingSafeEqual throws on a short signature.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    const now = Math.floor(Date.now() / 1000);
    // Every check is inside the try on purpose. This function's contract is that
    // a bad token is a `null` and never an exception — Task 13's proxy calls it on
    // every request, and a throw there is a 500 on the whole portal. A body that
    // decodes to `null` would make the reads below throw, so they are caught here
    // instead of guarded one by one. `Number.isInteger` is what kills both a null
    // `exp` (a never-expiring token) and `Infinity` (the same thing wearing a
    // number), which a `typeof === "number"` test passes.
    if (!Number.isInteger(claims.exp) || claims.exp <= now) return null;
    if (!Number.isInteger(claims.iat)) return null;
    if (claims.aud !== AUDIENCE || claims.iss !== ISSUER) return null;
    if (claims.role !== "authenticated" && claims.role !== "anon" && claims.role !== "service_role") {
      return null;
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
    return claims;
  } catch {
    return null;
  }
}
