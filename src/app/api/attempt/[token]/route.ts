import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildPaper } from "@/modules/assessment/application/buildPaper";
import { getAttemptSettings } from "@/modules/assessment/application/attemptSettings";
import { isLinkExpired } from "@/modules/assessment/application/linkValidity";
import type { AttemptPayload } from "@/stores/useAssessmentStore";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: attempt, error } = await supabase
    .from("candidate_attempts")
    .select("*, applications!inner(full_name, job_openings(title))")
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  // Expiry enforcement — two different clocks. An IN_PROGRESS attempt runs out
  // of test time; a NOT_STARTED one runs out of *invitation* time, which is
  // Settings → Assessments → Link validity measured from when the link was
  // issued. Both park the attempt as EXPIRED so the runner shows one state.
  if (attempt.status === "IN_PROGRESS" && attempt.expires_at && new Date(attempt.expires_at) < new Date()) {
    await supabase
      .from("candidate_attempts")
      .update({ status: "EXPIRED" })
      .eq("id", attempt.id);
    attempt.status = "EXPIRED";
  }

  if (attempt.status === "NOT_STARTED") {
    // A recruiter's extension puts a deadline on the row; without one the
    // invitation window is measured from when the link was issued.
    const overdue = attempt.expires_at
      ? new Date(attempt.expires_at) < new Date()
      : await isLinkExpired(attempt.created_at);

    if (overdue) {
      await supabase
        .from("candidate_attempts")
        .update({ status: "EXPIRED" })
        .eq("id", attempt.id);
      attempt.status = "EXPIRED";
    }
  }

  // A closed link must not hand out the paper. Until this, an EXPIRED attempt
  // still loaded, and the runner's start step let the clock run anyway.
  if (attempt.status === "EXPIRED") {
    return NextResponse.json(
      {
        error:
          "This invitation is closed. If the recruitment team sent you a new link, use the most recent one.",
      },
      { status: 410 }
    );
  }

  const { data: template } = await supabase
    .from("assessment_templates")
    .select("name")
    .eq("id", attempt.template_id)
    .single();

  const { data: questions } = await supabase
    .from("assessment_questions")
    .select("*")
    .eq("template_id", attempt.template_id)
    .order("position", { ascending: true });

  const { data: responses } = await supabase
    .from("candidate_responses")
    .select("*")
    .eq("attempt_id", attempt.id);

  // Per-attempt paper: randomised question order and option order (stable
  // across refreshes because it is persisted on the attempt).
  const paper = await buildPaper(token);
  const questionOrder = paper?.questionOrder ?? [];
  const optionOrder = paper?.optionOrder ?? {};

  const byId = new Map((questions ?? []).map((q) => [q.id, q]));

  // Sanitize: strip correct-answer flags before exposing to candidates, and
  // apply this candidate's option order.
  const sanitize = (question: (typeof questions extends undefined ? never : NonNullable<typeof questions>)[number]) => {
    const config = {
      ...(question.config as AttemptPayload["questions"][number]["config"]),
    };

    if (config.options) {
      const order = optionOrder[question.id];
      const options = config.options.map((option) => ({
        label: option.label,
        text: option.text,
      }));
      config.options = order
        ? options.slice().sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
        : options;
    }

    if (config.expected_outputs) {
      config.expected_outputs = config.expected_outputs.map((output) => ({
        cell: output.cell,
        description: output.description,
      }));
    }

    return {
      id: question.id,
      question_type: question.question_type,
      title: question.title,
      prompt: question.prompt,
      config,
      points: question.points,
      position: question.position,
    } satisfies AttemptPayload["questions"][number];
  };

  const orderedIds =
    questionOrder.length > 0
      ? questionOrder
      : (questions ?? []).map((q) => q.id);

  const sanitizedQuestions: AttemptPayload["questions"] = orderedIds
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map(sanitize);

  const applicationRow = Array.isArray(attempt.applications) ? attempt.applications[0] : attempt.applications;
  const jobTitle = Array.isArray(applicationRow?.job_openings)
    ? applicationRow.job_openings[0]?.title
    : applicationRow?.job_openings?.title;

  const draft =
    attempt.status === "IN_PROGRESS" && (responses ?? []).length > 0
      ? {
          current_question_index: attempt.current_index_hint ?? 0,
          time_remaining_seconds: attempt.expires_at
            ? Math.max(
                0,
                Math.floor((new Date(attempt.expires_at).getTime() - Date.now()) / 1000)
              )
            : attempt.time_limit_minutes * 60,
          spreadsheet_data_map: Object.fromEntries(
            (responses ?? [])
              .filter((r) => r.spreadsheet_state)
              .map((r) => [r.question_id, r.spreadsheet_state as Record<string, { value: string | number | null }>])
          ),
          case_study_answers_map: Object.fromEntries(
            (responses ?? [])
              .filter((r) => r.answer_text)
              .map((r) => [r.question_id, r.answer_text as string])
          ),
          choice_answers_map: {},
          video_paths_map: Object.fromEntries(
            (responses ?? [])
              .filter((r) => r.video_path)
              .map((r) => [r.question_id, r.video_path as string])
          ),
        }
      : null;

  const payload: AttemptPayload = {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      time_limit_minutes: attempt.time_limit_minutes,
      expires_at: attempt.expires_at,
      submitted_at: attempt.submitted_at,
      draft_saved_at: attempt.draft_saved_at,
    },
    template_name: template?.name ?? "Assessment",
    application_name: applicationRow?.full_name ?? "Candidate",
    job_title: jobTitle ?? "",
    questions: sanitizedQuestions,
    draft,
    settings: await getAttemptSettings(),
  };

  return NextResponse.json(payload);
}
