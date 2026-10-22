// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  AGENDA_CHAT_ROW_LIMIT,
  ANSWER_ROWS,
  BUCKETS,
  DOSSIER_ALERT_ROWS,
  FOLDER_FILE_ROWS,
  GATE_JOB_ROWS,
  ITEM_STAT_ROWS,
  PROVIDER_GROUPS,
  ROOT_FILE_ROWS,
  TRAIL_LIMIT,
  TRAIL_SEARCH_SCAN,
  ToolArgumentError,
  UNPLANNED_HIRE_ROWS,
  agendaReadNote,
  agendaWindowDays,
  bool,
  clip,
  credentialsTab,
  deleteCredential,
  emailScopeNote,
  emailSearchWords,
  fileSearchWords,
  folderReadNote,
  getAttemptGrades,
  getCandidateDossier,
  getEmailOutbox,
  getFileBrowserData,
  getGateConsoleData,
  getInterviewAgenda,
  getOnboardingData,
  getQuestionsForEditor,
  getTemplateDetail,
  getTemplateItemStats,
  listCredentialAudit,
  listCredentials,
  listingCapNote,
  loadSettings,
  loadStaffConsole,
  num,
  openFolder,
  optionalStr,
  providerById,
  reachNote,
  saveCredential,
  searchEmails,
  searchFiles,
  str,
  trailNumber,
  trailPages,
  trailScope,
  trailScopeNote,
  trailWords,
  verifyCredential,
} from "./shared";

/* Provider credentials tools. */

