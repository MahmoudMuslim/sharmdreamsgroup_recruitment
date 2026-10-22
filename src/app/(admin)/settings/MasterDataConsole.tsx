"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  ClipboardCheck,
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
import {
  UNAPPLIED_MASTER_LIST,
  listTwins,
  twinNotice,
} from "@/modules/settings/domain/masterDataLists";
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
  Position,
  RoleFamily,
  Skill,
} from "@/modules/settings/domain/types";

/* -------------------------------------------------------------------------- */
/* Field configuration                                                        */
/* -------------------------------------------------------------------------- */

interface FieldDef {
  name: string;
  label: string;
  /**
   * `rows` is the one kind that writes a jsonb column: the editor below keeps
   * order, and the value travels to the server as the JSON text it parses back.
   */
  kind: "text" | "textarea" | "select" | "number" | "rows";
  /** Select choices, resolved against the live dataset at render time. */
  choices?: (data: MasterData) => { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  /** Heading drawn above this field and the ones that follow it, until the next group. */
  group?: string;
  /** The ceiling the database checks, counted against as the person types. */
  max?: number;
  min?: number;
  /** Textarea height, sized to the prose a field is meant to hold. */
  lines?: number;
  /** For `rows`: what one entry is called, and the columns it holds. */
  entry?: {
    one: string;
    fields: { name: string; label: string; year?: boolean; wide?: boolean }[];
  };
}

/** Every field is rendered from these definitions, so adding one is a one-liner. */
const FIELDS: Record<MasterEntity, FieldDef[]> = {
  companies: [
    { name: "name", label: "Display name", kind: "text", required: true, group: "Naming and filing" },
    { name: "legal_name", label: "Legal name", kind: "text" },
    {
      name: "sector",
      label: "Sector",
      kind: "select",
      choices: () => SECTORS.map((s) => ({ value: s, label: SECTOR_LABELS[s] })),
    },
    { name: "country", label: "Country", kind: "text" },
    { name: "city", label: "City", kind: "text" },
    { name: "website", label: "Website", kind: "text", hint: "https://…", group: "Contact" },
    { name: "contact_email", label: "Contact email", kind: "text" },
    { name: "contact_phone", label: "Contact phone", kind: "text" },
    { name: "address", label: "Registered address", kind: "textarea" },
    {
      name: "tagline",
      label: "Tagline",
      kind: "text",
      max: 160,
      hint: "The line under the company name on the careers page.",
      group: "Careers profile",
    },
    {
      name: "description",
      label: "Description",
      kind: "textarea",
      max: 4000,
      lines: 6,
      hint: "Who this company is, in its own words.",
    },
    {
      name: "history",
      label: "History",
      kind: "textarea",
      max: 12000,
      lines: 12,
      hint: "One paragraph per blank line — a candidate reads it as the company's story.",
    },
    {
      name: "careers_pitch",
      label: "Why work here",
      kind: "textarea",
      max: 2000,
      lines: 5,
      hint: "The paragraph above this company's open roles.",
    },
    {
      name: "milestones",
      label: "History timeline",
      kind: "rows",
      hint: "In the order the page prints them. A blank year reads as \"today\".",
      entry: {
        one: "milestone",
        fields: [
          { name: "year", label: "Year", year: true },
          { name: "title", label: "Title" },
          { name: "detail", label: "Detail", wide: true },
        ],
      },
    },
    {
      name: "benefits",
      label: "What the company offers",
      kind: "rows",
      hint: "Shown as the group's own list, never as a contract.",
      entry: {
        one: "benefit",
        fields: [
          { name: "title", label: "Title" },
          { name: "text", label: "In short", wide: true },
        ],
      },
    },
    {
      name: "founded_year",
      label: "Founded",
      kind: "number",
      min: 1900,
      max: 2200,
      hint: "Feeds the \"since 1996\" figure and the timeline.",
      group: "At a glance",
    },
    { name: "headquarters", label: "Headquarters", kind: "text", hint: "As a candidate would read it." },
    { name: "ownership_type", label: "Ownership", kind: "text" },
    { name: "employee_range", label: "Headcount", kind: "text", hint: "A band, e.g. 501–1,000." },
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
  positions: [
    { name: "title", label: "Position title", kind: "text", required: true, group: "The post" },
    {
      name: "tenant_id",
      label: "Company",
      kind: "select",
      choices: (d) => [
        { value: "", label: "Group-wide (shared)" },
        ...d.companies
          .filter((c) => c.is_active && !c.is_group_profile)
          .map((c) => ({ value: c.id, label: c.name })),
      ],
      hint: "Leave as group-wide unless the post exists in one company only.",
    },
    {
      name: "department",
      label: "Department",
      kind: "select",
      required: true,
      choices: (d) => {
        const live = d.departments.filter((x) => x.is_active);
        return [
          {
            value: "",
            label: live.length ? "Choose a department" : "No departments on the list yet",
          },
          ...live.map((x) => ({ value: x.name, label: x.name })),
        ];
      },
      hint: "Stored by name, exactly as the list spells it — an opening files its department the same way.",
    },
    {
      name: "grade",
      label: "Grade",
      kind: "text",
      hint: "The internal band, e.g. G5 or Manager II. Openings do not carry it.",
    },
    {
      name: "responsibilities",
      label: "Responsibilities",
      kind: "textarea",
      max: 4000,
      lines: 8,
      group: "Copy a new opening starts from",
      hint: "What the post does. A new opening inherits this word for word as its description.",
    },
    {
      name: "requirements",
      label: "Requirements",
      kind: "textarea",
      lines: 6,
      hint: "One line per requirement — a new opening inherits them as its requirements list.",
    },
    {
      name: "min_salary_usd",
      label: "Salary from",
      kind: "number",
      group: "Salary band",
      hint: "Leave both figures blank when the band is not fixed.",
    },
    { name: "max_salary_usd", label: "Salary to", kind: "number" },
    {
      name: "salary_currency",
      label: "Currency",
      kind: "select",
      choices: (d) => {
        const live = d.currencies.filter((c) => c.is_active);
        return live.length
          ? live.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }))
          : [{ value: "USD", label: "USD — US Dollar" }];
      },
      hint: "The column names keep their historical _usd suffix; this code is the currency actually stored.",
    },
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
  { entity: "positions", singular: "position", icon: ClipboardCheck },
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
    case "positions":
      return shapeRow(entity, data.positions);
    case "skills":
      return shapeRow(entity, data.skills);
    case "currencies":
      return shapeRow(entity, data.currencies);
  }
}

