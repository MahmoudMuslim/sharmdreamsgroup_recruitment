"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, Video } from "lucide-react";
import { Badge, Card, EmptyState } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { AgendaInterview } from "./actions";

type Range = "today" | "week" | "month" | "past";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Next 7 days" },
  { id: "month", label: "Next 30 days" },
  { id: "past", label: "Last 30 days" },
];

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "NO_SHOW") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

/** Local midnight, so a booking is grouped on the day the recruiter sees it. */
function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const thisDay = startOfDay(date);
  const offset = Math.round((thisDay - today) / 86_400_000);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Day-grouped interview agenda.
 *
 * Read-only by design: booking changes happen on the candidate's profile so a
 * slot, its notes and its history are edited in one place.
 */
export function InterviewAgenda({ interviews }: { interviews: AgendaInterview[] }) {
  const [range, setRange] = useState<Range>("week");

  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const within = (row: AgendaInterview) => {
      const day = startOfDay(new Date(row.scheduled_at));
      const offsetDays = Math.round((day - today) / 86_400_000);
      if (range === "past") return offsetDays < 0 && offsetDays >= -30;
      if (range === "today") return offsetDays === 0;
      if (range === "week") return offsetDays >= 0 && offsetDays <= 7;
      return offsetDays >= 0 && offsetDays <= 30;
    };

    const byDay = new Map<string, AgendaInterview[]>();
    for (const row of interviews.filter(within)) {
      const key = String(startOfDay(new Date(row.scheduled_at)));
      const bucket = byDay.get(key);
      if (bucket) bucket.push(row);
      else byDay.set(key, [row]);
    }

    return [...byDay.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, rows]) => ({
        label: dayLabel(rows[0].scheduled_at),
        rows: rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      }));
  }, [interviews, range]);

  const visible = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const pending = interviews.filter((row) => row.status === "SCHEDULED").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setRange(option.id)}
            className={cn(
              "rounded-xl border px-3.5 py-2 text-sm font-semibold transition",
              range === option.id
                ? "border-brand-ink bg-brand-ink text-brand-cream"
                : "border-brand-line bg-white hover:bg-brand-sand"
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-brand-ink/50">
          {visible} shown · {pending} awaiting an outcome
        </span>
      </div>

      {visible === 0 && (
        <Card>
          <EmptyState
            title="Nothing booked here"
            description="Interviews appear once they are scheduled from a candidate's profile."
            icon={<CalendarDays className="h-6 w-6" aria-hidden />}
          />
        </Card>
      )}

      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            {group.label}
          </h2>
          <div className="space-y-3">
            {group.rows.map((row) => (
              <Card key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 font-display text-base font-bold">
                        <Clock className="h-4 w-4 text-brand-gold-dark" aria-hidden />
                        {new Date(row.scheduled_at).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold">
                      <Link
                        href={`/candidates?c=${encodeURIComponent(row.tracking_code)}`}
                        className="hover:text-brand-gold-dark hover:underline"
                      >
                        {row.candidate_name}
                      </Link>
                      <span className="ml-1.5 text-xs font-normal text-brand-ink/45">
                        {row.tracking_code}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-brand-ink/60">
                      {row.job_title ?? "No role on file"} · {row.duration_minutes} min
                      {row.interviewer_name ? ` · ${row.interviewer_name}` : " · interviewer not assigned"}
                    </p>
                  </div>
                  {row.meeting_link && (
                    <a
                      href={row.meeting_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
                    >
                      <Video className="h-3.5 w-3.5" aria-hidden />
                      Join
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
