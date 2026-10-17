"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  GraduationCap,
  Loader2,
  MapPin,
  Network,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  createMasterRecord,
  deleteMasterRecord,
  updateMasterRecord,
} from "@/modules/settings/application/master-data-actions";
import { SECTORS, SECTOR_LABELS } from "@/modules/settings/domain/vocabularies";
import { listTwins, twinNotice } from "@/modules/settings/domain/masterDataLists";
import { areaById, sectionFor } from "@/modules/settings/domain/settingsNav";
import { Badge, Button } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type {
  Company,
  Currency,
  Department,
  Location,
  MasterData,
  MasterEntity,
  MasterPayload,
  RoleFamily,
  Skill,
} from "@/modules/settings/domain/types";

/* -------------------------------------------------------------------------- */
/* Field configuration                                                        */
/* -------------------------------------------------------------------------- */

interface FieldDef {
  name: string;
  label: string;
  kind: "text" | "textarea" | "select";
  /** Select choices, resolved against the live dataset at render time. */
  choices?: (data: MasterData) => { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}

/** Every field is rendered from these definitions, so adding one is a one-liner. */
const FIELDS: Record<MasterEntity, FieldDef[]> = {
  companies: [
    { name: "name", label: "Display name", kind: "text", required: true },
    { name: "legal_name", label: "Legal name", kind: "text" },
    {
      name: "sector",
      label: "Sector",
      kind: "select",
      choices: () => SECTORS.map((s) => ({ value: s, label: SECTOR_LABELS[s] })),
    },
    { name: "city", label: "City", kind: "text" },
    { name: "country", label: "Country", kind: "text" },
    { name: "website", label: "Website", kind: "text", hint: "https://…" },
    { name: "contact_email", label: "Contact email", kind: "text" },
    { name: "contact_phone", label: "Contact phone", kind: "text" },
    { name: "address", label: "Registered address", kind: "textarea" },
  ],
  departments: [
    { name: "name", label: "Department name", kind: "text", required: true },
    {
      name: "tenant_id",
      label: "Company",
      kind: "select",
      choices: (d) => [
        { value: "", label: "Group-wide (shared)" },
        ...d.companies.map((c) => ({ value: c.id, label: c.name })),
      ],
      hint: "Leave as group-wide unless this department belongs to one company only.",
    },
    { name: "description", label: "Description", kind: "textarea" },
  ],
  locations: [
    { name: "name", label: "Location name", kind: "text", required: true },
    { name: "city", label: "City", kind: "text" },
    { name: "governorate", label: "Governorate", kind: "text" },
    { name: "country", label: "Country", kind: "text" },
    { name: "timezone", label: "Time zone", kind: "text", hint: "Africa/Cairo" },
    {
      name: "tenant_id",
      label: "Company",
      kind: "select",
      choices: (d) => [
        { value: "", label: "Group-wide (shared)" },
        ...d.companies.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
  ],
  role_families: [
    { name: "label", label: "Family label", kind: "text", required: true },
    {
      name: "key",
      label: "Key",
      kind: "text",
      hint: "Derived from the label when left blank. Assessment suites store this key as their role family.",
    },
    {
      name: "department_id",
      label: "Department",
      kind: "select",
      choices: (d) => [
        { value: "", label: "No department" },
        ...d.departments.map((x) => ({ value: x.id, label: x.name })),
      ],
    },
    { name: "description", label: "Description", kind: "textarea" },
  ],
  skills: [
    { name: "name", label: "Skill name", kind: "text", required: true },
    { name: "category", label: "Category", kind: "text", hint: "Technical, Soft, Commercial…" },
    { name: "description", label: "Description", kind: "textarea" },
  ],
  currencies: [
    {
      name: "code",
      label: "Currency code",
      kind: "text",
      required: true,
      hint: "ISO 4217 — 3 letters, e.g. EGP.",
    },
    {
      name: "symbol",
      label: "Symbol",
      kind: "text",
      hint: "Shown next to salary figures. Leave blank to use the code.",
    },
    { name: "label", label: "Display name", kind: "text", required: true },
  ],
};

/**
 * Per-entity bits the dock's nav entry cannot carry: the singular noun used in
 * buttons and the icon. Labels and descriptions come from `SETTINGS_NAV` so the
 * navigation and the panel can never call an entity two different things.
 */
const ENTITY_META: {
  entity: MasterEntity;
  /** Explicit singular — naive plural-stripping mangles "Companies" to "Compani". */
  singular: string;
  icon: typeof Building2;
}[] = [
  { entity: "companies", singular: "company", icon: Building2 },
  { entity: "departments", singular: "department", icon: Network },
  { entity: "locations", singular: "location", icon: MapPin },
  { entity: "role_families", singular: "role family", icon: BriefcaseBusiness },
  { entity: "skills", singular: "skill", icon: GraduationCap },
  { entity: "currencies", singular: "currency", icon: CircleDollarSign },
];

/* -------------------------------------------------------------------------- */
/* Row helpers                                                                */
/* -------------------------------------------------------------------------- */

/** The fields that actually arrived for this entity. */
function shapeRow<T extends { id: string }>(entity: MasterEntity, rows: T[]): Array<T & { id: string }> {
  return rows as Array<T & { id: string }>;
}

function rowsFor(data: MasterData, entity: MasterEntity): MasterRow[] {
  switch (entity) {
    case "companies":
      return shapeRow(entity, data.companies);
    case "departments":
      return shapeRow(entity, data.departments);
    case "locations":
      return shapeRow(entity, data.locations);
    case "role_families":
      return shapeRow(entity, data.roleFamilies);
    case "skills":
      return shapeRow(entity, data.skills);
    case "currencies":
      return shapeRow(entity, data.currencies);
  }
}

type MasterRow = (Company | Department | Location | RoleFamily | Skill | Currency) & {
  id: string;
  name?: string | null;
  label?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  governorate?: string | null;
  sector?: string | null;
  category?: string | null;
  key?: string | null;
  code?: string | null;
  symbol?: string | null;
  is_active: boolean;
};

/** Secondary line shown under the name in the list. */
function subline(row: MasterRow, data: MasterData): string | null {
  const companyName = (id: string | null | undefined) =>
    id ? (data.companies.find((c) => c.id === id)?.name ?? null) : null;

  if ("code" in row && row.code) {
    const currency = row as Currency;
    // Only show the symbol when it differs from the code, so EGP does not read
    // as "EGP · EGP".
    return currency.symbol && currency.symbol !== currency.code
      ? `${currency.code} · ${currency.symbol}`
      : currency.code;
  }
  if ("legal_name" in row) {
    const company = row as Company;
    const bits = [
      SECTOR_LABELS[company.sector as keyof typeof SECTOR_LABELS],
      company.city,
      company.country,
    ].filter(Boolean);
    return bits.length ? bits.join(" · ") : null;
  }
  if ("governorate" in row) {
    const loc = row as Location;
    const bits = [loc.city, loc.governorate, loc.country, companyName(loc.tenant_id)].filter(
      Boolean
    );
    return bits.length ? bits.join(" · ") : null;
  }
  if ("key" in row) {
    const family = row as RoleFamily;
    const dept = family.department_id
      ? data.departments.find((d) => d.id === family.department_id)?.name
      : null;
    return [family.key, dept].filter(Boolean).join(" · ") || null;
  }
  if ("category" in row) {
    const skill = row as Skill;
    return skill.category ?? null;
  }
  const dept = row as Department;
  return [dept.description, companyName(dept.tenant_id)].filter(Boolean).join(" · ") || null;
}

function displayName(row: MasterRow): string {
  return row.name ?? row.label ?? "—";
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function MasterDataConsole({
  data,
  editable,
  section,
}: {
  data: MasterData;
  editable: boolean;
  /** Which entity is open, from the dock's URL — see `SETTINGS_NAV`. */
  section: string;
}) {
  const meta = ENTITY_META.find((m) => m.entity === section) ?? ENTITY_META[1];
  const tab = meta.entity;
  const navSection = sectionFor(areaById("organisation"), tab);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MasterPayload>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = rowsFor(data, tab);
  const activeTab = meta;

  // Names the list holds twice, from the rows already loaded for this section. The
  // write door refuses a second copy, so anything here is a state the console has to
  // show rather than prevent — and an opening filed under one of these names means
  // whichever row `sort_order` puts first.
  const twins = listTwins(tab, rows);
  const twice = new Set(twins.flatMap((twin) => twin.ids));

  // The section now comes from the URL, so switching entity can happen with the
  // drawer still open. A draft half-filled for "Departments" must never be
  // written to "Locations", so changing entity always closes the panel.
  const [lastTab, setLastTab] = useState(tab);
  if (lastTab !== tab) {
    setLastTab(tab);
    setCreating(false);
    setEditing(null);
    setError(null);
    setSaved(false);
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setError(null);
    setSaved(false);
    // Sensible defaults so the form is never mysteriously blank.
    const defaults: MasterPayload = { is_active: true };
    for (const field of FIELDS[tab]) {
      if (field.kind === "select" && field.name === "sector") defaults[field.name] = "HOSPITALITY";
      if (field.kind === "text" && field.name === "country") defaults[field.name] = "Egypt";
      if (field.kind === "text" && field.name === "timezone") defaults[field.name] = "Africa/Cairo";
    }
    setDraft(defaults);
  }

  function openEdit(row: MasterRow) {
    setEditing(row);
    setCreating(false);
    setError(null);
    setSaved(false);
    // Only seed the fields this entity actually declares, so a stale column on
    // another entity can never be written back.
    const next: MasterPayload = { is_active: row.is_active };
    for (const field of FIELDS[tab]) {
      const value = (row as unknown as Record<string, unknown>)[field.name];
      next[field.name] = value === null || value === undefined ? "" : String(value);
    }
    setDraft(next);
  }

  function close() {
    setCreating(false);
    setEditing(null);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const payload: MasterPayload = { ...draft };
      if (typeof payload.is_active !== "boolean") payload.is_active = true;

      const result = creating
        ? await createMasterRecord(tab, payload)
        : editing
          ? await updateMasterRecord(tab, editing.id, payload)
          : { ok: false, error: "Nothing to save." };

      if (result.ok) {
        setSaved(true);
        // Let the confirmation register before the dialog closes.
        setTimeout(close, 650);
      } else {
        setError(result.error ?? "Could not save.");
      }
    });
  }

  function retire(row: MasterRow) {
    const label = displayName(row);
    if (!window.confirm(`Retire “${label}”? Existing records keep their link, but it disappears from new selections.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteMasterRecord(tab, row.id);
      if (!result.ok) setError(result.error ?? "Could not retire that entry.");
    });
  }

  function reactivate(row: MasterRow) {
    startTransition(async () => {
      const result = await updateMasterRecord(tab, row.id, { is_active: true });
      if (!result.ok) setError(result.error ?? "Could not reactivate that entry.");
    });
  }

  const open = creating || editing !== null;
  const Icon = activeTab.icon;
  const panelRef = useRef<HTMLFormElement>(null);

  /** Escape closes the panel; focus moves in on open so keyboard users land inside. */
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>("input, textarea, select");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, tab]);

  /** Typing clears the previous verdict — a stale error misleads. */
  function editField(name: string, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
    if (error) setError(null);
    if (saved) setSaved(false);
  }

  /** Field-level input normalisation applied as the user types. */
  function normalise(name: string, value: string): string {
    // ISO codes are conventionally uppercase and the server rejects anything
    // else, so normalise here rather than letting the user discover it on save.
    if (name === "code") return value.toUpperCase();
    return value;
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <Icon className="h-[18px] w-[18px] text-brand-gold-dark" aria-hidden />
            {navSection.label}
            <span className="rounded-full bg-brand-sand px-2 py-0.5 text-[11px] font-bold text-brand-ink/55">
              {rows.length}
            </span>
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-ink/50 lg:hidden">
            {navSection.hint}
          </p>
        </div>
        {editable && (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add {activeTab.singular}
          </Button>
        )}
      </header>

      {twins.length > 0 && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
          {twinNotice(tab, twins)}
        </p>
      )}

      {error && !open && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* List */}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-brand-line bg-brand-cream px-4 py-8 text-center text-sm text-brand-ink/50">
          No {navSection.label.toLowerCase()} yet.
          {editable ? " Use “Add” to create the first one." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-brand-line rounded-xl border border-brand-line">
          {rows.map((row) => {
            const secondary = subline(row, data);
            return (
              <li
                key={row.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-3",
                  !row.is_active && "opacity-60"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {displayName(row)}
                    {!row.is_active && <Badge tone="neutral">Retired</Badge>}
                    {twice.has(row.id) && <Badge tone="gold">Named twice</Badge>}
                  </p>
                  {secondary && <p className="mt-0.5 truncate text-xs text-brand-ink/50">{secondary}</p>}
                </div>

                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    {row.is_active ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          aria-label={`Edit ${displayName(row)}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-brand-sand hover:text-brand-ink"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => retire(row)}
                          aria-label={`Retire ${displayName(row)}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => reactivate(row)}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Create / edit side panel — keeps the list visible so you can see what you're
          adding against, which a centred modal hid. */}
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="master-panel-title">
          <button
            type="button"
            aria-label="Close panel"
            onClick={close}
            className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <form
            ref={panelRef}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className={cn(
              "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-brand-line bg-white shadow-2xl",
              "animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
            )}
          >
            <header className="flex items-start justify-between gap-3 border-b border-brand-line p-5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                  {navSection.label}
                </p>
                <h3 id="master-panel-title" className="mt-0.5 truncate font-display text-lg font-bold">
                  {creating
                    ? `Add ${activeTab.singular}`
                    : `Edit ${displayName(editing as MasterRow)}`}
                </h3>
                <p className="mt-1 text-xs text-brand-ink/50">
                  {creating
                    ? "Available across the platform as soon as you save."
                    : "Changes apply everywhere this entry is selected."}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close panel"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            {/* Scrollable body keeps the actions pinned to the bottom on tall forms. */}
            <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              <div className="grid grid-cols-1 gap-4">
                {FIELDS[tab].map((field) => {
                const id = `master-${tab}-${field.name}`;
                const value = draft[field.name] ?? "";
                const wide = field.kind === "textarea";

                return (
                  <div key={field.name} className={cn(wide && "sm:col-span-2")}>
                    <label htmlFor={id} className="mb-1.5 block text-xs font-bold">
                      {field.label}
                      {field.required && <span className="ml-1 text-rose-600">*</span>}
                    </label>

                    {field.kind === "select" ? (
                      <select
                        id={id}
                        value={String(value)}
                        onChange={(e) => editField(field.name, e.target.value)}
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      >
                        {(field.choices?.(data) ?? []).map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    ) : field.kind === "textarea" ? (
                      <textarea
                        id={id}
                        value={String(value)}
                        rows={2}
                        onChange={(e) => editField(field.name, e.target.value)}
                        className="w-full resize-y rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      />
                    ) : (
                      <input
                        id={id}
                        type="text"
                        value={String(value)}
                        required={field.required}
                        onChange={(e) =>
                          editField(field.name, normalise(field.name, e.target.value))
                        }
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      />
                    )}

                    {field.hint && (
                      <p className="mt-1 text-[11px] text-brand-ink/45">{field.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">
                <Sparkles className="h-4 w-4" aria-hidden />
                Saved.
              </p>
            )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-brand-line bg-brand-cream p-5">
              <p className="text-[11px] leading-relaxed text-brand-ink/45">
                {creating
                  ? "Saved entries become selectable immediately."
                  : "Retiring keeps existing records intact."}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {creating ? "Add" : "Save changes"}
                </Button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}