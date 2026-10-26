/**
 * What the reporting surfaces can say about the application form and the
 * person spine — the two stores that arrived after Analytics and Reports were
 * written.
 *
 * The form figures come from the snapshot (`applications.form_answers`), never
 * from the live form: a form can be edited or retired, and an old application
 * still has to be counted against the questions it was actually asked. "Asked"
 * therefore counts every answerable field in every snapshot, and "answered"
 * counts only the fields that carry a value — an empty box is a blank, not an
 * answer.
 *
 * The profile figures are coverage, not content: how many people have a work
 * history, a set of skills, an identity core. Coverage names a group that
 * somebody filled; it never prints the value, so the same rows can be shown to
 * every analytics viewer.
 *
 * Demographic **values** are the exception. Gender, nationality, marital
 * status, children and age are counted only when the caller holds the
 * family-data grant (`canViewDemographics`, decided at the door), and coverage
 * of the tier-3 groups is withheld with them: a row that says "two of three
 * people have dependants recorded" is already a fact about families. Failing
 * closed here matches the score mask — the caller passes false when a read is
 * uncertain, and the section disappears rather than guessing.
 *
 * Pure module — no database, nothing async, no `server-only`.
 */

import {
  computeCareerIndicators,
  type EmploymentRow,
} from "@/modules/candidates/domain/careerIndicators";
import {
  PERSON_FIELDS,
  type PersonFieldGroup,
  type PersonFieldTier,
} from "@/modules/candidates/domain/person-fields";
import type { Snapshot, SnapshotField } from "@/modules/form-builder/domain/snapshot";

/** Only the two halves a report needs — `parseSnapshot` returns exactly these. */
export type FormSnapshot = Pick<Snapshot, "fields" | "forms">;

/** One application as the reader hands it over: its snapshot and its consent row. */
export interface FormProfileApplicationRow {
  id: string;
  snapshot: FormSnapshot | null;
  has_cv: boolean;
  consent: {
    processing: boolean;
    talent_pool: boolean;
    notice_version: string | null;
  };
  /** Display fields for a drill-down list; the builder never reads them. */
  candidate?: string | null;
  opening?: string | null;
  stage?: string | null;
  created_at?: string | null;
}

/** One person as the reader hands them over: the keys filled, and the demographic columns. */
export interface FormProfilePersonRow {
  id: string;
  filled: readonly string[];
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  marital_status: string | null;
  children_count: number | string | null;
  /** Display fields for a row-level list; the builder never reads them. */
  legal_name?: string | null;
  created_at?: string | null;
}

/**
 * One `application_form_files` row, claimed or not.
 *
 * A row whose `application_id` is still null is an upload nobody submitted.
 * It is the only honest abandonment signal the portal stores: there is no
 * form-start table, so "how far did they get" cannot be answered — only
 * "what was uploaded and then never filed". The retention sweep clears these
 * once they are older than `LIMITS.orphan_upload_window_hours`, which is why
 * the window is part of the report rather than a constant here.
 */
export interface FormFileRow {
  application_id: string | null;
  field_key: string | null;
  uploaded_at: string | null;
}

/** One employment row with the person it belongs to. */
export interface FormProfileEmploymentRow extends EmploymentRow {
  person_id: string;
}

