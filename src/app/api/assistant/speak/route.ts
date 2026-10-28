import { NextResponse } from "next/server";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import {
  MAX_SPEECH_TEXT,
  VoiceProviderRefusedError,
  VoiceUnavailableError,
  synthesizeSpeech,
} from "@/modules/assistant/infrastructure/speech";

/**
 * Speech out — text in, mp3 back, and nothing kept.
 *
 * The orb and the briefing are the only things that call this, and what they send
 * is a sentence the portal composed (a queue count, a greeting, an acknowledgement)
 * rather than a candidate's record. So the door is small and strict:
 *
 * - **Staff only, checked before the body is read.** An anonymous caller is
 *   refused for being anonymous, not for its Content-Length, and its text is never
 *   parsed.
 * - **The sentence is never logged.** Not on success, not on failure. A provider's
 *   own error body can quote what it was handed, so it is dropped here and the log
 *   carries this module's tag and the error's name.
 * - **No key is a 503, not a silent substitution.** The answer says
 *   `fallback: "device"` so the browser chooses the machine's voice deliberately
 *   and can tell the person that is what they are hearing.
 *
 * The window below is per process and in memory: it resets with the process and
 * does not span hosts. It is a cost guard against a runaway watcher, not a
 * security boundary; the provider's quota is the backstop.
 */

const WINDOW_MS = 5 * 60_000;
const MAX_SENTENCES = 20;
const MAX_VOICE_NAME = 48;

const recentSentences = new Map<string, number[]>();

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** Seconds until this profile may speak again, or null when it is under budget. */
function retryAfter(profileId: string): number | null {
  const now = Date.now();
  const recent = (recentSentences.get(profileId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_SENTENCES) {
    recentSentences.set(profileId, recent);
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
  }
  recent.push(now);
  recentSentences.set(profileId, recent);
  return null;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json({ error: "Sign in as staff to hear the assistant." }, 401);
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown } | null;
  const sentence = typeof body?.text === "string" ? body.text.trim() : "";
  if (!sentence) return json({ error: "There is nothing to say." }, 400);
  if (sentence.length > MAX_SPEECH_TEXT) {
    return json({ error: `A sentence is limited to ${MAX_SPEECH_TEXT} characters.` }, 400);
  }
  // A name is a label the person typed, never a path: it is cut and re-checked by
  // the voice module, which decides whether anything can be asked for at all.
  const voice =
    typeof body?.voice === "string" && body.voice.trim() ? body.voice.trim().slice(0, MAX_VOICE_NAME) : "jarvis";

  // Only a sentence that could be spoken spends the window: twenty typos must not
  // lock a recruiter out of their own briefing.
  const wait = retryAfter(user.profileId);
  if (wait !== null) {
    return json(
      { error: "The assistant has spoken enough for a while.", fallback: "device" },
      429,
      { "Retry-After": String(wait) }
    );
  }

  try {
    const audio = await synthesizeSpeech(sentence, voice);
    return new NextResponse(audio as BodyInit, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof VoiceUnavailableError) {
      return json({ error: error.message, fallback: "device" }, 503);
    }
    if (error instanceof VoiceProviderRefusedError) {
      return json({ error: error.message, fallback: "device" }, 502);
    }
    // The name only: a message from outside these two classes is the provider's,
    // and a provider's message can quote the sentence it was given.
    console.error("[assistant-speak] synthesis failed:", error instanceof Error ? error.name : "unknown error");
    return json({ error: "The voice provider did not answer.", fallback: "device" }, 502);
  }
}
