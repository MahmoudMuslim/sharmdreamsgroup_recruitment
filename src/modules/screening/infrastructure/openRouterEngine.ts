/**
 * AI Screening, Bias Reduction & Sentiment Engine
 * Server-side AI evaluation service using OpenRouter API with multi-model failover.
 * - CV Parsing & Matching with bias reduction
 * - Soft Skill & Video Sentiment Analysis
 * - Personalized Feedback Generator
 * - Dynamic Interview Question Generator
 */
import { complete, parseJsonResponse, type CompletionRequest } from "@/modules/screening/infrastructure/aiGateway";
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
 * Extracts plain text from PDF/Docx buffers.
 * In production, use pdf-parse or mammoth; here we assume text is pre-extracted.
 */
export async function extractTextFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    // Placeholder: integrate pdf-parse
    return buffer.toString("utf-8");
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // Placeholder: integrate mammoth
    return buffer.toString("utf-8");
  }
  return buffer.toString("utf-8");
}

/**
 * CV Screening & Match Score (0-100%) with bias reduction.
 * Uses google/gemma-4-31b-it:free as primary.
 */
export async function screenCandidateCv(
  jobTitle: string,
  jobRequirements: string[],
  cvText: string
): Promise<CvScreeningResult> {
  const { text: anonymizedText, anonymized } = anonymizeCvText(cvText);

  const systemPrompt = `You are an expert technical recruiter evaluating candidates for ${jobTitle}.
Return ONLY valid JSON matching the CvScreeningResult schema. No markdown, no commentary.
Be objective, focus on skills and experience. Ignore demographic information.`;

  const userPrompt = `JOB TITLE: ${jobTitle}
REQUIREMENTS:
${jobRequirements.map((r) => `- ${r}`).join("\n")}

CANDIDATE CV (ANONYMIZED):
${anonymizedText}

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
  const parsed = parseJsonResponse<CvScreeningResult>(result.content);
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
  return parseJsonResponse<SentimentAnalysisResult>(result.content);
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
  return parseJsonResponse<FeedbackReport>(result.content);
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
  return parseJsonResponse<GeneratedInterviewQuestions>(result.content);
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

EXPECTED COMPETENCIES:
${expectedCompetencies.map((c) => `- ${c}`).join("\n")}

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
  return parseJsonResponse<{ score: number; rationale: string; strengths: string[]; improvements: string[] }>(result.content);
}

/**
 * Excel Model Evaluation: checks formulas against expected outputs.
 * Returns score 0-100 and detailed breakdown.
 */
export async function evaluateExcelModel(
  candidateGrid: (string | number | null)[][],
  expectedOutputs: { cell: string; formulaHint: string; description: string }[]
): Promise<{ score: number; breakdown: { cell: string; expected: string; actual: string; correct: boolean }[] }> {
  // This runs client-side in HyperFormula; here we just provide the evaluation structure.
  // Server-side evaluation would re-run HyperFormula on the submitted grid.
  const breakdown = expectedOutputs.map((exp) => ({
    cell: exp.cell,
    expected: exp.formulaHint,
    actual: "TODO: compute from candidateGrid",
    correct: false,
  }));
  const correctCount = breakdown.filter((b) => b.correct).length;
  const score = expectedOutputs.length > 0 ? Math.round((correctCount / expectedOutputs.length) * 100) : 0;
  return { score, breakdown };
}