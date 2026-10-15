"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  DollarSign,
  Loader2,
  Maximize,
  RefreshCw,
  Route,
  Sparkles,
  Tag,
  TriangleAlert,
  XCircle,
  Zap,
  type LucideIcon,
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
  type CostTier,
  type ModelCatalogue,
  type ProviderModel,
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

const COST_TIERS: CostTier[] = ["free", "low", "medium", "high", "premium", "unpriced"];

function costTierBadge(tier: CostTier) {
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
function snapshot(row: ModelRow) {
  return JSON.stringify({
    p: row.primaryModel,
    f: row.fallbackModel,
    t: row.temperature,
    m: row.maxTokens,
    e: row.isEnabled,
  });
}

function DetailStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
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
 * One catalogue tile — enough to choose from at a glance, and it opens the
 * detail modal, which is where the routing decision is actually made.
 *
 * Memoised because one state owner renders both tabs: without it, typing a
 * temperature re-created every visible tile.
 */
const CatalogueCard = memo(function CatalogueCard({
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

/**
 * Routes the catalogue model open in the detail modal to a capability.
 * Assignments save immediately — this is the quick path, not a draft.
 */
function QuickAssign({
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

/**
 * Per-capability model routing.
 *
 * Model ids are not secret, so they round-trip normally. Changes take effect on
 * the next AI call — the runtime resolver reads this table before falling back
 * to the compiled-in env defaults.
 *
 * Three tabs, because the three things this console does (decide which model
 * serves a task, browse what is available, check that a provider answers) have
 * nothing in common on screen and used to be one endless scroll.
 */
export function ModelRoutingConsole({ editable }: { editable: boolean }) {
  const [rows, setRows] = useState<ModelRow[]>([]);
  /** Last persisted state per capability, used to detect real edits. */
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [catalogue, setCatalogue] = useState<ModelCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderTestResult[]>([]);
  const [providerTesting, setProviderTesting] = useState(false);
  const [catalogueLoading, setCatalogueLoading] = useState(false);

  const [tab, setTab] = useState("routing");

  // Global model search across the entire catalog
  const [globalSearch, setGlobalSearch] = useState("");

  /**
   * Price tier stays a dropdown because it filters; the provider is a tab strip
   * because browsing one vendor's models at a time is what the list is for.
   */
  const [selectedCostTier, setSelectedCostTier] = useState<string>("all");
  const [catalogueProvider, setCatalogueProvider] = useState("all");
  /** Tiles the catalogue panel is allowed to put in the DOM. See `renderedSections`. */
  const [catalogueBudget, setCatalogueBudget] = useState(60);

  // Expanded model detail
  const [selectedModel, setSelectedModel] = useState<ProviderModel | null>(null);

  /**
   * Everything the provider itself reported about the open model card — its
   * caveat in particular. Said at the point of assignment rather than only as a
   * chip tooltip, because "this tier is client-only" is the difference between
   * a routing row that works and one that fails on every screening.
   */
  const selectedSource = selectedModel
    ? catalogue?.sources.find((s) => s.id === selectedModel.provider)
    : undefined;

  // Group models by provider and cost tier
  const groupedModels = useMemo(() => {
    if (!catalogue) return [];
    // Convert catalogue models to ProviderModel format
    const providerModels: ProviderModel[] = catalogue.models.map((m) => ({
      id: m.id,
      provider: m.provider,
      modelId: m.id,
      name: m.name,
      promptPrice: m.promptPrice,
      completionPrice: m.completionPrice,
      contextLength: m.contextLength,
      isFree: m.free,
      contextWindowCategory: null,
      capabilities: [],
      isActive: true,
      fetchedAt: catalogue.fetchedAt,
      routable: m.routable,
      enabled: m.enabled,
      detail: m.detail,
    }));
    return groupModelsByProviderAndCost(providerModels);
  }, [catalogue]);

  /**
   * What the routing pickers may offer.
   *
   * `routable` is the gateway's own claim that a provider has a caller in its
   * code, and `enabled: false` is the provider's claim that this account cannot
   * use the model — Qoder lists aliases it has switched off. Neither belongs in
   * a picker: choosing a row that cannot be served is a promise the console
   * would break on the next screening.
   */
  const routableGroups = useMemo(
    () =>
      groupedModels
        .map((group) => ({
          ...group,
          models: group.models.filter((m) => m.routable && m.enabled !== false),
        }))
        .filter((group) => group.models.length > 0),
    [groupedModels]
  );

  /**
   * What the search box and the price tier leave standing.
   *
   * Every provider keeps its tab, counted against this list, so a live search
   * never rearranges or drops the tab under the cursor — a provider that falls
   * to zero shows as zero and its panel says so.
   */
  const searchedCatalog = useMemo(() => {
    let models = groupedModels.flatMap((g) => g.models);
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
  }, [groupedModels, selectedCostTier, globalSearch]);

  const providersList = useMemo(() => {
    const byId = new Map<string, string>();
    for (const group of groupedModels) byId.set(group.provider, group.providerName);
    for (const source of catalogue?.sources ?? []) if (!byId.has(source.id)) byId.set(source.id, source.displayName);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [groupedModels, catalogue]);

  const providerNames = useMemo(() => new Map(providersList), [providersList]);

  const catalogueTabs = useMemo(
    () => [
      { key: "all", label: "All providers", models: searchedCatalog },
      ...providersList.map(([id, name]) => ({
        key: id,
        label: name,
        models: searchedCatalog.filter((m) => m.provider === id),
      })),
    ],
    [providersList, searchedCatalog]
  );

  /** The tab the strip is on. A provider can leave the catalogue on a refresh. */
  const activeCatalogue =
    catalogueTabs.find((option) => option.key === catalogueProvider) ?? catalogueTabs[0];

  /** The models on the open catalogue tab, grouped by provider and then price. */
  const catalogueSections = useMemo(() => {
    const byProvider = new Map<string, ProviderModel[]>();
    for (const model of activeCatalogue.models) {
      const list = byProvider.get(model.provider);
      if (list) list.push(model);
      else byProvider.set(model.provider, [model]);
    }
    return [...byProvider.entries()]
      .sort((a, b) =>
        (providerNames.get(a[0]) ?? a[0]).localeCompare(providerNames.get(b[0]) ?? b[0])
      )
      .map(([provider, models]) => ({
        provider,
        providerName: providerNames.get(provider) ?? provider,
        models,
        tiers: COST_TIERS.map((tier) => ({
          tier,
          models: models.filter((m) => getCostTier(m.promptPrice, m.isFree) === tier),
        })).filter((group) => group.models.length > 0),
      }));
  }, [activeCatalogue, providerNames]);

  /**
   * The part of the catalogue that goes into the DOM.
   *
   * The full list is 700-odd tiles, and rendering all of them at once holds the
   * main thread for tens of seconds — long enough that the tab looks crashed.
   * So a page is drawn at a time and `Show more` adds another, which keeps the
   * counts above honest: they are the matches, not the tiles on screen.
   */
  const renderedSections = useMemo(() => {
    let left = catalogueBudget;
    return catalogueSections
      .map((section) => ({
        ...section,
        tiers: section.tiers
          .map((group) => {
            const take = group.models.slice(0, Math.max(0, left));
            left -= take.length;
            return { ...group, models: take, total: group.models.length };
          })
          .filter((group) => group.models.length > 0),
      }))
      .filter((section) => section.tiers.length > 0);
  }, [catalogueSections, catalogueBudget]);

  const drawnTiles = renderedSections.reduce(
    (n, section) => n + section.tiers.reduce((m, group) => m + group.models.length, 0),
    0
  );
  const hiddenTiles = activeCatalogue.models.length - drawnTiles;

  const catalogueIds = useMemo(
    () => new Set(groupedModels.flatMap((g) => g.models.map((m) => m.modelId))),
    [groupedModels]
  );

  /**
   * One option list, shared by the primary and fallback picker of every card.
   *
   * Seven tasks × two pickers × ~700 routable models is 10,000 option nodes, and
   * they were re-created on every keystroke in any card — the page stopped
   * responding while rendering them. Holding the elements in a memo means React
   * sees the same references and skips the pickers altogether.
   */
  const routableOptions = useMemo(
    () =>
      routableGroups.map((group) => (
        <optgroup
          key={`${group.provider}-${group.costTier}`}
          label={`${group.providerName} · ${costTierLabel(group.costTier)} (${group.models.length})`}
        >
          {group.models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {model.name}
              {" · "}
              {model.modelId}
              {model.isFree && " — free"}
            </option>
          ))}
        </optgroup>
      )),
    [routableGroups]
  );

  // Load data on mount. Routing rows are keyed off AI_CAPABILITIES so a
  // capability that has never been saved still gets an editable card.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [routing, models] = await Promise.all([listModelRouting(), getModelCatalogue()]);
        if (!active) return;
        const hydrated: ModelRow[] = AI_CAPABILITIES.map((capability) => {
          const stored = routing.find((r) => r.capability === capability.id);
          return stored
            ? { ...stored, status: "idle" as const }
            : {
                capability: capability.id,
                primaryModel: "",
                fallbackModel: null,
                temperature: 0.3,
                maxTokens: 1200,
                isEnabled: true,
                updatedAt: new Date().toISOString(),
                status: "idle" as const,
              };
        });
        setRows(hydrated);
        setSaved(Object.fromEntries(hydrated.map((r) => [r.capability, snapshot(r)])));
        setCatalogue(models);
        setError(null);
      } catch {
        if (active) setError("Could not load model routing.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    void probeProviders();
    return () => {
      active = false;
    };
  }, []);

  async function loadCatalogue() {
    setCatalogueLoading(true);
    try {
      setCatalogue(await getModelCatalogue());
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
        setTimeout(
          () =>
            setRows((rs) =>
              rs.map((r) => (r.capability === row.capability ? { ...r, status: "idle" } : r))
            ),
          1800
        );
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

  /** Routes the model open in the detail modal to a capability, saving at once. */
  function assignFromModal(capability: string, field: "primary" | "fallback") {
    if (!selectedModel) return;
    const current = rows.find((r) => r.capability === capability);
    if (!current) return;
    const next: ModelRow =
      field === "primary"
        ? { ...current, primaryModel: selectedModel.modelId }
        : { ...current, fallbackModel: selectedModel.modelId };
    patch(capability, {
      primaryModel: next.primaryModel,
      fallbackModel: next.fallbackModel,
    });
    void save(next);
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

  const totalProviders = providers.length;
  const workingProviders = providers.filter((p) => p.ok).length;
  const catalogueCount = groupedModels.reduce((n, g) => n + g.models.length, 0);
  const unsavedCount = rows.filter((r) => saved[r.capability] !== snapshot(r)).length;

  const tabs: { key: string; label: string; icon: LucideIcon; count: number }[] = [
    { key: "routing", label: "Task routing", icon: Route, count: rows.length },
    { key: "catalogue", label: "Model catalogue", icon: Sparkles, count: catalogueCount },
    { key: "providers", label: "Provider health", icon: Activity, count: totalProviders },
  ];

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
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      {/* ---------------- Header ---------------- */}
      <div className="rounded-2xl border border-brand-line bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold">
              <Cpu className="h-5 w-5 text-brand-gold-dark" aria-hidden />
              AI model routing
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
              Route each AI task to a model, browse the live catalogue by provider and price, and
              check that the configured providers answer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {catalogue?.degraded && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                <TriangleAlert className="h-3 w-3" aria-hidden />
                Offline list
              </span>
            )}
            {/* Both actions open the tab that shows their result — a refresh whose
                new models are invisible, or a probe whose answer is off-screen,
                reads like a button that does nothing. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTab("catalogue");
                void loadCatalogue();
              }}
              disabled={catalogueLoading}
            >
              {catalogueLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Refresh catalogue
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTab("providers");
                void probeProviders();
              }}
              disabled={providerTesting}
            >
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

      {/* ---------------- Tabs ---------------- */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="AI model console">
        {tabs.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            id={`models-tab-${option.key}`}
            aria-selected={tab === option.key}
            aria-controls={`models-panel-${option.key}`}
            onClick={() => setTab(option.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
              tab === option.key
                ? "bg-brand-ink text-brand-cream shadow-soft"
                : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
            )}
          >
            <option.icon className="h-4 w-4" aria-hidden />
            {`${option.label} (${option.count})`}
          </button>
        ))}
      </div>

      {/* ---------------- Tab: provider health ---------------- */}
      <section
        role="tabpanel"
        id="models-panel-providers"
        aria-labelledby="models-tab-providers"
        className={cn(
          "rounded-2xl border border-brand-line bg-white p-5",
          tab !== "providers" && "hidden"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-bold">
              <Activity className="h-4 w-4 text-brand-gold-dark" aria-hidden />
              Active providers
            </h3>
            <p className="mt-1 text-sm text-brand-ink/55">
              Live credential health — each configured key is probed with a real API call when this
              page opens.
            </p>
          </div>
          {providers.length > 0 && (
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink/60">
              {workingProviders} of {totalProviders} working
            </span>
          )}
        </div>

        {providers.length === 0 ? (
          providerTesting ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-brand-line border-dashed bg-brand-cream/50 px-4 py-8 text-sm text-brand-ink/50">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Probing configured providers…
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-brand-line border-dashed bg-brand-cream/50 px-4 py-8 text-center">
              <Cpu className="h-8 w-8 text-brand-gold/60" aria-hidden />
              <p className="mt-3 text-sm font-medium text-brand-ink">No provider probes yet</p>
              <p className="mt-1 max-w-md text-sm text-brand-ink/55">
                Add keys under <strong>API keys</strong> in the settings dock, then run the live
                checks to confirm each provider responds.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => void probeProviders()}
              >
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Run checks
              </Button>
            </div>
          )
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

      {/* ---------------- Tab: model catalogue ---------------- */}
      <section
        role="tabpanel"
        id="models-panel-catalogue"
        aria-labelledby="models-tab-catalogue"
        className={cn(
          "rounded-2xl border border-brand-line bg-white p-5",
          tab !== "catalogue" && "hidden"
        )}
      >
        <header className="mb-4">
          <h3 className="flex items-center gap-2 font-display text-base font-bold">
            <Sparkles className="h-4 w-4 text-brand-gold-dark" aria-hidden />
            Model catalogue
          </h3>
          <p className="mt-1 text-sm text-brand-ink/55">
            {`${activeCatalogue.models.length.toLocaleString()} of ${catalogueCount.toLocaleString()} models match — open one to read its costs and route it to a task.`}
          </p>

          {catalogue && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {catalogue.sources.map((source) => (
                <li
                  key={source.id}
                  title={source.note ?? undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold",
                    source.status === "ok" && source.routable
                      ? "border-emerald-200 bg-emerald-500/10 text-emerald-800"
                      : source.status === "ok"
                        ? "border-brand-line bg-brand-sand text-brand-ink/60"
                        : "border-rose-200 bg-rose-500/10 text-rose-700"
                  )}
                >
                  {source.displayName}
                  <span className="tabular-nums">{source.count}</span>
                  {!source.routable && source.status === "ok" && (
                    <span className="font-bold uppercase tracking-wide">credentials only</span>
                  )}
                  {source.status === "no_key" && <span className="font-bold uppercase tracking-wide">no key</span>}
                  {source.status === "unauthorized" && <span className="font-bold uppercase tracking-wide">key rejected</span>}
                  {source.status === "unreachable" && <span className="font-bold uppercase tracking-wide">no answer</span>}
                  {source.status === "degraded" && <span className="font-bold uppercase tracking-wide">built-in list</span>}
                </li>
              ))}
            </ul>
          )}
        </header>

        {/* Search + price tier. The provider is picked by the tab strip below. */}
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
            value={selectedCostTier}
            onChange={(e) => setSelectedCostTier(e.target.value)}
            className="rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
          >
            <option value="all">All price tiers</option>
            {COST_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {costTierLabel(tier)}
              </option>
            ))}
          </select>

          {(globalSearch.trim() !== "" || selectedCostTier !== "all") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setGlobalSearch("");
                setSelectedCostTier("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="-mx-1 mb-4 flex flex-wrap gap-2 px-1" role="tablist" aria-label="Catalogue providers">
          {catalogueTabs.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              id={`catalogue-tab-${option.key}`}
              aria-selected={activeCatalogue.key === option.key}
              aria-controls={`catalogue-panel-${option.key}`}
              onClick={() => setCatalogueProvider(option.key)}
              className={cn(
                "rounded-xl px-3.5 py-1.5 text-xs font-semibold transition",
                activeCatalogue.key === option.key
                  ? "bg-brand-ink text-brand-cream shadow-soft"
                  : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
              )}
            >
              {`${option.label} (${option.models.length.toLocaleString()})`}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`catalogue-panel-${activeCatalogue.key}`}
          aria-labelledby={`catalogue-tab-${activeCatalogue.key}`}
          className="space-y-5"
        >
          {catalogueSections.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-brand-line border-dashed bg-brand-cream/30 px-4 py-12 text-center">
              <Sparkles className="h-8 w-8 text-brand-ink/30" aria-hidden />
              <p className="mt-3 text-sm font-medium text-brand-ink">
                {`${activeCatalogue.label} has no models matching these filters`}
              </p>
              <p className="mt-1 text-sm text-brand-ink/55">
                Clear the search or set the price tier back to “All price tiers”.
              </p>
            </div>
          ) : (
            renderedSections.map((section) => (
              <div key={section.provider} className="space-y-4">
                {catalogueProvider === "all" && (
                  <h4 className="flex flex-wrap items-center gap-2 font-display text-sm font-bold">
                    <Cpu className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
                    {section.providerName}
                    <span className="text-[11px] font-semibold text-brand-ink/45">
                      {`${section.models.length.toLocaleString()} models`}
                    </span>
                  </h4>
                )}

                {section.tiers.map((tierGroup) => (
                  <div key={`${section.provider}-${tierGroup.tier}`} className="space-y-2.5">
                    <p className="flex items-center gap-2">
                      {costTierBadge(tierGroup.tier)}
                      <span className="text-[11px] font-semibold text-brand-ink/45">
                        {`${tierGroup.total.toLocaleString()} models`}
                      </span>
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {tierGroup.models.map((model) => (
                        <CatalogueCard
                          /* Providers overlap: OpenCode proxies Google's ids, so the
                             id alone is not unique across the flat catalogue. */
                          key={`${model.provider}:${model.modelId}`}
                          model={model}
                          onOpen={setSelectedModel}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          {hiddenTiles > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-cream/40 px-4 py-3">
              <p className="text-xs text-brand-ink/55">
                {`${drawnTiles.toLocaleString()} of ${activeCatalogue.models.length.toLocaleString()} matches are on the page. The rest stay out until you ask — several hundred tiles at once holds up the tab.`}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCatalogueBudget((current) => current + 60)}
              >
                {`Show ${Math.min(60, hiddenTiles).toLocaleString()} more`}
              </Button>
            </div>
          )}
        </div>
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
              <DetailStat icon={DollarSign} label="Input cost" value={priceLabel(selectedModel.promptPrice)} />
              <DetailStat icon={DollarSign} label="Output cost" value={priceLabel(selectedModel.completionPrice)} />
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
                value={selectedSource?.displayName ?? selectedModel.provider}
              />
            </div>

            {selectedModel.detail && (
              <p className="border-t border-brand-line px-5 py-3 text-xs leading-relaxed text-brand-ink/60">
                {selectedModel.provider === "qoder"
                  ? "As Qoder reports it: "
                  : selectedModel.provider === "opencode"
                    ? "As OpenCode reports it: "
                    : selectedModel.provider === "nvidia_nim"
                      ? "As NVIDIA reports it: "
                      : selectedModel.provider === "cloudflare_workers_ai"
                        ? "As Cloudflare reports it: "
                        : ""}
                {selectedModel.detail}
              </p>
            )}

            {selectedSource?.note && (
              <p className="border-t border-brand-line px-5 py-3 text-xs leading-relaxed text-brand-ink/60">
                {selectedSource.note}
              </p>
            )}

            <div className="border-t border-brand-line bg-brand-cream/30 p-5">
              <h4 className="mb-3 text-sm font-bold text-brand-ink">Quick assign</h4>
              {selectedModel.routable ? (
                <QuickAssign
                  model={selectedModel}
                  rows={rows}
                  editable={editable}
                  onAssign={assignFromModal}
                />
              ) : (
                <p className="text-sm leading-relaxed text-brand-ink/60">
                  Not routable — this model is listed from{" "}
                  {selectedSource?.displayName ?? selectedModel.provider}
                  , whose credentials the portal stores and probes but has no
                  gateway code path that sends an inference request to.
                  {selectedModel.enabled === false &&
                    " This one is also switched off for the stored account."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Tab: task routing ---------------- */}
      <div
        role="tabpanel"
        id="models-panel-routing"
        aria-labelledby="models-tab-routing"
        className={cn("space-y-4", tab !== "routing" && "hidden")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-line bg-white px-4 py-3">
          <p className="text-sm text-brand-ink/60">
            One card per AI task: the <strong>primary</strong> model answers every request and the{" "}
            <strong>fallback</strong> takes it over when the primary fails. Temperature and the token
            cap are stored with the row, and the gateway reads them on the next call.
          </p>
          {unsavedCount > 0 ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
              {`${unsavedCount} unsaved`}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/55">
              Everything saved
            </span>
          )}
        </div>

        {!editable && (
          <p className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-xs text-brand-ink/60">
            You can read every routing row; saving needs the
            <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">settings.manage_platform</code>
            permission.
          </p>
        )}

        {rows.map((row) => {
          const definition = AI_CAPABILITIES.find((c) => c.id === row.capability);
          const dirty = saved[row.capability] !== snapshot(row);
          const model = getModelById(row.primaryModel, catalogue?.models);

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

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-ink/50">
                    {model ? (
                      <>
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
                      </>
                    ) : (
                      <span className="italic">No primary model yet — choose one below and save.</span>
                    )}
                    {row.probe && <ProbeBadge result={row.probe} />}
                  </div>
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
                      {row.primaryModel && !catalogueIds.has(row.primaryModel) && (
                        <option value={row.primaryModel}>{row.primaryModel} (not in catalogue)</option>
                      )}
                      {routableOptions}
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
                      {row.fallbackModel && !catalogueIds.has(row.fallbackModel) && (
                        <option value={row.fallbackModel}>{row.fallbackModel} (not in catalogue)</option>
                      )}
                      {routableOptions}
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
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTab("catalogue")}
                    title="Open the model catalogue to choose one"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    Browse models
                  </Button>
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
                  {editable && (
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
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
