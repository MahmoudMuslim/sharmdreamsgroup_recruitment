import "server-only";

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { MASTER_LIST_WORDS } from "@/modules/settings/domain/masterDataLists";
import {
  resolveFiling,
  type FilingKey,
  type FilingRow,
  type FilingVocabularies,
  type FiledEntity,
} from "@/modules/settings/domain/masterDataFiling";

type StaffClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The four vocabularies a job opening names, read live.
 *
 * `job_openings` stores a company by id and a department, a location and a salary
 * currency as *text*, so nothing at the database level stops an opening filing
 * itself under "Finance" when the department list only holds "Finance & Investment".
 * Measured against the live database, 5 of the 7 openings do exactly that.
 *
 * The read deliberately keeps retired rows: a write has to tell "this list does not
 * hold that name" apart from "it does, but it is retired", and the drawer needs the
 * same distinction to label a value a legacy opening already carries.
 */
const FILING_FIELDS: readonly {
  entity: FiledEntity;
  field: "tenant_id" | "department" | "location" | "salary_currency";
  by: FilingKey;
  table: string;
  columns: string;
}[] = [
  {
    entity: "companies",
    field: "tenant_id",
    by: "id",
    table: "tenants_and_companies",
    columns: "id, name, is_active",
  },
  { entity: "departments", field: "department", by: "name", table: "departments", columns: "id, name, is_active" },
  { entity: "locations", field: "location", by: "name", table: "locations", columns: "id, name, is_active" },
  {
    entity: "currencies",
    field: "salary_currency",
    by: "code",
    table: "currencies",
    columns: "id, code, label, is_active",
  },
];

/** The four fields an opening files itself under, as the writer sends them. */
export interface JobFilingFields {
  tenant_id: string;
  department: string;
  location: string;
  salary_currency: string;
}

export interface FilingRead {
  vocabularies: FilingVocabularies;
  /** Lists the database would not return, named so a write can refuse instead of guessing. */
  unreadable: FiledEntity[];
}

/** Every row of the four lists, in the order the console shows them. */
export async function getFilingVocabularies(supabase: StaffClient): Promise<FilingRead> {
  const reads = await Promise.all(
    FILING_FIELDS.map(({ table, columns }) =>
      supabase.from(table).select(columns).order("sort_order")
    )
  );

  const vocabularies = {} as FilingVocabularies;
  const unreadable: FiledEntity[] = [];
  FILING_FIELDS.forEach(({ entity }, index) => {
    const { data, error } = reads[index];
    if (error) unreadable.push(entity);
    vocabularies[entity] = (data ?? []) as FilingRow[];
  });

  return { vocabularies, unreadable };
}

/**
 * The four filing values, in the vocabulary's own spelling — or the refusal.
 *
 * `stored` is what an existing opening already holds. Passing it lets a recruiter
 * fix a title on a role seeded before the master tables were populated, instead of
 * being blocked by history they did not write; a value that agrees with the row's
 * own passes even when the list has never held it.
 *
 * A list that failed to load refuses the whole write. Returning the file as
 * unfilable would be a lie — the vocabulary may be perfectly populated — and
 * writing it unvalidated is how the drift started.
 */
export async function resolveJobFiling(input: {
  supabase: StaffClient;
  submitted: JobFilingFields;
  stored?: Partial<JobFilingFields> | null;
}): Promise<{ ok: true; filed: JobFilingFields } | { ok: false; error: string }> {
  const { vocabularies, unreadable } = await getFilingVocabularies(input.supabase);
  if (unreadable.length > 0) {
    const lists = unreadable.map((entity) => MASTER_LIST_WORDS[entity]).join(", ");
    return {
      ok: false,
      error: `The master data (${lists}) did not load, so nothing was filed. Try again.`,
    };
  }

  const filed: JobFilingFields = { ...input.submitted };
  const refusal: string[] = [];

  for (const { entity, field, by } of FILING_FIELDS) {
    const result = resolveFiling({
      entity,
      rows: vocabularies[entity],
      submitted: filed[field],
      by,
      stored: input.stored?.[field],
    });
    if (!result.ok) refusal.push(result.error);
    else filed[field] = result.name;
  }

  if (refusal.length > 0) return { ok: false, error: refusal.join(" ") };
  return { ok: true, filed };
}