type MasterRow = (Company | Department | Location | RoleFamily | Position | Skill | Currency) & {
  id: string;
  name?: string | null;
  label?: string | null;
  title?: string | null;
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
      company.city ?? company.headquarters ?? company.country,
      company.founded_year ? `since ${company.founded_year}` : null,
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
  if ("title" in row) {
    const position = row as Position;
    const money = (value: number) =>
      `${position.salary_currency} ${value.toLocaleString()}`;
    const band =
      position.min_salary_usd != null && position.max_salary_usd != null
        ? `${money(position.min_salary_usd)}–${money(position.max_salary_usd)}`
        : position.min_salary_usd != null
          ? `from ${money(position.min_salary_usd)}`
          : position.max_salary_usd != null
            ? `up to ${money(position.max_salary_usd)}`
            : null;
    return [position.department, position.grade, band].filter(Boolean).join(" · ") || null;
  }
  if ("category" in row) {
    const skill = row as Skill;
    return skill.category ?? null;
  }
  const dept = row as Department;
  return [dept.description, companyName(dept.tenant_id)].filter(Boolean).join(" · ") || null;
}

function displayName(row: MasterRow): string {
  return row.title ?? row.name ?? row.label ?? "—";
}

/** The row whose profile is the whole group's — the one the careers header reads. */
function isGroupRow(row: MasterRow): boolean {
  return (row as Company).is_group_profile === true;
}

/**
 * Whether a company has any of the profile the careers page prints.
 *
 * Named rows with nothing filed are the list's real gaps: the public page shows
 * the company's name and its roles and says nothing else about it, which is what
 * the badge below tells a recruiter to go and fill.
 */
function hasFiledProfile(row: MasterRow): boolean {
  const company = row as Company;
  return Boolean(
    company.tagline ||
      company.description ||
      company.history ||
      company.careers_pitch ||
      company.milestones?.length ||
      company.benefits?.length
  );
}

/* -------------------------------------------------------------------------- */
/* The jsonb list editor                                                       */
/* -------------------------------------------------------------------------- */

/** One entry of a `rows` field, in the shape the column stores. */
type ListEntry = Record<string, string | number | null>;

/**
 * The draft value read back as entries.
 *
 * `null` means the text is not a list this editor can draw — a column written by
 * hand, or by a migration that stored something else. The field then stays a plain
 * text box rather than showing an empty list on top of content nobody can see:
 * saving from a blank editor would silently delete what is filed.
 */
function readEntries(value: string): ListEntry[] | null {
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) =>
      item && typeof item === "object" ? (item as ListEntry) : { title: String(item ?? "") }
    );
  } catch {
    return null;
  }
}

