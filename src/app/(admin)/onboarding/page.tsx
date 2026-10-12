import { Suspense } from "react";
import {
  CheckCircle2,
  FolderOpen,
  Sparkles,
  TrendingUp,
  UserRoundPlus,
} from "lucide-react";
import { getOnboardingData } from "./actions";
import { GeneratePlanButton } from "./components/GeneratePlanButton";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
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
  title: "Onboarding & Internal Mobility",
  description: "AI onboarding checklists, skill-gap analysis and retention scoring",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

const CAPABILITIES = [
  {
    icon: CheckCircle2,
    title: "AI onboarding checklists",
    copy: "Admin, IT, training, culture and role-specific tasks generated per hire, with due dates offset from the start date.",
    points: ["Auto-generated per role", "Progress tracking", "Automatic reminders"],
  },
  {
    icon: FolderOpen,
    title: "Skill gap analysis",
    copy: "Assessment scores are compared against role requirements to surface gaps and recommend targeted development actions.",
    points: ["Gap detection", "Learning recommendations", "Internal mobility matches"],
  },
  {
    icon: TrendingUp,
    title: "Retention risk scoring",
    copy: "Turnover likelihood within the first 12 months, based on engagement signals, score trends and sector benchmarks.",
    points: ["0–100% risk score", "Early-warning flags", "Action plans"],
  },
] as const;

function riskTone(score: number) {
  if (score >= 70) return "danger" as const;
  if (score >= 50) return "gold" as const;
  return "success" as const;
}

async function OnboardingData() {
  const { plans, summary, unplanned } = await getOnboardingData();

  if (plans.length === 0 && unplanned.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No hires yet"
          description="Once a candidate reaches the Hired stage you can generate their onboarding plan, skill-gap map and retention forecast here."
          icon={<UserRoundPlus className="h-8 w-8" aria-hidden />}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active plans" value={summary.active} hint="Onboarding in progress" />
        <StatTile label="Average progress" value={`${summary.avg_progress}%`} hint="Across active plans" />
        <StatTile
          label="Retention risk"
          value={summary.at_risk}
          hint="Hires scoring 50% or above"
        />
        <StatTile label="AI generated" value={summary.ai_generated} hint="Plans built by the model" />
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
                    {plan.generated_by_ai && (
                      <Badge tone="gold">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        AI
                      </Badge>
                    )}
                    {plan.retention_risk_score !== null && (
                      <Badge tone={riskTone(plan.retention_risk_score)}>
                        Risk {plan.retention_risk_score}%
                      </Badge>
                    )}
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
  const user = await requireStaff("/onboarding");

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Post-hiring"
        title="Onboarding & mobility"
        description="Turn accepted offers into structured, measurable journeys — with live progress, skill gaps and retention insight."
      />

      <Suspense
        fallback={
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        }
      >
        <OnboardingData />
      </Suspense>

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
    </AdminShell>
  );
}