"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import type {
  Company,
  Currency,
  Department,
  Location,
  MasterEntity,
  MasterPayload,
  RoleFamily,
  Skill,
} from "@/modules/settings/domain/types";
import { isSector, SECTORS } from "@/modules/settings/domain/vocabularies";
import {
  MASTER_LIST_WORDS,
  findListTwin,
  foldRowKey,
  masterRowName,
  twinRefusal,
  type MasterRowLike,
} from "@/modules/settings/domain/masterDataLists";
import { HIREABLE_STATUSES } from "@/modules/jobs/domain/hireable";
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, scalarEdits, type ActivityEntity } from "@/modules/activity/domain/trail";

/** Entities whose slug is derived from, and kept in step with, their name. */
const SLUGGED_ENTITIES = new Set<MasterEntity>(["companies", "departments"]);

/** The table behind each vocabulary, for the reads that name a changed row. */
const MASTER_TABLE: Record<MasterEntity, string> = {
  companies: "tenants_and_companies",
  departments: "departments",
  locations: "locations",
  role_families: "role_families",
  skills: "skills",
  currencies: "currencies",
};

/** What the change trail calls each vocabulary. */
const TRAIL_ENTITY: Record<MasterEntity, ActivityEntity> = {
  companies: "company",
  departments: "department",
  locations: "location",
  role_families: "role family",
  skills: "skill",
  currencies: "currency",
};

/** The list a recruiter recognises, in the words a trail row uses. */
const LIST_WORDS = MASTER_LIST_WORDS;

/** The columns read back to name a row, and to diff an edit against. */
const READ_COLUMNS: Record<MasterEntity, string> = {
  companies: "name, legal_name, slug, sector, country, city, contact_email, is_active",
  departments: "name, slug, description, is_active",
  locations: "name, city, governorate, country, timezone, is_active",
  role_families: "key, label, description, is_active",
  skills: "name, category, description, is_active",
  currencies: "code, symbol, label, is_active",
};

/** The row as a person would name it in a sentence. */
const masterName = masterRowName;

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
  currencies: ["code", "symbol", "label"],
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
  code: "currency code",
  symbol: "symbol",
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
  currencies: Currency[];
}> {
  await requireStaff("/settings");
  const supabase = await createSupabaseServerClient();

  const [companies, departments, locations, roleFamilies, skills, currencies] =
    await Promise.all([
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
      supabase
        .from("currencies")
        .select("id, code, symbol, label, is_active, sort_order")
        .order("sort_order"),
    ]);

  return {
    companies: (companies.data ?? []) as Company[],
    departments: (departments.data ?? []) as Department[],
    locations: (locations.data ?? []) as Location[],
    roleFamilies: (roleFamilies.data ?? []) as RoleFamily[],
    skills: (skills.data ?? []) as Skill[],
    currencies: (currencies.data ?? []) as Currency[],
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
  // Currencies are keyed by ISO code rather than a name, and department/location
  // still use `name`.
  if (entity !== "role_families" && entity !== "currencies" && !name) {
    return { ok: false, error: "A name is required." };
  }
  if (entity === "currencies" && !label) {
    return { ok: false, error: "A currency needs a display label." };
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

    case "currencies": {
      const code = (clean(payload.code) ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        return {
          ok: false,
          error: "A currency code must be exactly 3 letters, e.g. EGP.",
        };
      }
      row = {
        code,
        // Many currencies have no distinct glyph (EGP, AED, SAR), so the code
        // doubles as the symbol rather than leaving the field blank.
        symbol: clean(payload.symbol) ?? code,
        label,
        is_active: payload.is_active !== false,
        sort_order: Number(payload.sort_order ?? 100),
      };
      break;
    }

    default:
      return { ok: false, error: "Unknown record type." };
  }

  // A second row that reads like one already on the list is refused here, not by the
  // database: its unique indexes guard the columns a person never reads — a department
  // by slug within one tenant scope, a location by name *and* city, a skill by a
  // case-sensitive name — while a job opening stores only the words. Two rows with the
  // same words are then decided by list order everywhere else in the portal: which one
  // a filing resolves to, which one the console names, and the "in use" figure each
  // row prints, since a department or location is counted by its name.
  const added = masterName(entity, row);
  const list = await readListRows(supabase, entity);
  if (!list) return { ok: false, error: LIST_UNREADABLE };
  const twin = findListTwin(entity, list, added);
  if (twin) return { ok: false, error: twinRefusal(entity, added, masterName(entity, twin)) };

  const { data, error } = await supabase.from(MASTER_TABLE[entity]).insert(row).select("id").single();

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

  await recordActivity({
    area: "master data",
    action: "master_create",
    entity: TRAIL_ENTITY[entity],
    entityId: data?.id,
    summary: `Added ${masterName(entity, row)} to the ${LIST_WORDS[entity]} list`,
    detail: row,
  });

  revalidatePath("/settings");
  return { ok: true, id: data?.id };
}

/**
 * A master-data row exactly as it stands before a write.
 *
 * These vocabularies are addressed by a table name chosen at runtime, so the
 * typed client cannot name their columns and every read would otherwise need its
 * own cast. One helper, one cast, and the shape is whatever the table holds.
 */
async function readMasterRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entity: MasterEntity,
  id: string
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from(MASTER_TABLE[entity])
    .select(READ_COLUMNS[entity])
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Record<string, unknown> | null) ?? null;
}

