"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CircleSlash,
  Clock3,
  Download,
  Info,
  Loader2,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  addTime,
  deleteTime,
  discardTime,
  editTime,
  getLedger,
  startTime,
  stopTime,
  type LedgerOptions,
  type LedgerView,
  type TimeForm,
} from "./actions";
import { useLive } from "@/modules/live/presentation/Live";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import {
  dayKeyInZone,
  formatInZone,
  fromZoneInputValue,
  toZoneInputValue,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  DEFAULT_CATEGORY,
  TIME_CATEGORIES,
  TIME_LIMITS,
  TIME_SCOPES,
  TIME_WINDOWS,
  byCandidate,
  byCategory,
  byJob,
  byStaff,
  decimalHours,
  elapsedSeconds,
  formatSpan,
  formatTicker,
  groupByDay,
  isRunning,
  subjectOf,
  timeWindow,
  totalSeconds,
  type DayGroup,
  type Slice,
  type TimeCategory,
  type TimeEntry,
  type TimeScope,
  type TimeWindowKey,
} from "@/modules/timelog/domain/ledger";

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

const FIELD =
  "w-full rounded-lg border border-brand-line bg-brand-cream px-2.5 py-1.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none disabled:opacity-60";

const LABEL =
  "min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-brand-ink/45";

const EMPTY_FORM: TimeForm = {
  task: "",
  category: DEFAULT_CATEGORY,
  note: "",
  jobId: null,
  applicationId: null,
  startValue: "",
  endValue: "",
};

/** A slice of the ledger the screen is narrowed onto, and the control that set it. */
interface Focus {
  kind: "category" | "staff" | "job" | "application";
  key: string;
  label: string;
}

function formOf(entry: TimeEntry, timeZone: string): TimeForm {
  return {
    task: entry.task,
    category: entry.category,
    note: entry.note ?? "",
    jobId: entry.job_id,
    applicationId: entry.application_id,
    startValue: toZoneInputValue(entry.started_at, timeZone),
    endValue: entry.ended_at ? toZoneInputValue(entry.ended_at, timeZone) : "",
  };
}

function clockTime(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).slice(0, 5);
}

/**
 * A day key back into words, through the organisation's clock.
 *
 * The key was read out of that zone, so it goes back through it: treating the
 * string as a plain date would parse it as UTC and hand a day-early label to
 * every office that runs ahead of Greenwich.
 */
function dayLabel(key: string, timeZone: string): string {
  if (!key || key === "unknown") return "Undated";
  const instant = fromZoneInputValue(`${key}T00:00`, timeZone);
  return instant
    ? formatInZone(instant, timeZone, { weekday: "short", day: "numeric", month: "short" })
    : key;
}

function matches(entry: TimeEntry, focus: Focus): boolean {
  switch (focus.kind) {
    case "category":
      return entry.category === focus.key;
    case "staff":
      return entry.staff_id === focus.key;
    case "job":
      return entry.job_id === focus.key;
    case "application":
      return entry.application_id === focus.key;
  }
}

/**
 * The instant the ledger is measured against.
 *
 * Re-anchored on every read, because the server sends its own `now`, then walked
 * forward by the monotonic clock rather than by wall-clock arithmetic: a laptop
 * set half an hour wrong cannot make a running timer read short, and the figure
 * ticking on screen is the one the stop will store.
 */
function useLedgerNow(nowIso: string): number {
  const [anchor, setAnchor] = useState(() => ({ iso: nowIso, ms: Date.parse(nowIso) }));
  const [ms, setMs] = useState(anchor.ms);

  // Re-anchoring while rendering rather than in an effect, which is what React
  // prescribes for state that has to follow a prop: an effect would add a second
  // pass to every read, and the ticker would lag the write it just acknowledged.
  if (anchor.iso !== nowIso) {
    const instant = Date.parse(nowIso);
    if (!Number.isNaN(instant)) {
      setAnchor({ iso: nowIso, ms: instant });
      setMs(instant);
    }
  }

  useEffect(() => {
    const base = Date.parse(nowIso);
    if (Number.isNaN(base)) return;
    const openedAt = performance.now();
    const id = window.setInterval(
      () => setMs(base + (performance.now() - openedAt)),
      1000
    );
    return () => window.clearInterval(id);
  }, [nowIso]);

  return ms;
}

