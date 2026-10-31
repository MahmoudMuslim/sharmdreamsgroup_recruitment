"use client";

import { FieldFrame, inputClass } from "./FieldFrame";
import type { RendererProps } from "./types";

const PARTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;
type Part = (typeof PARTS)[number];

function readParts(value: unknown): Record<string, string> {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const parts: Record<string, string> = {};
  for (const part of PARTS) {
    if (typeof source[part] === "string") parts[part] = source[part];
  }
  return parts;
}

export function Address({
  id,
  label,
  help,
  required,
  value,
  onChange,
  error,
  t,
}: RendererProps) {
  const parts = readParts(value);

  const write = (part: Part, text: string) => {
    const next: Record<string, string> = { ...parts };
    if (text.trim() === "") delete next[part];
    else next[part] = text;
    // An object holding only empty strings is not an answer; the server treats
    // it as an empty address and refuses it for an optional field.
    onChange(next);
  };

  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error} legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PARTS.map((part) => (
          <label key={part} htmlFor={`${id}-${part}`} className="block">
            <span className="mb-1 block text-[11px] font-semibold text-brand-ink/55">
              {t(`apply.dyn.address.${part}`)}
            </span>
            <input
              id={`${id}-${part}`}
              type="text"
              value={parts[part] ?? ""}
              onChange={(event) => write(part, event.target.value)}
              className={inputClass(error)}
            />
          </label>
        ))}
      </div>
    </FieldFrame>
  );
}
