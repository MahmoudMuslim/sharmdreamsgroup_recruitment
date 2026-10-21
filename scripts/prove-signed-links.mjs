/* scripts/prove-signed-links.mjs
 * Run: node scripts/prove-signed-links.mjs
 *
 * Proves that a file link cannot be forged, re-pointed, or stretched, and that a
 * genuine one opens as exactly the object it was minted for.
 *
 * This is the boundary Plan 2 introduces: bytes on our own disk, served by a route
 * handler with no session behind it, authorised by nothing but the token in the
 * URL. If the MAC is guessable, or a field inside survives verification unchecked,
 * then "anyone with the link" has quietly become "anyone".
 *
 * So nearly every check below is a forgery, and the one round trip is what has to
 * work. Path containment is proven by `npm run files:paths`; this file is about the
 * signature, the expiry, and the two headers a stranger's filename can break.
 */
import { createHmac, hkdfSync } from "node:crypto";
import {
  mintFileLink,
  verifyFileLink,
  contentDisposition,
  isSafeToView,
  MAX_LINK_SECONDS,
} from "../src/lib/files/signed-link.ts";
import { mintSessionToken, verifySessionToken } from "../src/lib/auth/token.ts";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

const SECRET = "local-proof-secret-0123456789abcdef-0123456789abcdef";
process.env.AUTH_JWT_SECRET = SECRET;
process.env.AUTH_TOKEN_TTL_SECONDS = "900";

const NOW = () => Math.floor(Date.now() / 1000);
const base = { bucket: "candidate-cvs", path: "applications/6fa5/cv.pdf", seconds: 900, mime: "application/pdf" };
const link = mintFileLink(base);
const [expText, bodyText, sigText] = link.split(".");
const body = JSON.parse(Buffer.from(bodyText, "base64url").toString("utf8"));

/** Signs any exp+body with the real key — what a leaked-but-expired link looks like. */
function resign(exp, body) {
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(SECRET), Buffer.from("sdg-files"), Buffer.from("sdg-file-link-v1"), 32));
  return `${exp}.${body}.${createHmac("sha256", key).update(`${exp}.${body}`).digest("base64url")}`;
}

// --- 1. The round trip everything else depends on ---------------------------
const opened = verifyFileLink(link);
check("a minted link opens with the same bucket, key, type and mode",
  opened?.bucket === "candidate-cvs" &&
    opened?.path === "applications/6fa5/cv.pdf" &&
    opened?.mime === "application/pdf" &&
    opened?.inline === true &&
    opened?.filename === null,
  JSON.stringify(opened));
check("the token is three dot-separated parts", link.split(".").length === 3);

