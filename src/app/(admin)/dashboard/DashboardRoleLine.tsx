"use client";

import {
  Hourglass,
  Sparkles
} from "lucide-react";
import {
  Meter
} from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type {
  DashboardRoleRow
} from "@/types";
import { prettyStage, shortDate } from "./DashboardBits";

export function RoleLine({
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
