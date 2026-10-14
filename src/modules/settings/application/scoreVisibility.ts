import "server-only";

import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";
import { permissionsForCurrentUser } from "@/modules/settings/infrastructure/permissions";

/**
 * Whether AI and assessment scores must be hidden from the signed-in staff member.
 *
 * `security.mask_scores_for_reviewers` switches the rule on, and
 * `scores.view_unmasked` is the grant that overrides it — so a recruiter or
 * hiring manager loses the numbers while an admin keeps them.
 *
 * Callers apply this where rows are built rather than in JSX: a masked score is
 * then never sent to the browser, so it cannot be read from the page source or
 * an AI answer that quotes the same fields.
 */
export async function scoresAreMaskedForCurrentUser(): Promise<boolean> {
  const masking = await getBoolSetting("security.mask_scores_for_reviewers", true);
  if (!masking) return false;

  const permissions = await permissionsForCurrentUser();
  return !permissions.has("scores.view_unmasked");
}
