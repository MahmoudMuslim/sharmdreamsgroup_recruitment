import { PIPELINE_STAGES, APPLICATION_SOURCES } from "@/modules/candidates/domain/listFilters";
import { JOB_STATUSES } from "@/modules/jobs/domain/hireable";
import { PROSPECT_STAGES } from "@/app/(admin)/sourcing/pool-model";
import { OUTBOX_BUCKETS } from "@/app/(admin)/whatsapp/outbox-model";
import { bucketInfo, isStoredPath } from "@/app/(admin)/files/file-browser-types";
import {
  credentialsTab,
  MODEL_CONSOLE_TABS,
  type ModelConsoleTabId,
  TEMPLATES_CONSOLE_TABS,
  templatesTabForChannel,
} from "@/modules/settings/domain/settingsNav";
import { PROVIDER_GROUPS } from "@/modules/settings/domain/providers";
import { settingsSection } from "@/modules/settings/domain/settingSearch";
import { trailProvider, trailScope } from "@/modules/settings/domain/credentialTrail";
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
 * Words are different from a record: a page whose search box reads `?q=` can
 * show the same rows the answer named without opening anything. Where a box
 * does that, the words travel with the link — and only the parameters the page
 * genuinely reads are sent, because a parameter a page ignores makes the link
 * look filtered while the table shows everything.
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
 * Every box that seeds itself from the address bar (`?q=`, and the email panel's
 * `?email_q=` on the page that hosts two differently searched lists) reads these
 * back, so a click-through can land on the rows the answer just named — but only
 * when there are words to carry, and an argument that is only whitespace must
 * drop out rather than send `?q=`.
 */
function words(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The storage folder the file manager opens on.
 *
 * Sent in the form `readFolder` expects (one trailing slash) and only when
 * storage would accept the path, because a prefix the listing cannot open would
 * land on an empty folder that looks like a bucket with nothing in it.
 */
function folder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === "" || !isStoredPath(trimmed) ? null : `${trimmed}/`;
}

/** One of the buckets the file manager lists, out of whatever was typed. */
function bucketKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return bucketInfo(value)?.key ?? null;
}

/**
 * The AI models console, opened on the tab that holds the answer.
 *
 * Routing rows and the model catalogue are two views of one page, and the page
 * opens on routing — so a link that counts models has to carry the tab or it
 * lands on a table of capabilities. The tab id is typed against the console's own
 * table and the label is read back out of it, so neither half can name a view the
 * console does not have. Words travel only with the catalogue, because that is
 * the box `list_models` searches.
 */
function modelsTab(tab: ModelConsoleTabId, q: string | null = null): AssistantLink {
  return {
    href: `/settings${query([
      ["area", "providers"],
      ["section", "models"],
      ["tab", tab],
      ["q", q],
    ])}`,
    label: `Open the ${MODEL_CONSOLE_TABS[tab].toLowerCase()}`,
  };
}

/**
 * The templates console, opened on the channel tab that holds the row.
 *
 * Templates are one page split into WhatsApp, Email and Portal notices, and it
 * opens on WhatsApp — so a link about an email letter has to carry the tab or it
 * lands on phone copy. The channel comes back from the action rather than from
 * the model's arguments, because the tool has no channel parameter: the stored
 * row is the only thing that knows which tab the change is visible on. A refusal
 * reports no channel, and the link degrades to the console itself instead of
 * naming a tab nobody touched.
 */
function templatesView(channel: unknown): AssistantLink {
  const tab = templatesTabForChannel(channel);
  return tab
    ? {
        href: `/settings${query([
          ["area", "access"],
          ["section", "templates"],
          ["tab", tab],
        ])}`,
        label: `Open the ${TEMPLATES_CONSOLE_TABS[tab].label} tab`,
      }
    : { href: "/settings?area=access&section=templates", label: "Open the templates" };
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

/** The Platform area's console, when no single section can be named. */
const SETTINGS_CONSOLE: AssistantLink = { href: "/settings?area=platform", label: "Open the settings" };

/** The keys console, when no single provider group can be named. */
const CREDENTIALS_CONSOLE: AssistantLink = {
  href: "/settings?area=providers&section=credentials",
  label: "Open the API keys",
};

/**
 * The setting keys a settings answer or write is about.
 *
 * A searched read lists objects with their keys; a write reports the keys it saved.
 * A refusal reports none, and no keys name no section, so a failed change needs no
 * special case here — it lands on the console like a search that reached nothing.
 */
function settingKeys(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const record = result as Record<string, unknown>;
  const list = record.settings ?? record.saved;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => (typeof row === "string" ? row : (row as { key?: unknown } | null)?.key))
    .filter((key): key is string => typeof key === "string");
}

/**
 * The settings console, opened on the section that holds what the answer named.
 *
 * `?q=` is the console's own box and reads the same columns the tool searched, so
 * the words travel with the link only when one section holds every match: a search
 * that reached across two sections would land on a box showing none of the rows the
 * answer counted, which is a filter that lies. A write passes no words — the console
 * submits a whole section at once, so narrowing the box to one key would hide the
 * others that changed beside it.
 */
function settingsView(keys: string[], q: string | null): AssistantLink {
  const one = settingsSection(keys);
  if (!one) return SETTINGS_CONSOLE;
  return {
    href: `/settings${query([
      ["area", "platform"],
      ["section", one.id],
      ["q", q],
    ])}`,
    label: `Open the ${one.title} settings`,
  };
}

/**
 * The API keys console, opened on the tab that holds what the answer named.
 *
 * Providers are three tabs of one page and it opens on the AI group, so a link
 * about the WhatsApp number sits behind a tab the plain console would not show.
 * One tab is named only when every provider in the answer sits under it — a read
 * that spanned groups would land on a strip listing some of the rows it counted.
 * A held or refused write reports no group, and then the console alone is honest.
 */
