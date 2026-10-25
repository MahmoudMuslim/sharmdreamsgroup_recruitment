import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";

import { recordActivity } from "@/modules/activity/application/record";
import type { ActivitySurface } from "@/modules/activity/domain/trail";
import { emailSpellings } from "@/modules/candidates/domain/personIdentity";
import { erasureBlocker, PRIVACY_WRITE_REFUSAL } from "@/modules/privacy/domain/privacy";

import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";

/**
 * The one engine that erases a person's data, shared by the staff desk and the
 * nightly sweep.
 *
 * Order is the whole design. The open-work checks run first, then every storage
 * object a record points at is removed, and only then does the database function
 * blank the row. If a file cannot be removed the run stops before anything is
 * blanked, because a blanked row whose CV is still on disk is the worst of both:
 * the person is told they are gone while their document is still there. The
 * function repeats the same refusals as its own guard, so calling the database
 * directly cannot skip them.
 *
 * The trail row names the application and how many objects went, never the person.
 * An erasure that recorded the name it erased would leave the identity in the one
 * table nobody deletes from.
 */

/** The buckets a row's path columns point into. */
const CV_BUCKET = "candidate-cvs";
const VIDEO_BUCKET = "candidate-videos";

/** How many attempt ids are sent in one `in()` filter. */
const ID_CHUNK = 100;

type ServiceClient = ReturnType<typeof getServiceRestClient>;

export type ErasureCause = "request" | "retention";

export interface ErasureOutcome {
  ok: boolean;
  error?: string;
  /** True when the row was already marked erased before this run. */
  alreadyErased?: boolean;
  filesRemoved?: number;
  erasedAt?: string | null;
}

export interface EraseApplicationInput {
  applicationId: string;
  /** The staff member who approved or ran it; null for the nightly sweep. */
  actorId: string | null;
  actorLabel: string;
  cause: ErasureCause;
  via?: ActivitySurface;
}

type PathsByBucket = Map<string, Set<string>>;

function addPath(target: PathsByBucket, bucket: string | null, path: unknown): void {
  if (!bucket || typeof path !== "string" || path.length === 0) return;
  const set = target.get(bucket) ?? new Set<string>();
  set.add(path);
  target.set(bucket, set);
}

