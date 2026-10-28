"use server";

import { requireStaff } from "@/lib/auth/session";
import {
  jarvisPresenceForViewer,
  saveJarvisPrefs,
  type JarvisUnarmed,
  type SavedJarvisPrefs,
} from "@/modules/assistant/application/jarvisSettings";
import type { JarvisPrefs } from "@/modules/assistant/domain/jarvis";

/**
 * What the presence may do, as the browser is allowed to see it.
 *
 * The row's owner is the only person who reads it this way, and the profile id
 * travels with it so a briefing's "already given today" is keyed to the person,
 * not to whichever browser they happen to be using.
 */
export type PresenceRead =
  | { ok: true; profileId: string; prefs: JarvisPrefs }
  | { ok: false; profileId?: string; reason: JarvisUnarmed["reason"]; message: string };

export async function getJarvisPresence(): Promise<PresenceRead> {
  const user = await requireStaff("/assistant");
  const seen = await jarvisPresenceForViewer();
  if ("reason" in seen) return { ok: false, profileId: user.profileId, ...seen };
  return { ok: true, profileId: user.profileId, prefs: seen };
}

/**
 * Saving one's own presence.
 *
 * `consentGiven` is the browser's claim that the audio explanation was heard; the
 * application layer stamps the moment and refuses to arm the microphone without
 * one, so a claim made here cannot reach the row on its own.
 */
export async function setJarvisPresence(
  draft: Record<string, unknown>,
  consentGiven: boolean
): Promise<SavedJarvisPrefs> {
  await requireStaff("/assistant/jarvis");
  return saveJarvisPrefs(draft, { consentGiven: consentGiven === true });
}
