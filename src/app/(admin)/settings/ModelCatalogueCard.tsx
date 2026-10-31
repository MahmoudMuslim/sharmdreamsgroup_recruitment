"use client";

import { memo } from "react";
import {
  DollarSign,
  Sparkles
} from "lucide-react";
import {
  type ProviderModel,
  getCostTier
} from "@/modules/settings/domain/providers";
import { costTierBadge, priceLabel } from "./ModelRoutingBits";

/**
 * One catalogue tile — enough to choose from at a glance, and it opens the
 * detail modal, which is where the routing decision is actually made.
 *
 * Memoised because one state owner renders both tabs: without it, typing a
 * temperature re-created every visible tile.
 */
export const CatalogueCard = memo(function CatalogueCard({
  model,
  onOpen,
}: {
  model: ProviderModel;
  onOpen: (model: ProviderModel) => void;
}) {
  return (
    <button
      onClick={() => onOpen(model)}
      className="flex items-start gap-3 rounded-xl border border-brand-line bg-white p-3.5 text-left transition hover:border-brand-gold/50 hover:shadow-soft"
    >
      <div className="mt-0.5 shrink-0">
        {model.isFree ? (
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <DollarSign className="h-4 w-4 text-amber-600" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-brand-ink">{model.name}</p>
          {model.isFree && (
            <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
              Free
            </span>
          )}
          {!model.routable && (
            <span className="shrink-0 rounded bg-brand-sand px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-ink/55">
              Not routable
            </span>
          )}
          {model.enabled === false && (
            <span className="shrink-0 rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-700">
              Off for this account
            </span>
          )}
        </div>
        <p className="truncate text-xs font-mono text-brand-ink/50">{model.modelId}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {costTierBadge(getCostTier(model.promptPrice, model.isFree))}
          {model.promptPrice !== null && (
            <span className="text-[10px] font-semibold text-brand-ink/55">
              {priceLabel(model.promptPrice)} in
            </span>
          )}
        </div>
        {model.detail && (
          <p className="mt-1.5 truncate text-[11px] text-brand-ink/50" title={model.detail}>
            {model.detail}
          </p>
        )}
      </div>
    </button>
  );
});
