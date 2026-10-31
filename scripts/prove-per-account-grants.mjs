/* scripts/prove-per-account-grants.mjs — Run: node --test scripts/prove-per-account-grants.mjs
 *
 * A role answers "what may a recruiter do". It cannot answer "what may *this*
 * recruiter do", because `role_permissions` holds one row per (role, permission)
 * and every recruiter in the company reads through it. 048 adds a line per
 * person and permission; this proof pins what the resolver does with those lines.
 *
 * The rules, in the order that matters:
 *
 *   1. **The role is the floor; the person's lines are the delta.** `granted =
 *      false` takes away what the role grants, `true` gives what it withholds,
 *      and the absence of a line is the role standing exactly as seeded. A merge
 *      that only ever widens would make the console's revoke box a lie.
 *   2. **The role's set is never edited.** The grants for `RECRUITER` come out of
 *      a cross-request cache that every recruiter shares, so a merge that removed
 *      a key from that Set would revoke it for the whole company the moment one
 *      member's line loaded. This is the bug the shape of the code invites, which
 *      is why a mutation proof aims at it directly.
 *   3. **A read that fails resolves to nothing.** An override is just as often a
 *      revocation, and a revocation that silently fails to load is a permission
 *      handed back. "Nothing is provable" is the only honest answer, and it is the
 *      same answer the role read already gives when its own query fails.
 *   4. **An absent table is not a failed read.** On a database where 048 has never
 *      run there are no lines to read and the role stands; on one where it has run
 *      and the read errors, the account holds nothing. Those two states look
 *      identical to a caller that only asks for a set, so the resolver carries the
 *      distinction — it is what lets the Team console name the migration instead of
 *      reporting an outage, or report an outage instead of naming the migration.
 *
 * The pure half runs anywhere. The infrastructure half reads the source text,
 * because `permissions.ts` sits behind `server-only` and cannot be imported by a
 * plain-Node script; it therefore proves the *shape* (which table, which state,
 * cached or not) rather than the result of a live query, and the live queries are
 * proved in the browser against a database where the table exists.
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOMAIN_REL = "src/modules/settings/domain/accountGrants.ts";
const RESOLVER_REL = "src/modules/settings/infrastructure/permissions.ts";
const USER_ACTIONS_REL = "src/modules/settings/application/user-actions.ts";
const PANEL_REL = "src/app/(admin)/settings/MemberGrantsPanel.tsx";
const ACTIVITY_REL = "../src/modules/activity/domain/trail.ts";
const DOMAIN = "../" + DOMAIN_REL;

/* Node keeps one instance of an ESM module per resolved URL, so a file rewritten
 * on disk is still the old bytes to the next `import` — unless the import names
 * it again. Without this the mutation proofs would prove nothing at all. */
let version = 0;
const fresh = (specifier) => `${specifier}?v=${++version}`;
const load = () => import(fresh(DOMAIN));

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/** What a recruiter's role grants, in the keys the portal actually consults. */
const ROLE = () =>
  new Set([
    "candidates.read",
    "candidates.write",
    "analytics.view",
    "analytics.export",
    "messages.send",
  ]);

// ————————————————————————————————————————————————————————————————————————————
// 1. the merge: the role is the floor and the person's lines are the delta
// ————————————————————————————————————————————————————————————————————————————

async function revokedLineTakesThePermission() {
  const { mergeGrants } = await load();
  const merged = mergeGrants(ROLE(), [{ permissionKey: "analytics.export", granted: false }]);
  assert.equal(merged.has("analytics.export"), false, "a revoked permission survived the merge");
  assert.equal(merged.has("candidates.read"), true, "the merge took more than its one line");
}
test("a line that says no takes away what the role grants", revokedLineTakesThePermission);

async function grantedLineGivesThePermission() {
  const { mergeGrants } = await load();
  const merged = mergeGrants(ROLE(), [
    { permissionKey: "settings.manage_platform", granted: true },
  ]);
  assert.equal(merged.has("settings.manage_platform"), true);
  assert.equal(merged.has("candidates.write"), true, "a widening dropped the role's own grants");
}
test("a line that says yes gives what the role withholds", grantedLineGivesThePermission);

