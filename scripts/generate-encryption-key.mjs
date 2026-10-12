#!/usr/bin/env node
/**
 * Generates a SETTINGS_ENCRYPTION_KEY for .env.local.
 *
 * Run once:  node scripts/generate-encryption-key.mjs
 *
 * Losing this key makes every stored credential permanently unreadable, so keep
 * a copy in your password manager — it is not recoverable from the database.
 */
import { randomBytes } from "crypto";

const key = randomBytes(48).toString("base64url");

console.log("");
console.log("Add this line to .env.local (and to your production secret store):");
console.log("");
console.log(`SETTINGS_ENCRYPTION_KEY=${key}`);
console.log("");
console.log("This key encrypts every provider credential. If you lose it, stored");
console.log("API keys cannot be recovered — you would have to re-enter them all.");
console.log("");