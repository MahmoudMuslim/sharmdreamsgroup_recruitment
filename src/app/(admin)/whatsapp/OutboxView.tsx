"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Inbox,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterRail,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";
import {
  cancelWhatsAppJob,
  queueWhatsAppMessage,
  retryWhatsAppJob,
  updateWhatsAppJob,
  type OutboxResult,
} from "./actions";
import type {
  DeliveryRow,
  OutboxBucket,
  OutboxFlags,
  OutboxJob,
  RecipientOption,
} from "./outbox-model";

const BUCKETS: { key: OutboxBucket; label: string; tone: "solid" | "muted" }[] = [
  { key: "ALL", label: "All", tone: "solid" },
  { key: "DUE", label: "Due now", tone: "muted" },
  { key: "WAITING", label: "Scheduled", tone: "solid" },
  { key: "SENT", label: "Delivered", tone: "solid" },
  { key: "FAILED", label: "Parked", tone: "muted" },
];

const SORTS = [
  { key: "queued", label: "Newest queued" },
  { key: "send", label: "Soonest to send" },
  { key: "attempts", label: "Most attempts" },
] as const;

const DATE_TIME = new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "short" });

function bucketOf(job: OutboxJob, nowMs: number): OutboxBucket {
  if (job.status === "SENT") return "SENT";
  if (job.status === "FAILED") return "FAILED";
  return new Date(job.scheduled_for).getTime() <= nowMs ? "DUE" : "WAITING";
}

const BUCKET_TONE: Record<OutboxBucket, "neutral" | "gold" | "success" | "danger" | "info"> = {
  ALL: "neutral",
  DUE: "gold",
  WAITING: "info",
  SENT: "success",
  FAILED: "danger",
};

const BUCKET_LABEL: Record<OutboxBucket, string> = {
  ALL: "Queued",
  DUE: "Due now",
  WAITING: "Scheduled",
  SENT: "Delivered",
  FAILED: "Parked",
};

function stamp(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date);
}