async function roleSetStaysWhole() {
  const { mergeGrants } = await load();
  const role = ROLE();
  mergeGrants(role, [{ permissionKey: "analytics.export", granted: false }]);
  assert.equal(role.has("analytics.export"), true, "the merge edited the role's own set");

  /* The role set comes out of a cache every recruiter shares. A second member
   * with no lines must still read the role as seeded, from the same object. */
  const clean = mergeGrants(role, []);
  assert.equal(clean.has("analytics.export"), true, "one member's revocation reached another");
}
test("merging never edits the role's set — one person's revocation is not a role's", roleSetStaysWhole);

async function noLinesNoChange() {
  const { mergeGrants } = await load();
  const role = ROLE();
  const merged = mergeGrants(role, []);
  assert.deepEqual([...merged].sort(), [...role].sort());
  assert.notEqual(merged, role, "the merge handed back the cached set itself");
}
test("no lines, no change — and a set the caller is free to keep", noLinesNoChange);

test("a line against a permission the role never had says nothing new", async () => {
  const { mergeGrants } = await load();
  const merged = mergeGrants(ROLE(), [{ permissionKey: "candidates.delete", granted: false }]);
  assert.equal(merged.has("candidates.delete"), false);
  assert.equal(merged.size, ROLE().size, "the merge invented a difference");
});

// ————————————————————————————————————————————————————————————————————————————
// 2. what the resolver may claim about the per-account layer
// ————————————————————————————————————————————————————————————————————————————

async function unreadableResolvesToNothing() {
  const { resolveGrants } = await load();
  const resolved = resolveGrants(ROLE(), [], "unreadable");
  assert.equal(resolved.granted.size, 0, "a failed override read handed the role back whole");
  assert.equal(resolved.source, "unreadable");
  assert.equal(resolved.overrides, 0);
}
test("an override read that fails resolves to no permissions at all", unreadableResolvesToNothing);

async function absentLeavesTheRoleStanding() {
  const { resolveGrants, PERMISSION_OVERRIDES_MIGRATION } = await load();
  const role = ROLE();
  const resolved = resolveGrants(role, [], "absent");
  assert.deepEqual([...resolved.granted].sort(), [...role].sort());
  assert.equal(resolved.source, "absent");
  assert.equal(resolved.overrides, 0);
  assert.match(PERMISSION_OVERRIDES_MIGRATION, /^db\/migrations\/\d+_[a-z0-9_]+\.sql$/);
  assert.ok(
    read(PERMISSION_OVERRIDES_MIGRATION).includes("user_permission_overrides"),
    "the file the copy names does not create the table the resolver reads"
  );
}
test("an absent table leaves the role standing and names the file that would create it", absentLeavesTheRoleStanding);

async function appliedMergesAndCounts() {
  const { resolveGrants } = await load();
  const resolved = resolveGrants(
    ROLE(),
    [
      { permissionKey: "analytics.export", granted: false },
      { permissionKey: "settings.manage_platform", granted: true },
    ],
    "applied"
  );
  assert.equal(resolved.overrides, 2);
  assert.equal(resolved.granted.has("analytics.export"), false);
  assert.equal(resolved.granted.has("settings.manage_platform"), true);
  assert.equal(resolved.source, "applied");
}
test("an applied layer merges both ways and counts its own lines", appliedMergesAndCounts);

test("absent and unreadable stay two different answers", async () => {
  const { resolveGrants } = await load();
  const absent = resolveGrants(ROLE(), [], "absent");
  const broken = resolveGrants(ROLE(), [], "unreadable");
  assert.notEqual(absent.source, broken.source);
  assert.ok(absent.granted.size > 0, "an unapplied migration would empty every account");
  assert.equal(broken.granted.size, 0, "an outage would read as nothing having changed");
});

test("the table the domain names is the table the migration creates", async () => {
  const { PERMISSION_OVERRIDES_TABLE, PERMISSION_OVERRIDES_MIGRATION } = await load();
  const sql = read(PERMISSION_OVERRIDES_MIGRATION);
  assert.ok(
    sql.includes(`create table if not exists public.${PERMISSION_OVERRIDES_TABLE}`),
    `the resolver reads ${PERMISSION_OVERRIDES_TABLE}, which the migration does not create`
  );
});

