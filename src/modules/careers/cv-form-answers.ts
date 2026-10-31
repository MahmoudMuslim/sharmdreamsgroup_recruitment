import "server-only";

/**
 * Reads a whole application form's answers out of the CV its owner just attached.
 *
 * The static apply form asks for three contact fields and has always been able to
 * take them from the CV file sitting above them. A form an author built asks
 * twenty, and most of those questions — the address, the languages, the notice
 * period, the current salary — are printed in that same file. This asks the
 * screening chain for the lot, in the one call, and hands the raw proposals back.
 *
 * Nothing here decides what reaches the candidate. `acceptCvAnswers` does, field
 * by field, against each field's own authored bounds. This module's job ends at
 * asking well: the questions carry only their labels and the shape of the answer
 * the normaliser expects, so no author setting, binding or registry key is ever
 * put in front of a model.
 *
 * A CV is untrusted input and a model repeats what it finds in it, so the prompt
 * refuses the two ways that reads badly on an application: completing a value the
 * document only half prints, and quoting a contact block that belongs to a former
 * employer or a reference rather than the applicant.
 *
 * The capability is `resume_screening`, the one the contact reader, the screening
 * step and the sourcing profile reader already share, so Settings → AI models
 * stays authoritative over one model list rather than two.
 */

import {
  AiGatewayError,
  TruncatedJsonResponseError,
  complete,
  parseJsonResponse,
} from "@/modules/screening/infrastructure/aiGateway";
import type { CvAsk } from "@/modules/form-builder/domain/cvAnswers";

/**
 * The first pages carry the personal details; the later ones are experience the
 * form rarely asks about. Same ceiling the contact reader works to, so a long CV
 * costs the same here as it already does on the step that stores it.
 */
const MAX_INPUT_CHARS = 12_000;

/** A question line plus its answer, measured generously, is worth this much. */
const TOKENS_PER_QUESTION = 120;
const MAX_ANSWER_TOKENS = 4_000;

function systemPrompt(): string {
  return `You are given the CV of the person who is about to apply for a job, and the list of questions the application form asks them.

For each question the CV can answer, write the answer exactly as the document prints it.

Rules:
- Only the applicant's own details. Ignore a contact block, address, email or number that belongs to a former employer, an agency, a reference or a company.
- Copy character for character. Do not correct spelling, translate, transliterate, add a country code, complete a partial value or round a number.
- If the CV does not state a question's answer, leave that key out of the object. Never guess, never infer, never write "unknown".
- Pick from the options a question lists; never invent an option. For a question that allows several, return a list.
- Give a date as YYYY-MM-DD, a time as HH:MM (24-hour), a number as plain digits, a duration as {"value": number, "unit": one of the listed units}, an address as an object holding only the listed parts.
- Answer only the keys you were given.
- Return ONLY one JSON object mapping each key to its answer. No markdown fences, no commentary.`;
}

function userPrompt(asks: readonly CvAsk[], raw: string): string {
  const questions = asks.map((ask) => {
    const line: Record<string, unknown> = { key: ask.key, type: ask.type, question: ask.label };
    if (ask.help) line.help = ask.help;
    if (ask.options) line.options = ask.options;
    if (ask.units) line.units = ask.units;
    if (ask.parts) line.parts = ask.parts;
    if (ask.maxLength !== undefined) line.maxLength = ask.maxLength;
    if (ask.min !== undefined) line.min = ask.min;
    if (ask.max !== undefined) line.max = ask.max;
    return JSON.stringify(line);
  });

  return `QUESTIONS:
${questions.join("\n")}

CV TEXT:
${raw}

Write the answers this CV states:
{ "key": answer, ... }`;
}

/**
 * The raw proposals, keys and all.
 *
 * Returned unvalidated on purpose: the field definitions that must judge them are
 * read again by the door, from the layout, and are not in this file's hands.
 *
 * Throws `AiGatewayError` when no configured model answered, so the caller can
 * say that rather than "your CV did not say".
 */
export async function readCvFormAnswers(
  cvText: string,
  asks: readonly CvAsk[]
): Promise<Record<string, unknown>> {
  if (asks.length === 0) return {};

  const result = await complete({
    capability: "resume_screening",
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(asks, cvText.slice(0, MAX_INPUT_CHARS)) },
    ],
    temperature: 0,
    maxTokens: Math.min(MAX_ANSWER_TOKENS, TOKENS_PER_QUESTION * asks.length),
    jsonMode: true,
  });

  const parsed = parseJsonResponse<Record<string, unknown>>(result.content, {
    truncated: result.truncated,
  });

  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/** A candidate-facing sentence for each way the read can fail. */
export function describeFormAnswersFailure(error: unknown): string {
  if (error instanceof TruncatedJsonResponseError) {
    return "That CV was too long to read in one go. Please fill the fields in yourself.";
  }
  if (error instanceof AiGatewayError) {
    return "Our CV reader is unavailable right now. Fill the fields in and submit — your CV is still reviewed.";
  }
  return "We could not read those answers out of your CV. Please fill the fields in yourself.";
}
