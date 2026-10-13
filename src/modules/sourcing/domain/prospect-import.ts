/**
 * Prospect import parsing.
 *
 * Deliberately pure — no database, no "server-only" — so the same function can
 * preview a paste before anything is written, and so a bad row is reported with
 * its line number instead of failing a whole batch.
 *
 * What a recruiter pastes is never one format: a LinkedIn URL per line from a
 * manual search, a Recruiter export with a header row, or a hand-kept list.
 * Each line is classified on its own, so a mixed paste still loads.
 */

type DraftField =
  | "full_name"
  | "headline"
  | "company"
  | "location"
  | "email"
  | "phone"
  | "linkedin_url";

export interface ProspectDraft {
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  /** 1-based line number in the pasted text, for the problem report. */
  line: number;
  /** True when the name came from the profile URL rather than from the text. */
  name_derived: boolean;
}

export interface ProspectImportProblem {
  line: number;
  reason: string;
}

export interface ProspectImportResult {
  drafts: ProspectDraft[];
  problems: ProspectImportProblem[];
  /** Drafts dropped because the same person appeared twice in one paste. */
  duplicates: number;
}

/** Column names an export might use, lower-cased and stripped of punctuation. */
const COLUMN_ALIASES: Record<string, DraftField> = {
  fullname: "full_name",
  name: "full_name",
  candidate: "full_name",
  firstname: "full_name",
  headline: "headline",
  title: "headline",
  jobtitle: "headline",
  position: "headline",
  company: "company",
  currentcompany: "company",
  employer: "company",
  organization: "company",
  location: "location",
  city: "location",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenum: "phone",
  mobile: "phone",
  contact: "phone",
  linkedin: "linkedin_url",
  linkedinurl: "linkedin_url",
  profile: "linkedin_url",
  profileurl: "linkedin_url",
  url: "linkedin_url",
};

/** Order assumed for a delimited line with no header row to read it from. */
const HEADERLESS_ORDER: DraftField[] = [
  "full_name",
  "headline",
  "company",
  "location",
  "email",
  "phone",
  "linkedin_url",
];

const PROFILE_URL_PATTERN =
  /https?:\/\/\S*linkedin\.com\/in\/\S+|(?:[\w.-]+\.)?linkedin\.com\/in\/[^\s,;]+/gi;

/**
 * Canonicalises a LinkedIn profile URL: https, no `www.`, no `?trk=` tracking
 * noise, no trailing slash. Null for anything that is not a profile link, so a
 * company page or a job URL never enters the pool.
 */
export function normalizeLinkedInUrl(raw: string): string | null {
  const value = raw.trim().replace(/^["']+|["']+$/g, "");
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/in\/[^/]+$/i.test(path)) return null;

  const host = url.hostname.replace(/^www\./i, "");
  return `https://${host}${path.toLowerCase()}`;
}

/**
 * Reads a display name out of a profile slug.
 *
 * LinkedIn appends an id fragment to most slugs (`ahmed-fouad-9a2b3c4d`), so a
 * token only counts as a name part when it is not one. A single token is
 * refused: one word is not a name worth filing someone under.
 */
export function nameFromLinkedInUrl(url: string): string | null {
  const slug = url.split("/in/")[1]?.split("/")[0];
  if (!slug) return null;

  const words = slug
    .split(/[-_.]+/)
    .filter((token) => token.length > 1 && !/[0-9]/.test(token))
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase());

  return words.length >= 2 ? words.join(" ") : null;
}

/** Splits one delimited line, honouring double quotes and escaped quotes. */
function splitDelimited(line: string): string[] {
  const delimiter = line.includes("\t")
    ? "\t"
    : line.includes(";") && !line.includes(",")
      ? ";"
      : ",";

  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') {
        current += char;
      } else if (line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Maps a line's cells to known columns, or null when it is not a header.
 *
 * Two recognised names are required so a data row that happens to start with
 * the word "email" is not swallowed as a header.
 */
function headerColumns(cells: string[]): (DraftField | null)[] | null {
  const mapped = cells.map((cell) => COLUMN_ALIASES[cell.toLowerCase().replace(/[^a-z]/g, "")] ?? null);
  return mapped.filter(Boolean).length >= 2 ? mapped : null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
}

/** Keeps the international shape and drops the punctuation a list accumulates. */
function cleanPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const plus = trimmed.replace(/[^\d]/g, "").length >= 8 && trimmed.startsWith("+");
  const number = trimmed.replace(/\D/g, "");
  return number.length >= 8 ? `${plus ? "+" : ""}${number}` : null;
}