function Pill({
  active,
  children,
  onClick,
  disabled,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "rounded-xl px-3.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "bg-brand-ink text-brand-cream shadow-soft"
          : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
      )}
    >
      {children}
    </button>
  );
}

function SubjectPickers({
  form,
  options,
  onChange,
  disabled,
}: {
  form: TimeForm;
  options: LedgerOptions;
  onChange: (patch: Partial<TimeForm>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <label className={LABEL}>
        Opening
        <select
          value={form.jobId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ jobId: event.target.value || null })}
          className={cn(FIELD, "mt-1 font-normal normal-case tracking-normal")}
        >
          <option value="">Not tied to an opening</option>
          {options.openings.map((opening) => (
            <option key={opening.id} value={opening.id}>
              {opening.title}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Candidate
        <select
          value={form.applicationId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ applicationId: event.target.value || null })}
          className={cn(FIELD, "mt-1 font-normal normal-case tracking-normal")}
        >
          <option value="">Not tied to a candidate</option>
          {options.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.job ? ` · ${candidate.job}` : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SpanFields({
  form,
  options,
  onChange,
  showTimes,
  timeZone,
  disabled,
}: {
  form: TimeForm;
  options: LedgerOptions;
  onChange: (patch: Partial<TimeForm>) => void;
  showTimes: boolean;
  timeZone: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <input
        value={form.task}
        disabled={disabled}
        onChange={(event) => onChange({ task: event.target.value })}
        placeholder="What the time went on"
        aria-label="What the time went on"
        maxLength={TIME_LIMITS.task}
        className={FIELD}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className={cn(LABEL, "min-w-[11rem]")}>
          Category
          <select
            value={form.category}
            disabled={disabled}
            onChange={(event) => onChange({ category: event.target.value })}
            className={cn(FIELD, "mt-1 font-normal normal-case tracking-normal")}
          >
            {TIME_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-0 flex-1 pb-1 text-[11px] leading-snug text-brand-ink/50">
          {CATEGORY_HINT[form.category as TimeCategory] ?? CATEGORY_HINT.OTHER}
        </p>
      </div>

      {showTimes && (
        <div className="flex flex-wrap gap-2">
          <label className={LABEL}>
            Started
            <input
              type="datetime-local"
              value={form.startValue}
              disabled={disabled}
              onChange={(event) => onChange({ startValue: event.target.value })}
              className={cn(FIELD, "mt-1 font-normal normal-case tracking-normal")}
            />
            <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-brand-ink/40">
              {timeZone}
            </span>
          </label>
          <label className={LABEL}>
            Ended
            <input
              type="datetime-local"
              value={form.endValue ?? ""}
              disabled={disabled}
              onChange={(event) => onChange({ endValue: event.target.value })}
              className={cn(FIELD, "mt-1 font-normal normal-case tracking-normal")}
            />
            <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-brand-ink/40">
              {timeZone}
            </span>
          </label>
        </div>
      )}

      <SubjectPickers form={form} options={options} onChange={onChange} disabled={disabled} />

      <textarea
        value={form.note}
        disabled={disabled}
        onChange={(event) => onChange({ note: event.target.value })}
        placeholder="Note — what came out of it (optional)"
        aria-label="Note"
        rows={2}
        maxLength={TIME_LIMITS.note}
        className={cn(FIELD, "resize-y")}
      />
    </div>
  );
}

function TimerPanel({
  view,
  running,
  nowMs,
  busy,
  onStart,
  onStop,
  onDiscard,
}: {
  view: LedgerView;
  running: TimeEntry | null;
  nowMs: number;
  busy: boolean;
  onStart: (form: TimeForm) => void;
  onStop: (entry: TimeEntry) => void;
  onDiscard: (entry: TimeEntry) => void;
}) {
  const [form, setForm] = useState<TimeForm>(EMPTY_FORM);
  const patch = (next: Partial<TimeForm>) => setForm((current) => ({ ...current, ...next }));

  if (running) {
    const seconds = elapsedSeconds(running, nowMs);
    const subject = subjectOf(running);

    return (
      <Card className="overflow-hidden">
        <CardHeader title="Running now" meta={`${running.task}`} />
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <p className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-brand-gold-dark">
            {formatTicker(seconds)}
          </p>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-ink/50">
              <Badge tone={CATEGORY_TONE[running.category]}>
                {CATEGORY_LABEL[running.category]}
              </Badge>
              <span>started {clockTime(running.started_at, view.timeZone)}</span>
              {subject && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{subject}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onStop(running)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-ink px-3.5 py-2 text-xs font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Square className="h-3.5 w-3.5" aria-hidden />
              )}
              Stop and log
            </button>
            <button
              type="button"
              onClick={() => onDiscard(running)}
              disabled={busy}
              className={ACTION}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Discard
            </button>
          </div>
        </div>
        <p className="border-t border-brand-line bg-brand-cream px-5 py-2 text-[11px] leading-relaxed text-brand-ink/50">
          Stopping closes the span on the ledger&rsquo;s own clock, so the figure above is what gets
          stored. Discard throws the start away and logs nothing.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Start a timer" meta="opened on the ledger's clock, not this browser's" />
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          onStart(form);
          setForm(EMPTY_FORM);
        }}
      >
        <SpanFields
          form={form}
          options={view.options}
          onChange={patch}
          showTimes={false}
          timeZone={view.timeZone}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || form.task.trim() === ""}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          Start
        </button>
      </form>
    </Card>
  );
}

function AddSpanPanel({
  view,
  busy,
  onAdd,
}: {
  view: LedgerView;
  busy: boolean;
  onAdd: (form: TimeForm) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TimeForm>(() => ({
    ...EMPTY_FORM,
    startValue: toZoneInputValue(view.now, view.timeZone),
    endValue: toZoneInputValue(view.now, view.timeZone),
  }));
  const patch = (next: Partial<TimeForm>) => setForm((current) => ({ ...current, ...next }));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(ACTION, "px-4 py-2.5")}>
        <Plus className="h-4 w-4" aria-hidden />
        Add a span that already happened
      </button>
    );
  }

  return (
    <Card>
      <CardHeader title="Log a span by hand" meta={`${view.timeZone} — typed as a wall clock`} />
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(form);
        }}
      >
        <SpanFields
          form={form}
          options={view.options}
          onChange={patch}
          showTimes
          timeZone={view.timeZone}
          disabled={busy}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || form.task.trim() === ""}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Add to the ledger
          </button>
          <button type="button" onClick={() => setOpen(false)} className={ACTION}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

