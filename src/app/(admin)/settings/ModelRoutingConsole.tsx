"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  DollarSign,
  Loader2,
  Maximize,
  RefreshCw,
  Sparkles,
  Tag,
  TriangleAlert,
  XCircle,
  Zap,
} from "lucide-react";
import {
  getModelCatalogue,
  listModelRouting,
  saveModelRouting,
  type AiModelRow,
} from "@/modules/settings/application/credential-actions";
import {
  testAllProviders,
  testCapability,
  type ChainTestResult,
  type ProviderTestResult,
} from "@/modules/settings/application/credential-actions-ai";
import {
  AI_CAPABILITIES,
  groupModelsByProviderAndCost,
  filterModelsBySearch,
  type ProviderModel,
  type ModelOption,
  getModelById,
  costTierLabel,
  getCostTier,
} from "@/modules/settings/domain/providers";
import { Button } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, Select, TextInput } from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";

interface ModelRow extends AiModelRow {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
  /** Result of the most recent live probe for this capability. */
  probe?: ChainTestResult;
  probing?: boolean;
}

function ProbeBadge({ result }: { result: ChainTestResult }) {
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

function priceLabel(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "free";
  return `$${value < 1 ? value.toFixed(2) : value.toFixed(0)}/M`;
}

function contextLengthLabel(length: number | null): string {
  if (length === null || length === 0) return "—";
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
  if (length >= 1000) return `${(length / 1000).toFixed(0)}K`;
  return length.toString();
}

function costTierBadge(tier: string) {
  const colors: Record<string, string> = {
    free: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    low: "bg-teal-500/10 text-teal-700 border-teal-200",
    medium: "bg-amber-500/10 text-amber-700 border-amber-200",
    high: "bg-rose-500/10 text-rose-700 border-rose-200",
    premium: "bg-purple-500/10 text-purple-700 border-purple-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        colors[tier] || colors.medium
      )}
    >
      <Tag className="h-2.5 w-2.5" aria-hidden />
      {costTierLabel(tier as any)}
    </span>
  );
}

/** The subset of fields that constitute a row's saved state. */
function snapshot(row: ModelRow) {
  return JSON.stringify({
    p: row.primaryModel,
    f: row.fallbackModel,
    t: row.temperature,
    m: row.maxTokens,
    e: row.isEnabled,
  });
}

function DetailStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
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

/**
 * Per-capability model routing.
 *
 * Model ids are not secret, so they round-trip normally. Changes take effect on
 * the next AI call — the runtime resolver reads this table before falling back
 * to the compiled-in env defaults.
 */
