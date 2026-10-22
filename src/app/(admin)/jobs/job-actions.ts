"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, changedFields, printableValue } from "@/modules/activity/domain/trail";
import { SECTORS, isSector } from "@/modules/settings/domain/vocabularies";
import { JOB_STATUSES } from "@/modules/jobs/domain/hireable";
import {
  EMPLOYMENT_WRITE_REFUSAL,
  EXPERIENCE_WRITE_REFUSAL,
  isEmploymentType,
  isMissingSchemaError,
  readExperienceLevel,
} from "@/modules/jobs/domain/openingTerms";
import { MASTER_LIST_WORDS } from "@/modules/settings/domain/masterDataLists";
import {
  FILED_ENTITIES,
  isFiledEntity,
  refileSentence,
  resolveFiling,
  storedFilingLabel,
} from "@/modules/settings/domain/masterDataFiling";
import {
  filedColumn,
  getFilingVocabularies,
  resolveJobFiling,
  type JobFilingFields,
} from "@/modules/jobs/application/filingVocabularies";
import {
  POSITION_TEMPLATE_COLUMNS,
  inheritedFrom,
  supplied,
  type PositionTemplate,
} from "@/modules/jobs/domain/positionInheritance";

export interface JobDraft {
  title: string;
  tenant_id: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  /**
   * The seniority the opening states, or null for none recorded.
   *
   * `undefined` means the caller did not offer the field at all. While 033 is
   * unapplied the form sends nothing, and the action must write no column — a
   * literal null would name a column the database does not have.
   */
  experience_level?: string | null;
  description: string;
  requirements: string[];
  min_salary_usd: string;
  max_salary_usd: string;
  /** ISO 4217 code the two salary figures are denominated in. */
  salary_currency: string;
  status: string;
  /**
   * The position a new opening starts from. Only a create reads it, and only to
   * inherit the copy below; an edit never moves an opening's position link.
   */
  position_id?: string;
}

export interface JobResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const STATUSES = new Set<string>(JOB_STATUSES);

/**
 * Validates a job draft and turns it into the columns `job_openings` stores.
 *
 * Shared by create and edit so the two can never drift apart on what is
 * acceptable — a rule enforced on one path and not the other is how a draft
 * becomes undeletable once it has been saved.
 *
 * `stored` is the row an edit is writing over. Passing it lets a field a legacy
 * opening already carries stay as it is — see `masterDataFiling`.
 */
async function jobColumnsFrom(
  draft: JobDraft,
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  stored?: Partial<JobFilingFields> | null
): Promise<{ ok: true; columns: Record<string, unknown> } | { ok: false; error: string }> {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "A job title is required." };

  const department = draft.department.trim();
  if (!department) return { ok: false, error: "Choose a department." };

  const location = draft.location.trim();
  if (!location) return { ok: false, error: "Choose a location." };

  const description = draft.description.trim();
  if (!description) return { ok: false, error: "A description is required." };

  if (!draft.tenant_id) {
    return { ok: false, error: "Choose the company this role belongs to." };
  }
  if (!isSector(draft.sector)) {
    return { ok: false, error: `Sector must be one of: ${SECTORS.join(", ")}.` };
  }
  if (!isEmploymentType(draft.employment_type)) {
    return { ok: false, error: "Invalid employment type." };
  }
  if (!STATUSES.has(draft.status)) {
    return { ok: false, error: "Invalid status." };
  }

  // Three states, not two: a level, a deliberate blank that clears it, and
  // "not offered". The last is what keeps an edit from clearing a stored level
  // on a database where the form cannot show it.
  let experienceLevel: string | null | undefined;
  if (draft.experience_level !== undefined) {
    const read = readExperienceLevel(draft.experience_level);
    if (!read.ok) return { ok: false, error: read.error };
    experienceLevel = read.level;
  }

  // The salary pair is only meaningful with its currency, so the code is checked
  // for shape here and against master data below, like the other three filings.
  const salary_currency = (draft.salary_currency || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(salary_currency)) {
    return { ok: false, error: "Select a valid salary currency." };
  }

  // Company, department, location and currency are the four vocabularies an opening
  // names, and the table stores three of them as free text. Nothing at the database
  // level refuses "Finance" when the list holds "Finance & Investment", which is how
  // five of the live openings drifted; the assistant types these values straight in.
  const filed = await resolveJobFiling({
    restClient,
    submitted: { tenant_id: draft.tenant_id, department, location, salary_currency },
    stored,
  });
  if (!filed.ok) return { ok: false, error: filed.error };

  return {
    ok: true,
    columns: {
      ...filed.filed,
      title,
      sector: draft.sector,
      employment_type: draft.employment_type,
      ...(experienceLevel !== undefined ? { experience_level: experienceLevel } : {}),
      description,
      requirements: draft.requirements ?? [],
      min_salary_usd: draft.min_salary_usd ? Number(draft.min_salary_usd) : null,
      max_salary_usd: draft.max_salary_usd ? Number(draft.max_salary_usd) : null,
      status: draft.status,
    },
  };
}

