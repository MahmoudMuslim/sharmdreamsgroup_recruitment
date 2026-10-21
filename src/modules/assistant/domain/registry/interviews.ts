// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  INTERVIEW_OUTCOMES,
  ToolArgumentError,
  generateInterviewGuide,
  isoDateTime,
  num,
  optionalStr,
  report,
  rescheduleInterview,
  scheduleInterview,
  setInterviewStatus,
  str,
} from "./shared";

/* Interviews tools. */

export const interviews: readonly AssistantTool[] = [
  {
    name: "schedule_interview",
    label: "Booking an interview",
    description:
      "Book an interview for a candidate and tell them about it on the channels that are switched on. The interviewer is named from list_team.",
    args: {
      application_id: "string",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional, staff profile id from list_team",
    },
    run: async (args) =>
      report(
        await scheduleInterview({
          applicationId: str(args, "application_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
        })
      ),
  },
  {
    name: "reschedule_interview",
    label: "Moving an interview",
    description:
      "Change when an interview happens. The candidate is told it moved rather than re-invited.",
    args: {
      interview_id: "string — from list_interviews",
      scheduled_at: "string — ISO date-time",
      duration_minutes: "number",
      meeting_link: "string — optional",
      interviewer_profile_id: "string — optional",
    },
    run: async (args) =>
      report(
        await rescheduleInterview({
          interviewId: str(args, "interview_id"),
          scheduledAt: isoDateTime(args, "scheduled_at"),
          durationMinutes: num(args, "duration_minutes"),
          meetingLink: optionalStr(args, "meeting_link") ?? null,
          interviewerProfileId: optionalStr(args, "interviewer_profile_id") ?? null,
        })
      ),
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
