"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import type { Locale } from "@/core/entities";
import {
  MAX_TRANSLATION_KEYS,
  draftTranslations,
} from "../infrastructure/aiTranslate";
import {
  TRANSLATION_LOCALES,
  isTranslationLocale,
  overridesKey,
  parseOverrideMap,
  planEdits,
  type DraftTranslationsResult,
  type SaveTranslationsResult,
  type TranslationEdit,
  type TranslationLocale,
} from "../domain/translations";

/**
 * The two writes the Languages console makes: store a screen of reviewed wording,
 * and ask a model for a draft of some.
 *
 * Both are guarded by `settings.manage_platform` for the same reason the settings
 * console is: RLS refuses an UPDATE on `app_settings` without that permission and
 * returns no error at all, so a save that skipped this check would read as a
 * success while changing nothing.
 *
 * The stored shape is one JSONB map per language under `i18n.<locale>`, which is
 * what `parseOverrideMap` and the reader already speak. A save rebuilds the whole
 * map from what is stored plus what moved, so clearing a field drops the key
 * rather than leaving an empty string that would blank a button.
 */

/**
 * `app_settings.updated_by` and `settings_audit_log.changed_by` both reference
 * `user_profiles(id)`, not the auth id, so the session user has to be resolved to
 * their profile row before either column can name them.
 */
async function staffProfileId(
  restClient: Awaited<ReturnType<typeof createServerRestClient>>,
  authUserId: string
): Promise<string | null> {
  const { data } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The machine-readable list of languages this console stores wording for. */
function storedKeys(): string[] {
  return TRANSLATION_LOCALES.map((locale) => overridesKey(locale));
}

/**
 * Store a batch of reviewed wording.
 *
 * Every edit is checked first and the whole save is refused if any of it would
 * break a `{placeholder}` or read past the length ceiling — a console that wrote
 * the half it liked would leave a screen with a hole in it and no way to tell
 * which half landed. An edit that repeats what is already stored is dropped, not
 * refused, so resubmitting a screen of untouched fields writes nothing.
 */
export async function saveTranslations(
  edits: TranslationEdit[]
): Promise<SaveTranslationsResult> {
  const user = await requireStaff("/settings");

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return {
      ok: false,
      saved: 0,
      problems: [],
      error: "Editing interface wording requires the Manage platform settings permission.",
    };
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, saved: 0, problems: [], error: "No wording was supplied." };
  }

  // Drop rows for a language or key this console does not own before anything
  // else runs, so a crafted payload cannot reach the stored map.
  const valid = edits.filter(
    (edit) =>
      isTranslationLocale(edit?.locale) &&
      typeof edit.key === "string" &&
      edit.key.length > 0 &&
      typeof edit.text === "string"
  );

  if (valid.length === 0) {
    return { ok: false, saved: 0, problems: [], error: "No recognised wording was supplied." };
  }

  const restClient = await createServerRestClient();

  const { data: existing, error: readError } = await restClient
    .from("app_settings")
    .select("id, key, value")
    .eq("scope", "GLOBAL")
    .in("key", storedKeys());

  if (readError) {
    return { ok: false, saved: 0, problems: [], error: readError.message };
  }

  const rowByKey = new Map((existing ?? []).map((row) => [row.key, row]));
  const stored: Partial<Record<Locale, Record<string, string>>> = {};
  for (const locale of TRANSLATION_LOCALES) {
    stored[locale] = parseOverrideMap(rowByKey.get(overridesKey(locale))?.value);
  }

  const { writes, problems } = planEdits(valid, stored);

  if (problems.length > 0) {
    return { ok: false, saved: 0, problems, error: undefined };
  }

  // Nothing moved: a save is a success that wrote zero rows, not a refusal.
  if (writes.length === 0) {
    return { ok: true, saved: 0, problems: [], error: undefined };
  }

  const changedBy = await staffProfileId(restClient, user.authUserId);

  // Rebuild each touched language's whole map from the stored one, applying the
  // writes (an empty text removes the key so the shipped wording reads again).
  const touched = [...new Set(writes.map((write) => write.locale))];
  const nextMaps = new Map<TranslationLocale, Record<string, string>>();
  for (const locale of touched) {
    const map = { ...(stored[locale] ?? {}) };
    for (const write of writes) {
      if (write.locale !== locale) continue;
      if (write.text) map[write.key] = write.text;
      else delete map[write.key];
    }
    nextMaps.set(locale, map);
  }

  // Record the previous map before overwriting it, so the value is never lost.
  const { error: auditError } = await restClient.from("settings_audit_log").insert(
    [...nextMaps.entries()].map(([locale, map]) => ({
      key: overridesKey(locale),
      previous_value: stored[locale] ?? null,
      next_value: map,
      changed_by: changedBy,
    }))
  );
  if (auditError) {
    return { ok: false, saved: 0, problems: [], error: auditError.message };
  }

  // Split by whether the row exists, exactly as the settings writer does: a bulk
  // write with a missing id would send `id = NULL` and skip the column's
  // `gen_random_uuid()` default, which is a not-null violation.
  const updates: { id: string; scope: string; company_id: null; key: string; value: unknown; updated_by: string | null }[] = [];
  const inserts: { scope: string; company_id: null; key: string; value: unknown; updated_by: string | null }[] = [];
  for (const [locale, map] of nextMaps) {
    const key = overridesKey(locale);
    const row = rowByKey.get(key);
    if (row) {
      updates.push({ id: row.id, scope: "GLOBAL", company_id: null, key, value: map, updated_by: changedBy });
    } else {
      inserts.push({ scope: "GLOBAL", company_id: null, key, value: map, updated_by: changedBy });
    }
  }

  if (updates.length > 0) {
    const { error } = await restClient.from("app_settings").upsert(updates, { onConflict: "id" });
    if (error) return { ok: false, saved: 0, problems: [], error: error.message };
  }
  if (inserts.length > 0) {
    const { error } = await restClient.from("app_settings").insert(inserts);
    if (error) return { ok: false, saved: 0, problems: [], error: error.message };
  }

  // One row for the save, naming which keys moved without carrying the wording
  // itself — the trail is read by more roles than Settings is, and the before/
  // after of every label would be a second copy of the interface in the audit.
  const detail: Record<string, unknown> = {};
  for (const locale of touched) {
    const moved = writes.filter((write) => write.locale === locale);
    const names = moved.slice(0, 6).map((write) => write.key).join(", ");
    detail[`wording_${locale}`] = `${moved.length} key${
      moved.length === 1 ? "" : "s"
    }: ${names}${moved.length > 6 ? ", …" : ""}`;
  }
  await recordActivity({
    area: "settings",
    action: "translations_save",
    entity: "setting",
    entityId: overridesKey(touched[0]),
    summary: `Saved interface wording (${touched.join(", ")} — ${writes.length} key${
      writes.length === 1 ? "" : "s"
    })`,
    detail,
    actorId: changedBy,
  });

  revalidatePath("/settings");
  // The settings read is cached for everyone, so evict the tag: a word saved in
  // Settings has to be the word the next candidate reads, not the one from up to
  // five minutes ago.
  updateTag("app-settings");
  return { ok: true, saved: writes.length, problems: [], error: undefined };
}