// ————————————————————————————————————————————————————————————————————————————
// 3. the resolver: where the lines are read, and what is never cached
// ————————————————————————————————————————————————————————————————————————————

/**
 * The body of every `"use cache"` function.
 *
 * Read line by line against the indentation of the directive, not by counting
 * braces: the first `{` after `"use cache"` is a destructuring pattern
 * (`const { data, error } = …`), and a brace counter that stops there inspects
 * four words and calls the rest of the function invisible. That mistake made the
 * check below pass while the mutation it was meant to catch went unnoticed, so
 * the shape of this helper is part of what it is proving.
 */
function cachedBodies(source) {
  const lines = source.split("\n");
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('"use cache"')) continue;
    const indent = /^\s*/.exec(lines[i])[0];
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const closing = /^\s*\}\s*$/.exec(lines[j]);
      // A nested block closes at the directive's own indentation (`  }` under an
      // `if`), so only a brace set *back* from the directive ends the function.
      if (closing && /^\s*/.exec(lines[j])[0].length < indent.length) break;
      body.push(lines[j]);
    }
    bodies.push(body.join("\n"));
  }
  return bodies.join("\n");
}

async function resolverMergesForTheCaller() {
  const source = read(RESOLVER_REL);
  assert.match(source, /resolveGrants\(/, "the resolver never consults the per-account layer");
  assert.match(
    source,
    /PERMISSION_OVERRIDES_TABLE/,
    "the resolver re-typed the table name instead of reading the domain's"
  );
  assert.match(
    source,
    /\.eq\("profile_id", profileId\)/,
    "the read is not scoped to one account's lines"
  );
  assert.match(
    source,
    /grantsForAccount\(user\.profileId/,
    "the account whose lines are read is not the one the session proved"
  );
}
test("the resolver reads one account's lines and merges them over the role", resolverMergesForTheCaller);

async function overrideReadIsNotCachedAcrossRequests() {
  const source = read(RESOLVER_REL);
  const bodies = cachedBodies(source);
  assert.ok(bodies, "the resolver lost the cross-request cache it shares role grants through");
  assert.doesNotMatch(
    bodies,
    /PERMISSION_OVERRIDES_TABLE|user_permission_overrides/,
    "one member's overrides are being cached for everybody"
  );
  assert.doesNotMatch(bodies, /resolveGrants\(/,
    "the merge runs inside the shared cache, so the first caller's lines decide the rest");
}
test("a revoked permission is not left alive for the cache window", overrideReadIsNotCachedAcrossRequests);

test("the two questions every gate asks keep their answers' shape", () => {
  const source = read(RESOLVER_REL);
  /* 197 call sites ask these two questions, and the per-account layer changes
   * what the answers mean rather than how they are asked — a gate that had to be
   * rewritten to become per-account is a gate that will be skipped in a hurry. */
  assert.match(source, /export async function hasPermissionForUser\(permission: PermissionKey\): Promise<boolean>/);
  assert.match(source, /export async function permissionsForCurrentUser\(\): Promise<Set<PermissionKey>>/);
});

test("the resolver states the per-account layer's own condition", () => {
  const source = read(RESOLVER_REL);
  assert.match(source, /export async function permissionOverridesState\(\): Promise<OverrideSource>/,
    "no surface can ask whether overrides are readable at all");
});

async function sharedMissingTableReading() {
  const { isMissingTable } = await load();
  assert.equal(isMissingTable("42P01 relation public.user_permission_overrides does not exist"), true);
  assert.equal(isMissingTable("PGRST205 Could not find the table"), true);
  assert.equal(isMissingTable("PGRST204 the schema cache is not loaded"), true);
  assert.equal(isMissingTable("500 connection to server failed"), false,
    "an outage was read as an unapplied migration, so the copy would name a file that is already applied");
  /* Two readers, one pattern. A copy of the regex in the second is where the two
   * start disagreeing about whether the table is missing or merely unreachable. */
  assert.match(read(RESOLVER_REL), /isMissingTable\(/, "the resolver kept its own copy of the pattern");
  assert.match(read(USER_ACTIONS_REL), /isMissingTable\(/, "the console read kept its own copy of the pattern");
}
test("one reading of the database's two failures, shared by every reader", sharedMissingTableReading);

// ————————————————————————————————————————————————————————————————————————————
// 4. the write fences: who may put a line on the record at all
//
// 048's three policies refuse a write the database does not accept, and the
// console refuses the same three before it asks — so the member sees the reason
// instead of a PostgREST code. A fence added to one and not the other is the bug
// this section exists to catch: an app-only fence is a courtesy the RLS already
// grants, and a policy-only fence is a click that fails with a message nobody wrote.
// ————————————————————————————————————————————————————————————————————————————

const CLEAN_WRITE = () => ({
  canManageRoles: true,
  isSelf: false,
  targetIsSuperAdmin: false,
  source: "applied",
  keyIsKnown: true,
  note: null,
});

async function manageRolesFence() {
  const { overrideWriteProblem } = await load();
  const problem = overrideWriteProblem({ ...CLEAN_WRITE(), canManageRoles: false });
  assert.ok(problem, "a caller without the roles grant wrote a per-account line");
  assert.match(problem, /Manage roles/i, "the refusal does not name the grant it needs");
  assert.equal(overrideWriteProblem(CLEAN_WRITE()), null, "the fences refuse a clean write too");
}
test("only a member who may edit roles may edit a person's lines", manageRolesFence);

async function selfFence() {
  const { overrideWriteProblem } = await load();
  const problem = overrideWriteProblem({ ...CLEAN_WRITE(), isSelf: true });
  assert.ok(problem, "a member granted themselves a permission from the Team console");
  assert.match(problem, /own account|i/, "the self refusal does not say who it is about");
}
test("nobody writes a line against their own account", selfFence);

async function superAdminFence() {
  const { overrideWriteProblem } = await load();
  const problem = overrideWriteProblem({ ...CLEAN_WRITE(), targetIsSuperAdmin: true });
  assert.ok(problem, "a Super Admin's lines are editable, so one revoke can lock the group out");
  assert.match(problem, /Super Admin/, "the refusal does not name the account it protects");
}
test("a Super Admin's account takes no lines", superAdminFence);

async function absentFenceNamesTheMigration() {
  const { overrideWriteProblem, PERMISSION_OVERRIDES_MIGRATION } = await load();
  const problem = overrideWriteProblem({ ...CLEAN_WRITE(), source: "absent" });
  assert.ok(problem, "a write was attempted against a table that does not exist");
  assert.ok(
    problem.includes(PERMISSION_OVERRIDES_MIGRATION),
    "the refusal did not name the file the reader would apply"
  );
  // An unreadable layer is not an absent one: the table is there, and the write
  // is the writer's own problem to report. Only the missing table is refused here.
  assert.equal(overrideWriteProblem({ ...CLEAN_WRITE(), source: "unreadable" }), null);
}
test("a write where 048 never ran is refused by name, and an outage is not", absentFenceNamesTheMigration);

async function noteCeilingMatchesTheColumn() {
  const { overrideWriteProblem, OVERRIDE_NOTE_MAX_LENGTH } = await load();
  const sql = read("db/migrations/048_user_permission_overrides.sql");
  const column = /char_length\(note\) <= (\d+)/.exec(sql);
  assert.ok(column, "the migration stopped ceiling the note, so this check proves nothing");
  assert.equal(
    OVERRIDE_NOTE_MAX_LENGTH,
    Number(column[1]),
    "the console's ceiling is not the column's — a save the database would take is refused here, or one it refuses arrives as an error"
  );
  const long = "n".repeat(OVERRIDE_NOTE_MAX_LENGTH + 1);
  assert.ok(overrideWriteProblem({ ...CLEAN_WRITE(), note: long }),
    "the ceiling is no longer enforced");
  assert.match(
    overrideWriteProblem({ ...CLEAN_WRITE(), note: long }) ?? "",
    /240|note/,
    "the refusal does not say what was too long"
  );
  assert.equal(overrideWriteProblem({ ...CLEAN_WRITE(), note: "n".repeat(OVERRIDE_NOTE_MAX_LENGTH) }), null,
    "the ceiling cut off a note the column would take");
}
test("a note is refused past the length the column allows", async () => {
  await noteCeilingMatchesTheColumn();
});

test("a key outside the portal's own catalogue is refused", async () => {
  const { overrideWriteProblem } = await load();
  const problem = overrideWriteProblem({ ...CLEAN_WRITE(), keyIsKnown: false });
  assert.ok(problem, "the console offered a write the permissions table would reject");
});

// ————————————————————————————————————————————————————————————————————————————
// 5. the panel: the three answers one permission can have for one person
// ————————————————————————————————————————————————————————————————————————————

/** The catalogue as the settings page reads it off the `permissions` table. */
const CATALOGUE = () => [
  { key: "candidates.read", label: "View candidates", group_name: "Hiring", description: null },
  { key: "candidates.write", label: "Edit candidates", group_name: "Hiring", description: "Changes the record." },
  { key: "analytics.export", label: "Export data", group_name: "Reports", description: null },
  { key: "settings.manage_roles", label: "Manage roles", group_name: "Access", description: null },
];

async function rowStates() {
  const { grantRows } = await load();
  const role = new Set(["candidates.read", "analytics.export"]);
  const lines = new Map([["analytics.export", false], ["settings.manage_roles", true]]);
  const rows = grantRows(CATALOGUE(), role, lines);

  assert.equal(rows.length, 4, "the panel hides a permission the catalogue offered");
  const read = rows.find((r) => r.key === "candidates.read");
  assert.equal(read.fromRole, true);
  assert.equal(read.line, null, "a permission with no line was given one");
  assert.equal(read.effective, true, "no line must leave the role's answer standing");

  const revoked = rows.find((r) => r.key === "analytics.export");
  assert.equal(revoked.line, false);
  assert.equal(revoked.effective, false, "the revoke box is a lie");

  const widened = rows.find((r) => r.key === "settings.manage_roles");
  assert.equal(widened.fromRole, false);
  assert.equal(widened.effective, true, "a grant for this account did not reach the answer");

  const edited = rows.find((r) => r.key === "candidates.write");
  assert.equal(edited.description, "Changes the record.", "the panel dropped the catalogue's own words");
}
test("each permission shows the role's answer, the account's line, and what that means now", rowStates);

async function groupingKeepsTheCatalogue() {
  const { grantRows, groupGrantRows } = await load();
  const groups = groupGrantRows(grantRows(CATALOGUE(), new Set(), new Map()));
  assert.deepEqual(groups.map(([name]) => name), ["Hiring", "Reports", "Access"],
    "the panel re-sorted the catalogue's groups");
  assert.equal(groups[0][1].length, 2);
}
test("the panel groups by the catalogue's own groups, in its own order", groupingKeepsTheCatalogue);

async function editorSaysWhatItKnows() {
  const { editorState, PERMISSION_OVERRIDES_MIGRATION } = await load();
  const applied = editorState("applied");
  assert.equal(applied.editable, true);
  assert.equal(applied.note, null, "an applied layer was told it was something else");

  const absent = editorState("absent");
  assert.equal(absent.editable, false);
  assert.ok(absent.note?.includes(PERMISSION_OVERRIDES_MIGRATION),
    "the console promised boxes the database has no table for");

  const broken = editorState("unreadable");
  assert.equal(broken.editable, false);
  assert.ok(broken.note, "an outage was reported as a setting rather than a failure");
  assert.ok(!/not applied|not been applied/i.test(broken.note ?? ""),
    "the outage was blamed on the migration the reader never saw fail");
}
test("the editor states its own condition, and only that", editorSaysWhatItKnows);

// ————————————————————————————————————————————————————————————————————————————
// 6. the trail row an auditor reads
// ————————————————————————————————————————————————————————————————————————————

async function trailDescribesTheMove() {
  const { overrideTrail } = await load();
  const base = {
    memberName: "Nadia Farouk",
    roleKey: "RECRUITER",
    roleLabel: "Recruiter",
    permissionKey: "analytics.export",
    permissionLabel: "Export data",
  };
  const grant = overrideTrail({ ...base, from: null, to: true });
  assert.equal(grant.action, "permission_grant_account");
  assert.match(grant.summary, /Nadia Farouk/);
  assert.match(grant.summary, /Export data/);

  const revoke = overrideTrail({ ...base, from: true, to: false });
  assert.equal(revoke.action, "permission_revoke_account");

  // The third answer is not a revocation: clearing the line hands the permission
  // back to the role. An auditor reading "Revoked" would look for a decision that
  // was never made.
  const cleared = overrideTrail({ ...base, from: true, to: null });
  assert.equal(cleared.action, "permission_line_cleared");
  assert.doesNotMatch(cleared.summary, /revok/i,
    "a cleared line was recorded as a revocation");
  assert.match(cleared.summary, /role/i, "the revert did not say what it went back to");

  assert.deepEqual(cleared.detail, {
    permission: "analytics.export",
    role: "RECRUITER",
    from: "granted",
    to: "as the role",
  });
}
test("the trail names the person, the permission and the kind of move", trailDescribesTheMove);

test("the trail's words are the vocabulary the console already filters by", async () => {
  const { ACTIVITY_AREAS, ACTIVITY_ENTITIES } = await import(fresh(ACTIVITY_REL));
  const source = read(USER_ACTIONS_REL);
  const at = source.indexOf("export async function setStaffPermission");
  assert.ok(at >= 0, "the per-account write does not exist");
  const body = source.slice(at, at + 4000);
  const area = /area: "([a-z ]+)"/.exec(body)?.[1];
  const entity = /entity: "([a-z ]+)"/.exec(body)?.[1];
  assert.ok(area && ACTIVITY_AREAS.includes(area), `the write invents an activity area (${area})`);
  assert.ok(entity && ACTIVITY_ENTITIES.includes(entity), `the write invents an activity entity (${entity})`);
});

// ————————————————————————————————————————————————————————————————————————————
// 7. the surface: where the fences are re-checked, and what is shown
// ————————————————————————————————————————————————————————————————————————————

test("the write re-checks every fence the migration enforces", async () => {
  const sql = read("db/migrations/048_user_permission_overrides.sql");
  const source = read(USER_ACTIONS_REL);
  const body = source.slice(source.indexOf("export async function setStaffPermission"));
  assert.match(sql, /has_permission\('settings\.manage_roles'\)/);
  assert.match(body, /settings\.manage_roles/,
    "the policy gates on the roles grant; the action gates on something else");
  assert.match(body, /isSelf|profileId === actor\.profileId/, "the self fence is not re-read");
  assert.match(body, /SUPER_ADMIN|targetIsSuperAdmin/, "the Super Admin fence is not re-read");
  assert.match(body, /overrideWriteProblem\(/, "the fences are hand-written instead of the domain's");
});

test("the write goes to the table the domain names, both ways and cleared", async () => {
  const source = read(USER_ACTIONS_REL);
  const body = source.slice(source.indexOf("export async function setStaffPermission"));
  assert.match(body, /from\(PERMISSION_OVERRIDES_TABLE\)/, "the table name was re-typed");
  assert.match(body, /onConflict: "profile_id, permission_key"/,
    "the key is (profile_id, permission_key), so a single-column conflict target would not find the row");
  assert.match(body, /\.delete\(\)/, "a cleared line is not removed, so the role never gets it back");
  assert.match(body, /profile_id: profileId/, "the line is not scoped to the account it names");
});

test("the Team console hands the panel the catalogue and the member's lines", () => {
  const team = read("src/app/(admin)/settings/TeamSection.tsx");
  assert.match(team, /MemberGrantsPanel/, "no per-account grants panel reaches the row");
  assert.match(team, /canManageRoles/, "the panel does not know who may write");
  assert.match(team, /overrides/, "the member's own lines are not passed down");
  assert.match(team, /overridesSource/, "the panel cannot say whether the layer exists");

  const page = read("src/app/(admin)/settings/page.tsx");
  assert.match(page, /permissions=\{bundle\.permissions\}[\s\S]{0,400}?overrides=/,
    "the catalogue the panel draws is not the one the matrix edits");

  const panel = read(PANEL_REL);
  assert.match(panel, /editorState\(/, "the panel ignores the layer's condition");
  assert.match(panel, /grantRows\(/, "the panel draws its own merge instead of the domain's");
});

// ————————————————————————————————————————————————————————————————————————————
// 8. mutation proofs: each entry edits one rule away, and must turn its check red
// ————————————————————————————————————————————————————————————————————————————

const MUTATIONS = [
  {
    label: "1. the merge returns the role's own set → the shared-set check red",
    rel: DOMAIN_REL,
    needle: "  const merged = new Set(role);",
    replace: "  const merged = role as Set<PermissionKey>;",
    check: roleSetStaysWhole,
  },
  {
    label: "2. the merge only ever widens → the revocation check red",
    rel: DOMAIN_REL,
    needle:
      "    if (row.granted) merged.add(row.permissionKey);\n    else merged.delete(row.permissionKey);",
    replace: "    if (row.granted) merged.add(row.permissionKey);",
    check: revokedLineTakesThePermission,
  },
  {
    label: "3. a failed read falls back to the role → the fail-closed check red",
    rel: DOMAIN_REL,
    needle: '  if (source === "unreadable") return { granted: new Set(), overrides: 0, source };',
    replace: '  if (source === "unreadable") return { granted: new Set(role), overrides: 0, source };',
    check: unreadableResolvesToNothing,
  },
  {
    label: "4. an absent table is emptied like an outage → the distinction check red",
    rel: DOMAIN_REL,
    needle: '  if (source === "absent") return { granted: new Set(role), overrides: 0, source };',
    replace: '  if (source === "absent") return { granted: new Set(), overrides: 0, source };',
    check: absentLeavesTheRoleStanding,
  },
  {
    label: "5. the per-account read moves inside the shared cache → the cache check red",
    rel: RESOLVER_REL,
    needle: 'await getServiceRestClient()\n    .from("role_permissions")',
    replace: 'await getServiceRestClient()\n    .from(PERMISSION_OVERRIDES_TABLE)',
    check: overrideReadIsNotCachedAcrossRequests,
  },
  {
    label: "6. the self fence is removed → the self check red",
    rel: DOMAIN_REL,
    needle: '  if (facts.isSelf) return "You cannot change the permissions on your own account.";',
    replace: "",
    check: selfFence,
  },
  {
    label: "7. the panel ignores the account's line → the three-state check red",
    rel: DOMAIN_REL,
    needle: "    effective: line ?? roleGrants.has(permission.key),",
    replace: "    effective: roleGrants.has(permission.key),",
    check: rowStates,
  },
  {
    label: "8. an absent layer is drawn as an editable one → the editor check red",
    rel: DOMAIN_REL,
    needle: '  if (source === "applied") return { editable: true, note: null };',
    replace: '  if (source !== "unreadable") return { editable: true, note: null };',
    check: editorSaysWhatItKnows,
  },
  {
    label: "9. a cleared line is recorded as a revocation → the trail check red",
    rel: DOMAIN_REL,
    needle: '      action: "permission_line_cleared",',
    replace: '      action: "permission_revoke_account",',
    check: trailDescribesTheMove,
  },
  {
    label: "10. the missing-table pattern narrows to one code → the two-failures check red",
    rel: DOMAIN_REL,
    needle: "  return /42P01|PGRST205|PGRST204|does not exist|schema cache/i.test(report);",
    replace: "  return /schema cache/i.test(report);",
    check: sharedMissingTableReading,
  },
];

async function mutate(entry) {
  const abs = path.join(ROOT, entry.rel);
  const original = readFileSync(abs, "utf8");
  if (!original.includes(entry.needle)) {
    return `the needle is no longer in ${entry.rel} — this mutation now proves nothing`;
  }
  const restore = () => {
    if (readFileSync(abs, "utf8") !== original) writeFileSync(abs, original, "utf8");
  };
  const onSignal = (signal) => {
    restore();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("exit", restore);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    writeFileSync(abs, original.replace(entry.needle, entry.replace), "utf8");
    try {
      await entry.check();
      return "the check stayed green — it does not test the rule it names";
    } catch (cause) {
      // A syntax break or a missing export is not the rule failing; say so loudly.
      if (cause?.code !== "ERR_ASSERTION") {
        return `the module broke instead of the rule: ${cause?.message ?? cause}`;
      }
      return "";
    }
  } finally {
    process.removeListener("exit", restore);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    restore();
  }
}

test("a per-account rule edited away turns its own proof red", async () => {
  for (const entry of MUTATIONS) {
    assert.equal(await mutate(entry), "", entry.label);
  }
});