export function ModelRoutingConsole({ editable }: { editable: boolean }) {
  const [rows, setRows] = useState<ModelRow[]>([]);
  /** Last persisted state per capability, used to detect real edits. */
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [catalogue, setCatalogue] = useState<{
    models: { id: string; name: string; free: boolean; promptPrice: number | null }[];
    degraded: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderTestResult[]>([]);
  const [providerTesting, setProviderTesting] = useState(false);
  const [catalogueLoading, setCatalogueLoading] = useState(false);

  // Global model search across the entire catalog
  const [globalSearch, setGlobalSearch] = useState("");

  // Capability-specific selects keep their own search (works with a closed select)
  const [primarySearch, setPrimarySearch] = useState<Record<string, string>>({});
  const [fallbackSearch, setFallbackSearch] = useState<Record<string, string>>({});

  // Selected provider + cost tier filters for the catalog
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedCostTier, setSelectedCostTier] = useState<string>("all");

  // Expanded model detail
  const [selectedModel, setSelectedModel] = useState<ProviderModel | null>(null);

  // Group models by provider and cost tier
  const groupedModels = useMemo(() => {
    if (!catalogue?.models) return [];
    // Convert catalogue models to ProviderModel format
    const providerModels: ProviderModel[] = catalogue.models.map((m) => ({
      id: m.id,
      provider: m.id.split("/")[0] || "unknown",
      modelId: m.id,
      name: m.name,
      promptPrice: m.promptPrice,
      completionPrice: null,
      contextLength: null,
      isFree: m.free,
      contextWindowCategory: null,
      capabilities: [],
      isActive: true,
      fetchedAt: new Date().toISOString(),
    }));
    return groupModelsByProviderAndCost(providerModels);
  }, [catalogue]);

  // Global filtered catalog for the modal
  const filteredCatalog = useMemo(() => {
    let models = groupedModels.flatMap((g) => g.models);
    if (selectedProvider !== "all") {
      models = models.filter((m) => m.provider === selectedProvider);
    }
    if (selectedCostTier !== "all") {
      models = models.filter((m) => getCostTier(m.promptPrice, m.isFree) === selectedCostTier);
    }
    if (globalSearch.trim()) {
      const q = globalSearch.toLowerCase();
      models = models.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.modelId.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
      );
    }
    return models;
  }, [groupedModels, selectedProvider, selectedCostTier, globalSearch]);

  const providersList = useMemo(() => {
    return Array.from(new Set(groupedModels.map((g) => g.provider))).sort();
  }, [groupedModels]);

  // Load data on mount
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [routing, models] = await Promise.all([listModelRouting(), getModelCatalogue()]);
        if (!active) return;
        const hydrated = routing.map((r) => ({ ...r, status: "idle" as const }));
        setRows(hydrated);
        setSaved(Object.fromEntries(hydrated.map((r) => [r.capability, snapshot(r)])));
        setCatalogue({ models: models.models, degraded: models.degraded });
        setError(null);
      } catch {
        if (active) setError("Could not load model routing.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function loadCatalogue() {
    setCatalogueLoading(true);
    try {
      const result = await getModelCatalogue();
      setCatalogue({ models: result.models, degraded: result.degraded });
    } catch {
      // Error is handled by the existing error state
    } finally {
      setCatalogueLoading(false);
    }
  }

  async function save(row: ModelRow) {
    setRows((rs) =>
      rs.map((r) => (r.capability === row.capability ? { ...r, status: "saving", message: undefined } : r))
    );
    try {
      const result = await saveModelRouting({
        capability: row.capability,
        primaryModel: row.primaryModel,
        fallbackModel: row.fallbackModel,
        temperature: row.temperature,
        maxTokens: row.maxTokens,
        isEnabled: row.isEnabled,
      });
      if (result.ok) {
        setSaved((s) => ({ ...s, [row.capability]: snapshot(row) }));
        setRows((rs) =>
          rs.map((r) => (r.capability === row.capability ? { ...r, status: "saved" } : r))
        );
        setTimeout(() =>
          setRows((rs) =>
            rs.map((r) => (r.capability === row.capability ? { ...r, status: "idle" } : r))
          )
        ),
          1800;
      } else {
        setRows((rs) =>
          rs.map((r) => (r.capability === row.capability ? { ...r, status: "error", message: result.error } : r))
        );
      }
    } catch {
      setRows((rs) =>
        rs.map((r) => (r.capability === row.capability ? { ...r, status: "error", message: "Save failed." } : r))
      );
    }
  }

  function patch(capability: string, next: Partial<ModelRow>) {
    setRows((rs) =>
      rs.map((r) =>
        r.capability === capability
          ? { ...r, ...next, status: "idle" as const, message: undefined }
          : r
      )
    );
  }

  /** Runs a real completion through one capability's chain. */
  async function probe(capability: string) {
    patch(capability, { probing: true });
    try {
      const result = await testCapability(capability);
      setRows((rs) =>
        rs.map((r) => (r.capability === capability ? { ...r, probe: result, probing: false } : r))
      );
    } catch {
      setRows((rs) =>
        rs.map((r) =>
          r.capability === capability
            ? {
                ...r,
                probing: false,
                probe: {
                  capability,
                  label: r.capability,
                  ok: false,
                  status: "check failed",
                  latencyMs: 0,
                  detail: "The diagnostic could not be run.",
                },
              }
            : r
        )
      );
    }
  }

  /** Probes every provider credential at once. */
  async function probeProviders() {
    setProviderTesting(true);
    try {
      setProviders(await testAllProviders());
    } finally {
      setProviderTesting(false);
    }
  }

  const availableProviders = useMemo(() => {
    return providers.filter((p) => p.ok).map((p) => p.provider);
  }, [providers]);

  const totalProviders = providers.length;
  const workingProviders = availableProviders.length;

  // Helper for assigning a model to a capability
  const SelectWithAssignment = () => {
    const capability = rows[0]?.capability;

    if (!capability) {
      return (
        <div className="flex-1 rounded-xl border border-brand-line bg-brand-sand p-3.5 text-sm text-brand-ink/45">
          No capabilities available yet.
        </div>
      );
    }

    const assignedTo = rows.find((r) => r.capability === capability);

    return (
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-xs font-semibold text-brand-ink/60">
          Set as primary model
        </label>
        <div className="flex items-center gap-2">
          <select
            value={rows[0]?.primaryModel ?? ""}
            onChange={(e) =>
              e.target.value &&
              patch(capability, { primaryModel: e.target.value })
            }
            className="flex-1 rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="">—</option>
            {groupedModels.flatMap((g) => g.models).map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.name}
              </option>
            ))}
          </select>
          <span
            className={cn(
              "shrink-0 rounded px-2 py-1 text-xs font-bold",
              rows[0]?.primaryModel
                ? "bg-emerald-500/10 text-emerald-700"
                : "bg-brand-sand text-brand-ink/45"
            )}
          >
            {rows[0]?.primaryModel ? "Set" : "None"}
          </span>
        </div>
        {rows[0]?.primaryModel && (
          <p className="text-[10px] text-emerald-700">
            ✓ Assigned to {assignedTo?.capability}
          </p>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-brand-ink/50">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading model routing…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Header ---------------- */}
      <div className="rounded-2xl border border-brand-line bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold">
              <Cpu className="h-5 w-5 text-brand-gold-dark" aria-hidden />
              AI model routing
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
              Configure which model handles each task and how providers fail over. Choose from our
              live catalogue, filter by provider and cost, and search by name.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {catalogue?.degraded && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                <TriangleAlert className="h-3 w-3" aria-hidden />
                Offline list
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => void loadCatalogue()} disabled={catalogueLoading}>
              {catalogueLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Refresh catalogue
            </Button>
            <Button size="sm" variant="outline" onClick={() => void probeProviders()} disabled={providerTesting}>
              {providerTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Activity className="h-3.5 w-3.5" aria-hidden />
              )}
              Test providers
            </Button>
          </div>
        </div>
      </div>

      {/* ---------------- Provider health ---------------- */}
      <section className="rounded-2xl border border-brand-line bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-bold">
              <Activity className="h-4 w-4 text-brand-gold-dark" aria-hidden />
              Active providers
            </h3>
            <p className="mt-1 text-sm text-brand-ink/55">
              Live credential health. Models are only selectable from authenticated providers.
            </p>
          </div>
          {providers.length > 0 && (
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink/60">
              {workingProviders} of {totalProviders} working
            </span>
          )}
        </div>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-brand-line border-dashed bg-brand-cream/50 px-4 py-8 text-center">
            <Cpu className="h-8 w-8 text-brand-gold/60" aria-hidden />
            <p className="mt-3 text-sm font-medium text-brand-ink">No providers configured</p>
            <p className="mt-1 text-sm text-brand-ink/55">
              Configure your API keys in the <strong>API keys</strong> tab to enable model selection.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <li key={p.provider} className="flex items-start gap-3 rounded-xl border border-brand-line bg-brand-cream/40 p-3.5 transition hover:border-brand-gold/40">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                  {p.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-600" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-brand-ink">{p.displayName}</p>
                  <p className="truncate text-xs text-brand-ink/55">{p.detail}</p>
                  {p.latencyMs > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-brand-ink/40">
                      <Zap className="h-2.5 w-2.5" aria-hidden />
                      {p.latencyMs}ms
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Model selector ---------------- */}
      <section className="rounded-2xl border border-brand-line bg-white p-5">
        <header className="mb-4">
          <h3 className="flex items-center gap-2 font-display text-base font-bold">
            <Sparkles className="h-4 w-4 text-brand-gold-dark" aria-hidden />
            Model catalogue
          </h3>
          <p className="mt-1 text-sm text-brand-ink/55">
            {filteredCatalog.length.toLocaleString()} models available · browse, filter, and select for each capability below.
          </p>
        </header>

        {/* Search + filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40" aria-hidden />
            <input
              type="text"
              placeholder="Search models by name, ID or provider…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="w-full rounded-xl border border-brand-line bg-brand-cream pl-10 pr-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
            />
          </div>

          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="all">All providers</option>
            {providersList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={selectedCostTier}
            onChange={(e) => setSelectedCostTier(e.target.value)}
            className="rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="all">All price tiers</option>
            {["free", "low", "medium", "high", "premium"].map((tier) => (
              <option key={tier} value={tier}>
                {costTierLabel(tier as any)}
              </option>
            ))}
          </select>
        </div>

        {/* Catalog grid */}
        {filteredCatalog.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-brand-line border-dashed bg-brand-cream/30 px-4 py-12 text-center">
            <Sparkles className="h-8 w-8 text-brand-ink/30" aria-hidden />
            <p className="mt-3 text-sm font-medium text-brand-ink">No models match your filters</p>
            <p className="mt-1 text-sm text-brand-ink/55">Try clearing the search or adjusting the filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCatalog.map((model) => {
              const def = getModelById(model.modelId, catalogue?.models as ModelOption[] | undefined);
              return (
                <button
                  key={model.modelId}
                  onClick={() => setSelectedModel(model)}
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
                    </div>
                    <p className="truncate text-xs font-mono text-brand-ink/50">{model.modelId}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {costTierBadge(getCostTier(model.promptPrice, model.isFree))}
                      {model.promptPrice && (
                        <span className="text-[10px] font-semibold text-brand-ink/55">
                          {priceLabel(model.promptPrice)} in
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- Model detail modal ---------------- */}
      {selectedModel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setSelectedModel(null)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-brand-line bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-brand-line bg-brand-cream/40 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-display text-lg font-bold text-brand-ink">
                    {selectedModel.name}
                  </h3>
                  {selectedModel.isFree && (
                    <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                      Free
                    </span>
                  )}
                  {costTierBadge(getCostTier(selectedModel.promptPrice, selectedModel.isFree))}
                </div>
                <p className="truncate font-mono text-sm text-brand-ink/50">{selectedModel.modelId}</p>
              </div>
              <button
                onClick={() => setSelectedModel(null)}
                className="rounded-lg p-1.5 text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink"
                aria-label="Close"
              >
                <XCircle className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <DetailStat
                icon={DollarSign}
                label="Input cost"
                value={selectedModel.promptPrice ? priceLabel(selectedModel.promptPrice) : "—"}
              />
              <DetailStat
                icon={DollarSign}
                label="Output cost"
                value={selectedModel.completionPrice ? priceLabel(selectedModel.completionPrice) : "—"}
              />
              <DetailStat
                icon={Maximize}
                label="Context length"
                value={
                  selectedModel.contextLength
                    ? `${contextLengthLabel(selectedModel.contextLength)} tokens`
                    : "—"
                }
              />
              <DetailStat
                icon={Cpu}
                label="Provider"
                value={selectedModel.provider}
              />
            </div>

            <div className="border-t border-brand-line bg-brand-cream/30 p-5">
              <h4 className="mb-3 text-sm font-bold text-brand-ink">Quick assign</h4>
              <SelectWithAssignment />
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Per-capability routing ---------------- */}
      <div className="space-y-4">
        {rows.map((row) => {
          const definition = AI_CAPABILITIES.find((c) => c.id === row.capability);
          const dirty = saved[row.capability] !== snapshot(row);
          const model = getModelById(row.primaryModel, catalogue?.models as ModelOption[] | undefined);

          return (
            <div
              key={row.capability}
              className={cn(
                "rounded-2xl border p-5 transition",
                dirty
                  ? "border-brand-gold/50 bg-brand-gold/5"
                  : "border-brand-line bg-white"
              )}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="flex items-center gap-2 font-display text-base font-bold">
                      <Cpu className="h-4 w-4 text-brand-gold-dark" aria-hidden />
                      {definition?.label ?? row.capability}
                    </h3>
                    {!row.isEnabled && (
                      <span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-brand-ink/55">{definition?.description}</p>

                  {model && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-ink/50">
                      <span className="font-semibold text-brand-ink">{model.name}</span>
                      <span className="font-mono">({model.id})</span>
                      {model.free ? (
                        <span className="flex items-center gap-1 text-emerald-700">
                          <Sparkles className="h-3 w-3" aria-hidden />
                          free
                        </span>
                      ) : (
                        <span>{priceLabel(model.promptPrice)} / M</span>
                      )}
                      {row.probe && <ProbeBadge result={row.probe} />}
                    </div>
                  )}
                </div>

                <label className="flex shrink-0 items-center gap-2 rounded-lg border border-brand-line bg-white px-3 py-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={row.isEnabled}
                    disabled={!editable}
                    onChange={(e) => patch(row.capability, { isEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-brand-line"
                  />
                  Enabled
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Field label="Primary model" htmlFor={`model-${row.capability}`} hint="Model used for every request.">
                  <div className="relative">
                    <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40" aria-hidden />
                    <Select
                      id={`model-${row.capability}`}
                      value={row.primaryModel}
                      disabled={!editable}
                      onChange={(e) => patch(row.capability, { primaryModel: e.target.value })}
                      className="w-full pl-10"
                    >
                      <option value="">Select a model…</option>
                      {groupedModels
                        .filter((g) => availableProviders.includes(g.provider))
                        .map((group) => (
                          <optgroup
                            key={group.provider}
                            label={`${group.providerName} · ${costTierLabel(group.costTier)} (${group.models.length})`}
                          >
                            {filterModelsBySearch(group.models, primarySearch[row.capability] || "")
                              .filter((m) => availableProviders.includes(m.provider))
                              .map((model) => (
                                <option key={model.modelId} value={model.modelId}>
                                  {model.name}
                                  {" · "}
                                  {model.modelId}
                                  {model.isFree && " — free"}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                    </Select>
                  </div>
                </Field>

                <Field
                  label="Fallback model"
                  htmlFor={`fallback-${row.capability}`}
                  hint="Used automatically when the primary fails."
                >
                  <div className="relative">
                    <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40" aria-hidden />
                    <Select
                      id={`fallback-${row.capability}`}
                      value={row.fallbackModel ?? ""}
                      disabled={!editable}
                      onChange={(e) => patch(row.capability, { fallbackModel: e.target.value || null })}
                      className="w-full pl-10"
                    >
                      <option value="">No fallback</option>
                      {groupedModels
                        .filter((g) => availableProviders.includes(g.provider))
                        .map((group) => (
                          <optgroup
                            key={group.provider}
                            label={`${group.providerName} · ${costTierLabel(group.costTier)} (${group.models.length})`}
                          >
                            {filterModelsBySearch(group.models, fallbackSearch[row.capability] || "")
                              .filter((m) => availableProviders.includes(m.provider))
                              .map((model) => (
                                <option key={model.modelId} value={model.modelId}>
                                  {model.name}
                                  {" · "}
                                  {model.modelId}
                                  {model.isFree && " — free"}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                    </Select>
                  </div>
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Temperature"
                  htmlFor={`temp-${row.capability}`}
                  hint="0 is deterministic; 2 is very creative."
                >
                  <TextInput
                    id={`temp-${row.capability}`}
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={row.temperature}
                    disabled={!editable}
                    onChange={(e) => patch(row.capability, { temperature: Number(e.target.value) })}
                  />
                </Field>

                <Field label="Max output tokens" htmlFor={`tokens-${row.capability}`}>
                  <TextInput
                    id={`tokens-${row.capability}`}
                    type="number"
                    min={64}
                    max={32000}
                    step={64}
                    value={row.maxTokens}
                    disabled={!editable}
                    onChange={(e) => patch(row.capability, { maxTokens: Number(e.target.value) })}
                  />
                </Field>
              </div>

              {row.probe && !row.probe.ok && (
                <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
                  {row.probe.detail}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <FormMessage
                  error={row.status === "error" ? row.message ?? "Save failed." : null}
                  success={row.status === "saved" ? "Saved — applies to the next request." : null}
                />
                {editable && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void probe(row.capability)}
                      disabled={row.probing}
                      title="Send a tiny real request through this capability's model chain"
                    >
                      {row.probing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Activity className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Test
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void save(row)}
                      disabled={row.status === "saving" || !dirty}
                      className={cn(!dirty && "opacity-60")}
                    >
                      {row.status === "saving" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
