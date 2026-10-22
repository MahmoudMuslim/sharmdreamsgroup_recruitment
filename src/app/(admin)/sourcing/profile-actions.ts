"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { describeExtractionFailure as describeParseFailure, extractCvText } from "@/modules/screening/infrastructure/cvParser";
import { normalizeProspectProfile, profileIsEmpty, type ProspectProfile } from "@/modules/sourcing/domain/prospect-profile";
import {
  isWorthExtracting,
  profileTextFromPaste,
  readProfileFromUrl,
  type ProfileRead,
} from "@/modules/sourcing/infrastructure/profile-reader";
import { describeExtractionFailure, extractProfile } from "@/modules/sourcing/infrastructure/profile-extract";
import { normalizeLinkedInUrl } from "@/modules/sourcing/domain/prospect-import";
import { recordActivity } from "@/modules/activity/application/record";

/**
 * Reading a prospect's full profile.
 *
 * Three doors, one result: a link fetched from the server, text a recruiter
 * copied out of a page they are allowed to see, or an export they downloaded and
 * uploaded. All three end in the same structured profile on the prospect row, and
 * each records which door it came through, because "read from a GitHub link" and
 * "pasted off LinkedIn" mean very different things about how current the data is.
 *
 * Writes are gated on `candidates.write`, the same permission that already owns
 * this table, and every write goes through the session's RLS-scoped client rather
 * than the service role.
 */

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

export interface ProfileReadResult {
  ok: boolean;
  profile?: ProspectProfile;
  /** Why nothing was stored, phrased for a recruiter. */
  error?: string;
  /** What to do instead, when there is a specific alternative. */
  hint?: string;
  /** How the stored profile was obtained. */
  source?: ProfileSource;
  detail?: string;
}

export type ProfileSource = "URL" | "PASTE" | "FILE";

export interface StoredProspectProfile {
  profile: ProspectProfile | null;
  source: ProfileSource | null;
  captured_at: string | null;
  error: string | null;
  profile_url: string | null;
  linkedin_url: string | null;
  full_name: string;
  headline: string | null;
  company: string | null;
}

const PROFILE_COLUMNS =
  "profile, profile_url, profile_source, profile_captured_at, profile_error, full_name, headline, company, linkedin_url";

interface ProspectProfileRecord {
  profile: unknown;
  profile_url: string | null;
  profile_source: string | null;
  profile_captured_at: string | null;
  profile_error: string | null;
  full_name: string;
  headline: string | null;
  company: string | null;
  linkedin_url: string | null;
}

function asSource(value: unknown): ProfileSource | null {
  return value === "URL" || value === "PASTE" || value === "FILE" ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Read the stored profile                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The profile belongs to the drawer rather than the board: one prospect's jsonb is
 * a few kilobytes, and fifty of them on every list render is not a price worth
 * paying for a section most rows never have.
 */
export async function getProspectProfile(id: string): Promise<StoredProspectProfile | null> {
  await requireStaff("/sourcing");

  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("sourced_prospects")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as ProspectProfileRecord;
  return {
    profile: row.profile ? normalizeProspectProfile(row.profile) : null,
    source: asSource(row.profile_source),
    captured_at: row.profile_captured_at,
    error: row.profile_error,
    profile_url: row.profile_url,
    linkedin_url: row.linkedin_url,
    full_name: row.full_name,
    headline: row.headline,
    company: row.company,
  };
}

/* -------------------------------------------------------------------------- */
/* Shared write path                                                           */
/* -------------------------------------------------------------------------- */

async function canWriteProspects(): Promise<boolean> {
  return hasPermissionForUser("candidates.write");
}

type ProspectAnchor = { full_name: string; headline: string | null; company: string | null };

const PROFILE_DOOR: Record<ProfileSource, string> = {
  URL: "a fetched link",
  PASTE: "pasted text",
  FILE: "an uploaded export",
};

/** `4 roles, 2 degrees, 18 skills` — how much a captured profile actually holds. */
function profileTally(profile: ProspectProfile): string {
  const parts: [number, string][] = [
    [profile.experience.length, "role"],
    [profile.education.length, "degree"],
    [profile.certifications.length, "certification"],
    [profile.projects.length, "project"],
    [profile.skills.length, "skill"],
    [profile.languages.length, "language"],
  ];
  const kept = parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? "" : "s"}`);
  return kept.length ? kept.slice(0, 4).join(", ") : "no sections filled";
}

/**
 * Stores a fresh read and clears any earlier refusal.
 *
 * The old profile is replaced rather than merged: a profile is a snapshot of a
 * page, and stitching two snapshots from different dates produces a record that
 * matches neither.
 */
async function storeProfile(
  restClient: StaffClient,
  id: string,
  input: {
    profile: ProspectProfile;
    source: ProfileSource;
    profile_url?: string | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    profile: input.profile,
    profile_source: input.source,
    profile_captured_at: new Date().toISOString(),
    profile_error: null,
  };
  if (input.profile_url !== undefined) payload.profile_url = input.profile_url;

  // Reading the name back doubles as the existence check: an update that matched
  // no row is reported as a success by PostgREST, so a prospect deleted mid-read
  // would otherwise be recorded as saved.
  const { data, error } = await restClient
    .from("sourced_prospects")
    .update(payload)
    .eq("id", id)
    .select("full_name")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That prospect is no longer in the pool." };

  const name = String((data as { full_name: string }).full_name);
  const profile = input.profile;
  await recordActivity({
    area: "sourcing",
    action: "prospect_profile",
    entity: "prospect",
    entityId: id,
    summary: `Captured ${name}'s profile from ${PROFILE_DOOR[input.source]} — ${profileTally(profile)}`,
    detail: {
      door: input.source,
      profile_url: input.profile_url ?? null,
      model: profile.model,
      experience: profile.experience.length,
      education: profile.education.length,
      certifications: profile.certifications.length,
      projects: profile.projects.length,
      skills: profile.skills.length,
      languages: profile.languages.length,
      links: profile.links.length,
    },
  });

  revalidatePath("/sourcing");
  return { ok: true };
}

