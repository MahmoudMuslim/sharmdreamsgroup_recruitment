import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasAiProvider } from "@/lib/config.server";
import { getBoolSetting, getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";
import { notifyStageChange } from "@/modules/omnichannel/application/candidate-notifications";
import { extractCvText } from "@/modules/screening/infrastructure/cvParser";
import {
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

export interface AiAutomationSettings {
  aiEnabled: boolean;
  autoScreen: boolean;
}

/** Reads the AI automation toggles from `app_settings` (defaults: on). */
export async function getAiAutomationSettings(): Promise<AiAutomationSettings> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("scope", "GLOBAL")
    .in("key", ["ai.enabled", "ai.auto_screen_applications"]);

  const map = new Map((data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
  const asBool = (value: unknown, fallback: boolean): boolean =>
    value === true || value === "true" ? true : value === false || value === "false" ? false : fallback;

  return {
    aiEnabled: asBool(map.get("ai.enabled"), true),
    autoScreen: asBool(map.get("ai.auto_screen_applications"), true),
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
  stage: string;
  score: number;
  summary: string;
}): Promise<AutoDisposition | null> {
  if (input.stage !== "NEW" && input.stage !== "AI_SCREENING") return null;

  const [advanceAt, rejectBelow] = await Promise.all([
    getNumberSetting("ai.match_threshold_advance", DEFAULT_MATCH_THRESHOLD_ADVANCE),
    getNumberSetting("ai.match_threshold_reject", DEFAULT_MATCH_THRESHOLD_REJECT),
  ]);

  const target = dispositionForScore(input.score, advanceAt, rejectBelow);
  if (!target) return null;

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
  const supabase = getSupabaseServiceClient();
  const { data: file, error } = await supabase.storage.from(CV_BUCKET).download(path);
  if (error || !file) return "";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
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
    .select("id, stage, cv_text, cv_file_path, job_openings(title, requirements)")
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

  const autoStage = await applyScoreDisposition({
    applicationId,
    stage: application.stage,
    score,
    summary: result.summary ?? "",
  });

  return { ok: true, score, decision: result.decision, auto_stage: autoStage };
}

export interface FeedbackOutcome {
  ok: boolean;
  error?: string;
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
      "id, stage, ai_match_score, ai_screening_summary, ai_strengths, ai_gaps, ai_soft_skills, diversity_flags, job_openings(title), candidate_attempts(total_score, max_score)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!data) return { ok: false, error: "Application not found." };

  const application = data as unknown as {
    stage: string;
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

  return { ok: true };
}
