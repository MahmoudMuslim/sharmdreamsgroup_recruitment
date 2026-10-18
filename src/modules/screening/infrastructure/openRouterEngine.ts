/**
 * AI Screening, Bias Reduction & Sentiment Engine
 * Server-side AI evaluation service using OpenRouter API with multi-model failover.
 * - CV Parsing & Matching with bias reduction
 * - Soft Skill & Video Sentiment Analysis
 * - Personalized Feedback Generator
 * - Dynamic Interview Question Generator
 * - Assessment question authoring for recruiters
 */
import { complete, parseJsonResponse, type CompletionRequest } from "@/modules/screening/infrastructure/aiGateway";
import {
  DIFFICULTY_LABELS,
  GENERATED_JSON_SHAPE,
  kindsWord,
  type AuthoringBrief,
} from "@/modules/assessment/domain/aiAuthoring";
import type { CvScreeningResult, SentimentAnalysisResult, FeedbackReport, GeneratedInterviewQuestions } from "@/types";

/**
 * Bias reduction: strips demographic markers from CV text before sending to LLM.
 * Returns anonymized text and a flag indicating whether any markers were removed.
 */
function anonymizeCvText(text: string): { text: string; anonymized: boolean } {
  const markers = [
    /\b(male|female|man|woman|he|she|his|her)\b/gi,
    /\b(age|birthday|born|year of birth|dob)\b[:\s]*\d{4}/gi,
    /\b(nationality|nationalities|citizen|citizenship)\b/gi,
    /\b(religion|religious|faith)\b/gi,
    /\b(married|single|divorced|spouse|children)\b/gi,
    /\b(race|ethnicity|ethnic)\b/gi,
    /\b(disability|disabled)\b/gi,
    /\b(photo|picture|image|avatar)\b/gi,
    /\b(address|location|city|country)\b[:\s]*[A-Za-z]/gi,
    /\b(phone|mobile|email)\b[:\s]*[\w@+\-.]/gi,
  ];

  let anonymized = false;
  let result = text;
  for (const regex of markers) {
    if (regex.test(result)) {
      anonymized = true;
      result = result.replace(regex, "[REDACTED]");
    }
  }
  return { text: result, anonymized };
}

/**
 * CV Screening & Match Score (0-100%).
 *
 * `anonymize` carries the `ai.bias_reduction` setting. When it is off the model
 * receives the CV exactly as the candidate submitted it, and the prompt labels
 * the block accordingly rather than still calling it anonymized.
 */
export async function screenCandidateCv(
  jobTitle: string,
  jobRequirements: string[],
  cvText: string,
  { anonymize }: { anonymize: boolean }
): Promise<CvScreeningResult> {
  const { text: cvSection, anonymized } = anonymize
    ? anonymizeCvText(cvText)
    : { text: cvText, anonymized: false };

  const systemPrompt = `You are an expert technical recruiter evaluating candidates for ${jobTitle}.
Return ONLY valid JSON matching the CvScreeningResult schema. No markdown, no commentary.
Be objective, focus on skills and experience. Ignore demographic information.`;

  const userPrompt = `JOB TITLE: ${jobTitle}
REQUIREMENTS:
${jobRequirements.map((r) => `- ${r}`).join("\n")}

CANDIDATE CV${anonymize ? " (ANONYMIZED)" : ""}:
${cvSection}

Evaluate and return:
{
  "match_score": number (0-100),
  "decision": "ADVANCE" | "BORDERLINE" | "REJECT",
  "summary": "string (2-3 sentences)",
  "key_competencies": string[],
  "strengths": string[],
  "gaps": string[],
  "anonymization_applied": boolean,
  "model_used": string
}`;

  const request: CompletionRequest = {
    capability: "resume_screening",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    maxTokens: 1500,
    jsonMode: true,
  };

  const result = await complete(request);
  const parsed = parseJsonResponse<CvScreeningResult>(result.content, { truncated: result.truncated });
  return { ...parsed, anonymization_applied: anonymized, model_used: result.model };
}

/**
 * Soft Skill & Video Sentiment Analysis.
 * Uses nvidia/nemotron-3.5-lightning:free as primary.
 * Input: transcript from video/audio or written case-study responses.
 */
