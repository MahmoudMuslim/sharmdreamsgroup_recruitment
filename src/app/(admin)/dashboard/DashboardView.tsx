"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Briefcase,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { ApplicationStage, DashboardAnalytics, DashboardCandidate } from "@/types";

type SortKey = "name" | "role" | "stage" | "fit" | "assessment" | "applied";

const STAGE_TONES: Record<string, "neutral" | "gold" | "success" | "danger" | "info"> = {
  HIRED: "success",
  REJECTED: "danger",
  OFFER: "gold",
  INTERVIEW: "gold",
};

function stageTone(stage: string) {
  return STAGE_TONES[stage] ?? "info";
}

function prettyStage(stage: string) {
  return stage.replace("_", " ");
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** True when a score falls inside a bucket range label such as "50–79". */
function inBucket(range: string, score: number | null) {
  if (score === null) return false;
  const [lo, hi] = range.split(/[–-]/).map((n) => Number(n.trim()));
  return score >= lo && score <= hi;
}

function Tile({
  label,
  value,
  hint,
  icon,
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  delta?: { value: number; label: string } | null;
}) {
  const up = (delta?.value ?? 0) > 0;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
          {label}
        </p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-3xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-brand-ink/50">{hint}</p>}
      {delta && delta.value !== 0 && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            up ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-700"
          )}
        >
          {up ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          {up ? "+" : ""}
          {delta.value}
          {delta.label}
        </p>
      )}
    </Card>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold bg-brand-gold/15 py-1 pl-2.5 pr-1 text-[11px] font-bold uppercase tracking-wide text-brand-gold-dark">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label} filter`}
        className="rounded-full p-0.5 transition hover:bg-brand-gold/25"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Dashboard board.
 *
 * The funnel, channels and score buckets are all controls: clicking one filters
 * the candidate table below it, so the page answers "who is in this stage and
 * where did they come from?" without a second trip to the candidates portal.
 *
 * The same four filters can arrive in the URL (`?stage=`, `?source=`,
 * `?bucket=`, `?q=`), which is how a link from the assistant — or a saved
 * bookmark — opens the board already narrowed to the question being asked.
 * Values that are not real options are ignored rather than emptied onto.
 */
