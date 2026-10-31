"use server";

import { createServerRestClient } from "@/lib/data-api/server";
import { readOpeningPickerWindow } from "@/infrastructure/repositories/jobOpening";
import type { RestClient } from "@/lib/rest/client";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { hasAiProvider } from "@/lib/config.server";
import { getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";
import { getMasterOptions } from "@/modules/settings/application/master-data-actions";
import { withActivityContext } from "@/modules/activity/application/record";
import {
  HIREABLE_STATUSES,
  PICKER_LIMIT,
  closedOpeningRefusal,
  isHireable,
  openingOptionLabel,
  pickerWindowNote,
} from "@/modules/jobs/domain/hireable";
import { generateAssessmentSuite } from "@/modules/screening/infrastructure/openRouterEngine";
import { TruncatedJsonResponseError } from "@/modules/screening/infrastructure/aiGateway";
import {
  MAX_DRAFTS_PER_RUN,
  DIFFICULTIES,
  reviewSuite,
  suiteReviewNote,
  type AuthoringBrief,
  type Difficulty,
  type GeneratedQuestion,
  type GeneratedSuite,
  type OpeningSeed,
  type SuiteSeedingContext,
} from "@/modules/assessment/domain/aiAuthoring";
import { saveTemplate, type TemplateResult } from "./assessment-actions";
import { addDraftedQuestions, type DraftWriteResult } from "./question-actions";
import type { QuestionType } from "@/types";

/**
 * Drafting a whole test suite from a job opening.
 *
 * A recruiter who has just written a vacancy has already described the work: the
 * tools, the judgement calls, the figures the role handles. Writing a test for it
 * means restating all of that into four question types, which is the part that
 * takes an afternoon. So the opening is handed to the model as the brief, and the
 * suite comes back for review.
 *
 * Two doors, exactly like the question desk, and for the same reason:
 * `draftSuite` spends the model request and stores nothing; `createDraftedSuite`
 * is the only path that writes, and a recruiter clicks it. Between them the shell
 * is checked by `reviewSuite` and every question by `saveQuestion`, so the suite
 * that lands is one the runner can actually administer.
 */

const QUESTION_TYPES: QuestionType[] = [
  "MULTIPLE_CHOICE",
  "CASE_STUDY",
  "EXCEL_MODEL",
  "VIDEO_PITCH",
];

const TOPIC_CAP = 400;
const NOTES_CAP = 600;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* -------------------------------------------------------------------------- */
/* The openings a test can be written for                                     */
/* -------------------------------------------------------------------------- */

export interface AuthoringOpeningOption {
  id: string;
  /** Title plus its status, because a draft role is still a real one. */
  label: string;
  title: string;
  status: string;
}

export interface OpeningsRead {
  openings: AuthoringOpeningOption[];
  /** Says what the picker left out — the same window note every other opening picker gives. */
  note: string | null;
  error: string | null;
}

/**
 * The openings offered to the suite desk.
 *
 * Read when the drawer opens, not when the page loads: a role posted ten minutes
 * ago is a role a recruiter can write a test for, and this page should not pay
 * for a job query nobody asked.
 */
export async function getOpeningsForAuthoring(): Promise<OpeningsRead> {
  await requireStaff("/assessments");
  if (!(await hasPermissionForUser("assessments.create"))) {
    return { openings: [], note: null, error: "You need the Create assessments permission." };
  }

  const restClient = await createServerRestClient();
  const picker = await readOpeningPickerWindow(restClient, {
    statuses: HIREABLE_STATUSES,
    limit: PICKER_LIMIT,
  });

  if (!picker.ok) {
    return { openings: [], note: null, error: picker.error };
  }

  const openings = picker.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    label: openingOptionLabel(row.title, row.status),
  }));

  return {
    openings,
    note: pickerWindowNote(picker.total ?? openings.length, openings.length),
    error: null,
  };
}