/**
 * Every row of one list, retired ones included, in the order the console shows them.
 *
 * The duplicate door has to read the whole list rather than ask the database for the
 * name it was given: the match is case-insensitive, because that is how `findMasterRow`
 * resolves a filing, so `lower(name)` in a query would not be the same rule.
 *
 * `null` means the list could not be read, which is not the same as an empty list:
 * writing on top of an unread list would add the second copy this door exists to
 * refuse, silently.
 */
async function readListRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entity: MasterEntity
): Promise<MasterRowLike[] | null> {
  const { data, error } = await supabase
    .from(MASTER_TABLE[entity])
    .select(`id, ${READ_COLUMNS[entity]}`)
    .order("sort_order");
  if (error) return null;
  return (data ?? []) as unknown as MasterRowLike[];
}

/** Sent instead of a twin verdict when the list could not be read at all. */
const LIST_UNREADABLE =
  "The list could not be read, so this save cannot be checked against it. Try again.";

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

  const before = await readMasterRow(supabase, entity, id);

  if (!before) {
    return { ok: false, error: "That record is no longer in the list." };
  }

  // The row as this edit would leave it, which the trail below also prints.
  const label = masterName(entity, { ...before, ...row });

  // Only a rename is checked against the list. Editing one of two rows that already
  // read alike — or reactivating one, which is how a recruiter gets out of that state —
  // is not adding a second copy, so refusing it would block the fix.
  if (foldRowKey(label) !== foldRowKey(masterName(entity, before))) {
    const list = await readListRows(supabase, entity);
    if (!list) return { ok: false, error: LIST_UNREADABLE };
    const twin = findListTwin(entity, list, label, id);
    if (twin) return { ok: false, error: twinRefusal(entity, label, masterName(entity, twin)) };
  }

  const { error } = await supabase.from(MASTER_TABLE[entity]).update(row).eq("id", id);

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

  const edits = scalarEdits(before, row);
  if (Object.keys(edits).length > 0) {
    await recordActivity({
      area: "master data",
      action: "master_update",
      entity: TRAIL_ENTITY[entity],
      entityId: id,
      summary: `Updated ${label} in the ${LIST_WORDS[entity]} list — ${changePhrase(edits)}`,
      detail: edits,
    });
  }

  revalidatePath("/settings");
  return { ok: true, id };
}

/** A retirement, with what it found: whether the switch moved, and what still names the row. */
export type RetireResult = MutationResult & { retired?: boolean; usage?: string };

