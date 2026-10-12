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
  const { data: userData } = await supabase.auth.getUser();

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
      created_by: userData.user?.id ?? null,
      // Only a published opening gets a posted date.
      posted_at: status === "PUBLISHED" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "That company could not be found." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/jobs");
  return { ok: true, id: data?.id };
}