export async function analyzeSoftSkills(
  transcript: string,
  context: "VIDEO_PITCH" | "CASE_STUDY" | "WRITTEN_RESPONSE" = "VIDEO_PITCH"
): Promise<SentimentAnalysisResult> {
  const systemPrompt = `You are an organizational psychologist analyzing candidate soft skills from ${context.toLowerCase()} content.
Return ONLY valid JSON matching the SentimentAnalysisResult schema. No markdown.
Score each dimension 0-100. sentiment_score is -100 to 100. overall_sentiment is POSITIVE/NEUTRAL/NEGATIVE.`;

  const userPrompt = `TRANSCRIPT:
${transcript}

Analyze for:
1. Emotional Intelligence (empathy, self-awareness, relationship management)
2. Communication (clarity, structure, persuasion, active listening)
3. Leadership Potential (initiative, influence, decision-making, ownership)
4. Cultural Fit (adaptability, collaboration, values alignment, growth mindset)
5. Overall Sentiment (tone, confidence, engagement)

Return:
{
  "emotional_intelligence": number,
  "communication": number,
  "leadership_potential": number,
  "cultural_fit": number,
  "sentiment_score": number,
  "overall_sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "summary": "string (2-3 sentences)",
  "model_used": string
}`;

  const request: CompletionRequest = {
    capability: "soft_skills",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    maxTokens: 1500,
    jsonMode: true,
  };

  const result = await complete(request);
  return parseJsonResponse<SentimentAnalysisResult>(result.content, { truncated: result.truncated });
}

/**
 * Personalized Feedback Generator for candidates post-selection.
 * Uses google/gemma-4-31b-it:free as primary.
 */
export async function generateCandidateFeedback(
  jobTitle: string,
  screeningResult: CvScreeningResult,
  softSkills: SentimentAnalysisResult | null,
  assessmentScore: number | null,
  wasHired: boolean
): Promise<FeedbackReport> {
  const systemPrompt = `You are a compassionate talent advisor writing personalized feedback for a candidate.
Return ONLY valid JSON matching the FeedbackReport schema. No markdown.
Tone: constructive, specific, encouraging. Avoid generic platitudes.`;

  const userPrompt = `CANDIDATE APPLICATION CONTEXT:
- Role: ${jobTitle}
- Outcome: ${wasHired ? "HIRED" : "NOT SELECTED"}
- CV Match Score: ${screeningResult.match_score}%
- CV Strengths: ${screeningResult.strengths.join(", ") || "None noted"}
- CV Gaps: ${screeningResult.gaps.join(", ") || "None noted"}
${softSkills ? `- Soft Skills: EI ${softSkills.emotional_intelligence}, Comm ${softSkills.communication}, Leadership ${softSkills.leadership_potential}, Cultural Fit ${softSkills.cultural_fit}, Sentiment ${softSkills.overall_sentiment}` : ""}
${assessmentScore !== null ? `- Assessment Score: ${assessmentScore}%` : ""}

Write a feedback report with:
{
  "greeting": "string",
  "overall_assessment": "string (3-4 sentences)",
  "strengths": string[],
  "development_areas": string[],
  "next_steps": "string",
  "closing": "string"
}`;

  const request: CompletionRequest = {
    capability: "feedback",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 2000,
    jsonMode: true,
  };

  const result = await complete(request);
  return parseJsonResponse<FeedbackReport>(result.content, { truncated: result.truncated });
}

/**
 * Dynamic Interview Question Generator for recruiters.
 * Uses nvidia/nemotron-3.5-lightning:free as primary.
 * Generates targeted questions based on CV gaps and assessment results.
 */
