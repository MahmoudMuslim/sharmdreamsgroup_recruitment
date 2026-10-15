import "server-only";

/**
 * Reads the applicant's own contact details out of the CV they just attached.
 *
 * A candidate typing their name, email and phone under the heading "attach your
 * CV" is writing out what page one of that file already states. The text is
 * already extracted for screening, so the same text is asked back for those
 * three fields and offered to the form for the candidate to check.
 *
 * A CV is untrusted input and a model repeats what it finds in it, so nothing is
 * returned until it has been re-checked here against the rules `submitApplication`
 * applies. That is also what keeps a hallucinated address out of the form.
 *
 * The capability is `resume_screening`, the same chain the screening step and the
 * sourcing profile reader use, so Settings → AI models stays authoritative over
 * one model list rather than two.
 */

import {
  AiGatewayError,
  TruncatedJsonResponseError,
  complete,
  parseJsonResponse,
} from "@/modules/screening/infrastructure/aiGateway";

export interface CvDetails {
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * The same shape the submit action validates against. A value that would be
 * refused there is refused here, so the button never fills a field that turns
 * the submission red.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[\d][\d\s().-]{5,}$/;
const MIN_PHONE_DIGITS = 7;

/** Contact blocks sit at the top; the rest of the CV adds cost, not answers. */
const MAX_INPUT_CHARS = 12_000;

const SYSTEM_PROMPT = `You are given the CV of the person who is about to apply for a job. Write down only their own contact details, exactly as the document prints them.

Rules:
- "fullName" is the applicant's name — the one the CV is about, usually its first line. Never a hiring manager, recruiter, reference or company contact.
- "email" and "phone" are the applicant's own, taken from their contact block. Ignore addresses and numbers that belong to a former employer, an agency, a reference, or a website.
- Copy each value character for character. Do not correct spelling, translate, transliterate, add a country code or complete a partial value.
- If a value is absent, omit that key. Never guess it.
- Return ONLY one JSON object. No markdown fences, no commentary.`;

function userPrompt(raw: string): string {
  return `CV TEXT:
${raw}

Report what this CV states about its owner:
{
  "fullName": string,
  "email": string,
  "phone": string
}`;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 120) return null;
  // A name line is not a sentence, an address or a heading leaking through.
  if (/[@:/]|https?\b|\bdear\b/i.test(text)) return null;
  return text;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return text.length <= 254 && EMAIL_PATTERN.test(text) ? text : null;
}

function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > 32 || !PHONE_PATTERN.test(text)) return null;
  const digits = text.replace(/\D/g, "").length;
  return digits >= MIN_PHONE_DIGITS ? text : null;
}

/**
 * The three fields, each present only when the CV actually carried it and the
 * value survived validation. Throws `AiGatewayError` when no configured model
 * answered, so the caller can say that rather than "nothing was found".
 */
export async function readCvDetails(cvText: string): Promise<CvDetails> {
  const result = await complete({
    capability: "resume_screening",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(cvText.slice(0, MAX_INPUT_CHARS)) },
    ],
    temperature: 0,
    maxTokens: 200,
    jsonMode: true,
  });

  const parsed = parseJsonResponse<Record<string, unknown>>(result.content, {
    truncated: result.truncated,
  });

  return {
    fullName: cleanName(parsed?.fullName),
    email: cleanEmail(parsed?.email),
    phone: cleanPhone(parsed?.phone),
  };
}

/** A candidate-facing sentence for each way the read can fail. */
export function describeDetailsFailure(error: unknown): string {
  if (error instanceof TruncatedJsonResponseError) {
    return "We could not read the details out of that CV. Please fill the fields in yourself.";
  }
  if (error instanceof AiGatewayError) {
    return "Our detail reader is unavailable right now. Fill the fields in and submit — your CV is still reviewed.";
  }
  return "We could not read the details out of that CV. Please fill the fields in yourself.";
}
