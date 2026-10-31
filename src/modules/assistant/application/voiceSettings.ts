import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import {
  DEFAULT_VOICE_AUTONOMY,
  VOICE_AUTONOMY_LABELS,
  effectiveAutonomy,
  isVoiceAutonomy,
  type VoiceAutonomy,
  type VoiceAutonomyState,
} from "@/modules/assistant/domain/voice";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

/**
 * What a spoken confirmation may do, per person.
 *
 * Read on the server whenever an approval card is minted, so the level cannot be
 * upgraded by a browser. Until 046 is applied the table is absent; the reader
 * answers `confirm`, says nothing was stored and names the migration, which is
 * what makes "only confirm is offered" true rather than a promise in a menu. A
 * read that fails for any other reason answers the same safe level but reports
 * the unreadable problem, so an outage is not mistaken for an unapplied file.
 */

const MIGRATION_MISSING =
  /42P01|PGRST205|PGRST204|does not exist|schema cache/i;

const MIGRATION_SENTENCE =
  "db/migrations/046_assistant_voice_autonomy.sql is authored but not applied, so only “confirm with a click” can be used.";

function missing(error: { code?: string | null; message?: string | null }): boolean {
  return MIGRATION_MISSING.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

export async function readVoiceAutonomy(profileId: string): Promise<VoiceAutonomyState> {
  const canOpen = await hasPermissionForUser("settings.manage_platform");
  const restClient = await createServerRestClient();

  const { data, error } = await restClient
    .from("assistant_voice_autonomy")
    .select("mode")
    .eq("profile_id", profileId)
    .maybeSingle();

  // A read that fails for any reason falls back to the safe level. A voice
  // setting is never worth failing a turn over. The two failures stay distinct:
  // an absent table is expected until 046 is applied, an unreadable one is not,
  // and only the first may be reported as "the migration is not applied".
  if (error) {
    if (missing(error)) {
      return { level: DEFAULT_VOICE_AUTONOMY, stored: false, canOpen, problem: "absent" };
    }
    console.error("readVoiceAutonomy failed:", error.message);
    return { level: DEFAULT_VOICE_AUTONOMY, stored: false, canOpen, problem: "unreadable" };
  }
  // The table exists and this person has not chosen. No row is not a choice:
  // `stored` stays false so the console can still offer every level.
  if (!data) return { level: DEFAULT_VOICE_AUTONOMY, stored: false, canOpen, problem: null };

  const mode = (data as { mode?: unknown }).mode;
  const level = isVoiceAutonomy(mode) ? mode : DEFAULT_VOICE_AUTONOMY;
  // A stored `open` outlives a revoked grant; the card must not. The stored word
  // stays a fact of the row, but every consumer receives the safe twin.
  return { level: effectiveAutonomy(level, canOpen), stored: true, canOpen, problem: null };
}

export async function saveVoiceAutonomy(
  level: string
): Promise<{ ok: true; level: VoiceAutonomy } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again to change this setting." };
  if (!isVoiceAutonomy(level)) {
    return { ok: false, error: "That is not a voice setting this portal offers." };
  }
  if (level === "open" && !(await hasPermissionForUser("settings.manage_platform"))) {
    return {
      ok: false,
      error:
        "Hands-free approvals need the settings.manage_platform grant. Ask an administrator, or choose a level that waits for you.",
    };
  }

  // The trail records the move, so the previous effective level is read before
  // the write. A voice setting is not worth failing a save over: a previous
  // state that cannot be read is recorded as `confirm`, which is the level a
  // missing row already means.
  let previous: VoiceAutonomy = DEFAULT_VOICE_AUTONOMY;
  try {
    previous = (await readVoiceAutonomy(user.profileId)).level;
  } catch (cause) {
    console.error(
      "saveVoiceAutonomy could not read the previous level:",
      cause instanceof Error ? cause.message : String(cause)
    );
  }

  const restClient = await createServerRestClient();
  const { error } = await restClient.from("assistant_voice_autonomy").upsert(
    {
      profile_id: user.profileId,
      mode: level,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );

  if (error) {
    if (missing(error)) return { ok: false, error: MIGRATION_SENTENCE };
    return { ok: false, error: `That setting could not be saved: ${error.message}` };
  }

  // `entityId` is the setting key, as it is for every other settings writer, so
  // the trail can be found by this one setting rather than by whoever saved it.
  await recordActivity({
    area: "settings",
    action: "voice_autonomy_changed",
    entity: "setting",
    entityId: "voice_autonomy",
    summary: `Voice approvals set to “${VOICE_AUTONOMY_LABELS[level]}”`,
    detail: { from: previous, to: level },
    actorId: user.profileId,
  });

  return { ok: true, level };
}
