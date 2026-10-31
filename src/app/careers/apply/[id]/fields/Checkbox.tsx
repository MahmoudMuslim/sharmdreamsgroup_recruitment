"use client";

import { cn } from "@/lib/utils";
import type { RendererProps } from "./types";

/**
 * A tick is an answer, not a label: the box sits beside the author's sentence
 * and the value is a boolean, so "not ticked" and "never asked" stay apart on
 * the wire (`undefined` vs `false`).
 */
export function Checkbox({
  id,
  label,
  help,
  required,
  value,
  onChange,
  error,
}: RendererProps) {
  return (
    <div className="mt-5 first-of-type:mt-0">
      <label
        htmlFor={id}
        className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-sm transition hover:border-brand-gold",
          error ? "border-rose-300" : "border-brand-line",
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          required={required}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold-dark"
        />
        <span className="min-w-0">
          {label}
          {required && (
            <span className="ml-1 text-rose-600" aria-hidden>
              *
            </span>
          )}
        </span>
      </label>
      {help && <p className="mb-2 mt-1 text-[11px] leading-relaxed text-brand-ink/50">{help}</p>}
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
