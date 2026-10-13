import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Reads `app_settings` for code that has no user session — API routes, cron
 * sweeps and post-response `after()` work all resolve on the service-role
 * client, the same way `whatsapp-dispatch` and the screening engine do.
 *
 * Writes stay gated on `settings.manage_platform` (see
 * `src/app/(admin)/settings/actions.ts`); this module only reads.
 */
export async function readGlobalSettings(keys: string[]): Promise<Map<string, unknown>> {
  if (keys.length === 0) return new Map();

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("scope", "GLOBAL")
    .in("key", keys);

  return new Map((data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
}

/**
 * A number the platform can act on. A missing row, a string from an old
 * import, or a non-finite value all fall back to the shipped default, so a
 * bad row can never make a decision disappear.
 */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const settings = await readGlobalSettings([key]);
  return coerceNumber(settings.get(key), fallback);
}

export function coerceNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const settings = await readGlobalSettings([key]);
  const value = settings.get(key);
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

export async function getStringSetting(key: string, fallback: string): Promise<string> {
  const settings = await readGlobalSettings([key]);
  const value = settings.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