export interface FormProfileInput {
  applications: readonly FormProfileApplicationRow[];
  profiles: readonly FormProfilePersonRow[];
  /** Attachment rows per application id. Missing id = none. */
  attachments: Readonly<Record<string, number>>;
  /** Every form-file row the read returned, claimed or unclaimed. */
  files: readonly FormFileRow[];
  employment: readonly FormProfileEmploymentRow[];
  /** Mirrors `LIMITS.orphan_upload_window_hours` — hours until the sweep clears it. */
  orphanWindowHours: number;
  canViewDemographics: boolean;
  generatedAt: string;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface CoverageRow {
  group: PersonFieldGroup;
  label: string;
  filled: number;
  total: number;
  tier: PersonFieldTier;
}

export interface DemographicsReport {
  gender: CountRow[];
  nationality: CountRow[];
  maritalStatus: CountRow[];
  children: CountRow[];
  ageBands: CountRow[];
  /** People who stated at least one demographic fact. */
  stated: number;
}

/**
 * One question as the snapshots actually asked it.
 *
 * Keyed by field key rather than by label, so a question an author renamed is
 * still one line; the label and type are the newest wording seen. Carries no
 * value — this is a shape report, not a list of answers.
 */
export interface FormQuestionRow {
  key: string;
  label: string;
  type: string;
  asked: number;
  answered: number;
  skipped: number;
  answerRate: number | null;
}

/**
 * Unclaimed uploads grouped by the field they were dropped on.
 *
 * `oldestHours` is the age of the oldest row at report time; it is null only
 * when a row has no readable upload date. `pastWindow` is what the retention
 * sweep is going to delete, `insideWindow` is what a person might still submit.
 */
export interface UnclaimedFieldRow {
  fieldKey: string;
  uploads: number;
  insideWindow: number;
  pastWindow: number;
  oldestHours: number | null;
}

/** Whether an application whose form asks for a file actually carried one. */
export interface AttachmentCompletionReport {
  orphanWindowHours: number;
  unclaimed: number;
  unclaimedPastWindow: number;
  unclaimedInsideWindow: number;
  /** Applications whose snapshot asks for at least one file or photo. */
  fileFieldsAsked: number;
  /** Of those, the ones with at least one filed attachment. */
  withAttachment: number;
  completionRate: number | null;
  fields: UnclaimedFieldRow[];
}

/**
 * Experience and stability across the people read — four counts and a band
 * table, never a score and never a verdict.
 *
 * Every figure comes from `computeCareerIndicators`, which counts a year-only
 * period as twelve months and says so in its caveats. The caveats name
 * employers, so they are deliberately not lifted into this aggregate: a
 * report about everyone must not print one person's employer beside a count.
 */
export interface ExperienceReport {
  people: number;
  withHistory: number;
  roles: number;
  medianTotalMonths: number | null;
  bands: CountRow[];
  rowsWithMonths: number;
  rowsWithEnd: number;
}

export interface FormProfileReport {
  applications: {
    total: number;
    withForm: number;
    withoutForm: number;
    adoptionRate: number | null;
    withCv: number;
    attachments: number;
    withAttachments: number;
    processingConsent: number;
    talentPoolConsent: number;
    noticeVersions: CountRow[];
  };
  forms: {
    asked: number;
    answered: number;
    answerRate: number | null;
    versions: CountRow[];
  };
  /** One row per distinct field key asked across every snapshot. */
  questions: FormQuestionRow[];
  completion: AttachmentCompletionReport;
  profiles: {
    total: number;
    identityComplete: number;
    withName: number;
    withDob: number;
    coverage: CoverageRow[];
  };
  experience: ExperienceReport;
  demographics: DemographicsReport | null;
}

export const NOT_STATED = "Not stated";

const IDENTITY_CORE = ["legal_name", "date_of_birth"] as const;

const GROUP_LABELS: Record<PersonFieldGroup, string> = {
  identity: "Identity",
  contact: "Contact & location",
  work_history: "Work history",
  education: "Education",
  languages: "Languages",
  skills: "Skills & certifications",
  photo: "Photo",
  marital_status: "Marital status & children",
  family_details: "Family details",
  dependants: "Dependants",
  emergency_contacts: "Emergency contacts",
  health: "Health & accessibility",
  housing: "Housing & commute",
  extraction: "CV extraction",
};

/** The group a filled key belongs to, and the strictest tier the group holds. */
const KEY_GROUP = new Map<string, PersonFieldGroup>();
const GROUP_TIER = new Map<PersonFieldGroup, PersonFieldTier>();
const GROUP_ORDER: PersonFieldGroup[] = [];

for (const field of PERSON_FIELDS) {
  KEY_GROUP.set(field.key, field.group);
  if (!GROUP_ORDER.includes(field.group)) GROUP_ORDER.push(field.group);
  const tier = GROUP_TIER.get(field.group) ?? 1;
  if (field.tier > tier) GROUP_TIER.set(field.group, field.tier);
}

/** A share of two counts as a whole percentage, or null when there is nothing to divide by. */
function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function countRows(counts: Map<string, number>): CountRow[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** A tally with the missing counted last: stated answers first, then how many said nothing. */
function statedFirst(counts: Map<string, number>): CountRow[] {
  const missing = counts.get(NOT_STATED) ?? 0;
  counts.delete(NOT_STATED);
  const rows = countRows(counts);
  if (missing > 0) rows.push({ label: NOT_STATED, count: missing });
  return rows;
}

function add(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

/** A blank string, an empty list and a null are all "no answer". */
function answeredValue(field: SnapshotField): boolean {
  const value = field.value;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Asked and answered for one snapshot, by the same rule the aggregates use.
 *
 * A section heading is layout, not a question, so it is not counted as asked.
 * Returns null for a row with no snapshot, so a caller can print an empty cell
 * instead of a zero that reads as "the form asked nothing".
 */
export function formAnswerCounts(
  snapshot: FormSnapshot | null
): { asked: number; answered: number } | null {
  if (!snapshot) return null;
  let asked = 0;
  let answered = 0;
  for (const field of snapshot.fields) {
    if (field.type === "section_heading") continue;
    asked += 1;
    if (answeredValue(field)) answered += 1;
  }
  return { asked, answered };
}

/** The form and version a snapshot was filed under, or null before the form existed. */
export function snapshotLabel(snapshot: FormSnapshot | null): string | null {
  const form = snapshot?.forms?.[0];
  return form ? `${form.name} v${form.version}` : null;
}

/** A legal name and a date of birth together; either alone is not an identity core. */
export function identityComplete(filled: readonly string[]): boolean {
  return IDENTITY_CORE.every((key) => filled.includes(key));
}

/**
 * The groups a row-level profile export may name.
 *
 * Tier-3 groups are withheld unconditionally, because one row saying "this
 * person has a health record" is the fact the grant exists to protect. The
 * marital-status group is withheld for the same reason: its fields are counted
 * in the gated tallies on Analytics, never printed beside a name.
 */
export function exportableGroups(filled: readonly string[]): string[] {
  const groups = new Set<PersonFieldGroup>();
  for (const key of filled) {
    const group = KEY_GROUP.get(key);
    if (group) groups.add(group);
  }
  return GROUP_ORDER.filter(
    (group) =>
      groups.has(group) && (GROUP_TIER.get(group) ?? 1) < 3 && group !== "marital_status"
  ).map((group) => GROUP_LABELS[group]);
}

function demographicLabel(value: number | string | null): string {
  if (value === null || value === undefined) return NOT_STATED;
  const text = String(value).trim();
  return text === "" ? NOT_STATED : text;
}

const AGE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under 20", min: 0, max: 19 },
  { label: "20–29", min: 20, max: 29 },
  { label: "30–39", min: 30, max: 39 },
  { label: "40–49", min: 40, max: 49 },
  { label: "50–59", min: 50, max: 59 },
  { label: "60 and above", min: 60, max: 200 },
];

/** Whole years between a birth date and the report's own instant. */
function ageOn(birth: string | null, at: string): number | null {
  if (!birth) return null;
  const born = Date.parse(birth);
  const now = Date.parse(at);
  if (Number.isNaN(born) || Number.isNaN(now) || born > now) return null;
  const from = new Date(born);
  const to = new Date(now);
  let age = to.getUTCFullYear() - from.getUTCFullYear();
  const month = to.getUTCMonth() - from.getUTCMonth();
  if (month < 0 || (month === 0 && to.getUTCDate() < from.getUTCDate())) age -= 1;
  return age;
}

function demographicsFor(
  profiles: readonly FormProfilePersonRow[],
  generatedAt: string,
  canViewDemographics: boolean
): DemographicsReport | null {
  if (!canViewDemographics) return null;

  const gender = new Map<string, number>();
  const nationality = new Map<string, number>();
  const maritalStatus = new Map<string, number>();
  const children = new Map<string, number>();
  const ages = new Map<string, number>();
  let stated = 0;

  for (const profile of profiles) {
    add(gender, demographicLabel(profile.gender));
    add(nationality, demographicLabel(profile.nationality));
    add(maritalStatus, demographicLabel(profile.marital_status));
    add(children, demographicLabel(profile.children_count));

    const age = ageOn(profile.date_of_birth, generatedAt);
    const band = age === null ? null : AGE_BANDS.find((entry) => age >= entry.min && age <= entry.max);
    add(ages, band?.label ?? NOT_STATED);

    if (
      profile.gender !== null ||
      profile.nationality !== null ||
      profile.marital_status !== null ||
      profile.children_count !== null ||
      profile.date_of_birth !== null
    ) {
      stated += 1;
    }
  }

  return {
    gender: statedFirst(gender),
    nationality: statedFirst(nationality),
    maritalStatus: statedFirst(maritalStatus),
    children: statedFirst(children),
    ageBands: statedFirst(ages),
    stated,
  };
}

function coverageFor(
  profiles: readonly FormProfilePersonRow[],
  canViewDemographics: boolean
): CoverageRow[] {
  const filled = new Map<PersonFieldGroup, number>();
  for (const profile of profiles) {
    const groups = new Set<PersonFieldGroup>();
    for (const key of profile.filled) {
      const group = KEY_GROUP.get(key);
      if (group) groups.add(group);
    }
    for (const group of groups) filled.set(group, (filled.get(group) ?? 0) + 1);
  }

  const rows: CoverageRow[] = [];
  for (const group of GROUP_ORDER) {
    const count = filled.get(group) ?? 0;
    if (count === 0) continue;
    const tier = GROUP_TIER.get(group) ?? 1;
    if (tier === 3 && !canViewDemographics) continue;
    rows.push({ group, label: GROUP_LABELS[group], filled: count, total: profiles.length, tier });
  }
  return rows;
}

const HOUR = 3_600_000;

/**
 * Field types that ask for an upload. Kept here rather than imported from the
 * form-builder's registry because this is a reporting predicate: a question
 * counts as a file question only if the snapshot said so.
 */
const FILE_FIELD_TYPES = new Set(["file", "photo"]);

/** Five bands, no verdict. The top band is open-ended on purpose. */
const EXPERIENCE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under 1 year", min: 0, max: 11.999 },
  { label: "1–2 years", min: 12, max: 23.999 },
  { label: "2–5 years", min: 24, max: 59.999 },
  { label: "5–10 years", min: 60, max: 119.999 },
  { label: "10 years and over", min: 120, max: Number.POSITIVE_INFINITY },
];

/** The middle value, or the mean of the two middles, rounded like the indicators. */
function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Every answerable field the snapshots asked, keyed by field key.
 *
 * A question is "asked" once per snapshot it appears in, so a form edited
 * between two applications can show a lower answer rate without pretending
 * the older applications were asked the newer question. The label and type
 * are the most recent wording seen — the key is the stable identity.
 */
function questionsFor(
  applications: readonly FormProfileApplicationRow[]
): FormQuestionRow[] {
  const rows = new Map<string, FormQuestionRow>();
  for (const application of applications) {
    const snapshot = application.snapshot;
    if (!snapshot) continue;
    for (const field of snapshot.fields) {
      if (field.type === "section_heading") continue;
      const label = field.label?.trim() || field.key;
      const row =
        rows.get(field.key) ??
        {
          key: field.key,
          label,
          type: field.type,
          asked: 0,
          answered: 0,
          skipped: 0,
          answerRate: null,
        };
      rows.set(field.key, row);
      row.label = label;
      row.type = field.type;
      row.asked += 1;
      if (answeredValue(field)) row.answered += 1;
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      skipped: row.asked - row.answered,
      answerRate: share(row.answered, row.asked),
    }))
    .sort((a, b) => b.asked - a.asked || a.label.localeCompare(b.label));
}

/**
 * Uploads nobody filed, split by the retention sweep's own window.
 *
 * The window is strict: a row exactly `orphanWindowHours` old is still inside
 * it, because the sweep deletes rows older than the cutoff. Rows with no
 * readable date are counted as unclaimed but in neither bucket — they cannot
 * be aged, and inventing either answer would be worse than saying nothing.
 */
function completionFor(input: FormProfileInput): AttachmentCompletionReport {
  const orphanWindowHours = input.orphanWindowHours;
  const reportedAt = Date.parse(input.generatedAt);

  const byField = new Map<
    string,
    { fieldKey: string; uploads: number; insideWindow: number; pastWindow: number; oldest: number | null }
  >();

  let unclaimed = 0;
  for (const file of input.files) {
    if (file.application_id !== null) continue;
    unclaimed += 1;

    const fieldKey = file.field_key?.trim() || "unknown";
    const row =
      byField.get(fieldKey) ??
      { fieldKey, uploads: 0, insideWindow: 0, pastWindow: 0, oldest: null };
    byField.set(fieldKey, row);
    row.uploads += 1;

    const uploaded = file.uploaded_at === null ? Number.NaN : Date.parse(file.uploaded_at);
    const age = Number.isNaN(uploaded) || Number.isNaN(reportedAt) ? null : (reportedAt - uploaded) / HOUR;
    const past = age !== null && age > orphanWindowHours;
    if (age !== null) {
      if (past) row.pastWindow += 1;
      else row.insideWindow += 1;
      row.oldest = row.oldest === null ? age : Math.max(row.oldest, age);
    }
  }

  const fields: UnclaimedFieldRow[] = [...byField.values()]
    .map((row) => ({
      fieldKey: row.fieldKey,
      uploads: row.uploads,
      insideWindow: row.insideWindow,
      pastWindow: row.pastWindow,
      oldestHours: row.oldest === null ? null : Math.round(row.oldest),
    }))
    .sort((a, b) => b.uploads - a.uploads || a.fieldKey.localeCompare(b.fieldKey));

  let fileFieldsAsked = 0;
  let withAttachment = 0;
  for (const application of input.applications) {
    const asksForFile = application.snapshot?.fields.some((field) => FILE_FIELD_TYPES.has(field.type));
    if (!asksForFile) continue;
    fileFieldsAsked += 1;
    if ((input.attachments[application.id] ?? 0) > 0) withAttachment += 1;
  }

  return {
    orphanWindowHours,
    unclaimed,
    unclaimedPastWindow: fields.reduce((sum, row) => sum + row.pastWindow, 0),
    unclaimedInsideWindow: fields.reduce((sum, row) => sum + row.insideWindow, 0),
    fileFieldsAsked,
    withAttachment,
    completionRate: share(withAttachment, fileFieldsAsked),
    fields,
  };
}

/**
 * Experience and stability for the people read, counted by the same
 * month-aware module the candidate profile shows.
 *
 * Only rows belonging to a read profile are counted, so `people` is always the
 * denominator the other figures were drawn from. A person with no dated role
 * contributes to `people` and not to `withHistory`; their absence is a fact,
 * not a zero-year career.
 */
function experienceFor(
  profiles: readonly FormProfilePersonRow[],
  employment: readonly FormProfileEmploymentRow[],
  generatedAt: string
): ExperienceReport {
  const byPerson = new Map<string, EmploymentRow[]>();
  for (const row of employment) {
    const rows = byPerson.get(row.person_id);
    if (rows) rows.push(row);
    else byPerson.set(row.person_id, [row]);
  }

  const parsed = Date.parse(generatedAt);
  const now = new Date(Number.isNaN(parsed) ? 0 : parsed);

  const totals: number[] = [];
  let withHistory = 0;
  let roles = 0;
  let rowsWithMonths = 0;
  let rowsWithEnd = 0;

  for (const profile of profiles) {
    const rows = byPerson.get(profile.id);
    if (!rows || rows.length === 0) continue;
    withHistory += 1;
    roles += rows.length;
    rowsWithMonths += rows.filter((row) => row.startMonth !== null).length;
    rowsWithEnd += rows.filter((row) => row.ongoing || row.endYear !== null).length;
    totals.push(computeCareerIndicators(rows, now).totalMonths);
  }

  return {
    people: profiles.length,
    withHistory,
    roles,
    medianTotalMonths: medianOf(totals),
    bands: EXPERIENCE_BANDS.map((band) => ({
      label: band.label,
      count: totals.filter((total) => total >= band.min && total <= band.max).length,
    })),
    rowsWithMonths,
    rowsWithEnd,
  };
}

export function buildFormProfileReport(input: FormProfileInput): FormProfileReport {
  const total = input.applications.length;
  const withForm = input.applications.filter((application) => application.snapshot !== null).length;
  const withCv = input.applications.filter((application) => application.has_cv).length;

  const attachmentCounts = Object.values(input.attachments);
  const attachments = attachmentCounts.reduce((sum, rows) => sum + Math.max(0, rows), 0);
  const withAttachments = attachmentCounts.filter((rows) => rows > 0).length;

  const noticeVersions = new Map<string, number>();
  let processingConsent = 0;
  let talentPoolConsent = 0;
  for (const application of input.applications) {
    if (application.consent.processing) processingConsent += 1;
    if (application.consent.talent_pool) talentPoolConsent += 1;
    const version = application.consent.notice_version?.trim();
    if (version) add(noticeVersions, version);
  }

  let asked = 0;
  let answered = 0;
  const versions = new Map<string, number>();
  for (const application of input.applications) {
    const snapshot = application.snapshot;
    if (!snapshot) continue;
    for (const form of snapshot.forms) add(versions, `${form.name} v${form.version}`);
    const counts = formAnswerCounts(snapshot);
    if (counts) {
      asked += counts.asked;
      answered += counts.answered;
    }
  }

  const profiles = input.profiles;
  const withName = profiles.filter((profile) => profile.filled.includes("legal_name")).length;
  const withDob = profiles.filter((profile) => profile.filled.includes("date_of_birth")).length;
  const identityCompleteCount = profiles.filter((profile) => identityComplete(profile.filled)).length;

  return {
    applications: {
      total,
      withForm,
      withoutForm: total - withForm,
      adoptionRate: share(withForm, total),
      withCv,
      attachments,
      withAttachments,
      processingConsent,
      talentPoolConsent,
      noticeVersions: countRows(noticeVersions),
    },
    forms: {
      asked,
      answered,
      answerRate: share(answered, asked),
      versions: countRows(versions),
    },
    questions: questionsFor(input.applications),
    completion: completionFor(input),
    profiles: {
      total: profiles.length,
      identityComplete: identityCompleteCount,
      withName,
      withDob,
      coverage: coverageFor(profiles, input.canViewDemographics),
    },
    experience: experienceFor(profiles, input.employment, input.generatedAt),
    demographics: demographicsFor(profiles, input.generatedAt, input.canViewDemographics),
  };
}