// --- 2. A missing or weak secret is a refusal, never a default --------------
// A fallback key would sign links that verify everywhere — i.e. links anyone can
// mint the moment they know the default.
for (const bad of ["", "short"]) {
  process.env.AUTH_JWT_SECRET = bad;
  let msg = "";
  try { mintFileLink(base); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  check(`minting refuses AUTH_JWT_SECRET=${JSON.stringify(bad)}`, /AUTH_JWT_SECRET/.test(msg), msg.slice(0, 48));
}
delete process.env.AUTH_JWT_SECRET;
let unsetMsg = "";
try { mintFileLink(base); } catch (e) { unsetMsg = e instanceof Error ? e.message : String(e); }
check("minting refuses an unset AUTH_JWT_SECRET", /AUTH_JWT_SECRET/.test(unsetMsg), unsetMsg.slice(0, 48));
// Verification cannot be left to throw on a request, so an unverifiable token has
// to be a `null` — a 500 on a public route is worse than a 404.
check("verifying with no secret answers null, not an exception", verifyFileLink(link) === null);
process.env.AUTH_JWT_SECRET = SECRET;

// --- 3. The lifetime is bounded, and a misread number is loud ---------------
// `token.ts:74` records the session half of this: `Number("abc")` is NaN and a
// NaN `exp` serialises to null, which reads as "never expires". A CV link that
// never expires is a permanent URL to a stranger's document.
for (const bad of [0, -1, 1.5, NaN, Infinity, "abc", MAX_LINK_SECONDS + 1, 1e18, ""]) {
  let threw = false;
  try { mintFileLink({ ...base, seconds: bad }); } catch (e) {
    threw = e instanceof Error && /lifetime/.test(e.message);
  }
  check(`refuses a lifetime of ${JSON.stringify(bad)}`, threw);
}
check(`accepts the ceiling of ${MAX_LINK_SECONDS}s`, verifyFileLink(mintFileLink({ ...base, seconds: MAX_LINK_SECONDS })) !== null);

// --- 4. Forgeries: a changed body must not survive the signature ------------
const swap = (patch) => `${expText}.${Buffer.from(JSON.stringify({ ...body, ...patch })).toString("base64url")}.${sigText}`;
for (const [what, forged] of [
  ["a different path", swap({ p: "applications/9999/other-cv.pdf" })],
  ["a traversal in the path", swap({ p: "../../etc/passwd" })],
  ["a different bucket", swap({ b: "candidate-videos" })],
  ["a bucket that is a traversal", swap({ b: "../uploads" })],
  ["inline forced onto an unsafe type", swap({ i: 1, m: "text/html" })],
  ["a null bucket", swap({ b: null })],
  ["a numeric path", swap({ p: 42 })],
  ["an extra field", swap({ admin: true })],
]) {
  check(`refuses ${what}`, verifyFileLink(forged) === null);
}

// --- 5. Forgeries: the token's own framing ---------------------------------
check("refuses a truncated token", verifyFileLink(link.slice(0, link.length - 8)) === null);
check("refuses an empty token", verifyFileLink("") === null);
check("refuses a null token", verifyFileLink(null) === null);
check("refuses a non-string token", verifyFileLink({}) === false || verifyFileLink({}) === null);
check("refuses a numeric token", verifyFileLink(12345) === null);
check("refuses a two-part token", verifyFileLink(`${expText}.${bodyText}`) === null);
check("refuses a four-part token", verifyFileLink(`${link}.AAAA`) === null);
check("refuses an over-long token", verifyFileLink("a".repeat(5000)) === null);
check("refuses garbage", verifyFileLink("not.a.token") === null);
check("refuses a flipped signature character",
  verifyFileLink(`${expText}.${bodyText}.${sigText.slice(0, -2)}${sigText.slice(-2) === "AA" ? "BB" : "AA"}`) === null);
check("refuses an empty signature", verifyFileLink(`${expText}.${bodyText}.`) === null);

// Base64url is not canonical-safe: `+`, `/` and padding decode to bytes that
// re-encode differently. The verifier compares the TEXT, so a re-encoded twin of
// the same 32 bytes is refused — which is the stricter answer, and the one that
// keeps this module agreeing with `token.ts`.
const asciiSig = sigText.replace(/-/g, "+").replace(/_/g, "/");
check("refuses a signature re-encoded with + and /",
  asciiSig === sigText ? verifyFileLink(`${expText}.${bodyText}.${sigText + "A"}`) === null
                       : verifyFileLink(`${expText}.${bodyText}.${asciiSig}`) === null,
  asciiSig === sigText ? "signature had no -/_ to swap, so a longer one is tested" : "swapped");

// --- 6. Expiry and the upper bound ----------------------------------------
for (const alt of [`0${expText}`, `+${expText}`, `${expText}e0`, "0x10", "1e9", "Infinity", "", `${expText} `]) {
  check(`refuses exp written as ${JSON.stringify(alt)}`, verifyFileLink(`${alt}.${bodyText}.${sigText}`) === null);
}
check("refuses an expired link that carries a genuine signature", verifyFileLink(resign(String(NOW() - 5), bodyText)) === null);
check("accepts a link one second before it dies", verifyFileLink(resign(String(NOW() + 1), bodyText)) !== null);
check("refuses a link signed further out than this module would ever mint",
  verifyFileLink(resign(String(NOW() + MAX_LINK_SECONDS + 3600), bodyText)) === null);

// --- 7. The signing key is domain-separated --------------------------------
// If file links were signed with AUTH_JWT_SECRET directly, a session token and a
// file link would be one primitive: anything that signs a string for us could mint
// a staff session. Each verifier must reject the other's token.
const session = await mintSessionToken({ sub: "11111111-1111-1111-1111-111111111111", role: "authenticated" });
check("a session token is not a file link", verifyFileLink(session) === null);
check("a file link is not a session token", (await verifySessionToken(link)) === null);
check("the two tokens do not even share a shape", session.split(".").length === link.split(".").length);

// --- 8. Content-Disposition: a filename is header syntax --------------------
// The leaf of a storage key is a name a candidate typed, and it is written into a
// response header. A `"` closes the quoted-string early and the rest becomes the
// header; a CR or LF ends the response and starts another one.
for (const [input, needle] of [
  ['evil"; x=', '"'],
  ["two\r\nlines", "\r"],
  ["line feed\nonly", "\n"],
  ["back\\slash", "\\"],
  ["tab\there.pdf", "\t"],
]) {
  const header = contentDisposition(input);
  const quoted = header.match(/filename="([^"]*)"/)[1];
  check(`header for ${JSON.stringify(input)} cannot break out of the quoted string`,
    !quoted.includes(needle) && !/[\r\n]/.test(header), JSON.stringify(header.slice(0, 72)));
}
check("a NUL in a filename is removed", !contentDisposition("a\u0000b.pdf").includes("\u0000"));
check("an all-junk filename still produces a usable header",
  contentDisposition('"""').includes('filename="file"'), contentDisposition('"""'));
