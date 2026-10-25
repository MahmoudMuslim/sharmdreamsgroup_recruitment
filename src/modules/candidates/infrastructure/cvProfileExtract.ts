import "server-only";

/**
 * Turns CV text into a dated, structured Tier-1 profile for the person spine
 * (spec §5) — the one rung between "a model read the document" and "a
 * recruiter confirmed the row."
 *
 * The discipline is inherited from the prospect structurer
 * (`src/modules/sourcing/infrastructure/profile-extract.ts`), with one
 * deliberate divergence: what `normalizeProspectProfile` guards is not reused
 * here (spec §5:825 — its job is to keep dates as strings; dates here must
 * become `start_year`/`start_month` numbers with a stated granularity), so this
 * file owns its own boundary.
 *
 * The capability is `resume_screening`, the same routing a CV read uses: a
 * document being turned into structured facts about a person is exactly what
 * that chain is configured for, and Settings → AI models stays authoritative
 * over one model list rather than two.
 *
 * NAMING MAP: the model-facing JSON is snake_case (spec §5's documented shape,
 * e.g. `start_year`, `as_written`); the `ExtractedPersonProfile` this module
 * exports is camelCase (`startYear`, `asWritten`). `validateExtractedPersonProfile`
 * is the only place the two spellings meet — every field below is read by its
 * snake_case name and written by its camelCase one.
 *
 * THE BOUNDARY IS CODE, NOT THE PROMPT: a prompt instruction is a wish, so any
 * top-level key outside the schema's own set — a `marital_status`, a
 * `nationality`, a `phone` — is dropped AND NAMED in `dropped` (spec §5:857:
 * an extractor returning a forbidden field is evidence of a prompt leak, and
 * the only honest response is to say so out loud). Inside the allowed sections,
 * one invalid sub-field never kills a whole record: an out-of-range skill level
 * is nulled with the skill kept, a bogus certification year is nulled with the
 * certificate kept. Only a record with no identity at all (no employer, no
 * institution, no skill name) is dropped — an empty bullet is worse than no
 * bullet.
 */

import {
  AiGatewayError,
  TruncatedJsonResponseError,
  complete,
  parseJsonResponse,
} from "@/modules/screening/infrastructure/aiGateway";
import { extractableFieldKeys } from "@/modules/candidates/domain/person-fields";
import { PERSON_LIMITS } from "@/modules/candidates/domain/person-limits";

/** What the record door already knows about the person, to anchor the read. */
export interface ExtractPersonHints {
  name?: string | null;
  email?: string | null;
}

/** The validated profile — every field maps to a Tier-1 extractable target. */
export interface ExtractedPersonProfile {
  experience: { employer: string; title?: string; location?: string;
                startYear: number; startMonth?: number | null;
                endYear?: number | null; endMonth?: number | null;
                ongoing: boolean; duties?: string; asWritten: string }[];
  education: { institution: string; level: string; degree?: string;
               field?: string; graduationYear?: number | null;
               gpa?: number | null; honors?: string; asWritten: string }[];
  languages: { language: string; proficiency: string }[];
  skills: { skill: string; proficiency?: number | null; asWritten: string }[];
  certifications: { title: string; issuer?: string | null; year?: number | null; asWritten: string }[];
  location?: string;
}

/**
 * The schema's OWN declared top-level keys. These are the extraction targets;
 * their registry counterparts are reached by the aliases below (the model
 * never writes the registry names `employment` / `current_city`, so a literal
 * `extractableFieldKeys()` membership test would drop the two most important
 * sections — the aliases are the honest correspondence, asserted in dev below).
 */
const SCHEMA_KEYS = ["experience", "education", "languages", "skills", "certifications", "location"] as const;

/** Schema key → Tier-1 registry key (person-fields). Task 16's proof owns the full claim. */
const SCHEMA_TO_REGISTRY: Record<(typeof SCHEMA_KEYS)[number], string> = {
  experience: "employment",
  education: "education",
  languages: "languages",
  skills: "skills",
  certifications: "certifications",
  location: "current_city",
};

if (process.env.NODE_ENV !== "production") {
  const tier1 = new Set(extractableFieldKeys());
  for (const [schemaKey, registryKey] of Object.entries(SCHEMA_TO_REGISTRY)) {
    if (!tier1.has(registryKey)) {
      throw new Error(
        `cvProfileExtract: schema key "${schemaKey}" maps to "${registryKey}", which is no longer Tier-1 extractable`
      );
    }
  }
}

