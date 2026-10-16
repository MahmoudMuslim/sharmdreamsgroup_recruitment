"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  ExternalLink,
  Filter,
  Hourglass,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Meter,
} from "@/modules/analytics/presentation/ui";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { inBucket } from "@/modules/analytics/domain/fitBuckets";
import { BOARD_LIMIT } from "@/app/(admin)/dashboard/board-model";
import { cn, formatDateTime } from "@/lib/utils";
import {
  getDashboardDrilldown,
  type DashboardDrillResult,
  type DashboardDrillRow,
  type DashboardDrillScope,
} from "./actions";
import type {
  ApplicationStage,
  DashboardAnalytics,
  DashboardCandidate,
  DashboardRoleRow,
} from "@/types";

type SortKey = "name" | "role" | "stage" | "fit" | "assessment" | "applied";

/** Which popup the recruiter opened, and what it has to read to answer it. */
type Panel = { kind: "roles" } | { kind: "applications"; scope: DashboardDrillScope };

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

/** `2026-10-15` → `Wed, Oct 15`, read as a calendar day rather than a moment. */
function longDate(day: string) {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/**
 * A headline number that answers "who is behind this?" when it is clicked.
 *
 * The whole card is the control, so the recruiter never hunts for a link hidden
 * in a corner — and a card only gets a click target when there is a read that
 * can genuinely list the rows behind the figure.
 */
function Tile({
  label,
  value,
  hint,
  icon,
  delta,
  detail,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
  delta?: { value: number; label: string } | null;
  /** What the popup will show, e.g. "Every live application". */
  detail?: string;
  onClick?: () => void;
}) {
  const up = (delta?.value ?? 0) > 0;
  return (
    <Card className={cn("group relative p-5", onClick && "hover:border-brand-gold hover:shadow-soft")}>
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
      {onClick && detail && (
        <p className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/35 transition group-hover:text-brand-gold-dark">
          {detail}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </p>
      )}
      {onClick && (
        // Last in the DOM, so the whole card is one click target and the text
        // above it stays selectable-looking rather than half-interactive.
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}: ${detail}`}
          className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        />
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

/** Small strip at the bottom of a card that carries its next step. */
function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-line bg-brand-cream px-5 py-3 sm:px-6">
      {children}
    </div>
  );
}

function GhostAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60 transition hover:bg-brand-sand hover:text-brand-ink"
    >
      {children}
    </button>
  );
}

/** The one control every chart row shares: narrow the board under the charts. */
function BoardFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      aria-label={active ? `Board is filtered to ${label}` : `Filter the board to ${label}`}
      title={active ? `Board is filtered to ${label}` : `Filter the board to ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition",
        active
          ? "border-brand-gold bg-brand-gold/20 text-brand-gold-dark"
          : "border-brand-line bg-white text-brand-ink/50 hover:bg-brand-sand hover:text-brand-ink"
      )}
    >
      <Filter className="h-3 w-3" aria-hidden />
      {active ? "Filtered" : "Filter"}
    </button>
  );
}

function RoleLine({
  role,
  max,
  masked,
  onSelect,
}: {
  role: DashboardRoleRow;
  max: number;
  masked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition hover:border-brand-line hover:bg-brand-cream"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{role.title}</p>
          <p className="truncate text-[11px] text-brand-ink/50">
            {role.department || "—"} · {prettyStage(role.status) || "no status"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-base font-extrabold leading-none">{role.applications}</p>
          <p className="text-[10px] uppercase tracking-wider text-brand-ink/40">apps</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brand-ink/55">
        <span>{role.hires} hired</span>
        {!masked && role.avg_fit !== null && (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-brand-gold" aria-hidden />
            {role.avg_fit}% avg fit
          </span>
        )}
        {role.oldest_waiting_days !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              role.oldest_waiting_days >= 14 && "font-bold text-rose-700"
            )}
          >
            <Hourglass className="h-3 w-3" aria-hidden />
            {role.oldest_waiting_days}d waiting
          </span>
        )}
        {role.closing_at && <span>closes {shortDate(role.closing_at)}</span>}
        <Meter value={role.applications} max={max} className="ml-auto w-16" />
      </div>
    </button>
  );
}