/**
 * Records a refusal so the drawer can show it.
 *
 * A blocked read is stored, not just returned: a recruiter who comes back tomorrow
 * should see "LinkedIn answered HTTP 999" against that prospect instead of an
 * unexplained empty section, and the last successful profile stays until a newer
 * one replaces it.
 */
async function storeRefusal(restClient: StaffClient, id: string, reason: string): Promise<void> {
  const { data } = await restClient
    .from("sourced_prospects")
    .update({ profile_error: reason.slice(0, 600) })
    .eq("id", id)
    .select("full_name")
    .maybeSingle();

  if (data) {
    await recordActivity({
      area: "sourcing",
      action: "prospect_profile_blocked",
      entity: "prospect",
      entityId: id,
      summary: `A profile read for ${String((data as { full_name: string }).full_name)} came back empty — ${reason.slice(0, 160)}`,
      detail: { reason: reason.slice(0, 240) },
    });
  }

  revalidatePath("/sourcing");
}

/** Runs the model over whatever a door produced, then stores the result. */
async function structureAndStore(
  restClient: StaffClient,
  id: string,
  read: ProfileRead,
  anchor: ProspectAnchor,
  source: ProfileSource,
  profileUrl?: string | null
): Promise<ProfileReadResult> {
  let profile: ProspectProfile;
  try {
    profile = await extractProfile(read.text, {
      name: anchor.full_name,
      company: anchor.company,
      headline: anchor.headline,
      source: read.detail,
    });
  } catch (error) {
    return { ok: false, error: describeExtractionFailure(error) };
  }

  if (profileIsEmpty(profile)) {
    return {
      ok: false,
      error: `Nothing readable about this person came out of ${read.detail}.`,
      hint: "The page may be mostly navigation. Paste the section that holds their history instead.",
    };
  }

  const stored = await storeProfile(restClient, id, { profile, source, profile_url: profileUrl });
  if (!stored.ok) return { ok: false, error: stored.error };

  return { ok: true, profile, source, detail: read.detail };
}

/* -------------------------------------------------------------------------- */
/* Door 1 — fetch the link                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reads a prospect from a public page.
 *
 * The link defaults to the one already on the row: a profile URL a recruiter
 * filed, or the LinkedIn address the pool was imported from. Passing a URL here
 * also saves it, so a GitHub or personal site link read once is remembered.
 */
export async function readProspectProfile(input: {
  id: string;
  url?: string;
}): Promise<ProfileReadResult> {
  await requireStaff("/sourcing");

  if (!(await canWriteProspects())) {
    return { ok: false, error: "You need the Manage candidates permission to read profiles." };
  }

  const restClient = await createServerRestClient();
  const { data } = await restClient
    .from("sourced_prospects")
    .select(PROFILE_COLUMNS)
    .eq("id", input.id)
    .maybeSingle();

  const row = data as unknown as ProspectProfileRecord | null;
  if (!row) return { ok: false, error: "That prospect is no longer in the pool." };

  const candidate = (input.url ?? row.profile_url ?? row.linkedin_url ?? "").trim();
  if (!candidate) {
    return {
      ok: false,
      error: "There is no link on this prospect to read.",
      hint: "Add a profile URL, or paste their history in through “Pasted text”.",
    };
  }

  const read = await readProfileFromUrl(candidate);

  if (!isWorthExtracting(read)) {
    const refusal = "ok" in read ? read : { reason: "", hint: "" };
    if (refusal.reason) await storeRefusal(restClient, input.id, refusal.reason);
    return {
      ok: false,
      error: refusal.reason || "That page held no text worth reading.",
      hint: refusal.hint,
    };
  }

  return structureAndStore(restClient, input.id, read, row, "URL", normalizeStoredUrl(candidate));
}

