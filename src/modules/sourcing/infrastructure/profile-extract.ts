import "server-only";

/**
 * Turns a profile page's text into a structured profile.
 *
 * The raw text arrives from a fetched page, a paste or an export, and it is as
 * untidy as any human document: dates written four different ways, a job title on
 * one line and its company three lines down, a skills block that is really a
 * keyword dump. A model reads that far better than a parser does, so this is the
 * one place the mess is resolved — and the only thing asked of it is to report
 * what the text actually says.
 *
 * Nothing new is invented: the prompt forbids filling gaps, and every field the
 * model returns goes through `normalizeProspectProfile`, which drops entries with
 * no title or school rather than rendering an empty bullet.
 *
 * The capability is `resume_screening`, the same routing a CV read uses. This is
 * a document being turned into structured facts about a person, which is exactly
 * what that chain is configured for, and it keeps the Settings → AI models panel
 * authoritative over one model list rather than two.
 */

import {
  AiGatewayError,
  TruncatedJsonResponseError,
  complete,
  parseJsonResponse,
} from "@/modules/screening/infrastructure/aiGateway";
import { normalizeProspectProfile, type ProspectProfile } from "@/modules/sourcing/domain/prospect-profile";

/** What the recruiter sees about the prospect already, to anchor the read. */
export interface ExtractHints {
  name?: string | null;
  company?: string | null;
  headline?: string | null;
  source?: string | null;
}

const SYSTEM_PROMPT = `You read a person's professional profile exactly as it was published and write down only what the text states.

Rules:
- Never invent a job title, employer, date, school, skill or link. If the text does not say it, leave that field out.
- Keep names, companies, universities and titles spelled as the text writes them.
- Keep dates in the same form the text uses ("2019", "March 2021", "Present"); do not convert them.
- A role that is still held gets "present": true.
- Skills are short labels ("Financial modelling"), not sentences.
- Ignore site chrome: navigation menus, cookie notices, adverts, "Sign in" prompts, suggested profiles, job advertisements that are not this person's history.
- Return ONLY one JSON object. No markdown fences, no commentary.`;

function userPrompt(raw: string, hints: ExtractHints): string {
  const known = [
    hints.name ? `name: ${hints.name}` : null,
    hints.company ? `current company: ${hints.company}` : null,
    hints.headline ? `headline: ${hints.headline}` : null,
    hints.source ? `read from: ${hints.source}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `${known ? `The prospect this page is about, as already recorded: ${known}.\n\n` : ""}PROFILE TEXT:
${raw}

Write every section the text contains:
{
  "headline": string,
  "location": string,
  "summary": string,
  "experience": [{ "title": string, "company": string, "location": string, "start": string, "end": string, "present": boolean, "detail": string }],
  "education": [{ "school": string, "degree": string, "field": string, "start": string, "end": string, "detail": string }],
  "certifications": [{ "name": string, "issuer": string, "issued_at": string }],
  "projects": [{ "name": string, "description": string, "url": string }],
  "skills": string[],
  "languages": [{ "name": string }],
  "links": [{ "label": string, "url": string }]
}
Omit a section entirely when the text holds nothing for it.`;
}

/**
 * Structures one profile from raw text.
 *
 * Throws `AiGatewayError` (every model in the chain refused) and
 * `TruncatedJsonResponseError` (the answer hit the output cap mid-JSON) so the
 * caller can tell a recruiter which of the two happened; both are recoverable by
 * asking again, and neither is a reason to store a half-profile.
 */
export async function extractProfile(
  raw: string,
  hints: ExtractHints = {}
): Promise<ProspectProfile> {
  const result = await complete({
    capability: "resume_screening",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(raw.slice(0, 28_000), hints) },
    ],
    temperature: 0.1,
    maxTokens: 3_000,
    jsonMode: true,
  });

  const parsed = parseJsonResponse<unknown>(result.content, { truncated: result.truncated });
  return normalizeProspectProfile({ ...(parsed as object), model: result.model });
}

/** A recruiter-facing sentence for each way the structuring step can fail. */
export function describeExtractionFailure(error: unknown): string {
  if (error instanceof TruncatedJsonResponseError) {
    return "The model ran out of room part-way through that profile. Paste a shorter section, or read it again.";
  }
  if (error instanceof AiGatewayError) {
    return `No configured model answered, so the page could not be structured: ${error.message.slice(0, 160)}`;
  }
  if (error instanceof Error) return `The profile could not be structured: ${error.message.slice(0, 160)}`;
  return "The profile could not be structured.";
}