const ROW_INPUT =
  "w-full rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-sm focus:border-brand-gold focus:outline-none";
const ROW_BUTTON =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg text-brand-ink/45 transition hover:bg-brand-sand hover:text-brand-ink disabled:opacity-30 disabled:hover:bg-transparent";

function RowsField({
  field,
  id,
  value,
  onChange,
}: {
  field: FieldDef;
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const entries = readEntries(value);
  const spec = field.entry;

  if (!entries || !spec) {
    return (
      <>
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={ROW_INPUT + " resize-y"}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
          This list is stored as text the row editor cannot read, so it stays editable as
          text. Editing it here writes exactly these characters to the column.
        </p>
      </>
    );
  }

  const write = (next: ListEntry[]) => onChange(JSON.stringify(next));

  const setEntry = (index: number, name: string, raw: string) =>
    write(entries.map((entry, i) => (i === index ? { ...entry, [name]: raw } : entry)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    write(next);
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="rounded-lg border border-dashed border-brand-line px-3 py-2 text-[11px] text-brand-ink/45">
          Nothing filed yet — the page shows no timeline for this company.
        </p>
      )}

      {entries.map((entry, index) => (
        <fieldset key={index} className="rounded-xl border border-brand-line bg-brand-cream/60 p-3">
          <legend className="sr-only">
            {spec.one} {index + 1} of {entries.length}
          </legend>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
              {spec.one} {index + 1}
            </p>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${spec.one} ${index + 1} up`}
                className={ROW_BUTTON}
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === entries.length - 1}
                aria-label={`Move ${spec.one} ${index + 1} down`}
                className={ROW_BUTTON}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => write(entries.filter((_, i) => i !== index))}
                aria-label={`Remove ${spec.one} ${index + 1}`}
                className={ROW_BUTTON + " hover:bg-rose-50 hover:text-rose-700"}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {spec.fields.map((column) => (
              <div key={column.name} className={cn(column.wide ? "block" : "flex gap-2")}>
                {column.wide && (
                  <label htmlFor={`${id}-${index}-${column.name}`} className="text-[11px] font-semibold text-brand-ink/50">
                    {column.label}
                  </label>
                )}
                {column.year ? (
                  <input
                    id={`${id}-${index}-${column.name}`}
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={2200}
                    placeholder="—"
                    aria-label={column.label}
                    value={String(entry[column.name] ?? "")}
                    onChange={(event) => setEntry(index, column.name, event.target.value)}
                    className={ROW_INPUT + " w-24 shrink-0"}
                  />
                ) : column.wide ? (
                  <textarea
                    id={`${id}-${index}-${column.name}`}
                    rows={2}
                    aria-label={column.label}
                    value={String(entry[column.name] ?? "")}
                    onChange={(event) => setEntry(index, column.name, event.target.value)}
                    className={ROW_INPUT + " mt-1 resize-y"}
                  />
                ) : (
                  <input
                    id={`${id}-${index}-${column.name}`}
                    type="text"
                    aria-label={column.label}
                    value={String(entry[column.name] ?? "")}
                    onChange={(event) => setEntry(index, column.name, event.target.value)}
                    className={ROW_INPUT}
                  />
                )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => write([...entries, {}])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add {spec.one}
      </Button>
    </div>
  );
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

  // The positions table arrives with a migration the owner has not applied yet. A
  // failed read is not an empty list, and offering an Add form would promise a save
  // that cannot land, so this section says what is missing instead.
  const unavailable = tab === "positions" && !data.positionsAvailable;
  const missingMigration = UNAPPLIED_MASTER_LIST[tab];

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
      // Positions default to the currency the migration's own column default names,
      // unless that one is retired — the write door resolves against live rows only.
      if (field.kind === "select" && field.name === "salary_currency") {
        const live = data.currencies.filter((currency) => currency.is_active);
        defaults[field.name] = (live.find((currency) => currency.code === "USD") ?? live[0])?.code ?? "USD";
      }
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
      // A jsonb list travels to the form as the JSON text its row editor reads,
      // because `String()` on an array of entries would put "[object Object]" in a
      // text box and write that back over the company's timeline on the next save.
      if (field.kind === "rows") {
        next[field.name] = Array.isArray(value) ? JSON.stringify(value) : "";
        continue;
      }
      // Requirements are stored as text[] but edited one per line; `String([...])`
      // would join them with commas and write a single run-on line back on save.
      if (tab === "positions" && field.name === "requirements" && Array.isArray(value)) {
        next[field.name] = value.join("\n");
        continue;
      }
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
              {unavailable ? "—" : rows.length}
            </span>
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-ink/50 lg:hidden">
            {navSection.hint}
          </p>
        </div>
        {editable && !unavailable && (
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
      {unavailable ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-amber-900">
            {navSection.label} have not been created on this database yet.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-amber-900/80">
            This is not an empty list.{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px]">
              {missingMigration}
            </code>{" "}
            is authored but not applied, so nothing can be saved here and no opening can
            start from a position until it is. Every other list still works.
          </p>
        </div>
      ) : rows.length === 0 ? (
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
                    {tab === "companies" && isGroupRow(row) && (
                      <Badge tone="info">Group profile</Badge>
                    )}
                    {tab === "companies" && !hasFiledProfile(row) && (
                      <Badge tone="neutral">No careers copy yet</Badge>
                    )}
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
            className="scrim-in absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <form
            ref={panelRef}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className={cn(
              // A company now carries a profile, and a position carries the copy a
              // vacancy inherits, so both get the width their prose needs; the short
              // vocabularies keep the narrow drawer.
              "absolute inset-y-0 right-0 flex w-full flex-col border-l border-brand-line bg-white shadow-2xl",
              tab === "companies" || tab === "positions" ? "max-w-2xl" : "max-w-md",
              "panel-in"
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
                {tab === "companies" && (
                  <p className="mt-1 text-xs leading-relaxed text-brand-ink/50">
                    The careers profile below is printed on the public{" "}
                    <code className="rounded bg-brand-sand px-1">/careers</code> pages, word for
                    word. A blank field shows nothing rather than a placeholder.
                    {editing && isGroupRow(editing)
                      ? " This is the group's own row: its story heads the page, and the flag that says so is not editable here."
                      : ""}
                  </p>
                )}
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
                {FIELDS[tab].map((field, index) => {
                const id = `master-${tab}-${field.name}`;
                const text = String(draft[field.name] ?? "");
                const counted = text.trim().length;
                const over = field.max !== undefined && counted > field.max;
                const choices = field.kind === "select" ? (field.choices?.(data) ?? []) : [];
                // The pickers offer live rows only, because the write door refuses
                // anything else. A record already carrying a value the list has since
                // retired still has to show it, or the form would read as cleared.
                const kept = field.kind === "select" && text !== "" && !choices.some((choice) => choice.value === text);
                const keptLabel =
                  field.name === "tenant_id"
                    ? (data.companies.find((company) => company.id === text)?.name ?? `${text.slice(0, 8)}…`)
                    : text;

                return (
                  <div key={field.name}>
                    {field.group && (
                      <p
                        className={cn(
                          "mb-3 border-t border-brand-line pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-dark",
                          index === 0 && "border-t-0 pt-0"
                        )}
                      >
                        {field.group}
                      </p>
                    )}

                    <label htmlFor={id} className="mb-1.5 block text-xs font-bold">
                      {field.label}
                      {field.required && <span className="ml-1 text-rose-600">*</span>}
                    </label>

                    {field.kind === "select" ? (
                      <select
                        id={id}
                        value={text}
                        onChange={(e) => editField(field.name, e.target.value)}
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      >
                        {choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                        {kept && (
                          <option value={text}>{`${keptLabel} — retired or no longer on the list`}</option>
                        )}
                      </select>
                    ) : field.kind === "rows" ? (
                      <RowsField
                        field={field}
                        id={id}
                        value={text}
                        onChange={(next) => editField(field.name, next)}
                      />
                    ) : field.kind === "number" ? (
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={field.min}
                        max={field.max}
                        value={text}
                        required={field.required}
                        onChange={(e) => editField(field.name, e.target.value)}
                        className="w-32 rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      />
                    ) : field.kind === "textarea" ? (
                      <textarea
                        id={id}
                        value={text}
                        rows={field.lines ?? 2}
                        onChange={(e) => editField(field.name, e.target.value)}
                        className="w-full resize-y rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      />
                    ) : (
                      <input
                        id={id}
                        type="text"
                        value={text}
                        required={field.required}
                        onChange={(e) =>
                          editField(field.name, normalise(field.name, e.target.value))
                        }
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                      />
                    )}

                    {field.hint && <p className="mt-1 text-[11px] text-brand-ink/45">{field.hint}</p>}

                    {field.max !== undefined && counted > 0 && (
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          over ? "font-semibold text-rose-700" : "text-brand-ink/45"
                        )}
                      >
                        {counted.toLocaleString()} / {field.max.toLocaleString()} characters
                        {over ? " — the careers page cannot hold this much." : ""}
                      </p>
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