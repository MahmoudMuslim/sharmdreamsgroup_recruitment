"use client";

import { useState } from "react";
import {
  Laptop,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import { getAttemptIntegrity, type AttemptIntegrity } from "./integrity-actions";
import { INTEGRITY_LABELS } from "@/modules/assessment/domain/integrity";
import { Badge } from "@/modules/analytics/presentation/ui";

function severityTone(severity: string) {
  if (severity === "CRITICAL") return "danger" as const;
  if (severity === "WARN") return "gold" as const;
  return "neutral" as const;
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral" as const;
  if (score >= 85) return "success" as const;
  if (score >= 60) return "gold" as const;
  return "danger" as const;
}

/**
 * Recruiter-facing integrity report.
 *
 * Signals are advisory context, not a verdict — the copy makes that explicit so
 * nobody auto-rejects on a single tab switch.
 */
export function IntegrityPanel({
  accessToken,
  candidateName,
}: {
  accessToken: string;
  candidateName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AttemptIntegrity | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPanel() {
    setOpen(true);
    if (report || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAttemptIntegrity(accessToken);
      setReport(result);
    } catch {
      setError("Could not load the integrity report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openPanel()}
        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
      >
        <ShieldQuestion className="h-3 w-3" aria-hidden />
        Integrity
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="integrity-title"
        >
          <button
            type="button"
            aria-label="Close integrity report"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
          />

          <div className="relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-brand-line bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="integrity-title" className="font-display text-xl font-extrabold">
                  Assessment integrity
                </h2>
                <p className="mt-1 text-sm text-brand-ink/60">{candidateName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close integrity report"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-brand-ink/50">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading report…
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            )}

            {report && !loading && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Integrity
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.integrity_score ?? "—"}
                      {report.integrity_score !== null && (
                        <span className="text-sm text-brand-ink/40">/100</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Signals
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.integrity_flags}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Score
                    </p>
                    <p className="mt-1 font-display text-2xl font-extrabold">
                      {report.score ?? "—"}
                      {report.max_score ? (
                        <span className="text-sm text-brand-ink/40">/{report.max_score}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-cream p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-bold">{report.status}</p>
                  </div>
                </div>

                {report.events.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    No integrity signals recorded — the assessment was completed cleanly.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge tone={scoreTone(report.integrity_score)}>
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        Integrity {report.integrity_score ?? "?"}/100
                      </Badge>
                      <span className="text-xs text-brand-ink/45">
                        {report.events.length} event
                        {report.events.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <ul className="divide-y divide-brand-line rounded-xl border border-brand-line">
                      {report.events.map((event) => (
                        <li key={event.id} className="flex flex-wrap items-start gap-3 p-3">
                          <Badge tone={severityTone(event.severity)} className="shrink-0">
                            {event.severity}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">
                              {INTEGRITY_LABELS[event.event_type] ?? event.event_type}
                            </p>
                            <p className="text-xs text-brand-ink/55">
                              {new Date(event.occurred_at).toLocaleString()}
                              {event.question_title ? ` · ${event.question_title}` : ""}
                            </p>
                            {event.detail && (
                              <p className="mt-0.5 text-xs text-brand-ink/45">{event.detail}</p>
                            )}
                            {event.device_label && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-ink/40">
                                <Laptop className="h-3 w-3" aria-hidden />
                                {event.device_label}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <p className="rounded-xl bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/60">
                      These are signals for context, not a verdict. We record only that an
                      action happened — never keystrokes, screen content or pasted text.
                      Weigh them with the candidate&rsquo;s answers before deciding.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}