import "server-only";

import { resolveConfig, resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";

/**
 * The neural voice: one sentence in, mp3 bytes out.
 *
 * This is the only path in the portal that asks a text-to-speech provider for
 * audio, and it is deliberately small. Two facts shape it:
 *
 * - **The key is never repeated.** Nothing here puts a credential into an error,
 *   a log or a cache entry, and an upstream failure is answered with this
 *   module's own sentence rather than the provider's, because an upstream body
 *   can quote the text it was given — and that text is what the assistant said out
 *   loud in an office.
 * - **A sentence is paid for once.** The orb speaks the same few lines all day
 *   ("Listening", the briefing opener), and a briefing is three sentences a
 *   person may re-hear, so the clip is cached by voice and text. A failure is
 *   never cached: one outage must not freeze a sentence for the life of the
 *   process.
 *
 * When there is no key, or no voice this provider recognises, this module says so
 * with `VoiceUnavailableError` and the door above turns that into a 503 the browser
 * can act on. The device voice is then a choice the person's own machine makes,
 * not a silent substitution.
 */

/** The provider's own credentials, resolved through the portal's registry. */
const PROVIDER = "elevenlabs";

/** The longest sentence worth synthesising: three briefing lines, with room. */
export const MAX_SPEECH_TEXT = 800;

/**
 * The shape of a real ElevenLabs voice id.
 *
 * The `voice` column of 047 is a name the person typed or left at its default —
 * "jarvis", "clara", "حليم". A name is not an identifier, and sending one as a
 * request path would be a guess at somebody's account. So the id comes from the
 * portal's own configuration, and a value in that field is used only if it is
 * already shaped like one.
 */
const VOICE_ID = /^[A-Za-z0-9]{16,32}$/;

const CACHE_MAX_SENTENCES = 48;
const TIMEOUT_MS = 15_000;

/** No key, no voice id, nothing to say. The client falls back deliberately. */
export class VoiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}

/** The provider answered, or did not answer at all. */
export class VoiceProviderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceProviderRefusedError";
  }
}

const cache = new Map<string, Uint8Array>();

/** A short, stable key for one sentence, so the text itself is never a map key. */
function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x1000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/**
 * The voice to ask the provider for, or null when there is none.
 *
 * Three sources, most deliberate first: the id typed in Settings → API keys, the
 * deployment's `ELEVENLABS_VOICE_ID`, and a preferences value that happens to be
 * shaped like an id. Read per call rather than at import so a key or a voice added
 * in Settings takes effect without a restart, and so this module can be proved
 * without a process environment at all.
 */
export async function voiceId(requested: unknown): Promise<string | null> {
  const config = await resolveConfig(PROVIDER);
  const fromConfig = String(config.voice_id ?? "").trim();
  if (VOICE_ID.test(fromConfig)) return fromConfig;
  const fromEnv = (process.env.ELEVENLABS_VOICE_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  const name = typeof requested === "string" ? requested.trim() : "";
  return VOICE_ID.test(name) ? name : null;
}

async function requestAudio(
  text: string,
  id: string,
  key: string
): Promise<Uint8Array> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    // The status is the whole of what is reported: an upstream body can quote the
    // sentence it was handed, and a quota message can name the account.
    throw new VoiceProviderRefusedError(
      response.status === 401 || response.status === 403
        ? "The voice provider rejected this portal's key."
        : response.status === 429
          ? "The voice provider is busy — this portal has reached its quota."
          : `The voice provider answered HTTP ${response.status}.`
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new VoiceProviderRefusedError("The voice provider answered with no audio.");
  return bytes;
}

/**
 * One sentence, as mp3.
 *
 * Throws `VoiceUnavailableError` when this portal has no neural voice to ask —
 * that is a state the browser can act on — and `VoiceProviderRefusedError` when
 * it has one and it did not deliver. Neither message carries the key or the
 * sentence.
 */
export async function synthesizeSpeech(text: unknown, voice?: unknown): Promise<Uint8Array> {
  const sentence = typeof text === "string" ? text.trim() : "";
  if (!sentence) throw new VoiceUnavailableError("There is nothing to say.");
  if (sentence.length > MAX_SPEECH_TEXT) {
    throw new VoiceUnavailableError(`That is longer than ${MAX_SPEECH_TEXT} characters.`);
  }

  const name = typeof voice === "string" && voice.trim() ? voice.trim() : "jarvis";
  const cached = cache.get(`${name}\u0000${hashText(sentence)}`);
  if (cached) return cached;

  const key = await resolveSecret(PROVIDER);
  if (!key) {
    throw new VoiceUnavailableError(
      "No text-to-speech key is configured. Add one in Settings → API keys, or use the device voice."
    );
  }

  const id = await voiceId(name);
  if (!id) {
    throw new VoiceUnavailableError(
      "No voice id is configured for the neural voice. Set ELEVENLABS_VOICE_ID to a voice from your own ElevenLabs account."
    );
  }

  let audio: Uint8Array;
  try {
    audio = await requestAudio(sentence, id, key);
  } catch (cause) {
    if (cause instanceof VoiceProviderRefusedError || cause instanceof VoiceUnavailableError) throw cause;
    // An abort, a DNS failure or a socket error can carry part of the request in
    // its message. It is replaced, not summarised.
    throw new VoiceProviderRefusedError("The voice provider did not answer.");
  }

  if (cache.size >= CACHE_MAX_SENTENCES) {
    // Insertion order is the oldest first: a sentence nobody has asked for in the
    // last few hundred is the one worth re-synthesising.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(`${name}\u0000${hashText(sentence)}`, audio);
  return audio;
}
