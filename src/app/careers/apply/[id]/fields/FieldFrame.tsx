"use client";

import type { ReactNode } from "react";
import { FIELD } from "../ApplyBits";
import { cn } from "@/lib/utils";

/**
 * The label, the author's help, the box and its error, in one frame.
 *
 * A single box gets a `<label for>`; a choice or composite field passes
 * `legend` so the group gets a `<fieldset>` instead. Nothing here knows what
 * type it is wrapping, which is what keeps every renderer to one small file.
 */
export function FieldFrame({
  id,
  label,
  help,
  required,
  error,
  legend = false,
  children,
}: {
  id: string;
  label: string;
  help: string | null;
  required: boolean;
  error?: string | null;
  legend?: boolean;
  children: ReactNode;
}) {
  const title = (
    <>
      {label}
      {required && (
        <span className="ml-1 text-rose-600" aria-hidden>
          *
        </span>
      )}
    </>
  );

  const hint = help ? (
    <p className="mb-2 mt-1 text-[11px] leading-relaxed text-brand-ink/50">{help}</p>
  ) : null;

  const failure = error ? (
    <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
      {error}
    </p>
  ) : null;

  if (legend) {
    return (
      <fieldset className="mt-5 first-of-type:mt-0" aria-required={required || undefined}>
        <legend className="text-xs font-bold">{title}</legend>
        {hint}
        <div className="mt-1">{children}</div>
        {failure}
      </fieldset>
    );
  }

  return (
    <div className="mt-5 first-of-type:mt-0">
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold">
        {title}
      </label>
      {hint}
      {children}
      {failure}
    </div>
  );
}

export function inputClass(error?: string | null): string {
  return cn(FIELD, error && "border-rose-300 focus:border-rose-400");
}

/** The string a text box shows for whatever the answer currently is. */
export function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}