/* -------------------------------------------------------------------------- */
/* Door 2 — paste the page                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Structures text the recruiter copied out of a profile.
 *
 * This is the door that always works, and the one a LinkedIn profile needs: the
 * page is behind a login for any automated request, but the recruiter is looking
 * at it. Nothing is scraped on their behalf — the text is theirs, and only the
 * structuring is automated.
 */
export async function pasteProspectProfile(input: {
  id: string;
  text: string;
}): Promise<ProfileReadResult> {
  await requireStaff("/sourcing");

  if (!(await canWriteProspects())) {
    return { ok: false, error: "You need the Manage candidates permission to read profiles." };
  }

  const trimmed = input.text.trim();
  if (trimmed.length < 120) {
    return {
      ok: false,
      error: "That is too little text to read a profile out of.",
      hint: "Select the whole page — history, education, certifications, skills — and paste it.",
    };
  }

  const restClient = await createServerRestClient();
  const { data } = await restClient
    .from("sourced_prospects")
    .select(PROFILE_COLUMNS)
    .eq("id", input.id)
    .maybeSingle();

  const row = data as unknown as ProspectProfileRecord | null;
  if (!row) return { ok: false, error: "That prospect is no longer in the pool." };

  return structureAndStore(restClient, input.id, profileTextFromPaste(trimmed), row, "PASTE");
}

/* -------------------------------------------------------------------------- */
/* Door 3 — upload an export                                                   */
/* -------------------------------------------------------------------------- */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const UPLOAD_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

/**
 * Reads the declared type, falling back to the extension.
 *
 * LinkedIn's "Save to PDF" produces a real `application/pdf`, but a browser is
 * inconsistent about what it labels a `.txt`/`.md` file, and a saved LinkedIn
 * PDF sometimes arrives with an empty type. Refusing those would refuse the one
 * export path this door exists for.
 */
function uploadMimeType(name: string, declared: string): string {
  const kind = declared.trim().toLowerCase();
  if (kind === "text/markdown") return "text/plain";
  if (kind && UPLOAD_TYPES.has(kind)) return kind;
  if (/\.(md|txt)$/i.test(name)) return "text/plain";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.docx?$/i.test(name)) {
    return /\.docx$/i.test(name)
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/msword";
  }
  return kind;
}

/**
 * Structures an uploaded profile — LinkedIn "Save to PDF", a CV, an export.
 *
 * Parsing reuses the same PDF/Word/plain-text extractor the screening engine
 * uses, so a document reads identically here and on the apply form. Only the
 * text crosses into the model; the file is not stored.
 */
export async function uploadProspectProfile(formData: FormData): Promise<ProfileReadResult> {
  await requireStaff("/sourcing");

  if (!(await canWriteProspects())) {
    return { ok: false, error: "You need the Manage candidates permission to read profiles." };
  }

  const id = formData.get("id");
  const entry = formData.get("file");

  if (typeof id !== "string" || !id) return { ok: false, error: "Missing prospect reference." };
  if (!(entry instanceof File)) return { ok: false, error: "No file was received." };
  if (entry.size === 0) return { ok: false, error: "That file is empty." };
  if (entry.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than 8 MB." };
  }

  const mimeType = uploadMimeType(entry.name, entry.type);
  if (!UPLOAD_TYPES.has(mimeType)) {
    return {
      ok: false,
      error: "Attach a PDF, Word document or plain-text export.",
      hint: "On LinkedIn, use “… → Save to PDF”, then upload the file.",
    };
  }

  const restClient = await createServerRestClient();
  const { data } = await restClient
    .from("sourced_prospects")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  const row = data as unknown as ProspectProfileRecord | null;
  if (!row) return { ok: false, error: "That prospect is no longer in the pool." };

  let read: ProfileRead;
  try {
    const extracted = await extractCvText(Buffer.from(await entry.arrayBuffer()), mimeType);
    read = {
      text: extracted.text,
      detail: `${extracted.method === "pdf" ? "PDF" : extracted.method === "docx" ? "Word" : "text"} export “${entry.name.slice(-60)}”`,
      host: "upload",
    };
  } catch (error) {
    return { ok: false, error: describeParseFailure(error) };
  }

  // The same floor the other doors use, applied directly: this read cannot
  // come back blocked, it either held text or it did not.
  if (read.text.trim().length < 120) {
    await storeRefusal(restClient, id, `No readable text came out of ${read.detail}.`);
    return {
      ok: false,
      error: `No readable text came out of ${read.detail}.`,
      hint: "A scanned page has no text layer. Select and copy the section instead, or paste the profile text.",
    };
  }

  return structureAndStore(restClient, id, read, row, "FILE");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Keeps a stored link canonical.
 *
 * A LinkedIn address goes through the pool's own normaliser, so the same person
 * does not end up with two spellings of one profile. Any other host is stored
 * trimmed and clipped — there is no rule to canonicalise a personal site by.
 */
function normalizeStoredUrl(raw: string): string | null {
  const value = raw.trim();
  const linkedin = normalizeLinkedInUrl(value);
  if (linkedin) return linkedin;
  return value ? value.slice(0, 400) : null;
}
