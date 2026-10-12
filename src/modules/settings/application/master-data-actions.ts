"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import type {
  Company,
  Department,
  Location,
  MasterEntity,
  MasterPayload,
  RoleFamily,
  Skill,
} from "@/modules/settings/domain/types";
import { isSector, SECTORS } from "@/modules/settings/domain/vocabularies";

/** Entities whose slug is derived from, and kept in step with, their name. */
const SLUGGED_ENTITIES = new Set<MasterEntity>(["companies", "departments"]);

/**
 * Columns the database declares NOT NULL.
 *
 * The edit form always submits every declared field, so clearing a required one
 * has to fail with a readable message rather than a raw constraint error.
 */
const REQUIRED_COLUMNS: Record<MasterEntity, readonly string[]> = {
  companies: ["name", "slug", "sector", "country"],
  departments: ["name", "slug"],
  locations: ["name", "country", "timezone"],
  role_families: ["key", "label"],
  skills: ["name"],
};

/** Human-readable labels for the required-column validation message. */
const REQUIRED_LABELS: Record<string, string> = {
  name: "name",
  label: "label",
  slug: "name",
  key: "key",
  sector: "sector",
  country: "country",
  timezone: "time zone",
};

/** Turns a label into a stable, URL-safe slug. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : null;
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Loads every controlled vocabulary in one pass.
 *
 * Rows are returned even when inactive so recruiters can see (and re-activate)
 * retired entries rather than losing them from history.
 */
