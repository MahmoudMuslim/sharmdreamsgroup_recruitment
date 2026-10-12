"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bell,
  Building2,
  Check,
  ClipboardCheck,
  Loader2,
  Plug,
  Shield,
  Sparkles,
} from "lucide-react";
import { SETTINGS_SCHEMA } from "@/modules/settings/domain/schema";
import { saveSettings } from "@/app/(admin)/settings/actions";
import { Button, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { SettingControl } from "@/modules/settings/domain/types";

const ICONS: Record<string, typeof Sparkles> = {
  building: Building2,
  sparkles: Sparkles,
  clipboard: ClipboardCheck,
  bell: Bell,
  plug: Plug,
  shield: Shield,
};

type Draft = Record<string, unknown>;

function Field({
  control,
  value,
  onChange,
}: {
  control: SettingControl;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const id = `setting-${control.key}`;

  if (control.kind === "toggle") {
    const on = value === true;
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm font-semibold">
            {control.label}
          </label>
          {control.help && (
            <p className="mt-0.5 text-xs leading-relaxed text-brand-ink/50">{control.help}</p>
          )}
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={control.label}
          onClick={() => onChange(!on)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition",
            on ? "bg-brand-gold" : "bg-brand-line"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              on ? "left-[22px]" : "left-0.5"
            )}
          />
        </button>
      </div>
    );
  }

  if (control.kind === "select") {
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
          {control.label}
        </label>
        {control.help && (
          <p className="mb-2 text-xs leading-relaxed text-brand-ink/50">{control.help}</p>
        )}
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (control.kind === "multiselect") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{control.label}</legend>
        {control.help && (
          <p className="mb-2 text-xs leading-relaxed text-brand-ink/50">{control.help}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {control.options.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((v) => v !== option.value)
                      : [...selected, option.value]
                  )
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                    : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand"
                )}
              >
                {active && <Check className="h-3.5 w-3.5" aria-hidden />}
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (control.kind === "number") {
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
          {control.label}
        </label>
        {control.help && (
          <p className="mb-2 text-xs leading-relaxed text-brand-ink/50">{control.help}</p>
        )}
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={control.min}
            max={control.max}
            value={typeof value === "number" ? value : Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-32 rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
          />
          {control.unit && (
            <span className="text-xs font-semibold text-brand-ink/45">{control.unit}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {control.label}
      </label>
      {control.help && (
        <p className="mb-2 text-xs leading-relaxed text-brand-ink/50">{control.help}</p>
      )}
      <input
        id={id}
        type={control.kind === "email" ? "email" : "text"}
        value={String(value ?? "")}
        placeholder={control.kind === "text" ? control.placeholder : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
      />
    </div>
  );
}

/**
 * Settings console. Tabs are rendered from the declarative schema so a new
 * control only has to be declared once to appear in the UI.
 */
export function SettingsConsole({
  initialValues,
  editable,
}: {
  initialValues: Record<string, unknown>;
  editable: boolean;
}) {
  const [tab, setTab] = useState(SETTINGS_SCHEMA[0]?.id ?? "organisation");
  const [draft, setDraft] = useState<Draft>(initialValues);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const section = SETTINGS_SCHEMA.find((s) => s.id === tab);
    if (!section) return false;
    return section.controls.some(
      (control) => JSON.stringify(draft[control.key]) !== JSON.stringify(initialValues[control.key])
    );
  }, [draft, initialValues, tab]);

  const section = SETTINGS_SCHEMA.find((s) => s.id === tab);

  function save() {
    if (!section) return;
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const control of section.controls) payload[control.key] = draft[control.key];

    startTransition(async () => {
      const result = await saveSettings(payload);
      if (result.ok) {
        setSavedAt(
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        );
      } else {
        setError(result.error ?? "Could not save settings.");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Settings sections" className="flex min-w-max gap-1.5">
          {SETTINGS_SCHEMA.map((item) => {
            const Icon = ICONS[item.icon] ?? Sparkles;
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition",
                  active
                    ? "border-brand-ink bg-brand-ink text-brand-cream"
                    : "border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.title}
              </button>
            );
          })}
        </div>
      </div>

      {section && (
        <Card className="p-5 sm:p-6">
          <header className="mb-5">
            <h2 className="font-display text-lg font-bold">{section.title}</h2>
            <p className="mt-1 text-sm text-brand-ink/60">{section.description}</p>
          </header>

          <div className="space-y-5">
            {section.controls.map((control) => (
              <Field
                key={control.key}
                control={control}
                value={draft[control.key]}
                onChange={(next) => setDraft((prev) => ({ ...prev, [control.key]: next }))}
              />
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-brand-line pt-5">
            <span className="text-xs text-brand-ink/45" aria-live="polite">
              {pending
                ? "Saving…"
                : dirty
                  ? "You have unsaved changes"
                  : savedAt
                    ? `All changes saved at ${savedAt}`
                    : "All changes saved"}
            </span>
            <Button onClick={save} disabled={!dirty || pending || !editable}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save changes
            </Button>
          </div>

          {!editable && (
            <p className="mt-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
              Editing requires the
              <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">
                settings.manage_platform
              </code>
              permission.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}