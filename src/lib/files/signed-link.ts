/* src/lib/files/signed-link.ts
 * The link that replaces the vendor's signed storage URL.
 *
 * A short-lived bearer of exactly one file: the token is the authority, it
 * carries the bucket, the key, the disposition and the content type, and it dies
 * on its own. Nothing about a *session* travels in it — the minting site has
 * already decided that the caller may open this file, and the route that reads
 * it back authorises nothing except "this token is genuine and alive".
 *
 * That is the same security model `storage.createSignedUrl` gave us, so the five
 * call sites that mint links keep working when `store.ts` changes underneath
 * them. What it deliberately is not: a permission check, a cookie, or a long-lived
 * asset URL.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
/* The `.ts` extension is load-bearing, not style: `npm run files:links` imports
 * this file through plain Node, whose ESM resolver does not guess extensions the
 * way `moduleResolution: "bundler"` lets tsc and Next do. Same rule as
 * `src/lib/rest/client.ts`, and `allowImportingTsExtensions` is already on. */
import { isBucketName, isStoredPath } from "./paths.ts";

/**
 * The longest link this module will sign.
 *
 * Every real caller asks for 15 or 60 minutes: a staff panel mints a link the
 * browser opens immediately, so anything longer is not a legitimate request, it
 * is a misread number — and a link to a candidate's CV that outlives the shift
 * that opened it is a leak with a deadline nobody set.
 */
export const MAX_LINK_SECONDS = 3_600;

/** Domain separation for the signing key. See `linkKey` for why not the raw secret. */
const KEY_INFO = "sdg-file-link-v1";

class LinkConfigError extends Error {}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET ?? "";
  if (s.length < 32) {
    throw new LinkConfigError(
      "AUTH_JWT_SECRET is missing or shorter than 32 characters. File links are " +
        "signed with a key derived from it — see docker/.env.example."
    );
  }
  return s;
}

/**
 * A derived key, never `AUTH_JWT_SECRET` itself.
 *
 * The session token in `src/lib/auth/token.ts` is an HS256 signature over that
 * secret, and PostgREST verifies the same secret. Signing file links with it too
 * would make one HMAC primitive serve two verifiers, so any place that will sign
 * an arbitrary string for us — a future debug endpoint, a test helper, a feature
 * that echoes a signature — can mint a staff session as easily as a file link.
 * HKDF with a fixed info string means the two keys are different even though the
 * one secret is what an operator has to manage and rotate.
 *
 * Derived per call rather than cached at module scope: `next build` imports every
 * route module with no environment, and a `hkdfSync` at import time is a throw
 * during the build.
 */
function linkKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret()), Buffer.from("sdg-files"), Buffer.from(KEY_INFO), 32));
}

export interface FileLink {
  bucket: string;
  path: string;
  /** True when the reader should get the bytes inline, false when saved to disk. */
  inline: boolean;
  /** The filename offered for a download, already sanitised for a header. */
  filename: string | null;
  /** The content type the row held when this link was minted. */
  mime: string | null;
}

const b64u = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const mac = (exp: string, body: string) =>
  createHmac("sha256", linkKey()).update(`${exp}.${body}`).digest("base64url");

/**
 * Formats the value that lives behind `inline === false`.
 *
 * The filename comes from a storage key, and a storage key's leaf is a name a
 * candidate typed. So it is written into a response header, which is where a
 * name becomes dangerous: a `"` closes the quoted-string early and the rest of
 * the string is the header, a CR or LF ends the response and starts a second
 * one, and a `\` is an escape inside a quoted-string — `a\"` would swallow the
 * closing delimiter and let the remainder be parsed as syntax. All three are
 * stripped here, and the non-ASCII form is the RFC 5987 percent encoding rather
 * than raw UTF-8 for the same reason. No real upload has ever had a backslash in
 * its name, because no filesystem that produced one allows it.
 */
