import { getSupabaseAnonClient } from "@/lib/supabase/anon";
import { parseGateRows, publicGateQuestions } from "@/modules/careers/gate-questions";

/**
 * Public viability questions for one open role.
 *
 * A route handler rather than part of the job page because `/careers/[id]` is
 * prerendered at build time and its job payload is cached — questions served
 * from either would sit stale for a full cache window after a recruiter edited
 * them. Fetched on the client instead, so a newly authored question appears on
 * refresh rather than after a redeploy.
 *
 * Read with the anon key, so RLS decides what is visible: `gate_questions_public_read`
 * exposes active rows only. `is_active` is filtered here as well, because the
 * query should state what it means rather than rely on a policy alone.
 *
 * The response carries question text and option labels. Which label the role
 * accepts stays server-side — see `parseGateRows` in the domain module.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A form only ever needs a readable handful; more would be a misconfigured job. */
const MAX_QUESTIONS = 20;

export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";

  if (!UUID.test(jobId)) {
    return Response.json({ error: "Unknown role." }, { status: 400 });
  }

  const supabase = getSupabaseAnonClient();

  // Same re-check the CV upload makes: a draft or closed role has no form.
  const { data: job } = await supabase
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!job) {
    return Response.json({ error: "This role is not accepting applications." }, { status: 404 });
  }

  // Job-scoped questions plus the ones asked for every role. The id is a
  // validated UUID, so building the OR filter cannot inject a condition.
  const { data, error } = await supabase
    .from("application_gate_questions")
    .select("id, job_id, question, help_text, options, position, is_active")
    .eq("is_active", true)
    .or(`job_id.is.null,job_id.eq.${jobId}`)
    .order("position", { ascending: true })
    .limit(MAX_QUESTIONS);

  if (error) {
    console.error("[careers] gate questions refused:", error.message);
    return Response.json(
      { error: "The application questions are unavailable right now." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return Response.json(
    { questions: publicGateQuestions(parseGateRows(rows)) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
