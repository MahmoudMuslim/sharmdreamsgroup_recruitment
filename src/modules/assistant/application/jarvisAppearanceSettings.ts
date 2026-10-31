import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import { DEFAULT_JARVIS_APPEARANCE, parseJarvisAppearance, type JarvisAppearance } from "@/modules/assistant/domain/jarvisAppearance";

export interface JarvisAppearanceRead {
  appearance: JarvisAppearance;
  stored: boolean;
  problem: "absent" | "unreadable" | null;
}

export type SavedJarvisAppearance =
  | { ok: true; appearance: JarvisAppearance; warning?: string }
  | { ok: false; error: string };

export async function readJarvisAppearance(profileId: string): Promise<JarvisAppearanceRead> {
  const defaults = { appearance: DEFAULT_JARVIS_APPEARANCE, stored: false };
  try {
    const client = await createServerRestClient();
    const { data, error } = await client.from("assistant_jarvis_prefs").select("appearance")
      .eq("profile_id", profileId).maybeSingle();
    if (error) {
      const absent = ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "");
      return { ...defaults, problem: absent ? "absent" : "unreadable" };
    }
    if (!data || data.appearance === null) return { ...defaults, problem: null };
    const parsed = parseJarvisAppearance(data.appearance);
    return parsed.ok
      ? { appearance: parsed.appearance, stored: true, problem: null }
      : { ...defaults, problem: "unreadable" };
  } catch {
    return { ...defaults, problem: "unreadable" };
  }
}

export async function saveJarvisAppearance(draft: unknown): Promise<SavedJarvisAppearance> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again to change your appearance settings." };
  const parsed = parseJarvisAppearance(draft);
  if (!parsed.ok) return parsed;
  const previous = await readJarvisAppearance(user.profileId);
  if (previous.problem) return {
    ok: false,
    error: previous.problem === "absent"
      ? "Appearance storage is unavailable. Migration 049 must be applied before saving. Presence settings are unchanged."
      : "Your saved appearance could not be read. Try again before replacing it.",
  };
  try {
    const client = await createServerRestClient();
    const { error } = await client.from("assistant_jarvis_prefs").upsert({
      profile_id: user.profileId,
      appearance: parsed.appearance,
    }, { onConflict: "profile_id" });
    if (error) return { ok: false, error: "Appearance could not be saved. Try again." };
  } catch {
    return { ok: false, error: "Appearance could not be saved. Try again." };
  }
  let audited = false;
  try {
    const trail = await recordActivity({
      area: "settings",
      action: "jarvis_appearance_changed",
      entity: "setting",
      entityId: "jarvis_appearance",
      actorId: user.profileId,
      summary: "Changed their JARVIS appearance.",
      detail: { from: previous.appearance, to: parsed.appearance },
    });
    audited = trail.ok;
  } catch {
    audited = false;
  }
  return {
    ok: true,
    appearance: parsed.appearance,
    ...(!audited ? { warning: "Appearance saved, but its audit entry could not be recorded." } : {}),
  };
}
