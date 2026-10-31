"use client";

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import type { FieldType } from "@/modules/form-builder/domain/field-types";
import {
  ALWAYS_FULL_TYPES,
  GRID_CLASS,
  SPAN_CLASS,
  widthOf,
} from "@/modules/form-builder/domain/rowLayout";
import { FIELD_DRAG_MIME, FIELD_TYPE_LABELS } from "./FieldPalette";

export type DragPayload =
  | { kind: "new"; type: FieldType }
  | { kind: "move"; index: number };

function readPayload(event: React.DragEvent): DragPayload | null {
  const raw =
    event.dataTransfer.getData(FIELD_DRAG_MIME) ||
    event.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed.kind === "new" && typeof parsed.type === "string") {
      return { kind: "new", type: parsed.type as FieldType };
    }
    if (parsed.kind === "move" && Number.isInteger(parsed.index)) {
      return { kind: "move", index: parsed.index };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The layout as one ordered list, with drag-and-drop for a pointer and up/down
 * buttons for a keyboard (the same pairing the bank's board uses).
 *
 * A drop lands **before** the row it is dropped on; the tail strip appends; a
 * drop on a card's right edge places the dragged field **beside** it. Those are
 * the only three rules, so a drag can never land in a second place the author
 * did not see.
 *
 * The list is a six-column grid and each card takes the width its field asks
 * for, so what the author sees is what `resolveLayout` will order and what the
 * applicant's wizard will render — the same map, the same packing, on both
 * sides. Pairing is a pointer affordance; the inspector's width control is the
 * keyboard path to the same fact.
 *
 * Each row is named `form-field-row-<index>` so the step strip above the canvas
 * can scroll a step's heading into view.
 */
export function Canvas({
  fields,
  selectedIndex,
  disabled,
  onSelect,
  onAdd,
  onMove,
  onRemove,
  onPlaceBeside,
}: {
  fields: FieldDraft[];
  /** Which row the inspector is editing. Index, not key: a key may be mid-edit. */
  selectedIndex: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
  onAdd: (type: FieldType, at: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** The dragged payload landed on `target`'s right edge, to share its row. */
  onPlaceBeside: (payload: DragPayload, target: number) => void;
}) {
  const drop = (event: React.DragEvent, at: number) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readPayload(event);
    if (!payload) return;
    if (payload.kind === "new") onAdd(payload.type, at);
    else onMove(payload.index, at);
  };

  const dropBeside = (event: React.DragEvent, target: number) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readPayload(event);
    if (!payload) return;
    // The strip is offered for any field that can hold a row partner; whether
    // the dragged one may join it is the layout module's rule, applied once by
    // the console — which says so in words when the pair is refused.
    onPlaceBeside(payload, target);
  };

  if (fields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-brand-line bg-brand-cream/40 px-4 py-10 text-center">
        <p className="font-display text-sm font-bold">This form asks nothing yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-brand-ink/55">
          Click a field type on the left, or drag one here. Add a section heading
          to divide the form into steps; a form with no headings is asked as one
          step named after the form.
        </p>
      </div>
    );
  }

  return (
    <div role="list" className={cn(GRID_CLASS, "gap-1.5")}>
      {fields.map((field, index) => {
        const selected = index === selectedIndex;
        const heading = field.type === "section_heading";
        const takesRow = ALWAYS_FULL_TYPES.has(field.type);
        return (
          <div
            key={`${index}-${field.key}`}
            id={`form-field-row-${index}`}
            role="listitem"
            aria-current={selected ? "true" : undefined}
            draggable={!disabled}
            onClick={() => onSelect(index)}
            onDragStart={(event) => {
              if (disabled) return;
              const payload = JSON.stringify({ kind: "move", index });
              event.dataTransfer.setData(FIELD_DRAG_MIME, payload);
              event.dataTransfer.setData("text/plain", payload);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!disabled) event.preventDefault();
            }}
            onDrop={(event) => drop(event, index)}
            className={cn(
              "group relative flex cursor-pointer items-start gap-2 rounded-xl border px-2.5 py-2 transition",
              SPAN_CLASS[widthOf(field)],
              heading
                ? "border-brand-gold/40 bg-brand-gold/10"
                : "border-brand-line bg-white",
              selected
                ? "ring-2 ring-brand-gold/70 ring-offset-1"
                : "hover:border-brand-gold/50",
            )}
          >
            <span className="mt-1 shrink-0 text-brand-ink/25" aria-hidden>
              <GripVertical className="h-4 w-4" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[10px] font-bold tabular-nums text-brand-ink/35">
                  {index + 1}
                </span>
                <span
                  className={cn(
                    "min-w-0 break-words text-sm",
                    heading ? "font-display font-bold" : "font-semibold",
                  )}
                >
                  {field.label.trim() || (
                    <span className="italic text-brand-ink/40">Untitled field</span>
                  )}
                </span>
                {field.required && !heading && (
                  <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700">
                    Required
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-brand-ink/45">
                <span>{FIELD_TYPE_LABELS[field.type]}</span>
                <span className="font-mono text-brand-ink/40">{field.key}</span>
                {field.systemKey && (
                  <span className="rounded bg-brand-sand px-1 py-0.5 font-mono text-[9px] text-brand-gold-dark">
                    writes {field.systemKey}
                  </span>
                )}
                {widthOf(field) !== "full" && (
                  <span className="rounded bg-brand-sand px-1 py-0.5 font-mono text-[9px] text-brand-ink/50">
                    {widthOf(field)} wide
                  </span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={`Move ${field.label || field.key} up`}
                title="Move up"
                disabled={disabled || index === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(index, index - 1);
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-brand-ink/45 hover:bg-brand-sand hover:text-brand-ink disabled:opacity-25"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${field.label || field.key} down`}
                title="Move down"
                disabled={disabled || index === fields.length - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(index, index + 2);
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-brand-ink/45 hover:bg-brand-sand hover:text-brand-ink disabled:opacity-25"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${field.label || field.key}`}
                title="Remove field"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(index);
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-brand-ink/35 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-25"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {!takesRow && (
              <div
                aria-hidden
                title="Drop a field here to ask it beside this one"
                onDragOver={(event) => {
                  if (!disabled) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onDrop={(event) => dropBeside(event, index)}
                className={cn(
                  "absolute inset-y-1 -right-2 w-4 rounded-r-xl border-r-2 border-transparent transition",
                  disabled
                    ? "pointer-events-none"
                    : "pointer-events-auto bg-brand-gold/70 opacity-0 hover:opacity-100 group-hover:opacity-60",
                )}
              />
            )}
          </div>
        );
      })}

      <div
        onDragOver={(event) => {
          if (!disabled) event.preventDefault();
        }}
        onDrop={(event) => drop(event, fields.length)}
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand-line/80 px-3 py-2 text-[11px] text-brand-ink/35",
          SPAN_CLASS.full,
          disabled ? "opacity-50" : "hover:border-brand-gold hover:text-brand-ink/55",
        )}
      >
        <Plus className="h-3 w-3" aria-hidden />
        Drop here to add at the end
      </div>
    </div>
  );
}
