"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/modules/analytics/presentation/ui";
import { ASSIGNABLE_STAFF_ROLES } from "@/modules/settings/domain/schema";
import { updateStaffInvite } from "@/modules/settings/application/user-actions";
import { cn } from "@/lib/utils";
import type { AssignableStaffRole, Company, StaffInvite } from "@/modules/settings/domain/types";

interface InviteEditPanelProps {
  invite: StaffInvite;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}

const INPUT =
  "w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

/**
 * Corrects a pending invite where it stands.
 *
 * The alternative was cancel-and-record, which threw away who invited the person
 * and when, and read in the trail as two unrelated events instead of one
 * correction.
 */
export function InviteEditPanel({
  invite,
  companies,
  onClose,
  onSaved,
}: InviteEditPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState({
    email: invite.email,
    full_name: invite.full_name,
    role: invite.role as AssignableStaffRole,
    company_id: invite.company_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLInputElement>("input");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty =
    draft.email.trim().toLowerCase() !== invite.email.toLowerCase() ||
    draft.full_name.trim() !== invite.full_name ||
    draft.role !== invite.role ||
    draft.company_id !== (invite.company_id ?? "");

  function edit(name: string, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await updateStaffInvite(invite.id, {
        email: draft.email,
        full_name: draft.full_name,
        role: draft.role,
        company_id: draft.company_id || null,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save the changes.");
        return;
      }
      onClose();
      onSaved();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-edit-title"
    >
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
              Pending invite
            </p>
            <h3 id="invite-edit-title" className="mt-0.5 truncate font-display text-lg font-bold">
              Correct {invite.full_name}
            </h3>
            <p className="mt-1 text-xs text-brand-ink/50">
              Fixes the details before the account exists. No account is created, and nothing is
              emailed, until someone presses Create account.
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
          <div className="space-y-4">
            <div>
              <label htmlFor="invite-edit-email" className="mb-1.5 block text-xs font-bold">
                Email <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="invite-edit-email"
                type="email"
                value={draft.email}
                required
                autoComplete="email"
                onChange={(e) => edit("email", e.target.value)}
                className={INPUT}
              />
            </div>

            <div>
              <label htmlFor="invite-edit-name" className="mb-1.5 block text-xs font-bold">
                Full name <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="invite-edit-name"
                type="text"
                value={draft.full_name}
                required
                autoComplete="name"
                onChange={(e) => edit("full_name", e.target.value)}
                className={INPUT}
              />
            </div>

            <div>
              <label htmlFor="invite-edit-role" className="mb-1.5 block text-xs font-bold">
                Role <span className="ml-1 text-rose-600">*</span>
              </label>
              <select
                id="invite-edit-role"
                value={draft.role}
                required
                onChange={(e) => edit("role", e.target.value)}
                className={INPUT}
              >
                {ASSIGNABLE_STAFF_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
                Only these three roles can be held by an account today, so an invite asking for
                another one could never be turned into an account.
              </p>
            </div>

            <div>
              <label htmlFor="invite-edit-company" className="mb-1.5 block text-xs font-bold">
                Company (optional)
              </label>
              <select
                id="invite-edit-company"
                value={draft.company_id}
                onChange={(e) => edit("company_id", e.target.value)}
                className={INPUT}
              >
                <option value="">Group-wide (no company)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-brand-line bg-brand-cream p-5">
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            The invite keeps its original date and inviter, so correcting a typo does not look
            like a new invitation.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save changes
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
