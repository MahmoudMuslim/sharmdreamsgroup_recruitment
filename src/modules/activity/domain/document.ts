/**
 * The change trail as a file.
 *
 * Same rule as every other export in the portal: the screen and the download are
 * built from one read, so a CSV cannot hold a row the console did not show. The
 * trail's own caveat is the one that matters most — a download carries further
 * back than the screen does, and says so in the file rather than only on screen.
 */

import "server-only";

import { dayKeyInZone, formatInZone } from "@/lib/timezone";
import type {
  ExportCell,
  ExportDocument,
  ExportSheet,
} from "@/modules/analytics/domain/exportDocument";
import { describeActor, TRAIL_LIST, type ActivityRow } from "./trail";

function stamp(iso: string, timeZone: string): string {
  const clock = formatInZone(iso, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${dayKeyInZone(iso, timeZone)} ${clock.slice(0, 5)}`;
}

/** The before/after bag flattened into one readable cell, withheld values included. */
function detailText(row: ActivityRow): string {
  if (!row.detail) return "";
  return Object.entries(row.detail)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: —`;
      return `${key}: ${String(value)}`;
    })
    .join(" · ");
}

export function trailSheet(rows: ActivityRow[], timeZone: string): ExportSheet {
  const body: ExportCell[][] = rows.map((row) => [
    stamp(row.created_at, timeZone),
    describeActor(row),
    row.actor_kind === "STAFF" ? "Person" : row.actor_kind,
    row.via,
    row.area,
    row.summary,
    row.entity,
    row.entity_id ?? "",
    detailText(row),
  ]);

  return {
    name: "Change trail",
    columns: [
      "When",
      "Who",
      "Kind",
      "Through",
      "Area",
      "What changed",
      "Record",
      "Record id",
      "Fields",
    ],
    rows: body,
  };
}

export interface TrailDocumentContext {
  timeZone: string;
  /** The filters the read was cut by, spelled out for whoever opens the file. */
  scope: string;
  generatedAt: string;
  exportedBy: string;
  baseName: string;
  /** Whatever the read could not deliver whole, e.g. the row ceiling. */
  limitations: string[];
}

export function trailDocument(
  rows: ActivityRow[],
  context: TrailDocumentContext
): ExportDocument {
  return {
    title: `${TRAIL_LIST.label}, ${context.scope}`,
    description: TRAIL_LIST.blurb,
    meta: [
      { label: "Covers", value: context.scope },
      { label: "Time zone", value: context.timeZone },
      { label: "Generated", value: stamp(context.generatedAt, context.timeZone) },
      { label: "Exported by", value: context.exportedBy },
      { label: "Rows in this file", value: String(rows.length) },
    ],
    limitations: [...TRAIL_LIST.caveats, ...context.limitations],
    sheets: [trailSheet(rows, context.timeZone)],
    baseName: context.baseName,
  };
}
