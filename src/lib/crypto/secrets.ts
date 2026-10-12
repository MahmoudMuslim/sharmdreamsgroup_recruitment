import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

/**
 * Envelope encryption for provider credentials.
 *
 * AES-256-GCM in a 32-byte key derived from SETTINGS_ENCRYPTION_KEY. The stored
 * blob is `base64( iv(12) || ciphertext || authTag(16) )` — GCM authenticates
 * as well as encrypts, so a tampered row fails to decrypt rather than silently
 * returning garbage credentials.
 *
 * This module is `server-only`: importing it from a Client Component is a
 * build error, which is the guarantee that secrets never enter the bundle.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      "SETTINGS_ENCRYPTION_KEY is not configured. Add a 32+ character value to .env.local " +
        "before storing credentials (see scripts/generate-encryption-key.mjs)."
    );
    this.name = "EncryptionUnavailableError";
  }
}

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();

  if (!raw || raw.length < 32) {
    throw new EncryptionUnavailableError();
  }

  // Hashing means any passphrase of sufficient length is accepted, not just a
  // pre-generated 32-byte value — while still producing a full-length key.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  return Boolean(raw && raw.length >= 32);
}

/** Encrypts a secret for storage. Never log or return the input. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/** Decrypts a stored blob. Throws if the ciphertext was tampered with. */
export function decryptSecret(blob: string): string {
  const key = getKey();
  const raw = Buffer.from(blob, "base64");

  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("[crypto] Stored credential is malformed");
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Display hint for a secret.
 *
 * Deliberately reveals only the final 4 characters. Secrets shorter than 12
 * characters yield a full mask rather than leaking most of a short value.
 */
export function secretHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length < 12) return "•".repeat(8);
  return `••••••••${trimmed.slice(-4)}`;
}