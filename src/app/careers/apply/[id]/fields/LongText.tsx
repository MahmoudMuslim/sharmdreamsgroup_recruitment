"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

export function LongText({
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
      <textarea
        id={id}
        rows={6}
        value={textValue(value)}
        placeholder={placeholder ?? undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass(error)} min-h-32 resize-y`}
      />
    </FieldFrame>
  );
}