function credentialsView(groups: (string | null)[]): AssistantLink {
  const distinct = [...new Set(groups.filter((group): group is string => typeof group === "string"))];
  const tab = distinct.length === 1 ? credentialsTab(distinct[0]) : null;
  if (!tab) return CREDENTIALS_CONSOLE;
  return {
    href: `/settings${query([
      ["area", "providers"],
      ["section", "credentials"],
      ["tab", tab],
    ])}`,
    label: `Open the ${PROVIDER_GROUPS.find((group) => group.id === tab)?.label ?? tab} tab`,
  };
}

/**
 * The group(s) a credential answer is about.
 *
 * A read lists cards under their provider's own group; a write names the one row
 * it touched. A refusal names neither, and `report()` has already stripped it to
 * `{ok:false, error}`, so a failed change needs no special case here.
 */
function credentialGroups(result: unknown): (string | null)[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const record = result as Record<string, unknown>;
  const cards = record.credentials;
  if (Array.isArray(cards)) {
    return cards.map(
      (card) => ((card as { group?: unknown } | null)?.group ?? null) as string | null
    );
  }
  return [typeof record.group === "string" ? record.group : null];
}

/**
 * The keys console, scoped to the one provider whose history the answer read.
 *
 * `?provider=` is applied to the page's own read, so the click lands on the rows
 * the answer counted rather than on the newest rows of every provider — which is
 * what makes a counted trail checkable instead of merely plausible. A held card
 * has read nothing, and an unscoped read names exactly what the section already
 * shows, so both go to the console itself.
 */
function credentialTrailView(result: unknown): AssistantLink {
  if (!result || typeof result !== "object" || Array.isArray(result)) return CREDENTIALS_CONSOLE;
  const scope = (result as { audit_scope?: unknown }).audit_scope;
  const id = trailScope(typeof scope === "string" ? scope : null);
  const definition = trailProvider(id);
  if (!definition || !id) return CREDENTIALS_CONSOLE;
  return {
    href: `/settings${query([
      ["area", "providers"],
      ["section", "credentials"],
      ["provider", id],
    ])}`,
    label: `Open ${definition.displayName}'s key history`,
  };
}

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
    case "send_candidate_feedback":
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
    case "list_files": {
      // The manager takes its bucket, folder and search words from the address
      // bar, so the click-through opens the folder the answer just listed instead
      // of the CV root the page always starts from. An unknown bucket is dropped,
      // not guessed at — a parameter the page would ignore reads as a folder.
      const bucket = bucketKey(args.bucket);
      return {
        href: `/files${query([
          ["bucket", bucket],
          ["prefix", folder(args.prefix)],
          ["q", words(args.query)],
        ])}`,
        label: "Open the file manager",
      };
    }
    case "delete_stored_file": {
      // The object is gone, so the link opens the bucket it was removed from and
      // no folder: the folder could name a place that now holds nothing, which
      // would read as an empty bucket rather than a delete.
      const bucket = bucketKey(args.bucket);
      return {
        href: `/files${query([["bucket", bucket]])}`,
        label: "Open the file manager",
      };
    }
    case "delete_attachment":
      // The argument is an attachment row id, which the file manager does not
      // open, so this is the plain page.
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
      return templatesView(
        (result as { channel?: unknown } | undefined | null)?.channel
      );
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
      return modelsTab("routing");
    case "save_credential":
    case "delete_credential":
    case "verify_credential":
      return credentialsView(credentialGroups(result));
    case "save_settings":
      return settingsView(settingKeys(result), null);
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
      // The grid seeds its own box from `?q=` and runs the same predicate this
      // read does, so the click-through shows the suites the answer found. The
      // family and status picklists stay out of the URL: this tool takes neither.
      return {
        href: `/assessments${query([["q", words(args.query)]])}`,
        label: "Open the assessment suites",
      };
    case "get_assessment_suite":
      // One suite by id, and the grid opens no suite from the address bar.
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
    case "list_email_outbox": {
      // Both rails are query parameters on this page, so the click-through opens
      // the set the answer just counted rather than the whole outbox. `ALL` is the
      // unlit view and earns no parameter — a link carrying `?bucket=ALL` would
      // look scoped while the queue shows every column. `list_email_outbox` takes
      // no bucket, so its link narrows the refused rows and leaves the columns.
      // The page hosts two searched lists, so the words go to the box that owns
      // the read: `?q=` is the WhatsApp queue, `?email_q=` the email panel.
      const bucket = named(args.bucket, OUTBOX_BUCKETS);
      const search = words(args.query);
      const emails = name === "list_email_outbox";
      return {
        href: `/whatsapp${query([
          ["bucket", bucket && bucket !== "ALL" ? bucket : null],
          ["failed", args.failed === true || args.failed === "true" ? "1" : null],
          ["q", emails ? null : search],
          ["email_q", emails ? search : null],
        ])}`,
        label: emails ? "Open the email log" : "Open the outbox",
      };
    }
    case "list_model_routing":
      return modelsTab("routing");
    case "list_models":
      // The catalogue tab and the words the answer searched, so the click shows
      // the same tiles it counted. Routing rows and the catalogue are different
      // views of one page, and this page opens on routing.
      return modelsTab("catalogue", words(args.query));
    case "list_credentials":
      // Three provider groups share one page and it opens on the AI tab, so a
      // read that only listed messaging channels has to carry its group.
      return credentialsView(credentialGroups(result));
    case "get_credential_audit":
      return credentialTrailView(result);
    case "get_settings":
      return settingsView(settingKeys(result), words(args.query));
    case "get_master_data":
      return { href: "/settings?area=organisation", label: "Open the master data" };
    default:
      return null;
  }
}
