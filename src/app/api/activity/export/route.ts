/**
 * The change trail as a file.
 *
 * Its own door, not the reports route, because it answers to a different
 * permission: the trail is policed by `settings.manage_platform`, while a hiring
 * report is policed by `analytics.export`. Whoever is allowed to read who did
 * what is allowed to take it away, and nobody else is — so the check happens
 * here, on the way out, and the browser never holds a copy to render from.
 */

import {
  buildExport,
  EXPORT_FORMATS,
  type ExportFormat,
} from "@/modules/analytics/domain/exportDocument";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { readActivityTrail } from "@/modules/activity/application/record";
import {
  paramsToQuery,
  resolveTrailQuery,
  scopeFor,
} from "@/modules/activity/application/trailQuery";
import { trailDocument } from "@/modules/activity/domain/document";
import { trailWindow } from "@/modules/activity/domain/trail";
import { dayKeyInZone } from "@/lib/timezone";

/** A download is a file, not a page — `requireStaff()` would redirect instead of refusing. */
function json(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeFormat(value: string | null): ExportFormat | null {
  return EXPORT_FORMATS.some((format) => format.key === value) ? (value as ExportFormat) : null;
}

/** Further back than the screen, and still capped: one read must not be the whole table. */
const EXPORT_ROWS = 2_000;

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json("Sign in as a staff member to download the change trail.", 401);
  }

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return json("Downloading the trail needs the Manage platform settings permission.", 403);
  }

  const params = new URL(request.url).searchParams;
  const format = safeFormat(params.get("format"));
  if (!format) return json("A format is required: csv, xlsx or pdf.", 400);

  const { filters, applied } = resolveTrailQuery(paramsToQuery(params), EXPORT_ROWS);
  const [read, timeZone] = await Promise.all([
    readActivityTrail(filters),
    getOrganisationTimeZone(),
  ]);

  // An unreadable trail downloads as a refusal, never as an empty file: a blank
  // export reads like "no changes in this window" to whoever receives it.
  if (read.error) return json(read.error, 503);

  const generatedAt = new Date().toISOString();
  const limitations: string[] = [];
  if (read.total > read.rows.length) {
    limitations.push(
      `This file holds the newest ${read.rows.length.toLocaleString()} of ${read.total.toLocaleString()} matching changes. Narrow the window to take the rest.`
    );
  }

  const bounds = trailWindow(applied.window);
  const document = trailDocument(read.rows, {
    timeZone,
    scope: scopeFor(applied),
    generatedAt,
    exportedBy: user.fullName,
    baseName: `sharm-dreams-activity-${bounds.key}-${dayKeyInZone(generatedAt, timeZone)}`,
    limitations,
  });

  const file = await buildExport(document, format);
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      /** The trail names people and records: keep it out of any shared cache. */
      "X-Content-Type-Options": "nosniff",
    },
  });
}
