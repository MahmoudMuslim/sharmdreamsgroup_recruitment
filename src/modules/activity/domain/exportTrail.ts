/**
 * The audit row a download leaves behind.
 *
 * Every file the portal hands out is somebody's data with the permissions of the
 * account that asked for it. The screens can show a button or hide one; only the
 * route can say afterwards what actually went out, so this module turns the
 * document the route is about to send into the trail's own words — and the route
 * sends nothing unless the trail takes the row.
 *
 * Pure, and reading only the document it is handed, for one reason: a row whose
 * figures were retyped by the caller is a row that can be wrong about the file
 * beside it. Everything here is counted off the sheets themselves.
 *
 * Two rules decide what the row may contain.
 *
 *   1. **Free text never rides along.** A filter bag can hold a name typed into a
 *      search box, and a trail row is read by more roles and kept longer than the
 *      screen that box sits on. Only short enum-shaped values are written down;
 *      anything else is dropped and counted as dropped, so the row says it lost a
 *      filter rather than pretending none was set.
 *   2. **A masking state is named, not implied.** Silence about scores would read
 *      as "not masked" to whoever audits the row later, so an open copy says it
 *      was open, a masked copy says which account was shut out, and a file that
 *      holds no scores at all claims nothing about either.
 *   3. **The file outranks the door.** Whether an applicant's address left the
 *      building is read back off the finished sheets, not taken on the route's
 *      word: a row that lets a gate look like it bit while the emails went out
 *      beside it is worse than no row at all.
 */

import type {
  ExportDocument,
  ExportFormat,
} from "@/modules/analytics/domain/exportDocument";
import { documentCarriesContacts } from "../../analytics/domain/sheetAccess.ts";
import { ACTIVITY_LIMITS, type ActivityEntry } from "./trail.ts";

/** The three doors a file leaves through, in the order the Guide lists them. */
export const EXPORT_DOORS = ["reports", "time", "trail"] as const;
export type ExportDoor = (typeof EXPORT_DOORS)[number];

/**
 * The formats the writers know, in the words an auditor reads.
 *
 * `exportDocument.ts` owns the list and its `server-only` import chain, so the
 * keys are repeated here rather than imported into a pure module — and
 * `scripts/prove-export-audit.mjs` fails if the two copies ever disagree.
 */
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel",
  pdf: "PDF",
};

/** `masked` and `open` describe a file that could hold scores; `absent` one that never does. */
export type ExportScoreState = "masked" | "open" | "absent";

/**
 * What a file did with the columns that are a person's own address and number.
 *
 * `included` and `withheld` are the two ways a report of candidate data can leave;
 * `absent` is for the lists that never hold one — the time ledger and the trail's
 * own export. The state written into the row is the one the finished sheets show,
 * so a door cannot claim a refusal it did not apply or a delivery it did not make.
 */
export type ExportContactsState = "included" | "withheld" | "absent";

/** One filter the download was cut by, as the route resolved it. */
export interface ExportCutPart {
  key: string;
  value: string | number | boolean | null;
}

export interface ExportFacts {
  door: ExportDoor;
  format: ExportFormat;
  /** The document, exactly as the route is about to write it out. */
  document: Pick<ExportDocument, "title" | "baseName" | "sheets" | "limitations">;
  scores: ExportScoreState;
  /**
   * What the door believes it did with the contact columns.
   *
   * Required, because silence here would read as "no addresses went out" to
   * whoever audits the row later. It is still only a claim until the finished
   * sheets are consulted — see `contactsLeft`.
   */
  contacts: ExportContactsState;
  cut?: readonly ExportCutPart[];
}

/** A value short enough, and blunt enough, to be a setting rather than a person. */
const CUT_VALUE = /^[A-Za-z0-9_,.;:-]{1,40}$/;

/** The keys that are free text wherever they come from, however the route spells them. */
const CUT_DENIED = /^(q|query|search|term|name|email|phone|contact|company_id)$/i;

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * How many data lines the file carries, summed over every table in it.
 *
 * The count is of *lines*, which is what the auditor can check the file against;
 * a summary sheet and a detail sheet both count, because both left the building.
 */
export function exportFileRows(
  document: Partial<Pick<ExportDocument, "sheets">> | null | undefined
): number {
  const sheets = document?.sheets;
  if (!Array.isArray(sheets)) return 0;
  return sheets.reduce(
    (total, sheet) => total + (Array.isArray(sheet?.rows) ? sheet.rows.length : 0),
    0
  );
}

function sheetCount(document: ExportFacts["document"] | null | undefined): number {
  return Array.isArray(document?.sheets) ? document.sheets.length : 0;
}

