/* scripts/prove-token-shape.mjs — Run: node --env-file=docker/.env scripts/prove-token-shape.mjs */
import { createHmac } from "node:crypto";
import { mintSessionToken, verifySessionToken } from "../src/lib/auth/token.ts";

const UID = "11111111-1111-1111-1111-111111111111";
const t = await mintSessionToken({ sub: UID, role: "authenticated" });
const c = await verifySessionToken(t);
if (!c || c.sub !== UID || c.role !== "authenticated") throw new Error("round trip failed");
if (c.exp - c.iat !== 900) throw new Error(`default lifetime is ${c.exp - c.iat}, expected 900`);
if (await verifySessionToken(t.slice(0, -2) + "xx")) throw new Error("tampered token accepted");
if (await verifySessionToken(null)) throw new Error("null accepted");
const unsigned = t.split(".");
if (await verifySessionToken(`${unsigned[0]}.${unsigned[1]}`)) throw new Error("two-part token accepted");

// A misread lifetime must fail HERE, loudly. `Number("abc")` is NaN and
// `JSON.stringify({exp: now + NaN})` is `"exp":null`, which PostgREST reads as
// *no expiry at all* — measured: a null-exp token signed with the real secret
// is accepted and the staff rows come back. Every value below is a plausible
// typo in AUTH_TOKEN_TTL_SECONDS, so the guard is asserted through the env var
// rather than only through the explicit argument.
for (const bad of ["", "abc", "0", "-5", "1.5", "Infinity", "1e18"]) {
  process.env.AUTH_TOKEN_TTL_SECONDS = bad;
  let threw = false;
  try {
    await mintSessionToken({ sub: UID, role: "authenticated" });
  } catch (e) {
    threw = e instanceof Error && /lifetime/.test(e.message);
  }
  if (!threw) throw new Error(`ttl ${JSON.stringify(bad)} minted a token instead of throwing`);
}
delete process.env.AUTH_TOKEN_TTL_SECONDS;

// The guards on the VERIFY side are fenced here too, because they were not: when
// this probe was mutation-tested against copies of the module with each verify
// guard removed one at a time (`exp` back to a `typeof` test, the `iat` line
// deleted, the `catch` dropped), it stayed green. A mint-side typo is caught by
// the loop above; a regression of the refusal logic below would have been
// invisible. Each body is hand-written JSON so a shape `JSON.stringify` cannot
// produce is still testable — `1e999` parses to `Infinity`, while the JS value
// `Infinity` serialises to `null`. Signing them is the module's own job in
// reverse, so this is the only place in the plan that uses `createHmac` directly.
const HEAD = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const seal = (bodyJson) => {
  const b = Buffer.from(bodyJson).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_JWT_SECRET).update(`${HEAD}.${b}`).digest("base64url");
  return `${HEAD}.${b}.${sig}`;
};
const NOW = Math.floor(Date.now() / 1000);
const CLAIMS = `"sub":"${UID}","role":"authenticated","aud":"sdg_local","iss":"sharm-dreams-local"`;
for (const [name, json] of [
  ["exp null", `{${CLAIMS},"iat":${NOW},"exp":null}`],
  ["exp 1e999", `{${CLAIMS},"iat":${NOW},"exp":1e999}`],
  ["exp absent", `{${CLAIMS},"iat":${NOW}}`],
  ["iat absent", `{${CLAIMS},"exp":${NOW + 900}}`],
  ["iat null", `{${CLAIMS},"iat":null,"exp":${NOW + 900}}`],
  ["iat a string", `{${CLAIMS},"iat":"${NOW}","exp":${NOW + 900}}`],
  ["body decodes to null", "null"],
]) {
  let refused;
  try {
    refused = await verifySessionToken(seal(json));
  } catch (e) {
    throw new Error(`verify refused the ${name} body by THROWING ${String(e)}`);
  }
  if (refused) throw new Error(`${name} token accepted`);
}

// And the same contract one level further out: a value that is not a string at
// all is a refusal, not a `TypeError` escaping into Task 13's proxy. This is why
// `verifySessionToken` takes `unknown` and type-tests before it splits.
for (const junk of [12345, true, {}, [], Buffer.from("x")]) {
  let refused;
  try {
    refused = await verifySessionToken(junk);
  } catch (e) {
    throw new Error(`a non-string token ${String(e)}`);
  }
  if (refused) throw new Error("a non-string was accepted as a token");
}

console.log("PASS token round trip, tamper refusal, null refusal, lifetime guards, verify guards");
