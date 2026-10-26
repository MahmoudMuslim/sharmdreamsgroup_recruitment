import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";
import { storageConfig } from "@/lib/config";
import { getFileStore } from "@/lib/files/store";
import { MAX_LINK_SECONDS } from "@/lib/files/signed-link";
import { publicBaseUrl } from "@/lib/public-url";

import { emailSpellings, personKey } from "@/modules/candidates/domain/personIdentity";
import { fieldsForTier } from "@/modules/candidates/domain/person-fields";
import { PERSON_LIMITS } from "@/modules/candidates/domain/person-limits";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { parseSnapshot, type SnapshotField } from "@/modules/form-builder/domain/snapshot";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";

/**
 * What a person is sent when they ask for a copy of what is held.
 *
 * The copy is mail rather than a screen because the request was filed by an
 * anonymous visitor who proved the address is theirs; answering into the browser
 * would hand the data to whoever is sitting in front of it now. It is built from
 * the person's own rows — every application under the address, the consent
 * history, the papers they sat and the answers they wrote — and sent to the
 * address the request was filed with, which is the address the verification step
 * matched against a record.
 *
 * Since migration 043 the letter has two halves. The application rows are the
 * half that existed before: which openings they applied to, what they wrote in
 * the boxes, what was decided. The person half (§8.2) is the spine — the name,
 * the address list, the five claim collections, the photograph, and the change
 * log. A subject-access request that answered only the first half returned less
 * than the portal itself shows, which is not what a subject-access right means.
 *
 * Since migration 044 the application rows carry the form's own answers: what
 * the candidate wrote in the boxes the form asked, as it was asked that day. An
 * answer that also became part of the profile is printed in both places, and the
 * letter says so rather than reconciling them — the snapshot is what was sent
 * and the profile is what is held now, and where they differ both are true.
 *
 * Tier 3 is read here and NOT printed here. §8.2 is explicit that a Gmail
 * message is not a secure channel for a blood type, so the four special-category
 * tables are read on the service role for their *shape* — which categories are
 * held, and how many third-party rows each carries — and the letter names that
 * without quoting a value. The requester is told the categories exist and that
 * their contents are not in the mail, rather than being told nothing and reading
 * an incomplete copy. Rendering the values into a document the token-holder
 * opens is the surface §8.2 asks for and this slice does not ship; see the
 * ⚠️ owner note in the SDD ledger.
 *
 * Bounded on purpose: an old application can carry thousands of answers, and a
 * mail server will take a truncated letter where it rejects a huge one. Every cut
 * is printed in the letter, so nobody mistakes a partial copy for the whole.
 * The ceilings are the ones in `PERSON_LIMITS` — this file imports them, it does
 * not own them.
 */

/** How many written answers one letter carries before it says it stopped. */
const MAX_ANSWERS = PERSON_LIMITS.access_copy_answers;

/** How much of one answer is quoted. */
const MAX_ANSWER_CHARS = PERSON_LIMITS.access_copy_answer_chars;

/** How many applications one person's copy covers before it says it stopped. */
const MAX_APPLICATIONS = PERSON_LIMITS.access_copy_applications;

/**
 * The Tier-3 tables, and what to call them in the letter. These rows are read
 * for their count only; the values stay in the database.
 */
const SPECIAL_CATEGORY_TABLES = [
  { table: "person_health", label: "health" },
  { table: "person_family_details", label: "family details" },
  { table: "person_dependants", label: "dependants" },
  { table: "person_emergency_contacts", label: "emergency contacts" },
] as const;

/**
 * The `person_events` groups whose values are Tier 3. The change log quotes
 * old and new values, so an event about a blood type *is* the blood type — the
 * filter is on the group, not on the column list.
 */
const SPECIAL_CATEGORY_EVENT_GROUPS = new Set([
  "health",
  "family_details",
  "dependants",
  "emergency_contacts",
]);

type ServiceClient = ReturnType<typeof getServiceRestClient>;

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function cut(value: unknown, limit: number = MAX_ANSWER_CHARS): string {
  const raw = text(value).trim();
  return raw.length > limit ? `${raw.slice(0, limit)}… [cut at ${limit} characters]` : raw;
}

function iso(value: unknown): string {
  const raw = text(value);
  return raw ? new Date(raw).toISOString() : "";
}

