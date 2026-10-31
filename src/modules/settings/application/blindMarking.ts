import "server-only";

import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";

/**
 * Whether staff read an ungraded paper without the candidate's name.
 *
 * `security.blind_marking` is the switch, and it is **off** by default: a name is
 * how a recruiter finds a person again, so hiding it is a practice a company
 * chooses, not a rule imposed on the portal. Nothing here asks who is signed in —
 * unlike score masking, which a role permission can override, blind marking is a
 * house rule that applies to every reader, because the bias it guards against is
 * not one a senior role is immune to.
 *
 * Callers apply it where the rows are built, the same way masking does: the name
 * is then never sent to the browser, so it cannot be read from the page source or
 * quoted back by an AI answer that got the same fields.
 */
export async function blindMarkingEnabled(): Promise<boolean> {
  return getBoolSetting("security.blind_marking", false);
}
