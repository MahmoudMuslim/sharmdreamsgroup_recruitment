import { PIPELINE_STAGES, APPLICATION_SOURCES } from "@/modules/candidates/domain/listFilters";
import { JOB_STATUSES } from "@/modules/jobs/domain/hireable";
import { PROSPECT_STAGES } from "@/app/(admin)/sourcing/pool-model";
import type { ToolArgs } from "./tools";

/**
 * Where a finished tool action leaves the recruiter.
 *
 * The chat is a dock over the screen the recruiter was already on, so a change
 * made from it has to be inspectable on its own page. Each link points at the
 * real admin route for the record the tool just touched. Only jobs, candidates,
 * sourcing, dashboard and settings open a specific record from the query
 * string; everywhere else the link is the plain page, because that is the page
 * that will actually show the change.
 *
 * Read tools get a link too when the answer is a single record — "show me" is
 * the natural next question after the assistant reports one.
 */

export interface AssistantLink {
  href: string;
  label: string;
}

/** Only ids that look like ids are put into a URL. */
function token(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(trimmed) ? trimmed : null;
}

function fromArgs(args: ToolArgs, key: string): string | null {
  return token(args[key]);
}

function firstFromArgs(args: ToolArgs, key: string): string | null {
  const list = args[key];
  if (!Array.isArray(list)) return null;
  return token(list[0]);
}

/**
 * A filter value the page will accept.
 *
 * The rails read their own query parameters, so a click-through can land on the
 * same set the answer described — but only with a value the page's validator
 * keeps. Anything else is dropped here rather than sent, because a parameter a
 * page ignores makes the link look filtered while the table shows everything.
 */
function named(value: unknown, words: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return words.includes(upper) ? upper : null;
}

/** The query for whichever of these pairs survived. */
function query(pairs: [string, string | null][]): string {
  const kept = pairs.filter((pair): pair is [string, string] => pair[1] !== null);
  return kept.length === 0 ? "" : `?${new URLSearchParams(kept).toString()}`;
}

/**
 * Search words, kept as the page would type them.
 *
 * Both tables seed their search box from `?q=`, so a click-through can land on
 * the rows the answer just named — but only when there are words to carry, and
 * an argument that is only whitespace must drop out rather than send `?q=`.
 */
function words(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The id an action created or changed, when the action reported one. */
function fromResult(result: unknown, args: ToolArgs, key: string): string | null {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if (record.ok === false) return null;
    const created = token(record.id);
    if (created) return created;
  }
  return fromArgs(args, key);
}

const JOB_VIEW: AssistantLink = { href: "/jobs", label: "View the opening" };

/**
 * Screens that open the exact record from the query string. Every other admin
 * page ignores one, so a link there is written bare rather than dressed with a
 * parameter that would be dropped.
 */
function candidate(id: string): AssistantLink {
  return { href: `/candidates?application=${id}`, label: "Open the dossier" };
}

function prospect(id: string): AssistantLink {
  return { href: `/sourcing?prospect=${id}`, label: "View the prospect" };
}

