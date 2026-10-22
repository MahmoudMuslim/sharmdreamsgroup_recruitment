// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  INTERVIEW_OUTCOMES,
  INTERVIEW_ROUNDS,
  ToolArgumentError,
  clip,
  generateInterviewGuide,
  getInterviewScorecardLayer,
  isoDateTime,
  num,
  optionalChoice,
  optionalStr,
  panelAverage,
  report,
  rescheduleInterview,
  roundLabel,
  saveInterviewScorecard,
  scheduleInterview,
  scorecardAverage,
  scorecardsFor,
  setInterviewStatus,
  str,
} from "./shared";

/* Interviews tools. */

export const interviews: readonly AssistantTool[] = [
  {
    name: "schedule_interview",
    label: "Booking an interview",
    description:
      "Book an interview for a candidate and tell them about it on the channels that are switched on. The interviewer is named from list_team, and `round` files the panel under one of the four stages. The round is only written when the database has migration 032 applied; until then a booked panel simply has no round.",
    args: {
      application_id: "string",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional, staff profile id from list_team",
      round: `string — optional, one of ${INTERVIEW_ROUNDS.join(", ")}`,
    },
    run: async (args) =>
      report(
        await scheduleInterview({
          applicationId: str(args, "application_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
          round: optionalChoice(args, "round", INTERVIEW_ROUNDS),
        })
      ),
  },
  {
    name: "reschedule_interview",
    label: "Moving an interview",
    description:
      "Change when an interview happens. The candidate is told it moved rather than re-invited. Omit `round` to leave the panel's round exactly as it is; naming one moves it to that stage.",
    args: {
      interview_id: "string — from list_interviews",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional",
      round: `string — optional, one of ${INTERVIEW_ROUNDS.join(", ")}`,
    },
    run: async (args) => {
      const round = optionalChoice(args, "round", INTERVIEW_ROUNDS);
      return report(
        await rescheduleInterview({
          interviewId: str(args, "interview_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
          // Absent means "same round, new time" — never a silent clear.
          ...(round !== null ? { round } : {}),
        })
      );
    },
  },
  {
    name: "set_interview_status",
    label: "Recording an interview outcome",
    description:
      "Mark an interview COMPLETED or NO_SHOW, or CANCELLED it. Only a cancellation messages the candidate, and it carries no internal reason.",
    args: {
      interview_id: "string — from list_interviews",
      status: "string — COMPLETED, NO_SHOW or CANCELLED",
    },
    run: async (args) => {
      const status = str(args, "status").toUpperCase();
      if (!INTERVIEW_OUTCOMES.includes(status as (typeof INTERVIEW_OUTCOMES)[number])) {
        throw new ToolArgumentError('"status" must be COMPLETED, NO_SHOW or CANCELLED.');
      }
      return report(
        await setInterviewStatus({
          interviewId: str(args, "interview_id"),
          status: status as (typeof INTERVIEW_OUTCOMES)[number],
        })
      );
    },
  },
  {
    name: "read_interview_scorecards",
    label: "Reading interview scorecards",
    description:
      "What the panel actually thought of one interview: each interviewer's marks for technical, communication, problem solving and culture (1 to 5), their written feedback and when they wrote it, plus the panel's average and the round it is filed under. Marks are kept per interviewer and never collapsed into one stored figure. Read `schema_note` before saying nobody scored it: it names db/migrations/032_interview_scorecards.sql when the database has no scorecards at all. The interview id comes from list_interviews.",
    args: { interview_id: "string — from list_interviews" },
    run: async (args) => {
      const interviewId = str(args, "interview_id");
      const layer = await getInterviewScorecardLayer([interviewId]);
      // A valid id that the schedule table does not hold is a mistake to say out
      // loud, not an empty panel to describe as unscored.
      if (layer.roundsAvailable && !layer.foundIds.includes(interviewId)) {
        return { ok: false, error: "No interview has that id — take one from list_interviews." };
      }

      const cards = scorecardsFor(layer, interviewId);
      return {
        ok: true,
        interview_id: interviewId,
        round: layer.roundsAvailable ? roundLabel(layer.rounds[interviewId]) : null,
        rounds_available: layer.roundsAvailable,
        scorecards_available: layer.scorecardsAvailable,
        schema_note: layer.note,
        count: cards.length,
        panel_average: panelAverage(cards),
        scorecards: cards.map((card) => ({
          author: card.authorName ?? "a former staff member",
          technical: card.technical,
          communication: card.communication,
          problem_solving: card.problemSolving,
          culture: card.culture,
          average: Math.round((scorecardAverage(card) ?? 0) * 10) / 10,
          feedback: clip(card.feedback, 800),
          written_at: card.updatedAt,
        })),
      };
    },
  },
  {
    name: "save_interview_scorecard",
    label: "Writing an interview scorecard",
    description:
      "Record the signed-in recruiter's own scorecard on a panel: four whole-number marks from 1 to 5 for technical, communication, problem solving and culture, plus optional written feedback. Each interviewer keeps their own row, so a second save edits this recruiter's scorecard instead of adding another. Refused on a cancelled panel or a no-show, and impossible until db/migrations/032_interview_scorecards.sql is applied — the refusal says so. The candidate never sees a scorecard.",
    args: {
      interview_id: "string — from list_interviews",
      technical: "number — whole number 1 to 5",
      communication: "number — whole number 1 to 5",
      problem_solving: "number — whole number 1 to 5",
      culture: "number — whole number 1 to 5",
      feedback: "string — optional, what convinced you and what worried you",
    },
    run: async (args) =>
      report(
        await saveInterviewScorecard({
          interviewId: str(args, "interview_id"),
          technical: num(args, "technical"),
          communication: num(args, "communication"),
          problemSolving: num(args, "problem_solving"),
          culture: num(args, "culture"),
          feedback: optionalStr(args, "feedback") ?? null,
        })
      ),
  },
  {
    name: "draft_interview_guide",
    label: "Drafting interview questions",
    description:
      "Write a question set for one candidate from what AI screening found and what they wrote in their assessment. Needs the ai.interview_questions switch on, and nothing is stored — the guide lives in this conversation.",
    args: { application_id: "string" },
    run: async (args) => {
      const guide = await generateInterviewGuide({ applicationId: str(args, "application_id") });
      return {
        ok: guide.ok !== false,
        error: guide.error,
        questions: guide.questions ?? null,
        stored: false,
        note: "Nothing was written to the record — this is a draft for the recruiter to use.",
      };
    },
  },

];
