"use client";

import { FieldFrame, inputClass, textValue } from "./FieldFrame";
import type { RendererProps } from "./types";

/**
 * `datetime-local` has no offset, so the browser shows the wall clock the
 * candidate picked while the answer is stored as the RFC 3339 instant the
 * normaliser demands. The conversion happens here and only here.
 */
function toLocalBox(iso: string): string {
  if (!iso) return "";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

export function DateTimeField({
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
        type="datetime-local"
        value={toLocalBox(textValue(value))}
        required={required}
        onChange={(event) => {
          const chosen = event.target.value;
          if (!chosen) {
            onChange("");
            return;
          }
          const moment = new Date(chosen);
          onChange(Number.isNaN(moment.getTime()) ? "" : moment.toISOString());
        }}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}
