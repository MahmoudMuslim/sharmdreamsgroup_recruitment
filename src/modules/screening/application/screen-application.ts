import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getFileStore } from "@/lib/files/store";
import { hasAiProvider } from "@/lib/config.server";
import { engineActivityActor, recordActivity } from "@/modules/activity/application/record";
import {
  getBoolSetting,
  getNumberSetting,
  readGlobalSettings,
} from "@/modules/settings/infrastructure/settingsReader";
import { notifyStageChange } from "@/modules/omnichannel/application/candidate-notifications";
import { humanizeStage } from "@/modules/settings/domain/templates";
import { extractCvText } from "@/modules/screening/infrastructure/cvParser";
import { TruncatedJsonResponseError } from "@/modules/screening/infrastructure/aiGateway";
import {
  draftRejectionReason,
  generateCandidateFeedback,
  screenCandidateCv,
} from "@/modules/screening/infrastructure/openRouterEngine";
import type { CvScreeningResult, FeedbackReport, SentimentAnalysisResult } from "@/types";

/**
 * Screening use-cases shared by the recruiter action and the public apply flow.
 *
 * Uses the service-role client because the same code path serves two very
 * different callers: an authenticated staff member pressing "Screen with AI",
 * and the public careers action right after it inserted the application.
 * Both callers are server-side trust boundaries — the staff action checks
 * `candidates.write` before calling in, and the public flow only ever passes
 * the id of the row it just created.
 */

const CV_BUCKET = "candidate-cvs";

/**
 * Who the trail says made an engine's change.
 *
 * Screening runs from a recruiter's button, the assistant's tool and the public
 * apply form; in all three it is the *engine* that wrote the row, and with no
 * session behind it the change arrived through the career site.
 */
const screeningActor = () => engineActivityActor("CV screening engine", "career site");

type TrailActor = Awaited<ReturnType<typeof screeningActor>>;

export interface AiAutomationSettings {
  aiEnabled: boolean;
  autoScreen: boolean;
}

/**
 * Reads the AI automation toggles (defaults: on).
 *
 * Both keys are read in one call so the pair is a single entry in the settings
 * cache rather than two: every application that lands here used to spend its own
 * uncached query on the same two GLOBAL rows.
 */
export async function getAiAutomationSettings(): Promise<AiAutomationSettings> {
  const settings = await readGlobalSettings([
    "ai.enabled",
    "ai.auto_screen_applications",
  ]);

  const asBool = (value: unknown): boolean =>
    value === false || value === "false" ? false : true;

  return {
    aiEnabled: asBool(settings.get("ai.enabled")),
    autoScreen: asBool(settings.get("ai.auto_screen_applications")),
  };
}

export interface ScreeningOutcome {
  ok: boolean;
  error?: string;
  score?: number;
  decision?: CvScreeningResult["decision"];
  /** Set when the score thresholds moved the candidate without a recruiter. */
  auto_stage?: AutoDisposition | null;
}