export function linkForTool(
  name: string,
  args: ToolArgs,
  result: unknown
): AssistantLink | null {
  const applicationId = fromArgs(args, "application_id");

  switch (name) {
    case "create_job":
    case "update_job": {
      const id = fromResult(result, args, "job_id");
      return id ? { href: `/jobs?job=${id}`, label: "View the opening" } : null;
    }
    case "set_job_status":
    case "get_job":
    case "get_job_applicants": {
      const id = fromArgs(args, "job_id");
      return id ? { href: `/jobs?job=${id}`, label: JOB_VIEW.label } : null;
    }
    case "record_candidate": {
      // A create reports its id nested under `candidate`, where `fromResult`
      // would not look, and there is no application_id argument to fall back on.
      const created = (result as { candidate?: { id?: unknown } } | null)?.candidate?.id;
      const id = token(created);
      return id ? candidate(id) : null;
    }
    case "screen_candidate":
    case "draft_candidate_feedback":
    case "set_candidate_stage":
    case "get_application":
    case "get_candidate_dossier":
    case "draft_interview_guide":
    case "schedule_interview":
    case "edit_candidate_contact":
    case "read_candidate_cv":
    case "set_candidate_archive":
      return applicationId ? candidate(applicationId) : null;
    case "assign_assessment": {
      const id = firstFromArgs(args, "application_ids");
      return id ? candidate(id) : null;
    }
    case "save_prospect":
    case "set_prospect_stage": {
      const id = fromResult(result, args, "id");
      return id ? prospect(id) : null;
    }
    case "convert_prospect": {
      const id = fromArgs(args, "id");
      return id ? prospect(id) : null;
    }
    case "read_prospect_profile":
    case "get_prospect_profile": {
      const id = fromArgs(args, "id");
      return id ? prospect(id) : null;
    }
    case "import_prospects":
      return { href: "/sourcing", label: "Open the sourcing board" };
    case "get_report":
      return { href: "/reports", label: "Open the reports" };
    case "get_analytics_report":
      return { href: "/analytics", label: "Open the analytics report" };
    case "save_assessment_suite":
    case "set_assessment_suite_active":
    case "delete_assessment_suite":
    case "save_question":
    case "move_question":
    case "delete_question":
    case "revoke_attempt":
    case "extend_attempt":
    case "reissue_attempt":
    case "delete_attempt":
      return { href: "/assessments", label: "Open the assessment suites" };
    case "get_attempt_grades":
    case "award_marks":
    case "retry_grading": {
      // Grading lives on the candidate's own Integrity report, and all three
      // actions report whose attempt they read or touched, so the chat lands on
      // the person rather than on the whole pipeline.
      const id = token((result as { application_id?: unknown } | null)?.application_id);
      return id
        ? candidate(id)
        : { href: "/candidates", label: "Open the candidate pipeline" };
    }
    case "list_interviews":
    case "reschedule_interview":
    case "set_interview_status":
      // The widest forward range, not the default week: a panel moved to a slot
      // three weeks out is exactly what the recruiter clicks through to check, and
      // a landing view that hides it reads as a failed move.
      return { href: "/interviews?range=upcoming", label: "Open the interview agenda" };
    case "list_onboarding_plans":
    case "generate_onboarding_plan":
    case "save_onboarding_task":
    case "complete_onboarding_task":
    case "delete_onboarding_task":
      return { href: "/onboarding", label: "Open the onboarding board" };
    case "list_files":
    case "delete_stored_file":
    case "delete_attachment":
      return { href: "/files", label: "Open the file manager" };
    case "list_gate_questions":
    case "save_gate_question":
    case "set_gate_question_active":
    case "move_gate_question":
    case "delete_gate_question":
      return { href: "/apply-questions", label: "Open the gate questions" };
    case "list_team":
    case "edit_staff_member":
    case "set_staff_active":
    case "delete_staff_account":
      return { href: "/settings?area=access&section=team", label: "Open the team" };
    case "set_role_permission":
      return { href: "/settings?area=access&section=permissions", label: "Open permissions" };
    case "save_notification_template":
    case "reset_notification_template":
    case "delete_notification_template":
      return {
        href: "/settings?area=notifications&section=templates",
        label: "Open the templates",
      };
    case "save_master_record":
    case "delete_master_record": {
      const entity = fromArgs(args, "entity");
      return {
        href: `/settings?area=organisation&section=${entity ?? "companies"}`,
        label: "Open the master data",
      };
    }
    case "get_audit_log":
      return { href: "/activity", label: "Open the activity trail" };
    case "message_candidates":
      return { href: "/candidates", label: "Open the candidate pipeline" };
    case "message_prospects":
      return { href: "/sourcing", label: "Open sourcing" };
    case "queue_whatsapp":
    case "cancel_outbox_message":
    case "retry_outbox_message":
    case "edit_outbox_message":
      return { href: "/whatsapp", label: "Open the outbox" };
    case "resend_email":
      // Only a refused row can be re-sent, and `?failed=1` is the view that lists
      // refused rows — a plain link here would drop the reader in a mixed log where
      // the message they just mailed is one badge among many.
      return { href: "/whatsapp?failed=1", label: "Open the refused messages" };
    case "save_model_routing":
      return {
        href: "/settings?area=providers&section=models",
        label: "Open model routing",
      };
    case "save_settings":
      return { href: "/settings", label: "Open settings" };
    case "dashboard_analytics":
      return { href: "/dashboard", label: "Open the dashboard" };
    /* Reads whose answer is a page's own table — show the table, not just the rows. */
    case "list_jobs":
      // The grid takes both its rails and its search box out of the address bar,
      // so the status and the company the answer counted travel with the link and
      // the click through shows that set. A value the rails do not offer is
      // dropped here rather than sent, because a parameter the page cannot show
      // makes the link look filtered while the grid holds everything.
      return {
        href: `/jobs${query([
          ["status", named(args.status, [...JOB_STATUSES, "HIREABLE"])],
          ["company", token(args.company)],
          ["q", words(args.query)],
        ])}`,
        label: "Open the openings",
      };
    case "delete_job":
      return { href: "/jobs", label: "Open the openings" };
    case "list_candidates":
      // The rails are query parameters, so the click-through can open the same
      // set the answer just described rather than the whole pipeline. The company
      // travels as its id, which is what that rail reads back out of the address bar.
      return {
        href: `/candidates${query([
          ["stage", named(args.stage, PIPELINE_STAGES)],
          ["source", named(args.source, APPLICATION_SOURCES)],
          ["company", token(args.company)],
          ["q", words(args.query)],
          ["archived", args.archived === true || args.archived === "true" ? "1" : null],
        ])}`,
        label: "Open the candidate pipeline",
      };
    case "list_assessment_suites":
    case "get_assessment_suite":
      return { href: "/assessments", label: "Open the assessment suites" };
    case "list_prospects":
      return {
        href: `/sourcing${query([
          ["stage", named(args.stage, PROSPECT_STAGES)],
          ["q", words(args.query)],
        ])}`,
        label: "Open the sourcing board",
      };
    case "delete_prospect":
      return { href: "/sourcing", label: "Open the sourcing board" };
    case "list_outbox":
    case "list_email_outbox":
      return { href: "/whatsapp", label: "Open the outbox" };
    case "list_model_routing":
      return {
        href: "/settings?area=providers&section=models",
        label: "Open model routing",
      };
    case "get_settings":
      return { href: "/settings", label: "Open settings" };
    case "get_master_data":
      return { href: "/settings?area=organisation", label: "Open the master data" };
    default:
      return null;
  }
}
