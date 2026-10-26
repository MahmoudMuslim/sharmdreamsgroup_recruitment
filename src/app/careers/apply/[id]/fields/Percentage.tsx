"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

export function Percentage({
  id,
  label,
  help,
  placeholder,
  required,
  value,
  onChange,
  error,
}: RendererProps) {
  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={100}
          value={textValue(value)}
          placeholder={placeholder ?? undefined}
          required={required}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass(error)} pr-8`}
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-brand-ink/45"
          aria-hidden
        >
          %
        </span>
      </div>
    </FieldFrame>
  );
}
