"use client";

import { useState } from "react";
import {
  CheckCircle2
} from "lucide-react";
import {
  AI_CAPABILITIES,
  type ProviderModel
} from "@/modules/settings/domain/providers";
import { Button } from "@/modules/analytics/presentation/ui";
import { Field, Select } from "@/modules/analytics/presentation/Form";
import { type ModelRow } from "./ModelRoutingBits";

/**
 * Routes the catalogue model open in the detail modal to a capability.
 * Assignments save immediately — this is the quick path, not a draft.
 */
export function QuickAssign({
  model,
  rows,
  editable,
  onAssign,
}: {
  model: ProviderModel;
  rows: ModelRow[];
  editable: boolean;
  onAssign: (capability: string, field: "primary" | "fallback") => void;
}) {
  const [capability, setCapability] = useState(rows[0]?.capability ?? "");

  if (rows.length === 0) {
    return (
      <p className="text-sm text-brand-ink/55">
        No routable capabilities yet — they appear once the routing table loads.
      </p>
    );
  }

  const row = rows.find((r) => r.capability === capability);
  const isPrimary = row?.primaryModel === model.modelId;
  const isFallback = row?.fallbackModel === model.modelId;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Capability" htmlFor="quick-assign-capability" className="sm:max-w-xs sm:flex-1">
        <Select
          id="quick-assign-capability"
          value={capability}
          disabled={!editable}
          onChange={(e) => setCapability(e.target.value)}
        >
          {AI_CAPABILITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!editable || isPrimary}
          onClick={() => onAssign(capability, "primary")}
        >
          {isPrimary && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden />}
          {isPrimary ? "Is primary" : "Set as primary"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!editable || isFallback}
          onClick={() => onAssign(capability, "fallback")}
        >
          {isFallback && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden />}
          {isFallback ? "Is fallback" : "Set as fallback"}
        </Button>
      </div>
      <p className="text-[11px] text-brand-ink/45 sm:pb-2.5">Saves immediately.</p>
    </div>
  );
}
