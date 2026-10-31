import { NextResponse } from "next/server";

import { cronConfig } from "@/lib/config.server";
import { getServiceRestClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";
import { publicBaseUrl } from "@/lib/public-url";

import { LIMITS } from "@/modules/form-builder/domain/limits";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import { eraseApplication } from "@/modules/privacy/application/erasure";
import {
  mintPrivacyToken,
  privacyLink,
} from "@/modules/privacy/application/linkToken";
import {
  nextRetentionAction,
  planRetention,
  type RetentionDecision,
} from "@/modules/privacy/domain/privacy";
import {
  readPrivacySettings,
  readRetentionCandidates,
  readRetentionContacts,
  type RetentionCandidateRow,
} from "@/modules/privacy/infrastructure/privacyReader";
import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";

/**
 * The nightly retention sweep.
 *
 * It does nothing at all unless Settings says so — `privacy.retention_enabled`
 * ships off, and this route reads it directly so the switch is named here rather
 * than only inside a reader. With the switch off this is a 200 that says the
 * sweep is off; it is not an error, because a deployment that never opts in is a
 * valid deployment.
 *
 * The order is the public promise, not an implementation detail: a record is
 * warned first, the stamp is written only after the relay accepts the letter, and
 * an erasure is allowed only when that stamp is at least the stated warning days
 * old. A failed letter therefore leaves the record un-warned and un-erased, and
 * the next tick tries again. Held records — hired, or carrying an open assessment
 * or interview — are never touched, and the sweep reads the same `planRetention`
 * the desk prints from, so the date on screen is the date acted on.
 *
 * Both passes are bounded. A first run after the switch is turned on can find a
 * whole book due at once; the batch keeps one tick from mailing or erasing in an
 * unbounded burst, and the next tick continues from the oldest rows.
 *
 * One pass runs even with the switch off: unclaimed form uploads. A photographed
 * passport or a CV that never became an application has no record to protect, so
 * `privacy.retention_enabled` cannot be allowed to mean "keep a stranger's file
 * forever". That pass deletes bytes before the ledger row — the reverse order
 * would leave a file on disk no row could name again — and it skips quietly when
 * the form-builder tables are not on the database yet.
 *
 * Protected like the other cron routes — an `x-cron-secret` header matching
 * CRON_SECRET, failing closed when the secret is unset.
 */

function batchSize(): number {
  const value = Number(cronConfig.retentionBatchSize);
  if (!Number.isFinite(value)) return 25;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function when(value: string | null): string {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "an unrecorded date";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function warningLetter(input: {
  dueAt: string;
  lastActivityAt: string | null;
  link: string;
  warningDays: number;
}): string {
  return [
    "You applied to Sharm Dreams Group, and we hold an application record about you.",
    "",
    `The last activity on that record was ${when(input.lastActivityAt)}. Under our retention policy the record falls due for erasure on ${when(input.dueAt)}.`,
    `If nothing further happens on the application, we will erase the personal details on it shortly after that date. We are writing now, at least ${input.warningDays} days ahead, so you have time to act.`,
    "",
    "You can ask for a copy of what we hold, or ask us to erase it, from this link:",
    input.link,
    "",
    "The link is personal to this application and expires in seven days. If it has expired, the page below it can send a new one.",
    "",
    "Erasing the record removes your name, address, telephone number, CV and written answers. The application itself — the role, the stage it reached, its score and its dates — stays as the company's record that an application was judged, without your identity on it.",
    "If you were hired, the hiring record is kept instead, because it is the company's own employment history.",
    "",
    "If this record is still active — for example an assessment or interview is open — it will not be erased.",
  ].join("\n");
}

interface OrphanSweep {
  /** False when 044 is not on the database; the rest of the sweep still runs. */
  available: boolean;
  scanned: number;
  removed: number;
  failed: number;
}

interface RetiredRow {
  id: string;
  bucket: string;
  storage_path: string;
}

/**
 * Delete the uploads nobody claimed.
 *
 * A file field writes its row with `application_id` null and fills it in at
 * submit, so a row that is still null after the window belongs to an application
 * that never arrived — abandoned mid-form, or a probe that only ever uploaded.
 * The window is a constant in `LIMITS`, not a setting: a wider one would keep
 * personal bytes longer than the applicant was told.
 */
async function clearOrphanUploads(
  service: ReturnType<typeof getServiceRestClient>
): Promise<OrphanSweep> {
  const empty: OrphanSweep = { available: true, scanned: 0, removed: 0, failed: 0 };
  const cutoff = new Date(
    Date.now() - LIMITS.orphan_upload_window_hours * 60 * 60 * 1000
  );

  const { data, error } = await service
    .from("application_form_files")
    .select("id, bucket, storage_path")
    .is("application_id", null)
    .lt("uploaded_at", cutoff.toISOString())
    .order("uploaded_at", { ascending: true })
    .limit(500);

  if (error) {
    // An unapplied 044 is not a failure of the retention sweep.
    if (isMissingSchemaError(error)) return { ...empty, available: false };
    console.error("[privacy] the orphan-upload read failed:", error.message);
    return { ...empty, failed: 1 };
  }

  const rows = (data ?? []) as RetiredRow[];
  if (rows.length === 0) return empty;

  const store = await getFileStore();
  let removed = 0;
  let failed = 0;

  for (const row of rows) {
    // Bytes first. A row deleted before its file would orphan the bytes with no
    // ledger entry left to find them by.
    const gone = await store.remove({ bucket: row.bucket, paths: [row.storage_path] });
    if (!gone.ok) {
      console.error(
        `[privacy] orphan upload ${row.id} could not be removed from ${row.bucket}:`,
        gone.error ?? gone.failed.join(", ")
      );
      failed += 1;
      continue;
    }

    const { error: deleteError } = await service
      .from("application_form_files")
      .delete()
      .eq("id", row.id);
    if (deleteError) {
      console.error(
        `[privacy] orphan upload ${row.id} lost its bytes but not its row:`,
        deleteError.message
      );
      failed += 1;
      continue;
    }
    removed += 1;
  }

  return { available: true, scanned: rows.length, removed, failed };
}

interface SweepSummary {
  enabled: boolean;
  scanned: number;
  capped: boolean;
  relay: boolean;
  warned: number;
  erased: number;
  held: number;
  failed: number;
  batch: number;
  orphans: OrphanSweep;
  note?: string;
}

async function handle(request: Request): Promise<NextResponse> {
  const secret = cronConfig.secret;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set it before scheduling this route." },
      { status: 503 }
    );
  }

  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = getServiceRestClient();

  // Deliberately before the switch: an unclaimed upload is not a retention
  // policy question, and switching the sweep off must not keep stray bytes.
  const orphans = await clearOrphanUploads(service);

  const enabled = await getBoolSetting("privacy.retention_enabled", false);
  if (!enabled) {
    const off: SweepSummary = {
      enabled: false,
      scanned: 0,
      capped: false,
      relay: false,
      warned: 0,
      erased: 0,
      held: 0,
      failed: 0,
      batch: batchSize(),
      orphans,
      note: "The retention sweep is switched off in Settings → Privacy & retention.",
    };
    return NextResponse.json(off);
  }

  const settings = await readPrivacySettings();
  const candidates = await readRetentionCandidates(service);

  if (!candidates.available) {
    const missing: SweepSummary = {
      enabled: true,
      scanned: 0,
      capped: false,
      relay: false,
      warned: 0,
      erased: 0,
      held: 0,
      failed: 0,
      batch: batchSize(),
      orphans,
      note: candidates.note ?? "The retention view could not be read.",
    };
    return NextResponse.json(missing);
  }

  const contacts = await readRetentionContacts(service, candidates.rows);
  const now = new Date();
  const decisions = planRetention(candidates.rows, {
    months: settings.months,
    talentPoolMonths: settings.talentPoolMonths,
    warningDays: settings.warningDays,
    now,
  });

  const byId = new Map<string, RetentionCandidateRow>(
    candidates.rows.map((row) => [row.applicationId, row])
  );

  const toWarn: RetentionDecision[] = [];
  const toErase: RetentionDecision[] = [];
  let held = 0;

  for (const decision of decisions) {
    const row = byId.get(decision.applicationId);
    const action = nextRetentionAction({
      decision,
      warnedAt: row?.warnedAt ?? null,
      warningDays: settings.warningDays,
      now,
    });
    if (action === "warn") toWarn.push(decision);
    else if (action === "erase") toErase.push(decision);
    else if (decision.status === "held" || decision.blockedBy) held += 1;
  }

  const batch = batchSize();
  let warned = 0;
  let eraseCount = 0;
  let failed = 0;

  const pendingWarnings = toWarn.slice(0, batch);
  const relay = toWarn.length > 0 ? await EmailConnector.isConfigured() : false;
  const origin = relay ? await publicBaseUrl() : "";

  if (!relay) {
    // No relay means no warning can be sent, and without a warning nothing is
    // erased. The count is reported rather than hidden, so a silent deployment
    // reads as "warned 0, N waiting for a relay" instead of "nothing due".
    failed += pendingWarnings.length;
  } else {
    for (const decision of pendingWarnings) {
      const row = byId.get(decision.applicationId);
      const email = contacts.get(decision.applicationId)?.email ?? null;
      if (!row || !email) {
        failed += 1;
        continue;
      }

      const token = mintPrivacyToken({ applicationId: decision.applicationId });
      const result = await EmailConnector.send({
        to: email,
        subject: "Your application record with Sharm Dreams Group",
        text: warningLetter({
          dueAt: decision.dueAt,
          lastActivityAt: row.lastActivityAt,
          link: privacyLink(origin, token),
          warningDays: settings.warningDays,
        }),
      });

      if (!result.success) {
        console.error(
          `[privacy] retention warning for application ${decision.applicationId} failed:`,
          result.error
        );
        failed += 1;
        continue;
      }

      // Stamped only after the relay accepted it: a failed letter must not start
      // the countdown to an erasure nobody was warned about.
      const { error } = await service
        .from("applications")
        .update({ retention_warned_at: now.toISOString() })
        .eq("id", decision.applicationId);
      if (error) {
        console.error(
          `[privacy] warning for application ${decision.applicationId} was sent but not stamped:`,
          error.message
        );
        failed += 1;
        continue;
      }
      warned += 1;
    }
  }

  for (const decision of toErase.slice(0, batch)) {
    const outcome = await eraseApplication({
      applicationId: decision.applicationId,
      actorId: null,
      actorLabel: "Retention sweep",
      cause: "retention",
      via: "cron",
    });
    if (outcome.ok) eraseCount += 1;
    else {
      console.error(
        `[privacy] retention erasure for application ${decision.applicationId} did not run:`,
        outcome.error
      );
      failed += 1;
    }
  }

  const summary: SweepSummary = {
    enabled: true,
    scanned: candidates.rows.length,
    capped: candidates.capped,
    relay,
    warned,
    erased: eraseCount,
    held,
    failed,
    batch,
    orphans,
  };
  if (candidates.capped && candidates.note) summary.note = candidates.note;
  return NextResponse.json(summary);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
