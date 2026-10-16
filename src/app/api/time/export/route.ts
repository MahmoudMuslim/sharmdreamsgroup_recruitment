/**
 * The time ledger as a file.
 *
 * Its own door, not the reports route, because it answers to a different
 * permission: a hiring report is policed by `analytics.export`, while these are
 * the hours a person logged, policed by the same `time.track` that opens the page
 * and lets them edit a row. A recruiter with no rights to the pipeline should
 * still be able to take their own timesheet away — and one without `time.track`
 * should not be able to pull anyone's out of the API, however the console looks.
 *
 * The rows themselves are never this file's decision. It reads through the same
 * `readLedger()` as the screen, on the caller's own session client, so Row Level
 * Security decides what is in the download exactly as it decides what is on the
 * page, and the window and scope are resolved by the same `ledgerCut()` both
 * halves call.
 */

import {
  buildExport,
  EXPORT_FORMATS,
  type ExportFormat,
} from "@/modules/analytics/domain/exportDocument";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { dayKeyInZone } from "@/lib/timezone";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { ledgerCut, readLedger, LEDGER_ROW_LIMIT } from "@/modules/timelog/application/ledger";
import { ledgerDocument } from "@/modules/timelog/domain/document";
import { TRACK_DENIED, timeWindow } from "@/modules/timelog/domain/ledger";

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

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json("Sign in as a staff member to download the time ledger.", 401);
  }

  if (!(await hasPermissionForUser("time.track"))) {
    return json(TRACK_DENIED, 403);
  }

  const params = new URL(request.url).searchParams;
  const format = safeFormat(params.get("format"));
  if (!format) return json("A format is required: csv, xlsx or pdf.", 400);

  const generatedAt = new Date();
  const timeZone = await getOrganisationTimeZone();
  const cut = ledgerCut(
    { window: params.get("window"), scope: params.get("scope") },
    timeZone,
    generatedAt
  );

  const read = await readLedger({
    since: cut.since,
    staffId: cut.scope === "mine" ? user.profileId : null,
    callerStaffId: user.profileId,
  });

  // A ledger that cannot be read downloads as a refusal, never as an empty file:
  // a blank timesheet reads like "nobody logged anything this week" to whoever
  // receives it, when the real answer is usually that the table does not exist.
  if (read.error) return json(read.error, 503);

  const limitations: string[] = [];
  if (read.entries.length >= LEDGER_ROW_LIMIT) {
    limitations.push(
      `A cut of the ledger is read newest-first up to ${LEDGER_ROW_LIMIT.toLocaleString()} spans, so a longer window may be trimmed. Narrow it to take the rest.`
    );
  }

  const document = ledgerDocument(read.entries, {
    timeZone,
    windowKey: cut.window,
    scopeNote: cut.scopeNote,
    teamScope: cut.scope !== "mine",
    exportedBy: user.fullName,
    generatedAt: generatedAt.toISOString(),
    baseName: `sharm-dreams-time-${timeWindow(cut.window).key}-${dayKeyInZone(
      generatedAt.toISOString(),
      timeZone
    )}`,
    limitations,
  });

  const file = await buildExport(document, format);
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      /** Hours name the person who worked them and the candidate they went to. */
      "X-Content-Type-Options": "nosniff",
    },
  });
}
