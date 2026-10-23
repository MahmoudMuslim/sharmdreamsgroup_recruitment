/* scripts/prove-permission-keys.mjs — Run: node scripts/prove-permission-keys.mjs
 *
 * Settings → Roles & permissions draws one checkbox per row of the `permissions`
 * table and calls the grid "granular access control". That sentence is only true
 * if flipping a box changes a decision the software makes — in a server action, a
 * route handler, or an RLS policy. Three keys did not: `candidates.view_scores`,
 * `interviews.schedule` and `users.create` were offered, granted to roles and
 * consulted by nothing, so an admin could revoke "Schedule interviews" and every
 * interview would still be bookable. A box like that is worse than no box: it
 * teaches the person holding it that the matrix can be trusted.
 *
 * This proof reads the same three things the console does — the TypeScript union
 * the actions are typed against, the live catalogue and grants, and the policies
 * the database enforces — and refuses any disagreement between them. It then asks
 * a fourth: the Guide panel, for a sentence naming each box. A door that decides
 * something nobody can read about is only marginally better than one that decides
 * nothing. It asks the database, not db/schema.sql, because a dump is a
 * photograph: the rows that decide who gets in are in the running instance.
 *
 * Part one is pure text and runs without the stack; the rest needs the local
 * database up (`npm run docker:up`).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

// ---------------------------------------------------------------------------
// The vocabulary as the code knows it.
//
// `PermissionKey` is what `hasPermissionForUser` accepts, so a key outside the
// union is a compile error rather than a runtime surprise. The union and the
// `AssignableStaffRole` beside it are read out of the domain file by their
// literal text: a proof that re-typed the list would only prove it could copy.
// ---------------------------------------------------------------------------
const typesFile = read("src/modules/settings/domain/types.ts");

function unionOf(name, literal) {
  const start = typesFile.indexOf(`export type ${name} =`);
  if (start < 0) return [];
  // The union ends at the first blank line after it — every one here is a flat
  // list of quoted literals with no nested block.
  const block = typesFile.slice(start, typesFile.indexOf("\n\n", start));
  return [...block.matchAll(new RegExp(`"(${literal})"`, "g"))].map((m) => m[1]);
}

const unionKeys = new Set(unionOf("PermissionKey", "[a-z_]+(?:\\.[a-z_]+)+"));
const assignable = new Set(unionOf("AssignableStaffRole", "[A-Z_]+"));
check("the PermissionKey union was read out of the domain file", unionKeys.size > 0, `${unionKeys.size} keys`);

// ---------------------------------------------------------------------------
// Which keys the running code actually asks about.
//
// Three shapes, because that is how the grants are consulted: `hasPermissionForUser("…")`
// at a door, `granted.has("…")` / `permissions.has("…")` against the request's
// cached set, and the literal members of `STAFF_MANAGE_KEYS`, which is the one
// list a helper reads by name instead of spelling the key at the call site.
// Prose that merely mentions a key (the Guide, a refusal message) is not a
// consultation — a sentence cannot lock a door.
// ---------------------------------------------------------------------------
const CONSULT_PATTERNS = [
  /hasPermissionForUser\(\s*"([a-z_]+(?:\.[a-z_]+)+)"/g,
  /\b(?:granted|permissions|set)\.has\(\s*"([a-z_]+(?:\.[a-z_]+)+)"/g,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const consulted = new Map(); // key → the files that consult it
function note(key, where) {
  const at = consulted.get(key) ?? new Set();
  at.add(where);
  consulted.set(key, at);
}

for (const rel of walk("src")) {
  const text = read(rel);
  for (const pattern of CONSULT_PATTERNS) {
    for (const m of text.matchAll(new RegExp(pattern.source, "g"))) note(m[1], rel);
  }
  // The staff-management keys are named once, inside the array, and read as a
  // list — so the array body counts as a consultation of each member.
  const list = /STAFF_MANAGE_KEYS[^=]*=\s*\[([\s\S]*?)\]/.exec(text);
  if (list) {
    for (const m of list[1].matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) note(m[1], rel);
  }
}

// ---------------------------------------------------------------------------
// Part 2 — the database answers for the catalogue, the grants and the policies.
// ---------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(path.join(root, "docker", ".env"), "utf8")
    .split(/\r?\n/)
    .map((l) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
      return m ? [m[1], m[2].trim()] : null;
    })
    .filter(Boolean)
);

const client = new Client({ connectionString: env.AUTH_DB_URL, connectionTimeoutMillis: 8000 });
let reachable = false;
try {
  await client.connect();
  reachable = true;
} catch (e) {
  console.log(
    `FAIL cannot reach the app database (${e.message}). ` +
      "Start the stack with `npm run docker:up` — this proof asks the running instance who may do what."
  );
  console.log("It does not print the connection string.");
  process.exitCode = 1;
}

if (reachable) {
  const catalogue = new Set(
    (await client.query("select key from permissions")).rows.map((r) => r.key)
  );
  const grants = (
    await client.query("select role_key, permission_key, granted from role_permissions")
  ).rows;
  // Every readable and writable expression a policy can hold, flattened into one
  // text — the same regex used on source, because `has_permission('jobs.manage')`
  // is a door as real as any action's.
  const policies = (
    await client.query(
      "select coalesce(qual,'') || ' ' || coalesce(with_check,'') as body from pg_policies where schemaname = 'public'"
    )
  )
    .rows.map((r) => r.body)
    .join("\n");
  const inRls = new Set();
  for (const m of policies.matchAll(/has_permission\('([a-z_.]+)'\)/g)) inRls.add(m[1]);

  // A staff account's role is typed by `user_role`, not by the `roles` table, so
  // the roles a person can actually hold are the enum's labels except CANDIDATE.
  const enumRoles = (
    await client.query(
      "select e.enumlabel as k from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role'"
    )
  ).rows.map((r) => r.k);
  const holdable = new Set(enumRoles.filter((k) => k !== "CANDIDATE"));

  check(
    "the catalogue holds exactly the keys the code can name",
    catalogue.size === unionKeys.size &&
      [...catalogue].every((k) => unionKeys.has(k)) &&
      [...unionKeys].every((k) => catalogue.has(k)),
    [
      ...[...unionKeys].filter((k) => !catalogue.has(k)).map((k) => `${k}: in TS, not in the database`),
      ...[...catalogue].filter((k) => !unionKeys.has(k)).map((k) => `${k}: in the database, not in TS`),
    ].join(", ")
  );

  // The FK on role_permissions.permission_key means a key with no catalogue row
  // can never be granted to anyone, so a door built on one is shut forever.
  const uncatchalogue = [...consulted.keys()].filter((k) => !catalogue.has(k));
  check(
    "every key the code asks for is a row the matrix can grant",
    uncatchalogue.length === 0,
    uncatchalogue.map((k) => `${k} (${[...consulted.get(k)].join(", ")})`).join(" | ")
  );

  // The claim the console makes about itself: a tick changes an outcome.
  const inert = [...catalogue].filter((k) => !consulted.has(k) && !inRls.has(k));
  check(
    "every catalogue key is consulted by an action or a policy",
    inert.length === 0,
    inert.length ? `${inert.join(", ")} decide nothing` : `${catalogue.size} keys, each consulted`
  );

  // A box the manual never names is a box nobody can reason about: the person
  // ticking it has the label and nothing else, and the Guide panel is where this
  // portal tells staff what each door opens. `candidates.delete` and
  // `companies.manage` were both consulted by a real refusal and absent from the
  // manual — the delete button on /sourcing and the Companies list had no
  // sentence saying who may press them.
  const labels = (
    await client.query("select key, label from permissions order by key")
  ).rows;
  const manual =
    read("src/modules/shell/domain/pageGuide.ts") +
    "\n" +
    read("src/modules/settings/domain/schema.ts");
  const unnamed = labels.filter((row) => !manual.includes(row.label));
  check(
    "the manual names every box the matrix offers",
    unnamed.length === 0,
    unnamed.length
      ? unnamed.map((row) => `${row.key} ("${row.label}")`).join(", ")
      : `${labels.length} labels, each named in the Guide panel or a setting's help`
  );

  // "Super Admin always holds every permission" — PermissionMatrixCard.tsx:60.
  const adminMissing = [...catalogue].filter(
    (k) => !grants.some((g) => g.role_key === "SUPER_ADMIN" && g.permission_key === k && g.granted)
  );
  check(
    "the matrix's own sentence about Super Admin holds",
    adminMissing.length === 0,
    adminMissing.length
      ? `${adminMissing.join(", ")} not granted to SUPER_ADMIN`
      : `${catalogue.size} of ${catalogue.size} granted true`
  );

  // A door only SUPER_ADMIN can open is a feature the rest of the portal cannot
  // use; the assignable roles are named in the detail so the reviewer sees who
  // is on each side of it.
  for (const k of [...consulted.keys()].sort()) {
    if (!catalogue.has(k)) continue;
    const holders = grants
      .filter((g) => g.granted && holdable.has(g.role_key) && g.permission_key === k)
      .map((g) => g.role_key);
    check(
      `${k} is held by a role a staff account can actually be`,
      holders.length > 0,
      holders.length ? holders.join(", ") : "no assignable role holds it"
    );
  }

  // `AssignableStaffRole` is the set the Team console's role picker offers; the
  // enum is what the database can store on a profile. Widening one without the
  // other either invents a role that cannot be saved or hides one that can.
  const pickerMatchesStorage =
    assignable.size === holdable.size && [...assignable].every((k) => holdable.has(k));
  check(
    "AssignableStaffRole matches the roles this database can store",
    pickerMatchesStorage,
    `picker: ${[...assignable].sort().join(", ")} | enum: ${[...holdable].sort().join(", ")}`
  );

  const shownRoles = (await client.query("select key from roles")).rows.length;
  console.log(
    `     the matrix shows ${shownRoles} role columns, of which ${holdable.size} a staff account can hold (${[...holdable].sort().join(", ")})`
  );

  await client.end();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
