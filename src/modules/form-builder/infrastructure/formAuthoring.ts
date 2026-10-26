import "server-only";

/**
 * AI-drafted application-form questions (spec §7, plan Task 9).
 *
 * A recruiter's brief goes to the `form_authoring` chain and a field list comes
 * back. Nothing here writes: the review is handed to `draftWithAI` in
 * `formActions`, which creates a DRAFT form a person then edits and publishes.
 * The publish step is the human door, and it exists for exactly the case spec §7
 * names — a model volunteering that it wants a candidate's blood type.
 *
 * Every offered question is judged by `draftIssues`, the same function a human
 * save runs, so a draft cannot carry a shape the console would refuse. A refused
 * question is dropped and named; the rest still reach the desk. Two repairs are
 * made silently because they change no meaning and the console makes them too:
 * a key is derived from the label when the model's own key is unusable, and a
 * repeated key takes a numeric suffix.
 *
 * The seven system fields are pre-placed so a drafted form opens one publish
 * away from correct: name and email (the identity contract's exactly-one rule),
 * a required CV, and the phone, LinkedIn and About fields today's fixed wizard
 * asks. `photo` is deliberately not pre-placed: the wizard has never asked for
 * one, and a draft should not quietly make every application require a portrait.
 */

import { personField } from "@/modules/candidates/domain/person-fields";
import { draftIssues, type FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import {
  DURATION_UNITS,
  FIELD_TYPES,
  KINDS,
  type FieldType,
} from "@/modules/form-builder/domain/field-types";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import {
  complete,
  parseJsonResponse,
  type CompletionRequest,
} from "@/modules/screening/infrastructure/aiGateway";

/** One run never offers more than this, so a reply stays inside its token budget. */
export const MAX_DRAFT_FIELDS = 24;
/** The recruiter's brief is clipped rather than crowding out the JSON budget. */
const BRIEF_CAP = 1500;

const KEY_PATTERN = /^[a-z][a-z0-9_]{2,59}$/;
const ADDRESS_COMPONENTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;

const DETAILS_HEADING = "Your details";

/** The first step every drafted form opens with. */
export const SEEDED_FIELDS: readonly FieldDraft[] = [
  {
    key: "your_details",
    type: "section_heading",
    label: DETAILS_HEADING,
    helpText: null,
    placeholder: null,
    required: false,
    config: {},
    systemKey: null,
  },
  {
    key: "full_name",
    type: "short_text",
    label: "Full name",
    helpText: null,
    placeholder: "As it appears on your CV",
    required: true,
    config: { maxLength: 300 },
    systemKey: "name",
  },
  {
    key: "email",
    type: "email",
    label: "Email address",
    helpText: null,
    placeholder: "you@example.com",
    required: true,
    config: {},
    systemKey: "email",
  },
  {
    key: "phone",
    type: "phone",
    label: "Phone number",
    helpText: null,
    placeholder: "Include your country code",
    required: false,
    config: {},
    systemKey: "phone",
  },
  {
    key: "cv",
    type: "file",
    label: "Your CV",
    helpText: `PDF or Word document, up to ${Math.round(LIMITS.file_bytes / (1024 * 1024))} MB.`,
    placeholder: null,
    required: true,
    config: { kinds: ["pdf", "doc"] },
    systemKey: "cv",
  },
  {
    key: "linkedin",
    type: "url",
    label: "LinkedIn profile",
    helpText: "Optional.",
    placeholder: "https://www.linkedin.com/in/…",
    required: false,
    config: {},
    systemKey: "linkedin",
  },
  {
    key: "about",
    type: "long_text",
    label: "About you",
    helpText: "A few lines on why this role interests you, or anything your CV does not cover.",
    placeholder: null,
    required: false,
    config: { maxLength: LIMITS.long_text_chars },
    systemKey: "about",
  },
];

export interface FormDraftReview {
  /** The pre-placed system fields plus every question that survived the rules. */
  fields: FieldDraft[];
  /** One sentence per question refused, in the order the model offered it. */
  dropped: string[];
  /** Questions kept, excluding the pre-placed system fields. */
  kept: number;
  /** Questions the model offered, before anything was refused. */
  asked: number;
  model: string;
  /** The provider stopped at its output cap, so the list may be incomplete. */
  truncated: boolean;
}

/**
 * The JSON contract, in one place, so the prompt and the validator cannot drift
 * apart and blame each other when a reply is refused.
 */
export const DRAFT_JSON_SHAPE = `{
  "fields": [
    {
      "type": "short_text" | "long_text" | "email" | "phone" | "url" | "number" | "percentage" | "currency" | "date" | "time" | "datetime" | "duration" | "select" | "radio" | "multi_select" | "checkbox" | "file" | "photo" | "address" | "geolocation",
      "label": "the question as the candidate reads it",
      "help": "one line under the question, or null",
      "placeholder": "grey hint inside the box, or null",
      "required": boolean,
      "section": "the step this question belongs to, or null",
      "options": ["answer", "answer"],
      "kinds": ["pdf", "doc"],
      "person_key": "profile field key, or null"
    }
  ]
}

Field rules:
- "type" is exactly one of the twenty listed values. Never "section_heading".
- "label" is 3–200 characters. Phrase it as the question the candidate answers.
- "section" groups consecutive questions into one on-screen step. Use at most
  three sections besides the details already asked, and reuse a section's exact
  wording instead of inventing a near-duplicate. null keeps the current step.
- "options" is required for select, radio and multi_select: 2 to 30 short
  distinct strings. Omit it for every other type.
- "kinds" is required for file: one or more of ${KINDS.join(", ")}. Omit it for
  photo (it is always an image) and for every other type.
- "person_key" is optional. Set it only when the answer is a fact the portal's
  person profile already stores — for example "date_of_birth", "nationality",
  "city", "notice_period" — in exact lower_snake_case. If you are not certain
  the key exists, use null. An unknown key makes the question refused.
- Mark a question "required": true only when a recruiter cannot judge the
  application without the answer.`;

const SYSTEM_PROMPT = `You are a recruitment consultant writing the questions an application form asks, for Sharm Dreams Group, a hospitality group on the Red Sea.

The application already asks for the candidate's name, email, phone, CV, LinkedIn profile and a short "About you". Do not repeat any of those.

Write 4 to 10 additional questions that help a recruiter judge this role. Ask only what a candidate can answer by typing, choosing, or uploading: skills, tools, licences, languages, availability and shift patterns, relevant experience, and the reasoning behind a choice they made. One idea per question, plain language, no jargon, no compound questions, no trick questions.

Never ask for ethnicity, religion or belief, political opinion, sexual orientation, health, disability, marital status, pregnancy, dependants, emergency contacts, salary history, date of birth, a photograph of the person, a national ID number, or any other special-category or protected fact.

Return ONLY valid JSON, no markdown:
${DRAFT_JSON_SHAPE}`;

function text(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, cap) : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function headingKey(index: number, used: ReadonlySet<string>): string {
  let key = `section_${index}`;
  for (let n = 2; used.has(key) && n < 100; n += 1) key = `section_${index}_${n}`;
  return key;
}

/** A usable snapshot key: the model's own when valid, else derived from the label. */
function fieldKey(raw: unknown, label: string, index: number, used: ReadonlySet<string>): string {
  const given = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const base = KEY_PATTERN.test(given)
    ? given
    : (() => {
        const slug = label
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 56);
        return KEY_PATTERN.test(slug) ? slug : `question_${index + 1}`;
      })();

  let key = base;
  for (let n = 2; used.has(key) && n < 100; n += 1) {
    key = `${base.slice(0, 56)}_${n}`;
  }
  return key;
}

