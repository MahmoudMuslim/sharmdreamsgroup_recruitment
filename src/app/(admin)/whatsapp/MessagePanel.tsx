"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { Badge, Card, EmptyState, FilterRail, StatTile } from "@/modules/analytics/presentation/ui";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";
import { resendEmailMessage, type OutboxResult } from "./actions";
import type { EmailFlags, EmailLogRow, NoticeRow } from "./outbox-model";

const DATE_TIME = new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "short" });

function stamp(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date);
}

type StatusFilter = "ALL" | "DELIVERED" | "FAILED";
type UnreadFilter = "ALL" | "UNREAD" | "READ";

/**
 * Email and portal notices — the two channels that send as the event happens.
 *
 * Unlike WhatsApp there is no queue to manage: an email is handed to the relay
 * inside the action that changed the candidate's stage, and a notice is written
 * to the candidate's inbox. So this panel is a history with one recovery move —
 * re-send an email the relay refused.
 */
export function MessagePanel({
  emails,
  notices,
  flags,
  canManage,
}: {
  emails: EmailLogRow[];
  notices: NoticeRow[];
  flags: EmailFlags;
  canManage: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"email" | "notice">("email");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [readState, setReadState] = useState<UnreadFilter>("ALL");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const deliveredCount = emails.filter((row) => row.delivered).length;
  const failedCount = emails.length - deliveredCount;
  const unreadCount = notices.filter((row) => !row.read_at).length;

  const needle = query.trim().toLowerCase();

  const visibleEmails = useMemo(
    () =>
      emails.filter((row) => {
        if (status === "DELIVERED" && !row.delivered) return false;
        if (status === "FAILED" && row.delivered) return false;
        if (!needle) return true;
        return (
          row.recipient.toLowerCase().includes(needle) ||
          row.candidate_name?.toLowerCase().includes(needle) ||
          row.subject?.toLowerCase().includes(needle) ||
          row.body.toLowerCase().includes(needle)
        );
      }),
    [emails, status, needle]
  );

  const visibleNotices = useMemo(
    () =>
      notices.filter((row) => {
        if (readState === "UNREAD" && row.read_at) return false;
        if (readState === "READ" && !row.read_at) return false;
        if (!needle) return true;
        return (
          row.candidate_name?.toLowerCase().includes(needle) ||
          row.subject?.toLowerCase().includes(needle) ||
          row.body.toLowerCase().includes(needle)
        );
      }),
    [notices, readState, needle]
  );

  function retry(row: EmailLogRow) {
    setPending(row.id);
    setNotice(null);
    void (async () => {
      const result: OutboxResult = await resendEmailMessage(row.id);
      setPending(null);
      if (result.ok) {
        setNotice({ kind: "ok", text: `Sent to ${row.recipient}.` });
        router.refresh();
      } else {
        setNotice({ kind: "error", text: result.error ?? "The relay refused this message." });
      }
    })();
  }

  const relayHint = flags.smtpConfigured
    ? "The relay has all four settings, which is not the same as working — Settings → API keys → Email (SMTP) → Test shows whether the account accepts them."
    : `SMTP relay is missing: ${flags.smtpMissing.join(", ") || "credentials"} (Settings → API keys).`;

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-4 border-b border-brand-line bg-brand-cream/60 p-4 sm:p-5 lg:grid-cols-4">
        <StatTile
          label="Emails delivered"
          value={deliveredCount}
          hint={flags.emailEnabled ? "Accepted by the relay" : "Email channel is off"}
          icon={<Send className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Emails failed"
          value={failedCount}
          hint="Refused by the relay — retry below"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Portal notices"
          value={notices.length}
          hint="Written to the candidate portal"
          icon={<Inbox className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Still unread"
          value={unreadCount}
          hint="No candidate has opened them"
          icon={<Mail className="h-5 w-5" aria-hidden />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
        {(
          [
            { key: "email", label: `Email (${emails.length})`, icon: Mail },
            { key: "notice", label: `Portal notices (${notices.length})`, icon: Inbox },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-selected={tab === key}
            role="tab"
            onClick={() => {
              setTab(key);
              setExpanded(null);
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

        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-brand-ink/35" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={tab === "email" ? "Search emails" : "Search portal notices"}
            placeholder="Search candidate, address or copy…"
            className="w-full rounded-xl border border-brand-line bg-brand-cream py-2 pl-9 pr-8 text-sm focus:border-brand-gold focus:bg-white focus:outline-none"
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
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5">
        {tab === "email" ? (
          (
            [
              { key: "ALL", label: "All", count: emails.length },
              { key: "DELIVERED", label: "Delivered", count: deliveredCount },
              { key: "FAILED", label: "Failed", count: failedCount },
            ] as const
          ).map((option) => (
            <FilterRail
              key={option.key}
              label={option.label}
              count={option.count}
              tone={option.key === "FAILED" ? "muted" : "solid"}
              active={status === option.key}
              onClick={() => setStatus(status === option.key ? "ALL" : option.key)}
            />
          ))
        ) : (
          (
            [
              { key: "ALL", label: "All", count: notices.length },
              { key: "UNREAD", label: "Unread", count: unreadCount },
              { key: "READ", label: "Read", count: notices.length - unreadCount },
            ] as const
          ).map((option) => (
            <FilterRail
              key={option.key}
              label={option.label}
              count={option.count}
              tone={option.key === "UNREAD" ? "muted" : "solid"}
              active={readState === option.key}
              onClick={() => setReadState(readState === option.key ? "ALL" : option.key)}
            />
          ))
        )}
      </div>

      {notice && (
        <div className="px-4 pt-3 sm:px-5">
          <FormMessage
            error={notice.kind === "error" ? notice.text : null}
            success={notice.kind === "ok" ? notice.text : null}
          />
        </div>
      )}

      <div className="space-y-3 p-4 sm:p-5">
        {tab === "email" ? (
          visibleEmails.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" aria-hidden />}
              title={emails.length === 0 ? "No emails sent yet" : "No email matches this view"}
              description={
                emails.length === 0
                  ? "Stage changes and interview bookings mail the candidate the copy under Settings → Access & comms → Email, and every attempt lands here."
                  : "Try another status or clear the search."
              }
            />
          ) : (
            visibleEmails.map((row) => {
              const open = expanded === row.id;
              return (
                <div key={row.id} className="rounded-xl border border-brand-line bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {row.subject?.trim() || "An update on your application"}
                        <Badge tone={row.delivered ? "success" : "danger"}>
                          {row.delivered ? "Delivered" : "Failed"}
                        </Badge>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-ink/55">
                        <span className="font-mono">{row.recipient}</span>
                        {row.candidate_name && <span>{row.candidate_name}</span>}
                        {row.job_title && <span className="truncate">{row.job_title}</span>}
                        <span suppressHydrationWarning>{stamp(row.created_at)}</span>
                      </p>
                    </div>
                    {canManage && !row.delivered && (
                      <button
                        type="button"
                        onClick={() => retry(row)}
                        disabled={pending !== null}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {pending === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {pending === row.id ? "Sending…" : "Retry"}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : row.id)}
                    aria-expanded={open}
                    className="mt-3 w-full rounded-xl border border-brand-line bg-brand-cream/60 px-3.5 py-2.5 text-left transition hover:bg-brand-cream"
                  >
                    <span className="flex items-start gap-2">
                      {open ? (
                        <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
                      ) : (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink/40" aria-hidden />
                      )}
                      <span
                        className={cn(
                          "whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/80",
                          !open && "line-clamp-2"
                        )}
                      >
                        {row.body || "This message has no body."}
                      </span>
                    </span>
                  </button>

                  {row.error_message && (
                    <p className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{row.error_message}</span>
                    </p>
                  )}
                </div>
              );
            })
          )
        ) : visibleNotices.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" aria-hidden />}
            title={notices.length === 0 ? "No portal notices yet" : "No notice matches this view"}
            description={
              notices.length === 0
                ? "Every alert also lands in the candidate's portal inbox, so a filtered email is never the only copy."
                : "Try another status or clear the search."
            }
          />
        ) : (
          visibleNotices.map((row) => {
            const open = expanded === row.id;
            return (
              <div key={row.id} className="rounded-xl border border-brand-line bg-white p-4">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.id)}
                  aria-expanded={open}
                  className="w-full text-left"
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {row.subject?.trim() || "An update on your application"}
                    {row.read_at ? (
                      <Badge tone="neutral">
                        <Check className="mr-1 h-3 w-3" aria-hidden />
                        Read
                      </Badge>
                    ) : (
                      <Badge tone="gold">Unread</Badge>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-ink/55">
                    <span>{row.candidate_name ?? "Candidate no longer in the pipeline"}</span>
                    <span suppressHydrationWarning>
                      sent {stamp(row.created_at)}
                      {row.read_at ? ` · opened ${stamp(row.read_at)}` : ""}
                    </span>
                  </span>
                </button>

                {open && (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-brand-cream px-3.5 py-2.5 text-sm leading-relaxed text-brand-ink/80">
                    {row.body || "This notice has no body."}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2 border-t border-brand-line bg-brand-cream/60 px-4 py-4 text-sm leading-relaxed text-brand-ink/65 sm:px-5">
        <p className="flex items-center gap-2 font-semibold text-brand-ink">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              flags.emailEnabled && flags.smtpConfigured ? "bg-emerald-500" : "bg-rose-400"
            )}
            aria-hidden
          />
          Email {flags.emailEnabled ? "channel is on" : "channel is off"} ·{" "}
          {flags.smtpConfigured ? "relay settings present" : "relay settings incomplete"}
        </p>
        <p className="text-xs text-brand-ink/60">{relayHint}</p>
        <p className="flex items-center gap-2 text-xs text-brand-ink/60">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", flags.inAppEnabled ? "bg-emerald-500" : "bg-rose-400")}
            aria-hidden
          />
          Portal notices are {flags.inAppEnabled ? "being written" : "switched off"} — the candidate reads them at
          the tracking link they were given.
        </p>
        <p className="text-xs text-brand-ink/60">
          Email sends the moment a stage or interview changes, so there is no queue here. Retry re-sends a failed
          message from the copy stored on this row; a delivered email can never be re-sent, so a candidate is never
          mailed twice by an admin click.
        </p>
        {!canManage && (
          <p className="rounded-xl border border-brand-line bg-white px-3.5 py-2.5 text-xs text-brand-ink/60">
            You can see these sends but not retry them — that needs the Send messages permission.
          </p>
        )}
      </div>
    </Card>
  );
}
