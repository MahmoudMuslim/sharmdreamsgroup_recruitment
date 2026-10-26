"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

export function Currency({
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
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        value={textValue(value)}
        placeholder={placeholder ?? undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}