function uuidPattern(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Every stored object this application owns, grouped by the bucket it lives in.
 *
 * Three columns in this schema hold storage keys, so three reads. An attachment
 * names its own bucket — staff uploads land in `resumes` and `candidate-audio`
 * while the career site uses `candidate-cvs` — so one bucket constant per kind
 * would miss half of them.
 */
async function collectPaths(
  service: ServiceClient,
  applicationId: string
): Promise<PathsByBucket> {
  const paths: PathsByBucket = new Map();

  const { data: application } = await service
    .from("applications")
    .select("cv_file_path")
    .eq("id", applicationId)
    .maybeSingle();
  addPath(paths, CV_BUCKET, (application as Record<string, unknown> | null)?.cv_file_path);

  const { data: attempts } = await service
    .from("candidate_attempts")
    .select("id")
    .eq("application_id", applicationId);

  const attemptIds = ((attempts ?? []) as Record<string, unknown>[]).map((row) => String(row.id));

  for (let start = 0; start < attemptIds.length; start += ID_CHUNK) {
    const chunk = attemptIds.slice(start, start + ID_CHUNK);
    const { data: responses } = await service
      .from("candidate_responses")
      .select("video_path")
      .in("attempt_id", chunk)
      .not("video_path", "is", null);

    for (const raw of (responses ?? []) as Record<string, unknown>[]) {
      addPath(paths, VIDEO_BUCKET, raw.video_path);
    }
  }

  const { data: attachments } = await service
    .from("application_attachments")
    .select("bucket, storage_path")
    .eq("application_id", applicationId);

  for (const raw of (attachments ?? []) as Record<string, unknown>[]) {
    addPath(
      paths,
      typeof raw.bucket === "string" ? raw.bucket : null,
      raw.storage_path
    );
  }

  return paths;
}

function rpcReason(error: { code?: string | null; message?: string | null }): string {
  if (isMissingSchemaError(error)) return PRIVACY_WRITE_REFUSAL;
  // The function raises P0001 for each refusal with a sentence worth printing.
  return error.message ?? "The database refused the erasure.";
}

/**
 * Erase one application, or say why it is held.
 *
 * Idempotent: a row already carrying `erased_at` returns success without touching
 * storage or writing a second trail row, so a retried request or a sweep that
 * overlaps yesterday's run does nothing twice.
 */
export async function eraseApplication(
  input: EraseApplicationInput
): Promise<ErasureOutcome> {
  const { applicationId } = input;
  if (!uuidPattern(applicationId)) {
    return { ok: false, error: "That application id is not one this portal recognises." };
  }

  const service = getServiceRestClient();

  // The view answers both questions at once: whether it is already gone, and what
  // is still open on it. Reading it through the service role is the same view the
  // console reads, so the two cannot disagree about the window or the blockers.
  const { data: retention, error: retentionError } = await service
    .from("application_retention")
    .select("application_id, stage, open_assessments, open_interviews, erased_at")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (retentionError) {
    const missing = isMissingSchemaError(retentionError);
    return {
      ok: false,
      error: missing ? PRIVACY_WRITE_REFUSAL : retentionError.message,
    };
  }
  if (!retention) {
    return { ok: false, error: "That application no longer exists." };
  }

  const row = retention as Record<string, unknown>;
  if (row.erased_at != null) {
    return { ok: true, alreadyErased: true, filesRemoved: 0 };
  }

  const blocker = erasureBlocker({
    stage: row.stage,
    openAssessments: Number(row.open_assessments ?? 0),
    openInterviews: Number(row.open_interviews ?? 0),
  });
  if (blocker) return { ok: false, error: blocker };

  const paths = await collectPaths(service, applicationId);
  const files = await getFileStore();
  let removed = 0;

  for (const [bucket, set] of paths) {
    if (set.size === 0) continue;
    const result = await files.remove({ bucket, paths: [...set] });
    if (!result.ok) {
      const list = result.failed.length ? ` (${result.failed.slice(0, 3).join(", ")})` : "";
      return {
        ok: false,
        error:
          result.error ??
          `The files in ${bucket} could not be removed${list}, so nothing was erased.`,
      };
    }
    removed += set.size;
  }

  const { data: erased, error: eraseError } = await service.rpc("erase_candidate_data", {
    p_application_id: applicationId,
  });

  if (eraseError) {
    console.error("[privacy] erasure function refused:", eraseError.message);
    return { ok: false, error: rpcReason(eraseError) };
  }

  // The company is read from the row before the trail is written; after the
  // function the row keeps its tenant, but reading it now keeps this call honest
  // about which record it is filing against even if a later change drops it.
  const { data: owner } = await service
    .from("applications")
    .select("tenant_id")
    .eq("id", applicationId)
    .maybeSingle();

  await recordActivity({
    area: "privacy",
    action: input.cause === "retention" ? "retention_erased" : "erasure_executed",
    entity: "application",
    entityId: applicationId,
    summary:
      input.cause === "retention"
        ? "Erased the personal data on a record whose retention window had run out."
        : "Erased the personal data on an application at the candidate's request.",
    detail: {
      application_id: applicationId,
      files_removed: removed,
      cause: input.cause,
    },
    actorKind: input.actorId ? "STAFF" : "SYSTEM",
    actorLabel: input.actorLabel,
    actorId: input.actorId,
    via: input.via ?? (input.actorId ? "console" : "cron"),
    companyId: (owner as Record<string, unknown> | null)?.tenant_id as string | null | undefined,
  });

  const erasedAt =
    erased && typeof erased === "object"
      ? ((erased as Record<string, unknown>).erased_at as string | undefined) ?? null
      : null;

  return { ok: true, filesRemoved: removed, erasedAt };
}

export interface ErasePersonOutcome {
  ok: boolean;
  error?: string;
  erased: number;
  /** The refusals that kept a record, each already phrased for a person. */
  held: string[];
}

/**
 * Erase every application filed under one address.
 *
 * A person may be in several pipelines, and an erasure request is about the
 * person, not one row. Each application is erased through `eraseApplication`, so
 * a hired or live record stops the run for that row while the rest proceed — the
 * person is erased from what may be erased, and the held rows are reported rather
 * than silently skipped. The request stays APPROVED until every row is either
 * erased or provably held, which is what the returned `held` list says.
 */
export async function erasePerson(input: {
  email: string;
  actorId: string | null;
  actorLabel: string;
  via?: ActivitySurface;
}): Promise<ErasePersonOutcome> {
  const spellings = emailSpellings(input.email);
  if (spellings.length === 0) {
    return { ok: false, error: "The request carries no address to match.", erased: 0, held: [] };
  }

  const service = getServiceRestClient();
  const { data, error } = await service
    .from("applications")
    .select("id, erased_at")
    .in("email", spellings)
    .is("erased_at", null);

  if (error) {
    return {
      ok: false,
      error: isMissingSchemaError(error) ? PRIVACY_WRITE_REFUSAL : error.message,
      erased: 0,
      held: [],
    };
  }

  const ids = ((data ?? []) as Record<string, unknown>[]).map((row) => String(row.id));
  if (ids.length === 0) {
    return {
      ok: false,
      error: "No application on file carries that address, so there is nothing to erase.",
      erased: 0,
      held: [],
    };
  }

  let erased = 0;
  const held: string[] = [];

  for (const applicationId of ids) {
    const outcome = await eraseApplication({
      applicationId,
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      cause: "request",
      via: input.via,
    });

    if (outcome.ok) {
      erased += 1;
      continue;
    }
    held.push(outcome.error ?? "A record could not be erased.");
  }

  if (held.length > 0) {
    return {
      ok: false,
      error:
        held.length === 1
          ? held[0]
          : `${erased} of ${ids.length} records were erased; ${held.length} are held. ${held[0]}`,
      erased,
      held,
    };
  }

  return { ok: true, erased, held: [] };
}
