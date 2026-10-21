"use client";

import {
  useState
} from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  ChevronDown,
  Eraser,
  Loader2,
  RefreshCw,
  X
} from "lucide-react";
import { navForward } from "@/modules/shell/domain/navTransition";
import {
  type StaffAlert
} from "@/modules/shell/application/shell-actions";
import {
  acknowledgeAlerts,
  acknowledgeOneAlert,
  partitionAlerts,
  type AlertAckMap
} from "@/lib/alert-ack";
import { cn, formatDateTime } from "@/lib/utils";
import { Note, type Panel, PanelShell } from "./AppBarPrimitives";

/* -------------------------------------------------------------------------- */
/* Attention feed                                                             */
/* -------------------------------------------------------------------------- */

function FeedAction({
  label,
  note,
  disabled,
  onClick,
  children,
}: {
  label: string;
  note: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={note}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      {label}
    </button>
  );
}

/** The count chip, tinted by how urgent the queue is. */
function AlertCount({ alert, muted }: { alert: StaffAlert; muted?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 grid h-6 min-w-6 shrink-0 place-items-center rounded-lg px-1.5 text-[11px] font-bold",
        muted
          ? "bg-brand-ink/10 text-brand-ink/55"
          : alert.tone === "danger"
            ? "bg-rose-600 text-brand-on-accent"
            : alert.tone === "warn"
              ? "bg-amber-500 text-brand-ink"
              : "bg-brand-ink text-brand-cream"
      )}
    >
      {alert.count > 99 ? "99+" : alert.count}
    </span>
  );
}

export function AlertsPanel({
  open,
  alerts,
  acks,
  userId,
  error,
  readAt,
  onReload,
}: {
  open: Panel;
  alerts: StaffAlert[] | null;
  acks: AlertAckMap;
  userId: string;
  error: string | null;
  /** When the counts were last read, as an ISO stamp. */
  readAt: string | null;
  onReload: () => void;
}) {
  const [showCleared, setShowCleared] = useState(false);

  const waiting = alerts?.filter((alert) => alert.count > 0) ?? [];
  const { rows, cleared, unseen } = partitionAlerts(waiting, acks);
  const waitingTotal = waiting.reduce((sum, alert) => sum + alert.count, 0);

  return (
    <PanelShell id="alerts" open={open} label="Notifications">
      {/*
        Sticky under the panel's own scroll, so the toolbar stays reachable while
        a recruiter scrolls a long feed — the header used to scroll away with it.
        The panel scrolls inside its padding box, so `top` is offset by exactly
        that padding and the negative margins pull the strip over it; otherwise
        rows scroll visibly through a gap above the header.
      */}
      <header className="sticky -top-4 z-10 -mx-4 -mt-4 border-b border-brand-line bg-brand-cream px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/45">
              Needs attention
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
              {readAt
                ? `Live counts, read at ${formatDateTime(readAt)}.`
                : "Live counts from the pipeline."}
            </p>
          </div>
          <button
            type="button"
            onClick={onReload}
            aria-label="Recount what needs attention"
            title="Recount"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/55 transition hover:bg-brand-sand hover:text-brand-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-tight text-brand-ink/55">
            {alerts
              ? `${waitingTotal} waiting in ${rows.length} queue${rows.length === 1 ? "" : "s"}${
                  unseen.length ? ` · ${unseen.length} unseen` : ""
                }`
              : "Counting what the pipeline is holding."}
          </p>
          <FeedAction
            label="Read all"
            note="Mark every queue here as seen. A queue returns when its count grows."
            disabled={unseen.length === 0}
            onClick={() => acknowledgeAlerts(userId, rows, false)}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          </FeedAction>
          <FeedAction
            label="Clear all"
            note="Empty this list. Cleared queues come back on their own when their count grows."
            disabled={rows.length === 0}
            onClick={() => acknowledgeAlerts(userId, rows, true)}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
          </FeedAction>
        </div>
      </header>

      <div className="mt-3">
        {error && <Note tone="danger">{error}</Note>}

        {!alerts && !error && (
          <p className="flex items-center gap-2 py-3 text-sm text-brand-ink/55">
            <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
            Counting…
          </p>
        )}

        {alerts && waiting.length === 0 && (
          <Note>Nothing is waiting on you across the pipeline right now.</Note>
        )}

        {alerts && waiting.length > 0 && rows.length === 0 && (
          <Note>
            You cleared everything that was waiting. Recount to check the pipeline
            again, or a queue returns here by itself once its count grows.
          </Note>
        )}

        {rows.map((alert) => {
          const isUnseen = unseen.includes(alert);
          return (
            <div
              key={alert.id}
              className={cn(
                "group flex items-start gap-1 rounded-xl pr-1 transition hover:bg-white hover:shadow-soft",
                isUnseen && "bg-white/70"
              )}
            >
              <Link
                href={alert.href}
                transitionTypes={navForward}
                onClick={() => acknowledgeOneAlert(userId, alert, false)}
                className="flex min-w-0 flex-1 items-start gap-3 px-2.5 py-2"
              >
                <AlertCount alert={alert} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm leading-tight",
                      isUnseen
                        ? "font-bold text-brand-ink"
                        : "font-semibold text-brand-ink/70"
                    )}
                  >
                    {alert.label}
                  </span>
                  <span className="block text-[11px] leading-tight text-brand-ink/50">
                    {alert.detail}
                  </span>
                </span>
                {isUnseen && (
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-gold"
                    title="Unseen"
                    aria-label="Unseen"
                  />
                )}
              </Link>
              <button
                type="button"
                onClick={() => acknowledgeOneAlert(userId, alert, true)}
                aria-label={`Clear ${alert.label} from this list`}
                title="Clear this queue"
                className="mt-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-brand-ink/35 opacity-60 transition hover:bg-brand-sand hover:text-brand-ink group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}

        {cleared.length > 0 && (
          <div className="mt-3 border-t border-brand-line pt-2">
            <button
              type="button"
              onClick={() => setShowCleared((shown) => !shown)}
              aria-expanded={showCleared}
              className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-brand-ink/50 transition hover:text-brand-ink"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition", showCleared && "rotate-180")}
                aria-hidden
              />
              {cleared.length} cleared queue{cleared.length === 1 ? "" : "s"}
            </button>

            {showCleared && (
              <>
                {cleared.map((alert) => (
                  <Link
                    key={alert.id}
                    href={alert.href}
                    transitionTypes={navForward}
                    className="mt-1 flex items-start gap-3 rounded-xl px-2.5 py-1.5 opacity-70 transition hover:bg-white hover:opacity-100"
                  >
                    <AlertCount alert={alert} muted />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight text-brand-ink/60">
                        {alert.label}
                      </span>
                      <span className="block text-[11px] leading-tight text-brand-ink/45">
                        {alert.detail}
                      </span>
                    </span>
                  </Link>
                ))}
                <div className="mt-2">
                  <FeedAction
                    label="Bring them back"
                    note="Put the cleared queues back in the list."
                    disabled={false}
                    onClick={() => acknowledgeAlerts(userId, cleared, false)}
                  >
                    <Bell className="h-3.5 w-3.5" aria-hidden />
                  </FeedAction>
                </div>
              </>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-3 border-t border-brand-line pt-2 text-[11px] leading-relaxed text-brand-ink/45">
            Each row opens the page where that work is done, and counts are read
            live when this opens: when a queue empties, its row disappears. Read
            all and Clear all quiet the list in this browser, and a queue returns
            by itself as soon as its count grows past the number you saw.
          </p>
        )}
      </div>
    </PanelShell>
  );
}