interface ApplicationRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  stage: string;
  created_at: string;
  ai_score: string;
  ai_screening_summary: string;
  jobTitle: string;
}

async function readApplications(
  service: ServiceClient,
  email: string
): Promise<{ rows: ApplicationRow[]; capped: boolean; error?: string }> {
  const { data, error } = await service
    .from("applications")
    .select(
      "id, full_name, email, phone, stage, created_at, ai_score, ai_screening_summary, " +
        "job_openings ( title )"
    )
    .in("email", emailSpellings(email))
    .order("created_at", { ascending: true })
    .limit(MAX_APPLICATIONS + 1);

  if (error) return { rows: [], capped: false, error: error.message };

  const all = ((data ?? []) as Record<string, unknown>[]).map((raw) => {
    const job = nested<{ title?: string }>(raw.job_openings);
    return {
      id: String(raw.id),
      full_name: text(raw.full_name),
      email: text(raw.email),
      phone: text(raw.phone),
      stage: text(raw.stage),
      created_at: iso(raw.created_at),
      ai_score: text(raw.ai_score),
      ai_screening_summary: text(raw.ai_screening_summary),
      jobTitle: job?.title ? String(job.title) : "an unnamed role",
    };
  });

  return {
    rows: all.length > MAX_APPLICATIONS ? all.slice(0, MAX_APPLICATIONS) : all,
    capped: all.length > MAX_APPLICATIONS,
  };
}

async function readConsents(
  service: ServiceClient,
  applicationId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("candidate_consents")
    .select("purpose, granted, notice_version, recorded_at")
    .eq("application_id", applicationId)
    .order("recorded_at", { ascending: true });

  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(
    (raw) =>
      `${iso(raw.recorded_at)} — ${text(raw.purpose)}: ${
        raw.granted === true ? "granted" : "declined"
      } (notice ${text(raw.notice_version)})`
  );
}

interface AttemptBlock {
  lines: string[];
  answers: number;
}

async function readAttempts(
  service: ServiceClient,
  applicationId: string,
  budget: { answers: number }
): Promise<AttemptBlock> {
  const { data, error } = await service
    .from("candidate_attempts")
    .select("id, status, submitted_at, total_score, max_score, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) return { lines: [], answers: 0 };

  const lines: string[] = [];
  let answers = 0;

  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const status = text(raw.status);
    const score =
      text(raw.total_score) && text(raw.max_score)
        ? `${text(raw.total_score)} / ${text(raw.max_score)}`
        : "not marked";
    lines.push(
      `- Test issued ${iso(raw.created_at)}, status ${status || "unknown"}, score ${score}${
        raw.submitted_at ? `, submitted ${iso(raw.submitted_at)}` : ""
      }`
    );

    if (budget.answers >= MAX_ANSWERS) continue;

    const { data: responses, error: responseError } = await service
      .from("candidate_responses")
      .select(
        "answer_text, transcript, score, max_score, " +
          "question:assessment_questions!candidate_responses_question_id_fkey ( title, prompt )"
      )
      .eq("attempt_id", String(raw.id));

    if (responseError) continue;

    for (const response of (responses ?? []) as Record<string, unknown>[]) {
      if (budget.answers >= MAX_ANSWERS) break;
      const question = nested<{ title?: string; prompt?: string }>(response.question);
      const mark =
        text(response.score) && text(response.max_score)
          ? ` (${text(response.score)} / ${text(response.max_score)})`
          : "";
      lines.push(
        `  ${question?.title ? String(question.title) : "Question"}${
          question?.prompt ? ` — ${cut(question.prompt, 500)}` : ""
        }${mark}`
      );
      if (text(response.answer_text)) lines.push(`    Your answer: ${cut(response.answer_text)}`);
      if (text(response.transcript))
        lines.push(`    Transcript: ${cut(response.transcript)}`);
      answers += 1;
      budget.answers += 1;
    }
  }

  return { lines, answers };
}

async function readInterviews(
  service: ServiceClient,
  applicationId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("interview_schedules")
    .select("scheduled_at, status, meeting_link")
    .eq("application_id", applicationId)
    .order("scheduled_at", { ascending: true });

  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(
    (raw) =>
      `- ${iso(raw.scheduled_at)} — ${text(raw.status) || "unknown"}${
        text(raw.meeting_link) ? ` — ${text(raw.meeting_link)}` : ""
      }`
  );
}

