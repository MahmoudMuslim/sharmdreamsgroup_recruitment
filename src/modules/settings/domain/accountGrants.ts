import type { PermissionKey } from "./types";

/**
 * What one account holds, once its own lines are read against its role.
 *
 * `role_permissions` answers "what may a recruiter do" and cannot answer "what
 * may *this* recruiter do": the row is keyed by role, so a company that needs
 * one recruiter out of the payroll-shaped reports would have to invent a role for
 * that one person. 048's `user_permission_overrides` keys a line by the person
 * instead, and this module decides what the two sets mean together.
 *
 * Four rules hold it, and they are the four that a merge written in a hurry gets
 * wrong.
 *
 *   1. **The role is the floor; the lines are the delta.** A `false` takes away
 *      what the role grants and a `true` gives what it withholds, so the revoke
 *      box in the console decides something. The absence of a line is the role
 *      standing exactly as seeded — there is no "default override" to invent.
 *   2. **A role set is shared, so it is never the thing you edit.** The grants for
 *      `RECRUITER` come out of a cross-request cache every recruiter reads
 *      through, which means `role.delete(key)` would revoke that permission for
 *      the whole company as soon as one member's line loaded. Every function here
 *      builds a new set and treats the one it was handed as read-only, and the
 *      proof aims a mutation at exactly that line.
 *   3. **A revocation that fails to load is not a permission.** Deciding that an
 *      unreadable per-account layer means "the role stands" would hand back
 *      precisely the access somebody switched off. Nothing about the account is
 *      provable in that state, so nothing is granted — the same answer the role
 *      read already gives when its own query fails.
 *   4. **"No table" and "table on error" are different facts.** Before 048 is
 *      applied there is nothing to read and every account is its role; after it is
 *      applied, an error means a decision could not be consulted. A caller that
 *      only receives a Set cannot tell those apart, and neither can the sentence
 *      the Team console prints, so the state travels with the set.
 *
 * The rest of the file is the door and the panel that sit on those rules: the three
 * fences 048's policies enforce are re-read before a write is attempted, the editor
 * draws the catalogue rather than the lines so a member can see what the role
 * already decided, and the trail names a cleared line as a return to the role
 * instead of a revocation.
 */

/** The table 048 creates, named once here so a reader and the DDL cannot drift. */
export const PERMISSION_OVERRIDES_TABLE = "user_permission_overrides";

/**
 * Whether a failed read means the table is not there, rather than unreachable.
 *
 * Both readers of the layer have to answer this — the resolver that decides what
 * the account holds, and the console that lists a member's lines — and the answer
 * picks which of two very different sentences gets printed. A second copy of the
 * pattern is where the two start disagreeing, so there is one here.
 */
export function isMissingTable(report: string): boolean {
  return /42P01|PGRST205|PGRST204|does not exist|schema cache/i.test(report);
}

/** The file that creates it, for copy that has to say which database this is. */
export const PERMISSION_OVERRIDES_MIGRATION = "db/migrations/048_user_permission_overrides.sql";

/** One line of that table, as the resolver receives it. */
export interface PermissionOverride {
  permissionKey: PermissionKey;
  granted: boolean;
}

/** Whether the per-account layer could be consulted, as the reader found it. */
export type OverrideSource = "applied" | "absent" | "unreadable";

/** What one account holds, and how much of that answer the lines carried. */
export interface ResolvedGrants {
  granted: Set<PermissionKey>;
  overrides: number;
  source: OverrideSource;
}

/**
 * The role's permissions with one account's lines applied over them.
 *
 * Never mutates `role`, and never returns it: the caller keeps a set it is free to
 * widen, compare or drop without touching what every other member reads through.
 */
export function mergeGrants(
  role: ReadonlySet<PermissionKey>,
  rows: readonly PermissionOverride[]
): Set<PermissionKey> {
  const merged = new Set(role);
  for (const row of rows) {
    if (row.granted) merged.add(row.permissionKey);
    else merged.delete(row.permissionKey);
  }
  return merged;
}

/**
 * The whole answer for one account: the set, and what may be claimed about it.
 *
 * `overrides` counts the lines the read actually returned, so a console showing
 * "2 lines of their own" is quoting the database rather than a number a caller
 * remembered to pass. In the two states where no line was consulted the count is
 * zero and the source says why.
 */
export function resolveGrants(
  role: ReadonlySet<PermissionKey>,
  rows: readonly PermissionOverride[],
  source: OverrideSource
): ResolvedGrants {
  if (source === "unreadable") return { granted: new Set(), overrides: 0, source };
  if (source === "absent") return { granted: new Set(role), overrides: 0, source };
  return { granted: mergeGrants(role, rows), overrides: rows.length, source };
}

/** The longest note the column takes — the check in 048, named here so the two cannot drift. */
export const OVERRIDE_NOTE_MAX_LENGTH = 240;

/**
 * What the write door has to know before it writes.
 *
 * The first three facts are the three fences 048's own policies enforce; the door
 * re-reads them so a member sees a sentence instead of a PostgREST code. `source`
 * is the condition of the layer as the read found it, and only a missing table is
 * refused from it: an unreadable layer may still accept a write, and a write that
 * fails has its own reason to report.
 */
