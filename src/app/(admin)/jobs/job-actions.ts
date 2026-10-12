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
  status: string;
}

export interface JobResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const EMPLOYMENT_TYPES = new Set(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"]);
const STATUSES = new Set(["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"]);

/** Creates a job opening. Requires the `jobs.manage` permission. */
export async function createJobOpening(draft: JobDraft): Promise<JobResult> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { ok: false, error: "You need the Manage jobs permission." };
  }

  const title = draft.title.trim();
  if (!title) return { ok: false, error: "A job title is required." };

  const department = draft.department.trim();
  if (!department) return { ok: false, error: "Choose a department." };

  const location = draft.location.trim();
  if (!location) return { ok: false, error: "Choose a location." };

  const description = draft.description.trim();
  if (!description) return { ok: false, error: "A description is required." };

  if (!isSector(draft.sector)) {
    return { ok: false, error: `Sector must be one of: ${SECTORS.join(", ")}.` };
  }
  if (!EMPLOYMENT_TYPES.has(draft.employment_type)) {
    return { ok: false, error: "Invalid employment type." };
  }
  if (!STATUSES.has(draft.status)) {
    return { ok: false, error: "Invalid status." };
  }

  const supabase = await createSupabaseServerClient();

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

  const status = draft.status;
  const { data, error } = await supabase
    .from("job_openings")
    .insert({
      tenant_id: draft.tenant_id,
      title,
      department,
      sector: draft.sector,
      location,
      employment_type: draft.employment_type,
      description,
      requirements: draft.requirements,
      min_salary_usd: draft.min_salary_usd ? Number(draft.min_salary_usd) : null,
      max_salary_usd: draft.max_salary_usd ? Number(draft.max_salary_usd) : null,
      status,
      created_by: createdBy,
      // Only a published opening gets a posted date.
      posted_at: status === "PUBLISHED" ? new Date().toISOString() : null,
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
  return { ok: true, id: data?.id };
}