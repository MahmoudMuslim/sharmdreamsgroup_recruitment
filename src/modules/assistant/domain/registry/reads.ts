// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool, JobReadFilter, OutboxBucket, ProspectStage } from "./shared";
import {
  ACTIVITY_AREAS,
  ACTIVITY_ENTITIES,
  ACTIVITY_SURFACES,
  ACTIVITY_TRAIL_ROWS,
  ACTOR_KINDS,
  AI_CAPABILITIES,
  ALL_SETTINGS,
  ANALYTICS_WINDOWS,
  ANSWER_ROWS,
  APPLICATION_SOURCES,
  CATEGORY_LABEL,
  CHART_VIEWS,
  DEFAULT_WINDOW,
  FILED_ENTITIES,
  JOB_STATUSES,
  MASTER_ENTITIES,
  MODEL_ROWS,
  OUTBOX_BUCKETS,
  PIPELINE_STAGES,
  PROSPECT_STAGES,
  REPORTS,
  SETTINGS_TRAIL_GROUPS,
  SETTINGS_TRAIL_LIMIT,
  SETTINGS_TRAIL_SEARCH_SCAN,
  TIME_LEDGER_ROWS,
  TIME_SCOPES,
  TIME_WINDOWS,
  ToolArgumentError,
  bool,
  byCategory,
  candidateScopeNote,
  candidateSearchWords,
  chartForView,
  clip,
  companyNameById,
  describeActor,
  elapsedSeconds,
  filedEntity,
  filterCandidates,
  formatSpan,
  getAnalyticsReport,
  getApplicantSubmission,
  getCandidateList,
  getCandidateTally,
  getDashboardAnalytics,
  getJobApplicants,
  getJobOpening,
  getLedger,
  getMasterData,
  getModelCatalogue,
  getOutbox,
  getProspectPool,
  getProspectProfile,
  getRowReport,
  getTemplates,
  getTrail,
  isChartView,
  isRunning,
  ledgerReachNote,
  listJobOpenings,
  listModelRouting,
  listSettingsTrail,
  loadSettings,
  masterEntity,
  masterListCounts,
  masterListNote,
  modelReadNote,
  modelSearchWords,
  noDriftSentence,
  openingReadNote,
  openingScopeWords,
  openingSearchWords,
  optionalChoice,
  optionalId,
  optionalStr,
  optionalWord,
  outboxScopeNote,
  poolScopeNote,
  projectMasterList,
  prospectSearchWords,
  queueSearchWords,
  reachNote,
  readFilingDrift,
  searchModels,
  searchOpenings,
  searchPool,
  searchQueue,
  searchSettings,
  searchSuites,
  settingReadNote,
  settingSearchWords,
  settingsTrailNote,
  str,
  subjectOf,
  suiteReadNote,
  suiteSearchWords,
  timeWindow,
  totalSeconds,
  TRAIL_PAGE_ROWS,
  TRAIL_WINDOWS,
  trailFind,
  trailGroup,
  trailPage,
  trailPageCount,
} from "./shared";

/* Reads tools. */

