"use client";

import { FieldFrame, inputClass } from "./FieldFrame";
import type { RendererProps } from "./types";

const ALL_UNITS = ["minutes", "hours", "days", "weeks", "months", "years"] as const;

function readPair(value: unknown): { amount: string; unit: string } {
  const pair = (typeof value === "object" && value !== null ? value : {}) as {
    value?: unknown;
    unit?: unknown;
  };
  const amount = typeof pair.value === "number" ? String(pair.value) : "";
  const unit = typeof pair.unit === "string" ? pair.unit : "";
  return { amount, unit };
}

export function Duration({
  id,
  label,
  help,
  required,
  units,
  value,
  onChange,
  error,
  t,
}: RendererProps) {
  const offered = units && units.length > 0 ? units : ALL_UNITS;
  const pair = readPair(value);
  const unit = offered.includes(pair.unit) ? pair.unit : offered[0];

  const emit = (amount: string, nextUnit: string) => {
    onChange(amount.trim() === "" ? {} : { value: Number(amount), unit: nextUnit });
  };

  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error}>
      <div className="flex gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={1}
          max={9999}
          value={pair.amount}
          aria-label={t("apply.dyn.amount")}
          required={required}
          onChange={(event) => emit(event.target.value, unit)}
          className={`${inputClass(error)} min-w-0 flex-1`}
        />
        <select
          aria-label={t("apply.dyn.unit")}
          value={unit}
          onChange={(event) => emit(pair.amount, event.target.value)}
          className={`${inputClass(error)} w-auto`}
        >
          {offered.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </FieldFrame>
  );
}
