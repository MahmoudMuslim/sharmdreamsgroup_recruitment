"use server";

import { endSession, startSession } from "@/lib/auth/cookies";
import { verifyStaffPassword } from "@/lib/auth/passwords";

// `SESSION_TTL_SECONDS` in `src/lib/auth/cookies.ts` deliberately overrides the
// operator-facing `AUTH_TOKEN_TTL_SECONDS` that `src/lib/auth/token.ts:70` reads
// as its default, so a staff session's bearer does not follow that variable.

export interface SignInState {
  ok: boolean;
  error?: string;
  next?: string;
}

/**
 * Brute-force floor.
 *
 * An in-process counter is enough here and nothing more: the app runs as one
 * container, bcrypt at cost 10 makes each attempt ~250 ms, and the vendor's
 * rate limiter is gone the moment we cut over. If this app is ever run as
 * several replicas, this map stops being authoritative and belongs in the
 * database — that is a Plan 2 concern, not a reason to build one now.
 *
 * Two properties to state plainly. It is keyed by the submitted email, so one
 * victim address can be locked out for up to `WINDOW_MS` by someone else's
 * failures; that is accepted for this deployment, and said here so nobody
 * mistakes this counter for a security control. And the key is
 * `String(formData.get("email"))` — a server-side attacker-chosen string, with
 * `unknown_user` a legitimate outcome — so the map is both swept for expired
 * windows and capped, or a long-lived container grows without bound.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_TRACKED_KEYS = 1000;
const failures = new Map<string, { count: number; firstAt: number }>();

function throttled(key: string): boolean {
  const hit = failures.get(key);
  if (!hit) return false;
  if (Date.now() - hit.firstAt > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return hit.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  // Every failure sweeps the expired entries first: a key that is never retried
  // would otherwise sit here forever, since the only other eviction paths are a
  // repeat of the same key after the window and a successful login.
  for (const [tracked, hit] of failures) {
    if (now - hit.firstAt > WINDOW_MS) failures.delete(tracked);
  }
  const hit = failures.get(key);
  if (!hit || now - hit.firstAt > WINDOW_MS) {
    if (failures.size >= MAX_TRACKED_KEYS) {
      // Full of live windows: make room by dropping the oldest window.
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [tracked, entry] of failures) {
        if (entry.firstAt < oldestAt) {
          oldestAt = entry.firstAt;
          oldestKey = tracked;
        }
      }
      if (oldestKey !== null) failures.delete(oldestKey);
    }
    failures.set(key, { count: 1, firstAt: now });
    return;
  }
  failures.set(key, { count: hit.count + 1, firstAt: hit.firstAt });
}

/** Same-origin relative targets only. Moved here from `LoginForm.tsx`, which no
 * longer guards it client-side, so this is the only gate before the
 * `window.location.assign` in that component. */
function safeRedirectTarget(raw: unknown): string {
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export async function signInAction(formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectTarget(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: "Enter your work email and password." };
  }
  if (throttled(email)) {
    return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  }

  // Charge the attempt *before* the await. `verifyStaffPassword` is ~250 ms of
  // bcrypt, so charging afterwards let a concurrent burst of N requests all read
  // an under-limit map and all reach the verifier — with the vendor's limiter
  // gone this counter is the only floor. A successful sign-in and the `banned`
  // answer below both release the pre-charge, so only a missed guess spends it.
  recordFailure(email);

  const result = await verifyStaffPassword(email, password);
  if (!result.ok) {
    if (result.reason === "banned") {
      // The password compared true to reach this reason (`passwords.ts:48-49`),
      // so no guessing budget was spent — release the pre-charge, or the eighth
      // attempt shows "Too many attempts" and buries the sentence below.
      failures.delete(email);
      // The only failed sign-in that tears the session down: a valid credential
      // for a disabled account must not leave a live bearer standing. A wrong
      // password must not destroy the live session of, say, a recruiter trying a
      // second account — they would lose `sdg_session` and the idle clock with no
      // feedback explaining why.
      await endSession();
      return {
        ok: false,
        error: "This account is disabled. Ask a super admin to re-enable it.",
      };
    }
    return { ok: false, error: "That email and password do not match our records." };
  }

  failures.delete(email);
  await startSession(result.userId);
  return { ok: true, next };
}

export async function signOutAction(): Promise<void> {
  await endSession();
}