export async function generateInterviewQuestions(
  jobTitle: string,
  jobRequirements: string[],
  cvText: string,
  screeningResult: CvScreeningResult,
  assessmentResponses: { questionTitle: string; answerPreview: string; score: number | null }[]
): Promise<GeneratedInterviewQuestions> {
  const { text: anonymizedCv } = anonymizeCvText(cvText);

  const systemPrompt = `You are a senior hiring manager preparing structured interview questions.
Return ONLY valid JSON matching the GeneratedInterviewQuestions schema. No markdown.
Generate 5-7 behavioral/situational questions probing specific gaps. Each question must have a rationale and the skill being probed.`;

  const userPrompt = `ROLE: ${jobTitle}
REQUIREMENTS: ${jobRequirements.join(", ")}
CV SUMMARY (ANONYMIZED): ${anonymizedCv.slice(0, 2000)}
SCREENING GAPS: ${screeningResult.gaps.join(", ") || "None identified"}
ASSESSMENT PERFORMANCE:
${assessmentResponses
  .map((r) => `- ${r.questionTitle}: ${r.score !== null ? `${r.score}%` : "Not graded"} — ${r.answerPreview.slice(0, 150)}`)
  .join("\n")}

Generate interview questions:
{
  "questions": [
    { "question": "string", "rationale": "string", "skill_probed": "string" }
  ]
}`;

  const request: CompletionRequest = {
    capability: "interview_questions",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    maxTokens: 2000,
    jsonMode: true,
  };

  const result = await complete(request);
  return parseJsonResponse<GeneratedInterviewQuestions>(result.content, { truncated: result.truncated });
}

/**
 * Financial/Real Estate Case Study Reasoning Evaluator.
 * Uses deepseek/deepseek-r1:free as primary for complex reasoning.
 */
export async function evaluateCaseStudy(
  questionPrompt: string,
  context: string,
  candidateAnswer: string,
  expectedCompetencies: string[]
): Promise<{ score: number; rationale: string; strengths: string[]; improvements: string[] }> {
  const systemPrompt = `You are a domain expert evaluating a candidate's case study response for a finance/real estate role.
Return ONLY valid JSON. No markdown.
Score 0-100 based on: analytical rigor, structure, domain knowledge, practical feasibility, communication.`;

  const userPrompt = `CASE STUDY PROMPT:
${questionPrompt}

CONTEXT PROVIDED TO CANDIDATE:
${context}

${expectedCompetencies.length > 0 ? `EXPECTED COMPETENCIES:\n${expectedCompetencies.map((c) => `- ${c}`).join("\n")}\n` : ""}
CANDIDATE ANSWER:
${candidateAnswer}

Evaluate and return:
{
  "score": number,
  "rationale": "string (3-4 sentences explaining the score)",
  "strengths": string[],
  "improvements": string[]
}`;

  const request: CompletionRequest = {
    capability: "case_reasoning",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    maxTokens: 2000,
    jsonMode: true,
  };

  const result = await complete(request);
  return parseJsonResponse<{ score: number; rationale: string; strengths: string[]; improvements: string[] }>(result.content, { truncated: result.truncated });
}

/**
 * Excel Model Evaluation: AI-examines the candidate's submitted cells against
 * the question's required outputs (cell, description, formula hint).
 * The pipeline may store formulas or computed values (Handsontable can
 * persist either), so the examiner receives the model's input cells and
 * verifies numeric answers against the expected math instead of demanding
 * literal "=" formulas. Empty required cells fail deterministically, and the
 * final score is recomputed from the merged breakdown rather than trusting
 * the model's own score field.
 */
export interface ExcelEvaluation {
  score: number;
  breakdown: { cell: string; expected: string; actual: string; correct: boolean }[];
}

function refsForGrid(grid: (string | number | null)[][]): string[] {
  const colName = (index: number): string => {
    let name = "";
    let n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  };
  const lines: string[] = [];
  grid.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value === null || value === undefined || value === "") return;
      lines.push(`${colName(colIndex)}${rowIndex + 1} = ${value}`);
    });
  });
  return lines;
}