/** The vacancy a draft is written for, in the words the recruiter filed. */
async function readOpeningSeed(
  restClient: RestClient,
  openingId: string
): Promise<OpeningSeed | string> {
  const { data, error } = await restClient
    .from("job_openings")
    .select("id, title, department, location, description, requirements, status")
    .eq("id", openingId)
    .maybeSingle();

  if (error) return `That opening could not be read: ${error.message}`;
  if (!data) return "That opening no longer exists.";
  // A closed role gets the same refusal every other picker gives it — its test
  // would be sat for a job the group has stopped hiring for.
  if (!isHireable(data.status)) return closedOpeningRefusal(data.title);

  return {
    id: data.id,
    title: data.title,
    department: data.department ?? "",
    location: data.location ?? "",
    description: data.description ?? "",
    requirements: (Array.isArray(data.requirements) ? data.requirements : []).filter(
      // `unknown` named explicitly because the row arrives untyped: a type
      // predicate cannot narrow a parameter whose type is implicit `any`.
      (entry: unknown): entry is string => typeof entry === "string"
    ),
    status: data.status,
  };
}

/* -------------------------------------------------------------------------- */
/* Drafting                                                                    */
/* -------------------------------------------------------------------------- */

export interface SuiteAuthoringInput {
  /** "" means write from the topic alone — no opening has to be involved. */
  openingId: string;
  topic: string;
  types: QuestionType[];
  count: number;
  difficulty: Difficulty;
  pointsEach: number;
  notes: string;
  /** The family the desk is showing, used when the model names one that is not on file. */
  roleFamily: string;
}

export interface SuiteDraftResult extends TemplateResult {
  suite?: GeneratedSuite;
  drafts?: GeneratedQuestion[];
  dropped?: string[];
  /** What creating this would write, in one sentence. */
  note?: string;
  model?: string;
  /** The opening the run was written from, echoed back so the desk can name it. */
  opening?: string;
}

/**
 * Writes a suite and its questions, and stores neither.
 *
 * `reviewSuite` is what makes this safe to offer: the name, the family and the
 * clock come back checked against master data and Settings, and the questions
 * against the runner's own rules, before a recruiter is shown a Create button.
 */
export async function draftSuite(input: SuiteAuthoringInput): Promise<SuiteDraftResult> {
  await requireStaff("/assessments");
  if (!(await hasPermissionForUser("assessments.create"))) {
    return { ok: false, error: "You need the Create assessments permission." };
  }
  if (!hasAiProvider()) {
    return { ok: false, error: "No AI provider key is configured, so nothing can be drafted." };
  }

  const types = (input.types ?? []).filter((type) => QUESTION_TYPES.includes(type));
  if (types.length === 0) {
    return { ok: false, error: "Tick at least one question type to draft." };
  }

  const topic = (input.topic ?? "").trim().slice(0, TOPIC_CAP);
  const openingId = (input.openingId ?? "").trim();
  if (!openingId && topic.length < 4) {
    return {
      ok: false,
      error: "Choose an opening, or say what the test should cover.",
    };
  }

  const restClient = await createServerRestClient();

  let opening: OpeningSeed | null = null;
  if (openingId) {
    const seed = await readOpeningSeed(restClient, openingId);
    if (typeof seed === "string") return { ok: false, error: seed };
    opening = seed;
  }

  const [options, defaultDurationMinutes, suites] = await Promise.all([
    getMasterOptions(),
    getNumberSetting("assessment.default_duration_minutes", 60),
    restClient.from("assessment_templates").select("name"),
  ]);

  const brief: AuthoringBrief = {
    topic,
    types,
    count: clampInt(input.count, 1, MAX_DRAFTS_PER_RUN, 5),
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : "MID",
    pointsEach: clampInt(input.pointsEach, 1, 100, 10),
    notes: (input.notes ?? "").trim().slice(0, NOTES_CAP),
  };

  const context: SuiteSeedingContext = {
    opening,
    fallbackRoleFamily: input.roleFamily || options.roleFamilies[0]?.key || "",
    roleFamilies: options.roleFamilies.map((family) => family.key),
    existingNames: (suites.data ?? []).map((row: { name: string }) => row.name),
    defaultDurationMinutes,
  };

  let generated: Awaited<ReturnType<typeof generateAssessmentSuite>>;
  try {
    generated = await generateAssessmentSuite(brief, context);
  } catch (cause) {
    // The gateway's cut-off sentence is written for the grading desk, where a
    // verdict is what goes missing. Nothing is graded here, so the desk says what
    // actually stopped and what a recruiter can do about it.
    if (cause instanceof TruncatedJsonResponseError) {
      return {
        ok: false,
        error:
          "The model ran out of room before it finished the suite, so nothing was drafted. Ask for fewer questions and run it again.",
      };
    }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "The model did not return a suite.",
    };
  }

  const review = reviewSuite(generated.parsed, brief, context);

  return {
    ok: true,
    suite: review.suite,
    drafts: review.review.drafts,
    dropped: review.review.dropped,
    note: suiteReviewNote(review),
    model: generated.model,
    opening: opening?.title,
  };
}

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

