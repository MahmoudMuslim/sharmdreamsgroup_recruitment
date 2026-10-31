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
 *
 * Before the bytes go, the download writes one row to the change trail — hours
 * name the person who worked them, so a ledger taken out of the portal is a
 * disclosure worth recording. A trail that refuses the row refuses the file.
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
import { recordActivity } from "@/modules/activity/application/record";
import { exportAuditDenied, exportTrailEntry } from "@/modules/activity/domain/exportTrail";
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

  /* The file carries exactly what the read carried, and says so with the
   * database's own count rather than a guess made from the row ceiling. The
   * running timer may be one of these rows while sitting outside the cut; that
   * is why the note counts the cut and not the file's line count. */
  const limitations: string[] = [];
  const cutTotal = read.total;
  if (cutTotal !== null && cutTotal > read.carried) {
    const leftOut = cutTotal - read.carried;
    limitations.push(
      `This cut holds ${cutTotal.toLocaleString()} spans and a file carries the newest ${read.carried.toLocaleString()}, so ${leftOut.toLocaleString()} are not in it. Narrow the window to take the rest.`
    );
  } else if (cutTotal === null && read.carried >= LEDGER_ROW_LIMIT) {
    limitations.push(
      `A file carries the newest ${read.carried.toLocaleString()} spans of the cut, and the database did not say how many the cut holds, so a longer window may be trimmed. Narrow it to take the rest.`
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

  /* Hours are not scores, so the audit says nothing about them; nor does a
   * timesheet hold an applicant's address, so it says nothing about those either.
   * The cut is the window and whether this is the caller's own ledger or the
   * team's, because that is the difference between taking a timesheet and taking
   * everyone's. */
  const written = await recordActivity(
    exportTrailEntry({
      door: "time",
      format,
      document,
      scores: "absent",
      contacts: "absent",
      cut: [{ key: "window", value: cut.window }, { key: "scope", value: cut.scope }],
    })
  );
  if (!written.ok) {
    return json(exportAuditDenied(written.error ?? "the trail gave no reason"), 503);
  }

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
