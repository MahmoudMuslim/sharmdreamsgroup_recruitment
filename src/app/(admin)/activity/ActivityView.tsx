"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Download,
  Filter,
  History,
  Info,
  Loader2,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { getTrail, type TrailQuery, type TrailView } from "./actions";
import { queryToParams } from "@/modules/activity/domain/trailQuery";
import {
  ACTIVITY_AREAS,
  ACTIVITY_SURFACES,
  ACTOR_KIND_LABELS,
  describeActor,
  recordHref,
  TRAIL_WINDOWS,
  type ActivityRow,
  type ActorKind,
} from "@/modules/activity/domain/trail";
import { Badge, Card, CardHeader, EmptyState } from "@/modules/analytics/presentation/ui";
import { Pagination } from "@/modules/analytics/presentation/Pagination";
import { pageWindow } from "@/lib/paging";
import { dayKeyInZone, formatInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<ActorKind, "neutral" | "gold" | "info" | "success"> = {
  STAFF: "neutral",
  AI: "gold",
  CANDIDATE: "info",
  SYSTEM: "success",
};

const KIND_SHORT: Record<ActorKind, string> = {
  STAFF: "Person",
  AI: "AI",
  CANDIDATE: "Candidate",
  SYSTEM: "Scheduler",
};

type Format = { key: string; label: string; hint: string };

/** The filter bag as the screen holds it. Empty string means "no filter". */
interface FormState {
  area: string;
  actorKind: string;
  surface: string;
  entity: string;
  entityId: string;
  query: string;
  window: string;
}

function formOf(filters: TrailView["filters"]): FormState {
  return {
    area: filters.area ?? "",
    actorKind: filters.actorKind ?? "",
    surface: filters.surface ?? "",
    entity: filters.entity ?? "",
    entityId: filters.entityId ?? "",
    query: filters.query,
    window: filters.window,
  };
}

function stampOf(iso: string, timeZone: string): string {
  return `${dayKeyInZone(iso, timeZone)} ${formatInZone(iso, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).slice(0, 5)}`;
}

/** A UUID tail is enough to tell two records apart at a glance; the whole string is in `title`. */
function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function Pill({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-xl px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-brand-ink text-brand-cream shadow-soft"
          : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
      )}
    >
      {children}
    </button>
  );
}

