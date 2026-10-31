"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

export function DateField({
  id,
  label,
  help,
  required,
  value,
  onChange,
  error,
}: RendererProps) {
  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error}>
      <input
        id={id}
        type="date"
        value={textValue(value)}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}
