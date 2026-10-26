"use client";

import { FieldFrame } from "./FieldFrame";
import type { RendererProps } from "./types";

export function Radio({
  id,
  label,
  help,
  required,
  options,
  value,
  onChange,
  error,
}: RendererProps) {
  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error} legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(options ?? []).map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm transition hover:border-brand-gold"
          >
            <input
              type="radio"
              name={id}
              value={option}
              required={required}
              checked={value === option}
              onChange={() => onChange(option)}
              className="h-4 w-4 shrink-0 accent-brand-gold-dark"
            />
            <span className="min-w-0">{option}</span>
          </label>
        ))}
      </div>
    </FieldFrame>
  );
}
