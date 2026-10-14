import type { ToolArgs } from "./tools";

/**
 * Where a finished tool action leaves the recruiter.
 *
 * The chat is a dock over the screen the recruiter was already on, so a change
 * made from it has to be inspectable on its own page. Each link points at the
 * real admin route for the record the tool just touched, and the routes read the
 * id from the query string (`?job=`, `?application=`, `?prospect=`) to open or
 * highlight it.
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

export function linkForTool(
  name: string,
  args: ToolArgs,
  result: unknown
): AssistantLink | null {
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
    case "get_application": {
      const id = fromArgs(args, "application_id");
      return id ? { href: `/candidates?application=${id}`, label: "Open the dossier" } : null;
    }
    case "assign_assessment": {
      const id = firstFromArgs(args, "application_ids");
      return id ? { href: `/candidates?application=${id}`, label: "Open the dossier" } : null;
    }
    case "save_prospect":
    case "set_prospect_stage": {
      const id = fromResult(result, args, "id");
      return id ? { href: `/sourcing?prospect=${id}`, label: "View the prospect" } : null;
    }
    case "queue_whatsapp":
    case "cancel_outbox_message":
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
