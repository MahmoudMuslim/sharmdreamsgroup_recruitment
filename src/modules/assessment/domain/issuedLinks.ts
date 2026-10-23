/**
 * Every link a candidate has been sent, described in one place.
 *
 * The suites grid counts these (`Assigned links`), the candidate dossier lists
 * one person's, and until now nothing in the portal listed them together — so a
 * recruiter could not answer "who holds a link right now, and what did they put
 * in it?" without walking the pipeline one name at a time.
 *
 * Like the suites search, this is pure by design: the server read builds these
 * rows, the board filters and prints them, and a chat answer can be given the
 * same words for the same columns. A rail list kept beside the table is how a
 * chip starts counting rows the board below it does not hold.
 */

import { describeFields, searchByFields, wordsClause, type SearchField } from "@/lib/textSearch";

/**
 * How many links one render carries.
 *
 * A link is one row per candidate per suite, so this table grows with the
 * pipeline rather than with the library. The board says which slice it holds —
 * see `linksReadNote`.
 */
export const LINKS_LIMIT = 300;

/** A row of the issued-links board. */
export interface IssuedLink {
  id: string;
  application_id: string;
  /**
   * The person, or — under blind marking, while the paper's marks can still
   * change — its tracking code. See `identity_blind`.
   */
  candidate_name: string;
  /**
   * `candidate_name` above is a handle, not a name, because `security.blind_marking`
   * is on and this paper is still open for marking. The board says so on the row
   * instead of leaving a name-shaped gap.
   */
  identity_blind: boolean;
  job_id: string | null;
  job_title: string | null;
  template_id: string;
  template_name: string;
  /** `attempt_status`: NOT_STARTED · IN_PROGRESS · SUBMITTED · GRADED · EXPIRED */
  status: string;
  time_limit_minutes: number;
  issued_at: string;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  /** Null when `security.mask_scores_for_reviewers` withholds this reviewer's marks. */
  score: number | null;
  max_score: number | null;
  /** Answers on file, counted from the response rows rather than the status. */
  answers: number;
  /** Questions the suite holds — the denominator `answers` is measured against. */
  questions: number;
  integrity_flags: number;
}

/** The rails, in the order the board prints them. */
export const LINK_RAILS = [
  { key: "ALL", label: "All links", statuses: [] as string[] },
  { key: "NOT_STARTED", label: "Not started", statuses: ["NOT_STARTED"] },
  { key: "IN_PROGRESS", label: "Sitting now", statuses: ["IN_PROGRESS"] },
  { key: "SUBMITTED", label: "Answered", statuses: ["SUBMITTED"] },
  { key: "GRADED", label: "Graded", statuses: ["GRADED"] },
  { key: "EXPIRED", label: "Closed", statuses: ["EXPIRED"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly string[] }[];

export type LinkRail = (typeof LINK_RAILS)[number]["key"];

type PagesWithoutARail = Exclude<
  (typeof LINK_STATUSES)[number],
  (typeof LINK_RAILS)[number]["statuses"][number] | "ALL"
>;

/**
 * Compile-time coverage of the status enum.
 *
 * A new `attempt_status` value the rails do not count would make the rail row
 * for it impossible to reach, so the union below stops being `never` and the
 * build fails on the assignment rather than in the browser.
 */
export const EVERY_STATUS_HAS_A_RAIL: [PagesWithoutARail] extends [never] ? true : never = true;

/** The values the enum holds, kept here so the check above has something to check. */
export const LINK_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "GRADED",
  "EXPIRED",
] as const;

/** The word the board uses for one status, in the recruiter's voice. */
export function linkStatusWord(status: string): string {
  switch (status) {
    case "NOT_STARTED":
      return "Not started";
    case "IN_PROGRESS":
      return "Sitting now";
    case "SUBMITTED":
      return "Answered";
    case "GRADED":
      return "Graded";
    case "EXPIRED":
      return "Closed";
    default:
      return status;
  }
}

/**
 * Whether this row has work to read.
 *
 * Driven by the answer count rather than the status, because the two disagree in
 * both directions: an attempt revoked after a submission keeps its answers, and a
 * `SUBMITTED` row whose candidate typed nothing into any field has none. The desk
 * opens for whatever is actually on file.
 */
export function linkHasAnswers(link: IssuedLink): boolean {
  return link.answers > 0;
}

/** "3 of 8 answered", or the shorter form when a suite is empty. */
export function linkProgressWord(link: IssuedLink): string {
  if (link.questions === 0) {
    return link.answers === 0
      ? "the suite holds no questions"
      : `${link.answers} answer${link.answers === 1 ? "" : "s"} on file, though this suite now has no questions`;
  }
  return `${link.answers} of ${link.questions} answered`;
}

interface SearchableLink {
  candidate_name: string;
  template_name: string;
  job_title: string | null;
}

/** The columns the links search reads — and the only ones it reads. */
export const LINK_SEARCH_FIELDS: readonly SearchField<SearchableLink>[] = [
  { label: "candidate", read: (link) => link.candidate_name },
  { label: "suite", read: (link) => link.template_name },
  { label: "role", read: (link) => link.job_title },
];

export function linkSearchWords(): string {
  return describeFields(LINK_SEARCH_FIELDS);
}

export function searchLinks<T extends SearchableLink>(rows: readonly T[], query: string): T[] {
  return searchByFields(rows, query, LINK_SEARCH_FIELDS);
}

/**
 * What the board is standing on.
 *
 * A filed-away candidate's links are excluded by the read, so this counts only
 * links the pipeline still holds — and says so, because a recruiter comparing
 * this number with the suite card's `Assigned` figure will otherwise find the two
 * disagree by exactly the candidates who were archived.
 */
export function linksReadNote(total: number, shown: number, search: string | null): string {
  if (total === 0) {
    return "No assessment link has been issued to a candidate the pipeline still holds, so there is nothing to list here.";
  }
  const base =
    shown < total
      ? `This board lists the newest ${shown.toLocaleString()} of the ${total.toLocaleString()} links on file — one render carries ${LINKS_LIMIT.toLocaleString()}, so ${(
          total - shown
        ).toLocaleString()} are counted above but not shown below.`
      : `All ${total.toLocaleString()} links the pipeline holds are listed here.`;
  const scope = `${shown.toLocaleString()} link${shown === 1 ? "" : "s"} this board holds`;
  return search
    ? `${base}${wordsClause(search, scope, shown === total, "a link")}`
    : base;
}
