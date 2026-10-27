"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { Field, Select, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import { Button } from "@/modules/analytics/presentation/ui";
import type { FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import {
  DURATION_UNITS,
  FIELD_TYPES,
  KINDS,
  type FieldType,
  type Kind,
} from "@/modules/form-builder/domain/field-types";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import {
  ALWAYS_FULL_TYPES,
  FIELD_WIDTHS,
  widthOf,
  type FieldWidth,
} from "@/modules/form-builder/domain/rowLayout";
import { cn } from "@/lib/utils";
import { BindingPicker } from "./BindingPicker";
import { FIELD_TYPE_LABELS } from "./FieldPalette";

const ADDRESS_PART_LABELS: Record<string, string> = {
  line1: "Address line 1",
  line2: "Address line 2",
  city: "City",
  region: "Region / state",
  postalCode: "Postal code",
  country: "Country",
};

const KIND_LABELS: Record<Kind, string> = {
  pdf: "PDF",
  doc: "Word document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  image: "Image",
  audio: "Audio",
  video: "Video",
  text: "Text / CSV",
};

const TEXTUAL_TYPES: ReadonlySet<FieldType> = new Set([
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "percentage",
  "currency",
]);

const CHOICE_TYPES: ReadonlySet<FieldType> = new Set(["select", "radio", "multi_select"]);
const RANGE_TYPES: ReadonlySet<FieldType> = new Set(["number", "percentage", "currency"]);
const KIND_TYPES: ReadonlySet<FieldType> = new Set(["file", "photo"]);

const WIDTH_LABELS: Record<FieldWidth, string> = {
  full: "Full",
  half: "Half",
  third: "Third",
};

/**
 * The config one newly added type starts with. Kept beside the editor that
 * writes config, because a default is an authoring decision, not a domain rule:
 * the database accepts `{}` for every type, and `draftIssues` names what is
 * still missing.
 */
export function defaultsFor(type: FieldType): Record<string, unknown> {
  switch (type) {
    case "short_text":
      return { maxLength: 300 };
    case "long_text":
      return { maxLength: LIMITS.long_text_chars };
    case "select":
    case "radio":
    case "multi_select":
      return { options: ["", ""] };
    case "number":
      return { decimals: 2 };
    case "percentage":
      return { decimals: LIMITS.percentage_decimals };
    case "file":
      return { kinds: ["pdf", "doc"] };
    case "photo":
      return { kinds: ["image"] };
    case "address":
      return {
        components: ["line1", "line2", "city", "region", "postalCode", "country"],
      };
    case "duration":
      return { units: [...DURATION_UNITS] };
    default:
      return {};
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function NumberConfig({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: unknown;
  min?: number;
  max?: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <TextInput
        id={id}
        type="number"
        step="any"
        min={min}
        max={max}
        disabled={disabled}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(null);
            return;
          }
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          const clamped =
            min !== undefined && max !== undefined
              ? Math.min(max, Math.max(min, parsed))
              : parsed;
          onChange(clamped);
        }}
        className="text-xs"
      />
    </Field>
  );
}

function CheckList<T extends string>({
  legend,
  options,
  selected,
  disabled,
  labels,
  isOptionDisabled,
  onToggle,
}: {
  legend: string;
  options: readonly T[];
  selected: readonly string[];
  disabled: boolean;
  labels: Record<T, string>;
  isOptionDisabled?: (option: T) => boolean;
  onToggle: (option: T, checked: boolean) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-xs font-bold">{legend}</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((option) => {
          const blocked = isOptionDisabled?.(option) ?? false;
          return (
            <label
              key={option}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-cream/60 px-2 py-1.5 text-[11px]",
                blocked ? "opacity-45" : "cursor-pointer hover:border-brand-gold/60",
              )}
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                disabled={disabled || blocked}
                onChange={(event) => onToggle(option, event.target.checked)}
                className="h-3 w-3 accent-brand-gold-dark"
              />
              {labels[option]}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-brand-ink/40">
        At least one has to stay ticked, or a candidate cannot answer the field.
      </p>
    </fieldset>
  );
}