export async function deleteMasterRecord(
  entity: MasterEntity,
  id: string
): Promise<RetireResult> {
  await requireStaff("/settings");
  if (!(await canEdit())) {
    return { ok: false, error: "You need the Manage platform settings permission." };
  }

  const supabase = await createSupabaseServerClient();

  const before = await readMasterRow(supabase, entity, id);

  if (!before) return { ok: false, error: "That record is no longer in the list." };

  // Nothing is hard-deleted: companies are referenced by every other
  // tenant-scoped table, and a retired department or location keeps existing
  // jobs and attempts resolvable.
  const { error } = await supabase
    .from(MASTER_TABLE[entity])
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Nothing still-active to retire means the switch was already off; a trail row
  // for that would count a change nobody made.
  const wasActive = before.is_active !== false;
  let usage: string | null = null;
  if (wasActive) {
    const count = await masterUsage(supabase, entity, id, before);
    usage = usageWords(count);
    await recordActivity({
      area: "master data",
      action: "master_retire",
      entity: TRAIL_ENTITY[entity],
      entityId: id,
      summary: `Retired ${masterName(entity, before)} from the ${LIST_WORDS[entity]} list — ${usage}`,
      detail: {
        is_active: "active → retired",
        note: "The row stays so existing jobs, candidates and reports still resolve.",
      },
    });
  }

  revalidatePath("/settings");
  return {
    ok: true,
    id,
    retired: wasActive,
    usage:
      usage ??
      `Already retired — nothing was written. Read it with get_master_data (entity ${LIST_WORDS[entity]}) and set is_active back to true to bring it in use again.`,
  };
}

/**
 * How many hireable openings still carry this record's name, as a floor.
 *
 * An opening points at its company by id and at its department and location by the
 * *text the form stored*, so a vocabulary row is only counted where that text equals
 * its name character for character. Measured against the live database: of 7 hireable
 * openings, 3 spell a department the way its row is named and 2 spell a location so —
 * the rest hold shortened or qualified text ("Finance" where the row reads "Finance &
 * Investment"), which no lookup by name can reach. So the count says how many were
 * *found*, never how many exist, and a zero is not proof that nothing uses the row.
 *
 * Skills, currencies and role families are not named on an opening at all, so they
 * report `null` — no count — rather than a zero that reads like a clean answer.
 */
async function masterUsage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entity: MasterEntity,
  id: string,
  row: Record<string, unknown>
): Promise<number | null> {
  if (entity === "skills" || entity === "currencies" || entity === "role_families") return null;

  let query = supabase.from("job_openings").select("id");
  if (entity === "companies") {
    query = query.eq("tenant_id", id);
  } else {
    const name = String(row.name ?? "").trim();
    if (!name) return null;
    query = query.eq(entity === "departments" ? "department" : "location", name);
  }

  const { data } = await query.in("status", [...HIREABLE_STATUSES]);

  return (data ?? []).length;
}

/** The count above, in the words a trail row and a chat answer both print. */
function usageWords(count: number | null): string {
  if (count === null) {
    return "Openings do not name this kind of record, so nothing was counted.";
  }
  if (count === 0) {
    return "No hireable opening carries this name as written. An opening that spells it differently is not counted, so this is a floor, not proof that nothing uses it.";
  }
  return `${count.toLocaleString()} hireable ${
    count === 1 ? "opening names" : "openings name"
  } it as written — a floor, since an opening that spells the name differently is not counted.`;
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
  currencies: { id: string; code: string; symbol: string; label: string }[];
}> {
  const supabase = await createSupabaseServerClient();

  const [companies, departments, locations, roleFamilies, skills, currencies] = await Promise.all([
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
    supabase
      .from("currencies")
      .select("id, code, symbol, label")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  return {
    companies: (companies.data ?? []) as { id: string; name: string; sector: string }[],
    departments: (departments.data ?? []) as { id: string; name: string }[],
    locations: (locations.data ?? []) as { id: string; name: string; city: string | null }[],
    roleFamilies: (roleFamilies.data ?? []) as { id: string; key: string; label: string }[],
    skills: (skills.data ?? []) as { id: string; name: string; category: string | null }[],
    currencies: (currencies.data ?? []) as {
      id: string;
      code: string;
      symbol: string;
      label: string;
    }[],
  };
}