"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

export interface PlanResult {
  ok: boolean;
  error?: string;
  checklist?: number;
  gaps?: number;
}

interface ChecklistItem {
  id: string;
  title: string;
  category: string;
  owner: string;
  due_offset_days: number;
  completed: boolean;
}

interface SkillGap {
  skill: string;
  current_level: number;
  required_level: number;
  action: string;
}

/**
 * Builds a role-aware onboarding checklist.
 *
 * Days are offsets from the hire's start date rather than absolute dates, so a
 * plan stays correct if the start date moves. The core admin/IT/training tasks
 * are always present; role-specific tasks are layered on from the job title.
 */
function buildChecklist(jobTitle: string | null): ChecklistItem[] {
  const base: ChecklistItem[] = [
    {
      id: "contract",
      title: "Signed contract and personal file completed",
      category: "Admin",
      owner: "HR",
      due_offset_days: -7,
      completed: false,
    },
    {
      id: "payroll",
      title: "Payroll and benefits enrolment",
      category: "Admin",
      owner: "HR",
      due_offset_days: -3,
      completed: false,
    },
    {
      id: "accounts",
      title: "Email, ERP and directory accounts provisioned",
      category: "IT",
      owner: "IT",
      due_offset_days: -1,
      completed: false,
    },
    {
      id: "equipment",
      title: "Laptop, uniform and access badges issued",
      category: "IT",
      owner: "IT",
      due_offset_days: 0,
      completed: false,
    },
    {
      id: "induction",
      title: "Group induction and values workshop",
      category: "Culture",
      owner: "HR",
      due_offset_days: 1,
      completed: false,
    },
    {
      id: "buddy",
      title: "Buddy assigned and first check-in scheduled",
      category: "Culture",
      owner: "Manager",
      due_offset_days: 1,
      completed: false,
    },
    {
      id: "week1",
      title: "Week one check-in with line manager",
      category: "Role",
      owner: "Manager",
      due_offset_days: 7,
      completed: false,
    },
    {
      id: "probation",
      title: "30-day probation review",
      category: "Role",
      owner: "Manager",
      due_offset_days: 30,
      completed: false,
    },
    {
      id: "training",
      title: "Role-specific training plan agreed",
      category: "Role",
      owner: "Manager",
      due_offset_days: 14,
      completed: false,
    },
  ];

  const title = (jobTitle ?? "").toLowerCase();

  // Role-specific extras, chosen from the job title so the list stays relevant
  // without needing a per-role mapping table we do not have yet.
  const extras: ChecklistItem[] = [];
  if (/chef|culinar|kitchen|food|beverage|bar\b|restaurant/.test(title)) {
    extras.push(
      {
        id: "haccp",
        title: "HACCP and food-safety certification booked",
        category: "Compliance",
        owner: "Manager",
        due_offset_days: 21,
        completed: false,
      },
      {
        id: "menu",
        title: "Menu and station walkthrough completed",
        category: "Role",
        owner: "Chef",
        due_offset_days: 3,
        completed: false,
      }
    );
  }
  if (/front office|reception|concierge|guest/.test(title)) {
    extras.push(
      {
        id: "opera",
        title: "PMS / Opera system access and training",
        category: "IT",
        owner: "IT",
        due_offset_days: 5,
        completed: false,
      },
      {
        id: "standards",
        title: "Guest service standards shadowing",
        category: "Role",
        owner: "Manager",
        due_offset_days: 10,
        completed: false,
      }
    );
  }
  if (/housekeeping|rooms/.test(title)) {
    extras.push({
      id: "chemical",
      title: "Chemical handling and COSHH briefing",
      category: "Compliance",
      owner: "Manager",
      due_offset_days: 3,
      completed: false,
    });
  }
  if (/engineer|maintenance|technical/.test(title)) {
    extras.push({
      id: "permit",
      title: "Permit-to-work and lockout/tagout certification",
      category: "Compliance",
      owner: "Manager",
      due_offset_days: 14,
      completed: false,
    });
  }
  if (/finance|account|audit|treasury/.test(title)) {
    extras.push({
      id: "systems",
      title: "ERP and financial reporting systems access",
      category: "IT",
      owner: "Finance",
      due_offset_days: 5,
      completed: false,
    });
  }

  return [...base, ...extras];
}

/**
 * Derives skill gaps from the role's expected skill profile versus the
 * candidate's assessed skills. Returns an empty list when neither exists —
 * better than inventing gaps.
 */
