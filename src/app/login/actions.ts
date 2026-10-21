"use server";

import { endSession, startSession } from "@/lib/auth/cookies";
import { verifyStaffPassword } from "@/lib/auth/passwords";

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
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
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
  const hit = failures.get(key);
  if (!hit || Date.now() - hit.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  failures.set(key, { count: hit.count + 1, firstAt: hit.firstAt });
}

/** Same-origin relative targets only; mirrors LoginForm's existing guard. */
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

  const result = await verifyStaffPassword(email, password);
  if (!result.ok) {
    recordFailure(email);
    await endSession();
    return {
      ok: false,
      error:
        result.reason === "banned"
          ? "This account is disabled. Ask a super admin to re-enable it."
          : "That email and password do not match our records.",
    };
  }

  failures.delete(email);
  await startSession(result.userId);
  return { ok: true, next };
}

export async function signOutAction(): Promise<void> {
  await endSession();
}
