/* scripts/prove-password-verify.mjs — Run: node scripts/prove-password-verify.mjs
 * Reads the fixture password from docker/.env and never prints it. */
import { readFileSync } from "node:fs";
import { getAuthPool } from "../src/lib/auth/db.ts";
import { verifyStaffPassword } from "../src/lib/auth/passwords.ts";

const env = Object.fromEntries(
  readFileSync("docker/.env", "utf8")
    .split(/\r?\n/)
    .map((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); return m ? [m[1], m[2].trim()] : null; })
    .filter(Boolean)
);
process.env.AUTH_DB_URL = env.AUTH_DB_URL;
const pw = env.LOCAL_STAFF_PASSWORD;

const good = await verifyStaffPassword("owner.local@sharmdreams.test", pw);
// Mixed case because that is what a typing human produces, and because this is
// the only call that exercises normalisation: deleting `.trim().toLowerCase()`
// makes this call answer `unknown_user` and the probe goes red (measured). It
// deliberately does *not* cover the SQL `lower(email)` — every fixture email is
// stored in lower case, so losing only that half still passes. The two guards
// are redundant on purpose; say so instead of letting the PASS line imply a
// coverage the fixtures cannot give (adding a mixed-case fixture is Plan 2 work).
const badStart = performance.now();
const bad = await verifyStaffPassword("Owner.Local@SharmDreams.test", pw + "-nope");
const badMs = performance.now() - badStart;
const ghostStart = performance.now();
const ghost = await verifyStaffPassword("nobody@sharmdreams.test", pw);
const ghostMs = performance.now() - ghostStart;

if (!good.ok) throw new Error(`correct password rejected: ${JSON.stringify(good)}`);
if (bad.ok || bad.reason !== "wrong_password") throw new Error(`wrong password accepted: ${JSON.stringify(bad)}`);
if (ghost.ok || ghost.reason !== "unknown_user") throw new Error(`bad unknown-user path: ${JSON.stringify(ghost)}`);
// The unknown-user path only defends against email enumeration while it
// actually pays for a hash round, and its return value cannot show that: with
// the equalising query deleted the path still answers `unknown_user`. Measured
// through this pool on the local container — one cost-10 bcrypt round takes a
// call to ~50 ms and the bare lookup answers in ~4 ms — so the unknown path is
// compared against *the same run's* wrong-password path. A fixed millisecond
// threshold would only mis-time a loaded machine; this ratio absorbs it.
if (ghostMs < badMs / 3) {
  throw new Error(`unknown-user path answered in ${ghostMs.toFixed(1)}ms against a ${badMs.toFixed(1)}ms hash round — the timing-equalising round is gone`);
}
// Close the pool or this script sits on the pool's 30s idle timeout after
// printing its result — a probe that finishes but does not exit reads as a hang.
await getAuthPool().end();
console.log("PASS correct/wrong/unknown answered correctly, a mixed-case login normalised to the right row, and the unknown-user path paid for a hash round");
console.log(`  seeded user id: ${good.userId} | wrong-password ${badMs.toFixed(1)}ms, unknown-user ${ghostMs.toFixed(1)}ms`);
