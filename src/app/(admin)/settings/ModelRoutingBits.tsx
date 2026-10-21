"use client";

import {
  Activity,
  CheckCircle2,
  Route,
  Sparkles,
  Tag,
  XCircle,
  type LucideIcon
} from "lucide-react";
import {
  type AiModelRow
} from "@/modules/settings/application/credential-actions";
import {
  type ChainTestResult
} from "@/modules/settings/application/credential-actions-ai";
import {
  type CostTier,
  costTierLabel
} from "@/modules/settings/domain/providers";
import {
  type ModelConsoleTabId
} from "@/modules/settings/domain/settingsNav";
import { cn } from "@/lib/utils";

export interface ModelRow extends AiModelRow {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
  /** Result of the most recent live probe for this capability. */
  probe?: ChainTestResult;
  probing?: boolean;
}

/** Typed by the shared tab ids, so a tab added to the table has to be given an icon here. */
export const TAB_ICONS: Record<ModelConsoleTabId, LucideIcon> = {
  routing: Route,
  catalogue: Sparkles,
  providers: Activity,
};

export function ProbeBadge({ result }: { result: ChainTestResult }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
        result.ok ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-700"
      )}
      title={result.detail}
    >
      {result.ok ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden />
      ) : (
        <XCircle className="h-3 w-3" aria-hidden />
      )}
      {result.ok ? `${result.servedBy} · ${result.latencyMs}ms` : result.status}
    </span>
  );
}

export function priceLabel(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "free";
  return `$${value < 1 ? value.toFixed(2) : value.toFixed(0)}/M`;
}

export function contextLengthLabel(length: number | null): string {
  if (length === null || length === 0) return "—";
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
  if (length >= 1000) return `${(length / 1000).toFixed(0)}K`;
  return length.toString();
}

export const COST_TIERS: CostTier[] = ["free", "low", "medium", "high", "premium", "unpriced"];

export function costTierBadge(tier: CostTier) {
  const colors: Record<CostTier, string> = {
    free: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    low: "bg-teal-500/10 text-teal-700 border-teal-200",
    medium: "bg-amber-500/10 text-amber-700 border-amber-200",
    high: "bg-rose-500/10 text-rose-700 border-rose-200",
    premium: "bg-purple-500/10 text-purple-700 border-purple-200",
    unpriced: "bg-brand-sand text-brand-ink/55 border-brand-line",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        colors[tier]
      )}
    >
      <Tag className="h-2.5 w-2.5" aria-hidden />
      {costTierLabel(tier)}
    </span>
  );
}

/** The subset of fields that constitute a row's saved state. */
export function snapshot(row: ModelRow) {
  return JSON.stringify({
    p: row.primaryModel,
    f: row.fallbackModel,
    t: row.temperature,
    m: row.maxTokens,
    e: row.isEnabled,
  });
}

export function DetailStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-brand-cream/50 p-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </div>
      <p className="truncate text-base font-display font-bold text-brand-ink">{value}</p>
    </div>
  );
}