function limitCount(document: ExportFacts["document"] | null | undefined): number {
  return Array.isArray(document?.limitations) ? document.limitations.length : 0;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** A filter word the trail may keep, or null when it is the kind that must not be. */
function safePart(part: ExportCutPart): { key: string; value: string } | null {
  if (!/^[a-z][a-z0-9_]{0,23}$/i.test(part.key)) return null;
  if (CUT_DENIED.test(part.key)) return null;
  if (part.value === null || part.value === undefined) return null;
  if (typeof part.value === "boolean") return { key: part.key, value: part.value ? "yes" : "no" };
  const asText = String(part.value);
  return CUT_VALUE.test(asText) ? { key: part.key, value: asText } : null;
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * What the file itself shows about contact details, whatever the door claimed.
 *
 * A route states its gate and the sheets are the evidence. Both directions are
 * corrected: a refusal reported beside a file that plainly carries an Email column
 * must not leave a row that lets a gate look like it bit while the addresses went
 * out beside it, and a boast about contacts on a report that has none would credit
 * the account with a reading it never did.
 */
function contactsLeft(facts: ExportFacts): ExportContactsState {
  if (documentCarriesContacts(facts.document)) return "included";
  return facts.contacts === "included" ? "absent" : facts.contacts;
}

/**
 * One row's account of one download.
 *
 * The writer adds the who and the when — this function deliberately leaves the
 * actor out, because a download is the signed-in person's own click and a row that
 * named an engine for it would credit the machine.
 */
export function exportTrailEntry(facts: ExportFacts): ActivityEntry {
  const rows = exportFileRows(facts.document);
  const sheets = sheetCount(facts.document);
  const limits = limitCount(facts.document);
  const title = clamp(text(facts.document?.title, "an unnamed report"), 120);
  const formatLabel = EXPORT_FORMAT_LABELS[facts.format] ?? facts.format;

  /* A filter that was never set is not a filter that was refused: an unset slot is
   * dropped silently, and only a value that had to be thrown away is counted. */
  const offered = (facts.cut ?? []).filter(
    (part) => part.value !== null && part.value !== undefined && part.value !== ""
  );
  const parts = offered.map(safePart);
  const kept = parts.filter((part): part is { key: string; value: string } => part !== null);
  const dropped = parts.length - kept.length;

  const size = rows === 0 ? "no rows" : `${plural(rows, "row")} in ${plural(sheets, "table")}`;
  const contacts = contactsLeft(facts);
  const summary = [
    `Downloaded “${title}” as ${formatLabel} — ${size}.`,
    facts.scores === "masked"
      ? "Scores were withheld from this account, so none are in the file."
      : facts.scores === "open"
        ? "The scores in it are unmasked."
        : null,
    contacts === "included"
      ? "It carries the contact details this account is allowed to read."
      : contacts === "withheld"
        ? "Contact details were withheld from this account, so none are in the file."
        : null,
    limits > 0 ? `The file notes what it left out (${limits}).` : null,
  ]
    .filter((sentence): sentence is string => Boolean(sentence))
    .join(" ");

  const detail: Record<string, unknown> = {
    door: facts.door,
    format: facts.format,
    rows,
    sheets,
    scores: facts.scores,
    contacts,
    declared_limits: limits,
  };

  const fileName = text(facts.document?.baseName, "");
  if (fileName) detail.file = clamp(`${fileName}.${facts.format}`, ACTIVITY_LIMITS.detailValue);

  if (kept.length > 0 || dropped > 0) {
    detail.cut = clamp(
      kept.map((part) => `${part.key}: ${part.value}`).join(" · "),
      ACTIVITY_LIMITS.detailValue
    );
    detail.cut_kept = kept.length;
    if (dropped > 0) {
      detail.cut_dropped = dropped;
      detail.cut_note = "a filter was too free-texted to keep";
    }
  }

  return {
    area: "exports",
    action: "export_download",
    entity: "export",
    entityId: null,
    summary,
    detail,
  };
}

/**
 * The words a door says when the trail would not take the row.
 *
 * The download is refused rather than let through unrecorded: an audit that only
 * works when the insert succeeds is a log, and a log nobody can prove is complete
 * cannot be the reason a permission was granted.
 */
export function exportAuditDenied(reason: string): string {
  const missing = /activity_log|does not exist|PGRST205/i.test(reason);
  return missing
    ? "The download was refused: the change trail has no table to write the audit record into. Apply db/migrations/024_activity_log.sql, then ask for the file again — nothing was sent."
    : `The download was refused: the audit record could not be written (${clamp(reason, 200)}). Nothing was sent.`;
}
