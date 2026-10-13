import "server-only";

import { getNumberSetting } from "@/modules/settings/infrastructure/settingsReader";

/** Seeded default; used when the settings row is missing or unusable. */
export const DEFAULT_LINK_VALIDITY_HOURS = 48;

/**
 * True when an invitation link is older than the window in
 * Settings → Assessments → Link validity.
 *
 * Measured from `created_at` — the moment the recruiter assigned the attempt —
 * because a `NOT_STARTED` link has no start time to measure against.
 */
export async function isLinkExpired(issuedAt: string | null | undefined): Promise<boolean> {
  if (!issuedAt) return false;
  const issued = new Date(issuedAt).getTime();
  if (!Number.isFinite(issued)) return false;

  const hours = await getNumberSetting("assessment.link_validity_hours", DEFAULT_LINK_VALIDITY_HOURS);
  // A zero or negative window would expire every link on the day it is sent,
  // which is never what an admin means by the field.
  if (!(hours > 0)) return false;

  return Date.now() > issued + hours * 60 * 60 * 1000;
}