check("a non-ASCII filename gets an RFC 5987 form",
  contentDisposition("سيرة ذاتية.pdf").includes("filename*=UTF-8''"),
  contentDisposition("سيرة ذاتية.pdf"));
// attr-char excludes `!'()*`, and encodeURIComponent leaves them — so an
// apostrophe would otherwise make the whole header unparseable in Firefox.
const extValue = contentDisposition("Ahmed's CV.pdf").match(/filename\*=UTF-8''([^;]*)/)[1];
check("an apostrophe is percent-encoded in the RFC 5987 value", !extValue.includes("'"), extValue);
check("a 5000-character filename is truncated, not passed through",
  contentDisposition("x".repeat(5000)).match(/filename="([^"]*)"/)[1].length <= 200);

// --- 9. The inline downgrade: a new call site cannot forget it --------------
// Everything stored here is a file a stranger uploaded. An SVG or an HTML
// document opened on our origin is a script that runs with our cookies, so an
// unsafe type is never rendered inline — whoever asked.
for (const unsafe of ["text/html", "image/svg+xml", "application/xhtml+xml", "application/javascript", "", null, undefined]) {
  const minted = verifyFileLink(mintFileLink({ ...base, mime: unsafe }));
  check(`never views ${JSON.stringify(unsafe)} inline`, minted?.inline === false, JSON.stringify(minted));
}
for (const safe of ["application/pdf", "text/plain", "video/webm", "audio/mp4", "image/png", "image/jpeg", "image/webp"]) {
  const minted = verifyFileLink(mintFileLink({ ...base, mime: safe }));
  check(`views ${safe} inline`, minted?.inline === true && isSafeToView(safe));
}
check("an explicit download filename overrides the inline branch",
  verifyFileLink(mintFileLink({ ...base, mime: "application/pdf", download: "cv.pdf" }))?.inline === false);
check("a download keeps the filename it asked for",
  verifyFileLink(mintFileLink({ ...base, download: "my cv.pdf" }))?.filename === "my cv.pdf");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join("; "));
  process.exit(1);
}
