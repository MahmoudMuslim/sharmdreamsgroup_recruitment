"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/modules/analytics/presentation/ui";
import { updateStaffDetails } from "@/modules/settings/application/user-actions";
import { cn } from "@/lib/utils";
import type { StaffMember } from "@/modules/settings/domain/types";

interface MemberEditPanelProps {
  member: StaffMember;
  onClose: () => void;
  onSaved: () => void;
}

const INPUT =
  "w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

/**
 * Edits the person behind a staff account.
 *
 * Role and company are deliberately absent: those two are already editable
 * inline on the row itself, and putting them here as well would give the same
 * write two entry points that could disagree while an edit is in flight.
 */
export function MemberEditPanel({ member, onClose, onSaved }: MemberEditPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState({
    full_name: member.full_name,
    email: member.email,
    phone: member.phone ?? "",
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
    draft.full_name.trim() !== member.full_name ||
    draft.email.trim().toLowerCase() !== member.email.toLowerCase() ||
    draft.phone.trim() !== (member.phone ?? "");

  const emailChanged = draft.email.trim().toLowerCase() !== member.email.toLowerCase();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await updateStaffDetails(member.id, {
        full_name: draft.full_name,
        email: draft.email,
        phone: draft.phone.trim() || null,
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
      aria-labelledby="member-edit-title"
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
      />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-brand-line bg-white shadow-2xl",
          "panel-in"
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-line p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
              Team
            </p>
            <h3 id="member-edit-title" className="mt-0.5 truncate font-display text-lg font-bold">
              Edit {member.full_name}
            </h3>
            <p className="mt-1 text-xs text-brand-ink/50">
              Corrects the record behind this account. Role and company are changed on the row
              itself.
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
              <label htmlFor="edit-full-name" className="mb-1.5 block text-xs font-bold">
                Full name <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="edit-full-name"
                type="text"
                value={draft.full_name}
                required
                autoComplete="name"
                onChange={(e) => {
                  setDraft((d) => ({ ...d, full_name: e.target.value }));
                  setError(null);
                }}
                className={INPUT}
              />
            </div>

            <div>
              <label htmlFor="edit-email" className="mb-1.5 block text-xs font-bold">
                Sign-in email <span className="ml-1 text-rose-600">*</span>
              </label>
              <input
                id="edit-email"
                type="email"
                value={draft.email}
                required
                autoComplete="email"
                onChange={(e) => {
                  setDraft((d) => ({ ...d, email: e.target.value }));
                  setError(null);
                }}
                className={INPUT}
              />
              {emailChanged && (
                <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                  This is the address they sign in with. Saving moves it here and in Supabase
                  Auth together, so they must use{" "}
                  <strong>{draft.email.trim().toLowerCase()}</strong> from now on — the old one
                  stops working. Anyone already signed in stays signed in until their session
                  ends.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-phone" className="mb-1.5 block text-xs font-bold">
                Phone <span className="ml-1.5 font-normal text-brand-ink/45">optional</span>
              </label>
              <input
                id="edit-phone"
                type="tel"
                value={draft.phone}
                autoComplete="tel"
                placeholder="+20 100 000 0000"
                onChange={(e) => {
                  setDraft((d) => ({ ...d, phone: e.target.value }));
                  setError(null);
                }}
                className={INPUT}
              />
              <p className="mt-1 text-[11px] text-brand-ink/45">
                Up to 32 characters, dialling code included. This is the number shown in their
                account menu — WhatsApp notices go to candidates&rsquo; numbers, never to a staff
                one.
              </p>
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
            Every change is written to the settings audit log and the change trail with your name
            on it.
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
