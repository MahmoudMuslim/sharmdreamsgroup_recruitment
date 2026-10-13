/**
 * Viability gate questions — the no-points questions shown on the public
 * "Apply for this role" form.
 *
 * Pure domain logic, shared by three callers that must never disagree:
 *   • the public form, which may only show the question and its choices;
 *   • the submit action, which scores the answers and rejects the application;
 *   • the admin console, which authors them.
 *
 * `which answer passes` is deliberately absent from the public projection. It
 * is not a secret (the candidate has to answer honestly), but shipping it to
 * the browser would let the form be driven from a script that picks the
 * acceptable option without ever answering it.
 */

export interface GateOption {
  label: string;
  /** True when this answer keeps the application in the running. */
  passes: boolean;
}

export interface GateQuestion {
  id: string;
  /** Null asks the question for every published role. */
  jobId: string | null;
  question: string;
  helpText: string | null;
  options: GateOption[];
  position: number;
  isActive: boolean;
}

/** The most the public site is ever told about a question. */
export interface PublicGateQuestion {
  id: string;
  question: string;
  helpText: string | null;
  options: string[];
}

export interface GateAnswer {
  question: string;
  answer: string;
  passed: boolean;
}

export interface GateVerdict {
  /** Every answer that could be scored, in question order. */
  answers: GateAnswer[];
  failed: GateAnswer[];
  /** Question texts that arrived blank or with an answer nobody offered. */
  missing: string[];
}

/* -------------------------------------------------------------------------- */
/* Reading rows                                                                */
/* -------------------------------------------------------------------------- */

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Options are jsonb, so a hand-edited row can hold anything.
 *
 * A blank label is dropped rather than rendered, because the candidate cannot
 * meaningfully pick an empty choice.
 */
export function parseGateOptions(value: unknown): GateOption[] {
  if (!Array.isArray(value)) return [];

  const options: GateOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const label = asText(row.label).trim();
    if (!label) continue;
    options.push({ label, passes: row.passes === true });
  }
  return options;
}

/**
 * Turns `application_gate_questions` rows into domain objects.
 *
 * A question with fewer than two usable options cannot be answered, so it is
 * dropped instead of being asked and then scoring every reply as blank. Silently
 * ignoring it is the lesser harm: a broken row blocks a real application
 * otherwise, and the admin console never saves one.
 */
export function parseGateRows(rows: readonly Record<string, unknown>[]): GateQuestion[] {
  const questions: GateQuestion[] = [];

  for (const row of rows) {
    const options = parseGateOptions(row.options);
    if (options.length < 2) continue;

    const question = asText(row.question).trim();
    if (!question) continue;

    questions.push({
      id: asText(row.id),
      jobId: row.job_id === null || row.job_id === undefined ? null : asText(row.job_id),
      question,
      helpText: row.help_text === null || row.help_text === undefined
        ? null
        : asText(row.help_text).trim() || null,
      options,
      position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
      isActive: row.is_active !== false,
    });
  }

  return questions.sort((a, b) => a.position - b.position);
}

/** Strips the passing flags before anything reaches a browser. */
export function publicGateQuestions(
  questions: readonly GateQuestion[]
): PublicGateQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    question: question.question,
    helpText: question.helpText,
    options: question.options.map((option) => option.label),
  }));
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Scores the submitted answers against the questions the form asked.
 *
 * Answers arrive keyed by question id, which is a client-supplied map, so every
 * lookup goes through the stored question rather than trusting the payload: an
 * unknown id is ignored and an unoffered label counts as unanswered, never as a
 * pass.
 */
export function evaluateGate(
  questions: readonly GateQuestion[],
  submitted: Readonly<Record<string, string>> | null | undefined
): GateVerdict {
  const answers: GateAnswer[] = [];
  const failed: GateAnswer[] = [];
  const missing: string[] = [];

  for (const question of questions) {
    const raw = submitted?.[question.id];
    const label = typeof raw === "string" ? raw.trim() : "";
    const option = label ? question.options.find((o) => o.label === label) : undefined;

    if (!option) {
      missing.push(question.question);
      continue;
    }

    const answer: GateAnswer = {
      question: question.question,
      answer: option.label,
      passed: option.passes,
    };
    answers.push(answer);
    if (!option.passes) failed.push(answer);
  }

  return { answers, failed, missing };
}

/**
 * The recruiter-facing reason stored in `applications.rejection_reason`.
 *
 * Names the question and the answer given, because "failed screening" is not
 * something a recruiter can act on or a candidate can be told fairly.
 */
export function gateRejectionReason(failed: readonly GateAnswer[]): string {
  return failed
    .map(
      (item) =>
        `Application question “${item.question}”: answered “${item.answer}”, which this role does not accept.`
    )
    .join(" ");
}

/** Answers the role accepts, for the admin list and the public help text. */
export function acceptableAnswers(question: GateQuestion): string[] {
  return question.options.filter((option) => option.passes).map((option) => option.label);
}
