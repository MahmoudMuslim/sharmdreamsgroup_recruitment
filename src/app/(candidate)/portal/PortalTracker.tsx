"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Inbox,
  Mail,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  markPortalNoticesRead,
  trackApplication,
  type PortalNotice,
  type TrackedApplication,
} from "./actions";
import { STAGES, stageIndex } from "./stages";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import { cn } from "@/lib/utils";

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/**
 * Renders stored message text with links clickable.
 *
 * Bodies arrive as plain text from the templates, and an assessment invitation
 * without its link is useless, so URLs are split out into anchors instead of
 * injecting HTML — React escapes every other token.
 */
function renderLinkedText(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-gold-dark underline decoration-brand-gold/50 underline-offset-2"
      >
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

function nextStep(app: TrackedApplication): string {
  if (app.stage === "REJECTED") {
    return "Thank you for applying. After careful review we were not able to move forward with your application for this role. We appreciate the time you took, and we wish you every success in your search.";
  }
  if (app.stage === "HIRED") {
    return "Congratulations — our people team will be in touch about your offer.";
  }
  if (app.stage === "INTERVIEW") {
    return "Your interview is being scheduled. We will confirm the time and joining link with you.";
  }
  if (app.attempt && app.attempt.status === "SUBMITTED") {
    return "Your assessment was submitted and is now with the hiring team.";
  }
  if (app.attempt && app.attempt.status === "IN_PROGRESS") {
    const remaining = app.attempt.expires_at
      ? Math.floor((new Date(app.attempt.expires_at).getTime() - Date.now()) / 1000)
      : 0;
    return remaining > 0
      ? `Assessment in progress — ${formatDuration(remaining)} remaining.`
      : "Your assessment window has closed.";
  }
  if (app.attempt) {
    return "You have been invited to complete an assessment. Open your secure link below.";
  }
  return "Your application is with our screening team.";
}

function ApplicationCard({ app }: { app: TrackedApplication }) {
  const currentIndex = stageIndex(app.stage);
  const rejected = app.stage === "REJECTED";
  const progress = rejected ? 100 : ((currentIndex + 1) / STAGES.length) * 100;
  const actionable = Boolean(app.attempt) && app.attempt?.status !== "SUBMITTED";

  return (
    <article className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-soft transition hover:shadow-lift">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-mono text-brand-ink/40">{app.tracking_code}</span>
          {rejected ? (
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-bold uppercase tracking-wide text-rose-700">
              Not selected
            </span>
          ) : actionable ? (
            <span className="rounded-full bg-brand-gold/20 px-2.5 py-0.5 font-bold uppercase tracking-wide text-brand-gold-dark">
              Action needed
            </span>
          ) : (
            <span className="rounded-full bg-brand-sand px-2.5 py-0.5 font-bold uppercase tracking-wide text-brand-ink/60">
              In progress
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-brand-ink/40">
            <Clock className="h-3 w-3" aria-hidden />
            applied {relativeTime(app.created_at)}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-gold-dark">Hello, {app.full_name}</p>
            <h2 className="mt-0.5 font-display text-lg font-bold leading-snug sm:text-xl">
              {app.job_title ?? "Position under review"}
            </h2>
            {app.company_name && (
              <p className="mt-1 text-sm text-brand-ink/55">{app.company_name}</p>
            )}
          </div>

          {app.ai_match_score !== null && (
            <div className="shrink-0 sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                Match score
              </p>
              <p className="font-display text-2xl font-extrabold text-brand-gold-dark">
                {app.ai_match_score}%
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-cream px-4 py-3 text-sm leading-relaxed text-brand-ink/70">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" aria-hidden />
          {nextStep(app)}
        </p>

        {actionable && app.attempt && (
          <Link
            href={`/test/${app.attempt.access_token}`}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 py-3 text-sm font-bold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 sm:w-auto"
          >
            {app.attempt.status === "IN_PROGRESS" ? "Resume assessment" : "Start assessment"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}

        {app.attempt?.total_score !== null && app.attempt?.total_score !== undefined && (
          <p className="mt-3 rounded-xl border border-brand-line bg-white px-4 py-3 text-sm text-brand-ink/70">
            Assessment score:{" "}
            <strong className="font-display text-brand-ink">
              {app.attempt.total_score}
              {app.attempt.max_score ? ` / ${app.attempt.max_score}` : ""}
            </strong>
          </p>
        )}
      </div>

      <div className="border-t border-brand-line bg-brand-cream px-5 py-4 sm:px-6">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-brand-sand"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Application progress: ${STAGES[Math.max(currentIndex, 0)]?.label ?? "Unknown"}`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-700",
              rejected ? "bg-rose-400" : "bg-gradient-to-r from-brand-gold-dark to-brand-gold-light"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {STAGES.map((stage, index) => {
            const done = !rejected && index <= currentIndex;
            return (
              <li
                key={stage.key}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-semibold",
                  done ? "text-brand-ink" : "text-brand-ink/35"
                )}
              >
                {done && <CheckCircle2 className="h-3.5 w-3.5 text-brand-gold" aria-hidden />}
                {stage.label}
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}

/**
 * Notices the platform recorded for these applications on the in-app channel.
 *
 * The inbox is the channel that survives a filtered inbox or a dead WhatsApp
 * session, so it is rendered above the application cards. `read_at` is stamped
 * by the server on demand, keyed on the same tracking code as the lookup.
 */
function NoticeInbox({
  notices,
  applications,
  trackingCode,
}: {
  notices: PortalNotice[];
  applications: TrackedApplication[];
  trackingCode: string;
}) {
  const [pending, startTransition] = useTransition();
  const [read, setRead] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const unreadCount = notices.filter((n) => !n.read_at && !read.includes(n.id)).length;
  const multipleJobs = new Set(applications.map((app) => app.id)).size > 1;

  function jobLabel(applicationId: string) {
    return applications.find((app) => app.id === applicationId)?.job_title ?? null;
  }

  function markAllRead() {
    const code = trackingCode.trim();
    startTransition(async () => {
      const result = await markPortalNoticesRead(code);
      if (result.ok) setRead(notices.map((n) => n.id));
    });
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-brand-line bg-white shadow-soft">
      <header className="flex flex-wrap items-center gap-2 border-b border-brand-line bg-brand-cream px-5 py-3.5 sm:px-6">
        <Inbox className="h-4 w-4 text-brand-gold-dark" aria-hidden />
        <h2 className="text-sm font-bold">Messages from the hiring team</h2>
        {unreadCount > 0 && (
          <span className="rounded-full bg-brand-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-cream">
            {unreadCount} new
          </span>
        )}
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-60"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden />
            {pending ? "Marking…" : "Mark all read"}
          </button>
        )}
      </header>

      <ul className="divide-y divide-brand-line">
        {notices.map((notice) => {
          const isUnread = !notice.read_at && !read.includes(notice.id);
          const expanded = open === notice.id;
          const label = jobLabel(notice.application_id);
          return (
            <li key={notice.id} className="px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : notice.id)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-3 text-left"
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    isUnread ? "bg-brand-gold" : "bg-brand-line"
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      isUnread ? "font-bold text-brand-ink" : "font-semibold text-brand-ink/70"
                    )}
                  >
                    {notice.subject?.trim() || "An update on your application"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-brand-ink/45">
                    {relativeTime(notice.created_at)}
                    {isUnread && (
                      <span className="font-bold uppercase tracking-wide text-brand-gold-dark">New</span>
                    )}
                    {multipleJobs && label && <span>· {label}</span>}
                  </span>
                </span>
              </button>

              {expanded && (
                <p className="mt-3 whitespace-pre-line rounded-xl bg-brand-cream px-4 py-3 text-sm leading-relaxed text-brand-ink/75">
                  {renderLinkedText(notice.body)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Empty subscribe: the query string cannot change while this page is mounted, so
// there is nothing to watch. The snapshot functions exist to make the read
// hydration-safe — the server has no window, so it reports "" and the first
// client render matches, then React re-renders with the real value.
function subscribeToNothing() {
  return () => {};
}

function readCodeFromUrl() {
  return new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase() ?? "";
}

function readCodeOnServer() {
  return "";
}

/**
 * The tracking code passed in the URL, read without touching `searchParams`.
 *
 * Reading `searchParams` on the server would mark the whole portal request-time
 * under `cacheComponents: true`, costing every visitor a server render to save
 * one field's typing.
 */
function useCodeFromUrl(): string {
  return useSyncExternalStore(subscribeToNothing, readCodeFromUrl, readCodeOnServer);
}

export function PortalTracker({ supportEmail }: { supportEmail: string }) {
  const codeFromUrl = useCodeFromUrl();

  const [code, setCode] = useState("");
  const [results, setResults] = useState<TrackedApplication[] | null>(null);
  const [notices, setNotices] = useState<PortalNotice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lookedUp = useRef(false);

  function lookup(value: string) {
    setError(null);
    setResults(null);
    setNotices([]);

    startTransition(async () => {
      const result = await trackApplication(value);
      if (result.ok) {
        setResults(result.applications);
        setNotices(result.notices);
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCode(displayedCode);
    lookup(displayedCode);
  }

  // Run the lookup once when the careers confirmation hands us a code.
  useEffect(() => {
    if (!codeFromUrl || lookedUp.current) return;
    lookedUp.current = true;
    lookup(codeFromUrl);
  }, [codeFromUrl]);

  // The field shows the URL code until the candidate edits it themselves.
  const displayedCode = code || codeFromUrl;

  return (
    <main className="min-h-screen bg-brand-ivory text-brand-ink">
      <header className="border-b border-brand-line bg-brand-cream/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <SdgLockup />
          <Link
            href="/login"
            className="rounded-lg border border-brand-line bg-white px-3.5 py-2 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand sm:text-sm"
          >
            Staff sign-in
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-7">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark">
            Candidate portal
          </p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Track your application
          </h1>
          <p className="mt-2 text-brand-ink/60">
            Enter the tracking code you were given when you applied to see your current stage,
            assessment and next steps.
          </p>
        </header>

        <form onSubmit={submit} className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
          <label htmlFor="tracking" className="mb-1.5 block text-sm font-semibold">
            Tracking code
          </label>
          <p className="mb-3 text-xs text-brand-ink/50">
            Looks like <code className="rounded bg-brand-sand px-1 py-0.5 font-mono">SDG-ABC123-01234</code>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="tracking"
              value={displayedCode}
              onChange={(event) => setCode(event.target.value)}
              placeholder="SDG-FINANCE01"
              autoComplete="off"
              spellCheck={false}
              required
              className="w-full rounded-xl border border-brand-line bg-brand-cream px-4 py-3 font-mono text-sm uppercase text-brand-ink placeholder:normal-case placeholder:font-sans placeholder:text-brand-ink/35 focus:border-brand-gold focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-ink px-6 py-3 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:opacity-60"
            >
              <Search className="h-4 w-4" aria-hidden />
              {pending ? "Searching…" : "Track"}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </form>

        {results && results.length > 0 && (
          <div className="mt-6 space-y-5">
            {results.map((app) => (
              <ApplicationCard key={app.id} app={app} />
            ))}
          </div>
        )}

        {results && results.length > 0 && notices.length > 0 && (
          <NoticeInbox notices={notices} applications={results} trackingCode={displayedCode} />
        )}

        <div className="mt-8 rounded-2xl border border-brand-line bg-white p-6 text-center shadow-soft">
          <Mail className="mx-auto h-9 w-9 text-brand-gold" aria-hidden />
          <h2 className="mt-3 font-display text-lg font-bold">Need help?</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-ink/60">
            If your link has expired or you cannot find your tracking code, email the talent team
            and they will look it up for you.
          </p>
          <a
            href={`mailto:${supportEmail}`}
            className="mt-5 inline-block rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
          >
            {supportEmail}
          </a>
        </div>
      </div>
    </main>
  );
}