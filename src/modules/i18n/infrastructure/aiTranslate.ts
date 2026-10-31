import "server-only";

import { localeLabels } from "@/lib/i18n";
import {
  AiGatewayError,
  TruncatedJsonResponseError,
  complete,
  parseJsonResponse,
} from "@/modules/screening/infrastructure/aiGateway";
import { MAX_TEXT_CHARS, type TranslationLocale } from "../domain/translations";
import type { Locale } from "@/core/entities";

/**
 * Drafts interface wording in another language, a batch at a time.
 *
 * The output is a draft and nothing else: it lands in the console's fields for a
 * person to read, and only a save writes it. That is deliberate — a model that
 * quietly replaced 400 stored strings would be indistinguishable from an admin
 * who reviewed them, and the change trail would name the admin.
 *
 * The capability is `translation`, its own chain in Settings → AI models, so
 * routing the careers chatbot elsewhere does not silently reroute this.
 */

export interface TranslationPair {
  key: string;
  /** The wording to translate, as it will be read by the person translating it. */
  text: string;
}

export interface TranslationRunResult {
  /** Usable drafts, in the order they were asked for. */
  drafts: { key: string; text: string }[];
  /** Keys asked for that came back absent, empty or unusable. */
  unanswered: string[];
  /** The model that answered the last batch, named so the console can say so. */
  model: string | null;
  batches: number;
  /** Set when no batch produced anything, so the console says that rather than "0 keys". */
  error: string | null;
}

/**
 * How many keys one model call carries.
 *
 * Small enough that the answer fits inside an output cap — a truncated JSON
 * object loses every key after the cut, not just the last one — and small enough
 * that one rate-limited call costs 25 rows rather than 400.
 */
export const TRANSLATION_BATCH_SIZE = 25;

/** The most keys one click will ask for. Beyond this the console asks for fewer. */
export const MAX_TRANSLATION_KEYS = 600;

/** A label is what this translates; a page of prose belongs in a template. */
const MAX_SOURCE_CHARS = 600;

function systemPrompt(target: Locale): string {
  return `You translate the interface wording of a recruitment platform into ${localeLabels[target]}.

You are given one JSON object. Each key is an identifier and each value is the English sentence shown to a person. Return one JSON object with exactly the same keys, each mapped to its translation.

Rules:
- Translate the value, never the key. Return every key you were given, and no others.
- Text in curly braces such as {count} or {role} is a placeholder the software fills in. Copy it through character for character, in the same order, and translate the words around it.
- Keep the register of the original: a button stays two or three words, a note stays a sentence. Never add an explanation the original did not carry.
- Leave proper nouns alone — "Sharm Dreams Group", place names, and brand or product names stay as they are.
- Keep any punctuation that carries meaning: a trailing colon, an ellipsis, a question mark.
- If a value is already in the target language, return it unchanged.
- Return ONLY the JSON object. No markdown fences, no commentary.`;
}

function userPrompt(batch: TranslationPair[]): string {
  const payload: Record<string, string> = {};
  for (const { key, text } of batch) payload[key] = text.slice(0, MAX_SOURCE_CHARS);
  return JSON.stringify(payload, null, 1);
}

/** One usable draft, or `null` for anything that should not reach a field. */
function cleanDraft(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_TEXT_CHARS) return null;
  return text;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Translate a list of pairs, in sequential batches.
 *
 * Sequential rather than parallel on purpose: this runs against free-tier
 * endpoints that rate-limit, and 24 simultaneous calls would trade one slow run
 * for one failed one. A batch that fails leaves its keys in `unanswered` and the
 * run continues, so a single 429 costs 25 rows instead of the whole click.
 */
export async function draftTranslations(
  target: TranslationLocale,
  pairs: TranslationPair[]
): Promise<TranslationRunResult> {
  const wanted = pairs.slice(0, MAX_TRANSLATION_KEYS);
  const batches = chunk(wanted, TRANSLATION_BATCH_SIZE);

  const drafts: { key: string; text: string }[] = [];
  const unanswered: string[] = [];
  let model: string | null = null;
  let lastError: string | null = null;

  for (const batch of batches) {
    try {
      const result = await complete({
        capability: "translation",
        messages: [
          { role: "system", content: systemPrompt(target) },
          { role: "user", content: userPrompt(batch) },
        ],
        temperature: 0.2,
        maxTokens: Math.min(4000, 800 + batch.length * 90),
        jsonMode: true,
      });

      model = result.model;

      const parsed = parseJsonResponse<Record<string, unknown>>(result.content, {
        truncated: result.truncated,
      });

      for (const { key } of batch) {
        const text = cleanDraft(parsed?.[key]);
        if (text) drafts.push({ key, text });
        else unanswered.push(key);
      }
    } catch (error) {
      lastError = describeTranslationFailure(error);
      unanswered.push(...batch.map((pair) => pair.key));
    }
  }

  return {
    drafts,
    unanswered,
    model,
    batches: batches.length,
    // A run that produced nothing is a failure, not an empty answer: the console
    // has to say the model did not respond rather than show 0 rows and look done.
    error: drafts.length === 0 && wanted.length > 0 ? lastError ?? "No model answered." : null,
  };
}

/** A sentence for each way a batch can fail, said in the console's own words. */
export function describeTranslationFailure(error: unknown): string {
  if (error instanceof TruncatedJsonResponseError) {
    return "The model's answer was cut off before it finished, so that batch was dropped.";
  }
  if (error instanceof AiGatewayError) {
    return "No configured translation model answered. Check Settings → AI models → Interface translation, and that its provider has a key.";
  }
  return "The translation request failed.";
}
