import { Suspense } from "react";
import { Clock, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import { getDashboardAnalytics } from "./actions";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import type { DashboardAnalytics } from "@/types";
import { connection } from "next/server";

export const metadata = {
  title: "Recruiter Analytics Dashboard",
  description: "Real-time hiring pipeline, AI fit scores, and diversity metrics",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

function stageTone(stage: string) {
  if (stage === "HIRED") return "success" as const;
  if (stage === "REJECTED") return "danger" as const;
  if (stage === "OFFER" || stage === "INTERVIEW") return "gold" as const;
  return "info" as const;
}

async function DashboardContent() {
  const analytics: DashboardAnalytics = await getDashboardAnalytics();

  const maxPipeline = Math.max(...analytics.pipeline.map((p) => p.count), 1);
  const totalScored = analytics.fit_distribution.reduce((sum, b) => sum + b.count, 0);
  const maxChannel = Math.max(...analytics.channels.map((c) => c.applications), 1);

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ---- Key metrics ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Applications"
          value={analytics.total_applications}
          hint="All sources combined"
          icon={<Users className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Active openings"
          value={analytics.active_jobs}
          hint="Published job titles"
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Avg AI fit"
          value={`${analytics.avg_fit_score}%`}
          hint={`${totalScored} candidates scored`}
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Time to hire"
          value={`${analytics.avg_time_to_hire_days}d`}
          hint="Rolling 6-month average"
          icon={<Clock className="h-5 w-5" aria-hidden />}
        />
      </div>

      {/* ---- Pipeline funnel ---- */}
      <Card>
        <CardHeader title="Pipeline conversion" meta="Live from applications" />
        <div className="p-5 sm:p-6">
          <div className="flex gap-3 overflow-x-auto pb-2 sm:gap-5">
            {analytics.pipeline.map((step) => (
              <div key={step.stage} className="flex min-w-[92px] flex-1 flex-col items-center text-center">
                <div className="flex h-28 w-full items-end sm:h-32">
                  <div
                    className="w-full rounded-t-xl bg-gradient-to-t from-brand-gold-dark to-brand-gold-light transition-[height] duration-700"
                    style={{ height: `${Math.max((step.count / maxPipeline) * 100, 4)}%` }}
                    title={`${step.count} candidates`}
                  />
                </div>
                <p className="mt-3 font-display text-lg font-extrabold leading-none">
                  {step.count}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/50">
                  {step.stage.replace("_", " ")}
                </p>
                <p className="text-[10px] text-brand-ink/40">
                  {step.conversion_rate}% conv.
                </p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ---- Channels + fit distribution ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Channel effectiveness" meta="Sourcing mix" />
          <div className="space-y-4 p-5 sm:p-6">
            {analytics.channels.length === 0 ? (
              <EmptyState
                title="No channel data yet"
                description="Applications will be grouped by source as soon as they arrive."
              />
            ) : (
              analytics.channels.map((channel) => (
                <div key={channel.source}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="font-bold tracking-wide text-brand-ink/75">
                      {channel.source.replace("_", " ")}
                    </span>
                    <span className="text-brand-ink/50">
                      {channel.applications} applications · {channel.hires} hired ·{" "}
                      <strong className="text-brand-gold-dark">{channel.conversion_rate}%</strong>
                    </span>
                  </div>
                  <Meter
                    value={channel.applications}
                    max={maxChannel}
                    tone={channel.hires > 0 ? "success" : "gold"}
                  />
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="AI fit distribution" meta={`${totalScored} scored`} />
          <div className="space-y-5 p-5 sm:p-6">
            {analytics.fit_distribution.map((bucket) => (
              <div key={bucket.range}>
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-brand-ink/70">{bucket.range}</span>
                  <span className="font-display font-bold">{bucket.count}</span>
                </div>
                <Meter
                  value={bucket.count}
                  max={Math.max(totalScored, 1)}
                  tone={bucket.range.startsWith("80") ? "success" : "gold"}
                />
              </div>
            ))}

            {totalScored === 0 && (
              <EmptyState
                title="No scores yet"
                description="Run AI screening on an application to populate this chart."
              />
            )}
          </div>
        </Card>
      </div>

      {/* ---- Candidate ranking ---- */}
      <Card className="overflow-hidden">
        <CardHeader title="Candidate ranking" meta="Ranked by AI match score" />
        {analytics.top_candidates.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="Submitted applications will appear here, ranked automatically."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                  <tr>
                    <th className="px-6 py-3">Candidate</th>
                    <th className="px-6 py-3">Role</th>
                    <th className="px-6 py-3">Stage</th>
                    <th className="px-6 py-3 text-center">AI fit</th>
                    <th className="px-6 py-3 text-center">Assessment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {analytics.top_candidates.map((candidate) => (
                    <tr key={candidate.application_id} className="transition hover:bg-brand-cream">
                      <td className="px-6 py-3.5 font-semibold">{candidate.full_name}</td>
                      <td className="px-6 py-3.5 text-brand-ink/60">
                        {candidate.job_title || "—"}
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge tone={stageTone(candidate.stage)}>
                          {candidate.stage.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="mx-auto flex w-28 items-center gap-2">
                          <span className="w-9 text-right font-display font-bold text-brand-gold-dark">
                            {candidate.match_score}%
                          </span>
                          <Meter value={candidate.match_score} className="flex-1" />
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        {candidate.assessment_score !== null ? (
                          <span className="font-display font-bold">
                            {candidate.assessment_score}
                          </span>
                        ) : (
                          <span className="text-xs text-brand-ink/35">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-brand-line md:hidden">
              {analytics.top_candidates.map((candidate) => (
                <li key={candidate.application_id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{candidate.full_name}</p>
                      <p className="truncate text-xs text-brand-ink/55">
                        {candidate.job_title || "—"}
                      </p>
                    </div>
                    <Badge tone={stageTone(candidate.stage)}>
                      {candidate.stage.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right text-sm font-display font-bold text-brand-gold-dark">
                      {candidate.match_score}%
                    </span>
                    <Meter value={candidate.match_score} className="flex-1" />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

export default async function DashboardPage() {
  await connection();
  const user = await requireStaff("/dashboard");

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Recruit intelligence"
        title="Hiring overview"
        description="Real-time pipeline movement, AI fit scores and sourcing performance across the Sharm Dreams Group."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Zap className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Live data
          </span>
        }
      />

      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-white" />
              ))}
            </div>
            <div className="h-80 animate-pulse rounded-2xl bg-white" />
            <div className="h-64 animate-pulse rounded-2xl bg-white" />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </AdminShell>
  );
}