/**
 * Value for a `datetime-local` input.
 *
 * The input wants wall-clock time in the admin's own zone, and the `get*`
 * accessors already report that for any instant — shifting the timestamp first
 * would move the send time by the UTC offset every time a message was saved.
 */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function timeUntil(iso: string, nowMs: number) {
  const diff = new Date(iso).getTime() - nowMs;
  if (Number.isNaN(diff)) return null;
  const minutes = Math.round(Math.abs(diff) / 60000);
  const label =
    minutes < 1
      ? "now"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.round(minutes / 60)}h`
          : `${Math.round(minutes / 1440)}d`;
  if (diff > 0) return `in ${label}`;
  return label === "now" ? "due now" : `${label} ago`;
}

export function OutboxView({
  jobs,
  history,
  recipients,
  canManage,
  flags,
  now,
}: {
  jobs: OutboxJob[];
  history: DeliveryRow[];
  recipients: RecipientOption[];
  canManage: boolean;
  flags: OutboxFlags;
  now: string;
}) {
  const router = useRouter();
  const nowMs = new Date(now).getTime();

  const [tab, setTab] = useState<"queue" | "log">("queue");
  const [bucket, setBucket] = useState<OutboxBucket>("ALL");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("queued");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<OutboxJob | null>(null);

  const counts = useMemo(() => {
    const map: Record<OutboxBucket, number> = { ALL: jobs.length, DUE: 0, WAITING: 0, SENT: 0, FAILED: 0 };
    for (const job of jobs) map[bucketOf(job, nowMs)] += 1;
    return map;
  }, [jobs, nowMs]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = jobs.filter((job) => {
      if (bucket !== "ALL" && bucketOf(job, nowMs) !== bucket) return false;
      if (!needle) return true;
      return (
        job.candidate_name?.toLowerCase().includes(needle) ||
        job.recipient_phone.toLowerCase().includes(needle) ||
        job.text.toLowerCase().includes(needle) ||
        job.template?.toLowerCase().includes(needle)
      );
    });
    return rows.sort((a, b) => {
      if (sort === "attempts") return b.attempts - a.attempts;
      if (sort === "send") return a.scheduled_for.localeCompare(b.scheduled_for);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [jobs, bucket, nowMs, query, sort]);

  async function run(
    label: string,
    success: string,
    fn: () => Promise<OutboxResult>,
    key = label
  ): Promise<boolean> {
    setPending(key);
    setNotice(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error ?? `Could not ${label.toLowerCase()}.` });
        return false;
      }
      setNotice({ kind: "ok", text: success });
      router.refresh();
      return true;
    } catch {
      setNotice({ kind: "error", text: `Something went wrong while trying to ${label.toLowerCase()}.` });
      return false;
    } finally {
      setPending(null);
    }
  }

  function confirmCancel(job: OutboxJob) {
    const who = job.candidate_name ?? job.recipient_phone;
    if (!window.confirm(`Remove this message from the queue?\n\nIt will never be sent to ${who}.`)) return;
    run(
      "Cancel",
      `Removed the message to ${who} from the queue.`,
      () => cancelWhatsAppJob(job.id),
      `Cancel:${job.id}`
    );
  }

  const noPhone = recipients.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Due now"
          value={counts.DUE}
          hint={flags.cronArmed ? "Waiting for the next cron pass" : "Cron secret not set"}
          icon={<Clock className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Scheduled"
          value={counts.WAITING}
          hint="Held for a future send time"
          icon={<Bell className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Delivered"
          value={counts.SENT}
          hint="Accepted by Meta for this queue"
          icon={<Check className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Parked"
          value={counts.FAILED}
          hint={`After ${flags.maxAttempts} failed attempts`}
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Outbox views">
        {(
          [
            { key: "queue", label: `Outbound queue (${jobs.length})`, icon: Inbox },
            { key: "log", label: `Delivery log (${history.length})`, icon: MessageCircle },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setNotice(null);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
              tab === key
                ? "bg-brand-ink text-brand-cream shadow-soft"
                : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
        {canManage && tab === "queue" && (
          <Button size="sm" className="ml-auto" onClick={() => setComposing(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New message
          </Button>
        )}
      </div>

      {notice && (
        <FormMessage
          error={notice.kind === "error" ? notice.text : null}
          success={notice.kind === "ok" ? notice.text : null}
        />
      )}

      {tab === "queue" ? (
        <>
          <Card className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {BUCKETS.map((option) => (
                <FilterRail
                  key={option.key}
                  label={option.label}
                  count={counts[option.key]}
                  tone={option.tone}
                  active={bucket === option.key}
                  onClick={() => setBucket(bucket === option.key ? "ALL" : option.key)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search candidate, number or message text…"
                  aria-label="Search the outbound queue"
                  className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute inset-y-0 right-2 inline-flex items-center text-brand-ink/40 hover:text-brand-ink"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-brand-ink/60">
                Sort
                <Select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                  className="w-auto py-1.5 text-xs"
                  aria-label="Sort the queue"
                >
                  {SORTS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              <span className="text-xs text-brand-ink/45">
                {visible.length === jobs.length
                  ? `${jobs.length} message${jobs.length === 1 ? "" : "s"}`
                  : `${visible.length} of ${jobs.length}`}
              </span>
            </div>
          </Card>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Inbox className="h-8 w-8" aria-hidden />}
                title={jobs.length === 0 ? "Nothing in the outbox" : "No messages match this view"}
                description={
                  jobs.length === 0
                    ? "Stage changes and interview notices queue candidate alerts here automatically, and you can queue one by hand."
                    : "Try another status or clear the search."
                }
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {visible.map((job) => {
                const bucketKey = bucketOf(job, nowMs);
                const open = expanded === job.id;
                const until = timeUntil(job.scheduled_for, nowMs);
                return (
                  <Card key={job.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-base font-bold leading-snug">
                            {job.candidate_name ?? "Candidate no longer in the pipeline"}
                          </h3>
                          <Badge tone={BUCKET_TONE[bucketKey]}>{BUCKET_LABEL[bucketKey]}</Badge>
                          {job.template && (
                            <span className="rounded-full bg-brand-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-ink/55">
                              {job.template}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-ink/55">
                          <span className="font-mono">{job.recipient_phone}</span>
                          {job.job_title && <span className="truncate">{job.job_title}</span>}
                          {bucketKey !== "SENT" && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" aria-hidden />
                              <span suppressHydrationWarning>{stamp(job.scheduled_for)}</span>
                              {until && <span className="text-brand-ink/40">({until})</span>}
                            </span>
                          )}
                          {job.sent_at && (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Check className="h-3 w-3" aria-hidden />
                              <span suppressHydrationWarning>sent {stamp(job.sent_at)}</span>
                            </span>
                          )}
                          {job.attempts > 0 && bucketKey !== "SENT" && (
                            <span className="font-semibold text-brand-gold-dark">
                              {job.attempts} of {flags.maxAttempts} attempts
                            </span>
                          )}
                        </p>
                      </div>

                      {canManage && (
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {bucketKey !== "SENT" && (
                            <>
                              <RowButton
                                label="Edit"
                                icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
                                disabled={pending !== null}
                                onClick={() => setEditing(job)}
                              />
                              <RowButton
                                label={job.attempts > 0 ? "Retry" : "Bump to now"}
                                icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                                busy={pending === `Retry:${job.id}`}
                                onClick={() =>
                                  run(
                                    "Retry",
                                    "Re-armed for the next scheduler pass.",
                                    () => retryWhatsAppJob(job.id),
                                    `Retry:${job.id}`
                                  )
                                }
                              />
                            </>
                          )}
                          <RowButton
                            danger
                            label={bucketKey === "SENT" ? "Locked" : "Cancel"}
                            icon={
                              bucketKey === "SENT" ? (
                                <Check className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              )
                            }
                            disabled={bucketKey === "SENT" || pending !== null}
                            title={
                              bucketKey === "SENT"
                                ? "Delivered messages stay in the queue as the record of the send"
                                : "Remove this message from the queue"
                            }
                            onClick={() => confirmCancel(job)}
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : job.id)}
                      aria-expanded={open}
                      className="mt-3 w-full rounded-xl border border-brand-line bg-brand-cream/60 px-3.5 py-2.5 text-left transition hover:bg-brand-cream"
                    >
                      <span className="flex items-start gap-2">
                        <ChevronRight open={open} />
                        <span
                          className={cn(
                            "whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/80",
                            !open && "line-clamp-2"
                          )}
                        >
                          {job.text || "This job has no message body — it will fail on the next pass."}
                        </span>
                      </span>
                    </button>

                    {job.error_log && (
                      <p className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{job.error_log}</span>
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <Card className="divide-y divide-brand-line">
          {history.length === 0 ? (
            <EmptyState
              icon={<MessageCircle className="h-8 w-8" aria-hidden />}
              title="No delivery attempts yet"
              description="Every message the dispatcher sends — or finally fails to send — is written here once, with the outcome."
            />
          ) : (
            history.map((row) => (
              <div key={row.id} className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    row.delivered ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-700"
                  )}
                >
                  {row.delivered ? (
                    <Send className="h-4 w-4" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {row.candidate_name ?? "Unknown candidate"}
                    <span className="font-mono text-xs font-normal text-brand-ink/50">{row.recipient}</span>
                    <Badge tone={row.delivered ? "success" : "danger"}>
                      {row.delivered ? "Delivered" : "Failed"}
                    </Badge>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/70">
                    {row.body}
                  </p>
                  {row.error_message && (
                    <p className="mt-1 text-xs font-semibold text-rose-700">{row.error_message}</p>
                  )}
                </div>
                <p className="ml-auto shrink-0 text-xs text-brand-ink/45" suppressHydrationWarning>
                  {stamp(row.created_at)}
                </p>
              </div>
            ))
          )}
        </Card>
      )}

      <Card className="space-y-3 p-5 sm:p-6">
        <h2 className="font-display text-base font-bold">How this queue drains</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-brand-ink/65">
          <li className="flex gap-2">
            <Dot on={flags.whatsappEnabled} />
            <span>
              WhatsApp channel is{" "}
              <strong>{flags.whatsappEnabled ? "on" : "off"}</strong> in Settings → Notifications. While it is
              off nothing new is queued, and existing rows wait.
            </span>
          </li>
          <li className="flex gap-2">
            <Dot on={flags.cronArmed} />
            <span>
              The scheduler is <strong>{flags.cronArmed ? "armed" : "not armed"}</strong> —{" "}
              {flags.cronArmed
                ? `/api/cron/whatsapp takes up to ${flags.batchSize} due messages per pass.`
                : "CRON_SECRET is not set, so /api/cron/whatsapp refuses to run and nothing leaves the queue."}
            </span>
          </li>
          <li className="flex gap-2">
            <Dot on />
            <span>
              Retry here re-arms a parked job for the next pass; it never sends a message itself, so a
              delivered alert can never be doubled by an admin click.
            </span>
          </li>
        </ul>
        {!canManage && (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5 text-xs text-brand-ink/60">
            You can see the outbox but not change it — the Send messages permission is required to queue,
            edit, retry or cancel an alert.
          </p>
        )}
      </Card>

      <ComposeDrawer
        open={composing}
        onClose={() => setComposing(false)}
        recipients={recipients}
        noPhone={noPhone}
        nowMs={nowMs}
        onSubmit={async (input) => {
          const ok = await run("Queue", "Added to the outbound queue.", () =>
            queueWhatsAppMessage(input)
          );
          if (ok) setComposing(false);
        }}
      />

      <EditDrawer
        job={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (id, input) => {
          const ok = await run("Save", "Saved to the queue.", () => updateWhatsAppJob(id, input));
          if (ok) setEditing(null);
        }}
      />
    </div>
  );
}

function RowButton({
  label,
  icon,
  onClick,
  disabled,
  busy,
  danger,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "text-rose-700 hover:bg-rose-50" : "hover:bg-brand-sand"
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}

function ChevronRight({ open }: { open: boolean }) {
  return open ? (
    <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
  ) : (
    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
        on ? "bg-emerald-500" : "bg-rose-400"
      )}
      aria-hidden
    />
  );
}

interface ComposeInput {
  applicationId: string;
  text: string;
  scheduledFor: string;
}

function ComposeDrawer({
  open,
  onClose,
  recipients,
  noPhone,
  nowMs,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  recipients: RecipientOption[];
  noPhone: boolean;
  nowMs: number;
  onSubmit: (input: ComposeInput) => Promise<void>;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // A freshly opened compose panel always starts blank, so a message queued a
  // minute ago is never sent twice by accident.
  if (wasOpen && !open) {
    setWasOpen(false);
    setApplicationId("");
    setText("");
    setWhen("");
  } else if (open && !wasOpen) {
    setWasOpen(true);
  }

  const selected = recipients.find((r) => r.id === applicationId) ?? null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Outbound queue"
      title="Queue a WhatsApp message"
      subtitle="Goes into the same queue the pipeline uses, and leaves on the next scheduled pass."
      onSubmit={async () => {
        setBusy(true);
        try {
          await onSubmit({ applicationId, text, scheduledFor: when });
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel="Add to queue"
          pending={busy}
          disabled={!applicationId || !text.trim()}
          note={
            noPhone
              ? "No candidate on file has a phone number, so there is nobody to address yet."
              : "The dispatcher sends what it finds here — nothing is sent by this panel itself."
          }
        />
      }
    >
      <div className="space-y-4">
        <Field label="Candidate" htmlFor="outbox-recipient" required>
          <Select
            id="outbox-recipient"
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
          >
            <option value="">Choose a candidate…</option>
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.full_name} — {recipient.phone}
                {recipient.job_title ? ` — ${recipient.job_title}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {selected && (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5 text-xs text-brand-ink/60">
            Will be queued to <strong className="font-mono">{selected.phone}</strong>.
          </p>
        )}

        <Field
          label="Message"
          htmlFor="outbox-text"
          required
          hint="Plain text as the candidate will read it. Placeholders are not substituted for a hand-written message."
        >
          <TextArea
            id="outbox-text"
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Hello — a quick update on your application…"
          />
        </Field>

        <Field
          label="Send at"
          htmlFor="outbox-when"
          hint="Leave empty to hand it to the very next scheduler pass."
        >
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              id="outbox-when"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className="flex-1"
            />
            {when && (
              <span className="text-xs text-brand-ink/50" suppressHydrationWarning>
                {timeUntil(new Date(when).toISOString(), nowMs) ?? "—"}
              </span>
            )}
          </div>
        </Field>
      </div>
    </Drawer>
  );
}

