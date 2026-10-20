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

export async function mintSessionToken(
  input: { sub: string; role: TokenRole },
  ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 900)
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: input.sub,
    role: input.role,
    aud: AUDIENCE,
    iss: ISSUER,
    iat: now,
    exp: now + ttlSeconds,
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

  let claims: Claims;
  try {
    // Reject an algorithm swap before trusting anything in the header: a token
    // that says alg=none is not a token, it is a request to be let in.
    const head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (head.alg !== "HS256") return null;

    const expected = Buffer.from(sign(`${header}.${body}`));
    const actual = Buffer.from(signature);
    // Without this length guard, timingSafeEqual throws on a short signature.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (claims.aud !== AUDIENCE || claims.iss !== ISSUER) return null;
  if (claims.role !== "authenticated" && claims.role !== "anon" && claims.role !== "service_role") {
    return null;
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  return claims;
}