/**
 * The position a create starts from, or the reason it cannot.
 *
 * The same refusal the Settings console prints when the table is missing: a retry
 * would fail identically, so the answer names the migration instead of asking for
 * one.
 */
async function positionTemplate(
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  id: string
): Promise<{ position: PositionTemplate } | { error: string }> {
  const { data, error } = await restClient
    .from("positions")
    .select(POSITION_TEMPLATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // 42P01 is the missing table; PGRST205/204 is a schema cache that has not caught
    // up with it. Both mean the same thing at this door.
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      error.code === "PGRST204" ||
      /does not exist|schema cache/i.test(error.message)
    ) {
      return {
        error:
          "The positions list has not been created on this database yet — db/migrations/026_positions.sql is authored but not applied, so nothing can start from a position until it is.",
      };
    }
    return { error: error.message };
  }

  if (!data) {
    return { error: "That position no longer exists — reload the form and pick another." };
  }

  const position = data as unknown as PositionTemplate;
  if (position.is_active === false) {
    return {
      error: `“${position.title}” is retired, so a new opening cannot start from it. Reactivate it in Settings → Organisation → Positions, or pick another.`,
    };
  }
  return { position };
}

/** Creates a job opening. Requires the `jobs.manage` permission. */
export async function createJobOpening(draft: JobDraft): Promise<JobResult> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { ok: false, error: "You need the Manage jobs permission." };
  }

  const restClient = await createServerRestClient();

  // The position is read before validation because it supplies the copy the draft
  // is allowed to leave out. The link is recorded only on create; an edit never
  // moves it.
  const positionId = supplied(draft.position_id) ? draft.position_id!.trim() : null;
  let source = draft;
  let position: PositionTemplate | null = null;
  if (positionId) {
    const read = await positionTemplate(restClient, positionId);
    if ("error" in read) return { ok: false, error: read.error };
    position = read.position;
    // A position filed under one company is that company's post. Copying it onto
    // another company's opening would be a role nobody defined, so the company an
    // opening inherits has to be the one the position names — or the position has
    // to be group-wide, which is what a null tenant means.
    if (
      position.tenant_id &&
      supplied(draft.tenant_id) &&
      draft.tenant_id.trim() !== position.tenant_id
    ) {
      return {
        ok: false,
        error: `“${position.title}” is filed under a different company, so an opening here cannot start from it. Pick that company, or a position filed under this one.`,
      };
    }
    source = inheritedFrom(draft, position);
  }

  // The form fills the sector from the company when a position is picked; a chat
  // that sends only the position does not have to know it, so it is read here when
  // the position named a company.
  if (!source.sector.trim() && source.tenant_id) {
    const { data: company } = await restClient
      .from("tenants_and_companies")
      .select("sector")
      .eq("id", source.tenant_id)
      .maybeSingle();
    if (typeof company?.sector === "string") source = { ...source, sector: company.sector };
  }

  const built = await jobColumnsFrom(source, restClient);
  if (!built.ok) return { ok: false, error: built.error };
  const { columns } = built;

  // `job_openings.created_by` references user_profiles(id), not auth.users(id),
  // so the authenticated user must be resolved to their profile row. Passing the
  // auth id directly violates the foreign key.
  const { data: userData } = await restClient.auth.getUser();
  let createdBy: string | null = null;
  if (userData.user) {
    const { data: profile } = await restClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    createdBy = profile?.id ?? null;
  }

  const { data, error } = await restClient
    .from("job_openings")
    .insert({
      ...columns,
      // Only a create carries the link, and only when a position was chosen: while
      // 026 is unapplied the column does not exist, and sending `null` for it would
      // fail an insert that has nothing to do with positions.
      ...(positionId ? { position_id: positionId } : {}),
      created_by: createdBy,
      // Only a published opening gets a posted date.
      posted_at: columns.status === "PUBLISHED" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) {
    // The link was chosen and the column it writes is not there: the position read
    // could not have succeeded on such a database, so this is the migration, said
    // once more rather than as a raw schema-cache error.
    if (
      /position_id/.test(error.message) &&
      (error.code === "42703" ||
        error.code === "PGRST204" ||
        /does not exist|schema cache/i.test(error.message))
    ) {
      return {
        ok: false,
        error:
          "The opening could not be linked to its position: db/migrations/026_positions.sql is authored but not applied, so job_openings has no position_id column yet.",
      };
    }
    // 23503 is a foreign-key violation. Naming the column makes this far
    // easier to diagnose than a generic "could not be found".
    if (error.code === "23503") {
      if (error.message.includes("tenant_id")) {
        return { ok: false, error: "That company no longer exists — pick another." };
      }
      if (error.message.includes("position_id")) {
        return { ok: false, error: "That position no longer exists — pick another." };
      }
      if (error.message.includes("created_by")) {
        return { ok: false, error: "Your staff profile is missing — ask an admin to fix it." };
      }
      return { ok: false, error: "A linked record no longer exists." };
    }
    if (error.code === "23514") {
      return { ok: false, error: describeWriteError(error) };
    }
    if (isMissingSchemaError(error) && /experience_level/i.test(error.message)) {
      return { ok: false, error: EXPERIENCE_WRITE_REFUSAL };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/jobs");
  // The careers board is cached (see getPublicJobs). Without this a newly
  // published opening would stay invisible on the public site until the cache
  // window expired, which reads as "the job I just posted never appeared".
  revalidatePath("/careers");

  await recordActivity({
    area: "jobs",
    action: "job_create",
    entity: "job opening",
    entityId: data?.id ?? null,
    summary: `Opened ${columns.status === "PUBLISHED" ? "and published" : "as a draft"} the role “${columns.title}” in ${columns.department} (${columns.location})`,
    detail: {
      title: columns.title,
      department: columns.department,
      location: columns.location,
      employment_type: columns.employment_type,
      ...(columns.experience_level !== undefined
        ? { experience_level: columns.experience_level }
        : {}),
      status: columns.status,
      // Named so the trail says where the copy came from, not just that an
      // opening appeared. Absent on a blank create, which starts from no position.
      ...(position ? { position: position.title } : {}),
      salary:
        columns.min_salary_usd || columns.max_salary_usd
          ? `${printableValue(columns.min_salary_usd)}–${printableValue(columns.max_salary_usd)} ${columns.salary_currency}`
          : "not published",
    },
  });

  return { ok: true, id: data?.id };
}

/** Staff session + `jobs.manage`, or the message explaining which is missing. */
async function requireJobManager(): Promise<
  { restClient: Awaited<ReturnType<typeof createServerRestClient>> } | { error: string }
> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { error: "You need the Manage jobs permission." };
  }
  return { restClient: await createServerRestClient() };
}

