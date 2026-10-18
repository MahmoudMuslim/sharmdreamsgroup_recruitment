"use client";

import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Labelled form control used by every admin drawer. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-brand-ink/45">{hint}</p>}
    </div>
  );
}

const CONTROL =
  "w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, "resize-y", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL, props.className)} />;
}

/** Inline error / success message for drawer forms. */
export function FormMessage({
  error,
  success,
  notice,
}: {
  error?: string | null;
  success?: string | null;
  /** A fact the write did not fail on, but the recruiter should read. */
  notice?: string | null;
}) {
  if (error) {
    return (
      <p
        role="alert"
        className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
      >
        {error}
      </p>
    );
  }
  if (!success && !notice) return null;
  return (
    <div className="mt-4 space-y-2">
      {success && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800"
        >
          {success}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-brand-gold/50 bg-brand-sand/60 px-3.5 py-2.5 text-xs leading-relaxed text-brand-ink/70"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

/** Primary/secondary pair pinned to a drawer footer. */
export function DrawerActions({
  onCancel,
  submitLabel,
  pending,
  disabled,
  note,
}: {
  onCancel: () => void;
  submitLabel: string;
  pending?: boolean;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <>
      <p className="text-[11px] leading-relaxed text-brand-ink/45">{note ?? ""}</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || disabled}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </>
  );
}