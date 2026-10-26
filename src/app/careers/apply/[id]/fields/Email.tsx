"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

export function Email({
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
        type="email"
        inputMode="email"
        autoComplete="email"
        value={textValue(value)}
        placeholder={placeholder ?? undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}
