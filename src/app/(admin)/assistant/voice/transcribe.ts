"use client";

/**
 * The only client call to the transcription route.
 *
 * Returns words or a sentence a recruiter can act on. A transport failure and a
 * refusal are the same shape on purpose: both leave the composer untouched, so
 * nothing is inserted that was never heard.
 */
export async function transcribeClip(
  clip: Blob
): Promise<{ text: string } | { error: string }> {
  const body = new FormData();
  const extension = clip.type.includes("ogg") ? "ogg" : "webm";
  body.append("audio", clip, `clip.${extension}`);

  try {
    const response = await fetch("/api/assistant/voice", { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as
      | { text?: unknown; error?: unknown }
      | null;

    if (!response.ok) {
      return {
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "That recording could not be transcribed.",
      };
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    return text ? { text } : { error: "Nothing was heard — try again." };
  } catch {
    return { error: "The recording could not be sent. Check the connection and try again." };
  }
}