/**
 * Ask the translation model for a draft of some wording, without storing it.
 *
 * The result only fills the console's fields; nothing reaches the database until a
 * person saves. A model that quietly wrote 400 strings would be indistinguishable
 * from an admin who reviewed them, and the trail would name the admin.
 *
 * English is the wording the build ships and the fallback every language reads, so
 * there is nothing to draft into it — the console only offers this for the other
 * language.
 */
export async function draftInterfaceWording(
  target: string,
  pairs: { key: string; text: string }[]
): Promise<DraftTranslationsResult> {
  await requireStaff("/settings");

  const empty = (error: string): DraftTranslationsResult => ({
    ok: false,
    drafts: [],
    unanswered: [],
    model: null,
    error,
  });

  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return empty("Drafting wording requires the Manage platform settings permission.");
  }
  if (!isTranslationLocale(target)) return empty("That language is not one this console edits.");
  if (target === "en") return empty("English is the wording this build ships, so there is nothing to draft into it.");

  const clean = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => typeof pair?.key === "string" && pair.key && typeof pair.text === "string" && pair.text.trim())
    .slice(0, MAX_TRANSLATION_KEYS);

  if (clean.length === 0) return empty("There was no wording to translate.");

  const run = await draftTranslations(target, clean);
  return {
    ok: run.drafts.length > 0,
    drafts: run.drafts,
    unanswered: run.unanswered,
    model: run.model,
    error: run.error ?? undefined,
  };
}