function DetailList({ row, timeZone }: { row: ActivityRow; timeZone: string }) {
  const entries = Object.entries(row.detail ?? {});

  return (
    <div className="border-t border-brand-line bg-brand-cream/60 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
        {row.action.replace(/[_.]/g, " ")}
        {!row.detail && " — no field values were recorded for this change"}
      </p>
      {entries.length > 0 && (
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {entries.map(([key, value]) => {
            const withheld = value === "[withheld]";
            return (
              <div key={key} className="flex flex-wrap items-baseline gap-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/45">
                  {key.replace(/[_.]/g, " ")}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    withheld ? "font-semibold text-amber-700" : "text-brand-ink/75"
                  )}
                  title={String(value ?? "")}
                >
                  {value === null || value === undefined || value === "" ? "—" : String(value)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="mt-2 text-[11px] text-brand-ink/40">
        Recorded {stampOf(row.created_at, timeZone)} · {timeZone}
      </p>
    </div>
  );
}

function TrailRow({
  row,
  timeZone,
  open,
  onToggle,
  onHistory,
}: {
  row: ActivityRow;
  timeZone: string;
  open: boolean;
  onToggle: () => void;
  onHistory: () => void;
}) {
  const link = recordHref(row.entity, row.entity_id);
  const hasDetail = Boolean(row.detail && Object.keys(row.detail).length > 0);

  return (
    <li className="overflow-hidden rounded-2xl border border-brand-line bg-white">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className="w-[6.5rem] shrink-0 pt-0.5 text-[11px] font-semibold tabular-nums text-brand-ink/45">
          {stampOf(row.created_at, timeZone)}
        </span>

        <Badge tone={KIND_TONE[row.actor_kind]} className="mt-0.5 shrink-0">
          {KIND_SHORT[row.actor_kind]}
        </Badge>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-semibold text-brand-ink">{describeActor(row)}</span>
            <span className="text-brand-ink/40"> · {row.via}</span>
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-brand-ink/75">{row.summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-ink/45">
            <span className="rounded-full bg-brand-sand px-2 py-0.5 font-semibold">{row.area}</span>
            <span>{row.entity}</span>
            {row.entity_id && (
              <button
                type="button"
                onClick={onHistory}
                title="Show only this record's history"
                className="inline-flex items-center gap-1 rounded-full border border-brand-line px-1.5 py-0.5 font-mono text-[10px] transition hover:bg-brand-sand"
              >
                <History className="h-3 w-3" aria-hidden />
                {shortId(row.entity_id)}
              </button>
            )}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {link && (
            <a
              href={link.href}
              title={link.label}
              className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
            >
              {link.label}
              <ChevronRight className="h-3 w-3" aria-hidden />
            </a>
          )}
          {hasDetail && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? "Hide the recorded fields" : "Show the recorded fields"}
              className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
            >
              Fields
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>
      {open && hasDetail && <DetailList row={row} timeZone={timeZone} />}
    </li>
  );
}

export function ActivityView({
  initial,
  formats,
  caveats,
}: {
  initial: TrailView;
  formats: Format[];
  caveats: string[];
}) {
  const [view, setView] = useState<TrailView>(initial);
  const [form, setForm] = useState<FormState>(formOf(initial.filters));
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The cut in the address bar is the screen's own: the assistant's link carries
  // the filters its answer read, and the page server-rendered that cut as
  // `initial`. Arriving on this route again re-renders rather than remounts, so
  // the last query taken from the address bar is tracked and re-applied here
  // too. `pull` writes the URL itself, and this Next build patches
  // `replaceState` into the router, so that write also moves `useSearchParams` —
  // which is why the written query is recorded: a seed this screen wrote must
  // not rewind the rows it just loaded to the server's first cut.
  const params = useSearchParams();
  const seed = params.toString();
  const [written, setWritten] = useState<string | null>(null);
  const [lastSeed, setLastSeed] = useState(seed);
  if (seed !== lastSeed) {
    setLastSeed(seed);
    if (seed !== written) {
      setView(initial);
      setForm(formOf(initial.filters));
      setOpen(null);
      setError(null);
    }
  }

  function pull(patch: Partial<FormState>, page = 1) {
    const merged: FormState = { ...form, ...patch };
    setForm(merged);
    setOpen(null);
    setError(null);

    const request: TrailQuery = {
      area: merged.area || undefined,
      actorKind: merged.actorKind || undefined,
      surface: merged.surface || undefined,
      entity: merged.entity || undefined,
      entityId: merged.entityId || undefined,
      query: merged.query || undefined,
      window: merged.window,
      page,
    };

    startTransition(async () => {
      const result = await getTrail(request);
      if (!result.ok || !result.view) {
        setError(result.error ?? "The trail could not be read. Please retry.");
        return;
      }
      setView(result.view);
      // The cut and the page go into the address bar so a reload, a paste into
      // the chat and the Back button all describe the rows on screen. It is a
      // `replaceState` rather than a router push: the rows come from the action
      // this transition is already awaiting, and Back should leave the page
      // instead of replaying every chip the reader clicked.
      const params = queryToParams(result.view.filters);
      if (result.view.page > 1) params.set("page", String(result.view.page));
      const next = params.toString();
      setWritten(next);
      window.history.replaceState(null, "", `?${next}`);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pull({});
  }

  const focusedRecord = view.filters.entityId
    ? `${view.filters.entity} ${shortId(view.filters.entityId)}`
    : null;
  const filtered = Boolean(
    view.filters.area ||
      view.filters.actorKind ||
      view.filters.surface ||
      view.filters.entity ||
      view.filters.entityId ||
      view.filters.query ||
      view.filters.window !== "30d"
  );
  const exportBase = `/api/activity/export?${queryToParams(view.filters).toString()}`;
  const kinds = Object.keys(ACTOR_KIND_LABELS) as ActorKind[];
  const pager = pageWindow(view.page, view.total, view.rows.length, view.size);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {kinds.map((kind) => (
          <Pill
            key={kind}
            active={form.actorKind === kind}
            title={`${view.tally[kind].toLocaleString()} changes on record made by ${ACTOR_KIND_LABELS[kind].toLowerCase()}`}
            onClick={() => pull({ actorKind: form.actorKind === kind ? "" : kind })}
          >
            {ACTOR_KIND_LABELS[kind]}
            <span className="ml-1.5 tabular-nums opacity-70">
              {view.tally[kind].toLocaleString()}
            </span>
          </Pill>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-brand-line sm:block" aria-hidden />
        {TRAIL_WINDOWS.map((option) => (
          <Pill
            key={option.key}
            active={form.window === option.key}
            onClick={() => pull({ window: option.key })}
          >
            {option.label}
          </Pill>
        ))}
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-ink/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Reading
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-brand-ink/55">
          Area
          <select
            value={form.area}
            onChange={(event) => pull({ area: event.target.value })}
            className="rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/70"
          >
            <option value="">Everything</option>
            {ACTIVITY_AREAS.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-xs font-semibold text-brand-ink/55">
          Through
          <select
            value={form.surface}
            onChange={(event) => pull({ surface: event.target.value })}
            className="rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/70"
          >
            <option value="">Any surface</option>
            {ACTIVITY_SURFACES.map((surface) => (
              <option key={surface} value={surface}>
                {surface}
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={submit} className="flex flex-1 items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-ink/35"
              aria-hidden
            />
            <input
              value={form.query}
              onChange={(event) => setForm((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search the wording of a change, or an actor’s name"
              aria-label="Search the change trail"
              className="w-full rounded-xl border border-brand-line bg-white py-1.5 pl-9 pr-3 text-xs text-brand-ink/80 outline-none focus:border-brand-gold"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl border border-brand-line bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand disabled:opacity-60"
          >
            Search
          </button>
          {form.query && (
            <button
              type="button"
              onClick={() => pull({ query: "" })}
              className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-brand-ink/50 hover:bg-brand-sand"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          )}
        </form>

        <div className="flex items-center gap-2">
          {formats.map((format) => (
            <a
              key={format.key}
              href={`${exportBase}&format=${encodeURIComponent(format.key)}`}
              title={format.hint}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {format.label}
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs text-brand-ink/60">
          <Filter className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
          <span className="font-semibold">{view.scope}</span>
          <span aria-live="polite">
            · {view.total.toLocaleString()} matching
            {view.rows.length > 0
              ? `, rows ${pager.from.toLocaleString()}–${pager.to.toLocaleString()} here`
              : ""}
          </span>
          {pending && <span className="text-brand-ink/40">· refreshing</span>}
        </p>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setForm({
                area: "",
                actorKind: "",
                surface: "",
                entity: "",
                entityId: "",
                query: "",
                window: "30d",
              });
              pull({
                area: "",
                actorKind: "",
                surface: "",
                entity: "",
                entityId: "",
                query: "",
                window: "30d",
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
          >
            <CircleSlash className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </button>
        )}
      </div>

      {focusedRecord && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-gold/40 bg-brand-gold/10 px-4 py-2.5 text-xs text-brand-ink/70">
          <History className="h-3.5 w-3.5 text-brand-gold-dark" aria-hidden />
          Showing only the history of {focusedRecord}.
          <button
            type="button"
            onClick={() => pull({ entity: "", entityId: "" })}
            className="font-semibold text-brand-gold-dark underline underline-offset-2"
          >
            Show everything again
          </button>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {view.rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="Nothing in the trail matches this cut"
            description={
              view.total === 0 && !filtered
                ? "The trail table is empty. Every screen that changes hiring data has to hand a row to it, and those that have not been wired yet leave no trace — widen the window or check back after using the portal."
                : "Widen the window or clear a filter. An unmatched cut is shown as empty rather than filled with rows that do not fit it."
            }
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {view.rows.map((row) => (
            <TrailRow
              key={row.id}
              row={row}
              timeZone={view.timeZone}
              open={open === row.id}
              onToggle={() => setOpen(open === row.id ? null : row.id)}
              onHistory={() => pull({ entity: row.entity, entityId: row.entity_id ?? "" })}
            />
          ))}
        </ul>
      )}

      <Pagination
        window={pager}
        noun="changes"
        onChange={(next) => pull({}, next)}
        pending={pending}
      />

      {view.more && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">
          The pager walks the {view.total.toLocaleString()} matching rows {view.size} at a time. A
          download carries up to 2,000 of them in one file.
        </p>
      )}

      <Card className="p-5">
        <CardHeader title="What this trail does not hold" meta="Read before trusting a quiet stretch" />
        <div className="mt-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Caveats carried into every download
          </p>
          <ul className="mt-1.5 space-y-1">
            {caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-brand-ink/65">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-brand-ink/55">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold" aria-hidden />
          Only accounts holding the{" "}
          <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">
            settings.manage_platform
          </code>{" "}
          permission read this page or take a file from it. Rows are never edited or deleted, and a
          value that should not be kept — a CV, a message body, a credential — is stored as
          [withheld] so that the fact of the change survives without the content.
        </p>
      </Card>
    </div>
  );
}