/** Turns the constraint and schema errors this table can raise into recruiter language. */
function describeWriteError(error: { code?: string; message: string }): string {
  if (isMissingSchemaError(error) && /experience_level/i.test(error.message)) {
    return EXPERIENCE_WRITE_REFUSAL;
  }
  if (error.code === "23503") {
    if (error.message.includes("tenant_id")) {
      return "That company no longer exists — pick another.";
    }
    return "A linked record no longer exists.";
  }
  if (error.code === "23514") {
    // The two constraints 033 touches are named, so a Remote type or a level the
    // database has not been taught yet is told why rather than "not valid".
    if (/employment_type_check/i.test(error.message)) return EMPLOYMENT_WRITE_REFUSAL;
    if (/experience_level_check/i.test(error.message)) {
      return "Experience level must be one of: JUNIOR, MID, SENIOR, LEAD.";
    }
    return "The employment type or status is not valid.";
  }
  return error.message;
}

export interface JobStatusResult {
  ok: boolean;
  error?: string;
  status?: string;
}

/** The columns an edit can move, so the trail names what actually changed. */
const EDITABLE_COLUMNS = [
  "title",
  "department",
  "sector",
  "location",
  "employment_type",
  "experience_level",
  "description",
  "requirements",
  "min_salary_usd",
  "max_salary_usd",
  "salary_currency",
  "status",
  "tenant_id",
] as const;

/**
 * Edits an existing opening.
 *
 * Validated exactly like a create, and the first-published date is preserved:
 * republishing an old draft must not make it look newly posted on the board,
 * which sorts by `posted_at`.
 */