interface ApplicationForScreening {
  id: string;
  stage: string;
  full_name: string | null;
  cv_text: string | null;
  cv_file_path: string | null;
  job_openings?: { title?: string; requirements?: unknown } | { title?: string; requirements?: unknown }[] | null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** Stages the thresholds are allowed to choose on their own. */
export type AutoDisposition = "ASSESSMENT" | "REJECTED";

/** How the engine's verdict reads in a trail row. */
const DECISION_WORDS: Record<CvScreeningResult["decision"], string> = {
  ADVANCE: "a fit worth shortlisting",
  BORDERLINE: "borderline",
  REJECT: "not a fit",
};

const DEFAULT_MATCH_THRESHOLD_ADVANCE = 75;
const DEFAULT_MATCH_THRESHOLD_REJECT = 40;

/**
 * Picks the stage the score thresholds imply, or null when they say nothing.
 *
 * `0` on either side switches that side off, because a threshold of 0 would
 * otherwise advance (or, for the reject side, never) every applicant, and an
 * absent row must not automate a decision nobody configured.
 */
function dispositionForScore(
  score: number,
  advanceAt: number,
  rejectBelow: number
): AutoDisposition | null {
  if (advanceAt > 0 && score >= advanceAt) return "ASSESSMENT";
  if (rejectBelow > 0 && score < rejectBelow) return "REJECTED";
  return null;
}

/**
 * Applies the Settings → AI & screening thresholds to a fresh score.
 *
 * Only a candidate who has not been touched by a human moves: NEW and
 * AI_SCREENING are the stages screening itself produces, so an application
 * already at interview, offer or hire is never rewound by a model verdict.
 * A rejection stores its reason because the candidate profile shows it, and the
 * candidate is told through the shared messaging path: the WhatsApp leg only
 * queues, so a Meta outage cannot change the screening result.
 */
async function applyScoreDisposition(input: {
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  stage: string;
  score: number;
  summary: string;
  actor: TrailActor;
}): Promise<AutoDisposition | null> {
  if (input.stage !== "NEW" && input.stage !== "AI_SCREENING") return null;

  const [advanceAt, rejectBelow] = await Promise.all([
    getNumberSetting("ai.match_threshold_advance", DEFAULT_MATCH_THRESHOLD_ADVANCE),
    getNumberSetting("ai.match_threshold_reject", DEFAULT_MATCH_THRESHOLD_REJECT),
  ]);

  const target = dispositionForScore(input.score, advanceAt, rejectBelow);
  if (!target) return null;

  const rule =
    target === "ASSESSMENT"
      ? { word: "shortlist", at: advanceAt }
      : { word: "filter out", at: rejectBelow };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("applications")
    .update({
      stage: target,
      rejection_reason:
        target === "REJECTED"
          ? `Automatic CV screening scored this application ${input.score}% against the filter-out threshold of ${rejectBelow}%. ${input.summary}`.trim()
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId);

  if (error) return null;

  await recordActivity({
    ...input.actor,
    area: "candidates",
    action: "auto_stage_move",
    entity: "application",
    entityId: input.applicationId,
    summary: `${input.candidateName}'s CV scored ${input.score}% for ${input.jobTitle}, so the screening engine moved them to ${humanizeStage(target)} to ${rule.word} at ${rule.at}%`,
    detail: {
      from: input.stage,
      to: target,
      score: input.score,
      advance_at: advanceAt,
      reject_below: rejectBelow,
      notice: "Stage-change message queued.",
    },
  });

  await notifyStageChange(input.applicationId, target);
  return target;
}

function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "doc") return "application/msword";
  if (ext === "txt") return "text/plain";
  return "application/pdf";
}

/** Best-effort read of the stored CV file; empty string when unavailable. */
async function cvTextFromStorage(path: string): Promise<string> {
  const files = await getFileStore();
  const { bytes: file, error } = await files.download({ bucket: CV_BUCKET, path });
  if (error || !file) return "";

  try {
    const buffer = Buffer.from(file);
    const extracted = await extractCvText(buffer, mimeForPath(path));
    return extracted.empty ? "" : extracted.text;
  } catch {
    return "";
  }
}

/**
 * Runs the bias-reduced CV screening engine on one application and persists
 * the result. A NEW application moves to AI_SCREENING; later stages are left
 * alone so a re-screen never rewinds the pipeline.
 */
export async function screenApplicationById(applicationId: string): Promise<ScreeningOutcome> {
  if (!hasAiProvider()) {
    return {
      ok: false,
      error: "No AI provider key is configured. Add one under Settings → API keys.",
    };
  }

  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled) {
    return { ok: false, error: "AI features are switched off in Settings → Platform." };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("id, stage, full_name, cv_text, cv_file_path, job_openings(title, requirements)")
    .eq("id", applicationId)
    .maybeSingle();

  if (!data) return { ok: false, error: "Application not found." };

  const application = data as unknown as ApplicationForScreening;
  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;
  const jobTitle = job?.title ?? "this role";
  const requirements = asStringList(job?.requirements);

  let cvText = (application.cv_text ?? "").trim();
  if (cvText.length < 40 && application.cv_file_path) {
    cvText = await cvTextFromStorage(application.cv_file_path);
  }

  if (cvText.length < 40) {
    return {
      ok: false,
      error: "This application has no readable CV text on file, so there is nothing to screen.",
    };
  }

  // Settings → AI → Bias reduction. Recorded on the application rather than
  // left implied, because "what did the model actually see about this
  // candidate's gender, age or nationality?" is a question a recruiter has to
  // be able to answer after the fact.
  const anonymize = await getBoolSetting("ai.bias_reduction", true);

  let result: CvScreeningResult;
  try {
    result = await screenCandidateCv(jobTitle, requirements, cvText, { anonymize });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown model error";
    return { ok: false, error: `Screening failed: ${detail.slice(0, 200)}` };
  }

  const score = Math.round(result.match_score);
  const { error: updateError } = await supabase
    .from("applications")
    .update({
      ai_match_score: score,
      ai_screening_summary: result.summary,
      ai_strengths: result.strengths,
      ai_gaps: result.gaps,
      diversity_flags: { cv_anonymization: anonymize ? "applied" : "skipped" },
      ...(application.stage === "NEW" ? { stage: "AI_SCREENING" } : {}),
    })
    .eq("id", applicationId);

  if (updateError) return { ok: false, error: updateError.message };

  const actor = await screeningActor();
  const candidateName = application.full_name ?? "The candidate";
  const startedAtNew = application.stage === "NEW";

  await recordActivity({
    ...actor,
    area: "candidates",
    action: "cv_screened",
    entity: "application",
    entityId: applicationId,
    summary: `Screened ${candidateName}'s CV for ${jobTitle}: ${score}% match, read as ${DECISION_WORDS[result.decision]}${startedAtNew ? ", so the application moved to AI screening" : ""}`,
    detail: {
      score,
      decision: result.decision,
      stage_before: application.stage,
      stage_after: startedAtNew ? "AI_SCREENING" : application.stage,
      model: result.model_used,
      bias_reduction: anonymize ? "applied" : "skipped",
      cv_characters: cvText.length,
      strengths: result.strengths.length,
      gaps: result.gaps.length,
    },
  });

  const autoStage = await applyScoreDisposition({
    applicationId,
    candidateName,
    jobTitle,
    stage: application.stage,
    score,
    summary: result.summary ?? "",
    actor,
  });

  return { ok: true, score, decision: result.decision, auto_stage: autoStage };
}