// ————————————————————————————————————————————————————————————————————————————
// the form half — spec §8
// ————————————————————————————————————————————————————————————————————————————

/**
 * What one answer reads as, in a sentence.
 *
 * A person asking what we hold is owed a sentence, not their own jsonb: a
 * duration is "45 minutes", a location is a pair of numbers, a file is the name
 * of the file. A blank answer is "not given" — the fact that a question was
 * asked and left empty is part of what was filed.
 */
function printAnswer(field: SnapshotField): string {
  const value = field.value;

  if (value === null || value === undefined) return "not given";

  switch (field.type) {
    case "file":
    case "photo":
      return typeof value === "string" && value ? `the file “${value}”` : "no file";
    case "duration": {
      const pair = value as { value?: unknown; unit?: unknown };
      return typeof pair.value === "number" && typeof pair.unit === "string"
        ? `${pair.value} ${pair.unit}`
        : "not given";
    }
    case "geolocation": {
      const pair = value as { lat?: unknown; lng?: unknown };
      return typeof pair.lat === "number" && typeof pair.lng === "number"
        ? `${pair.lat}, ${pair.lng}`
        : "not given";
    }
    case "multi_select":
      return Array.isArray(value) ? value.join(", ") : "not given";
    case "checkbox":
      return value === "true" ? "yes" : "no";
    default:
      return typeof value === "string" ? value : "not given";
  }
}

/**
 * What the candidate wrote in the application form, as it was asked.
 *
 * The snapshot is the record of the questions *as they were on the day*, so it
 * stays the honest answer to "what did you tell us" even after the form has
 * been edited or retired. It is read on its own because `form_answers` is a 044
 * column: naming it beside the older columns would refuse the whole read on a
 * database that has not been migrated.
 */
async function readFormAnswers(
  service: ServiceClient,
  applicationId: string
): Promise<{ lines: string[]; capped: boolean }> {
  const { data, error } = await service
    .from("applications")
    .select("form_answers")
    .eq("id", applicationId)
    .maybeSingle();

  if (error) {
    // 044 is applied per file by the owner, so a database without the column
    // holds no form answers to print.
    if (!isMissingSchemaError(error)) {
      console.error("[privacy] the form answers were unreadable:", error.message);
    }
    return { lines: [], capped: false };
  }

  const snapshot = parseSnapshot((data as Record<string, unknown> | null)?.form_answers);
  if (!snapshot) return { lines: [], capped: false };

  const lines: string[] = [];
  let capped = false;

  for (const field of snapshot.fields) {
    if (field.type === "section_heading") continue;
    if (lines.length >= MAX_ANSWERS) {
      capped = true;
      break;
    }
    lines.push(`${field.label}: ${cut(printAnswer(field))}`);
  }

  return { lines, capped };
}

// ————————————————————————————————————————————————————————————————————————————
// the person half — spec §8.2
// ————————————————————————————————————————————————————————————————————————————

/** The bucket the profile photo lives in — the same one erasure clears. */
const PHOTO_BUCKET = storageConfig.buckets.candidatePhotos;

/**
 * The registry's name-shaped ceiling, cited by a short name so the renderers
 * below stay readable. It is an alias into `PERSON_LIMITS`, not a number this
 * file owns.
 */
const NAME_CEILING = PERSON_LIMITS.text_name_employer_institution;

/** Printed in place of the whole person half when 043 is not on this database. */
const SPINE_MISSING_NOTE =
  "Person details need migration 043, so this copy carries the application rows only.";

/**
 * Printed when the spine is there but the person half did not read. The letter is
 * still sent — the application rows are the copy this portal has always been able
 * to give — but a missing half is named, never left as a silent absence.
 */
const SPINE_FAILED_NOTE = "The person-profile half of this copy could not be read";

/** The §8.2 note that the third-party collections carry. */
const THIRD_PARTY_NOTE =
  "Dependants and emergency contacts are other people's data, held because you gave it. " +
  "A child's name and date of birth are your own data as you reported it; an emergency " +
  "contact's phone number is somebody else's. The copy names that rather than pretending.";

/** Why the special-category values are absent from a mail that lists their shape. */
const SPECIAL_CATEGORY_NOTE =
  "Those four categories are held behind their own staff grants and their contents are not " +
  "in this message: a mailbox is not a secure channel for a blood type. To receive the " +
  "values, ask again through the same privacy page and name the category.";

