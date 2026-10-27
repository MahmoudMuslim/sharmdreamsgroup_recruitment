"use server";

import { requireStaff } from "@/lib/auth/session";
import { saveVoiceAutonomy } from "@/modules/assistant/application/voiceSettings";
import type { VoiceAutonomy } from "@/modules/assistant/domain/voice";

/** Saving is the only write here, and `open` is refused inside the application layer. */
export async function setVoiceAutonomy(
  level: string
): Promise<{ ok: true; level: VoiceAutonomy } | { ok: false; error: string }> {
  await requireStaff("/assistant/voice");
  return saveVoiceAutonomy(level);
}