function EntryRow({
  entry,
  view,
  nowMs,
  busy,
  onStop,
  onSave,
  onDelete,
}: {
  entry: TimeEntry;
  view: LedgerView;
  nowMs: number;
  busy: boolean;
  onStop: (entry: TimeEntry) => void;
  onSave: (entry: TimeEntry, form: TimeForm) => Promise<boolean>;
  onDelete: (entry: TimeEntry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TimeForm>(() => formOf(entry, view.timeZone));

  const mine = entry.staff_id === view.callerStaffId;
  const running = isRunning(entry);
  const seconds = elapsedSeconds(entry, nowMs);
  const subject = subjectOf(entry);
  const patch = (next: Partial<TimeForm>) => setForm((current) => ({ ...current, ...next }));

  if (editing) {
    return (
      <li className="rounded-xl border border-brand-gold/60 bg-white p-4">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
          <Clock3 className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
          {running ? "Correcting a running timer" : `Correcting ${formatSpan(seconds)} logged here`}
        </p>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onSave(entry, form)) setEditing(false);
          }}
        >
          <SpanFields
            form={form}
            options={view.options}
            onChange={patch}
            showTimes={!running}
            timeZone={view.timeZone}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button type="submit" className={ACTION}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(formOf(entry, view.timeZone));
                setEditing(false);
              }}
              className={ACTION}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border bg-white px-4 py-3",
        running ? "border-brand-gold/60 bg-brand-gold/5" : "border-brand-line"
      )}
    >
      <div className="w-[9rem] shrink-0">
        <p className="text-xs font-semibold tabular-nums text-brand-ink/70">
          {clockTime(entry.started_at, view.timeZone)}
          <span className="mx-1 text-brand-ink/30" aria-hidden>
            &rarr;
          </span>
          {running ? (
            <span className="font-bold text-brand-gold-dark">{formatTicker(seconds)}</span>
          ) : (
            <span>{clockTime(entry.ended_at ?? entry.started_at, view.timeZone)}</span>
          )}
        </p>
        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-ink/40">
          {running ? "running" : "logged"}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", running && "font-semibold")}>{entry.task}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-ink/50">
          <Badge tone={CATEGORY_TONE[entry.category]}>{CATEGORY_LABEL[entry.category]}</Badge>
          <span>{entry.staff_name}</span>
          {subject && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{subject}</span>
            </>
          )}
        </p>
        {entry.note && (
          <p className="mt-1 text-xs leading-relaxed text-brand-ink/55" title={entry.note}>
            {entry.note}
          </p>
        )}
      </div>

      <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
        <p className="text-sm font-bold tabular-nums text-brand-ink/80">{formatSpan(seconds)}</p>
        <p className="text-[10px] tabular-nums text-brand-ink/40">{decimalHours(seconds)} h</p>
        {mine && (
          <div className="flex items-center gap-1.5">
            {running ? (
              <button
                type="button"
                onClick={() => onStop(entry)}
                disabled={busy}
                className={ACTION}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Square className="h-3.5 w-3.5" aria-hidden />
                )}
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  className={ACTION}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  disabled={busy}
                  className={ACTION}
                  aria-label={`Remove ${entry.task} from the ledger`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function SliceList({
  title,
  meta,
  slices,
  total,
  kind,
  focus,
  onPick,
  empty,
}: {
  title: string;
  meta: string;
  slices: Slice[];
  total: number;
  /** The kind these slices belong to, or null when clicking them would filter nothing. */
  kind: Focus["kind"] | null;
  focus: Focus | null;
  onPick: (focus: Focus) => void;
  empty: string;
}) {
  return (
    <Card className="p-5">
      <CardHeader title={title} meta={meta} className="-mx-5 -mt-5" />
      {slices.length === 0 ? (
        <p className="mt-3 text-xs text-brand-ink/50">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {slices.map((slice) => {
            const active = kind !== null && focus?.kind === kind && focus.key === slice.key;
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span
                    className={cn(
                      "min-w-0 truncate font-semibold",
                      active ? "text-brand-gold-dark" : "text-brand-ink/75"
                    )}
                  >
                    {slice.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-brand-ink/50">
                    {formatSpan(slice.seconds)}
                    <span className="ml-1 text-brand-ink/35">{decimalHours(slice.seconds)}h</span>
                  </span>
                </span>
                <Meter
                  value={slice.seconds}
                  max={total || 1}
                  tone={active ? "ink" : "gold"}
                  className="mt-1"
                />
              </>
            );

            if (!kind) {
              return (
                <li key={slice.key} className="block w-full text-left">
                  {body}
                </li>
              );
            }

            return (
              <li key={slice.key}>
                <button
                  type="button"
                  onClick={() => onPick({ kind, key: slice.key, label: slice.label })}
                  aria-pressed={active}
                  title={active ? "Show the whole cut again" : `Only ${slice.label.toLowerCase()}`}
                  className="w-full text-left"
                >
                  {body}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TimeView({
  initial,
  caveats,
  exportFormats,
}: {
  initial: LedgerView;
  caveats: string[];
  /** Passed as plain data: the export module itself is server-only. */
  exportFormats: { key: string; label: string; hint: string }[];
}) {
  const [view, setView] = useState<LedgerView>(initial);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nowMs = useLedgerNow(view.now);
  const live = useLive();

  const changedAt = live.lastChange?.at ?? null;
  const ledgerMoved = Boolean(changedAt && live.lastChange?.areas.includes("time"));

  function load(nextWindow: TimeWindowKey, scope: TimeScope) {
    setError(null);
    startTransition(async () => {
      const result = await getLedger({ window: nextWindow, scope });
      if (!result.ok || !result.view) {
        setError(result.error ?? "The ledger could not be read. Please retry.");
        return;
      }
      setView(result.view);
    });
  }

  /**
   * Reads the current cut again.
   *
   * After a write, because the rows on screen are held in this component and a
   * server re-render cannot replace them; and when the live channel says the
   * ledger moved, because a colleague closing their timer is exactly the change a
   * shared timesheet has to show without anyone clicking.
   */
  const reload = () => load(view.window, view.scope);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Another tab, another recruiter, the same table: the channel says the ledger
  // moved, so the screen asks for it again instead of waiting for a click.
  useEffect(() => {
    if (!ledgerMoved) return;
    reloadRef.current();
  }, [ledgerMoved, changedAt]);

  async function apply(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<boolean> {
    setBusy(label);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? `Could not ${label.toLowerCase()}.`);
      return false;
    }
    reloadRef.current();
    return true;
  }

  const running =
    view.entries.find((entry) => isRunning(entry) && entry.staff_id === view.callerStaffId) ?? null;

  const shown = useMemo(
    () => (focus ? view.entries.filter((entry) => matches(entry, focus)) : view.entries),
    [view.entries, focus]
  );

  const timeZone = view.timeZone;
  const groups = useMemo(
    () => groupByDay(shown, nowMs, (iso) => dayKeyInZone(iso, timeZone)),
    [shown, nowMs, timeZone]
  );

  const total = totalSeconds(shown, nowMs);
  const days = timeWindow(view.window).days;
  const todayKey = dayKeyInZone(view.now, timeZone);
  const busiest = groups.reduce<DayGroup | null>(
    (best, group) => (group.seconds > (best?.seconds ?? 0) ? group : best),
    null
  );

  const slices: {
    title: string;
    meta: string;
    kind: Focus["kind"] | null;
    list: Slice[];
    empty: string;
  }[] = [
    {
      title: "By category",
      meta: "Click a bar to narrow the ledger onto it",
      kind: "category",
      list: byCategory(shown, nowMs),
      empty: "No category carries hours in this cut.",
    },
    view.scope === "team"
      ? {
          title: "By colleague",
          meta: "Whose hours, on the office wall clock",
          kind: "staff",
          list: byStaff(shown, nowMs),
          empty: "Nobody else in the company has logged hours in this window.",
        }
      : {
          title: "By day",
          meta: `${groups.length} day${groups.length === 1 ? "" : "s"} with hours in them`,
          kind: null,
          list: groups.map((group) => ({
            key: group.key,
            label: dayLabel(group.key, timeZone),
            seconds: group.seconds,
            entries: group.entries.length,
          })),
          empty: "No day carries hours in this cut.",
        },
    {
      title: "By opening",
      meta: "Only spans tied to a job appear here",
      kind: "job",
      list: byJob(shown, nowMs),
      empty: "No span in this cut points at an opening.",
    },
    {
      title: "By candidate",
      meta: "Spans tied to an application",
      kind: "application",
      list: byCandidate(shown, nowMs),
      empty: "No span in this cut points at a candidate.",
    },
  ];

  const toggle = (next: Focus) =>
    setFocus(focus?.kind === next.kind && focus.key === next.key ? null : next);

  /* The window and scope travel to the route, which re-reads the ledger from the
   * database on click — a download is the same cut this screen shows, never a
   * copy of whatever rows happened to be loaded here. */
  const exportQuery = new URLSearchParams({ window: view.window, scope: view.scope });
  const exportHref = (format: string) =>
    `/api/time/export?${exportQuery.toString()}&format=${format}`;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TIME_WINDOWS.map((option) => (
          <Pill
            key={option.key}
            active={view.window === option.key}
            disabled={pending}
            onClick={() => load(option.key, view.scope)}
          >
            {option.label}
          </Pill>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-brand-line sm:block" aria-hidden />
        {TIME_SCOPES.map((option) => (
          <Pill
            key={option}
            active={view.scope === option}
            disabled={pending}
            onClick={() => load(view.window, option)}
          >
            {option === "mine" ? "My hours" : "The company"}
          </Pill>
        ))}
        {/*
          The file is built server-side from the same read as this screen, so it
          carries the window and whose hours are on show — but not the bar someone
          clicked, which is a screen-only narrowing. Saying so here is what keeps a
          download from arriving shorter than the person expected.
        */}
        <div
          className="ml-auto flex items-center gap-1.5"
          role="group"
          aria-label="Download this cut of the ledger"
        >
          {exportFormats.map((format) => (
            <a
              key={format.key}
              href={exportHref(format.key)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
              title={`${format.label}: ${format.hint}. Covers ${view.scopeNote} A filter clicked on screen narrows the page, not the file.`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {format.label}
            </a>
          ))}
        </div>
        {(pending || busy) && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-ink/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {busy ?? "Reading"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-2.5">
        <p className="text-xs text-brand-ink/60" aria-live="polite">
          <span className="font-semibold text-brand-ink/75">{view.scopeNote}</span>
          <span aria-hidden> · </span>
          {view.entries.length.toLocaleString()} entr{view.entries.length === 1 ? "y" : "ies"}
          {focus && (
            <span className="text-brand-ink/40"> · {shown.length.toLocaleString()} after the filter</span>
          )}
        </p>
        {focus && (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-gold bg-brand-gold/15 px-3 py-1.5 text-[11px] font-semibold text-brand-gold-dark transition hover:bg-brand-gold/25"
          >
            <CircleSlash className="h-3.5 w-3.5" aria-hidden />
            {focus.label}
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TimerPanel
          view={view}
          running={running}
          nowMs={nowMs}
          busy={busy !== null}
          onStart={(form) => void apply("start a timer", () => startTime(form))}
          onStop={(entry) => void apply("stop the timer", () => stopTime(entry.id))}
          onDiscard={(entry) => {
            if (!window.confirm(`Discard “${entry.task}” without logging its time?`)) return;
            void apply("discard the timer", () => discardTime(entry.id));
          }}
        />
        <div className="space-y-3">
          <AddSpanPanel
            view={view}
            busy={busy !== null}
            onAdd={(form) => void apply("add the span", () => addTime(form))}
          />
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            A hand-logged span meets the same rules as a timer: the end has to fall after the start,
            and neither can be in the future.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Logged"
          value={formatSpan(total)}
          hint={`${decimalHours(total)} h over ${shown.length.toLocaleString()} entries`}
          icon={<Clock3 className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Per day"
          value={formatSpan(Math.round(total / days))}
          hint={`${decimalHours(total / days)} h across ${days} day${days === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Busiest day"
          value={busiest ? formatSpan(busiest.seconds) : "—"}
          hint={busiest ? dayLabel(busiest.key, timeZone) : "Nothing logged yet"}
        />
        <StatTile
          label="Running"
          value={running ? formatTicker(elapsedSeconds(running, nowMs)) : "—"}
          hint={running ? running.task : "No timer of yours is open"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {slices.map((section) => (
          <SliceList
            key={section.title}
            title={section.title}
            meta={section.meta}
            slices={section.list}
            total={total}
            kind={section.kind}
            focus={focus}
            onPick={toggle}
            empty={section.empty}
          />
        ))}
      </div>

      {shown.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title={focus ? `Nothing here matches ${focus.label}` : "No hours in this cut"}
            description={
              focus
                ? "The filter is narrowed onto a slice with no rows in this window. Clear it, or widen the window."
                : "The ledger holds no rows for this window and scope. A timer started before the window opened still appears, so a running span is never left without a Stop button."
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink/70">
                  {dayLabel(group.key, timeZone)}
                  <span className="ml-2 text-[11px] font-semibold normal-case tracking-normal text-brand-ink/35">
                    {group.key === todayKey
                      ? "today"
                      : `${group.entries.length} entr${group.entries.length === 1 ? "y" : "ies"}`}
                  </span>
                </h2>
                <p className="text-xs font-bold tabular-nums text-brand-ink/60">
                  {formatSpan(group.seconds)}
                  <span className="ml-1.5 font-normal text-brand-ink/35">
                    {decimalHours(group.seconds)} h
                  </span>
                </p>
              </div>
              <Meter
                value={group.seconds}
                max={(busiest?.seconds ?? 0) || 1}
                tone="ink"
                className="mb-2"
              />
              <ul className="space-y-2">
                {group.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    view={view}
                    nowMs={nowMs}
                    busy={busy !== null}
                    onStop={(target) => void apply("stop the timer", () => stopTime(target.id))}
                    onSave={(target, form) =>
                      apply("save the entry", () => editTime(target.id, form))
                    }
                    onDelete={(target) => {
                      if (
                        !window.confirm(
                          `Remove ${formatSpan(elapsedSeconds(target, nowMs))} — “${target.task}” — from the ledger?`
                        )
                      )
                        return;
                      void apply("remove the entry", () => deleteTime(target.id));
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Card className="p-5">
        <CardHeader title="What this ledger is" meta="Read before treating it as a timesheet" />
        <div className="mt-3 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
            <Info className="h-3.5 w-3.5" aria-hidden />
            How these numbers are made
          </p>
          <ul className="mt-1.5 space-y-1">
            {caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-brand-ink/65">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-brand-ink/55">
          Every account holding the{" "}
          <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">time.track</code>{" "}
          permission logs its own hours and reads every span logged by anyone in its company; only
          the person who worked a span can change or remove it, and the ledger holds one open timer
          per person at a time.
        </p>
      </Card>
    </div>
  );
}
