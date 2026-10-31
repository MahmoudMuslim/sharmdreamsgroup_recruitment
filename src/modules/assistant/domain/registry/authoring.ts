// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import {
  copyBankQuestion,
  recommendTests,
} from "@/modules/assistant/application/sources";
import type { AssistantTool } from "./shared";
import {
  QUESTION_TYPES,
  ToolArgumentError,
  bool,
  moveQuestion,
  num,
  optionalStr,
  questionDraftFrom,
  report,
  saveQuestion,
  saveTemplate,
  setTemplateActive,
  str,
} from "./shared";

/* Authoring tests tools. */

export const authoring: readonly AssistantTool[] = [
  {
    name: "save_assessment_suite",
    label: "Saving an assessment suite",
    description:
      "Create an assessment suite, or rewrite one when suite_id is given. A suite is only useful once it has questions — add them with save_question, then assign the suite with assign_assessment. A suite can also carry a second-test rule: the suite to issue when a fully marked paper scores inside a percent band. Leave all three follow-up arguments out to keep the stored rule exactly as it is; an empty follow_up_suite_id with an empty band switches the rule off.",
    args: {
      suite_id: "string — optional, the suite being edited",
      tenant_id: "string — company id from get_master_data (entity companies), required when creating",
      name: "string",
      description: "string — optional",
      role_family: "string — role family label from get_master_data (entity role_families)",
      time_limit_minutes: "number — for the whole suite",
      randomize_questions: "boolean — optional, defaults to false",
      randomize_options: "boolean — optional, defaults to false",
      block_copy_paste: "boolean — optional, defaults to true",
      follow_up_suite_id: "string — optional, the suite to issue as a second test; same company as this suite, never this suite itself",
      follow_up_min_percent: "number — optional, bottom of the band, 0–100, inclusive",
      follow_up_max_percent: "number — optional, top of the band, 0–100, inclusive",
    },
    run: async (args) => {
      // The rule is sent only when the caller named one of its three fields: a
      // model rewriting a suite's name must not erase the second test by not
      // mentioning it. The form treats a target with no band as half a rule, and
      // the domain refuses it rather than inventing a band.
      const namedRule =
        args.follow_up_suite_id !== undefined ||
        args.follow_up_min_percent !== undefined ||
        args.follow_up_max_percent !== undefined;
      const percentText = (value: unknown) =>
        value === undefined || value === null ? "" : String(value);
      const payload = {
        id: optionalStr(args, "suite_id") ?? null,
        tenant_id: str(args, "tenant_id"),
        name: str(args, "name"),
        description: optionalStr(args, "description") ?? "",
        role_family: str(args, "role_family"),
        time_limit_minutes: num(args, "time_limit_minutes"),
        randomize_questions: bool(args, "randomize_questions", false),
        randomize_options: bool(args, "randomize_options", false),
        block_copy_paste: bool(args, "block_copy_paste", true),
      };
      return report(
        await saveTemplate(
          namedRule
            ? {
                ...payload,
                follow_up: {
                  templateId:
                    typeof args.follow_up_suite_id === "string" ? args.follow_up_suite_id : "",
                  minPercent: percentText(args.follow_up_min_percent),
                  maxPercent: percentText(args.follow_up_max_percent),
                },
              }
            : payload
        )
      );
    },
  },
  {
    name: "set_assessment_suite_active",
    label: "Pausing or resuming a suite",
    description:
      "Publish or pause a suite. Pausing closes the assign door; a link already in a candidate's inbox keeps working, which is why this is the way to retire a suite that has been sat.",
    args: {
      suite_id: "string — suite id from list_assessment_suites",
      active: "boolean — true to publish, false to pause",
    },
    run: async (args) =>
      report(await setTemplateActive(str(args, "suite_id"), bool(args, "active", true))),
  },
  {
    name: "save_question",
    label: "Saving a question",
    description:
      "Add a question to a suite, or rewrite one when id is given. Read the suite with get_assessment_suite first: a save writes the whole question, and an EXCEL_MODEL question must come back with its config in preserve_config or the spreadsheet definition is lost. A SITUATIONAL_JUDGMENT scene puts the workplace scenario in prompt and rates each response 0–100; no response is marked correct. A CODING question names one language from the closed list and may carry an optional starter snippet; the platform never runs, compiles or tests the candidate's code, so never ask them to run or test it. A CASE_STUDY, VIDEO_PITCH or CODING question can carry a marking scheme — the named criteria its answer is marked against, which the grader scores one by one and reports with the evidence it quoted. A criterion may name one skill from the catalogue; the paper's answers drawer then totals the marks each skill earned across the paper.",
    args: {
      id: "string — optional, the question being edited",
      template_id: "string — suite id",
      question_type: `string — one of ${QUESTION_TYPES.join(", ")}`,
      title: "string",
      prompt: "string — what the candidate is asked",
      instructions: "string — optional",
      points: "number",
      position: "number — optional, order in the suite",
      time_limit_minutes: "number — optional, per question",
      shuffle_options: "boolean — optional",
      options:
        "object[] — MULTIPLE_CHOICE: [{\"text\":\"answer\",\"is_correct\":true}, …], at least two; SITUATIONAL_JUDGMENT: [{\"text\":\"response\",\"score\":0-100}, …], at least two with different scores and no is_correct",
      context: "string — optional, the case study brief",
      min_words: "number — optional, case study minimum",
      language:
        "string — CODING only: one of JavaScript, TypeScript, Python, Java, C#, Go, SQL, PHP, Ruby, C++",
      starter_code:
        "string — CODING only: optional snippet shown beside the prompt; never graded",
      min_duration_seconds: "number — optional, video pitch minimum",
      max_duration_seconds: "number — optional, video pitch maximum",
      rubric:
        "object[] — CASE_STUDY, VIDEO_PITCH and CODING: the marking scheme, [{\"label\":\"Diagnoses the cause\",\"weight\":40,\"description\":\"Names the driver before proposing anything\",\"skill_id\":\"optional catalogue skill id\"}, …]. Two to six criteria, and their weights are shares of the question's marks adding to 100. A criterion may name one skill from the skills catalogue by id; the write door checks the id and stores the catalogue's own spelling. An untagged criterion contributes to no skill's report. Leave the rubric out to keep the scheme already stored; send [] to retire it.",
      preserve_config: "object — optional, the config object exactly as read back",
    },
    run: async (args) => report(await saveQuestion(questionDraftFrom(args))),
  },
  {
    name: "move_question",
    label: "Reordering a question",
    description: "Move one question one slot up or down; the suite is renumbered after it.",
    args: {
      question_id: "string",
      template_id: "string — the suite it belongs to",
      direction: "string — up or down",
    },
    run: async (args) => {
      const direction = str(args, "direction").toLowerCase();
      if (direction !== "up" && direction !== "down") {
        throw new ToolArgumentError('"direction" must be "up" or "down".');
      }
      return report(await moveQuestion(str(args, "question_id"), str(args, "template_id"), direction));
    },
  },
  {
    name: "copy_bank_question",
    label: "Copying a question between the gate and a suite",
    description:
      "Copy one question from the question bank's two stores into the other: from the apply-form gate questions into an assessment suite, or from a suite into a published role's gate form or its shared form. The copy goes through the action that owns the destination, so its permission check, validation and trail row still apply. Read list_gate_questions or get_assessment_suite first for the question id; `place_key` is a job id, `shared` for every published role's form, or a suite template id.",
    args: {
      store: "string — gate or suite, which store the question is read from",
      id: "string — the question's id in that store",
      target: "string — gate or suite, which store the copy lands in",
      place_key:
        "string — the destination: a job id, `shared` for every published role (gate target only), or a suite template id",
    },
    run: async (args) => {
      const store = str(args, "store").toLowerCase();
      const target = str(args, "target").toLowerCase();
      if (store !== "gate" && store !== "suite") {
        throw new ToolArgumentError('"store" must be "gate" or "suite".');
      }
      if (target !== "gate" && target !== "suite") {
        throw new ToolArgumentError('"target" must be "gate" or "suite".');
      }
      return report(
        await copyBankQuestion({
          store,
          id: str(args, "id"),
          target,
          placeKey: str(args, "place_key"),
        })
      );
    },
  },
  {
    name: "recommend_tests",
    label: "Recommending tests for an opening",
    description:
      "Ask the AI gateway to read one hireable opening's requirements and choose from the existing assessment suites what a candidate should sit, inside a time budget of 5 to 480 whole minutes. It changes nothing: what comes back is the opening, the requirements it read, the recommended suites with their reasons and the ids of the ones it would issue. Needs AI features switched on and the Create assessments permission; save or assign whatever the recruiter approves with the assessment tools.",
    args: {
      opening_id: "string — from list_jobs, a draft, published or paused opening",
      budget_minutes: "number — 5 to 480, whole minutes the candidate can sit",
    },
    run: async (args) =>
      report(
        await recommendTests({
          openingId: str(args, "opening_id"),
          budgetMinutes: num(args, "budget_minutes"),
        })
      ),
  },
];
