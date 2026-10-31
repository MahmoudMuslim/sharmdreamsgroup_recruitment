import "server-only";

import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";
import { permissionsForCurrentUser } from "@/modules/settings/infrastructure/permissions";

/**
 * Whether AI and assessment scores must be hidden from the signed-in staff member.
 *
 * Two grants, read in that order: `candidates.view_scores` is the permission to
 * see scores at all, and only a member who holds it reaches the masking rule,
 * where `security.mask_scores_for_reviewers` switches the hiding on and
 * `scores.view_unmasked` is the grant that overrides it — so a recruiter or
 * hiring manager loses the numbers while an admin keeps them.
 *
 * The first check is what makes the matrix's "View scores" box mean something:
 * without it the switch and the override are the only two ways a score can be
 * hidden, and revoking the view grant would change nothing.
 *
 * Callers apply this where rows are built rather than in JSX: a masked score is
 * then never sent to the browser, so it cannot be read from the page source or
 * an AI answer that quotes the same fields.
 */
export async function scoresAreMaskedForCurrentUser(): Promise<boolean> {
  const permissions = await permissionsForCurrentUser();
  if (!permissions.has("candidates.view_scores")) return true;

  const masking = await getBoolSetting("security.mask_scores_for_reviewers", true);
  if (!masking) return false;

  return !permissions.has("scores.view_unmasked");
}
