/* scripts/prove-token-shape.mjs — Run: node scripts/prove-token-shape.mjs */
import { mintSessionToken, verifySessionToken } from "../src/lib/auth/token.ts";

const t = await mintSessionToken({ sub: "11111111-1111-1111-1111-111111111111", role: "authenticated" });
const c = await verifySessionToken(t);
if (!c || c.sub !== "11111111-1111-1111-1111-111111111111" || c.role !== "authenticated")
  throw new Error("round trip failed");
if (await verifySessionToken(t.slice(0, -2) + "xx")) throw new Error("tampered token accepted");
if (await verifySessionToken(null)) throw new Error("null accepted");
console.log("PASS token round trip, tamper refusal, null refusal");
