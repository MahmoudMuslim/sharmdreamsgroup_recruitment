/**
 * The time ledger as a file.
 *
 * Same rule as every other export in the portal: the screen and the download are
 * built from one read, so a CSV cannot hold a span the console did not show, and
 * a total in a file cannot disagree with the tile above it. That is only true
 * because both halves call the same arithmetic in `./ledger` — this file
 * formatting it, never recomputing it.
 *
 * Hours are written as numbers because the reason anyone downloads this is to
 * sum them somewhere else. The readable `2h 14m` travels beside the decimal so
 * the file can be read as well as added up.
 */

import "server-only";

import { dayKeyInZone, formatInZone } from "@/lib/timezone";
import type {
  ExportDocument,
  ExportSheet,
} from "@/modules/analytics/domain/exportDocument";
import {
  byCandidate,
  byCategory,
  byJob,
  byStaff,
  CATEGORY_LABEL,
  decimalHours,
  elapsedSeconds,
  formatSpan,
  groupByDay,
  isRunning,
  LEDGER_NOTES,
  timeWindow,
  totalSeconds,
  type Slice,
  type TimeEntry,
  type TimeWindowKey,
} from "./ledger";

function stamp(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Decimal hours to two places — about the nearest minute, so a sum reads correctly. */
function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

function spanSheet(entries: TimeEntry[], timeZone: string, nowMs: number): ExportSheet {
  return {
    name: "Every span",
    columns: [
      "Day",
      "Started",
      "Ended",
      "Still running",
      "Span",
      "Hours",
      "Category",
      "What the time went to",
      "Who logged it",
      "Opening",
      "Candidate",
      "Note",
    ],
    rows: entries.map((entry) => [
      dayKeyInZone(entry.started_at, timeZone),
      stamp(entry.started_at, timeZone),
      entry.ended_at ? stamp(entry.ended_at, timeZone) : "",
      isRunning(entry) ? "yes" : "",
      formatSpan(elapsedSeconds(entry, nowMs)),
      hours(elapsedSeconds(entry, nowMs)),
      CATEGORY_LABEL[entry.category] ?? entry.category,
      entry.task,
      entry.staff_name,
      entry.job_title ?? "",
      entry.application_name ?? "",
      entry.note ?? "",
    ]),
  };
}

/** One totals sheet, from the same rows the screen grouped. */
function totalsSheet(
  name: string,
  head: string,
  slices: { key: string; label: string; seconds: number; entries: number }[]
): ExportSheet {
  return {
    name,
    columns: [head, "Spans", "Total", "Hours"],
    rows: slices.map((slice) => [
      slice.label,
      slice.entries,
      formatSpan(slice.seconds),
      hours(slice.seconds),
    ]),
  };
}

export interface LedgerDocumentContext {
  timeZone: string;
  windowKey: TimeWindowKey;
  /** The cut's own sentence, spelled out on the cover so a file with no header
   *  still says whose hours and how far back it covers. */
  scopeNote: string;
  /** Whose hours these are, which decides whether a colleague sheet would say
   *  anything the cover does not already. */
  teamScope: boolean;
  exportedBy: string;
  generatedAt: string;
  baseName: string;
  limitations: string[];
}

export function ledgerDocument(
  entries: TimeEntry[],
  context: LedgerDocumentContext
): ExportDocument {
  const nowMs = Date.parse(context.generatedAt);
  const groups = groupByDay(entries, nowMs, (iso) => dayKeyInZone(iso, context.timeZone));
  const total = totalSeconds(entries, nowMs);

  const sheets: ExportSheet[] = [spanSheet(entries, context.timeZone, nowMs)];
  // A totals tab with no rows would read as "these people logged nothing" rather
  // than "no span in this cut was tied to an opening", so the tabs that have
  // nothing to say are left out of the file.
  const add = (name: string, head: string, slices: Slice[]) => {
    if (slices.length > 0) sheets.push(totalsSheet(name, head, slices));
  };

  add("By category", "Category", byCategory(entries, nowMs));
  add(
    "By day",
    "Day",
    groups.map((group) => ({
      key: group.key,
      label: group.key,
      seconds: group.seconds,
      entries: group.entries.length,
    }))
  );
  if (context.teamScope) add("By colleague", "Colleague", byStaff(entries, nowMs));
  add("By opening", "Opening", byJob(entries, nowMs));
  add("By candidate", "Candidate", byCandidate(entries, nowMs));

  return {
    title: `${LEDGER_NOTES.label}, ${timeWindow(context.windowKey).label}`,
    description: LEDGER_NOTES.blurb,
    meta: [
      { label: "Covers", value: context.scopeNote },
      { label: "Window", value: timeWindow(context.windowKey).label },
      { label: "Time zone", value: context.timeZone },
      { label: "Total logged", value: `${formatSpan(total)} (${decimalHours(total)}h)` },
      { label: "Rows in this file", value: String(entries.length) },
      { label: "Generated", value: stamp(context.generatedAt, context.timeZone) },
      { label: "Exported by", value: context.exportedBy },
    ],
    limitations: [
      ...LEDGER_NOTES.caveats,
      "A span that was still running when this file was built is counted up to the moment of export, so the same download taken an hour later holds an hour more.",
      ...context.limitations,
    ],
    sheets,
    baseName: context.baseName,
  };
}