export interface SuiteCreateInput {
  companyId: string;
  name: string;
  description: string;
  roleFamily: string;
  timeLimitMinutes: number;
  blockCopyPaste: boolean;
  /** The drafts the recruiter kept on the desk. */
  drafts: GeneratedQuestion[];
}

export interface SuiteCreateResult extends TemplateResult {
  created?: number;
  refused?: DraftWriteResult["refused"];
  /** Set when the suite exists but its questions did not. */
  warning?: string;
}

/**
 * Creates the reviewed suite and adds the questions the recruiter kept.
 *
 * Nothing here trusts the desk: the shell is re-checked against the same master
 * data and the same Settings value the create form uses, and the drafts go
 * through `addDraftedQuestions`, which rebuilds every spreadsheet and hands each
 * row to `saveQuestion`. So the suite this writes is a suite the manual editor
 * could have written, byte for byte.
 *
 * A suite with no questions is still a real outcome — the recruiter reviewed the
 * shell and the runner refused the papers — so it is reported as a warning
 * rather than rolled back behind an error they cannot act on.
 */
export async function createDraftedSuite(input: SuiteCreateInput): Promise<SuiteCreateResult> {
  const staff = await requireStaff("/assessments");

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "The suite needs a name before it can be created." };

  const minutes = Number(input.timeLimitMinutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return { ok: false, error: "Duration must be between 5 and 480 minutes." };
  }

  const chosen = Array.isArray(input.drafts) ? input.drafts.slice(0, MAX_DRAFTS_PER_RUN) : [];
  if (chosen.length === 0) {
    return { ok: false, error: "Keep at least one drafted question before creating the suite." };
  }

  const options = await getMasterOptions();
  if (!options.companies.some((company) => company.id === input.companyId)) {
    return { ok: false, error: "Choose the company this suite belongs to." };
  }
  // A family the list does not carry would put the suite in a filter nothing else
  // can reach, so it is refused here rather than stored and lost.
  if (
    options.roleFamilies.length > 0 &&
    !options.roleFamilies.some((family) => family.key === input.roleFamily)
  ) {
    return {
      ok: false,
      error: `“${input.roleFamily || "nothing"}” is not a role family on file. Pick one in the desk above.`,
    };
  }

  const outcome: {
    templateId: string | null;
    created: number;
    refused: NonNullable<DraftWriteResult["refused"]>;
    failure: string | null;
  } = { templateId: null, created: 0, refused: [], failure: null };

  await withActivityContext(
    {
      actorKind: "AI",
      actorLabel: "AI suite drafting",
      actorId: staff.profileId,
      companyId: staff.tenantId,
    },
    async () => {
      const suite = await saveTemplate({
        id: null,
        tenant_id: input.companyId,
        name,
        description: (input.description ?? "").trim(),
        role_family: input.roleFamily,
        time_limit_minutes: minutes,
        randomize_questions: false,
        randomize_options: false,
        block_copy_paste: Boolean(input.blockCopyPaste),
      });
      if (!suite.ok || !suite.id) {
        outcome.failure = suite.error ?? "The suite could not be created.";
        return;
      }
      outcome.templateId = suite.id;

      const added = await addDraftedQuestions(suite.id, chosen);
      outcome.created = added.created ?? 0;
      outcome.refused = added.refused ?? [];
      if (!added.ok && outcome.created === 0) {
        outcome.failure = `The suite “${name}” was created, but none of its questions could be added: ${added.error}`;
      }
    }
  );

  if (outcome.failure || !outcome.templateId) {
    return {
      ok: false,
      error: outcome.failure ?? "The suite could not be created.",
    };
  }

  return {
    ok: true,
    id: outcome.templateId,
    created: outcome.created,
    refused: outcome.refused,
    warning:
      outcome.created > 0 && outcome.refused.length > 0
        ? `Created with ${outcome.created} question${
            outcome.created === 1 ? "" : "s"
          }. ${outcome.refused.length} ${
            outcome.refused.length === 1 ? "draft was" : "drafts were"
          } refused: ${outcome.refused
            .map((entry) => `${entry.title} — ${entry.reason}`)
            .join(" ")}`
        : undefined,
  };
}