/**
 * The rows behind one dashboard figure, read from the database on open.
 *
 * The board under the charts only ships 200 applications, and every figure here
 * counts all of them, so a popup that names a total has to re-read rather than
 * count the rows the browser happens to be holding.
 */
function DrillPanel({ scope, masked }: { scope: DashboardDrillScope; masked: boolean }) {
  const [result, setResult] = useState<DashboardDrillResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    getDashboardDrilldown(scope).then(
      (next) => {
        if (active) setResult(next);
      },
      () => {
        // A rejected action call is a session or transport failure, not a
        // recruiter error, so it reads the same as a retry would.
        if (active) setResult({ ok: false, error: "These applications could not be read. Please retry." });
      }
    );
    return () => {
      active = false;
    };
  }, [scope, retry]);

  function reload() {
    setResult(null);
    setRetry((count) => count + 1);
  }

  if (!result) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-brand-ink/55">
        <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
        Reading the applications behind this figure…
      </p>
    );
  }

  if (!result.ok) {
    return (
      <div className="space-y-3 py-2">
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-800">
          {result.error}
        </p>
        <GhostAction onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </GhostAction>
      </div>
    );
  }

  const { rows, total, shown, read_at } = result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5">
        <p className="text-sm" aria-live="polite">
          <strong className="font-display text-base font-extrabold">
            {total.toLocaleString()}
          </strong>{" "}
          application{total === 1 ? "" : "s"}
          <span className="text-[11px] text-brand-ink/50">
            {" "}
            · {shown < total ? `first ${shown} listed` : "all listed"} · read{" "}
            {formatDateTime(read_at)}
          </span>
        </p>
        <GhostAction onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Recount
        </GhostAction>
      </div>

      {/* Filed records are never part of a dashboard count, so say what is not
          in the list rather than let a missing name look like a bug. */}
      {total === 0 ? (
        <EmptyState
          title="Nothing matches this yet"
          description="Filed-away records are excluded, so an empty list means the pipeline genuinely holds none."
        />
      ) : (
        <>
          {scope.type !== "stage" && rows.length > 1 && <StageStrip rows={rows} />}
          <ul className="divide-y divide-brand-line">
            {rows.map((row) => (
              <DrillRow key={row.application_id} row={row} masked={masked} />
            ))}
          </ul>
          {shown < total && (
            <p className="text-[11px] text-brand-ink/45">
              The {shown} most recent are listed — use the candidates board search to reach the
              rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Stage mix of the rows on screen, so a popup is scannable before it is read. */
function StageStrip({ rows }: { rows: DashboardDrillRow[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
  const steps = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
        Of these {rows.length}
      </span>
      {steps.map(([stage, count]) => (
        <Badge key={stage} tone={stageTone(stage)}>
          {prettyStage(stage)} · {count}
        </Badge>
      ))}
    </div>
  );
}

function DrillRow({ row, masked }: { row: DashboardDrillRow; masked: boolean }) {
  const clock =
    row.days_to_hire !== null
      ? `${row.days_to_hire}d to hire`
      : row.waiting_days !== null
        ? `waiting ${row.waiting_days}d`
        : row.hired_at
          ? `hired ${shortDate(row.hired_at)}`
          : "closed";

  return (
    <li className="group flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          href={`/candidates?application=${row.application_id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-brand-gold-dark hover:underline"
        >
          {row.full_name}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100" aria-hidden />
        </Link>
        <p className="truncate text-[11px] text-brand-ink/45">
          {row.email} · {row.tracking_code}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-brand-ink/55">
          {row.job_title || "—"} · {prettyStage(row.source)} · applied {shortDate(row.applied_at)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Badge tone={stageTone(row.stage)}>{prettyStage(row.stage)}</Badge>
        <p className="mt-1.5 text-[11px] font-bold text-brand-ink/55">{clock}</p>
        {!masked && (
          <p className="mt-0.5 text-[11px] text-brand-gold-dark">
            {row.match_score === null ? "unscored" : `${row.match_score}% fit`}
            {row.has_assessment &&
              ` · ${row.assessment_score === null ? "assessment" : `score ${row.assessment_score}`}`}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Dashboard board.
 *
 * Every figure is a question and a control: the funnel, channels and score
 * buckets still filter the candidate table below them, and clicking one now also
 * opens a drawer that lists the applications behind the number, read live from
 * the database. The two are separate buttons on the same row, so filtering the
 * board never costs a click it did not used to.
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
  const [panel, setPanel] = useState<Panel | null>(null);

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
  /**
   * A share needs a denominator, and an empty prior week has none.
   *
   * Dividing by zero used to be dodged by handing back `thisWeek` instead — a
   * count of arrivals printed inside a chip that says "% vs prior week", so the
   * quiet start of a pipeline read as a 4% rise rather than as nothing to compare
   * against. `null` means no ratio exists, and the tile prints no chip for it.
   */
  const weekDelta = lastWeek === 0 ? null : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  const arrivalsHint =
    lastWeek > 0
      ? `${thisWeek} in the last 7 days`
      : thisWeek > 0
        ? `${thisWeek} in the last 7 days, none in the 7 before`
        : "Nothing arrived in either of the last two weeks";

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
  const maxRole = Math.max(...analytics.roles.map((r) => r.applications), 1);
  const activeFilters = Boolean(stage || source || bucket || query);
  const masked = analytics.scores_masked;

  /**
   * The one rail the board is filtered by, and the count its own tile claims.
   *
   * Those tiles are server counts of every live application while this board can
   * only hold `BOARD_LIMIT` of them, so a rail click narrows a slice, not the set
   * the number describes. Only a single active rail can be attributed to one
   * tile; with two, neither count belongs to the intersection.
   */
  const rail = useMemo(() => {
    if ([stage, source, bucket].filter(Boolean).length !== 1) return null;
    if (stage) {
      const step = analytics.pipeline.find((item) => item.stage === stage);
      return step ? { label: `${prettyStage(step.stage)} tile`, total: step.count, href: `/candidates?stage=${step.stage}` } : null;
    }
    if (source) {
      const channel = analytics.channels.find((item) => item.source === source);
      return channel
        ? { label: `${channel.source} tile`, total: channel.applications, href: `/candidates?source=${channel.source}` }
        : null;
    }
    if (bucket) {
      const band = analytics.fit_distribution.find((item) => item.range === bucket);
      // A fit band has no rail on the candidates board, so its own popup is the
      // only door that reads the whole set.
      return band ? { label: `fit ${band.range} tile`, total: band.count, href: null } : null;
    }
    return null;
  }, [analytics, stage, source, bucket]);

  const boardHolds = analytics.candidates.length;
  const rowsNotLoaded = Math.max(0, analytics.total_applications - boardHolds);
  const railHidden = rail ? Math.max(0, rail.total - filtered.length) : 0;

  function drill(scope: DashboardDrillScope) {
    setPanel({ kind: "applications", scope });
  }

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

  /** The board filter the open popup can also be read as, if it maps to one. */
  function scopeFilter(scope: DashboardDrillScope): "stage" | "source" | "bucket" | null {
    if (scope.type === "stage" || scope.type === "source" || scope.type === "bucket") {
      return scope.type;
    }
    return null;
  }

  function applyScopeToBoard(scope: DashboardDrillScope) {
    if (scope.type === "stage") setStage(scope.stage);
    else if (scope.type === "source") setSource(scope.source);
    else if (scope.type === "bucket") setBucket(scope.range);
    setPanel(null);
  }

  const openPanel = panel?.kind === "applications" ? panel.scope : null;
  const panelFilter = openPanel ? scopeFilter(openPanel) : null;

  const boardHref = `/candidates${stage || query ? `?${new URLSearchParams({ ...(stage ? { stage} : {}), ...(query ? { q: query } : {}) }).toString()}` : ""}`;

  /** Where the drawer's "candidates board" button lands, filters and all. */
  function panelBoardHref(scope: DashboardDrillScope | null): string {
    if (!scope) return "/candidates";
    if (scope.type === "stage") return `/candidates?stage=${scope.stage}`;
    if (scope.type === "role") {
      const title = analytics.roles.find((role) => role.job_id === scope.jobId)?.title ?? "";
      return title ? `/candidates?q=${encodeURIComponent(title)}` : "/candidates";
    }
    return "/candidates";
  }

  function panelHeading(): { eyebrow: string; title: string; subtitle: string } {
    if (!panel) return { eyebrow: "", title: "", subtitle: "" };
    if (panel.kind === "roles") {
      return {
        eyebrow: "Openings",
        title: "Every role the board knows",
        subtitle: `${analytics.roles.length} openings read with this page · ${analytics.active_jobs} published · busiest first`,
      };
    }
    const scope = panel.scope;
    switch (scope.type) {
      case "all":
        return {
          eyebrow: "Applications",
          title: "Every live application",
          subtitle: `${analytics.total_applications.toLocaleString()} when this page was read · filed-away records excluded`,
        };
      case "stage": {
        const step = analytics.pipeline.find((p) => p.stage === scope.stage);
        return {
          eyebrow: "Pipeline stage",
          title: `At ${prettyStage(scope.stage)}`,
          subtitle: `${step?.count ?? 0} here when this page was read · ${
            step?.share_of_pipeline ?? 0
          }% of the ${analytics.total_applications.toLocaleString()} live applications${
            step?.vs_previous_stage
              ? ` · ${step.vs_previous_stage.percent}% measured against the ${
                  step.vs_previous_stage.count
                } sitting at ${prettyStage(step.vs_previous_stage.stage)}, not a count of moves`
              : ""
          }`,
        };
      }
      case "source": {
        const channel = analytics.channels.find((c) => c.source === scope.source);
        return {
          eyebrow: "Channel",
          title: `From ${prettyStage(scope.source)}`,
          subtitle: `${channel?.applications ?? 0} applications and ${channel?.hires ?? 0} hires through this channel`,
        };
      }
      case "bucket": {
        const item = analytics.fit_distribution.find((b) => b.range === scope.range);
        return {
          eyebrow: "AI fit",
          title: `Fit score ${scope.range}`,
          subtitle: `${item?.count ?? 0} of ${analytics.scored_applications} scored applications sit in this band`,
        };
      }
      case "day": {
        const day = analytics.applications_last_14_days.find((d) => d.date === scope.date);
        return {
          eyebrow: "Application flow",
          title: `Applied on ${longDate(scope.date)}`,
          subtitle: `${day?.count ?? 0} submissions that day, out of ${analytics.total_applications.toLocaleString()} in the pipeline`,
        };
      }
      case "role": {
        const role = analytics.roles.find((r) => r.job_id === scope.jobId);
        return {
          eyebrow: "Opening",
          title: role?.title ?? "Applications for one opening",
          subtitle: role
            ? `${role.department || "—"} · ${prettyStage(role.status)} · ${role.applications} applications when this page was read`
            : "Every application on this opening",
        };
      }
      case "scored":
        return {
          eyebrow: "AI fit",
          title: "Every scored application",
          subtitle: `${analytics.scored_applications} of ${analytics.total_applications.toLocaleString()} screened · best fit first`,
        };
      case "hires":
        return {
          eyebrow: "Hires",
          title: "Everyone hired",
          subtitle: `${analytics.hires_this_quarter} applications at the hired stage`,
        };
      case "time_to_hire":
        return {
          eyebrow: "Time to hire",
          title: "Days from applying to hired",
          subtitle: `${analytics.hires_this_quarter} hires · the group average is ${analytics.avg_time_to_hire_days}d`,
        };
      case "waiting":
        return {
          eyebrow: "Pipeline",
          title: "Still waiting on the pipeline",
          subtitle: `${analytics.waiting_total} applications in a stage that has not closed · longest first`,
        };
      default:
        return {
          eyebrow: "Dashboard",
          title: "Applications",
          subtitle: "Read live from the pipeline.",
        };
    }
  }

  const heading = panelHeading();
  const longestWait = analytics.oldest_waiting[0]?.waiting_days ?? null;

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ---- Key metrics ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Tile
          label="Applications"
          value={analytics.total_applications.toLocaleString()}
          hint={arrivalsHint}
          icon={<Users className="h-5 w-5" aria-hidden />}
          delta={weekDelta === null ? null : { value: weekDelta, label: "% vs prior week" }}
          detail="Every live record"
          onClick={() => drill({ type: "all" })}
        />
        <Tile
          label="Open roles"
          value={analytics.active_jobs}
          hint="Published and accepting"
          icon={<Briefcase className="h-5 w-5" aria-hidden />}
          detail={`${analytics.roles.length} openings`}
          onClick={() => setPanel({ kind: "roles" })}
        />
        <Tile
          label="Avg AI fit"
          value={masked ? "Hidden" : `${analytics.avg_fit_score}%`}
          hint={
            masked
              ? "Masked for your role"
              : `${analytics.scored_applications} of ${analytics.total_applications} scored`
          }
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          {...(masked ? {} : { detail: "The scored list", onClick: () => drill({ type: "scored" }) })}
        />
        <Tile
          label="Hires"
          value={analytics.hires_this_quarter}
          hint="Applications at HIRED stage"
          icon={<UserPlus className="h-5 w-5" aria-hidden />}
          detail="See who"
          onClick={() => drill({ type: "hires" })}
        />
        <Tile
          label="Time to hire"
          value={`${analytics.avg_time_to_hire_days}d`}
          hint="Rolling 6-month average"
          icon={<Clock className="h-5 w-5" aria-hidden />}
          detail="Days per hire"
          onClick={() => drill({ type: "time_to_hire" })}
        />
        <Tile
          label="Still waiting"
          value={analytics.waiting_total.toLocaleString()}
          hint={
            longestWait === null
              ? "Nothing open in the pipeline"
              : `Longest has held ${longestWait}d`
          }
          icon={<Hourglass className="h-5 w-5" aria-hidden />}
          detail="Oldest first"
          onClick={() => drill({ type: "waiting" })}
        />
      </div>

      {/* ---- Application trend + time to hire ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Application flow" meta="Click a day for its list" />
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
                  onClick={() => drill({ type: "day", date: day.date })}
                  aria-label={`${day.count} applications on ${day.date} — open the list`}
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
          <CardFooter>
            <p className="text-[11px] text-brand-ink/45">Averages only months that hired.</p>
            <GhostAction onClick={() => drill({ type: "time_to_hire" })}>
              Days per person
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </GhostAction>
          </CardFooter>
        </Card>
      </div>

      {/* ---- Pipeline funnel (clickable) ---- */}
      <Card>
        <CardHeader
          title="Where applications sit"
          meta={
            stage
              ? `Board filtered to ${prettyStage(stage)}`
              : "Click a stage for its list · Filter narrows the board below"
          }
        />
        <div className="p-5 sm:p-6">
          <div className="flex gap-3 overflow-x-auto pb-2 sm:gap-5">
            {analytics.pipeline.map((step) => {
              const active = stage === step.stage;
              return (
                <div
                  key={step.stage}
                  className={cn(
                    "flex min-w-[104px] flex-1 flex-col rounded-2xl border transition",
                    active
                      ? "border-brand-gold bg-brand-gold/10 shadow-soft"
                      : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => drill({ type: "stage", stage: step.stage })}
                    className="group flex flex-col items-center px-2 pb-1 pt-3 text-center"
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
                    <p className="text-[10px] text-brand-ink/40">
                      {step.share_of_pipeline}% of all live
                    </p>
                    {step.vs_previous_stage ? (
                      <p className="text-[10px] text-brand-ink/40">
                        {step.vs_previous_stage.percent}% of the {step.vs_previous_stage.count} at{" "}
                        {prettyStage(step.vs_previous_stage.stage)}
                      </p>
                    ) : null}
                    <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/30 transition group-hover:text-brand-gold-dark">
                      See who
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </p>
                  </button>
                  <div className="px-2 pb-2 pt-1">
                    <BoardFilterButton
                      active={active}
                      label={prettyStage(step.stage)}
                      onClick={() => setStage(active ? null : step.stage)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ---- Roles + what is still waiting ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Where the roles stand"
            meta="Applications, hires and the longest wait per opening"
          />
          <div className="space-y-1 p-5 sm:p-6">
            {analytics.roles.length === 0 ? (
              <EmptyState
                title="No openings yet"
                description="Publish a role and its applicants will be counted here."
              />
            ) : (
              analytics.roles.slice(0, 6).map((role) => (
                <RoleLine
                  key={role.job_id}
                  role={role}
                  max={maxRole}
                  masked={masked}
                  onSelect={() => drill({ type: "role", jobId: role.job_id })}
                />
              ))
            )}
          </div>
          {analytics.roles.length > 6 && (
            <CardFooter>
              <p className="text-[11px] text-brand-ink/45">
                {analytics.roles.length - 6} more openings not listed here.
              </p>
              <GhostAction onClick={() => setPanel({ kind: "roles" })}>
                All {analytics.roles.length} openings
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </GhostAction>
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Longest waiting"
            meta={`${analytics.waiting_total} still open`}
          />
          <ul className="space-y-1 p-5 sm:p-6">
            {analytics.oldest_waiting.length === 0 ? (
              <EmptyState
                title="Nothing is waiting"
                description="Every live application sits in a stage that has already closed."
              />
            ) : (
              analytics.oldest_waiting.map((row) => (
                <li key={row.application_id}>
                  <Link
                    href={`/candidates?application=${row.application_id}`}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-brand-line hover:bg-brand-cream"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {row.full_name}
                        <ExternalLink
                          className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100"
                          aria-hidden
                        />
                      </span>
                      <span className="block truncate text-[11px] text-brand-ink/50">
                        {row.job_title || "—"} · applied {shortDate(row.applied_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Badge tone={stageTone(row.stage)}>{prettyStage(row.stage)}</Badge>
                      <span
                        className={cn(
                          "mt-1.5 block text-[11px] font-bold",
                          row.waiting_days >= 14 ? "text-rose-700" : "text-brand-ink/55"
                        )}
                      >
                        {row.waiting_days}d waiting
                      </span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          {analytics.waiting_total > 0 && (
            <CardFooter>
              <p className="text-[11px] text-brand-ink/45">Filed-away records are excluded.</p>
              <GhostAction onClick={() => drill({ type: "waiting" })}>
                All waiting
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </GhostAction>
            </CardFooter>
          )}
        </Card>
      </div>

      {/* ---- Channels + fit distribution ---- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Channel effectiveness"
            meta="Click a source for its list · Filter narrows the board"
          />
          <div className="space-y-2 p-5 sm:p-6">
            {analytics.channels.length === 0 ? (
              <EmptyState
                title="No channel data yet"
                description="Applications will be grouped by source as soon as they arrive."
              />
            ) : (
              analytics.channels.map((channel) => {
                const active = source === channel.source;
                return (
                  <div
                    key={channel.source}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 transition",
                      active
                        ? "border-brand-gold bg-brand-gold/10"
                        : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => drill({ type: "source", source: channel.source })}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-bold tracking-wide text-brand-ink/75">
                            {prettyStage(channel.source)}
                            <ArrowUpRight
                              className="h-3 w-3 text-brand-ink/25"
                              aria-hidden
                            />
                          </span>
                          <span className="text-brand-ink/50">
                            {channel.applications} applications · {channel.hires} hired ·{" "}
                            <strong className="text-brand-gold-dark">
                              {channel.conversion_rate}%
                            </strong>
                          </span>
                        </div>
                        <Meter
                          value={channel.applications}
                          max={maxChannel}
                          tone={channel.hires > 0 ? "success" : "gold"}
                        />
                      </button>
                      <BoardFilterButton
                        active={active}
                        label={prettyStage(channel.source)}
                        onClick={() => setSource(active ? null : channel.source)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="AI fit distribution" meta={`${analytics.scored_applications} scored`} />
          <div className="space-y-3 p-5 sm:p-6">
            {masked ? (
              <EmptyState
                title="Scores are hidden"
                description="Your role is not granted “View unmasked scores”, so the fit buckets are withheld."
              />
            ) : (
              <>
                {analytics.fit_distribution.map((item) => {
                  const active = bucket === item.range;
                  return (
                    <div
                      key={item.range}
                      className={cn(
                        "rounded-xl border px-3 py-2 transition",
                        active
                          ? "border-brand-gold bg-brand-gold/10"
                          : "border-transparent hover:border-brand-line hover:bg-brand-cream"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => drill({ type: "bucket", range: item.range })}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="mb-1.5 flex items-baseline justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-brand-ink/70">
                              {item.range}
                              <ArrowUpRight className="h-3 w-3 text-brand-ink/25" aria-hidden />
                            </span>
                            <span className="font-display font-bold">{item.count}</span>
                          </div>
                          <Meter
                            value={item.count}
                            max={Math.max(analytics.scored_applications, 1)}
                            tone={item.range.startsWith("80") ? "success" : "gold"}
                          />
                        </button>
                        <BoardFilterButton
                          active={active}
                          label={`fit ${item.range}`}
                          onClick={() => setBucket(active ? null : item.range)}
                        />
                      </div>
                    </div>
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
              Showing {filtered.length} of{" "}
              {boardHolds.toLocaleString()} loaded applications · click a name for
              the full record
            </p>
            {(rowsNotLoaded > 0 || railHidden > 0) && (
              <div className="mt-2 max-w-3xl space-y-1 text-[11px] leading-relaxed text-brand-ink/60">
                {rowsNotLoaded > 0 && (
                  <p>
                    This board is shipped with the {BOARD_LIMIT} {masked ? "newest" : "best-matching"} live
                    applications, so {rowsNotLoaded.toLocaleString()} of the{" "}
                    {analytics.total_applications.toLocaleString()} in the pipeline are not in it. The figures
                    above count them anyway.
                  </p>
                )}
                {railHidden > 0 && rail && (
                  <p>
                    The {rail.label} counts {rail.total.toLocaleString()}. A rail can only filter the rows this
                    page loaded, so {railHidden} {railHidden === 1 ? "is" : "are"} counted but not listed
                    {rail.href ? (
                      <>
                        {" — "}
                        <Link
                          href={rail.href}
                          className="font-semibold text-brand-gold-dark underline underline-offset-2"
                        >
                          read them all
                        </Link>
                      </>
                    ) : (
                      " — the tile's See who popup reads them from the database."
                    )}
                  </p>
                )}
              </div>
            )}
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
                      masked={masked}
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
                      <Link
                        href={`/candidates?application=${candidate.application_id}`}
                        className="block truncate font-semibold hover:text-brand-gold-dark hover:underline"
                      >
                        {candidate.full_name}
                      </Link>
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
                        ? masked
                          ? "—"
                          : "0"
                        : `${candidate.match_score}%`}
                    </span>
                    {masked ? (
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

      {panel && (
        <Drawer
          open
          onClose={() => setPanel(null)}
          width="max-w-2xl"
          eyebrow={heading.eyebrow}
          title={heading.title}
          subtitle={heading.subtitle}
          footer={
            <>
              <p className="text-[11px] text-brand-ink/45">
                {panel.kind === "applications"
                  ? "Read live from the pipeline — counted from rows, not from the figures on this page."
                  : "Counted with this page — click an opening for its applicants."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {panelFilter && openPanel && (
                  <Button size="sm" variant="outline" onClick={() => applyScopeToBoard(openPanel)}>
                    <Filter className="h-3.5 w-3.5" aria-hidden />
                    Filter the board to this
                  </Button>
                )}
                <Link
                  href={panelBoardHref(openPanel)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
                >
                  Candidates board
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </>
          }
        >
          {panel.kind === "applications" ? (
            <DrillPanel key={JSON.stringify(panel.scope)} scope={panel.scope} masked={masked} />
          ) : (
            <div className="space-y-1">
              {analytics.roles.length === 0 ? (
                <EmptyState
                  title="No openings to list"
                  description="Publish a role and its applicants will show up here."
                />
              ) : (
                analytics.roles.map((role) => (
                  <RoleLine
                    key={role.job_id}
                    role={role}
                    max={maxRole}
                    masked={masked}
                    onSelect={() => drill({ type: "role", jobId: role.job_id })}
                  />
                ))
              )}
            </div>
          )}
        </Drawer>
      )}
    </div>
  );
}

function CandidateRow({ candidate, masked }: { candidate: DashboardCandidate; masked: boolean }) {
  return (
    <tr className="transition hover:bg-brand-cream">
      <td className="py-3.5 pl-6 pr-4">
        <Link
          href={`/candidates?application=${candidate.application_id}`}
          className="font-semibold hover:text-brand-gold-dark hover:underline"
        >
          {candidate.full_name}
        </Link>
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
