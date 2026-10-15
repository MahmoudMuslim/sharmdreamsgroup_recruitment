"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { createUser } from "@/modules/settings/application/user-actions";
import { Button } from "@/modules/analytics/presentation/ui";
import { CredentialReveal } from "./CredentialReveal";
import { ASSIGNABLE_STAFF_ROLES } from "@/modules/settings/domain/schema";
import { cn } from "@/lib/utils";
import type { AssignableStaffRole, Company } from "@/modules/settings/domain/types";

interface UserCreatePanelProps {
  companies: Company[];
  passwordMinLength: number;
  onSuccess: () => void;
  onClose: () => void;
  open: boolean;
}

export function UserCreatePanel({
  companies,
  passwordMinLength,
  onSuccess,
  onClose,
  open,
}: UserCreatePanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"invite" | "direct">("invite");
  const [draft, setDraft] = useState({
    email: "",
    full_name: "",
    role: "RECRUITER" as AssignableStaffRole,
    company_id: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = formRef.current?.querySelector<HTMLInputElement>("input");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function editField(name: string, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
    if (name === "password") setCredential(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCredential(null);

    const payload = {
      email: draft.email.trim().toLowerCase(),
      full_name: draft.full_name.trim(),
      role: draft.role,
      company_id: draft.company_id || null,
      send_invite: mode === "invite",
      password: mode === "direct" ? draft.password : undefined,
    };

    if (!payload.email || !payload.full_name) {
      setError("Email and full name are required.");
      return;
    }

    setPending(true);
    try {
      const result = await createUser(payload);
      if (result.ok) {
        setSaved(true);
        if (result.temp_password) {
          // The panel has to stay open: this is the only time the generated
          // password exists anywhere the inviter can read it.
          setCredential(result.temp_password);
          return;
        }
        setTimeout(() => {
          onClose();
          onSuccess();
        }, 650);
      } else {
        setError(result.error ?? "Could not create user.");
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="user-panel-title">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
      />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-brand-line bg-white shadow-2xl",
          "animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-line p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
              Team
            </p>
            <h3 id="user-panel-title" className="mt-0.5 truncate font-display text-lg font-bold">
              {mode === "invite" ? "Invite team member" : "Add team member directly"}
            </h3>
            <p className="mt-1 text-xs text-brand-ink/50">
              {mode === "invite"
                ? "Records the invite under Pending invites — the platform sends no email, so nothing reaches them until you create the account."
                : "Sets their password now, or generates one you can copy — share it securely."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {/* Mode switch */}
          <div className="mb-4 rounded-xl border border-brand-line bg-brand-cream p-2">
            <div className="flex" role="radiogroup" aria-label="Creation mode">
              <label className="flex-1 flex items-center justify-center">
                <input
                  type="radio"
                  name="mode"
                  value="invite"
                  checked={mode === "invite"}
                  onChange={() => setMode("invite")}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "w-full py-2 text-center text-sm font-semibold rounded-lg transition",
                    mode === "invite"
                      ? "bg-brand-gold text-brand-on-accent"
                      : "text-brand-ink/60 hover:bg-white"
                  )}
                >
                  Record invite
                </span>
              </label>
              <label className="flex-1 flex items-center justify-center">
                <input
                  type="radio"
                  name="mode"
                  value="direct"
                  checked={mode === "direct"}
                  onChange={() => setMode("direct")}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "w-full py-2 text-center text-sm font-semibold rounded-lg transition",
                    mode === "direct"
                      ? "bg-brand-gold text-brand-on-accent"
                      : "text-brand-ink/60 hover:bg-white"
                  )}
                >
                  Create directly
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="user-email" className="mb-1.5 block text-xs font-bold">
                Email <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="user-email"
                name="email"
                type="email"
                value={draft.email}
                required
                autoComplete="email"
                onChange={(e) => editField("email", e.target.value)}
                className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="user-name" className="mb-1.5 block text-xs font-bold">
                Full name <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="user-name"
                name="full_name"
                type="text"
                value={draft.full_name}
                required
                autoComplete="name"
                onChange={(e) => editField("full_name", e.target.value)}
                className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="user-role" className="mb-1.5 block text-xs font-bold">
                Role <span className="ml-1 text-rose-600">*</span>
              </label>
              <select
                id="user-role"
                name="role"
                value={draft.role}
                required
                onChange={(e) => editField("role", e.target.value as typeof draft.role)}
                className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
              >
                {ASSIGNABLE_STAFF_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
                Only these three roles can be held by an account today — the database role type
                and the staff check behind sign-in accept nothing else, so Subsidiary HR Manager
                and Interviewer exist in the permission matrix but cannot be assigned yet.
              </p>
            </div>

            <div>
              <label htmlFor="user-company" className="mb-1.5 block text-xs font-bold">
                Company (optional)
              </label>
              <select
                id="user-company"
                name="company_id"
                value={draft.company_id}
                onChange={(e) => editField("company_id", e.target.value)}
                className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
              >
                <option value="">Group-wide (no company)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-brand-ink/45">
                Leave as group-wide unless this person belongs to one company only.
              </p>
            </div>

            {mode === "direct" && (
              <div>
                <label htmlFor="user-password" className="mb-1.5 block text-xs font-bold">
                  Password
                  <span className="ml-1.5 font-normal text-brand-ink/45">optional</span>
                </label>
                <input
                  id="user-password"
                  name="password"
                  type="password"
                  value={draft.password}
                  autoComplete="new-password"
                  onChange={(e) => editField("password", e.target.value)}
                  className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-brand-ink/45">
                  Minimum {passwordMinLength} characters if you type one. Leave it blank and a
                  strong password is generated for you to copy.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">
              <UserPlus className="h-4 w-4" aria-hidden />
              {mode === "invite"
                ? "Invite recorded — find it under Pending invites."
                : "Account created and ready to sign in."}
            </p>
          )}
          {credential && (
            <CredentialReveal
              label={`Password for ${draft.full_name || draft.email}`}
              password={credential}
              onDismiss={() => setCredential(null)}
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-brand-line bg-brand-cream p-5">
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            {mode === "invite"
              ? "No account is created yet, so this person cannot sign in."
              : credential
                ? "Copy the password above before you close this panel — it is shown once."
                : "Passwords are hashed by Supabase and never stored as text."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {credential ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {mode === "invite" ? "Record invite" : "Create user"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}