/** Internal signal: a spine table this database does not have. */
class SpineMissing extends Error {
  constructor(table: string) {
    super(`person spine table missing: ${table}`);
    this.name = "SpineMissing";
  }
}

type Row = Record<string, unknown>;

/**
 * The `person_profiles` scalars the copy prints, straight from the registry.
 *
 * Tier 1 and Tier 2 and nothing else — the list is derived, never typed, so a
 * Tier-3 column added to the profile table tomorrow cannot ride into a mailbox by
 * an edit someone forgot to make here. The photo is excluded and rendered as a
 * link instead of a path.
 */
const PROFILE_SCALARS = [...fieldsForTier(1), ...fieldsForTier(2)].filter(
  (field) =>
    field.table === "person_profiles" &&
    Boolean(field.column) &&
    field.input !== "list" &&
    field.input !== "photo"
);

/** The photo columns, read together so the link can name its own content type. */
const PHOTO_COLUMNS = ["photo_path", "photo_mime"];

function profileSelect(): string {
  const columns = new Set<string>(["id", "created_at", "updated_at", "erased_at", ...PHOTO_COLUMNS]);
  for (const field of PROFILE_SCALARS) columns.add(field.column as string);
  return [...columns].join(", ");
}

function value(row: Row, column: string): string {
  return text(row[column]).trim();
}

/** A long text column printed on one line, cut to the registry's own ceiling. */
function printable(row: Row, column: string, limit: number): string {
  return cut(row[column], limit).replace(/\s+/g, " ");
}

/** A `date` column as the day it is, not as the timestamp PostgREST may hand back. */
function day(column: unknown): string {
  const raw = text(column).trim();
  return raw ? raw.slice(0, 10) : "";
}

/**
 * A period the way the row stores it: year, and month only when the CV gave one.
 * "2019" and "2019-03" are different claims and the copy prints them apart.
 */
function periodText(row: Row): string {
  const start = [value(row, "start_year"), value(row, "start_month")].filter(Boolean).join("-");
  const end = [value(row, "end_year"), value(row, "end_month")].filter(Boolean).join("-");
  if (row.ongoing === true) return `${start || "date not given"} to present`;
  if (end) return `${start || "date not given"} to ${end}`;
  return start || "no dates given";
}

