// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool, PipelineStage } from "./shared";
import {
  AI_CAPABILITIES,
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  JOB_STATUSES,
  PIPELINE_STAGES,
  PROSPECT_STAGES,
  SECTORS,
  ToolArgumentError,
  assignTemplate,
  bool,
  createJobOpening,
  draftCandidateFeedback,
  jobDraft,
  num,
  optionalStr,
  queueWhatsAppMessage,
  report,
  saveModelRouting,
  saveProspect,
  saveSettings,
  screenApplication,
  sendCandidateFeedback,
  setJobStatus,
  setProspectStage,
  str,
  strArray,
  updateApplicationStage,
  updateJobOpening,
} from "./shared";

/* Writes tools. */

export const writes: readonly AssistantTool[] = [
  {
    name: "create_job",
    label: "Creating a job opening",
    description:
      "Create a job opening. Either point it at a position and let the definition supply the copy — send position_id, a location, and optionally the company, title, department or salary the intake overrides — or write the role out in full. Read the vocabularies first: get_master_data answers one list per call, so ask it for positions, companies, departments, locations and currencies, and file the role under a row that is in use. A company id, department name, location name or currency code the list does not hold is refused, and the refusal quotes the rows that are in use. A position filed under one company only seeds that company's openings. The positions table arrives with db/migrations/026_positions.sql, which is applied on this database, so position_id is a path this call takes. On a database where that file has not been run, get_master_data reports the list as not created and a position_id is refused with that reason. Employment types are the six this portal offers, and seniority is optional: send experience_level only when the intake stated one. Levels and the Remote/Hybrid types arrive with db/migrations/033_opening_terms.sql, which is authored but not applied — a call naming either is refused with that reason while the old schema stands.",
    args: {
      position_id:
        "string — optional id from get_master_data (entity positions). When sent, the position supplies title, company, department, description (its responsibilities), requirements and salary band, and any of those sent alongside replace the inherited value. The link is recorded on the opening.",
      title: "string — required unless position_id supplies it",
      tenant_id:
        "string — company id from get_master_data (entity companies); required unless position_id supplies it",
      department:
        "string — department name exactly as get_master_data (entity departments) lists it; required unless position_id supplies it",
      sector: `string — one of ${SECTORS.join(", ")}; optional with position_id, where the company's sector is used`,
      location: "string — location name exactly as get_master_data (entity locations) lists it",
      employment_type: `string — one of ${EMPLOYMENT_TYPE_VALUES.join(", ")}; optional with position_id, defaults to FULL_TIME. REMOTE and HYBRID are refused until db/migrations/033_opening_terms.sql is applied.`,
      experience_level: `string — optional, one of ${EXPERIENCE_LEVEL_VALUES.join(", ")}; omit it when the intake did not state one. Storing a level needs db/migrations/033_opening_terms.sql, and while the column is missing the write is refused with that reason rather than dropping the level silently.`,
      description: "string — required unless position_id supplies responsibilities",
      requirements: "string[] — optional list of requirement lines",
      min_salary_usd: "string — optional number",
      max_salary_usd: "string — optional number",
      salary_currency:
        "string — optional 3-letter code the currencies list holds in use, defaults to USD",
      status: `string — one of ${JOB_STATUSES.join(", ")}; optional with position_id, defaults to DRAFT`,
    },
    run: async (args) => report(await createJobOpening(jobDraft(args, { fromPosition: true }))),
  },
  {
    name: "update_job",
    label: "Editing a job opening",
    description:
      "Rewrite a job opening. Every field is written, so read the opening with get_job first and send back the full record with only the intended changes. A company, department, location or currency the master data does not offer is accepted while it matches what get_job reported for that opening — legacy rows stay editable — and refused as soon as it is new. `experience_level` is the one tri-state field: send a level to set it, null to clear it, or omit it to leave a recorded level untouched. Omitting it is also what keeps every other field writable while db/migrations/033_opening_terms.sql is unapplied, because the database then has no column to write.",
    args: {
      job_id: "string — the opening's id",
      title: "string",
      tenant_id: "string — company id, or what get_job reported for this opening",
      department: "string — department name, or what get_job reported for this opening",
      sector: "string",
      location: "string — location name, or what get_job reported for this opening",
      employment_type: `string — one of ${EMPLOYMENT_TYPE_VALUES.join(", ")}; REMOTE and HYBRID need db/migrations/033_opening_terms.sql`,
      experience_level: `string or null — one of ${EXPERIENCE_LEVEL_VALUES.join(", ")} to set it, null to clear it, or omit it to leave what get_job reported. Setting or clearing needs db/migrations/033_opening_terms.sql; while the column is missing, omitting it is the only form that keeps the rest of the edit writable.`,
      description: "string",
      requirements: "string[]",
      min_salary_usd: "string — optional",
      max_salary_usd: "string — optional",
      salary_currency: "string — optional, a currency code the list holds or this opening's own",
      status: "string",
    },
    run: async (args) => report(await updateJobOpening(str(args, "job_id"), jobDraft(args))),
  },
  {
    name: "set_job_status",
    label: "Changing a job's status",
    description:
      "Publish, pause or close an opening without touching any other field. Closing keeps applicants and their records.",
    args: {
      job_id: "string — the opening's id",
      status: `string — one of ${JOB_STATUSES.join(", ")}`,
    },
    run: async (args) =>
      report(await setJobStatus(str(args, "job_id"), str(args, "status").toUpperCase())),
  },
  {
    name: "screen_candidate",
    label: "Running AI screening",
    description:
      "Run the AI screening engine on one application now and store the score, decision, strengths and gaps.",
    args: { application_id: "string" },
    run: async (args) => screenApplication(str(args, "application_id")),
  },
  {
    name: "draft_candidate_feedback",
    label: "Drafting candidate feedback",
    description: "Write or refresh the personalised feedback draft for one application.",
    args: { application_id: "string" },
    run: async (args) => draftCandidateFeedback(str(args, "application_id")),
  },
  {
    name: "send_candidate_feedback",
    label: "Emailing the drafted feedback",
    description:
      "Email a candidate the personalised feedback letter already stored on their record, word for word as the profile shows it. Refuses when no draft exists, when the candidate has no email address, or when email is switched off in Settings. Not sent on WhatsApp.",
    args: { application_id: "string" },
    run: async (args) => {
      const sent = await sendCandidateFeedback(str(args, "application_id"));
      return sent.ok
        ? {
            ...sent,
            note: `Emailed to ${sent.recipient} exactly as the profile displays it${
              sent.inApp === "sent" ? ", and copied into the candidate's portal inbox" : ""
            }.`,
          }
        : sent;
    },
  },
  {
    name: "set_candidate_stage",
    label: "Moving a candidate's stage",
    description:
      "Move an application to another pipeline stage. Rejecting needs a reason of at least four characters. The candidate is notified on the channels Settings allows.",
    args: {
      application_id: "string",
      stage: `string — one of ${PIPELINE_STAGES.join(", ")}`,
      reason: "string — required when stage is REJECTED",
    },
    run: async (args) => {
      const stage = str(args, "stage").toUpperCase() as PipelineStage;
      if (!(PIPELINE_STAGES as readonly string[]).includes(stage)) {
        throw new ToolArgumentError(`"stage" must be one of: ${PIPELINE_STAGES.join(", ")}.`);
      }
      return updateApplicationStage({
        applicationId: str(args, "application_id"),
        stage,
        reason: optionalStr(args, "reason"),
      });
    },
  },
  {
    name: "assign_assessment",
    label: "Assigning an assessment",
    description:
      "Issue an assessment attempt to one or more applications. Candidates who already have an open attempt on that suite are skipped. Everyone who gets a new attempt is then invited by the channels that are switched on, and the invitation carries the start link.",
    args: {
      template_id: "string — suite id from list_assessment_suites",
      application_ids: "string[] — application ids",
      time_limit_minutes: "number — between 5 and 480",
    },
    run: async (args) =>
      assignTemplate({
        templateId: str(args, "template_id"),
        applicationIds: strArray(args, "application_ids"),
        timeLimitMinutes: num(args, "time_limit_minutes"),
      }),
  },
  {
    name: "save_model_routing",
    label: "Changing AI model routing",
    description:
      "Point an AI capability at a different model. Model ids containing a slash go to OpenRouter; ids without one go to Google AI Studio. Takes effect on the next call.",
    args: {
      capability: "string — capability id from list_model_routing",
      primary_model: "string — model id",
      fallback_model: "string — optional model id",
      temperature: "number — 0 to 2",
      max_tokens: "number — 64 to 32000",
      is_enabled: "boolean",
    },
    run: async (args) => {
      const capability = str(args, "capability");
      if (!AI_CAPABILITIES.some((entry) => entry.id === capability)) {
        throw new ToolArgumentError(
          `"capability" must be one of: ${AI_CAPABILITIES.map((entry) => entry.id).join(", ")}.`
        );
      }
      return report(
        await saveModelRouting({
          capability,
          primaryModel: str(args, "primary_model"),
          fallbackModel: optionalStr(args, "fallback_model") ?? null,
          temperature: num(args, "temperature"),
          maxTokens: num(args, "max_tokens"),
          isEnabled: bool(args, "is_enabled", true),
        })
      );
    },
  },
  {
    name: "queue_whatsapp",
    label: "Queueing a WhatsApp message",
    description:
      "Queue a WhatsApp message to one candidate. Delivery depends on the WhatsApp channel being configured and the number being on Meta's allow-list.",
    args: {
      application_id: "string",
      text: "string — the message body",
      scheduled_for: "string — ISO date-time; use a past or near time to send now",
    },
    run: async (args) =>
      report(
        await queueWhatsAppMessage({
          applicationId: str(args, "application_id"),
          text: str(args, "text"),
          scheduledFor: str(args, "scheduled_for"),
        })
      ),
  },
  {
    name: "save_prospect",
    label: "Saving a prospect",
    description:
      "Create a sourced prospect, or edit one when id is given. Only the fields sent are written.",
    args: {
      id: "string — optional, present when editing",
      full_name: "string — at least two characters",
      headline: "string — optional",
      company: "string — optional",
      location: "string — optional",
      email: "string — optional",
      phone: "string — optional",
      linkedin_url: "string — optional, must be a linkedin.com/in/… link",
      notes: "string — optional",
      job_id: "string — optional opening to link",
    },
    run: async (args) => {
      const result = await saveProspect({
        id: optionalStr(args, "id"),
        full_name: str(args, "full_name"),
        headline: optionalStr(args, "headline") ?? null,
        company: optionalStr(args, "company") ?? null,
        location: optionalStr(args, "location") ?? null,
        email: optionalStr(args, "email") ?? null,
        phone: optionalStr(args, "phone") ?? null,
        linkedin_url: optionalStr(args, "linkedin_url") ?? null,
        notes: optionalStr(args, "notes") ?? null,
        job_id: optionalStr(args, "job_id") ?? null,
        origin: "MANUAL",
      });
      return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
    },
  },
  {
    name: "set_prospect_stage",
    label: "Moving a prospect's stage",
    description: "Move a sourced prospect to another stage in the sourcing pipeline.",
    args: {
      id: "string — prospect id",
      stage: `string — one of ${PROSPECT_STAGES.join(", ")}`,
    },
    run: async (args) => {
      const stage = str(args, "stage").toUpperCase();
      if (!(PROSPECT_STAGES as readonly string[]).includes(stage)) {
        throw new ToolArgumentError(`"stage" must be one of: ${PROSPECT_STAGES.join(", ")}.`);
      }
      return report(await setProspectStage(str(args, "id"), stage));
    },
  },
  {
    name: "save_settings",
    label: "Changing settings",
    description:
      "Change one or more settings keys. Only keys the settings console can show are accepted — all of them, whether or not a row has ever been stored, so a setting nobody has changed yet is writable. Each change is written to the audit log.",
    args: { values: "object — setting key to new value, e.g. {\"ai.match_threshold_advance\": 75}" },
    run: async (args) => {
      const values = args.values;
      if (typeof values !== "object" || values === null || Array.isArray(values)) {
        throw new ToolArgumentError('"values" must be an object of setting keys to values.');
      }
      return report(await saveSettings(values as Record<string, unknown>));
    },
  },

];