function EditDrawer({
  job,
  onClose,
  onSubmit,
}: {
  job: OutboxJob | null;
  onClose: () => void;
  onSubmit: (id: string, input: ComposeInput) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed the fields when a different row opens the drawer, during render rather
  // than in an effect, so the first paint already shows the current copy.
  // Clearing it on close means a reopened row never shows stale half-typed text.
  if (job && job.id !== seededFor) {
    setSeededFor(job.id);
    setText(job.text);
    setWhen(toLocalInput(job.scheduled_for));
  }
  if (!job && seededFor !== null) setSeededFor(null);

  return (
    <Drawer
      open={Boolean(job)}
      onClose={onClose}
      eyebrow="Outbound queue"
      title={job ? `Edit message to ${job.candidate_name ?? job.recipient_phone}` : "Edit message"}
      subtitle="Queued copy can be rewritten until it is delivered."
      onSubmit={async () => {
        if (!job) return;
        setBusy(true);
        try {
          await onSubmit(job.id, { applicationId: job.application_id ?? "", text, scheduledFor: when });
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel="Save changes"
          pending={busy}
          disabled={!text.trim()}
          note="Saving re-arms the job for the next pass and clears its attempt counter."
        />
      }
    >
      <div className="space-y-4">
        {job && (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-3.5 py-2.5 text-xs text-brand-ink/60">
            <span className="font-mono">{job.recipient_phone}</span>
            {job.template ? ` · template ${job.template}` : " · written by hand"}
            {job.attempts > 0 ? ` · ${job.attempts} failed attempt(s)` : ""}
          </p>
        )}
        <Field label="Message" htmlFor="outbox-edit-text" required>
          <TextArea
            id="outbox-edit-text"
            rows={7}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="Send at" htmlFor="outbox-edit-when" hint="Empty means the next scheduler pass.">
          <TextInput
            id="outbox-edit-when"
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