/**
 * Everything about one field that is not its identity: the words a candidate
 * reads, whether it is required, what it is stored as, and its type-specific
 * settings.
 *
 * Changing the type starts the settings over and clears the binding, so a photo
 * field never keeps a file field's kinds. The console owns that reset — this
 * panel only reports the intent — because the same rule applies to a field
 * dropped from the palette.
 */
export function Inspector({
  field,
  disabled,
  onChange,
  onTypeChange,
  onRemove,
}: {
  field: FieldDraft;
  disabled: boolean;
  onChange: (patch: Partial<FieldDraft>) => void;
  onTypeChange: (type: FieldType) => void;
  onRemove: () => void;
}) {
  // The id pairs a label with its control, so it must be the same string on the
  // server render and the hydration. A value minted per row (`crypto.randomUUID()`)
  // is not: the two renders disagree and React reports the tree as mismatched.
  const htmlId = useId();
  const config = field.config ?? {};
  const heading = field.type === "section_heading";
  const takesRow = ALWAYS_FULL_TYPES.has(field.type);
  const options = stringList(config.options);
  const kinds = stringList(config.kinds);
  const components = stringList(config.components);
  const units = stringList(config.units);

  const setConfig = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...config };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") delete next[key];
      else next[key] = value;
    }
    onChange({ config: next });
  };

  const toggleIn = (key: "kinds" | "components" | "units", value: string, checked: boolean) => {
    const current = stringList(config[key]);
    const next = checked
      ? current.includes(value)
        ? current
        : [...current, value]
      : current.filter((entry) => entry !== value);
    setConfig({ [key]: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-dark">
          Inspector
        </p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-brand-ink/40">
          {field.key || "no key yet"}
        </p>
      </div>

      <Field label="Field type" htmlFor={`type-${field.key}`}>
        <Select
          id={`type-${field.key}`}
          value={field.type}
          disabled={disabled}
          onChange={(event) => onTypeChange(event.target.value as FieldType)}
          className="text-xs"
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={heading ? "Section title" : "Question label"}
        htmlFor={`label-${field.key}`}
        required
      >
        <TextInput
          id={`label-${field.key}`}
          value={field.label}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => onChange({ label: event.target.value })}
          className="text-xs"
          placeholder={heading ? "e.g. Your experience" : "e.g. How many years have you…"}
        />
      </Field>

      <Field
        label="Key"
        htmlFor={`key-${field.key}`}
        hint="3–60 lowercase letters, digits and underscores, starting with a letter. It joins the answer to the form."
        required
      >
        <TextInput
          id={`key-${field.key}`}
          value={field.key}
          disabled={disabled}
          onChange={(event) => onChange({ key: event.target.value })}
          className="font-mono text-xs"
          placeholder="years_experience"
        />
      </Field>

      <Field
        label={heading ? "Step description" : "Help text"}
        htmlFor={`help-${field.key}`}
        hint="Shown under the question. Optional."
      >
        <TextArea
          id={`help-${field.key}`}
          value={field.helpText ?? ""}
          disabled={disabled}
          rows={2}
          maxLength={1000}
          onChange={(event) => onChange({ helpText: event.target.value || null })}
          className="text-xs"
        />
      </Field>

      {TEXTUAL_TYPES.has(field.type) && (
        <Field label="Placeholder" htmlFor={`placeholder-${field.key}`}>
          <TextInput
            id={`placeholder-${field.key}`}
            value={field.placeholder ?? ""}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => onChange({ placeholder: event.target.value || null })}
            className="text-xs"
          />
        </Field>
      )}

      {!heading && (
        <label className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={field.required}
            disabled={disabled}
            onChange={(event) => onChange({ required: event.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 accent-brand-gold-dark"
          />
          <span>
            <span className="font-bold">Required</span>
            <span className="block text-[10px] leading-relaxed text-brand-ink/45">
              A candidate cannot send the form without answering it. Tier-3 profile
              facts must stay optional.
            </span>
          </span>
        </label>
      )}

      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
          Width
        </p>
        <div className="flex gap-1" role="radiogroup" aria-label="How wide this field is">
          {FIELD_WIDTHS.map((width) => {
            const active = widthOf(field) === width;
            return (
              <label
                key={width}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-1.5 text-center text-[11px] font-semibold transition",
                  active
                    ? "border-brand-gold bg-brand-gold/15 text-brand-ink"
                    : "border-brand-line bg-white text-brand-ink/55",
                  takesRow || disabled
                    ? "cursor-not-allowed opacity-45"
                    : "cursor-pointer hover:border-brand-gold/60",
                )}
              >
                <input
                  type="radio"
                  name={`width-${htmlId}`}
                  value={width}
                  checked={active}
                  disabled={disabled || takesRow}
                  onChange={() => setConfig({ width })}
                  className="sr-only"
                />
                {WIDTH_LABELS[width]}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-brand-ink/45">
          {takesRow
            ? "This type takes a whole row: the settings below are what make its answer wide."
            : "A narrow field shares its row with the fields beside it in the list. On a phone every field still takes the whole row."}
        </p>
      </div>

      {heading ? (
        <p className="rounded-xl border border-dashed border-brand-line bg-brand-cream/50 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/55">
          A section heading starts a new step. It asks nothing, is not stored as an
          answer, and cannot be bound to a candidate field.
        </p>
      ) : (
        <BindingPicker
          field={field}
          htmlId={`binding-${htmlId}`}
          disabled={disabled}
          onChange={(systemKey) =>
            onChange({
              systemKey,
              ...(systemKey === "name" || systemKey === "email" ? { required: true } : {}),
            })
          }
        />
      )}

      <div className="border-t border-brand-line pt-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
          {FIELD_TYPE_LABELS[field.type]} settings
        </p>

        {CHOICE_TYPES.has(field.type) && (
          <div className="space-y-3">
            <Field
              label="Answers"
              htmlFor={`options-${field.key}`}
              hint={`One per line, 2–${LIMITS.options_per_choice_field}.`}
              required
            >
              <TextArea
                id={`options-${field.key}`}
                value={options.join("\n")}
                disabled={disabled}
                rows={4}
                onChange={(event) => setConfig({ options: event.target.value.split("\n") })}
                className="text-xs"
                placeholder={"Yes\nNo\nNot sure"}
              />
            </Field>
            {field.type === "multi_select" && (
              <div className="grid grid-cols-2 gap-2">
                <NumberConfig
                  id={`min-select-${field.key}`}
                  label="At least"
                  value={config.minSelections}
                  min={0}
                  max={Math.max(0, options.filter((entry) => entry.trim()).length)}
                  disabled={disabled}
                  onChange={(value) => setConfig({ minSelections: value })}
                />
                <NumberConfig
                  id={`max-select-${field.key}`}
                  label="At most"
                  value={config.maxSelections}
                  min={0}
                  max={Math.max(0, options.filter((entry) => entry.trim()).length)}
                  disabled={disabled}
                  onChange={(value) => setConfig({ maxSelections: value })}
                />
              </div>
            )}
          </div>
        )}

        {(field.type === "short_text" || field.type === "long_text") && (
          <NumberConfig
            id={`maxlen-${field.key}`}
            label="Longest answer (characters)"
            value={config.maxLength}
            min={1}
            max={field.type === "short_text" ? 300 : LIMITS.long_text_chars}
            disabled={disabled}
            onChange={(value) => setConfig({ maxLength: value })}
          />
        )}

        {RANGE_TYPES.has(field.type) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberConfig
              id={`min-${field.key}`}
              label="Minimum"
              value={config.min}
              min={field.type === "percentage" ? LIMITS.percentage_min : undefined}
              max={field.type === "percentage" ? LIMITS.percentage_max : undefined}
              disabled={disabled}
              onChange={(value) => setConfig({ min: value })}
            />
            <NumberConfig
              id={`max-${field.key}`}
              label="Maximum"
              value={config.max}
              min={field.type === "percentage" ? LIMITS.percentage_min : undefined}
              max={field.type === "percentage" ? LIMITS.percentage_max : undefined}
              disabled={disabled}
              onChange={(value) => setConfig({ max: value })}
            />
          </div>
        )}

        {(field.type === "number" || field.type === "percentage") && (
          <div className="mt-2">
            <NumberConfig
              id={`decimals-${field.key}`}
              label="Decimal places"
              value={config.decimals}
              min={0}
              max={field.type === "number" ? 2 : LIMITS.percentage_decimals}
              disabled={disabled}
              onChange={(value) => setConfig({ decimals: value })}
            />
          </div>
        )}

        {KIND_TYPES.has(field.type) && (
          <div className="mt-2">
            <CheckList
              legend="Accepted file kinds"
              options={KINDS}
              selected={kinds}
              disabled={disabled}
              labels={KIND_LABELS}
              isOptionDisabled={field.type === "photo" ? (kind) => kind !== "image" : undefined}
              onToggle={(kind, checked) => toggleIn("kinds", kind, checked)}
            />
          </div>
        )}

        {field.type === "address" && (
          <CheckList
            legend="Address parts"
            options={["line1", "line2", "city", "region", "postalCode", "country"] as const}
            selected={components}
            disabled={disabled}
            labels={ADDRESS_PART_LABELS}
            onToggle={(part, checked) => toggleIn("components", part, checked)}
          />
        )}

        {field.type === "duration" && (
          <CheckList
            legend="Units a candidate may choose"
            options={DURATION_UNITS}
            selected={units}
            disabled={disabled}
            labels={
              Object.fromEntries(
                DURATION_UNITS.map((unit) => [unit, unit[0].toUpperCase() + unit.slice(1)]),
              ) as Record<(typeof DURATION_UNITS)[number], string>
            }
            onToggle={(unit, checked) => toggleIn("units", unit, checked)}
          />
        )}

        {field.type === "checkbox" && (
          <label className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={config.mustBeTrue === true}
              disabled={disabled}
              onChange={(event) => setConfig({ mustBeTrue: event.target.checked ? true : null })}
              className="mt-0.5 h-3.5 w-3.5 accent-brand-gold-dark"
            />
            <span>
              <span className="font-bold">Must be ticked</span>
              <span className="block text-[10px] leading-relaxed text-brand-ink/45">
                The candidate cannot send the application without ticking this box —
                use it for a consent or declaration line.
              </span>
            </span>
          </label>
        )}

        {(field.type === "date" || field.type === "datetime") && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Earliest" htmlFor={`datemin-${field.key}`}>
              <TextInput
                id={`datemin-${field.key}`}
                type={field.type === "date" ? "date" : "datetime-local"}
                value={typeof config.min === "string" ? config.min : ""}
                disabled={disabled}
                onChange={(event) => setConfig({ min: event.target.value })}
                className="text-xs"
              />
            </Field>
            <Field label="Latest" htmlFor={`datemax-${field.key}`}>
              <TextInput
                id={`datemax-${field.key}`}
                type={field.type === "date" ? "date" : "datetime-local"}
                value={typeof config.max === "string" ? config.max : ""}
                disabled={disabled}
                onChange={(event) => setConfig({ max: event.target.value })}
                className="text-xs"
              />
            </Field>
          </div>
        )}

        {field.type === "geolocation" && (
          <p className="text-[11px] leading-relaxed text-brand-ink/50">
            The candidate picks a point; the answer is stored as latitude and
            longitude rounded to {LIMITS.geolocation_dp} decimal places. Nothing
            else from the browser&apos;s location is kept.
          </p>
        )}

        {(field.type === "email" ||
          field.type === "phone" ||
          field.type === "url" ||
          field.type === "time" ||
          heading) && (
          <p className="text-[11px] leading-relaxed text-brand-ink/50">
            {heading
              ? "A heading has no settings beyond its title."
              : `This type has no settings; the answer is checked as ${
                  field.type === "email"
                    ? "an email address"
                    : field.type === "phone"
                      ? "a phone number"
                      : field.type === "url"
                        ? "an http(s) link"
                        : "a 24-hour HH:MM time"
                }.`}
          </p>
        )}
      </div>

      <div className="border-t border-brand-line pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          className="w-full text-rose-700 hover:bg-rose-50"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove this field
        </Button>
      </div>
    </div>
  );
}