export const reads: readonly AssistantTool[] = [
  {
    name: "dashboard_analytics",
    label: "Reading hiring metrics",
    description:
      "Group-wide hiring analytics: totals, the pipeline as stage-by-stage populations with each stage's share of live applications, channel effectiveness, AI fit-score distribution, 14-day application volume and time-to-hire trend. Read `pipeline_note` and `candidates_note` before describing either: the stage figures are who sits somewhere now, not who moved. Pass `chart` when the answer is a shape — the chart is drawn from these figures on the recruiter's screen, not from anything you write, so say what it shows instead of reciting every row.",
    args: {
      chart: `string — optional, draw one of ${CHART_VIEWS.join(", ")} as a chart under your answer`,
    },
    run: async (args) => {
      const analytics = await getDashboardAnalytics();
      const requested = typeof args.chart === "string" ? args.chart.trim().toLowerCase() : "";
      const result: Record<string, unknown> = {
        // Both caveats lead, because a long result is clipped before the model
        // reads it and a sentence that falls off the end was never said.
        //
        // A stage count read as a transition is the oldest lie on this board, so
        // the read says what the figures are before the model can guess.
        pipeline_note: `${analytics.total_applications} live applications, each sitting at exactly one stage. These are current populations, not moves: vs_previous_stage compares two counts taken now, and Rejected carries none because it closes applications at every stage. Never describe any of these as a conversion rate.`,
        // The board's read is capped and ranked, and a masked caller is not
        // ranked at all — so name which ten these are instead of calling them
        // "top" and letting the count be inferred.
        candidates_note: `These ${Math.min(10, analytics.candidates.length)} of the ${analytics.candidates.length} applications the board loads (${analytics.total_applications} live in the pipeline) are the ${
          analytics.scores_masked ? "newest, because fit scores are masked for you" : "best-matching by AI fit"
        }.`,
        total_applications: analytics.total_applications,
        active_jobs: analytics.active_jobs,
        hires_this_quarter: analytics.hires_this_quarter,
        avg_fit_score: analytics.avg_fit_score,
        scored_applications: analytics.scored_applications,
        // When masked the two figures above are withheld, not zero — say so.
        scores_masked: analytics.scores_masked,
        avg_time_to_hire_days: analytics.avg_time_to_hire_days,
        pipeline: analytics.pipeline,
        channels: analytics.channels,
        fit_distribution: analytics.fit_distribution,
        time_to_hire_trend: analytics.time_to_hire_trend,
        applications_last_14_days: analytics.applications_last_14_days,
        top_candidates: analytics.candidates.slice(0, 10).map((candidate) => ({
          application_id: candidate.application_id,
          full_name: candidate.full_name,
          job_title: candidate.job_title,
          match_score: candidate.match_score,
          stage: candidate.stage,
        })),
      };

      if (!requested) return result;
      // A bad view name is a mistake about an option, not a failed read: the
      // figures above still answer the question, so this reports the choice that
      // exists rather than refusing the call.
      if (!isChartView(requested)) {
        return {
          ...result,
          chart_error: `No chart is called “${requested}”. Draw one of: ${CHART_VIEWS.join(", ")}.`,
        };
      }
      const build = chartForView(requested, result);
      if (!build.chart) {
        // The reason travels, so the reply says the picture could not be drawn
        // and why, instead of leaving a gap the recruiter fills in themselves.
        return { ...result, chart_view: requested, chart_unavailable: build.reason };
      }
      return { ...result, chart_view: requested };
    },
  },
  {
    name: "get_report",
    label: "Reading a report table",
    description:
      "One row-level report from /reports — the same list the page shows and every CSV, Excel and PDF export is built from. Returns the columns, the first rows and the caveats that list carries, so a figure quoted from here is quoted with what it leaves out. Totals come from dashboard_analytics; this is the detail behind them.",
    args: {
      report: `string — one of ${REPORTS.map((report) => report.id).join(", ")}`,
      window: `string — one of ${ANALYTICS_WINDOWS.map((option) => option.key).join(", ")}, where all is every record`,
    },
    run: async (args) => {
      const preview = await getRowReport(
        str(args, "report").toLowerCase(),
        str(args, "window").toLowerCase()
      );
      if (!preview.ok || !preview.sheet) {
        return { ok: false, error: preview.error ?? "That report could not be read." };
      }
      const rows = preview.sheet.rows.slice(0, 12);
      return {
        ok: true,
        report: preview.report,
        sheet: preview.sheet.name,
        scope: preview.scope ?? null,
        columns: preview.sheet.columns,
        rows: rows.map((row) => row.map((cell) => cell ?? "—")),
        rows_returned: rows.length,
        /** The page previews more rows than a reply carries, and says so. */
        total_rows: preview.totalRows ?? 0,
        limitations: preview.limitations ?? [],
      };
    },
  },
  {
    name: "get_analytics_report",
    label: "Reading the analytics report",
    description:
      "The aggregate figures /analytics draws for one window: tests issued → opened → finished with the median score, sourcing contacted → replied → converted, messages counted per channel, and interview panels with their no-shows. `complete` is false when a source hit its row cap, and the caveats say which, so a rate from here is never quoted as a full history it does not have. A portal notice is counted as read, never as delivered — only email and WhatsApp pass a relay.",
    args: {
      window: `string — one of ${ANALYTICS_WINDOWS.map((option) => option.key).join(", ")}, where all is every record`,
    },
    run: async (args) => {
      const result = await getAnalyticsReport(str(args, "window").toLowerCase());
      if (!result.ok || !result.report) {
        return { ok: false, error: result.error ?? "The report could not be built." };
      }
      const report = result.report;
      const { assessments, sourcing, messages, interviews } = report;
      return {
        ok: true,
        window: report.windowLabel,
        as_of: report.generatedAt,
        time_zone: report.timeZone,
        complete: report.complete,
        scores_hidden: report.scoresHidden,
        limitations: report.limitations,
        assessments: {
          issued: assessments.issued,
          opened: assessments.opened,
          submitted: assessments.submitted,
          graded: assessments.graded,
          in_progress: assessments.inProgress,
          expired: assessments.expired,
          open_rate: assessments.openRate,
          finish_rate: assessments.finishRate,
          median_invite_to_open_hours: assessments.medianInviteToOpenHours,
          median_time_on_test_minutes: assessments.medianTimeOnTestMinutes,
          median_score_percent: assessments.medianScorePercent,
          score_bands: assessments.scoreBands,
        },
        sourcing: {
          total: sourcing.total,
          contacted: sourcing.contacted,
          replied: sourcing.replied,
          interviewing: sourcing.interviewing,
          converted: sourcing.converted,
          reply_rate: sourcing.replyRate,
          conversion_rate: sourcing.conversionRate,
          stages: sourcing.stages,
        },
        messages: {
          scanned: messages.scanned,
          delivered: messages.delivered,
          undelivered: messages.undelivered,
          read: messages.read,
          by_channel: messages.byChannel,
        },
        interviews: {
          booked: interviews.booked,
          completed: interviews.completed,
          cancelled: interviews.cancelled,
          no_show: interviews.noShow,
          upcoming: interviews.upcoming,
          no_show_rate: interviews.noShowRate,
          median_lead_days: interviews.medianLeadDays,
          by_interviewer: interviews.byInterviewer,
        },
      };
    },
  },
  {
    name: "list_jobs",
    label: "Reading job openings",
    description:
      "Job openings newest first, with their status, company, department, location, employment type, seniority level, salary band and applicant count split the way the openings grid splits it: `applicants` everyone live, `in_pipeline` who holds a stage still being worked, `hired` the hired ones. These three are populations at an instant — who sits where now — never a movement, conversion or rate, and no headcount target is claimed here. `experience_level` is null when none was recorded; when the database has no such column yet, `schema_note` says so, and a null then means the level has nowhere to be stored rather than that a recruiter left it blank. Employment types include REMOTE and HYBRID once db/migrations/033_opening_terms.sql is applied; before that, writes naming them are refused. `status` and `company` are answered by the database, so `scope_note` counts that set; the search words are the openings grid's own box, matched over the rows this read carries. Quote `scope_note` whenever openings are counted or a role is reported missing — the read is a window into the set, and the note says what a search could reach.",
    args: {
      status: `string — optional, one of ${JOB_STATUSES.join(
        ", "
      )}, or HIREABLE for every role a person may still be filed under. Omit for all four.`,
      company:
        "string — optional, one company's id from get_master_data (its id, not its name), so the count is that company's openings rather than the group's",
      query: `string — optional, the grid's own search box: ${openingSearchWords()}, matched over the openings this read carries`,
    },
    run: async (args) => {
      const word = optionalStr(args, "status")?.toUpperCase() ?? null;
      if (word && word !== "HIREABLE" && !(JOB_STATUSES as readonly string[]).includes(word)) {
        throw new ToolArgumentError(
          `"status" must be one of: ${JOB_STATUSES.join(", ")}, or HIREABLE.`
        );
      }
      const filter = (word ?? null) as JobReadFilter;
      const company = optionalId(args, "company");
      const query = optionalStr(args, "query")?.trim() ?? "";
      // Status and company are answered by the query itself, in the database, so
      // the count is the set's size rather than the window's. Only the words are
      // applied here — through the grid's own predicate, so a role the chat finds
      // is a role the recruiter can find by typing the same letters.
      const { jobs, total, companyName, unknownCompany, termsNote } =
        await listJobOpenings(filter, company);
      if (unknownCompany) {
        throw new ToolArgumentError(
          "No company carries that id. get_master_data (entity companies) lists the group's companies with their ids."
        );
      }
      const matched = searchOpenings(jobs, query);
      return {
        scope_note: openingReadNote(
          total,
          jobs.length,
          openingScopeWords(filter, company ? companyName : null),
          matched.length,
          query || null
        ),
        // Only when the column itself is missing: otherwise silence means a
        // recruiter left the level unrecorded, which is a normal state.
        ...(termsNote ? { schema_note: termsNote } : {}),
        openings: matched.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company_name,
          status: job.status,
          department: job.department,
          location: job.location,
          employment_type: job.employment_type,
          experience_level: job.experience_level,
          sector: job.sector,
          salary: `${job.min_salary_usd ?? "?"}–${job.max_salary_usd ?? "?"} ${job.salary_currency ?? ""}`.trim(),
          applicants: job.applicants,
          // The grid's three-way split, so the chat and the table report the same
          // figures. These are populations at an instant — who holds a stage now —
          // never a movement or conversion. No headcount target: that column is
          // not applied yet, and the grid reads it in its own degradable query.
          in_pipeline: job.in_pipeline,
          hired: job.hired,
        })),
      };
    },
  },
  {
    name: "get_job",
    label: "Reading one opening",
    description:
      "One opening in full, including its description, requirement list, seniority level and the same live / in-pipeline / hired counts the grid shows beside its card (populations at an instant, not a movement, and no headcount target). `experience_level` is null when none was recorded; `schema_note` appears when the database has no level column yet. Read this before editing so unchanged fields are not lost.",
    args: { job_id: "string — the opening's id from list_jobs" },
    run: async (args) => {
      const found = await getJobOpening(str(args, "job_id"));
      if (!found) return { ok: false, error: "No opening has that id." };
      return {
        ok: true,
        job: found.job,
        ...(found.termsNote ? { schema_note: found.termsNote } : {}),
      };
    },
  },
  {
    name: "list_candidates",
    label: "Reading candidates",
    description:
      "The most recent applications with their pipeline stage, AI match score, job, company, assessment attempt and tracking code, filtered the way the candidates page's rails and search box filter. `stage`, `source` and `company` are answered by the database, so `scope_note` counts that set. Quote `scope_note` whenever the pipeline is counted or somebody is reported missing: the rows listed are a window, the note holds the counts and says what a search could have reached.",
    args: {
      stage: `string — optional, one of ${PIPELINE_STAGES.join(", ")} — the stage rail`,
      source: `string — optional, one of ${APPLICATION_SOURCES.join(", ")} — the channel rail`,
      company:
        "string — optional, one company's id from get_master_data (its id, not its name) — the company rail, so the set counted is that company's applications rather than the group's",
      archived:
        "boolean — optional, true for the archive the delete door files into instead of the live pipeline",
      query: `string — optional, the table's own search box: ${candidateSearchWords()}, matched over the rows the read carries`,
    },
    run: async (args) => {
      const stage = optionalChoice(args, "stage", PIPELINE_STAGES);
      const source = optionalChoice(args, "source", APPLICATION_SOURCES);
      const company = optionalId(args, "company");
      const archived = bool(args, "archived", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const [named, rows, tally] = await Promise.all([
        // Named in the same breath as the reads, and refused below before the
        // answer is written: an id no company carries must not come back as "that
        // company has no applications", which is what an empty read also looks like.
        company ? companyNameById(company) : Promise.resolve<string | null>(null),
        getCandidateList(archived, stage, source, company),
        getCandidateTally(archived),
      ]);
      if (company && !named) {
        throw new ToolArgumentError(
          "No company carries that id. get_master_data (entity companies) lists the group's companies with their ids."
        );
      }
      const scoped = company && named ? { id: company, name: named } : null;
      // The rails already narrowed the query in the database, so only the text
      // half is applied here — through the table's own predicate, so a match in
      // the chat is a match the recruiter can reproduce by typing the words.
      const matched = filterCandidates(rows, { stage: null, source: null, query, sort: "recent" });
      const shown = matched.slice(0, ANSWER_ROWS);
      return {
        scope_note: candidateScopeNote({
          archived,
          stage,
          source,
          company: scoped,
          shown: shown.length,
          loaded: rows.length,
          tally,
          query: query || null,
        }),
        // So a hidden score is never described to the recruiter as "not screened".
        scores_masked: rows[0]?.scores_masked ?? false,
        candidates: shown.map((row) => ({
          id: row.id,
          tracking_code: row.tracking_code,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          stage: row.stage,
          job_title: row.job_title,
          company: row.company_name,
          ai_match_score: row.ai_match_score,
          attempt_status: row.attempt_status,
          attempt_score: row.attempt_score,
          interviews: row.interviews.length,
        })),
      };
    },
  },
  {
    name: "get_job_applicants",
    label: "Reading applicants",
    description: "Everyone who applied to one opening, with their stage and assessment status.",
    args: { job_id: "string — the opening's id" },
    run: async (args) => {
      const result = await getJobApplicants(str(args, "job_id"));
      return result.ok ? result.applicants : { ok: false, error: result.error };
    },
  },
  {
    name: "get_application",
    label: "Reading one application",
    description:
      "What one candidate actually submitted: the CV text extracted from their file, a short-lived link to the file itself, and the AI screening summary.",
    args: { application_id: "string — the application's id" },
    run: async (args) => {
      const result = await getApplicantSubmission(str(args, "application_id"));
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        cv_text: clip(result.submission.cv_text),
        cv_url: result.submission.cv_url,
        screening_summary: clip(result.submission.screening_summary, 2000),
      };
    },
  },
  {
    name: "list_assessment_suites",
    label: "Reading assessment suites",
    description:
      "Every assessment suite with its question count, total points, time limit, whether it is active, and how many attempts it has. This read carries the whole catalogue rather than a window, so `suites_note` can say outright that a suite missing from the list has not been created — quote it whenever a suite is reported missing.",
    args: {
      query: `string — optional, the grid's own search box: ${suiteSearchWords()}, matched over every suite the catalogue holds`,
    },
    run: async (args) => {
      const query = optionalStr(args, "query")?.trim() ?? "";
      const templates = await getTemplates();
      const matched = searchSuites(templates, query);
      return {
        suites_note: suiteReadNote(templates.length, matched.length, query || null),
        suites: matched.map((template) => ({
          id: template.id,
          name: template.name,
          role_family: template.role_family,
          is_active: template.is_active,
          question_count: template.question_count,
          total_points: template.total_points,
          time_limit_minutes: template.time_limit_minutes,
          attempts: template.attempts,
          completed: template.completed,
        })),
      };
    },
  },
  {
    name: "list_prospects",
    label: "Reading sourcing pool",
    description:
      "The sourced-prospect pool with each prospect's stage, origin and linked opening, filtered the way the board's rails and search box filter. Quote `pool_note` whenever the size of the pool is stated or a person is reported missing: the rows listed are a window, the counts in the note are the pool, and a search only reaches rows inside it.",
    args: {
      stage: `string — optional, one of ${PROSPECT_STAGES.join(", ")} — the rail to read`,
      query: `string — optional, the board's own search box: ${prospectSearchWords()}, matched over the rows the read carries`,
    },
    run: async (args) => {
      const stage = optionalChoice(args, "stage", PROSPECT_STAGES) as ProspectStage | null;
      const query = optionalStr(args, "query")?.trim() ?? "";
      const { prospects, totals } = await getProspectPool({ stage });
      const matched = searchPool(prospects, query);
      const shown = matched.slice(0, ANSWER_ROWS);
      return {
        pool_note: poolScopeNote(totals, stage, shown.length, query || null),
        by_stage: totals.byStage,
        prospects: shown.map((prospect) => ({
          id: prospect.id,
          full_name: prospect.full_name,
          headline: prospect.headline,
          company: prospect.company,
          stage: prospect.stage,
          origin: prospect.origin,
          job_title: prospect.job_title,
          messages: prospect.messages,
        })),
      };
    },
  },
  {
    name: "get_prospect_profile",
    label: "Reading a stored prospect profile",
    description:
      "The structured profile stored on a sourced prospect — headline, company, location, skills, experience, education — with how it was captured and when. Nothing here reaches LinkedIn: a profile exists only because a recruiter pasted or uploaded the text themselves.",
    args: { id: "string — prospect id from list_prospects" },
    run: async (args) => {
      const stored = await getProspectProfile(str(args, "id"));
      if (!stored) return { ok: false, error: "That prospect is no longer in the pool." };
      if (!stored.profile) {
        return {
          ok: true,
          profile: null,
          last_error: stored.error,
          note: stored.error
            ? "No structured profile is stored, and the read that produced this error is named above."
            : "No profile has been read for this prospect yet.",
        };
      }
      return {
        ok: true,
        full_name: stored.full_name,
        headline: stored.headline,
        company: stored.company,
        captured_by: stored.source,
        captured_at: stored.captured_at,
        profile: stored.profile,
      };
    },
  },
  {
    name: "list_outbox",
    label: "Reading message outbox",
    description:
      "The WhatsApp outbox: queued and sent jobs with their status and attempts, plus the most recent delivery log. `bucket` is the queue's own column rail and is answered by the database; `failed` narrows the delivery log to the rows the channel refused. They are the two rails /whatsapp reads off its address bar, so pass them and the click-through shows the same set. `totals` counts every job and every undelivered log row whether a rail is lit or not, and the two rails narrow two different tables — so quote `scope_note` rather than counting the rows returned here.",
    args: {
      bucket: `string — optional, one of ${OUTBOX_BUCKETS.join(", ")} — the queue column to read, ALL for every column`,
      failed:
        "boolean — optional, true for the delivery-log rows the channel refused, which is what the alerts count",
      query: `string — optional, the queue's own search box: ${queueSearchWords()}, matched over the jobs this read carries`,
    },
    run: async (args) => {
      const bucket = optionalChoice(args, "bucket", OUTBOX_BUCKETS) as OutboxBucket | null;
      const failed = bool(args, "failed", false);
      const query = optionalStr(args, "query")?.trim() ?? "";
      const outbox = await getOutbox({ bucket, failed });
      // The words narrow the queue the way the panel's box does, before the
      // answer slices it: a search that ran after the slice would report "matched
      // 3" while the box on screen finds five.
      const matched = searchQueue(outbox.jobs, query);
      const queued = matched.slice(0, 40);
      const deliveries = outbox.history.slice(0, 15);
      return {
        scope_note: outboxScopeNote({
          bucket: bucket ?? "ALL",
          failed,
          shown: queued.length,
          loaded: outbox.jobs.length,
          logShown: deliveries.length,
          logLoaded: outbox.history.length,
          buckets: outbox.buckets,
          failedLogTotal: outbox.failedLogTotal,
          search: query || null,
          matched: matched.length,
        }),
        totals: {
          ...outbox.buckets,
          undelivered_log_rows: outbox.failedLogTotal,
        },
        queued: queued.map((job) => ({
          id: job.id,
          candidate_name: job.candidate_name,
          recipient_phone: job.recipient_phone,
          status: job.status,
          attempts: job.attempts,
          scheduled_for: job.scheduled_for,
          sent_at: job.sent_at,
          error_log: job.error_log,
          text: clip(job.text, 300),
        })),
        recent_deliveries: deliveries.map((row) => ({
          recipient: row.recipient,
          candidate_name: row.candidate_name,
          delivered: row.delivered,
          error_message: row.error_message,
          created_at: row.created_at,
        })),
      };
    },
  },
  {
    name: "get_settings",
    label: "Reading settings",
    description:
      `Organisation, assessment, security and AI settings currently in force, plus the staff roster, role permission grants and notification templates. \`query\` is the settings console's own box and runs over every setting it can show — by ${settingSearchWords()} — so an answer that names nothing says the platform has no such setting, and not merely that nobody has changed it. Most settings have no row of their own until someone edits them: a match with \`stored: false\` is real and runs on the default the code ships with.`,
    args: {
      query: `string — optional, the console's own search box: ${settingSearchWords()}, matched over every setting the console can show. Omit it for every stored value.`,
    },
    run: async (args) => {
      const bundle = await loadSettings();
      const query = optionalStr(args, "query")?.trim() ?? "";
      const rest = {
        companies: bundle.companies.map((company) => ({
          id: company.id,
          name: company.name,
          sector: company.sector,
        })),
        staff: bundle.staff.map((member) => ({
          id: member.id,
          full_name: member.full_name,
          email: member.email,
          role: member.role,
        })),
        roles: bundle.roles.map((role) => role.key),
        permission_grants: bundle.grants
          .filter((grant) => grant.granted)
          .map((grant) => `${grant.role_key}:${grant.permission_key}`),
        notification_templates: bundle.templates.map((template) => ({
          key: template.key,
          channel: template.channel,
          is_active: template.is_active,
        })),
      };
      if (!query) return { values: bundle.values, ...rest };
      // The schema is the searched set, not the stored rows — so a match can be
      // reported with no value beside it rather than left out of the answer.
      const listed = searchSettings(query).map((control) => {
        const value = bundle.values[control.key];
        return {
          key: control.key,
          name: control.label,
          section: control.sectionTitle,
          description: control.help ?? null,
          value: value ?? null,
          stored: value !== undefined,
        };
      });
      return {
        query,
        settings: listed,
        settings_note: settingReadNote({
          search: query,
          searched: ALL_SETTINGS.length,
          matched: listed.length,
          stored: listed.filter((row) => row.stored).length,
        }),
        ...rest,
      };
    },
  },
  {
    name: "get_master_data",
    label: "Reading a master-data list",
    description:
      "One controlled vocabulary, whole — the companies, departments, locations, role families, positions, skills or currencies the portal offers. Retired rows are included and marked is_active:false, exactly as the settings console lists them. A job stores its company by id and its department, location and currency by the text in these lists, so read each list you need before creating or editing a record, and use a row that is in use. A position carries the copy a new opening can inherit — title, department, responsibilities, requirements, salary band — and an opening's company must match the position's tenant_id unless that is null, which marks a group-wide post. The positions table arrives with db/migrations/026_positions.sql; until the owner applies it this call says the list has not been created rather than reporting it empty.",
    args: {
      entity: `string — one of ${MASTER_ENTITIES.join(", ")}, the list to read`,
    },
    run: async (args) => {
      const entity = masterEntity(str(args, "entity"));
      const bundle = await getMasterData();
      const rows = projectMasterList(entity, bundle);
      const unavailable = entity === "positions" && bundle.positionsAvailable === false;
      return {
        entity,
        rows,
        master_data_note: masterListNote({
          entity,
          rows,
          counts: masterListCounts(bundle),
          unavailable,
        }),
      };
    },
  },
  {
    name: "get_filing_drift",
    label: "Reading openings filed outside a list",
    description:
      "The job openings whose company, department, location or salary currency is not one of the master-data rows in use — grouped by the value the openings actually carry, each with the roles behind it. The live rows a refile may choose are in `destinations`, once per list, keyed by the same word a card's `entity` gives. A write refuses new drift; this is the drift the seeds left behind, and it is why the careers board offers an applicant a department the departments list does not hold. Answer from this before refile_filing; do not invent a `from` value or a `to` row.",
    args: {
      entity: `string — optional, one of ${FILED_ENTITIES.join(", ")}; left out, all four lists an opening files itself under are counted`,
    },
    run: async (args) => {
      const requested = optionalStr(args, "entity");
      const entity = requested ? filedEntity(requested) : undefined;
      const read = await readFilingDrift(entity);
      if (read.error) return { entities: entity ?? FILED_ENTITIES, filing_drift_note: read.error };

      const shown = read.cards.slice(0, ANSWER_ROWS);
      const left = read.cards.length - shown.length;
      return {
        entities: entity ? [entity] : [...FILED_ENTITIES],
        openings: read.openings,
        cards: shown,
        // Sent once per list rather than inside every card: four spellings of one
        // department share the same rows to move onto, and repeating the list four
        // times is what pushed this answer past the result clip and cut a card off.
        destinations: read.destinations,
        filing_drift_note: [
          read.cards.length ? read.note : noDriftSentence(read.openings),
          read.warning,
          left > 0
            ? `This answer names ${ANSWER_ROWS} of ${read.cards.length.toLocaleString()} drifting values — ask again with entity for one list.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
    },
  },
  {
    name: "list_model_routing",
    label: "Reading AI model routing",
    description:
      "Which model each AI capability is routed to, its fallback, temperature, max tokens and whether it is enabled.",
    args: {},
    run: async () => {
      const rows = await listModelRouting();
      return AI_CAPABILITIES.map((capability) => {
        const row = rows.find((entry) => entry.capability === capability.id);
        return {
          capability: capability.id,
          label: capability.label,
          description: capability.description,
          primary_model: row?.primaryModel ?? null,
          fallback_model: row?.fallbackModel ?? null,
          temperature: row?.temperature ?? null,
          max_tokens: row?.maxTokens ?? null,
          is_enabled: row?.isEnabled ?? null,
          configured: Boolean(row),
        };
      });
    },
  },
  {
    name: "list_models",
    label: "Reading the model catalogue",
    description:
      `The models this portal can actually call, with the qualified id a routing row is written with, its provider, prices and context length — the same list the AI models console searches and its routing pickers offer. Read it before save_model_routing: a model id invented here is a capability that fails on the next screening. \`query\` is the console's own box and runs over every callable model, so a search that names nothing says nothing about what the vendors list.`,
    args: {
      query: `string — optional, the console's own search box: ${modelSearchWords()}, matched over every model this portal can call`,
    },
    run: async (args) => {
      const query = optionalStr(args, "query")?.trim() ?? "";
      const catalogue = await getModelCatalogue();
      const labels = new Map(catalogue.sources.map((source) => [source.id, source.displayName]));
      // What the console's pickers offer, for the same reason: a model with no
      // caller in the gateway, or one the account switched off, cannot be routed
      // to, so listing it would invite exactly the routing row that breaks.
      const callable = catalogue.models.filter(
        (model) => model.routable && model.enabled !== false
      );
      const matched = searchModels(callable, query, labels);
      const models = matched.slice(0, MODEL_ROWS).map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        provider_label: labels.get(model.provider) ?? model.provider,
        free: model.free,
        prompt_price: model.promptPrice,
        completion_price: model.completionPrice,
        context_length: model.contextLength,
        detail: model.detail ?? null,
      }));
      return {
        // Leads for the same reason every other capped read does: the numbers a
        // recruiter acts on are the set searched, not the rows below them.
        models_note: `${modelReadNote({
          carried: catalogue.models.length,
          callable: callable.length,
          matched: matched.length,
          shown: models.length,
          cap: MODEL_ROWS,
          search: query || null,
          degradedSources: catalogue.sources.filter((source) => source.status === "degraded").length,
          silentSources: catalogue.sources.filter(
            (source) => source.status !== "ok" && source.status !== "degraded"
          ).length,
        })} The read is ${catalogue.degraded ? "partly a built-in fallback list" : "a live provider read"} as of ${catalogue.fetchedAt}.`,
        models,
        providers: catalogue.sources.map((source) => ({
          id: source.id,
          label: source.displayName,
          models: source.count,
          status: source.status,
          routable: source.routable,
        })),
      };
    },
  },
  {
    name: "get_audit_log",
    label: "Reading the settings change trail",
    description:
      "The Platform → Change trail console, row for row: which setting, message template, team account or stored file this portal wrote, the value before, the value after, when, and the person the door recorded. `group` narrows it to one part of the console exactly as the console's own `?trail=` does, `page` walks that scope backwards exactly as its `?page=` does, and `query` runs its search box exactly as `?find=` does, so this answer and that section read the same scope, the same page size, the same window and the same order and cannot disagree about which rows exist. A save writes one row per setting it moved and they all share a timestamp, so page 2 really is the 15 rows before page 1 rather than a shifted copy of it. The search matches the row as printed — the stored key, the console's name for it, either value, the actor's name — and the note says how far back it looked, because a match older than that window is not the same statement as no match at all. Values are printed short — a list of languages reads \"2 items\", a deleted row reads \"nothing\" — and the key is always there for the exact wording. Most rows name nobody, because the doors that wrote them recorded no actor, so the note says how many do instead of leaving a blank column to be read as \"nobody changed this\". This is the trail of things the console configures: an applicant moving stage or an interview being booked is not in this table.",
    args: {
      group: `string — optional, one of ${SETTINGS_TRAIL_GROUPS.map((group) => group.id).join("|")}, to read only the changes filed under that section or family`,
      page: `number — optional, 1-based, ${SETTINGS_TRAIL_LIMIT} rows a page: 1 is the newest, 2 the rows before them, and the note on any answer names the last page`,
      query: `string — optional, the console's own search box, matched over the newest ${SETTINGS_TRAIL_SEARCH_SCAN} rows of the scope and paged like any other listing; the note names the rows it searched`,
    },
    run: async (args) => {
      const asked = optionalStr(args, "group");
      const scope = asked === undefined ? null : trailGroup(asked);
      if (asked !== undefined && scope === null) {
        throw new ToolArgumentError(
          `"group" must be one of ${SETTINGS_TRAIL_GROUPS.map((group) => group.id).join(
            ", "
          )} — the sections and families the trail files rows under, exactly as the console names them.`
        );
      }
      const askedWords = optionalStr(args, "query");
      const words = askedWords === undefined ? null : trailFind(askedWords);
      // Refused rather than defaulted: a model that wrote `page: "last"` has not
      // asked for the newest rows, and answering a different question quietly is
      // worse than telling it what the argument takes.
      const askedPage = args.page;
      if (askedPage !== undefined && askedPage !== null && askedPage !== "") {
        const parsed = typeof askedPage === "number" ? askedPage : Number(String(askedPage).trim());
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new ToolArgumentError(
            `"page" must be a whole number from 1 — 1 is the newest ${SETTINGS_TRAIL_LIMIT} rows of the scope, 2 the rows before them.`
          );
        }
      }
      const page =
        askedPage === undefined || askedPage === null || askedPage === ""
          ? 1
          : trailPage(askedPage as string | number);
      const result = await listSettingsTrail({ group: scope, page, find: words });
      if (!result.ok) {
        // Answered as a refusal, with no counts invented behind it. An empty list
        // would let the model tell a recruiter nobody has changed anything, which
        // is a sentence about their permissions rather than about the portal.
        return { audit_refused: true, audit_note: result.error, audit_scope: scope, audit: [] };
      }
      return {
        audit_note: settingsTrailNote({
          groupId: scope,
          total: result.total,
          loaded: result.entries.length,
          named: result.named,
          page: result.page,
          search: result.find === null ? null : {
            words: result.find,
            scanned: result.scanned,
            scopeRows: result.scopeRows,
          },
        }),
        audit_scope: scope,
        audit_page: result.page,
        audit_pages: trailPageCount(result.total),
        audit_total: result.total,
        audit_named: result.named,
        // The three the console's box shows under its own heading, so an answer
        // about "the timeout change" can say which rows it looked through.
        audit_find: result.find,
        audit_scanned: result.scanned,
        audit_scope_rows: result.scopeRows,
        audit: result.entries.map((entry) => ({
          key: entry.key,
          label: entry.label,
          group: entry.group,
          from: entry.from,
          to: entry.to,
          actor: entry.actor,
          at: entry.createdAt,
        })),
      };
    },
  },
  {
    name: "get_activity_trail",
    label: "Reading the change trail",
    description:
      "The Activity console (/activity), row for row: every change the portal recorded against the hiring data or the platform, newest first — a recruiter moving a candidate, the screening engine scoring an applicant, a candidate submitting a test, the scheduler closing an expired link, a setting or team account saved. Each row says who or what made the change, when, through which screen (`via`), which record it touched, and what moved. This is the whole portal, not one console: for the Platform → Change trail of settings and credentials use get_audit_log, which reads a different table. `window`, `area`, `actor_kind`, `surface`, `entity` and `query` are the screen's own filters, so an answer and the click-through describe the same rows; `page` walks the cut newest-first exactly as the console's pager does. The note opens with how many changes the cut holds and how many of them this answer lists — a page is 40 rows and an answer only a handful — so never call the listed rows the whole cut, and quote the total and page from the note rather than counting the rows it sent. `trail_tally` is the all-time split by who made a change over the entire table: it is not the cut, so do not present it as one. A refusal (trail_refused) is about the reader's permission, not an empty trail. Named fields a change moved are not in this answer; the console shows them on each row and get_audit_log carries them for settings.",
    args: {
      window: `string — optional, one of ${TRAIL_WINDOWS.map((option) => option.key).join("|")} (the console's ?window=): how far back the read looks, default ${TRAIL_WINDOWS[2].key} — ${TRAIL_WINDOWS[2].label.toLowerCase()}`,
      area: `string — optional, one of ${ACTIVITY_AREAS.join("|")}: which part of the portal the change touched`,
      actor_kind: `string — optional, one of ${ACTOR_KINDS.join("|")}: who made the change, not who it was about — the console's actor pills`,
      surface: `string — optional, one of ${ACTIVITY_SURFACES.join("|")}: the door the change arrived through (the console's ?surface=)`,
      entity: `string — optional, one of ${ACTIVITY_ENTITIES.join("|")}: the kind of record a row points at`,
      entity_id: "string — optional, the uuid of one record, exactly as another read returned it: with `entity`, answers \"the history of this application\"",
      query: "string — optional, the console's search box: matched against the stored summary and the actor label",
      page: `number — optional, 1-based, ${TRAIL_PAGE_ROWS} rows a page: 1 is the newest, 2 the rows before them, and the note says which page it read`,
    },
    run: async (args) => {
      const window = optionalWord(args, "window", TRAIL_WINDOWS.map((option) => option.key));
      const actorKind = optionalChoice(args, "actor_kind", ACTOR_KINDS);
      const surface = optionalWord(args, "surface", ACTIVITY_SURFACES);
      const area = optionalWord(args, "area", ACTIVITY_AREAS);
      const entity = optionalWord(args, "entity", ACTIVITY_ENTITIES);
      const entityId = optionalId(args, "entity_id");
      const query = optionalStr(args, "query");
      if (entityId !== null && entity === null) {
        throw new ToolArgumentError(
          "\"entity_id\" narrows one record, so it needs \"entity\" to say what kind of record it is — the same words this tool lists."
        );
      }
      const askedPage = args.page;
      if (askedPage !== undefined && askedPage !== null && askedPage !== "") {
        const parsed = typeof askedPage === "number" ? askedPage : Number(String(askedPage).trim());
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new ToolArgumentError(
            `"page" must be a whole number from 1 — 1 is the newest ${TRAIL_PAGE_ROWS} rows of the cut, 2 the rows before them.`
          );
        }
      }

      const result = await getTrail({
        area: area ?? undefined,
        actorKind: actorKind ?? undefined,
        surface: surface ?? undefined,
        entity: entity ?? undefined,
        entityId: entityId ?? undefined,
        query: query === undefined ? undefined : query,
        window: window ?? undefined,
        page: askedPage === undefined || askedPage === null || askedPage === "" ? undefined : askedPage,
      });

      if (!result.ok || !result.view) {
        // A refusal in its own words. An empty list would let the model report
        // "nothing has changed", which is a sentence about permissions.
        return {
          trail_refused: true,
          trail_note: result.error ?? "The change trail could not be read.",
          trail: [],
        };
      }

      const view = result.view;
      const listed = view.rows.slice(0, ACTIVITY_TRAIL_ROWS);
      return {
        // First, because the result is clipped at a fixed length: a caveat that
        // sits behind the rows it describes is cut off along with them.
        trail_note: `${reachNote("changes in this cut", view.total, listed.length)} Cut: ${view.scope}. ${
          view.pages > 1
            ? `This read page ${view.page} of ${view.pages} — ${view.size} rows a page, newest first — and the console opens the same page of the same cut.`
            : "That cut fits on one page."
        } trail_tally is all-time over the whole trail, not this cut.`,
        trail_scope: view.scope,
        trail_total: view.total,
        trail_page: view.page,
        trail_pages: view.pages,
        trail_size: view.size,
        trail_tally: view.tally,
        // The cut as the server accepted it, so the link builder rebuilds the
        // read rather than trusting the arguments the model typed.
        trail_filters: view.filters,
        trail: listed.map((row) => ({
          at: row.created_at,
          area: row.area,
          action: row.action,
          entity: row.entity,
          entity_id: row.entity_id,
          who: row.actor_kind,
          // The label is column-capped at 160, but the name a row joins in is
          // not: clip the composed line so one long account name cannot push a
          // row past this answer's budget.
          actor: clip(describeActor(row), 240),
          via: row.via,
          summary: row.summary,
        })),
      };
    },
  },
  {
    name: "get_time_ledger",
    label: "Reading the time ledger",
    description:
      "The Time Tracker console (/time), cut by cut: the spans people logged against their work — what was done, the category, the candidate or opening it was attached to, when it started, how long it ran, and whose hours they are. `window` and `scope` are the screen's own pills and its `?window=`/`?scope=` parameters, so this answer and the click-through describe the same cut. `scope: team` reads every colleague's hours and needs the same permission the screen does; a refusal (ledger_refused) is about that permission, not an empty ledger. The note opens with three different numbers — how many spans the cut holds, how many the capped read loaded, and how many this answer lists — so never call the listed rows the cut, never sum them as if they were the whole window, and quote the note's figures rather than counting the rows it sent. The screen loads at most 1,000 spans and narrowing the window is how older ones become reachable. A timer you left running is always included whatever the window, because it has no end to filter by — a colleague's running timer is only in the cut if it started inside it. This ledger holds only what a person logged by hand or with a timer: a stage move, an interview or a grade adds nothing to it. For changes to the hiring data use get_activity_trail, which reads a different table.",
    args: {
      window: `string — optional, one of ${TIME_WINDOWS.map((option) => option.key).join("|")} (the screen's ?window=): how far back the cut looks, default ${DEFAULT_WINDOW} — ${timeWindow(DEFAULT_WINDOW).label.toLowerCase()}`,
      scope: `string — optional, one of ${TIME_SCOPES.join("|")} (the screen's ?scope=): whose hours, default mine — the caller's own; team reads every colleague's hours`,
    },
    run: async (args) => {
      // Both vocabularies are lowercase, so `optionalWord` rather than
      // `optionalChoice` — the latter upper-cases and would refuse both values.
      const window = optionalWord(args, "window", TIME_WINDOWS.map((option) => option.key));
      const scope = optionalWord(args, "scope", TIME_SCOPES);
      const result = await getLedger({ window: window ?? undefined, scope: scope ?? undefined });

      if (!result.ok || !result.view) {
        // A refusal in its own words. An empty ledger would let the model tell a
        // recruiter nothing has been logged, which is a sentence about permission.
        return {
          ledger_refused: true,
          ledger_note: result.error ?? "The time ledger could not be read.",
          ledger: [],
        };
      }

      const view = result.view;
      const nowMs = Date.parse(view.now);
      const listed = view.entries.slice(0, TIME_LEDGER_ROWS);
      const logged = totalSeconds(view.entries, nowMs);

      return {
        // First, because the result is clipped at a fixed length: a disclosure
        // that sits behind the rows it describes is cut off along with them.
        ledger_note: ledgerReachNote({
          total: view.total,
          carried: view.carried,
          loaded: view.entries.length,
          listed: listed.length,
          limit: view.limit,
          running: view.entries.filter((entry) => isRunning(entry)).length,
          scopeNote: view.scopeNote,
        }),
        ledger_window: view.window,
        ledger_scope: view.scope,
        // The timezone is inside scopeNote ("on the Africa/Cairo clock"), the
        // sentence the screen prints above the same rows.
        ledger_total: view.total,
        ledger_carried: view.carried,
        ledger_limit: view.limit,
        ledger_listed: listed.length,
        // Over the loaded spans only; the note says so whenever the cut is
        // larger than what the read carries.
        ledger_logged_seconds: logged,
        ledger_logged: formatSpan(logged),
        ledger_categories: byCategory(view.entries, nowMs).map((slice) => ({
          category: slice.key,
          label: slice.label,
          span: formatSpan(slice.seconds),
          entries: slice.entries,
        })),
        ledger: listed.map((entry) => ({
          id: entry.id,
          started_at: entry.started_at,
          ended_at: entry.ended_at,
          span: formatSpan(elapsedSeconds(entry, nowMs)),
          running: isRunning(entry),
          category: CATEGORY_LABEL[entry.category],
          task: entry.task,
          // The note column is 500 characters in the table and is the widest
          // free text a row carries, so it travels clipped and marked.
          note: clip(entry.note, 200),
          staff: clip(entry.staff_name, 80) ?? "A colleague",
          subject: clip(subjectOf(entry), 160),
        })),
      };
    },
  },

];
