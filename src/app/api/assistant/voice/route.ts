import { NextResponse } from "next/server";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import {
  RecordingNotTranscribableError,
  transcribeRecording,
} from "@/modules/screening/infrastructure/aiGateway";

/**
 * Speech in, text out — and nothing else.
 *
 * The staff assistant's microphone is the one place audio enters this app that
 * is not a candidate's pitch. It is transcribed and discarded: no bucket, no
 * row, no log, no attachment. The transcript goes back to the browser, and only
 * a turn the person sends is saved, exactly as if they had typed it.
 *
 * The rate window below is per process and in memory, so it resets with the
 * process and does not span hosts. It is a cost guard, not a security boundary;
 * the provider's own quota is the backstop.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TOO_LARGE = "That recording is larger than 8 MB.";
const READABLE_TYPES = new Set(["audio/webm", "audio/ogg"]);
const WINDOW_MS = 5 * 60_000;
const MAX_UTTERANCES = 20;

const recentUtterances = new Map<string, number[]>();

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** The wait a 429 reports in words, from the same number the header carries. */
function waitWords(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Seconds until this profile may speak again, or null when it is under budget. */
function retryAfter(profileId: string): number | null {
  const now = Date.now();
  const recent = (recentUtterances.get(profileId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_UTTERANCES) {
    recentUtterances.set(profileId, recent);
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
  }
  recent.push(now);
  recentUtterances.set(profileId, recent);
  return null;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return json({ error: "Sign in as staff to dictate." }, 401);
  }

  // Behind the staff gate and before formData(): an anonymous caller is refused
  // for being anonymous, not for its Content-Length — the order the sibling
  // upload door explains — and nothing has buffered the body yet either way.
  const oversize = oversizeUploadResponse(request, MAX_BYTES, TOO_LARGE);
  if (oversize) return oversize;

  const form = await request.formData().catch(() => null);
  const recording = form?.get("audio");
  // A zero-byte part is not a recording a model can hear: sent on, it surfaces as
  // a provider failure to answer. The sibling upload door refuses one the same way.
  if (!recording || !(recording instanceof Blob) || recording.size === 0) {
    return json({ error: "A recording is required." }, 400);
  }
  // The real ceiling: a client that declares a small length and streams more —
  // or sends a chunked body with no length at all — is only caught here.
  if (recording.size > MAX_BYTES) return json({ error: TOO_LARGE }, 413);

  // MediaRecorder stamps `audio/webm;codecs=opus`; the provider takes the
  // container, and accepting the codec parameter here would let two spellings of
  // the same container disagree between the client and the door.
  const mime = (recording.type || "").split(";")[0].trim().toLowerCase();
  if (!READABLE_TYPES.has(mime)) {
    return json(
      {
        error:
          mime === "audio/mp4" || mime === "audio/aac"
            ? "This browser records in a format the transcription model cannot read — type it instead."
            : "That is not a recording this assistant can transcribe.",
      },
      415
    );
  }

  // Only a well-formed request spends the window: twenty wrong-container tries or
  // twenty bodies with no `audio` part must not lock a staff member out. Charged
  // before the provider call, and keyed by profile.
  const wait = retryAfter(user.profileId);
  if (wait !== null) {
    return json(
      // The sentence is derived from the same seconds the header carries, so a
      // 429 never tells the caller "a minute" while Retry-After says five.
      { error: `That is a lot of dictation at once. Try again in ${waitWords(wait)}.` },
      429,
      { "Retry-After": String(wait) }
    );
  }

  try {
    const bytes = new Uint8Array(await recording.arrayBuffer());
    const text = await transcribeRecording(bytes, mime);
    return json({ text }, 200);
  } catch (error) {
    if (error instanceof RecordingNotTranscribableError) {
      // Two refusals wear this class: a missing key, which Settings → API keys
      // fixes, and a recording above the gateway's inline cap, which no setting
      // fixes. The pointer is only offered where it is true of the refusal.
      const needsKey = /key/i.test(error.message);
      return json(
        {
          error: needsKey
            ? `${error.message} Add the key in Settings → API keys, or type the question instead.`
            : `${error.message} Record a shorter clip, or type the question instead.`,
        },
        503
      );
    }
    // The provider's own message can carry up to 200 characters of the upstream
    // response body, so it is deliberately dropped: the log carries a fixed tag
    // and the error's name, never the message, never the body.
    console.error(
      "[assistant-voice] transcription failed:",
      error instanceof Error ? error.name : "unknown error"
    );
    return json({ error: "The transcription model did not answer. Type the question instead." }, 502);
  }
}