async function deriveSkillGaps(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  applicationId: string,
  jobTitle: string | null
): Promise<SkillGap[]> {
  const { data: application } = await supabase
    .from("applications")
    .select("job_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application?.job_id) return [];

  const { data: job } = await supabase
    .from("job_openings")
    .select("title")
    .eq("id", application.job_id)
    .maybeSingle();

  const familyKey = matchFamilyKey(job?.title ?? jobTitle ?? "");

  const { data: family } = await supabase
    .from("role_families")
    .select("id")
    .eq("key", familyKey)
    .maybeSingle();

  if (!family) return [];

  const { data: required } = await supabase
    .from("role_family_skills")
    .select("skill_id, required_level, skills(name)")
    .eq("role_family_id", family.id);

  if (!required || required.length === 0) return [];

  const { data: held } = await supabase
    .from("candidate_skills")
    .select("skill_id, proficiency")
    .eq("application_id", applicationId);

  const heldMap = new Map((held ?? []).map((h) => [h.skill_id, h.proficiency]));

  return required
    .map((item) => {
      const skill = Array.isArray(item.skills) ? item.skills[0] : item.skills;
      const current = heldMap.get(item.skill_id) ?? 1;
      return {
        skill: skill?.name ?? "Unknown skill",
        current_level: current,
        required_level: item.required_level,
        action:
          current >= item.required_level
            ? "On track — confirm during probation review."
            : `Close the gap: targeted practice or a short course before the 30-day review.`,
      };
    })
    .filter((gap) => gap.current_level < gap.required_level);
}

function matchFamilyKey(title: string): string {
  const t = title.toLowerCase();
  if (/financ|account|audit|treasur|fp&a/.test(t)) return "FINANCE";
  if (/invest|valuation|acquisition/.test(t)) return "INVESTMENTS";
  if (/chef|culinar|food|beverage|restaurant/.test(t)) return "FOOD_BEVERAGE";
  if (/housekeep|rooms/.test(t)) return "HOUSEKEEPING";
  if (/front office|reception|concierge|guest/.test(t)) return "HOSPITALITY_OPS";
  if (/recruit|talent|hr\b|human/.test(t)) return "RECRUITING";
  if (/engineer|maintenance|technical/.test(t)) return "ENGINEERING";
  if (/real estate|development|acquisition/.test(t)) return "REAL_ESTATE";
  if (/it\b|software|developer/.test(t)) return "IT";
  if (/legal|compliance/.test(t)) return "LEGAL";
  if (/sales|revenue/.test(t)) return "SALES";
  return "GENERAL";
}

/**
 * Creates an onboarding plan for a hire.
 *
 * Idempotent: refuses to create a second plan for the same application.
 */
export async function generateOnboardingPlan(
  applicationId: string,
  jobTitle: string | null
): Promise<PlanResult> {
  await requireStaff("/onboarding");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: "You need platform settings permission to generate plans." };
  }

  if (!applicationId) return { ok: false, error: "Missing application." };

  const supabase = await createSupabaseServerClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, tenant_id, job_openings(tenants_and_companies(id))")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "That hire no longer exists." };

  // PostgREST embeds come back as either an object or a single-element array
  // depending on whether the relationship is to-many; normalise both.
  const row = application as unknown as {
    id: string;
    tenant_id: string | null;
    job_openings?:
      | { tenants_and_companies?: { id: string } | { id: string }[] | null }
      | { tenants_and_companies?: { id: string } | { id: string }[] | null }[]
      | null;
  };
  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const company = job?.tenants_and_companies;

  const tenantId =
    (Array.isArray(company) ? company[0]?.id : company?.id) ?? row.tenant_id ?? null;

  if (!tenantId) {
    return { ok: false, error: "This hire is not linked to a company." };
  }

  const { data: existing } = await supabase
    .from("onboarding_plans")
    .select("id")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "This hire already has an onboarding plan." };
  }

  const checklist = buildChecklist(jobTitle);
  const skillGaps = await deriveSkillGaps(supabase, applicationId, jobTitle);

  // No assessment data yet means no evidence of retention risk — start neutral
  // rather than inventing a number that recruiters would act on.
  const retentionRisk = 20;

  const { error } = await supabase.from("onboarding_plans").insert({
    application_id: applicationId,
    tenant_id: tenantId,
    checklist,
    skill_gaps: skillGaps,
    internal_mobility_suggestions: [],
    retention_risk_score: retentionRisk,
    progress: 0,
    generated_by_ai: true,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A plan already exists for this hire." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/onboarding");
  return { ok: true, checklist: checklist.length, gaps: skillGaps.length };
}