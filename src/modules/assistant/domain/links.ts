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
    case "screen_candidate":
    case "draft_candidate_feedback":
    case "set_candidate_stage":
    case "get_application":
    case "get_candidate_dossier":
    case "draft_interview_guide":
    case "schedule_interview":
    case "edit_candidate_contact":
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
    case "save_assessment_suite":
    case "set_assessment_suite_active":
    case "delete_assessment_suite":
    case "save_question":
    case "move_question":
    case "delete_question":
    case "revoke_attempt":
    case "extend_attempt":
    case "delete_attempt":
      return { href: "/assessments", label: "Open the assessment suites" };
    case "list_interviews":
    case "reschedule_interview":
    case "set_interview_status":
      return { href: "/interviews", label: "Open the interview agenda" };
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
    case "resend_email":
      return { href: "/whatsapp", label: "Open the outbox" };
    case "save_model_routing":
      return {
        href: "/settings?area=providers&section=models",
        label: "Open model routing",
      };
    case "save_settings":
      return { href: "/settings", label: "Open settings" };
    case "dashboard_analytics":
      return { href: "/dashboard", label: "Open the dashboard" };
    default:
      return null;
  }
}