/** The same 1950–2200 window the 043 date-column CHECKs use. */
const YEAR_MIN = 1950;
const YEAR_MAX = 2200;

const SYSTEM_PROMPT = `You read a candidate's CV exactly as it was written and record only what the text itself states. Nothing is inferred, nothing is filled in.

Rules:
- Never invent an employer, job title, date, school, skill, certification or level. If the text does not say it, leave that field out.
- Keep names, companies, universities and titles spelled as the CV writes them.
- Omit a section entirely when the CV holds nothing for it.
- Return ONLY one JSON object. No markdown fences, no commentary.
- Convert a date only when the text states a month by name or number. Never guess a month from a season, a school year or a holiday.
- Report nothing about marriage, children, health, disability, religion, nationality, blood type, housing or an address. If the text states them, ignore them.
- Report a skill level only when the text states one; otherwise \`proficiency\` is null. Never infer a level from seniority, from a job title, or from how many skills are listed.`;

function userPrompt(cvText: string, hints: ExtractPersonHints): string {
  const known = [
    hints.name ? `name: ${hints.name}` : null,
    hints.email ? `email: ${hints.email}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `${known ? `The candidate this CV belongs to, as already recorded: ${known}.\n\n` : ""}CV TEXT:
${cvText}

Write every section the text contains, using exactly these keys and nothing else:
{
  "experience": [{ "employer": string, "title": string, "location": string, "start_year": number, "start_month": number | null, "end_year": number | null, "end_month": number | null, "ongoing": boolean, "duties": string, "as_written": string }],
  "education": [{ "institution": string, "level": string, "degree": string, "field": string, "graduation_year": number | null, "gpa": number | null, "honors": string, "as_written": string }],
  "languages": [{ "language": string, "proficiency": string }],
  "skills": [{ "skill": string, "proficiency": number | null, "as_written": string }],
  "certifications": [{ "title": string, "issuer": string | null, "year": number | null, "as_written": string }],
  "location": string
}
- Years are four-digit numbers. Months are 1-12 and only when the text names the month; otherwise null.
- "ongoing" is true only when the text says the role is current or present.
- "as_written" quotes the CV's own line for that entry, as it stands.
- A skill "proficiency" is a whole number from 1 to 5, and only when the CV states that level; otherwise null.
Omit a section entirely when the CV holds nothing for it.`;
}

// ——— defensive readers (model output is an untrusted boundary) ——————————————

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function block(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

/** An optional integer in [min, max]; absent → null silently, invalid → null + named. */
function optionalInt(
  value: unknown,
  min: number,
  max: number,
  name: string,
  dropped: string[]
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    dropped.push(name);
    return null;
  }
  return n;
}

/**
 * Caps a section's rows at the PERSON_LIMITS row ceiling and says so when the
 * model tried to return more (the caps exist precisely as guards against
 * runaway extraction — a silently truncated list would mislead the preview).
 */
function capRows<T>(
  list: T[],
  limit: number,
  section: string,
  dropped: string[]
): T[] {
  if (list.length > limit) {
    dropped.push(`${section}[] beyond ${limit} rows (kept the first ${limit})`);
    return list.slice(0, limit);
  }
  return list;
}

/**
 * Turns whatever a model returned into an `ExtractedPersonProfile`, dropping
 * and NAMING everything the extractor is not allowed to write.
 *
 * Drop rules, each one deliberate:
 * - top-level key outside the schema set → dropped, named (prompt-leak alarm);
 * - experience with no employer or no usable start_year → record dropped,
 *   named (an undated, unattributed role is an empty bullet);
 * - education with no institution → record dropped, named;
 * - language with no language name → record dropped, named; a missing
 *   `proficiency` stays "" (the name is the fact; the level is the wish);
 * - skill with no name → record dropped, named; proficiency outside 1–5 or
 *   fractional → the SKILL IS KEPT, the level nulled, `skills[].proficiency`
 *   named (spec §5: refusing "React" over an invented 9 would shrink the
 *   profile the recruiter asked for);
 * - certification with no title → record dropped, named; year outside
 *   1950–2200 → the RECORD IS KEPT, year nulled, named;
 * - a missing `as_written` is rebuilt from the entry's own reported words —
 *   never a reason to drop a record;
 * - any section longer than its PERSON_LIMITS row cap → cut to the cap, named.
 */
export function validateExtractedPersonProfile(raw: unknown): {
  value: ExtractedPersonProfile;
  dropped: string[];
} {
  const dropped: string[] = [];
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  // The prompt-leak alarm: every foreign key is said out loud.
  for (const key of Object.keys(source)) {
    if (!(SCHEMA_KEYS as readonly string[]).includes(key)) dropped.push(key);
  }

  const experience = capRows(
    rows(source.experience).flatMap((item, i) => {
      const employer = text(item.employer ?? item.company, PERSON_LIMITS.text_name_employer_institution);
      // start_year is REQUIRED here (a role nobody can date is an empty bullet),
      // so a bad value kills the record — and the record drop names it.
      const startYear = optionalInt(item.start_year, YEAR_MIN, YEAR_MAX, "", []);
      if (!employer || startYear === null) {
        dropped.push(`experience[${i}] dropped (no employer or no usable start_year)`);
        return [];
      }
      const title = text(item.title, PERSON_LIMITS.text_name_employer_institution) ?? undefined;
      const roleLocation = text(item.location, PERSON_LIMITS.text_name_employer_institution) ?? undefined;
      const startMonth = optionalInt(item.start_month, 1, 12, `experience[${i}].start_month`, dropped);
      const endYear = optionalInt(item.end_year, YEAR_MIN, YEAR_MAX, `experience[${i}].end_year`, dropped);
      const endMonth = optionalInt(item.end_month, 1, 12, `experience[${i}].end_month`, dropped);
      const duties = block(item.duties, PERSON_LIMITS.text_long) ?? undefined;
      const asWritten =
        text(item.as_written, PERSON_LIMITS.text_as_written) ??
        [title, employer, `${startYear}${startMonth ? `/${startMonth}` : ""}`].filter(Boolean).join(" — ");
      return [{
        employer,
        ...(title !== undefined && { title }),
        ...(roleLocation !== undefined && { location: roleLocation }),
        startYear,
        startMonth,
        endYear,
        endMonth,
        ongoing: item.ongoing === true,
        ...(duties !== undefined && { duties }),
        asWritten,
      }];
    }),
    PERSON_LIMITS.employment_rows,
    "experience",
    dropped
  );

  const education = capRows(
    rows(source.education).flatMap((item, i) => {
      const institution = text(
        item.institution ?? item.school ?? item.university,
        PERSON_LIMITS.text_name_employer_institution
      );
      if (!institution) {
        dropped.push(`education[${i}] dropped (no institution)`);
        return [];
      }
      const level = text(item.level, 80) ?? "";
      const degree = text(item.degree, PERSON_LIMITS.text_name_employer_institution) ?? undefined;
      const field = text(item.field, PERSON_LIMITS.text_name_employer_institution) ?? undefined;
      const graduationYear = optionalInt(
        item.graduation_year, YEAR_MIN, YEAR_MAX, `education[${i}].graduation_year`, dropped
      );
      const gpa = optionalGpa(item.gpa, `education[${i}].gpa`, dropped);
      const honors = text(item.honors, PERSON_LIMITS.text_as_written) ?? undefined;
      const asWritten =
        text(item.as_written, PERSON_LIMITS.text_as_written) ??
        [level, degree, institution].filter(Boolean).join(" — ");
      return [{
        institution,
        level,
        ...(degree !== undefined && { degree }),
        ...(field !== undefined && { field }),
        graduationYear,
        gpa,
        ...(honors !== undefined && { honors }),
        asWritten,
      }];
    }),
    PERSON_LIMITS.education_rows,
    "education",
    dropped
  );

  const languages = capRows(
    rows(source.languages).flatMap((item, i) => {
      const language = text(item.language ?? item.name, PERSON_LIMITS.text_name_employer_institution);
      if (!language) {
        dropped.push(`languages[${i}] dropped (no language name)`);
        return [];
      }
      return [{ language, proficiency: text(item.proficiency, 80) ?? "" }];
    }),
    PERSON_LIMITS.languages_rows,
    "languages",
    dropped
  );

  const skills = capRows(
    rows(source.skills).flatMap((item, i) => {
      const skill = text(item.skill ?? item.name, PERSON_LIMITS.text_name_employer_institution);
      if (!skill) {
        dropped.push(`skills[${i}] dropped (no skill name)`);
        return [];
      }
      // Out of range or fractional: the skill is kept, only the level is nulled.
      const proficiency = optionalInt(item.proficiency, 1, 5, "skills[].proficiency", dropped);
      const asWritten =
        text(item.as_written, PERSON_LIMITS.text_as_written) ?? skill;
      return [{ skill, proficiency, asWritten }];
    }),
    PERSON_LIMITS.skills_rows,
    "skills",
    dropped
  );

  const certifications = capRows(
    rows(source.certifications).flatMap((item, i) => {
      const title = text(item.title ?? item.name, PERSON_LIMITS.text_name_employer_institution);
      if (!title) {
        dropped.push(`certifications[${i}] dropped (no title)`);
        return [];
      }
      const issuer = text(item.issuer ?? item.organization, PERSON_LIMITS.text_name_employer_institution);
      // A bad year nulls, it never kills the certificate.
      const year = optionalInt(item.year, YEAR_MIN, YEAR_MAX, "certifications[].year", dropped);
      const asWritten =
        text(item.as_written, PERSON_LIMITS.text_as_written) ??
        [title, issuer].filter(Boolean).join(" — ");
      return [{ title, issuer, year, asWritten }];
    }),
    PERSON_LIMITS.certifications_rows,
    "certifications",
    dropped
  );

  const location = text(source.location, PERSON_LIMITS.text_name_employer_institution);

  return {
    value: {
      experience,
      education,
      languages,
      skills,
      certifications,
      ...(location ? { location } : {}),
    },
    dropped,
  };
}

/** GPAs arrive on 4.0, 5.0 and 10.0 scales; anything outside 0–10 is not a grade point. */
function optionalGpa(value: unknown, name: string, dropped: string[]): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    dropped.push(name);
    return null;
  }
  return Math.round(n * 100) / 100;
}

/**
 * Structures one CV and keeps the `dropped` names beside the value.
 *
 * Spec §5 wants the record door's preview to print "Ignored N fields the
 * extractor is not allowed to write", so the names the validator collected must
 * reach the caller rather than being thrown away. This is the reporting variant
 * the door calls; `extractPersonProfile` below stays the simple value-only
 * surface every other caller already uses.
 *
 * The throws are unchanged from `extractPersonProfile`: a refused chain
 * (`AiGatewayError`) and a mid-JSON cap (`TruncatedJsonResponseError`) both
 * escape so `describeExtractionFailure` can name which happened — neither is a
 * reason to hand back a half-profile with a `dropped` list beside it.
 */
export async function extractPersonProfileWithReport(
  cvText: string,
  hints: ExtractPersonHints = {}
): Promise<{ value: ExtractedPersonProfile; dropped: string[] }> {
  const result = await complete({
    capability: "resume_screening",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(cvText.slice(0, PERSON_LIMITS.extraction_input_chars), hints) },
    ],
    temperature: 0.1,
    maxTokens: PERSON_LIMITS.extraction_output_tokens,
    jsonMode: true,
  });

  const parsed = parseJsonResponse<unknown>(result.content, { truncated: result.truncated });
  return validateExtractedPersonProfile(parsed);
}

/**
 * Structures one CV into a validated Tier-1 profile.
 *
 * Returns the `value` half of `validateExtractedPersonProfile` and DISCARDS
 * the `dropped` list — the record door's preview (Task 11) calls
 * `extractPersonProfileWithReport` when it needs to print "Ignored N fields the
 * extractor is not allowed to write", so the names are never far away.
 */
export async function extractPersonProfile(
  cvText: string,
  hints: ExtractPersonHints = {}
): Promise<ExtractedPersonProfile> {
  const { value } = await extractPersonProfileWithReport(cvText, hints);
  return value;
}

/** A recruiter-facing sentence for each way the structuring step can fail. */
export function describeExtractionFailure(error: unknown): string {
  if (error instanceof TruncatedJsonResponseError) {
    return "The model ran out of room part-way through that CV. Structure a shorter section, or try again.";
  }
  if (error instanceof AiGatewayError) {
    return `No configured model answered, so the CV could not be structured: ${error.message.slice(0, 160)}`;
  }
  if (error instanceof Error) return `The CV could not be structured: ${error.message.slice(0, 160)}`;
  return "The CV could not be structured.";
}
