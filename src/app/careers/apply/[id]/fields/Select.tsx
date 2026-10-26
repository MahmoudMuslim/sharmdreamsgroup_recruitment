"use client";

import { FieldFrame, inputClass } from "./FieldFrame";
import type { RendererProps } from "./types";

export function Select({
  id,
  label,
  help,
  placeholder,
  required,
  options,
  value,
  onChange,
  error,
  t,
}: RendererProps) {
  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error}>
      <select
        id={id}
        value={typeof value === "string" ? value : ""}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass(error)}
      >
        <option value="" disabled>
          {placeholder ?? t("apply.dyn.choose")}
        </option>
        {(options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