export interface OverrideWriteFacts {
  canManageRoles: boolean;
  isSelf: boolean;
  targetIsSuperAdmin: boolean;
  source: OverrideSource;
  keyIsKnown: boolean;
  note: string | null;
}

/** The reason this line may not be saved, or null when it may. */
export function overrideWriteProblem(facts: OverrideWriteFacts): string | null {
  if (!facts.canManageRoles) {
    return "Editing a person's permissions requires the Manage roles permission.";
  }
  if (facts.isSelf) return "You cannot change the permissions on your own account.";
  if (facts.targetIsSuperAdmin) {
    return "A Super Admin's account takes no lines of its own: that role already holds everything, and a revoke here could lock the group out of the settings console.";
  }
  if (facts.source === "absent") {
    return `${PERMISSION_OVERRIDES_MIGRATION} is authored but not applied, so no per-person line can be saved yet.`;
  }
  if (!facts.keyIsKnown) return "That permission is not one the portal offers.";
  if (facts.note !== null && facts.note.length > OVERRIDE_NOTE_MAX_LENGTH) {
    return `Keep the note under ${OVERRIDE_NOTE_MAX_LENGTH} characters.`;
  }
  return null;
}

/** A permission as the role matrix and this panel both draw it. */
export interface CataloguePermission {
  key: PermissionKey;
  label: string;
  group_name: string;
  description: string | null;
}

/** One row of the editor: what the role says, what this account says, what that means. */
export interface GrantRow {
  key: PermissionKey;
  label: string;
  group_name: string;
  description: string | null;
  fromRole: boolean;
  line: boolean | null;
  effective: boolean;
}

/**
 * Every permission in the catalogue, once each, with its three answers.
 *
 * The catalogue drives the rows rather than the lines: a panel built from the
 * override rows would hide the permissions a member has never been given a line
 * for, which is most of them, and the reviewer could not see what the role already
 * decided.
 */
export function grantRows(
  catalogue: readonly CataloguePermission[],
  roleGrants: ReadonlySet<PermissionKey>,
  lines: ReadonlyMap<PermissionKey, boolean>
): GrantRow[] {
  return catalogue.map((permission) => {
    const line = lines.get(permission.key) ?? null;
    return {
      ...permission,
      fromRole: roleGrants.has(permission.key),
      line,
      effective: line ?? roleGrants.has(permission.key),
    };
  });
}

/** The rows in their catalogue groups, in the catalogue's order. */
export function groupGrantRows(rows: readonly GrantRow[]): Array<[string, GrantRow[]]> {
  const byGroup = new Map<string, GrantRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group_name) ?? [];
    list.push(row);
    byGroup.set(row.group_name, list);
  }
  return Array.from(byGroup.entries());
}

/**
 * What the editor may claim, given the condition of the layer it reads.
 *
 * Three states, three sentences. The absent one names the file because that is the
 * reader's only actionable answer; the unreadable one must not, because the table
 * is there and something else went wrong — and a console that says "apply 048"
 * during an outage sends the owner at the wrong door.
 */
export function editorState(source: OverrideSource): { editable: boolean; note: string | null } {
  if (source === "applied") return { editable: true, note: null };
  if (source === "absent") {
    return {
      editable: false,
      note: `${PERMISSION_OVERRIDES_MIGRATION} is authored but not applied, so nobody holds a line of their own yet.`,
    };
  }
  return {
    editable: false,
    note: "The per-person lines could not be read, so nothing here is shown as granted or revoked.",
  };
}

/** A line's answer as the trail words it. `null` is not a revocation — it is no line. */
function answerWord(value: boolean | null): string {
  if (value === null) return "unset";
  return value ? "granted" : "revoked";
}

/** What a saved line is worth to the person reading the trail afterwards. */
export interface OverrideTrailFacts {
  memberName: string;
  roleKey: string;
  roleLabel: string;
  permissionKey: PermissionKey;
  permissionLabel: string;
  from: boolean | null;
  to: boolean | null;
}

/**
 * The change trail's row for one line.
 *
 * The third move is the one worth a function: clearing a line hands the permission
 * back to the role, and a trail that called it a revocation would have an auditor
 * look for a decision nobody made — the person may well still hold it.
 */
export function overrideTrail(
  facts: OverrideTrailFacts
): { action: string; summary: string; detail: Record<string, unknown> } {
  const detail = {
    permission: facts.permissionKey,
    role: facts.roleKey,
    from: answerWord(facts.from),
    to: answerWord(facts.to),
  };
  if (facts.to === null) {
    return {
      action: "permission_line_cleared",
      summary: `${facts.memberName}'s “${facts.permissionLabel}” goes back to the ${facts.roleLabel} role`,
      detail: { ...detail, to: "as the role" },
    };
  }
  return {
    action: facts.to ? "permission_grant_account" : "permission_revoke_account",
    summary: `${facts.to ? "Granted" : "Revoked"} ${facts.permissionLabel} for ${facts.memberName} alone`,
    detail,
  };
}