export async function evaluateExcelModel(
  questionPrompt: string,
  candidateCells: Record<string, string | number | null>,
  expectedOutputs: { cell: string; formula_hint?: string; description: string }[],
  initialSheet?: (string | number | null)[][]
): Promise<ExcelEvaluation> {
  const breakdown: ExcelEvaluation["breakdown"] = [];
  const pending: typeof expectedOutputs = [];
  const submittedLines: string[] = [];

  for (const output of expectedOutputs) {
    const raw = candidateCells[output.cell];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === null || value === undefined || value === "") {
      breakdown.push({ cell: output.cell, expected: output.description, actual: "(left empty)", correct: false });
    } else {
      pending.push(output);
      submittedLines.push(`${output.cell}: ${value}`);
    }
  }

  if (pending.length > 0) {
    const systemPrompt = `You are a financial modelling examiner grading a candidate's spreadsheet model.
Return ONLY valid JSON. No markdown.
Submitted cells may contain either a formula (text starting with "=") or a final computed value (a number).
Judge correctness as follows:
- A formula is correct when it references the right inputs and operations for the requirement.
- A numeric value is correct when it equals the expected result of the described computation given the model's input cells — compute the expected result yourself from those inputs and allow small rounding differences (about 1%).
- A value that is a plausible-looking but wrong number is incorrect.`;

    const userPrompt = `QUESTION:
${questionPrompt}

MODEL INPUT CELLS:
${initialSheet ? refsForGrid(initialSheet).join("\n") : "(none provided)"}

REQUIRED OUTPUTS:
${pending.map((o) => `- ${o.cell}: ${o.description}${o.formula_hint ? ` (hint: ${o.formula_hint})` : ""}`).join("\n")}

CANDIDATE SUBMITTED CELLS (other cells were left empty or are not required):
${submittedLines.join("\n")}

Grade and return:
{
  "score": number (0-100, share of required outputs judged correct),
  "breakdown": [{ "cell": string, "expected": string (what was required, max 12 words), "actual": string (what the candidate submitted, max 12 words), "correct": boolean }]
}`;

    const request: CompletionRequest = {
      capability: "case_reasoning",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      // Routing tables often cap max_tokens low; the per-cell breakdown needs
      // room or the JSON arrives truncated and unparseable.
      maxTokens: 2000,
      jsonMode: true,
    };

    const result = await complete(request);
    const parsed = parseJsonResponse<ExcelEvaluation>(result.content, { truncated: result.truncated });

    const verdictByCell = new Map((parsed.breakdown ?? []).map((b) => [b.cell, b]));
    for (const output of pending) {
      const verdict = verdictByCell.get(output.cell);
      breakdown.push({
        cell: output.cell,
        expected: verdict?.expected ?? output.description,
        actual: verdict?.actual ?? String(candidateCells[output.cell]),
        correct: Boolean(verdict?.correct),
      });
    }
  }

  const correctCount = breakdown.filter((b) => b.correct).length;
  const score = breakdown.length > 0 ? Math.round((correctCount / breakdown.length) * 100) : 0;
  return { score, breakdown };
}

/**
 * Video pitch scoring.
 *
 * The model sees the transcript only, never the recording, so it judges what
 * was said and how it was organised. Delivery, presence and voice stay with the
 * human reviewer, who can play the video in the assessment report.
 */
export async function evaluateVideoPitch(
  questionPrompt: string,
  transcript: string,
  expectations: { minDurationSeconds?: number; maxDurationSeconds?: number }
): Promise<{ score: number; rationale: string; strengths: string[]; improvements: string[] }> {
  const systemPrompt = `You are assessing a recorded candidate pitch for a hospitality / finance leadership role.
You are given a verbatim transcript, NOT the video. Judge content and organisation only.
Never comment on appearance, background, camera skills or voice quality — you cannot perceive them.
The pitch may be in any language; assess the argument, not the language choice.
Return ONLY valid JSON. No markdown.
Score 0-100 based on: every part of the brief addressed, structure (opening, body, close), specificity (concrete numbers, metrics and examples over generalities), realism for a resort group, and whether the time allowed was used well.`;

  const limits =
    expectations.minDurationSeconds || expectations.maxDurationSeconds
      ? `TIME ALLOWED: ${expectations.minDurationSeconds ?? 0}-${expectations.maxDurationSeconds ?? 120} seconds.`
      : "";

  const userPrompt = `BRIEF GIVEN TO THE CANDIDATE:
${questionPrompt}
${limits ? `\n${limits}` : ""}
TRANSCRIPT (${transcript.split(/\s+/).filter(Boolean).length} words):
${transcript}

Evaluate and return:
{
  "score": number (0-100),
  "rationale": "string (3-4 sentences explaining the score)",
  "strengths": string[] (max 5, each under 15 words),
  "improvements": string[] (max 5, each under 15 words)
}`;

  const request: CompletionRequest = {
    capability: "soft_skills",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    maxTokens: 1200,
    jsonMode: true,
  };

  const result = await complete(request);
  return parseJsonResponse<{
    score: number;
    rationale: string;
    strengths: string[];
    improvements: string[];
  }>(result.content, { truncated: result.truncated });
}

