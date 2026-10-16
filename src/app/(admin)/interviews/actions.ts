"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";

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
 * Every interview in a +/- window around today.
 *
 * The window is fetched whole and sliced in the browser afterwards, so switching
 * between "today" and "next 30 days" costs no round trip. Bookings far outside
 * the window are rare enough that leaving them out of an agenda is acceptable —
 * the candidate drawer still lists them all.
 */
export async function getInterviewAgenda(
  input: { pastDays?: number; futureDays?: number } = {}
): Promise<AgendaInterview[]> {
  await requireStaff("/interviews");

  const supabase = await createSupabaseServerClient();
  const past = new Date(Date.now() - (input.pastDays ?? 30) * 86_400_000).toISOString();
  const future = new Date(Date.now() + (input.futureDays ?? 90) * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("interview_schedules")
    .select(AGENDA_SELECT)
    .gte("scheduled_at", past)
    .lte("scheduled_at", future)
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
    .filter((row) => row.application_id !== "");
}