export async function updateJobOpening(jobId: string, draft: JobDraft): Promise<JobResult> {
  const access = await requireJobManager();
  if ("error" in access) return { ok: false, error: access.error };
  const { restClient } = access;

  const { data: existing } = await restClient
    .from("job_openings")
    .select(
      "id, posted_at, title, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, salary_currency, status, tenant_id"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };

  // The level is read in its own query, for the same reason the grid reads it
  // apart: naming it in the row select above would fail the whole edit while 033
  // is unapplied. It is read only when the draft names the field — a form that
  // cannot offer it sends nothing, and "not offered" must never become "cleared".
  let storedLevel: string | null = null;
  let levelWasRead = false;
  if (draft.experience_level !== undefined) {
    const { data: levelRow, error: levelError } = await restClient
      .from("job_openings")
      .select("id, experience_level")
      .eq("id", jobId)
      .maybeSingle();
    if (levelError) return { ok: false, error: describeWriteError(levelError) };
    storedLevel = (levelRow?.experience_level as string | null) ?? null;
    levelWasRead = true;
  }

  const built = await jobColumnsFrom(draft, restClient, {
    tenant_id: existing.tenant_id,
    department: existing.department,
    location: existing.location,
    salary_currency: existing.salary_currency,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const columns: Record<string, unknown> = { ...built.columns };
  if (built.columns.status === "PUBLISHED" && !existing.posted_at) {
    columns.posted_at = new Date().toISOString();
  }

  const { error } = await restClient.from("job_openings").update(columns).eq("id", jobId);
  if (error) return { ok: false, error: describeWriteError(error) };

  const before = {
    ...(existing as unknown as Record<string, unknown>),
    ...(levelWasRead ? { experience_level: storedLevel } : {}),
  };
  const edits = changedFields(before, columns, EDITABLE_COLUMNS);
  const republished = built.columns.status === "PUBLISHED" && !existing.posted_at;

  if (Object.keys(edits).length > 0 || republished) {
    await recordActivity({
      area: "jobs",
      action: "job_edit",
      entity: "job opening",
      entityId: jobId,
      summary: `Edited the role “${built.columns.title}” — ${
        Object.keys(edits).length === 0
          ? "listed it on the careers board for the first time"
          : changePhrase(edits)
      }`,
      detail: { ...edits, ...(republished ? { posted_at: "first publication" } : {}) },
    });
  }

  revalidatePath("/jobs");
  revalidatePath("/careers");
  return { ok: true, id: jobId };
}

/**
 * Changes only the status, for the one-click Publish / Pause / Close actions.
 *
 * `posted_at` is stamped on the first publication and never removed, so the
 * careers board ordering stays stable when a role is paused and reopened.
 */
export async function setJobStatus(
  jobId: string,
  status: string
): Promise<JobStatusResult> {
  const access = await requireJobManager();
  if ("error" in access) return { ok: false, error: access.error };
  const { restClient } = access;

  if (!STATUSES.has(status)) return { ok: false, error: "Unknown status." };

  const { data: existing } = await restClient
    .from("job_openings")
    .select("id, title, status, posted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };
  if (existing.status === status) return { ok: true, status };

  const patch: Record<string, unknown> = { status };
  if (status === "PUBLISHED" && !existing.posted_at) {
    patch.posted_at = new Date().toISOString();
  }

  const { error } = await restClient.from("job_openings").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "jobs",
    action: "job_status",
    entity: "job opening",
    entityId: jobId,
    summary: `Moved “${existing.title}” from ${existing.status} to ${status}${
      !existing.posted_at && status === "PUBLISHED" ? ", listing it on the careers board" : ""
    }`,
    detail: { from: existing.status, to: status },
  });

  revalidatePath("/jobs");
  revalidatePath("/careers");
  return { ok: true, status };
}

/**
 * Deletes an opening — but never one that has taken applications.
 *
 * `applications.job_id` points at this row, so a delete would take every
 * candidate record attached to the role with it. Closing the opening does the
 * same job for a recruiter and keeps the trail, so the destructive path is
 * refused rather than offered with a warning.
 */
export async function deleteJobOpening(jobId: string): Promise<JobResult> {
  const access = await requireJobManager();
  if ("error" in access) return { ok: false, error: access.error };
  const { restClient } = access;

  const { data: existing } = await restClient
    .from("job_openings")
    .select("id, title, department, location, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };

  // Deliberately counted over filed candidates too: `applications.job_id`
  // cascades, so deleting an opening a filed applicant still points at would
  // erase the record the archive exists to keep.
  const { count } = await restClient
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `“${existing.title}” has ${count} applicant${count === 1 ? "" : "s"} — deleting the opening would delete those records too. Close it instead to keep them.`,
    };
  }

  const { error } = await restClient.from("job_openings").delete().eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "jobs",
    action: "job_delete",
    entity: "job opening",
    entityId: jobId,
    summary: `Deleted the opening “${existing.title}” — it had taken no applications, so no candidate record went with it`,
    detail: {
      title: existing.title,
      department: existing.department,
      location: existing.location,
      status_at_delete: existing.status,
    },
  });

  revalidatePath("/jobs");
  revalidatePath("/careers");
  return { ok: true, id: jobId };
}

