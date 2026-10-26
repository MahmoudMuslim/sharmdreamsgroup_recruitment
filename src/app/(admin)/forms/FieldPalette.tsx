"use client";

import { FIELD_TYPES, type FieldType } from "@/modules/form-builder/domain/field-types";
import { cn } from "@/lib/utils";

/**
 * The twenty-one types, named the way a recruiter reads them (spec §6's palette).
 *
 * One label table, exported because the canvas and the inspector name the same
 * types and a second table would be a second vocabulary for one database CHECK.
 */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email address",
  phone: "Phone number",
  url: "Link (URL)",
  number: "Number",
  percentage: "Percentage",
  currency: "Currency",
  date: "Date",
  time: "Time",
  datetime: "Date & time",
  duration: "Duration",
  select: "Dropdown",
  radio: "Radio buttons",
  multi_select: "Multi-select",
  checkbox: "Checkbox",
  file: "File upload",
  photo: "Photo upload",
  address: "Address",
  geolocation: "Location",
  section_heading: "Section heading",
};

/** The dataTransfer key both a palette chip and a canvas row write. */
export const FIELD_DRAG_MIME = "application/x-form-field";

export function FieldPalette({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: FieldType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {FIELD_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          disabled={disabled}
          draggable={!disabled}
          onClick={() => onAdd(type)}
          onDragStart={(event) => {
            if (disabled) return;
            const payload = JSON.stringify({ kind: "new", type });
            event.dataTransfer.setData(FIELD_DRAG_MIME, payload);
            // Some embedded browsers only expose text/plain on drop.
            event.dataTransfer.setData("text/plain", payload);
            event.dataTransfer.effectAllowed = "copy";
          }}
          className={cn(
            "rounded-lg border border-brand-line bg-white px-2 py-1.5 text-left text-[11px] font-semibold leading-tight text-brand-ink/75 transition",
            "hover:border-brand-gold hover:bg-brand-sand/60 hover:text-brand-ink",
            "disabled:cursor-not-allowed disabled:opacity-45",
          )}
          title={
            type === "section_heading"
              ? "Starts a new step; a heading asks no question"
              : undefined
          }
        >
          {FIELD_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
