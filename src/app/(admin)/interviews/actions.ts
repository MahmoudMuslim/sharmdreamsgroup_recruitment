"use server";

import { createSupabaseServerClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import {
  agendaWindow,
  AGENDA_APPLICATION_EMBED,
  PENDING_INTERVIEW_STATUS,
} from "./agenda-model";

export interface AgendaInterview {
  id: string;
  application_id: string;
  tracking_code: string;
  candidate_name: string;
  job_title: string | null;
  interviewer_name: string | null;
  scheduled_at: string;
  duration_minutes: number;
  meeting_link: string | null;
  status: string;
  /** The id as well as the name, so the agenda's editor can pre-select the panel. */
  interviewer_profile_id: string | null;
}

const AGENDA_SELECT = `
  id,
  scheduled_at,
  duration_minutes,
  status,
  meeting_link,
  interviewer_profile_id,
  applications (
    id,
    full_name,
    tracking_code,
    job_openings ( title )
  ),
  user_profiles ( full_name )
`;

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

/**
 * Every interview in the agenda window around today.
 *
 * The window is fetched whole and sliced in the browser afterwards, so switching
 * between "today" and "next 90 days" costs no round trip. Its bounds come from
 * `agenda-model`, which the app bar's interview alert reads too, so the number on
 * that row and the widest range here are one set. The two day counts can still be
 * widened by a caller — the assistant uses that to answer "what is booked next
 * quarter" — but the page and the alert never pass them.
 */
export async function getInterviewAgenda(
  input: { pastDays?: number; futureDays?: number } = {}
): Promise<AgendaInterview[]> {
  await requireStaff("/interviews");

  const supabase = await createSupabaseServerClient();
  const agenda = agendaWindow(new Date(), input.pastDays, input.futureDays);

  const { data, error } = await supabase
    .from("interview_schedules")
    .select(AGENDA_SELECT)
    .gte("scheduled_at", agenda.past)
    .lte("scheduled_at", agenda.future)
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error("[interviews] agenda query failed:", error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const application = nested<{
        id: string;
        full_name: string;
        tracking_code: string;
        job_openings?: { title?: string } | { title?: string }[] | null;
      }>(row.applications);
      const job = nested<{ title?: string }>(application?.job_openings);
      const interviewer = nested<{ full_name?: string }>(row.user_profiles);

      return {
        id: String(row.id),
        application_id: application?.id ?? "",
        tracking_code: application?.tracking_code ?? "",
        candidate_name: application?.full_name ?? "Unknown candidate",
        job_title: job?.title ?? null,
        interviewer_name: interviewer?.full_name ?? null,
        scheduled_at: String(row.scheduled_at),
        duration_minutes: Number(row.duration_minutes),
        meeting_link: (row.meeting_link as string | null) ?? null,
        status: String(row.status ?? "SCHEDULED"),
        interviewer_profile_id: (row.interviewer_profile_id as string | null) ?? null,
      };
    })
    // A panel whose candidate the reader cannot see is not something they can
    // move, so it is left out — and the interview alert counts with the same
    // requirement on the database side (`AGENDA_APPLICATION_EMBED`) so the number
    // on that row can never describe a panel this list refuses to show.
    .filter((row) => row.application_id !== "");
}

/**
 * Panels awaiting an outcome that fall outside the agenda window, on each edge.
 *
 * A window is a promise with two edges, so the page names what it cannot show:
 * `ahead` is booked beyond the horizon, `overdue` is a slot further back than the
 * agenda reads that nobody ever marked completed, cancelled or a no-show. Both
 * are counted on the status the "awaiting an outcome" chip filters to.
 */
export async function countInterviewsOutsideAgenda(): Promise<{
  ahead: number;
  overdue: number;
}> {
  await requireStaff("/interviews");

  const supabase = await createSupabaseServerClient();
  const { past, future } = agendaWindow();

  const [ahead, overdue] = await Promise.all([
    supabase
      .from("interview_schedules")
      .select(`id, ${AGENDA_APPLICATION_EMBED}`, { count: "exact", head: true })
      .eq("status", PENDING_INTERVIEW_STATUS)
      .gt("scheduled_at", future),
    supabase
      .from("interview_schedules")
      .select(`id, ${AGENDA_APPLICATION_EMBED}`, { count: "exact", head: true })
      .eq("status", PENDING_INTERVIEW_STATUS)
      .lt("scheduled_at", past),
  ]);

  for (const edge of [ahead, overdue]) {
    if (edge.error) {
      console.error("[interviews] window edge count failed:", edge.error.message);
    }
  }

  return { ahead: ahead.count ?? 0, overdue: overdue.count ?? 0 };
}
