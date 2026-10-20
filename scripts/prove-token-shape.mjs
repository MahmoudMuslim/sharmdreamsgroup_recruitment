/* scripts/prove-token-shape.mjs — Run: node --env-file=docker/.env scripts/prove-token-shape.mjs */
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
console.log("PASS token round trip, tamper refusal, null refusal, lifetime guards");