function employmentLine(row: Row): string {
  const employer = printable(row, "employer", NAME_CEILING);
  const title = printable(row, "title", NAME_CEILING);
  return [
    `${title ? `${employer} — ${title}` : employer} (${periodText(row)})`,
    value(row, "location") ? `Place: ${printable(row, "location", NAME_CEILING)}.` : "",
    value(row, "employment_type") ? `Type: ${value(row, "employment_type")}.` : "",
    value(row, "duties") ? `Duties: ${printable(row, "duties", PERSON_LIMITS.text_long)}.` : "",
    value(row, "as_written")
      ? `As written: ${printable(row, "as_written", PERSON_LIMITS.text_as_written)}.`
      : "",
    `Recorded from: ${value(row, "source") || "not recorded"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function educationLine(row: Row): string {
  const what = [
    value(row, "level") || "study",
    printable(row, "degree", NAME_CEILING),
    printable(row, "field", NAME_CEILING),
  ]
    .filter(Boolean)
    .join(" ");
  const years = [
    value(row, "start_year"),
    value(row, "end_year"),
    value(row, "graduation_year"),
  ]
    .filter(Boolean)
    .join("/");
  return [
    `${what} at ${printable(row, "institution", NAME_CEILING) || "an unnamed institution"}${years ? ` (${years})` : ""}`,
    value(row, "major") ? `Major: ${printable(row, "major", NAME_CEILING)}.` : "",
    value(row, "minor") ? `Minor: ${printable(row, "minor", NAME_CEILING)}.` : "",
    value(row, "gpa") ? `Grade: ${value(row, "gpa")}.` : "",
    value(row, "honors") ? `Honors: ${printable(row, "honors", PERSON_LIMITS.text_as_written)}.` : "",
    value(row, "as_written")
      ? `As written: ${printable(row, "as_written", PERSON_LIMITS.text_as_written)}.`
      : "",
    `Recorded from: ${value(row, "source") || "not recorded"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function languageLine(row: Row): string {
  return `${value(row, "language") || "a language"} — ${value(row, "proficiency") || "level not stated"}`;
}

function skillLine(row: Row): string {
  return [
    `${printable(row, "skill", NAME_CEILING) || "a skill"}${
      value(row, "proficiency") ? ` (level ${value(row, "proficiency")} of 5)` : " (no level stated)"
    }`,
    value(row, "as_written")
      ? `As written: ${printable(row, "as_written", PERSON_LIMITS.text_as_written)}.`
      : "",
    `Recorded from: ${value(row, "source") || "not recorded"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function certificationLine(row: Row): string {
  return [
    `${printable(row, "title", NAME_CEILING) || "a certification"}${
      value(row, "issuer") ? ` — ${printable(row, "issuer", NAME_CEILING)}` : ""
    }${value(row, "year") ? ` (${value(row, "year")})` : ""}`,
    value(row, "as_written")
      ? `As written: ${printable(row, "as_written", PERSON_LIMITS.text_as_written)}.`
      : "",
    `Recorded from: ${value(row, "source") || "not recorded"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The five Tier-1 claim collections, in the order the letter prints them.
 *
 * Each is read one row past its ceiling so the copy can say it stopped rather
 * than handing back a bounded list that looks complete (spec §11: the per-table
 * caps are the bound, not a second higher one).
 */
const COLLECTIONS: readonly {
  table: string;
  label: string;
  cap: number;
  order: { column: string; ascending: boolean };
  line: (row: Row) => string;
}[] = [
  {
    table: "person_employment",
    label: "Work history",
    cap: PERSON_LIMITS.employment_rows,
    order: { column: "start_year", ascending: false },
    line: employmentLine,
  },
  {
    table: "person_education",
    label: "Education",
    cap: PERSON_LIMITS.education_rows,
    order: { column: "graduation_year", ascending: false },
    line: educationLine,
  },
  {
    table: "person_languages",
    label: "Languages",
    cap: PERSON_LIMITS.languages_rows,
    order: { column: "language", ascending: true },
    line: languageLine,
  },
  {
    table: "person_skills",
    label: "Skills",
    cap: PERSON_LIMITS.skills_rows,
    order: { column: "skill", ascending: true },
    line: skillLine,
  },
  {
    table: "person_certifications",
    label: "Certifications",
    cap: PERSON_LIMITS.certifications_rows,
    order: { column: "year", ascending: false },
    line: certificationLine,
  },
];

async function spineRows(
  service: ServiceClient,
  table: string,
  personId: string,
  options: { order?: { column: string; ascending: boolean }; limit?: number } = {}
): Promise<Row[]> {
  let query = service.from(table).select("*").eq("person_id", personId);
  if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending });
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (isMissingSchemaError(error)) throw new SpineMissing(table);
  if (error) throw new Error(`${table}: ${error.message ?? "no reason given"}`);
  return (data ?? []) as Row[];
}

/**
 * How many rows one special-category table holds, or null when the number did not
 * arrive. An unread count is never printed as zero — "nothing held" is a fact
 * about somebody's medical file and this engine does not guess it.
 */
async function specialCount(
  service: ServiceClient,
  table: string,
  personId: string
): Promise<number | null> {
  const { count, error } = await service
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId);

  if (isMissingSchemaError(error)) throw new SpineMissing(table);
  if (error || count === null) return null;
  return count;
}

/**
 * The two routes to the person behind an address, unioned.
 *
 * `person_emails` is the identity table and the primary route. The second is
 * `applications.person_id`, read on its own because it is a 043 column: naming it
 * beside the older columns would refuse the whole select on a database that has
 * not been migrated, which is the same reason erasure.ts reads it alone.
 */
async function resolvePersonIds(service: ServiceClient, email: string): Promise<string[]> {
  const ids = new Set<string>();

  const { data: matched, error } = await service
    .from("person_emails")
    .select("person_id")
    .eq("email", personKey(email));

  if (isMissingSchemaError(error)) throw new SpineMissing("person_emails");
  if (error) throw new Error(`person_emails: ${error.message ?? "no reason given"}`);
  for (const row of (matched ?? []) as Row[]) {
    const id = value(row, "person_id");
    if (id) ids.add(id);
  }

  const { data: links, error: linkError } = await service
    .from("applications")
    .select("person_id")
    .in("email", emailSpellings(email))
    .not("person_id", "is", "null");

  if (!linkError) {
    for (const row of (links ?? []) as Row[]) {
      const id = value(row, "person_id");
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

/**
 * The photo as a link, never as a byte inside the mail.
 *
 * `mintFileLink` can refuse over a secret nobody configured, and a missing
 * `UPLOADS_ROOT` object answers with an error rather than a url; either way the
 * copy still says a photo is held, because the row is the fact and the link is
 * only the way to open it today.
 */
async function photoBlock(row: Row, disclosures: string[]): Promise<string[]> {
  const path = value(row, "photo_path");
  if (!path) return ["Photo: none on file."];

  const mime = value(row, "photo_mime") || "type not recorded";
  try {
    const store = await getFileStore();
    const signed = await store.signedUrl({
      bucket: PHOTO_BUCKET,
      path,
      seconds: MAX_LINK_SECONDS,
      download: path.split("/").pop() || "photo",
    });
    if (!signed.url) {
      disclosures.push(
        `A photo is held for this profile but its link could not be made (${signed.error ?? "no reason given"}). Ask for the file through the privacy page.`
      );
      return [`Photo: held (${mime}), link unavailable.`];
    }
    const origin = await publicBaseUrl();
    return [
      `Photo: held (${mime}). Open it here: ${origin}${signed.url}`,
      `That link needs no login and stops working after ${Math.round(MAX_LINK_SECONDS / 60)} minutes; ask for a new one through the privacy page after that.`,
    ];
  } catch (cause) {
    disclosures.push(
      `A photo is held for this profile but no link could be signed for it (${cause instanceof Error ? cause.message : String(cause)}).`
    );
    return [`Photo: held (${mime}), link unavailable.`];
  }
}

function eventLine(row: Row): string {
  const group = value(row, "field_group") || "unknown";
  const key = value(row, "field_key") || "unknown";
  const from = printable(row, "old_value", PERSON_LIMITS.events_value_column) || "nothing";
  const to = printable(row, "new_value", PERSON_LIMITS.events_value_column) || "nothing";
  return `- ${iso(row.recorded_at)} — ${group}.${key}: ${from} → ${to} (through ${
    value(row, "door") || "an unknown door"
  }, by ${value(row, "actor_kind") || "an unknown actor"})`;
}

/**
 * Everything one profile holds, as letter lines.
 *
 * @param disclosures the running list of "this copy is not the whole file" notes;
 *        every bound that bit while building this block appends its own sentence.
 */
async function profileBlock(
  service: ServiceClient,
  personId: string,
  heading: string,
  disclosures: string[]
): Promise<string[]> {
  const lines: string[] = [heading];

  const { data: profile, error } = await service
    .from("person_profiles")
    .select(profileSelect())
    .eq("id", personId)
    .maybeSingle();
  if (isMissingSchemaError(error)) throw new SpineMissing("person_profiles");
  if (error) throw new Error(`person_profiles: ${error.message ?? "no reason given"}`);

  if (!profile) {
    lines.push("  An address points at this profile reference, but the profile row is gone.");
    return lines;
  }

  const row = profile as Row;
  const name = value(row, "legal_name") || "a name we did not record";
  lines.push(`  ${name} (profile reference ${personId})`);

  if (value(row, "erased_at")) {
    lines.push(`  This profile is marked erased, on ${iso(row.erased_at)}.`);
  }

  for (const field of PROFILE_SCALARS) {
    // The name is the heading of this block, not a second line under it.
    if (field.key === "legal_name") continue;
    const column = field.column as string;
    const raw = field.input === "date" ? day(row[column]) : value(row, column);
    if (!raw) continue;
    lines.push(`  ${field.label}: ${cut(raw, PERSON_LIMITS.text_long)}`);
  }

  lines.push(...(await photoBlock(row, disclosures)));

  const emails = await spineRows(service, "person_emails", personId, {
    order: { column: "added_at", ascending: true },
  });
  lines.push(
    `  Addresses on this profile: ${
      emails.length
        ? emails
            .map((email) => `${value(email, "email")}${email.is_primary === true ? " (primary)" : ""}`)
            .join(", ")
        : "the address you asked with, and no others"
    }.`
  );

  for (const spec of COLLECTIONS) {
    const rows = await spineRows(service, spec.table, personId, {
      order: spec.order,
      limit: spec.cap + 1,
    });
    const shown = rows.slice(0, spec.cap);
    if (rows.length > spec.cap) {
      disclosures.push(
        `${spec.label}: the copy stops at ${spec.cap} entries and ${rows.length - spec.cap} more are on file; ask and they will be sent.`
      );
    }
    lines.push(
      `  ${spec.label} (${shown.length}${rows.length > spec.cap ? "+" : ""} ${
        shown.length === 1 ? "entry" : "entries"
      }):`
    );
    lines.push(
      ...(shown.length ? shown.map((entry) => `    - ${spec.line(entry)}`) : ["    none on file"])
    );
  }

  const consents = await spineRows(service, "person_consents", personId, {
    order: { column: "recorded_at", ascending: true },
  });
  lines.push(`  Consents given at profile level (${consents.length}):`);
  lines.push(
    ...(consents.length
      ? consents.map(
          (entry) =>
            `    - ${iso(entry.recorded_at)} — ${value(entry, "purpose")}: ${
              entry.granted === true ? "granted" : "declined"
            } (notice ${value(entry, "notice_version") || "?"}, through ${
              value(entry, "door") || "an unknown door"
            })`
        )
      : ["    none recorded"])
  );

  const events = await spineRows(service, "person_events", personId, {
    order: { column: "recorded_at", ascending: false },
    limit: PERSON_LIMITS.events_read_rows,
  });
  const mailed = events.filter((event) => !SPECIAL_CATEGORY_EVENT_GROUPS.has(value(event, "field_group")));
  const withheld = events.length - mailed.length;
  lines.push(`  Changes we logged (${mailed.length} of ${events.length} read):`);
  lines.push(...(mailed.length ? mailed.map((event) => `    ${eventLine(event)}`) : ["    none logged"]));
  if (withheld > 0) {
    disclosures.push(
      `${withheld} logged change${withheld === 1 ? "" : "s"} concern the special categories below and are not quoted here, because a logged value is the value itself.`
    );
  }
  if (events.length >= PERSON_LIMITS.events_read_rows) {
    disclosures.push(
      `The change log stops at the newest ${PERSON_LIMITS.events_read_rows} rows; older changes can be sent on request.`
    );
  }

  const shape = await specialShape(service, personId);
  lines.push(`  Held, counted, not mailed: ${shape}.`);

  return lines;
}

/** Which special categories exist for this person, and how many rows each carries. */
async function specialShape(service: ServiceClient, personId: string): Promise<string> {
  const parts: string[] = [];
  for (const spec of SPECIAL_CATEGORY_TABLES) {
    const count = await specialCount(service, spec.table, personId);
    parts.push(
      `${spec.label}: ${
        count === null ? "count unavailable" : count === 0 ? "nothing held" : `${count} ${count === 1 ? "row" : "rows"}`
      }`
    );
  }
  return parts.join("; ");
}

interface PersonHalf {
  /** The letter lines for the person spine; empty when there is nothing to say. */
  lines: string[];
  /** Every bound that bit, phrased for the requester. */
  disclosures: string[];
}

/**
 * The person half of the copy, or the sentence that says why it is not here.
 *
 * Nothing in this function may throw: a subject-access letter that fails to send
 * because the spine could not be read is worse than a short letter that says which
 * half it left out. Two failures degrade differently on purpose — a database
 * without 043 has no person tables to mention, while a spine that refused a read
 * is a fact the requester has to know about.
 */
async function readPersonHalf(service: ServiceClient, email: string): Promise<PersonHalf> {
  try {
    const ids = await resolvePersonIds(service, email);
    if (ids.length === 0) {
      return {
        lines: [
          "YOUR PROFILE",
          "  No person profile carries this address, so everything below sits on the application rows. Where a profile exists it is the single record of you; these are the openings you applied to.",
        ],
        disclosures: [],
      };
    }

    const disclosures: string[] = [];
    const lines: string[] = ["YOUR PROFILE"];
    for (const [index, personId] of ids.entries()) {
      if (ids.length > 1 && index > 0) lines.push("");
      lines.push(
        ...(await profileBlock(
          service,
          personId,
          ids.length > 1 ? `  Profile ${index + 1} of ${ids.length}:` : "  One profile carries this address:",
          disclosures
        ))
      );
    }
    lines.push("", `  ${THIRD_PARTY_NOTE}`, `  ${SPECIAL_CATEGORY_NOTE}`);

    return { lines, disclosures };
  } catch (cause) {
    if (cause instanceof SpineMissing) return { lines: [SPINE_MISSING_NOTE], disclosures: [] };
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      lines: [`${SPINE_FAILED_NOTE}: ${reason}. The application rows below are unaffected.`],
      disclosures: [],
    };
  }
}

/**
 * Build the letter, or say why it could not be sent.
 *
 * Nothing here writes: the action marks the request executed only after the mail
 * is accepted by the relay, so a failed send leaves the request approved and
 * retryable rather than claiming a copy nobody received.
 */
export async function sendAccessCopy(input: {
  email: string;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await EmailConnector.isConfigured())) {
    return {
      ok: false,
      error:
        "The copy cannot be sent because no mail relay is configured. " +
        "Add one under Settings → API keys; the request stays approved until it is.",
    };
  }

  const service = getServiceRestClient();
  const applications = await readApplications(service, input.email);
  if (applications.error) return { ok: false, error: applications.error };
  if (applications.rows.length === 0) {
    return { ok: false, error: "No application on file carries that address." };
  }

  const blocks: string[] = [];
  const budget = { answers: 0 };
  const formDisclosures: string[] = [];

  const personHalf = await readPersonHalf(service, input.email);
  if (personHalf.lines.length > 0) blocks.push(personHalf.lines.join("\n"));

  blocks.push("YOUR APPLICATIONS");

  for (const row of applications.rows) {
    const consents = await readConsents(service, row.id);
    const attempts = await readAttempts(service, row.id, budget);
    const interviews = await readInterviews(service, row.id);
    const form = await readFormAnswers(service, row.id);

    if (form.capped) {
      formDisclosures.push(
        `The form answers for “${row.jobTitle}” stop at ${MAX_ANSWERS}; the rest can be sent on request.`
      );
    }

    blocks.push(
      [
        `${row.jobTitle}`,
        `  Applied ${row.created_at}; stage ${row.stage || "unknown"}.`,
        `  Name: ${row.full_name || "not recorded"}`,
        `  Email: ${row.email || "not recorded"}`,
        `  Phone: ${row.phone || "not recorded"}`,
        row.ai_score ? `  AI screening score: ${row.ai_score}` : "",
        row.ai_screening_summary ? `  AI screening summary: ${cut(row.ai_screening_summary)}` : "",
        consents.length ? `  Consents:\n${consents.map((line) => `    ${line}`).join("\n")}` : "",
        form.lines.length
          ? `  What you told us in the application form:\n${form.lines
              .map((line) => `    ${line}`)
              .join("\n")}`
          : "",
        form.lines.length
          ? "  Where an answer also became part of your profile it is printed in both places. If they differ, this is what you sent then and the profile is what we hold now."
          : "",
        attempts.lines.length
          ? `  Assessments:\n${attempts.lines.map((line) => `    ${line}`).join("\n")}`
          : "  Assessments: none on file",
        interviews.length
          ? `  Interviews:\n${interviews.map((line) => `    ${line}`).join("\n")}`
          : "  Interviews: none on file",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const header = [
    "This is the information Sharm Dreams Group holds about you, sent because you asked for a copy through the privacy page.",
    `Prepared ${new Date().toISOString()} for ${input.email}.`,
    "",
    "If you did not ask for this, someone used the privacy page with your address. Nothing has changed: this letter only reads what was already held.",
  ].join("\n");

  const footer = [
    "",
    ...personHalf.disclosures,
    ...formDisclosures,
    applications.capped
      ? `Only the first ${MAX_APPLICATIONS} applications are included; older ones can be sent on request.`
      : "",
    budget.answers >= MAX_ANSWERS
      ? `The written answers stop at ${MAX_ANSWERS}; the rest can be sent on request.`
      : "",
    "",
    "To have this erased, open the link we mailed you and choose “Erase my data”.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await EmailConnector.send({
    to: input.email,
    subject: "The information we hold about you",
    text: `${header}\n\n${blocks.join("\n\n")}\n${footer}`,
  });

  if (!result.success) {
    console.error(`[privacy] access copy for request ${input.requestId} failed:`, result.error);
    return {
      ok: false,
      error: result.error ?? "The copy could not be sent; the request stays approved.",
    };
  }

  return { ok: true };
}