function configFor(type: FieldType, entry: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "short_text":
      return { maxLength: 300 };
    case "long_text":
      return { maxLength: LIMITS.long_text_chars };
    case "select":
    case "radio":
    case "multi_select":
      return {
        options: distinct(stringArray(entry.options)).slice(0, LIMITS.options_per_choice_field),
      };
    case "number":
      return { decimals: 2 };
    case "percentage":
      return { decimals: LIMITS.percentage_decimals };
    case "file": {
      const kinds = stringArray(entry.kinds);
      return { kinds: kinds.length > 0 ? kinds : ["pdf", "doc"] };
    }
    case "photo":
      return { kinds: ["image"] };
    case "address":
      return { components: [...ADDRESS_COMPONENTS] };
    case "duration":
      return { units: [...DURATION_UNITS] };
    default:
      return {};
  }
}

/**
 * Turns a model's reply into fields a recruiter can review, without writing.
 *
 * The model is not trusted with a key, a config or a binding: keys are repaired,
 * configs come from the field type, and `draftIssues` — the console's own save
 * check — decides whether each resulting question is storable. A whole-form
 * refusal (the ceiling) stops the run rather than dropping everything after it
 * one at a time.
 */
export async function draftFormFields(brief: string): Promise<FormDraftReview> {
  const request: CompletionRequest = {
    capability: "form_authoring",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `THE RECRUITER'S BRIEF:\n${brief.slice(0, BRIEF_CAP)}` },
    ],
    temperature: 0.5,
    maxTokens: 2600,
    jsonMode: true,
  };

  const result = await complete(request);
  const parsed = parseJsonResponse<{ fields?: unknown }>(result.content, {
    truncated: result.truncated,
  });

  const offered = Array.isArray(parsed.fields) ? parsed.fields : [];
  const candidates = offered.slice(0, MAX_DRAFT_FIELDS);

  let fields: FieldDraft[] = [...SEEDED_FIELDS];
  const used = new Set(fields.map((field) => field.key));
  const dropped: string[] = [];
  let currentSection = DETAILS_HEADING.toLowerCase();
  let sectionCount = 1;
  let kept = 0;

  if (offered.length > candidates.length) {
    dropped.push(
      `The model offered ${offered.length} rows; only the first ${MAX_DRAFT_FIELDS} were reviewed.`,
    );
  }

  for (const [index, raw] of candidates.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      dropped.push(`Question ${index + 1} was not an object, so it was not added.`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const type = typeof entry.type === "string" ? entry.type.trim() : "";
    const label = text(entry.label, 200);

    if (type === "section_heading") {
      // A model may group with headings instead of `section`; honour the wording.
      if (!label) {
        dropped.push(`Heading ${index + 1} had no text, so it was not added.`);
        continue;
      }
      if (label.toLowerCase() === currentSection) continue;
      const key = headingKey(sectionCount + 1, used);
      const heading: FieldDraft = {
        key,
        type: "section_heading",
        label,
        helpText: null,
        placeholder: null,
        required: false,
        config: {},
        systemKey: null,
      };
      const issues = draftIssues([...fields, heading]);
      const whole = issues.find((issue) => issue.fieldKey === "*");
      if (whole) {
        dropped.push(whole.message);
        // A whole-form refusal is the form's, not the heading's: no later row can
        // fall inside the ceiling, so the run stops here.
        break;
      }
      if (issues.length > 0) {
        dropped.push(issues[0].message);
        continue;
      }
      fields = [...fields, heading];
      used.add(key);
      sectionCount += 1;
      currentSection = label.toLowerCase();
      continue;
    }

    if (!(FIELD_TYPES as readonly string[]).includes(type)) {
      dropped.push(
        label
          ? `“${label}” is a “${type || "blank"}” field, which this portal cannot store.`
          : `Question ${index + 1} named a “${type || "blank"}” field, which this portal cannot store.`,
      );
      continue;
    }
    const fieldType = type as FieldType;

    if (!label) {
      dropped.push(`Question ${index + 1} had no label, so it was not added.`);
      continue;
    }

    let systemKey: string | null = null;
    const personKey = text(entry.person_key, 80);
    if (personKey) {
      const registry = personField(personKey);
      if (!registry) {
        dropped.push(
          `“${label}” asked to save the profile fact "${personKey}", which this portal does not keep — the question was not added.`,
        );
        continue;
      }
      systemKey = `person:${personKey}`;
    }

    const section = text(entry.section, 200);
    const wantsHeading = section !== null && section.toLowerCase() !== currentSection;

    const candidateKey = fieldKey(entry.key, label, index, used);
    const candidate: FieldDraft = {
      key: candidateKey,
      type: fieldType,
      label,
      helpText: text(entry.help, 300),
      placeholder: text(entry.placeholder, 200),
      required: entry.required === true,
      config: configFor(fieldType, entry),
      systemKey,
    };

    const proposed: FieldDraft[] = [];
    if (wantsHeading && section) {
      proposed.push({
        key: headingKey(sectionCount + 1, used),
        type: "section_heading",
        label: section,
        helpText: null,
        placeholder: null,
        required: false,
        config: {},
        systemKey: null,
      });
    }
    proposed.push(candidate);

    const issues = draftIssues([...fields, ...proposed]);
    const whole = issues.find((issue) => issue.fieldKey === "*");
    if (whole) {
      dropped.push(whole.message);
      // The ceiling is the form's, not the question's: later rows cannot fall
      // inside it either, so the run stops instead of refusing them one by one.
      break;
    }
    const refused = issues.find((issue) => issue.fieldKey === candidate.key);
    if (refused) {
      dropped.push(refused.message);
      continue;
    }
    const headingRefused = issues.find((issue) => issue.fieldKey !== candidate.key);
    if (headingRefused) {
      dropped.push(headingRefused.message);
      continue;
    }

    fields = [...fields, ...proposed];
    for (const field of proposed) used.add(field.key);
    if (wantsHeading && section) {
      sectionCount += 1;
      currentSection = section.toLowerCase();
    }
    kept += 1;
  }

  if (offered.length === 0) {
    dropped.push("The model returned no questions.");
  }

  return {
    fields,
    dropped,
    kept,
    asked: offered.length,
    model: result.model,
    truncated: result.truncated,
  };
}

/** One sentence for the console, including what came back short or refused. */
export function reviewNote(review: FormDraftReview): string {
  if (review.kept === 0) {
    return review.dropped[0] ?? "The model returned no questions.";
  }
  const parts = [
    `${review.kept} question${review.kept === 1 ? "" : "s"} drafted${
      review.dropped.length > 0 ? `, ${review.dropped.length} refused` : ""
    }.`,
  ];
  if (review.dropped.length > 0) {
    parts.push("Every refusal is listed, and none of it was stored.");
  }
  if (review.truncated) {
    parts.push("The model stopped at its output limit, so there may be more — run it again for the rest.");
  }
  return parts.join(" ");
}
