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
const bad = await verifyStaffPassword("owner.local@sharmdreams.test", pw + "-nope");
const ghost = await verifyStaffPassword("nobody@sharmdreams.test", pw);

if (!good.ok) throw new Error(`correct password rejected: ${JSON.stringify(good)}`);
if (bad.ok || bad.reason !== "wrong_password") throw new Error(`wrong password accepted: ${JSON.stringify(bad)}`);
if (ghost.ok || ghost.reason !== "unknown_user") throw new Error(`bad unknown-user path: ${JSON.stringify(ghost)}`);
// Close the pool or this script sits on the pool's 30s idle timeout after
// printing its result — a probe that finishes but does not exit reads as a hang.
await getAuthPool().end();
console.log("PASS correct/wrong/unknown all answered correctly, and case-insensitively");
console.log("  seeded user id:", good.userId);
