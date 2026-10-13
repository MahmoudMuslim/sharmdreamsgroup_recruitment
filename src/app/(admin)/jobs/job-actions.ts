"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { SECTORS, isSector } from "@/modules/settings/domain/vocabularies";

export interface JobDraft {
  title: string;
  tenant_id: string;
  department: string;
  sector: string;
  location: string;
  employment_type: string;
  description: string;
  requirements: string[];
  min_salary_usd: string;
  max_salary_usd: string;
  /** ISO 4217 code the two salary figures are denominated in. */
  salary_currency: string;
  status: string;
}

export interface JobResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const EMPLOYMENT_TYPES = new Set(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"]);
const STATUSES = new Set(["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"]);

/**
 * Validates a job draft and turns it into the columns `job_openings` stores.
 *
 * Shared by create and edit so the two can never drift apart on what is
 * acceptable — a rule enforced on one path and not the other is how a draft
 * becomes undeletable once it has been saved.
 */
async function jobColumnsFrom(
  draft: JobDraft,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
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
  if (!EMPLOYMENT_TYPES.has(draft.employment_type)) {
    return { ok: false, error: "Invalid employment type." };
  }
  if (!STATUSES.has(draft.status)) {
    return { ok: false, error: "Invalid status." };
  }

  // The salary pair is only meaningful with its currency, so the code is
  // validated against master data rather than trusted from the form.
  const currency = (draft.salary_currency || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Select a valid salary currency." };
  }
  const { data: currencyRow } = await supabase
    .from("currencies")
    .select("code")
    .eq("code", currency)
    .maybeSingle();
  if (!currencyRow) {
    return {
      ok: false,
      error: `Currency “${currency}” is not set up. Add it in Settings → Organisation → Currencies.`,
    };
  }

  return {
    ok: true,
    columns: {
      tenant_id: draft.tenant_id,
      title,
      department,
      sector: draft.sector,
      location,
      employment_type: draft.employment_type,
      description,
      requirements: draft.requirements ?? [],
      min_salary_usd: draft.min_salary_usd ? Number(draft.min_salary_usd) : null,
      max_salary_usd: draft.max_salary_usd ? Number(draft.max_salary_usd) : null,
      salary_currency: currency,
      status: draft.status,
    },
  };
}

/** Creates a job opening. Requires the `jobs.manage` permission. */
export async function createJobOpening(draft: JobDraft): Promise<JobResult> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { ok: false, error: "You need the Manage jobs permission." };
  }

  const supabase = await createSupabaseServerClient();

  const built = await jobColumnsFrom(draft, supabase);
  if (!built.ok) return { ok: false, error: built.error };
  const { columns } = built;

  // `job_openings.created_by` references user_profiles(id), not auth.users(id),
  // so the authenticated user must be resolved to their profile row. Passing the
  // auth id directly violates the foreign key.
  const { data: userData } = await supabase.auth.getUser();
  let createdBy: string | null = null;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    createdBy = profile?.id ?? null;
  }

  const { data, error } = await supabase
    .from("job_openings")
    .insert({
      ...columns,
      created_by: createdBy,
      // Only a published opening gets a posted date.
      posted_at: columns.status === "PUBLISHED" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) {
    // 23503 is a foreign-key violation. Naming the column makes this far
    // easier to diagnose than a generic "could not be found".
    if (error.code === "23503") {
      if (error.message.includes("tenant_id")) {
        return { ok: false, error: "That company no longer exists — pick another." };
      }
      if (error.message.includes("created_by")) {
        return { ok: false, error: "Your staff profile is missing — ask an admin to fix it." };
      }
      return { ok: false, error: "A linked record no longer exists." };
    }
    if (error.code === "23514") {
      return { ok: false, error: "The employment type or status is not valid." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/jobs");
  // The careers board is cached (see getPublicJobs). Without this a newly
  // published opening would stay invisible on the public site until the cache
  // window expired, which reads as "the job I just posted never appeared".
  revalidatePath("/careers");
  return { ok: true, id: data?.id };
}

/** Staff session + `jobs.manage`, or the message explaining which is missing. */
async function requireJobManager(): Promise<
  { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> } | { error: string }
> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { error: "You need the Manage jobs permission." };
  }
  return { supabase: await createSupabaseServerClient() };
}

/** Turns the two constraint errors this table can raise into recruiter language. */
function describeWriteError(error: { code?: string; message: string }): string {
  if (error.code === "23503") {
    if (error.message.includes("tenant_id")) {
      return "That company no longer exists — pick another.";
    }
    return "A linked record no longer exists.";
  }
  if (error.code === "23514") {
    return "The employment type or status is not valid.";
  }
  return error.message;
}

export interface JobStatusResult {
  ok: boolean;
  error?: string;
  status?: string;
}

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
  const { supabase } = access;

  const { data: existing } = await supabase
    .from("job_openings")
    .select("id, posted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };

  const built = await jobColumnsFrom(draft, supabase);
  if (!built.ok) return { ok: false, error: built.error };

  const columns: Record<string, unknown> = { ...built.columns };
  if (built.columns.status === "PUBLISHED" && !existing.posted_at) {
    columns.posted_at = new Date().toISOString();
  }

  const { error } = await supabase.from("job_openings").update(columns).eq("id", jobId);
  if (error) return { ok: false, error: describeWriteError(error) };

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
  const { supabase } = access;

  if (!STATUSES.has(status)) return { ok: false, error: "Unknown status." };

  const { data: existing } = await supabase
    .from("job_openings")
    .select("id, status, posted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };
  if (existing.status === status) return { ok: true, status };

  const patch: Record<string, unknown> = { status };
  if (status === "PUBLISHED" && !existing.posted_at) {
    patch.posted_at = new Date().toISOString();
  }

  const { error } = await supabase.from("job_openings").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message };

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
  const { supabase } = access;

  const { data: existing } = await supabase
    .from("job_openings")
    .select("id, title")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That opening no longer exists." };

  const { count } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `“${existing.title}” has ${count} applicant${count === 1 ? "" : "s"} — deleting the opening would delete those records too. Close it instead to keep them.`,
    };
  }

  const { error } = await supabase.from("job_openings").delete().eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/jobs");
  revalidatePath("/careers");
  return { ok: true, id: jobId };
}