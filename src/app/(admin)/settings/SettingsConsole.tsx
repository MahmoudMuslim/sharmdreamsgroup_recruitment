"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bell,
  Building2,
  Check,
  ClipboardCheck,
  Loader2,
  Plug,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { SETTINGS_SCHEMA, UNENFORCED_SETTING_KEYS } from "@/modules/settings/domain/schema";
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

function UnenforcedBadge() {
  return (
    <span className="ml-2 rounded-full border border-brand-line bg-brand-cream px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-brand-ink/50">
      Not enforced yet
    </span>
  );
}

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
  const unenforced = UNENFORCED_SETTING_KEYS.has(control.key);

  if (control.kind === "toggle") {
    const on = value === true;
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm font-semibold">
            {control.label}
            {unenforced && <UnenforcedBadge />}
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
          {unenforced && <UnenforcedBadge />}
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
        <legend className="mb-1.5 text-sm font-semibold">
          {control.label}
          {unenforced && <UnenforcedBadge />}
        </legend>
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
          {unenforced && <UnenforcedBadge />}
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
        {unenforced && <UnenforcedBadge />}
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
 * Settings console for one section of the Platform area.
 *
 * Which section is open comes from the URL, decided by the dock in
 * `SettingsShell` — the console used to carry its own tab strip, which meant
 * two navigation rows on screen at once and a settings page that scrolled
 * horizontally twice.
 */
export function SettingsConsole({
  initialValues,
  editable,
  section,
}: {
  initialValues: Record<string, unknown>;
  editable: boolean;
  section: string;
}) {
  const [draft, setDraft] = useState<Draft>(initialValues);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const active = SETTINGS_SCHEMA.find((s) => s.id === section) ?? SETTINGS_SCHEMA[0];
  const Icon = ICONS[active?.icon ?? ""] ?? Sparkles;

  const dirty = useMemo(() => {
    if (!active) return false;
    return active.controls.some(
      (control) => JSON.stringify(draft[control.key]) !== JSON.stringify(initialValues[control.key])
    );
  }, [draft, initialValues, active]);

  const visible = useMemo(() => {
    if (!active) return [];
    const q = query.trim().toLowerCase();
    if (!q) return active.controls;
    return active.controls.filter(
      (control) =>
        control.label.toLowerCase().includes(q) ||
        control.key.toLowerCase().includes(q) ||
        (control.help ?? "").toLowerCase().includes(q)
    );
  }, [active, query]);

  if (!active) return null;

  function save() {
    if (!active) return;
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const control of active.controls) payload[control.key] = draft[control.key];

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

  /** Drops this section's edits only; other sections keep whatever is pending. */
  function reset() {
    setError(null);
    setDraft((prev) => {
      const next = { ...prev };
      for (const control of active.controls) next[control.key] = initialValues[control.key];
      return next;
    });
  }

  return (
    <Card className="overflow-hidden">
      {/* Mobile section heading — on desktop the dock already shows it. */}
      <header className="flex items-center gap-2.5 border-b border-brand-line bg-brand-cream px-5 py-4 lg:hidden">
        <Icon className="h-4 w-4 text-brand-gold-dark" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold">{active.title}</h2>
          <p className="truncate text-xs text-brand-ink/55">{active.description}</p>
        </div>
      </header>

      {active.controls.length > 4 && (
        <div className="flex items-center gap-2 border-b border-brand-line px-5 py-3">
          <Search className="h-4 w-4 shrink-0 text-brand-ink/35" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${active.controls.length} settings in “${active.title}”…`}
            aria-label="Search settings"
            className="w-full bg-transparent text-sm placeholder:text-brand-ink/35 focus:outline-none"
          />
          {query && (
            <span className="shrink-0 text-xs font-semibold text-brand-ink/45">
              {visible.length}/{active.controls.length}
            </span>
          )}
        </div>
      )}

      <div className="space-y-6 p-5 sm:p-6">
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-brand-line bg-brand-cream px-4 py-10 text-center text-sm text-brand-ink/55">
            Nothing in “{active.title}” matches “{query}”.
          </p>
        ) : (
          visible.map((control) => (
            <div key={control.key} className="group -mx-2 rounded-xl px-2 py-1 transition hover:bg-brand-cream/70">
              <Field
                control={control}
                value={draft[control.key]}
                onChange={(next) => setDraft((prev) => ({ ...prev, [control.key]: next }))}
              />
              <p className="mt-1 font-mono text-[10px] text-brand-ink/25 opacity-0 transition group-hover:opacity-100">
                {control.key}
              </p>
            </div>
          ))
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        {!editable && (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
            Editing requires the
            <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">
              settings.manage_platform
            </code>
            permission.
          </p>
        )}
      </div>

      {/* Save bar stays visible while the section is scrolled. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-brand-line bg-brand-cream/95 px-5 py-3.5 backdrop-blur">
        <span className="flex items-center gap-2 text-xs text-brand-ink/55" aria-live="polite">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              dirty ? "bg-amber-500" : "bg-emerald-500"
            )}
            aria-hidden
          />
          {pending
            ? "Saving…"
            : dirty
              ? "Unsaved changes in this section"
              : savedAt
                ? `Saved at ${savedAt}`
                : "Everything saved"}
        </span>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || pending || !editable}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}