function clip(value: string, max = 160): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function assign(draft: ProspectDraft, field: DraftField, cell: string): void {
  const value = cell.trim();
  if (!value) return;

  if (field === "email") draft.email ??= cleanEmail(value);
  else if (field === "phone") draft.phone ??= cleanPhone(value);
  else if (field === "linkedin_url") draft.linkedin_url ??= normalizeLinkedInUrl(value);
  else if (field === "full_name") draft.full_name ||= clip(value) ?? "";
  else draft[field] ??= clip(value);
}

const PHONE_SHAPE = /^[+(]?[\d][\d\s().-]{6,}$/;

/**
 * Moves a value that landed in the wrong column when the list had no header.
 *
 * A "Name, Email, City" paste is read positionally as name/headline/company,
 * which files the address as a job title. Shape beats position: an email is an
 * email wherever it turns up.
 */
function repairMisplaced(draft: ProspectDraft): void {
  for (const field of ["headline", "company", "location"] as const) {
    const value = draft[field];
    if (!value) continue;

    const email = cleanEmail(value);
    const phone = PHONE_SHAPE.test(value) ? cleanPhone(value) : null;
    const url = /linkedin\.com\/in\//i.test(value) ? normalizeLinkedInUrl(value) : null;
    if (!email && !phone && !url) continue;

    draft[field] = null;
    if (email) draft.email ??= email;
    else if (phone) draft.phone ??= phone;
    else if (url) draft.linkedin_url ??= url;
  }
}

/**
 * Parses pasted import text into drafts, one problem per rejected line.
 *
 * A line holding only a LinkedIn URL is a valid prospect: sourcing lists are
 * often just profile links, and the name is recoverable from the slug.
 */
export function parseProspectImport(raw: string): ProspectImportResult {
  const result: ProspectImportResult = { drafts: [], problems: [], duplicates: 0 };
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  // Decided once, by the first delimited line that is not a profile link:
  // either it names its columns, or the columns are positional.
  let header: (DraftField | null)[] | null = null;
  let headerResolved = false;

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    const matches = line.match(PROFILE_URL_PATTERN) ?? [];
    const firstMatch = matches[0];
    const linkedinUrl = firstMatch ? normalizeLinkedInUrl(firstMatch) : null;
    const cells = splitDelimited(line);
    const dataCells = cells.filter((cell) => !/linkedin\.com\/in\//i.test(cell));
    const delimited = dataCells.length > 1 || /\t/.test(line);

    if (!headerResolved && delimited && !linkedinUrl) {
      headerResolved = true;
      const candidate = headerColumns(cells);
      if (candidate) {
        header = candidate;
        continue; // the header row names the columns; it is never a prospect
      }
    }

    const draft: ProspectDraft = {
      full_name: "",
      headline: null,
      company: null,
      location: null,
      email: null,
      phone: null,
      linkedin_url: linkedinUrl,
      line: lineNo,
      name_derived: false,
    };

    if (delimited) {
      dataCells.forEach((cell, position) => {
        const field = header?.[position] ?? HEADERLESS_ORDER[position];
        if (field) assign(draft, field, cell);
      });
    } else {
      draft.full_name = clip(dataCells.join(" ").replace(/,/g, " ")) ?? "";
    }

    repairMisplaced(draft);

    if (!draft.full_name && linkedinUrl) {
      const derived = nameFromLinkedInUrl(linkedinUrl);
      if (derived) {
        draft.full_name = derived;
        draft.name_derived = true;
      }
    }

    if (!draft.full_name) {
      result.problems.push({
        line: lineNo,
        reason: "No name to file this under, and the profile URL does not carry one.",
      });
      continue;
    }
    if (!draft.email && !draft.phone && !draft.linkedin_url) {
      result.problems.push({
        line: lineNo,
        reason: "No email, phone or LinkedIn URL — there is no way to reach this person.",
      });
      continue;
    }

    const key = draft.linkedin_url ?? draft.email ?? draft.full_name.toLowerCase();
    if (seen.has(key)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(key);
    result.drafts.push(draft);
  }

  return result;
}