export interface FeedbackOutcome {
  ok: boolean;
  error?: string;
}

export interface RejectionReasonOutcome {
  ok: boolean;
  error?: string;
  /** The drafted wording, which the recruiter edits before the stage move stores it. */
  reason?: string;
}

/**
 * Drafts a rejection reason from what is already on the application.
 *
 * Deliberately returns text and writes nothing: the reason is a decision a human
 * owns, so it lands in the reject panel's textarea and only reaches
 * `applications.rejection_reason` when the recruiter confirms the stage move.
 * That is also why no trail row is written here — an unsent draft changed no row.
 *
 * A refusal is a real answer, not a fallback sentence. With no screening score,
 * no graded attempt and no failed application question there is no evidence to
 * name, and a model asked to explain the rejection anyway would produce a
 * plausible fabrication for a real person's file.
 */
export async function draftRejectionReasonForApplication(
  applicationId: string
): Promise<RejectionReasonOutcome> {
  if (!hasAiProvider()) {
    return { ok: false, error: "No AI provider key is configured, so nothing can be drafted." };
  }

  const { aiEnabled } = await getAiAutomationSettings();
  if (!aiEnabled) {
    return { ok: false, error: "AI features are switched off in Settings → Platform." };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select(
      "id, stage, job_openings(title), ai_match_score, ai_screening_summary, ai_strengths, ai_gaps, gate_answers, candidate_attempts(total_score, max_score)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!data) return { ok: false, error: "Application not found." };

  const application = data as unknown as {
    stage: string;
    job_openings?: { title?: string } | { title?: string }[] | null;
    ai_match_score: number | null;
    ai_screening_summary: string | null;
    ai_strengths: unknown;
    ai_gaps: unknown;
    gate_answers: unknown;
    candidate_attempts?:
      | { total_score: number | null; max_score: number | null }
      | { total_score: number | null; max_score: number | null }[]
      | null;
  };

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;
  const attempt = Array.isArray(application.candidate_attempts)
    ? application.candidate_attempts[0]
    : application.candidate_attempts;

  const assessmentScore =
    attempt?.total_score !== null &&
    attempt?.total_score !== undefined &&
    attempt.max_score
      ? Math.round((attempt.total_score / attempt.max_score) * 100)
      : null;

  const gateFailures = gateFailureLines(application.gate_answers);

  if (application.ai_match_score === null && assessmentScore === null && gateFailures.length === 0) {
    return {
      ok: false,
      error:
        "There is nothing on this file for a reason to be drafted from — no AI screening score, no graded assessment and no failed application question. Write the reason yourself.",
    };
  }

  let drafted: { reason: string; model: string };
  try {
    drafted = await draftRejectionReason({
      jobTitle: job?.title ?? "the role",
      stage: application.stage,
      cvScore: application.ai_match_score === null ? null : Number(application.ai_match_score),
      screeningSummary: application.ai_screening_summary ?? "",
      strengths: asStringList(application.ai_strengths),
      gaps: asStringList(application.ai_gaps),
      assessmentScore,
      gateFailures,
    });
  } catch (cause) {
    if (cause instanceof TruncatedJsonResponseError) {
      return {
        ok: false,
        error: "The model was cut off before it finished the reason, so nothing was drafted. Try again.",
      };
    }
    const detail = cause instanceof Error ? cause.message : "Unknown model error";
    return { ok: false, error: `Draft failed: ${detail.slice(0, 200)}` };
  }

  return { ok: true, reason: drafted.reason };
}

/**
 * The application-question failures on the row, in the words the gate desk uses.
 *
 * `gate_answers` is the full answer set, including the ones that passed, so the
 * drafted reason must not claim a candidate failed a question they answered
 * correctly. Anything malformed in the JSON column is ignored rather than
 * quoted — a reason must not inherit text the stored shape never authorised.
 */
function gateFailureLines(raw: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { question: string; answer: string }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const line = entry as { question?: unknown; answer?: unknown; passed?: unknown };
    if (line.passed !== false) continue;
    const question = typeof line.question === "string" ? line.question.trim() : "";
    const answer = typeof line.answer === "string" ? line.answer.trim() : "";
    if (question && answer) out.push({ question: question.slice(0, 200), answer: answer.slice(0, 200) });
  }
  return out;
}

/**
 * Writes a personalized candidate feedback draft into `ai_feedback`.
 *
 * Built from the stored screening result, so it is only available once the
 * application has been screened. Used by the "Draft feedback" button and
 * scheduled in the background when a candidate is hired or rejected.
 */
export async function generateFeedbackForApplication(
  applicationId: string
): Promise<FeedbackOutcome> {
  if (!hasAiProvider()) {
    return { ok: false, error: "No AI provider key is configured." };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("applications")
    .select(
      "id, stage, full_name, ai_match_score, ai_screening_summary, ai_strengths, ai_gaps, ai_soft_skills, diversity_flags, job_openings(title), candidate_attempts(total_score, max_score)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!data) return { ok: false, error: "Application not found." };

  const application = data as unknown as {
    stage: string;
    full_name: string | null;
    ai_match_score: number | null;
    ai_screening_summary: string | null;
    ai_strengths: unknown;
    ai_gaps: unknown;
    ai_soft_skills: unknown;
    diversity_flags?: Record<string, string> | null;
    job_openings?: { title?: string } | { title?: string }[] | null;
    candidate_attempts?: { total_score: number | null; max_score: number | null } | { total_score: number | null; max_score: number | null }[] | null;
  };

  if (application.ai_match_score === null) {
    return {
      ok: false,
      error: "Run AI screening first — the feedback is written from the screening result.",
    };
  }

  const job = Array.isArray(application.job_openings)
    ? application.job_openings[0]
    : application.job_openings;
  const attempt = Array.isArray(application.candidate_attempts)
    ? application.candidate_attempts[0]
    : application.candidate_attempts;

  const assessmentScore =
    attempt?.total_score !== null &&
    attempt?.total_score !== undefined &&
    attempt.max_score
      ? Math.round((attempt.total_score / attempt.max_score) * 100)
      : null;

  const screeningResult: CvScreeningResult = {
    match_score: Number(application.ai_match_score),
    decision: "BORDERLINE",
    summary: application.ai_screening_summary ?? "",
    key_competencies: [],
    strengths: asStringList(application.ai_strengths),
    gaps: asStringList(application.ai_gaps),
    anonymization_applied: application.diversity_flags?.cv_anonymization === "applied",
    model_used: "stored screening result",
  };

  let report: FeedbackReport;
  try {
    report = await generateCandidateFeedback(
      job?.title ?? "the role",
      screeningResult,
      (application.ai_soft_skills as SentimentAnalysisResult | null) ?? null,
      assessmentScore,
      application.stage === "HIRED"
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown model error";
    return { ok: false, error: `Feedback generation failed: ${detail.slice(0, 200)}` };
  }

  const text = [
    report.greeting,
    report.overall_assessment,
    report.strengths.length > 0
      ? `Strengths:\n${report.strengths.map((item) => `• ${item}`).join("\n")}`
      : "",
    report.development_areas.length > 0
      ? `Development areas:\n${report.development_areas.map((item) => `• ${item}`).join("\n")}`
      : "",
    report.next_steps,
    report.closing,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { error: updateError } = await supabase
    .from("applications")
    .update({ ai_feedback: text })
    .eq("id", applicationId);

  if (updateError) return { ok: false, error: updateError.message };

  await recordActivity({
    ...(await engineActivityActor("Candidate feedback writer")),
    area: "candidates",
    action: "feedback_drafted",
    entity: "application",
    entityId: applicationId,
    summary: `Drafted feedback for ${application.full_name ?? "the candidate"} on ${job?.title ?? "the role"} — ${text.length} characters waiting on a recruiter to send it`,
    detail: {
      cv_score: Number(application.ai_match_score),
      assessment_score: assessmentScore,
      letter: application.stage === "HIRED" ? "offer" : "rejection",
      strengths: report.strengths.length,
      development_areas: report.development_areas.length,
      note: "The letter's wording is not kept in the trail; the draft lives on the candidate profile.",
    },
  });

  return { ok: true };
}