/* ------------------------------- Refile a filing ------------------------------- */

/** A bulk move, with the rows it actually touched so the number can be checked. */
export interface RefileResult {
  ok: boolean;
  error?: string;
  moved?: number;
  note?: string;
  titles?: string[];
}

/**
 * Move every opening filed under one value onto a row the vocabulary holds.
 *
 * The desk in Settings → Organisation names the spellings the seeds left behind;
 * this is the only way to clear them, because the drawer's picker refuses an
 * off-list value by design (#287) and editing seven roles one at a time is not a
 * repair anybody performs. Three rules keep it a repair rather than a guess:
 *
 * - The destination goes through the same `resolveFiling` a write uses, so a refile
 *   cannot create new drift or file a role under a retired row.
 * - The source is matched exactly as the desk counted it — the trimmed text the
 *   openings hold — so the number a person approved is the number that moves.
 * - Nothing decides which row an unknown spelling *meant*. The recruiter picks.
 */
export async function refileFiling(entity: string, from: string, to: string): Promise<RefileResult> {
  const access = await requireJobManager();
  if ("error" in access) return { ok: false, error: access.error };
  const { restClient } = access;

  if (!isFiledEntity(entity)) {
    return {
      ok: false,
      error: `An opening files itself under ${FILED_ENTITIES.join(", ")} — nothing else can be refiled.`,
    };
  }

  const { field, by } = filedColumn(entity);
  const source = String(from ?? "").trim();
  const { vocabularies, unreadable } = await getFilingVocabularies(restClient);
  if (unreadable.includes(entity)) {
    return {
      ok: false,
      error: `The ${MASTER_LIST_WORDS[entity]} list did not load, so nothing was refiled. Try again.`,
    };
  }

  const destination = resolveFiling({ entity, rows: vocabularies[entity], submitted: to, by });
  if (!destination.ok) return { ok: false, error: destination.error };
  if (destination.name === source) {
    return {
      ok: false,
      error: `Those openings are already filed under “${destination.shown}”, which is the list's own spelling. Nothing was written.`,
    };
  }

  // Read and matched here rather than with `.eq()`, because the desk counted the
  // *trimmed* text and a stored value padded with a space would otherwise slip
  // past a match the recruiter was told had moved.
  const { data, error } = await restClient
    .from("job_openings")
    .select(`id, title, ${field}`)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: describeWriteError(error) };

  const moving = ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      carried: String(row[field] ?? "").trim(),
    }))
    .filter((row) => row.carried === source);
  if (moving.length === 0) {
    return {
      ok: false,
      error: `Nothing is filed under “${storedFilingLabel(source, by)}” any more — that reading is out of date. Reload the desk for the current one.`,
    };
  }

  const { error: written } = await restClient
    .from("job_openings")
    .update({ [field]: destination.name })
    .in("id", moving.map((row) => row.id));
  if (written) return { ok: false, error: describeWriteError(written) };

  const note = refileSentence(entity, storedFilingLabel(source, by), destination.shown, moving.length);
  await recordActivity({
    area: "jobs",
    action: "job_refile",
    entity: "job opening",
    entityId: null,
    summary: note,
    detail: {
      list: MASTER_LIST_WORDS[entity],
      from: source,
      to: destination.name,
      openings: moving.map((row) => row.title).join(", "),
    },
  });

  revalidatePath("/jobs");
  // The board's filter chips are counted from this text, so a refile changes what
  // applicants are offered and the cached board has to say so now.
  revalidatePath("/careers");
  revalidatePath("/settings");

  return { ok: true, moved: moving.length, note, titles: moving.map((row) => row.title) };
}