export async function getMasterData(): Promise<{
  companies: Company[];
  departments: Department[];
  locations: Location[];
  roleFamilies: RoleFamily[];
  skills: Skill[];
}> {
  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const [companies, departments, locations, roleFamilies, skills] = await Promise.all([
    supabase
      .from("tenants_and_companies")
      .select(
        "id, name, legal_name, slug, sector, country, website, contact_email, contact_phone, address, city, logo_url, is_active, sort_order"
      )
      .order("sort_order"),
    supabase
      .from("departments")
      .select("id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order")
      .order("sort_order"),
    supabase
      .from("locations")
      .select(
        "id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order"
      )
      .order("sort_order"),
    supabase
      .from("role_families")
      .select("id, key, label, description, department_id, is_active, sort_order")
      .order("sort_order"),
    supabase
      .from("skills")
      .select("id, name, category, description, is_active, sort_order")
      .order("sort_order"),
  ]);

  return {
    companies: (companies.data ?? []) as Company[],
    departments: (departments.data ?? []) as Department[],
    locations: (locations.data ?? []) as Location[],
    roleFamilies: (roleFamilies.data ?? []) as RoleFamily[],
    skills: (skills.data ?? []) as Skill[],
  };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

export type MutationResult = { ok: boolean; error?: string; id?: string };

/** Everyone who can reach /settings may edit master data they have rights to. */
async function canEdit(): Promise<boolean> {
  const platform = await hasPermissionForUser("settings.manage_platform");
  if (platform) return true;
  return hasPermissionForUser("companies.manage");
}

export async function createMasterRecord(
  entity: MasterEntity,
  payload: MasterPayload
): Promise<MutationResult> {
  await requireStaff("/settings");
  if (!(await canEdit())) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const supabase = await createSupabaseServerClient();

  const name = clean(payload.name);
  const label = clean(payload.label);

  if (entity === "role_families" && !label) {
    return { ok: false, error: "A role family needs a label." };
  }
  if (entity !== "role_families" && !name) {
    return { ok: false, error: "A name is required." };
  }

  let row: Record<string, unknown>;

  switch (entity) {
    case "companies": {
      const slug = slugify(name ?? "");
      if (!slug) return { ok: false, error: "Could not derive a slug from that name." };

      // `sector` is a Postgres enum, so an unknown value would otherwise surface
      // as an opaque "invalid input value for enum" error.
      const sector = clean(payload.sector) ?? "HOSPITALITY";
      if (!isSector(sector)) {
        return { ok: false, error: `Sector must be one of: ${SECTORS.join(", ")}.` };
      }

      row = {
        name,
        slug,
        legal_name: clean(payload.legal_name),
        sector,
        country: clean(payload.country) ?? "Egypt",
        website: clean(payload.website),
        contact_email: clean(payload.contact_email),
        contact_phone: clean(payload.contact_phone),
        address: clean(payload.address),
        city: clean(payload.city),
        logo_url: clean(payload.logo_url),
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    case "departments": {
      const slug = slugify(name ?? "");
      if (!slug) return { ok: false, error: "Could not derive a slug from that name." };
      row = {
        name,
        slug,
        tenant_id: clean(payload.tenant_id),
        description: clean(payload.description),
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    case "locations": {
      row = {
        name,
        tenant_id: clean(payload.tenant_id),
        city: clean(payload.city),
        governorate: clean(payload.governate),
        country: clean(payload.country) ?? "Egypt",
        timezone: clean(payload.timezone) ?? "Africa/Cairo",
        address: clean(payload.address),
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    case "role_families": {
      const key = (clean(payload.key) ?? slugify(label ?? "")).toUpperCase().replace(/-/g, "_");
      if (!key) return { ok: false, error: "Could not derive a key from that label." };
      row = {
        key,
        label,
        description: clean(payload.description),
        department_id: clean(payload.department_id),
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    case "skills": {
      row = {
        name,
        category: clean(payload.category),
        description: clean(payload.description),
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    default:
      return { ok: false, error: "Unknown record type." };
  }

  const { data, error } = await supabase.from(entity).insert(row).select("id").single();

  if (error) {
    // Unique-constraint collisions are the common case and deserve a clear message.
    if (error.code === "23505") {
      return { ok: false, error: "That name or key is already in use." };
    }
    if (error.code === "22P02") {
      return { ok: false, error: "One of the values supplied was not valid." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings");
  return { ok: true, id: data?.id };
}

export async function updateMasterRecord(
  entity: MasterEntity,
  id: string,
  payload: MasterPayload
): Promise<MutationResult> {
  await requireStaff("/settings");
  if (!(await canEdit())) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const supabase = await createSupabaseServerClient();

  // Only copy keys that were actually supplied, so a partial edit is safe.
  //
  // The form submits every declared field on every save, and an empty <select>
  // yields "" — which Postgres rejects for uuid/enum/numeric columns with an
  // opaque "invalid input syntax" error. Normalise "" to NULL, but never on a
  // column the database requires.
  const row: Record<string, unknown> = {};
  const required = REQUIRED_COLUMNS[entity];

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;

    if (value === "" && !required.includes(key)) {
      row[key] = null;
      continue;
    }

    if (value === "" && required.includes(key)) {
      return {
        ok: false,
        error: `A ${REQUIRED_LABELS[key] ?? key} is required.`,
      };
    }

    row[key] = value;
  }

  if (Object.keys(row).length === 0) {
    return { ok: false, error: "Nothing to save." };
  }

  // Keep slugs in step with renamed entities so links stay stable.
  if (typeof payload.name === "string" && SLUGGED_ENTITIES.has(entity)) {
    const next = slugify(payload.name);
    if (!next) return { ok: false, error: "That name cannot be turned into a URL slug." };
    row.slug = next;
  }

  const { error } = await supabase.from(entity).update(row).eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That name or key is already in use." };
    }
    // Postgres type errors are unreadable in the UI — translate the ones we can.
    if (error.code === "22P02") {
      return { ok: false, error: "One of the values supplied was not valid." };
    }
    if (error.code === "23502") {
      return { ok: false, error: "A required field was left empty." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings");
  return { ok: true, id };
}

export async function deleteMasterRecord(
  entity: MasterEntity,
  id: string
): Promise<MutationResult> {
  await requireStaff("/settings");
  if (!(await canEdit())) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const supabase = await createSupabaseServerClient();

  // Companies are referenced by every other tenant-scoped table, so retire
  // rather than delete and break historical records.
  if (entity === "companies") {
    const { error } = await supabase
      .from("tenants_and_companies")
      .update({ is_active: false })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true, id };
  }

  // Everything else retires too, so existing jobs/attempts keep resolving.
  const { error } = await supabase.from(entity).update({ is_active: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, id };
}

/* -------------------------------------------------------------------------- */
/* Select options for the rest of the app                                     */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight, cacheable option lists used by selects in jobs, assessments and
 * onboarding. Returns only active rows.
 */
export async function getMasterOptions(): Promise<{
  companies: { id: string; name: string; sector: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string; city: string | null }[];
  roleFamilies: { id: string; key: string; label: string }[];
  skills: { id: string; name: string; category: string | null }[];
}> {
  const supabase = await createSupabaseServerClient();

  const [companies, departments, locations, roleFamilies, skills] = await Promise.all([
    // `sector` is included so job creation can pre-fill it from the company.
    supabase
      .from("tenants_and_companies")
      .select("id, name, sector")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("locations").select("id, name, city").eq("is_active", true).order("sort_order"),
    supabase.from("role_families").select("id, key, label").eq("is_active", true).order("sort_order"),
    supabase.from("skills").select("id, name, category").eq("is_active", true).order("sort_order"),
  ]);

  return {
    companies: (companies.data ?? []) as { id: string; name: string; sector: string }[],
    departments: (departments.data ?? []) as { id: string; name: string }[],
    locations: (locations.data ?? []) as { id: string; name: string; city: string | null }[],
    roleFamilies: (roleFamilies.data ?? []) as { id: string; key: string; label: string }[],
    skills: (skills.data ?? []) as { id: string; name: string; category: string | null }[],
  };
}