/** The suite a set of drafts is being written for. */
export interface SuiteAuthoringContext {
  name: string;
  description: string;
  roleFamily: string;
  timeLimitMinutes: number;
  existingTitles: string[];
}

/**
 * Question authoring for recruiters.
 *
 * Returns the model's parsed reply rather than a finished list of questions,
 * because "can this be sat?" is decided by `reviewDrafts` in the assessment
 * domain — the runner's own rules, not a prompt. A model that writes a quiz with
 * two answer keys, or a spreadsheet whose required cell is already printed on the
 * paper, is refused there and the recruiter is told why.
 *
 * It rides the `case_reasoning` chain on purpose: that capability already ships
 * as "case studies, scoring rubrics and complex analysis" and already has routing
 * rows, so authoring needs no new capability, no new model config and no migration.
 */
export async function generateAssessmentQuestions(
  brief: AuthoringBrief,
  suite: SuiteAuthoringContext
): Promise<{ parsed: unknown; model: string; truncated: boolean }> {
  const systemPrompt = `You are a hiring manager writing a skills assessment that a candidate completes on screen, with no recruiter present to explain it.

Each question must be answerable with only what its type gives the candidate:
- MULTIPLE_CHOICE: exactly one option is correct. Wrong options must be plausible, not jokes. Never use "all of the above" or "none of the above" — options are shuffled per candidate.
- CASE_STUDY: put the scenario the candidate reads in "context", then ask one thing of them in "prompt".
- EXCEL_MODEL: the candidate edits a grid. "initial_sheet" is the paper handed to them: labels and given figures ONLY. Every cell listed in "expected_outputs" must be BLANK there — a required cell that the sheet already prints is an answer given away, not a question.
- VIDEO_PITCH: the candidate speaks to a camera. Ask something answerable out loud in the seconds allowed, with nothing to look up.

Do not invent company figures you then ask the candidate to find. Do not ask for something the question itself states. Set every number a candidate needs inside the question.

Return ONLY valid JSON, no markdown:
${GENERATED_JSON_SHAPE}`;

  const already =
    suite.existingTitles.length > 0
      ? `\nALREADY IN THIS SUITE — do not repeat or paraphrase any of them:\n${suite.existingTitles
          .slice(0, 20)
          .map((title) => `- ${title}`)
          .join("\n")}\n`
      : "";

  const userPrompt = `SUITE: ${suite.name}
${suite.description ? `ABOUT: ${suite.description}\n` : ""}ROLE FAMILY: ${suite.roleFamily || "not set"}
SUITE TIME LIMIT: ${suite.timeLimitMinutes} minutes
${already}
Write ${brief.count} ${DIFFICULTY_LABELS[brief.difficulty].toLowerCase()} question${
    brief.count === 1 ? "" : "s"
  } on: ${brief.topic}
TYPES ALLOWED: ${kindsWord(brief.types)} — use nothing else.
MARKS EACH: ${brief.pointsEach}
${brief.notes ? `EXTRA GUIDANCE FROM THE RECRUITER: ${brief.notes}\n` : ""}
No two questions on the same skill. Each needs its own title of six words or fewer.`;

  const request: CompletionRequest = {
    capability: "case_reasoning",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    // A run of spreadsheet questions carries a grid and a list of required cells
    // per question; a cap sized for prose truncates the JSON mid-sheet and the
    // whole reply is then unparseable.
    maxTokens: Math.min(4000, 700 + brief.count * 700),
    jsonMode: true,
  };

  const result = await complete(request);
  return {
    parsed: parseJsonResponse<unknown>(result.content, { truncated: result.truncated }),
    model: result.model,
    truncated: result.truncated,
  };
}