export function contentDisposition(filename: string): string {
  const cleaned = filename.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim();
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_").slice(0, 200) || "file";
  // `encodeURIComponent` leaves `!'()*`, and RFC 5987's attr-char does not: a
  // filename with an apostrophe would otherwise make the whole header unparseable.
  const ext = encodeURIComponent(cleaned || "file").replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${ext}`;
}

/**
 * The only content types a browser may render inside this origin.
 *
 * Everything stored here is a file a stranger uploaded, and an SVG or an HTML
 * document opened on our origin is a script that runs with our cookies. So a
 * link minted for inline viewing is silently downgraded to a download when the
 * row's type is not on this list — the caller does not have to remember the rule,
 * and a new call site cannot forget it.
 */
const VIEW_SAFE = /^(application\/pdf|text\/plain|video\/|audio\/|image\/(png|jpe?g|gif|webp|avif)$)/i;

export function isSafeToView(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && VIEW_SAFE.test(mimeType.trim());
}

/**
 * Signs a link to exactly one object for exactly one way of opening it.
 *
 * Throws rather than returning null on a bad *argument*: a caller that asks for a
 * 48-hour link or hands a `..` in the path has a bug in the code that called this,
 * and the failure belongs at that call site, not in a browser three redirects
 * later. The runtime conditions that are genuinely data — a missing file, a row
 * without a mime — are the store's business, not the signer's.
 */
export function mintFileLink(input: {
  bucket: string;
  path: string;
  seconds: number;
  download?: string;
  mime?: string | null;
}): string {
  const seconds = Number(input.seconds);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_LINK_SECONDS) {
    throw new LinkConfigError(
      `link lifetime must be a whole number of seconds from 1 to ${MAX_LINK_SECONDS}, got ${String(input.seconds)}`
    );
  }
  if (!isBucketName(input.bucket)) throw new LinkConfigError(`"${input.bucket}" is not a bucket name.`);
  if (!isStoredPath(input.path)) throw new LinkConfigError(`"${input.path}" is not a storage key.`);

  const inline = input.download === undefined && isSafeToView(input.mime);
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const expText = String(exp);
  const body = b64u({
    b: input.bucket,
    p: input.path,
    i: inline ? 1 : 0,
    n: inline ? null : (input.download ?? null),
    m: input.mime ?? null,
  });
  return `${expText}.${body}.${mac(expText, body)}`;
}

/**
 * `null` for anything that is not a live, genuine link to a well-formed object.
 *
 * Never an exception: this sits on a public route, so a malformed token is a
 * normal event — an expired link someone clicked from an old tab, a truncated URL
 * a chat client rewrote, a scanner trying combinations. A throw here is a 500 and
 * a stack trace about somebody's typo.
 */
export function verifyFileLink(token: unknown): FileLink | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expText, body, signature] = parts;

  try {
    const exp = Number(expText);
    // `Number("1e9")` is finite and `Number("0x10")` is 16, so the round trip is
    // what makes this segment canonical: `expText` must be the only way to write
    // that number, or the token was assembled rather than minted.
    if (!Number.isInteger(exp) || String(exp) !== expText) return null;
    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) return null;
    // Bounded on the way in as well as the way out. The minter refuses to sign
    // longer than `MAX_LINK_SECONDS`, so a link that claims a further date was not
    // minted by this module even if its MAC is genuine — which is the shape of a
    // forged-by-a-leaked-key link or of a build whose ceiling drifted. Refusing it
    // costs nothing: no legitimate caller ever asks for it.
    if (exp > now + MAX_LINK_SECONDS) return null;

    // Compared as base64url TEXT, not decoded bytes — the stricter choice, and the
    // one `token.ts:137` records for the session verifier. Decoding both sides
    // would accept non-canonical signatures that re-encode to the same 32 bytes.
    const expected = Buffer.from(mac(expText, body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      b?: unknown;
      p?: unknown;
      i?: unknown;
      n?: unknown;
      m?: unknown;
    };
    // A signature alone proves nothing about the *shape* inside: it only proves we
    // signed it. Re-check the same two rules the minter applied, so a token minted
    // by an older build cannot ask this route for a path it would never sign.
    if (typeof raw.b !== "string" || typeof raw.p !== "string") return null;
    if (!isBucketName(raw.b) || !isStoredPath(raw.p)) return null;

    const inline = raw.i === 1;
    if (!inline && raw.i !== 0) return null;
    if (typeof raw.n !== "string" && raw.n !== null) return null;
    if (raw.n !== null && (raw.n.length === 0 || raw.n.length > 255)) return null;
    if (typeof raw.m !== "string" && raw.m !== null) return null;

    return {
      bucket: raw.b,
      path: raw.p,
      inline,
      filename: inline ? null : ((raw.n as string | null) ?? null),
      mime: typeof raw.m === "string" && raw.m.length > 0 ? raw.m : null,
    };
  } catch {
    return null;
  }
}
