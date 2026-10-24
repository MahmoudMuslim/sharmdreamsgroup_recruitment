import { getServiceRestClient } from "@/lib/data-api/service";
import { buildPaper } from "@/modules/assessment/application/buildPaper";
import { getAttemptSettings } from "@/modules/assessment/application/attemptSettings";
import { isLinkExpired } from "@/modules/assessment/application/linkValidity";
import { recordActivity } from "@/modules/activity/application/record";
import { attemptContext, runnerActor } from "@/modules/assessment/application/runner-trail";
import { splitCodingAnswers } from "@/modules/assessment/domain/coding";
import type { AttemptPayload } from "@/stores/useAssessmentStore";
import type { QuestionConfig } from "@/types";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const restClient = getServiceRestClient();

  const { data: attempt, error } = await restClient
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
  let closedBy: "test_time" | "invitation" | null = null;

  if (attempt.status === "IN_PROGRESS" && attempt.expires_at && new Date(attempt.expires_at) < new Date()) {
    await restClient
      .from("candidate_attempts")
      .update({ status: "EXPIRED" })
      .eq("id", attempt.id);
    attempt.status = "EXPIRED";
    closedBy = "test_time";
  }

  if (attempt.status === "NOT_STARTED") {
    // A recruiter's extension puts a deadline on the row; without one the
    // invitation window is measured from when the link was issued.
    const overdue = attempt.expires_at
      ? new Date(attempt.expires_at) < new Date()
      : await isLinkExpired(attempt.created_at);

    if (overdue) {
      await restClient
        .from("candidate_attempts")
        .update({ status: "EXPIRED" })
        .eq("id", attempt.id);
      attempt.status = "EXPIRED";
      closedBy = "invitation";
    }
  }

  if (closedBy) {
    const { candidateName, jobTitle } = attemptContext(attempt);
    await recordActivity({
      ...runnerActor(candidateName),
      area: "assessments",
      action: "attempt_expired",
      entity: "attempt",
      entityId: attempt.id,
      summary: `${candidateName}'s ${jobTitle} test closed when they opened it — out of ${closedBy === "test_time" ? "the time the test allows" : "the invitation window"}`,
      detail: {
        from: closedBy === "test_time" ? "IN_PROGRESS" : "NOT_STARTED",
        to: "EXPIRED",
        deadline: attempt.expires_at ?? null,
      },
    });
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

  const { data: template } = await restClient
    .from("assessment_templates")
    .select("name")
    .eq("id", attempt.template_id)
    .single();

  const { data: questions } = await restClient
    .from("assessment_questions")
    .select("*")
    .eq("template_id", attempt.template_id)
    .order("position", { ascending: true });

  const { data: responses } = await restClient
    .from("candidate_responses")
    .select("*")
    .eq("attempt_id", attempt.id);

  // Per-attempt paper: randomised question order and option order (stable
  // across refreshes because it is persisted on the attempt).
  const paper = await buildPaper(token);
  const questionOrder = paper?.questionOrder ?? [];
  const optionOrder = paper?.optionOrder ?? {};

  const byId = new Map((questions ?? []).map((q) => [q.id, q]));

  // Sanitize: rebuild the candidate's copy from the keys the runner reads.
  //
  // This column holds the marking scheme, not only the question, so a spread
  // hands out whatever the author form grows next. Correct-answer flags, a cell
  // formula hint and a rubric's criteria and weights all live beside the text a
  // candidate needs, and the ones we knew about were deleted one at a time. The
  // payload type is the allow-list: a config key not named here stays behind
  // the server, which is the only guarantee that survives the next field.
  const sanitize = (question: (typeof questions extends undefined ? never : NonNullable<typeof questions>)[number]) => {
    const source = (question.config ?? {}) as QuestionConfig;
    const config: AttemptPayload["questions"][number]["config"] = {};

    if (source.initial_sheet) config.initial_sheet = source.initial_sheet;
    if (source.context) config.context = source.context;
    if (source.min_words) config.min_words = source.min_words;
    if (source.min_duration_seconds) config.min_duration_seconds = source.min_duration_seconds;
    if (source.max_duration_seconds) config.max_duration_seconds = source.max_duration_seconds;

    if (source.options) {
      const order = optionOrder[question.id];
      const options = source.options.map((option) => ({
        label: option.label,
        text: option.text,
      }));
      config.options = order
        ? options.slice().sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
        : options;
    }

    if (source.expected_outputs) {
      config.expected_outputs = source.expected_outputs.map((output) => ({
        cell: output.cell,
        description: output.description,
      }));
    }

    if (source.language) config.language = source.language;
    if (source.starter_code) config.starter_code = source.starter_code;

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

  const answeredWritten = Object.fromEntries(
    (responses ?? [])
      .filter((r) => r.answer_text)
      .map((r) => [r.question_id, r.answer_text as string])
  );
  const split = splitCodingAnswers(
    answeredWritten,
    new Map(sanitizedQuestions.map((question) => [question.id, question.question_type] as const))
  );

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
          case_study_answers_map: split.cases,
          code_answers_map: split.code,
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
