import {
  CheckCircle2,
  FolderOpen,
  TrendingUp,
  UserRoundPlus,
} from "lucide-react";
import { getOnboardingData } from "./actions";
import { PlanChecklist } from "./components/PlanChecklist";
import { GeneratePlanButton } from "./components/GeneratePlanButton";
import type { OnboardingRow, OnboardingSummary } from "./actions";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import {
  Badge,
  Card,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Onboarding",
  description: "Role-mapped onboarding checklists and skill-gap analysis for new hires",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

const CAPABILITIES = [
  {
    icon: CheckCircle2,
    title: "Role-mapped checklists",
    copy: "Admin, IT, training, culture and role-specific tasks chosen from the hire's job family, with due dates offset from the start date.",
    points: ["Matched to the job family", "Tick tasks off as they land", "Progress rolls up above"],
  },
  {
    icon: FolderOpen,
    title: "Skill gap analysis",
    copy: "The role family behind the job is matched to its required skill levels and compared with the skills recorded for the hire; every shortfall carries a development action.",
    points: ["Gap detection", "An action per gap", "Counted in the tile above"],
  },
  {
    icon: TrendingUp,
    title: "One plan per hire",
    copy: "Plans are created for hires only, belong to their company, and are scoped by row-level security — generating twice is refused rather than duplicated.",
    points: ["Idempotent per hire", "Company-scoped access", "Needs platform permission"],
  },
] as const;

function OnboardingData({
  plans,
  summary,
  unplanned,
  timeZone,
  canEdit,
}: {
  plans: OnboardingRow[];
  summary: OnboardingSummary;
  unplanned: { id: string; full_name: string; job_title: string | null }[];
  timeZone: string;
  canEdit: boolean;
}) {
  if (plans.length === 0 && unplanned.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No hires yet"
          description="Once a candidate reaches the Hired stage you can generate their onboarding checklist and skill-gap map here."
          icon={<UserRoundPlus className="h-8 w-8" aria-hidden />}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Active plans" value={summary.active} hint="Onboarding in progress" />
        <StatTile label="Average progress" value={`${summary.avg_progress}%`} hint="Across active plans" />
        <StatTile
          label="Open skill gaps"
          value={summary.open_skill_gaps}
          hint="Where the hire is below the role's level"
        />
      </div>

      {plans.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-line px-5 py-4 sm:px-6">
            <h2 className="font-display text-base font-bold sm:text-lg">Active onboarding</h2>
            <span className="text-xs text-brand-ink/45">{plans.length} hires</span>
          </div>

          <ul className="divide-y divide-brand-line">
            {plans.map((plan) => (
              <li key={plan.id} className="space-y-3 p-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{plan.candidate_name}</p>
                    <p className="truncate text-xs text-brand-ink/55">
                      {plan.job_title ?? "—"}
                      {plan.company_name ? ` · ${plan.company_name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={plan.checklist_total === plan.checklist_done ? "success" : "neutral"}>
                      {plan.checklist_total === plan.checklist_done
                        ? "Complete"
                        : `${plan.checklist_total - plan.checklist_done} tasks left`}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Meter
                    value={plan.progress}
                    className="flex-1"
                    tone={plan.progress >= 70 ? "success" : "gold"}
                  />
                  <span className="w-12 text-right font-display text-sm font-bold">
                    {plan.progress}%
                  </span>
                </div>

                <p className="text-xs text-brand-ink/50">
                  {plan.checklist_done}/{plan.checklist_total} tasks complete
                  {plan.skill_gap_count > 0 && ` · ${plan.skill_gap_count} skill gaps identified`}
                </p>

                <PlanChecklist plan={plan} timeZone={timeZone} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {unplanned.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-base font-bold sm:text-lg">Ready to onboard</h2>
          <p className="mt-1 text-sm text-brand-ink/60">
            Hires without a generated plan. Create one to build their checklist and skill map.
          </p>
          <ul className="mt-4 divide-y divide-brand-line">
            {unplanned.map((hire) => (
              <li key={hire.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{hire.full_name}</p>
                  <p className="truncate text-xs text-brand-ink/55">{hire.job_title ?? "—"}</p>
                </div>
                <GeneratePlanButton key={hire.id} hire={hire} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default async function OnboardingPage() {
  await connection();
  await requireStaff("/onboarding");

  // Fetched in the page component rather than behind a <Suspense> boundary.
  // The page is already request-time (await connection() above), so the boundary
  // only produced a static shell whose hole the client had to re-fetch — and on
  // a hard load that fetch intermittently never landed, leaving the skeleton up
  // and every control unclickable.
  const [{ plans, summary, unplanned }, timeZone, canEdit] = await Promise.all([
    getOnboardingData(),
    getOrganisationTimeZone(),
    hasPermissionForUser("candidates.write"),
  ]);

  return (
    <PageTransition>
    <PageHeader
      eyebrow="Post-hiring"
      title="Onboarding"
      description="Turn accepted offers into structured, measurable journeys — checklist progress and skill gaps per hire."
    />

    <OnboardingData
      plans={plans}
      summary={summary}
      unplanned={unplanned}
      timeZone={timeZone}
      canEdit={canEdit}
    />

    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {CAPABILITIES.map(({ icon: Icon, title, copy, points }) => (
        <Card key={title} className="flex flex-col gap-4 p-5 sm:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-base font-bold">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">{copy}</p>
          </div>
          <ul className="mt-auto space-y-1.5 border-t border-brand-line pt-4">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-2 text-xs text-brand-ink/60">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
    </PageTransition>
  );
}