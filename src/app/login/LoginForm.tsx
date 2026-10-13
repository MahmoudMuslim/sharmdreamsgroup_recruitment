"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { SdgMark } from "@/modules/analytics/presentation/BrandLogo";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Only same-origin relative paths are followed after sign-in. */
function safeRedirectTarget(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeRedirectTarget(searchParams.get("next"));
  const oauthError = searchParams.get("error");
  const idleSignOut = searchParams.get("reason") === "idle";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleEmailPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }

    window.location.assign(next);
  }

  async function handleGoogleOAuth() {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: oauthFailure } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (oauthFailure) setError(oauthFailure.message);
  }

  const fieldClass =
    "w-full rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white focus:outline-none";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-ivory px-4 py-12">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 top-[-10%] h-[460px] w-[460px] rounded-full bg-brand-gold/20 blur-[130px]" />
        <div className="absolute -bottom-32 -right-24 h-[460px] w-[460px] rounded-full bg-brand-gold/10 blur-[130px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-7 text-center">
          <SdgMark size={56} className="mx-auto mb-4 shadow-lift" />
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Recruiter sign-in</h1>
          <p className="mt-1 text-sm text-brand-ink/55">
            Sharm Dreams Talent Cloud — authorised staff only
          </p>
        </div>

        <div className="rounded-2xl border border-brand-line bg-white p-6 shadow-lift sm:p-7">
          {idleSignOut && (
            <p
              role="status"
              className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink/70"
            >
              You were signed out after a period of inactivity. Sign in again to
              continue.
            </p>
          )}

          {oauthError && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              Single sign-on failed. Please try again or use your password.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleGoogleOAuth()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-5 py-3 text-sm font-semibold text-brand-ink transition hover:bg-brand-sand"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Continue with Google (OAuth 2.0)
          </button>

          <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-brand-ink/35">
            <span className="h-px flex-1 bg-brand-line" aria-hidden />
            or use your work email
            <span className="h-px flex-1 bg-brand-line" aria-hidden />
          </div>

          <form onSubmit={handleEmailPassword} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-brand-ink/45"
              >
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder="you@sharmdreams.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-brand-ink/45"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-3 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden />
              )}
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-brand-ink/45">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" aria-hidden />
          Sessions are protected by Row Level Security. Candidates never receive staff access,
          and every admin query is scoped to your company and role.
        </p>

        <p className="mt-4 text-center text-xs text-brand-ink/50">
          Are you a candidate?{" "}
          <a href="/portal" className="font-semibold text-brand-gold-dark hover:underline">
            Track your application
          </a>
        </p>
      </div>
    </main>
  );
}