export function DashboardView({ analytics }: { analytics: DashboardAnalytics }) {
  const params = useSearchParams();

  const fromUrl = useMemo(
    () => ({
      stage: analytics.pipeline.some((step) => step.stage === params.get("stage"))
        ? (params.get("stage") as ApplicationStage)
        : null,
      source: analytics.channels.some((channel) => channel.source === params.get("source"))
        ? (params.get("source") as string)
        : null,
      bucket:
        !analytics.scores_masked &&
        analytics.fit_distribution.some((bucket) => bucket.range === params.get("bucket"))
          ? (params.get("bucket") as string)
          : null,
      query: params.get("q") ?? "",
    }),
    [params, analytics]
  );

  const [stage, setStage] = useState<ApplicationStage | null>(fromUrl.stage);
  const [source, setSource] = useState<string | null>(fromUrl.source);
  const [bucket, setBucket] = useState<string | null>(fromUrl.bucket);
  const [query, setQuery] = useState(fromUrl.query);
  const [sortKey, setSortKey] = useState<SortKey>("fit");
  const [sortDesc, setSortDesc] = useState(true);
  const [range, setRange] = useState<7 | 14>(14);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  // Moving to /dashboard with a different filter query re-renders this board
  // instead of remounting it, so the incoming filters are applied here too.
  const [appliedFilters, setAppliedFilters] = useState(fromUrl);
  if (appliedFilters !== fromUrl) {
    setAppliedFilters(fromUrl);
    setStage(fromUrl.stage);
    setSource(fromUrl.source);
    setBucket(fromUrl.bucket);
    setQuery(fromUrl.query);
  }

  const series = analytics.applications_last_14_days.slice(-range);
  const maxDay = Math.max(...series.map((d) => d.count), 1);

  const thisWeek = analytics.applications_last_14_days.slice(7).reduce((s, d) => s + d.count, 0);
  const lastWeek = analytics.applications_last_14_days.slice(0, 7).reduce((s, d) => s + d.count, 0);
  const weekDelta = lastWeek === 0 ? thisWeek : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

  const trendMonths = analytics.time_to_hire_trend;
  const maxTrend = Math.max(...trendMonths.map((p) => p.avg_days), 1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = analytics.candidates.filter(
      (c) =>
        (!stage || c.stage === stage) &&
        (!source || c.source === source) &&
        (!bucket || inBucket(bucket, c.match_score)) &&
        (!q ||
          c.full_name.toLowerCase().includes(q) ||
          c.job_title.toLowerCase().includes(q) ||
          c.department.toLowerCase().includes(q))
    );
    const dir = sortDesc ? -1 : 1;
    return rows.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.full_name.localeCompare(b.full_name) * dir;
        case "role":
          return a.job_title.localeCompare(b.job_title) * dir;
        case "stage":
          return a.stage.localeCompare(b.stage) * dir;
        case "assessment":
          return ((a.assessment_score ?? -1) - (b.assessment_score ?? -1)) * dir;
        case "applied":
          return (
            (new Date(a.applied_at ?? 0).getTime() - new Date(b.applied_at ?? 0).getTime()) * dir
          );
        default:
          return ((a.match_score ?? -1) - (b.match_score ?? -1)) * dir;
      }
    });
  }, [analytics.candidates, stage, source, bucket, query, sortKey, sortDesc]);

  const maxChannel = Math.max(...analytics.channels.map((c) => c.applications), 1);
  const maxPipeline = Math.max(...analytics.pipeline.map((p) => p.count), 1);
  const activeFilters = Boolean(stage || source || bucket || query);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  function clearFilters() {
    setStage(null);
    setSource(null);
    setBucket(null);
    setQuery("");
  }

  const boardHref = `/candidates${stage || query ? `?${new URLSearchParams({ ...(stage ? { stage} : {}), ...(query ? { q: query } : {}) }).toString()}` : ""}`;

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ---- Key metrics ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          label="Applications"
          value={analytics.total_applications}
          hint={`${thisWeek} in the last 7 days`}
          icon={<Users className="h-5 w-5" aria-hidden />}
          delta={{ value: weekDelta, label: "% vs prior week" }}
        />
        <Tile
          label="Open roles"
          value={analytics.active_jobs}
          hint="Published and accepting"
          icon={<Briefcase className="h-5 w-5" aria-hidden />}
        />
        <Tile
          label="Avg AI fit"
          value={analytics.scores_masked ? "Hidden" : `${analytics.avg_fit_score}%`}
          hint={
            analytics.scores_masked
              ? "Masked for your role"
              : `${analytics.scored_applications} of ${analytics.total_applications} scored`
          }
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
        />
        <Tile
          label="Hires"
          value={analytics.hires_this_quarter}
          hint="Applications at HIRED stage"
          icon={<UserPlus className="h-5 w-5" aria-hidden />}
        />
        <Tile
          label="Time to hire"
          value={`${analytics.avg_time_to_hire_days}d`}
          hint="Rolling 6-month average"
          icon={<Clock className="h-5 w-5" aria-hidden />}
        />
      </div>

      {/* ---- Application trend + time to hire ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Application flow" meta="Daily submissions" />
          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-brand-ink/55" aria-live="polite">
                {hoverDay === null
                  ? `${series.reduce((s, d) => s + d.count, 0)} applications in the last ${range} days`
                  : `${shortDate(series[hoverDay].date)} — ${series[hoverDay].count} application${series[hoverDay].count === 1 ? "" : "s"}`}
              </p>
              <div className="flex gap-1" role="group" aria-label="Trend range">
                {([7, 14] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={range === option}
                    onClick={() => {
                      setRange(option);
                      setHoverDay(null);
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-bold transition",
                      range === option
                        ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                        : "border-brand-line bg-white text-brand-ink/55 hover:bg-brand-sand"
                    )}
                  >
                    {option}d
                  </button>
                ))}
              </div>
            </div>

            <div className="flex h-36 items-end gap-1.5">
              {series.map((day, index) => (
                <button
                  key={day.date}
                  type="button"
                  onMouseEnter={() => setHoverDay(index)}
                  onMouseLeave={() => setHoverDay(null)}
                  onFocus={() => setHoverDay(index)}
                  onBlur={() => setHoverDay(null)}
                  aria-label={`${day.count} applications on ${day.date}`}
                  className="group flex h-full flex-1 flex-col justify-end gap-1 focus:outline-none"
                >
                  <div
                    className={cn(
                      "w-full rounded-t-lg bg-gradient-to-t from-brand-gold-dark to-brand-gold-light transition-all duration-500",
                      hoverDay === index && "from-brand-ink to-brand-gold-dark"
                    )}
                    style={{ height: `${Math.max((day.count / maxDay) * 100, 3)}%` }}
                  />
                  <span className="truncate text-[9px] font-semibold text-brand-ink/40">
                    {shortDate(day.date)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Time to hire" meta="Monthly average" />
          <div className="space-y-3 p-5 sm:p-6">
            {trendMonths.map((point) => (
              <div key={point.month}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-bold uppercase tracking-wide text-brand-ink/60">
                    {point.month}
                  </span>
                  <span className="font-display font-bold">
                    {point.avg_days > 0 ? `${point.avg_days}d` : "no hires"}
                  </span>
                </div>
                <Meter value={point.avg_days} max={maxTrend} tone={point.avg_days > 0 ? "gold" : "ink"} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---- Pipeline funnel (clickable) ---- */}
      <Card>
        <CardHeader
          title="Pipeline conversion"
          meta={stage ? `Filtered to ${prettyStage(stage)}` : "Click a stage to filter the board"}
        />
        <div className="p-5 sm:p-6">
          <div className="flex gap-3 overflow-x-auto pb-2 sm:gap-5">
            {analytics.pipeline.map((step) => {
              const active = stage === step.stage;
              return (
                <button
                  key={step.stage}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStage(active ? null : step.stage)}
                  className={cn(
                    "flex min-w-[92px] flex-1 flex-col items-center rounded-2xl border px-2 pb-2 pt-3 text-center transition",
                    active
                      ? "border-brand-gold bg-brand-gold/10 shadow-soft"
                      : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                  )}
                >
                  <div className="flex h-24 w-full items-end sm:h-28">
                    <div
                      className={cn(
                        "w-full rounded-t-xl bg-gradient-to-t transition-[height] duration-700",
                        step.stage === "REJECTED"
                          ? "from-rose-700 to-rose-400"
                          : "from-brand-gold-dark to-brand-gold-light"
                      )}
                      style={{ height: `${Math.max((step.count / maxPipeline) * 100, 4)}%` }}
                    />
                  </div>
                  <p className="mt-2 font-display text-lg font-extrabold leading-none">
                    {step.count}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/50">
                    {prettyStage(step.stage)}
                  </p>
                  <p className="text-[10px] text-brand-ink/40">{step.conversion_rate}% conv.</p>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ---- Channels + fit distribution ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Channel effectiveness" meta="Click a source to filter" />
          <div className="space-y-3 p-5 sm:p-6">
            {analytics.channels.length === 0 ? (
              <EmptyState
                title="No channel data yet"
                description="Applications will be grouped by source as soon as they arrive."
              />
            ) : (
              analytics.channels.map((channel) => {
                const active = source === channel.source;
                return (
                  <button
                    key={channel.source}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSource(active ? null : channel.source)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-brand-gold bg-brand-gold/10"
                        : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                    )}
                  >
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                      <span className="font-bold tracking-wide text-brand-ink/75">
                        {prettyStage(channel.source)}
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
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="AI fit distribution" meta={`${analytics.scored_applications} scored`} />
          <div className="space-y-4 p-5 sm:p-6">
            {analytics.scores_masked ? (
              <EmptyState
                title="Scores are hidden"
                description="Your role is not granted “View unmasked scores”, so the fit buckets are withheld."
              />
            ) : (
              <>
                {analytics.fit_distribution.map((item) => {
                  const active = bucket === item.range;
                  return (
                    <button
                      key={item.range}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setBucket(active ? null : item.range)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition",
                        active
                          ? "border-brand-gold bg-brand-gold/10"
                          : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                      )}
                    >
                      <div className="mb-1.5 flex items-baseline justify-between text-xs">
                        <span className="font-semibold text-brand-ink/70">{item.range}</span>
                        <span className="font-display font-bold">{item.count}</span>
                      </div>
                      <Meter
                        value={item.count}
                        max={Math.max(analytics.scored_applications, 1)}
                        tone={item.range.startsWith("80") ? "success" : "gold"}
                      />
                    </button>
                  );
                })}
                {analytics.scored_applications === 0 && (
                  <EmptyState
                    title="No scores yet"
                    description="Run AI screening on an application to populate this chart."
                  />
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ---- Candidate board ---- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold sm:text-lg">Candidate board</h2>
            <p className="mt-0.5 text-xs text-brand-ink/45">
              Showing {filtered.length} of {analytics.candidates.length} applications
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-cream px-3 py-1.5 focus-within:border-brand-gold focus-within:bg-white">
              <Search className="h-4 w-4 shrink-0 text-brand-ink/35" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, role or department…"
                aria-label="Search candidates"
                className="w-40 bg-transparent text-sm placeholder:text-brand-ink/35 focus:outline-none sm:w-56"
              />
            </div>
            <Link
              href="/candidates"
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              Full board
            </Link>
          </div>
        </div>

        {activeFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-line bg-brand-cream/60 px-5 py-3 sm:px-6">
            {stage && <FilterChip label={prettyStage(stage)} onClear={() => setStage(null)} />}
            {source && <FilterChip label={prettyStage(source)} onClear={() => setSource(null)} />}
            {bucket && <FilterChip label={`fit ${bucket}`} onClear={() => setBucket(null)} />}
            {query && <FilterChip label={`“${query}”`} onClear={() => setQuery("")} />}
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-brand-line bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/55 transition hover:bg-brand-sand"
            >
              Clear all
            </button>
            <Link
              href={boardHref}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-brand-gold-dark hover:underline"
            >
              Open on candidates board
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            title="No candidates match these filters"
            description="Clear a filter or widen the search to see applications here."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                  <tr>
                    {(
                      [
                        ["name", "Candidate"],
                        ["role", "Role"],
                        ["stage", "Stage"],
                        ["applied", "Applied"],
                        ["fit", "AI fit"],
                        ["assessment", "Assessment"],
                      ] as [SortKey, string][]
                    ).map(([key, label], index, all) => (
                      <th
                        key={key}
                        className={cn("px-4 py-3", index === 0 && "pl-6", index === all.length - 1 && "pr-6")}
                        aria-sort={
                          sortKey === key ? (sortDesc ? "descending" : "ascending") : "none"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={cn(
                            "inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-brand-ink",
                            sortKey === key && "text-brand-gold-dark"
                          )}
                        >
                          {label}
                          {sortKey === key ? (
                            sortDesc ? (
                              <ChevronDown className="h-3 w-3" aria-hidden />
                            ) : (
                              <ChevronUp className="h-3 w-3" aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {filtered.map((candidate) => (
                    <CandidateRow
                      key={candidate.application_id}
                      candidate={candidate}
                      masked={analytics.scores_masked}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-brand-line md:hidden">
              {filtered.map((candidate) => (
                <li key={candidate.application_id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{candidate.full_name}</p>
                      <p className="truncate text-xs text-brand-ink/55">
                        {candidate.job_title || "—"}
                        {candidate.department && ` · ${candidate.department}`}
                      </p>
                    </div>
                    <Badge tone={stageTone(candidate.stage)}>{prettyStage(candidate.stage)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right text-sm font-display font-bold text-brand-gold-dark">
                      {candidate.match_score === null
                        ? analytics.scores_masked
                          ? "—"
                          : "0"
                        : `${candidate.match_score}%`}
                    </span>
                    {analytics.scores_masked ? (
                      <span className="flex-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
                        Scores hidden
                      </span>
                    ) : (
                      <Meter value={candidate.match_score ?? 0} className="flex-1" />
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-brand-ink/40">
                      {prettyStage(candidate.source)} · {shortDate(candidate.applied_at)}
                    </span>
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

function CandidateRow({ candidate, masked }: { candidate: DashboardCandidate; masked: boolean }) {
  return (
    <tr className="transition hover:bg-brand-cream">
      <td className="py-3.5 pl-6 pr-4">
        <p className="font-semibold">{candidate.full_name}</p>
        <p className="text-[11px] uppercase tracking-wide text-brand-ink/40">
          {prettyStage(candidate.source)} · {shortDate(candidate.applied_at)}
        </p>
      </td>
      <td className="px-4 py-3.5 text-brand-ink/60">
        <p>{candidate.job_title || "—"}</p>
        {candidate.department && (
          <p className="text-[11px] text-brand-ink/40">{candidate.department}</p>
        )}
      </td>
      <td className="px-4 py-3.5">
        <Badge tone={stageTone(candidate.stage)}>{prettyStage(candidate.stage)}</Badge>
      </td>
      <td className="px-4 py-3.5 text-xs text-brand-ink/55">{shortDate(candidate.applied_at)}</td>
      <td className="px-4 py-3.5">
        {masked ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
            Hidden
          </span>
        ) : (
          <div className="flex w-28 items-center gap-2">
            <span className="w-9 text-right font-display font-bold text-brand-gold-dark">
              {candidate.match_score === null ? "0" : `${candidate.match_score}%`}
            </span>
            <Meter value={candidate.match_score ?? 0} className="flex-1" />
          </div>
        )}
      </td>
      <td className="py-3.5 pl-4 pr-6">
        {masked ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
            Hidden
          </span>
        ) : candidate.has_assessment ? (
          <span className="font-display font-bold">{candidate.assessment_score ?? "—"}</span>
        ) : (
          <span className="text-xs text-brand-ink/35">Pending</span>
        )}
      </td>
    </tr>
  );
}