export const credentials: readonly AssistantTool[] = [
  {
    name: "list_credentials",
    label: "Reading provider credentials",
    description:
      `Every provider the API keys console lists, and where its key actually comes from: "stored" is a key encrypted in this database, which overrides the deployment's variable; "environment" means nothing is stored and the variable named in \`env_var\` serves every call through it; "unset" means neither, so anything routed that way fails. Only a masked hint is ever returned — no surface in this portal reads a key back, this tool included. \`group\` is the console's own tab: ${PROVIDER_GROUPS.map((group) => group.id).join("|")}. Read this before save_credential or delete_credential: both change a stored row, and most deployments have none.`,
    args: {
      group: `string — optional, one of ${PROVIDER_GROUPS.map((group) => group.id).join("|")}, to list only the providers under that tab`,
    },
    run: async (args) => {
      const asked = optionalStr(args, "group");
      const tab = asked === undefined ? null : credentialsTab(asked);
      if (asked !== undefined && tab === null) {
        throw new ToolArgumentError(
          `"group" must be one of ${PROVIDER_GROUPS.map((group) => group.id).join(
            ", "
          )} — the console's tabs, exactly as it names them.`
        );
      }
      const cards = await listCredentials();
      const rows = tab ? cards.filter((card) => card.group === tab) : cards;
      const shown = rows.slice(0, ANSWER_ROWS);
      const labels = new Map(PROVIDER_GROUPS.map((group) => [group.id, group.label]));
      const count = (source: string) => rows.filter((row) => row.source === source).length;
      const stored = count("stored");
      const fromEnv = count("environment");
      const unset = count("unset");
      const parts = [
        `${rows.length.toLocaleString()} provider ${rows.length === 1 ? "card" : "cards"} the console can show${
          tab ? ` under ${labels.get(tab) ?? tab}` : ""
        }: ${stored} with ${stored === 1 ? "a stored key" : "stored keys"}, ${fromEnv} served from the environment, ${unset} with nothing configured.`,
      ];
      if (stored === 0) {
        parts.push(
          "No key is stored in this database, so every credential the portal runs on comes from its own environment variables — there is no row for save_credential or delete_credential to change."
        );
      }
      if (fromEnv > 0) {
        parts.push(
          "An environment-served provider has no row to write to, so a Test outcome for one lands only in the credential trail — get_credential_audit reads it, and a null last_verified here does not mean it was never tested."
        );
      }
      if (unset > 0) {
        parts.push("A provider with neither is dead until one is configured.");
      }
      if (rows.length > shown.length) {
        parts.push(`The answer lists the first ${shown.length.toLocaleString()} of them.`);
      }
      parts.push("Only the last characters of a key are ever shown, to anyone.");
      return {
        credentials_note: parts.join(" "),
        credentials: shown.map((card) => ({
          provider: card.provider,
          name: card.displayName,
          group: card.group,
          group_label: labels.get(card.group) ?? card.group,
          env_var: card.envVar,
          source: card.source,
          hint: card.hint || null,
          is_active: card.isActive,
          priority: card.priority,
          can_be_tested: card.verify,
          config: card.config,
          secret_fields_set: card.secretFieldsSet,
          fields: card.fields.map((field) => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            secret: field.secret === true,
          })),
          last_verified_at: card.lastVerifiedAt,
          last_verified_status: card.lastVerifiedStatus,
          last_verified_detail: card.lastVerifiedDetail,
        })),
      };
    },
  },
  {
    name: "get_credential_audit",
    label: "Reading the credential trail",
    description:
      "The API keys console's own \"Recent changes\" list, row for row: who changed or tested a provider's credential and what the provider said. `provider` narrows it to one provider's history exactly as the console's `?provider=` does, `page` walks that scope backwards exactly as its `?page=` does, and `query` runs its search box exactly as `?find=` does, so this answer and that section read the same scope, the same page size, the same window and the same order and cannot disagree about which rows exist. The live trail is deeper than one page — 24 rows against 12 a page — so a page number is how an older test is reached, and the note names the page it is standing on rather than leaving the count to be divided. A `VERIFIED` row records that somebody pressed Test and what came back; the coming-back is in `detail`, so a refused key is filed under the same action as a working one. The search matches the row as printed — the action, the provider id and its display name, the detail text, the actor's name — and says how far back it looked, because a match older than that window is not the same statement as no match at all. Nothing in a row is a key value: the writer stores a fixed phrase or a masked hint, and a hint like \"••••••••EOOg\" is the only trace of the secret.",
    args: {
      provider:
        "string — optional, one provider id exactly as list_credentials returns it, to read only its history",
      page: `number — optional, 1-based, ${TRAIL_LIMIT} rows a page: 1 is the newest, 2 the rows before them, and the note on any answer names the last page`,
      query: `string — optional, the console's own search box, matched over the newest ${TRAIL_SEARCH_SCAN} rows of the scope and paged like any other listing; the note names the rows it searched`,
    },
    run: async (args) => {
      const asked = optionalStr(args, "provider");
      const scope = asked === undefined ? null : trailScope(asked);
      if (asked !== undefined && scope === null) {
        throw new ToolArgumentError(
          "That is not a provider the API keys console lists — read list_credentials first."
        );
      }
      const askedWords = optionalStr(args, "query");
      const words = askedWords === undefined ? null : trailWords(askedWords);
      // Refused rather than defaulted: a model that wrote `page: "last"` has not
      // asked for the newest rows, and answering a different question quietly is
      // worse than telling it what the argument takes.
      const askedPage = args.page;
      if (askedPage !== undefined && askedPage !== null && askedPage !== "") {
        const parsed = typeof askedPage === "number" ? askedPage : Number(String(askedPage).trim());
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new ToolArgumentError(
            `"page" must be a whole number from 1 — 1 is the newest ${TRAIL_LIMIT} rows of the scope, 2 the rows before them.`
          );
        }
      }
      const page =
        askedPage === undefined || askedPage === null || askedPage === ""
          ? 1
          : trailNumber(askedPage as string | number);
      const result = await listCredentialAudit({ provider: scope, page, find: words });
      if (!result.ok) {
        // Answered as a refusal, with no counts invented behind it. An empty list
        // would let the model tell a recruiter no key was ever tested, which is a
        // sentence about a failed query rather than about their history.
        return { audit_refused: true, audit_note: result.error, audit_scope: scope, audit: [] };
      }
      return {
        audit_note: `${trailScopeNote({
          providerId: scope,
          total: result.total,
          loaded: result.entries.length,
          named: result.named,
          page: result.page,
          search: result.find === null ? null : {
            words: result.find,
            scanned: result.scanned,
            scopeRows: result.scopeRows,
          },
        })} A provider whose key comes from the environment has no stored row to stamp, so for it this trail is the only record a Test left.`,
        audit_scope: scope,
        audit_page: result.page,
        audit_pages: trailPages(result.total),
        audit_total: result.total,
        audit_named: result.named,
        // The three the console's box shows under its own heading, so an answer
        // about "the OpenRouter test" can say which rows it looked through.
        audit_find: result.find,
        audit_scanned: result.scanned,
        audit_scope_rows: result.scopeRows,
        audit: result.entries.map((entry) => {
          const definition = providerById(entry.provider ?? "");
          return {
            provider: entry.provider,
            name: definition?.displayName ?? entry.provider,
            group: definition?.group ?? null,
            action: entry.action,
            detail: entry.detail,
            actor: entry.actor ?? "system",
            at: entry.createdAt,
          };
        }),
      };
    },
  },
  {
    name: "verify_credential",
    label: "Testing a provider credential",
    description:
      "Run the console's Test button for one provider: a live call that asks the provider whether the key the portal would actually use answers. It works for a key served from the environment as well as a stored one. Held for the recruiter's approval, because it spends a provider call and records the outcome against the provider.",
    args: { provider: "string — the provider id exactly as list_credentials returns it" },
    run: async (args) => {
      const definition = providerById(str(args, "provider"));
      if (!definition) {
        throw new ToolArgumentError(
          "That is not a provider the API keys console lists — read list_credentials first."
        );
      }
      const result = await verifyCredential(definition.id);
      return {
        ok: result.ok,
        provider: definition.id,
        name: definition.displayName,
        group: definition.group,
        status: result.status,
        outcome: result.message,
        ...(result.status === "unverifiable"
          ? { note: "This provider has no automatic check, so the console cannot test it either." }
          : {}),
      };
    },
  },
  {
    name: "save_credential",
    label: "Changing a stored credential",
    description:
      "Change the non-secret parts of one stored key row: its settings fields that are not keys (base URLs, account or project ids), and whether the row is active. A key value is never accepted here on purpose — anything typed into this chat is sent to the model that answers it, so a new or rotated key is typed into the console's own field, which encrypts it and never returns it. Refused when nothing is stored for that provider, which is where an environment-served key sits. Priority is not renumbered: it chooses which of the provider's stored rows is meant.",
    args: {
      provider: "string — the provider id exactly as list_credentials returns it",
      priority: "number — optional, which stored row of that provider, 1 being the one used first",
      fields: 'object — optional, non-secret field key to new value, e.g. {"account_id": "abc123"}',
      is_active: "boolean — optional, switch this row off without deleting it",
    },
    run: async (args) => {
      const definition = providerById(str(args, "provider"));
      if (!definition) {
        throw new ToolArgumentError(
          "That is not a provider the API keys console lists — read list_credentials first."
        );
      }

      const submitted = args.fields;
      if (submitted !== undefined && submitted !== null) {
        if (typeof submitted !== "object" || Array.isArray(submitted)) {
          throw new ToolArgumentError('"fields" must be an object of field names to values.');
        }
      }
      const values = Object.entries((submitted ?? {}) as Record<string, unknown>).map(
        (entry): [string, string] => {
          if (typeof entry[1] !== "string") {
            throw new ToolArgumentError(
              `"fields.${entry[0]}" must be a string — every field this console edits takes text.`
            );
          }
          return [entry[0], entry[1]];
        }
      );
      const keys = definition.fields.map((field) => field.key);
      const secretKeys = values
        .map(([key]) => key)
        .filter((key) => definition.fields.find((field) => field.key === key)?.secret);
      if (secretKeys.length > 0) {
        throw new ToolArgumentError(
          `${secretKeys.map((key) => `"${key}"`).join(", ")} ` +
            `${secretKeys.length === 1 ? "is a key field" : "are key fields"}, and a key typed into chat is sent to ` +
            `the model answering it. ${definition.displayName}'s ` +
            `${secretKeys.length === 1 ? "key belongs" : "keys belong"} in that screen's own field, which encrypts it. ` +
            `This tool changes only ${
              keys.filter((key) => !definition.fields.find((field) => field.key === key)?.secret).join(", ") ||
              "the row's active flag"
            }.`
        );
      }
      const unknown = values.map(([key]) => key).filter((key) => !keys.includes(key));
      if (unknown.length > 0) {
        throw new ToolArgumentError(
          `"${unknown.join(", ")}" is not a field ${definition.displayName} has. Its fields are ${
            keys.join(", ") || "none"
          } — exactly as list_credentials returned them.`
        );
      }

      const cards = await listCredentials();
      const stored = cards.filter(
        (card) => card.provider === definition.id && card.source === "stored"
      );
      if (stored.length === 0) {
        return {
          ok: false,
          error: `Nothing is stored for ${definition.displayName}, so there is no row to change — the portal reads ${definition.envVar}. A new key is typed into the console's own field, never into chat.`,
        };
      }
      const wanted = args.priority === undefined ? null : num(args, "priority");
      const row = wanted === null ? stored[0] : stored.find((card) => card.priority === wanted);
      if (!row) {
        return {
          ok: false,
          error: `${definition.displayName} has no stored key at priority ${wanted}. Its rows are at ${stored
            .map((card) => card.priority)
            .join(", ")}.`,
        };
      }
      const isActive = bool(args, "is_active", row.isActive);
      const changed = values.filter(([key, value]) => row.config[key] !== value);
      if (changed.length === 0 && isActive === row.isActive) {
        return {
          ok: false,
          error: `Nothing here differs from what is stored for ${definition.displayName} at priority ${row.priority}, so there is nothing to save.`,
        };
      }
      const result = await saveCredential({
        provider: definition.id,
        priority: row.priority,
        config: Object.fromEntries(changed),
        isActive,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        provider: definition.id,
        name: definition.displayName,
        group: definition.group,
        priority: row.priority,
        changed_fields: changed.map(([key]) => key),
        is_active: isActive,
        note: "No key value was read or written by this change.",
      };
    },
  },
  {
    name: "delete_credential",
    label: "Removing a stored credential",
    description:
      "Remove every stored key row for one provider, so the portal reads that provider's environment variable again — the same thing the console's Remove button does. Refused when nothing is stored, because then there is nothing to remove. The key goes with the row; only the environment variable can serve the provider afterwards.",
    args: { provider: "string — the provider id exactly as list_credentials returns it" },
    destructive: true,
    run: async (args) => {
      const definition = providerById(str(args, "provider"));
      if (!definition) {
        throw new ToolArgumentError(
          "That is not a provider the API keys console lists — read list_credentials first."
        );
      }
      const result = await deleteCredential(definition.id);
      if (!result.ok) return result;
      return {
        ok: true,
        provider: definition.id,
        name: definition.displayName,
        group: definition.group,
        key_rows_removed: result.removed ?? null,
      };
    },
  },
  {
    name: "get_candidate_dossier",
    label: "Reading a candidate dossier",
    description:
      "Everything on one application: what they submitted, their viability-gate answers, every assessment attempt with its status and deadline, every alert on the record with its status (delivered or failed for email and WhatsApp, queued for a WhatsApp still waiting, written for a portal notice — a notice is an inbox entry, nothing sent it through a relay), attached files, onboarding progress, and their other applications. This is where attempt, attachment and alert ids come from. `alerts_note` says whether the message list below is the whole history or only its first rows.",
    args: { application_id: "string — the application's id" },
    run: async (args) => {
      const applicationId = str(args, "application_id");
      const result = await getCandidateDossier(applicationId);
      if (!result.ok) return { ok: false, error: result.error };
      const dossier = result.dossier;

      // A start link is the only thing standing between a stranger and this
      // person's test, and a chat transcript is stored — so the token never
      // leaves the dossier screen that shows it in a copy field.
      const alerts = dossier.alerts.slice(0, DOSSIER_ALERT_ROWS).map((alert) => ({
        id: alert.id,
        channel: alert.channel,
        status: alert.status,
        subject: alert.subject,
        body: clip(alert.body, 240),
        error: alert.error,
        occurred_at: alert.occurred_at,
      }));

      return {
        // Leads the result because a dossier this long is clipped before the
        // model reads it, and the rows the note is about sit at the end of it.
        alerts_note: reachNote("message attempts on this record", dossier.alerts.length, alerts.length),
        ok: true,
        application: {
          id: dossier.application.id,
          full_name: dossier.application.full_name,
          email: dossier.application.email,
          phone: dossier.application.phone,
          tracking_code: dossier.application.tracking_code,
          source: dossier.application.source,
          applied_at: dossier.application.applied_at,
          job_title: dossier.application.job_title,
          department: dossier.application.job_department,
          location: dossier.application.job_location,
          cv_name: dossier.application.cv_name,
          cv_error: dossier.application.cv_error,
        },
        scores_masked: dossier.scores_masked,
        may_manage_links: dossier.can_manage_links,
        may_write: dossier.can_write,
        gate_answers: dossier.gate_answers.map((answer) => ({
          question: answer.question,
          answer: answer.answer,
          passed: answer.passed,
        })),
        attempts: dossier.attempts.map((attempt) => ({
          id: attempt.id,
          suite: attempt.template_name,
          status: attempt.status,
          score: attempt.score,
          max_score: attempt.max_score,
          time_limit_minutes: attempt.time_limit_minutes,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
          deadline: attempt.deadline,
        })),
        attachments: dossier.attachments.map((file) => ({
          id: file.id,
          label: file.label,
          name: file.name,
          bucket: file.bucket,
          bytes: file.bytes,
          uploaded_at: file.uploaded_at,
          uploaded_by: file.uploaded_by,
        })),
        alerts,
        onboarding: dossier.onboarding,
        other_applications: dossier.other_applications,
      };
    },
  },
  {
    name: "get_assessment_suite",
    label: "Reading one assessment suite",
    description:
      "One suite with every question in it — type, title, prompt, instructions, points, position, and the per-type config (options with their correct flags for multiple choice, context and word minimum for a case study, recording limits for a video pitch). Read this before editing or deleting a question.",
    args: { template_id: "string — suite id from list_assessment_suites" },
    run: async (args) => {
      const templateId = str(args, "template_id");
      const [detail, grouped] = await Promise.all([
        getTemplateDetail(templateId),
        getQuestionsForEditor(),
      ]);
      if (!detail) return { ok: false, error: "No assessment suite has that id." };

      return {
        ok: true,
        suite: {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          role_family: detail.role_family,
          time_limit_minutes: detail.time_limit_minutes,
          is_active: detail.is_active,
        },
        questions: (grouped[templateId] ?? []).map((question) => ({
          id: question.id,
          position: question.position,
          type: question.question_type,
          title: question.title,
          prompt: clip(question.prompt, 1200),
          instructions: question.instructions,
          points: question.points,
          time_limit_minutes: question.time_limit_minutes,
          shuffle_options: question.shuffle_options,
          config: question.config,
        })),
      };
    },
  },
  {
    name: "get_item_statistics",
    label: "Reading a suite's per-question statistics",
    description:
      "How each question in one suite performed over the suite's graded papers, as the Statistics drawer on /assessments shows it: `difficulty_pct` is the share of available points candidates earned on that question, `top_pct` and `bottom_pct` are the same share for the strongest and weakest halves of the papers, and `discrimination_pct_points` is one minus the other — negative when the weakest papers out-earned the strongest. A null figure is not a withheld claim: it means the counts refused it, and that item's `note` says what was found. Nothing here calls a question hard, easy, good or bad — no target difficulty is stored anywhere in this portal, so quote the figures with the counts beside them. `summary` prints the drawer's four tiles, `items_note` says whether the rows are every question or only the first, and `coverage_note` says whether the read reached the whole suite. Read this for which question was hardest, which ones the weaker candidates beat the stronger on, and which items are worth re-reading. Refuses outright while scores are masked for this recruiter.",
    args: { template_id: "string — suite id from list_assessment_suites" },
    run: async (args) => {
      const templateId = str(args, "template_id");
      const result = await getTemplateItemStats(templateId);
      if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

      const { stats } = result;
      // Counted over every question in the suite, not over the windowed rows
      // below, so a clipped answer still names the whole suite it was measured on.
      const gaps = stats.items
        .map((item) => item.discrimination_pct_points)
        .filter((gap): gap is number => gap !== null);
      const reversed = gaps.filter((gap) => gap < 0).length;
      const items = stats.items.slice(0, ITEM_STAT_ROWS).map((item) => ({
        question_id: item.question_id,
        title: clip(item.title, 160),
        answers: item.answers,
        papers: item.papers,
        difficulty_pct: item.difficulty_pct,
        top_pct: item.top_pct,
        bottom_pct: item.bottom_pct,
        discrimination_pct_points: item.discrimination_pct_points,
        note: item.note,
      }));

      return {
        // Leads the result because these rows are the wordiest this registry
        // hands back, and a cut reads to the model as a shorter list.
        items_note: reachNote("questions in this suite", stats.items.length, items.length),
        ok: true,
        template_id: templateId,
        summary: {
          questions: stats.items.length,
          graded_papers: stats.papers,
          graded_answers: stats.answers.read,
          reversed_items: reversed === 0 ? "none" : `${reversed} of ${stats.items.length}`,
        },
        coverage_note: stats.partial
          ? `This suite holds ${stats.answers.on_file.toLocaleString()} graded answers and the read stopped at ${stats.answers.read.toLocaleString()}, so the figures cover the answers that were read, not the whole suite.`
          : `Every graded answer was read: ${stats.answers.read.toLocaleString()} of ${stats.answers.on_file.toLocaleString()} the suite holds, over ${stats.papers.toLocaleString()} graded papers.`,
        items,
      };
    },
  },
  {
    name: "get_attempt_grades",
    label: "Reading an attempt's grades",
    description:
      "One assessment attempt answer by answer, in the order the exam was sat: the question, the candidate's own words, the transcript of a recording, the mark and whose verdict it is, and what the AI said for and against it. Also reports how many answers carry no mark at all, whether this recruiter may award them, and whether the engine can be asked to try again. `benchmark.note` places the paper among the graded papers of the same suite and names that population; when there are too few papers to rank it says so and gives no percentile, and it is absent while marks are masked for this recruiter — never invent a rank the note did not give. Read this before award_marks or retry_grading: both the response id and the points bound a mark may come from are here, nowhere else.",
    args: { attempt_id: "string — from get_candidate_dossier" },
    run: async (args) => {
      const attemptId = str(args, "attempt_id");
      const grades = await getAttemptGrades(attemptId);
      if (!grades) return { ok: false, error: "No assessment attempt has that id." };

      return {
        ok: true,
        attempt_id: grades.attempt_id,
        application_id: grades.application_id,
        suite: grades.template_name,
        status: grades.status,
        scores_masked: grades.scores_masked,
        total_score: grades.total_score,
        max_score: grades.max_score,
        // Quote `benchmark.note` whole if the candidate's rank comes up. It
        // already names the population it was taken from, and when that
        // population is too small it says so instead of giving a percentile.
        benchmark: grades.benchmark,
        unscored: grades.unscored,
        may_award_marks: grades.can_score,
        may_retry_grading: grades.can_retry,
        ai_grading: grades.ai_grading,
        answers: grades.grades.map((grade) => ({
          response_id: grade.response_id,
          title: grade.title,
          type: grade.question_type,
          score: grade.score,
          max_score: grade.max_score,
          awarded_by: grade.awarded_by,
          answer: clip(grade.answer_preview, 700),
          transcript: clip(grade.transcript, 500),
          // A signed playback URL is an hour-long door into a private bucket and
          // a chat transcript is stored, so the answer here is that a recording
          // exists — the recruiter watches it on the report itself.
          has_recording: Boolean(grade.video_url),
          rationale: clip(grade.rationale, 500),
          strengths: grade.strengths,
          improvements: grade.improvements,
        })),
      };
    },
  },
  {
    name: "list_interviews",
    label: "Reading the interview agenda",
    description:
      "Interviews booked around today with candidate, role, interviewer, time, length, meeting link and status (SCHEDULED, COMPLETED, NO_SHOW, CANCELLED). Gives the interview ids that reschedule and outcome tools need. Read `agenda_note` before saying \"all\" or counting these rows: it names the window asked for, whether that window is wider than the agenda page can list, and whether the list was cut.",
    args: {
      past_days:
        "number — optional, how many days back to include, defaults to the agenda's own 30",
      future_days:
        "number — optional, how many days forward, defaults to the agenda's own 90; a wider read is real but partly off the board, and `agenda_note` says so",
    },
    run: async (args) => {
      const days = agendaWindowDays({
        pastDays: args.past_days === undefined ? undefined : num(args, "past_days"),
        futureDays: args.future_days === undefined ? undefined : num(args, "future_days"),
      });
      const rows = await getInterviewAgenda(days);
      const shown = rows.slice(0, AGENDA_CHAT_ROW_LIMIT).map((row) => ({
        id: row.id,
        application_id: row.application_id,
        candidate: row.candidate_name,
        tracking_code: row.tracking_code,
        job_title: row.job_title,
        interviewer: row.interviewer_name,
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        meeting_link: row.meeting_link,
        status: row.status,
      }));
      return {
        // First key on purpose: the result handed to the model is clipped, so a
        // note that sat behind eighty panels could be cut off along with them.
        agenda_note: agendaReadNote({ ...days, total: rows.length, shown: shown.length }),
        interviews: shown,
      };
    },
  },
  {
    name: "list_onboarding_plans",
    label: "Reading onboarding plans",
    description:
      "Every hire's checklist with progress, each task's id, title, owner, category, due offset and completion, plus the hires who have no plan yet. Task ids come from here. `unplanned_note` says whether the waiting list below names every hire without a checklist or only its first rows.",
    args: {},
    run: async () => {
      const data = await getOnboardingData();
      const unplanned = data.unplanned.slice(0, UNPLANNED_HIRE_ROWS);
      return {
        // Leads because the plans below are long — a hire waiting for a
        // checklist could otherwise be reported as one that does not exist.
        unplanned_note: reachNote(
          "hires with no checklist yet",
          data.unplanned.length,
          unplanned.length
        ),
        summary: data.summary,
        unplanned,
        plans: data.plans.map((plan) => ({
          id: plan.id,
          application_id: plan.application_id,
          candidate: plan.candidate_name,
          job_title: plan.job_title,
          company: plan.company_name,
          hired_at: plan.hired_at,
          progress: plan.progress,
          done: plan.checklist_done,
          total: plan.checklist_total,
          skill_gaps: plan.skill_gap_count,
          tasks: plan.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            category: task.category,
            owner: task.owner,
            due_offset_days: task.due_offset_days,
            completed: task.completed,
          })),
        })),
      };
    },
  },
  {
    name: "list_files",
    label: "Reading stored files",
    description:
      "The storage buckets this portal writes, with file counts, and the folder listing inside one bucket. Without arguments it opens the CV bucket's root. `listing_note`/`root_note` name how many files the read actually carries — a folder's own `truncated` flag only describes the listing behind it, not this answer. `query` is the browser's own box and runs over the files the listing carries, so a search that names nothing says nothing about the bucket.",
    args: {
      // Derived from the bucket table the File Manager renders, so a bucket a
      // recruiter can click into is never one the chat has never heard of — the
      // hand-written list this replaces had three of the four and silently kept
      // the video pitches out of reach.
      bucket: `string — optional, one of ${BUCKETS.map((bucket) => bucket.key).join(", ")} — the bucket to read; omitted reads the CV bucket's root`,
      prefix: "string — optional, a folder path ending in /",
      query: `string — optional, the browser's own search box: ${fileSearchWords()}, matched over the files the listing carries`,
    },
    run: async (args) => {
      const bucket = optionalStr(args, "bucket");
      const query = optionalStr(args, "query")?.trim() ?? "";
      if (bucket) {
        const view = await openFolder(bucket, optionalStr(args, "prefix") ?? "");
        if (!view.ok) return { ok: false, error: view.error };
        // Words narrow the folder the way the box on screen does, before the
        // answer slices it, so a search never reports fewer files than the page finds.
        const matched = searchFiles(view.listing.files, query);
        const files = matched.slice(0, FOLDER_FILE_ROWS).map((file) => ({
          path: file.path,
          name: file.name,
          bytes: file.bytes,
          mime_type: file.mimeType,
          modified_at: file.modifiedAt,
          owner: file.owner,
        }));
        return {
          // The page's `truncated` flag only describes the storage listing's own
          // cap, so a folder of exactly 200 files read as complete from here
          // after this answer had dropped 140 of them. Both cuts are named.
          listing_note: `${folderReadNote({
            loaded: view.listing.files.length,
            matched: matched.length,
            shown: files.length,
            listingTruncated: view.listing.truncated,
            search: query || null,
          })}${listingCapNote(view.listing.truncated)}`,
          bucket: view.listing.bucketLabel,
          prefix: view.listing.prefix,
          folders: view.listing.folders.map((folder) => folder.prefix),
          files,
          truncated: view.listing.truncated,
        };
      }

      const { buckets, view } = await getFileBrowserData();
      const rootMatched = view.ok ? searchFiles(view.listing.files, query) : [];
      const rootFiles = view.ok
        ? rootMatched.slice(0, ROOT_FILE_ROWS).map((file) => ({
            path: file.path,
            name: file.name,
            bytes: file.bytes,
            owner: file.owner,
          }))
        : null;
      return {
        // Leads for the same reason: the bucket tile counts every object, and a
        // root listing hands back a fraction of them.
        root_note: view.ok
          ? `${folderReadNote({
              loaded: view.listing.files.length,
              matched: rootMatched.length,
              shown: rootFiles?.length ?? 0,
              listingTruncated: view.listing.truncated,
              search: query || null,
            })}${listingCapNote(view.listing.truncated)}`
          : "The root folder could not be listed, so no files are named.",
        buckets: buckets.map((each) => ({
          key: each.key,
          label: each.label,
          files: each.files,
          exact_count: each.exact,
        })),
        root: view.ok ? rootFiles : { error: view.error },
      };
    },
  },
  {
    name: "list_gate_questions",
    label: "Reading viability gate questions",
    description:
      "The questions the public apply form asks, which options keep an application in the running, which role each is asked on, and the openings they can be scoped to. Every question is listed; `jobs_note` says whether the openings beside them are all the console holds.",
    args: {},
    run: async () => {
      const console_ = await getGateConsoleData();
      const jobs = console_.jobs.slice(0, GATE_JOB_ROWS);
      return {
        // The questions below are uncapped, so an opening missing from this
        // list is a scoping limit of the read, not a role with no gate.
        jobs_note: reachNote("openings in the gate console", console_.jobs.length, jobs.length),
        questions: console_.questions.map((question) => ({
          id: question.id,
          question: question.question,
          help_text: question.helpText,
          job_id: question.jobId,
          scope: question.jobId ? "one role" : "every role",
          position: question.position,
          is_active: question.isActive,
          options: question.options,
        })),
        jobs,
      };
    },
  },
  {
    name: "list_team",
    label: "Reading the staff roster",
    description:
      "Every staff account with its profile id, role, company and whether sign-in is currently blocked, plus outstanding invites. These ids drive the team tools; the roster in get_settings does not show invite or ban state.",
    args: {},
    run: async () => {
      const [bundle, team] = await Promise.all([loadSettings(), loadStaffConsole()]);
      return {
        members: bundle.staff.map((member) => ({
          profile_id: member.id,
          full_name: member.full_name,
          email: member.email,
          role: member.role,
          company_id: member.tenant_id ?? null,
          blocked_until: team.access[member.id] ?? null,
        })),
        invites: team.invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          full_name: invite.full_name,
          role: invite.role,
          status: invite.status,
          expires_at: invite.expires_at,
          created_at: invite.created_at,
        })),
        access_error: team.accessError,
      };
    },
  },
  {
    name: "list_email_outbox",
    label: "Reading the email outbox",
    description:
      "The most recent emails the portal tried to send, with recipient, subject, delivered flag and the error when it failed. `failed` narrows the read to the mails the relay refused — the same rail `?failed=1` opens on the outbox page. `totals` counts every email and notice in the log, delivered or not, whether the rail is lit or not, so quote `scope_note` with it: it says which half of the log the rows are from and that portal notices are inbox rows, not mail.",
    args: {
      failed: "boolean — optional, true for the sends the relay refused",
      query: `string — optional, the email panel's own search box: ${emailSearchWords()}, matched over the attempts this read carries`,
    },
    run: async (args) => {
      const failed = bool(args, "failed", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const outbox = await getEmailOutbox({ failed });
      const matched = searchEmails(outbox.emails, query);
      const listed = matched.slice(0, 30);
      return {
        scope_note: emailScopeNote({
          failed,
          shown: listed.length,
          loaded: outbox.emails.length,
          totals: outbox.totals,
          search: query || null,
          matched: matched.length,
        }),
        totals: outbox.totals,
        emails: listed.map((row) => ({
          id: row.id,
          recipient: row.recipient,
          candidate_name: row.candidate_name,
          subject: row.subject,
          delivered: row.delivered,
          error_message: row.error_message,
          created_at: row.created_at,
        })),
      };
    },
  },

];
