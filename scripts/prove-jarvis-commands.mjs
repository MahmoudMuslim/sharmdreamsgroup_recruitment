/* scripts/prove-jarvis-commands.mjs
 * Run: node --experimental-strip-types scripts/prove-jarvis-commands.mjs
 * A check that throws names only its message; PROVE_STACK=1 prints its stack too.
 *
 * The saved-voice-command slice's correctness boundary, over a module that imports
 * only the staff-route guard: the six categories and the four action types that are
 * the shipped vocabulary, the eight ceilings the migration, the console and the two
 * doors all quote one source for, and what the read door makes of a row it cannot
 * fully understand — a category nobody authored still renders and names the string
 * it came from, an action nobody can read is switched off rather than guessed into
 * being something else, and a phrase too short to match is reported instead of
 * quietly trimmed. An over-long field is returned whole — the ceilings belong to the
 * write door, and a read door that sliced would be a second, silent writer. The
 * write door is this file's group 2: it refuses a draft that cannot be stored, and
 * names the field that made it so. The matcher is group 4: heard words become a
 * command only on a run of whole folded tokens, the longest phrase wins, the
 * person's own row wins a tie, a row the read door already dropped never reaches it
 * at all, and the tail is cut where the word ends rather than where the folded token
 * did — `fold` splits `follow-up` in two, and a saved question that lost the word
 * after it would be wrong in the ordinary case, not an edge. Group 1 holds the two
 * spellings of the token rule together, because `domain/jarvis.ts` may not be
 * imported here and a splitter that quietly diverges makes `stop` a word in one
 * module and not the other. The reader and the console are later groups of this file.
 *
 * Nothing here needs a database, a browser, a microphone or a model. The mutation
 * proofs that break a rule and re-run the check that must notice use the harness
 * below unchanged, restoring the saved copy from `finally` and from
 * `exit`/SIGINT/SIGTERM, so a kill mid-run cannot leave the break on disk.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The five stubs the server half reaches for. `@/lib/data-api/server` is the one
// REST door the reader and the writer share, so a check decides what the table
// said — absent, unreadable, a row, nothing — without a database behind it.
const STUB_SOURCES = {
  "server-only": "export {};",
  "next/server": `
    export class NextResponse extends Response {
      static json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        });
      }
    }
  `,
  "@/lib/auth/session": `
    export const getSessionUser = () => globalThis.__jarvisUser ?? null;
    export const isStaff = (role) =>
      role === "SUPER_ADMIN" || role === "RECRUITER" || role === "HIRING_MANAGER";
    // A throw stands in for the real guard's redirect outside a request.
    export const requireStaff = async (next) => {
      const user = globalThis.__jarvisUser;
      if (!user) throw new Error("no staff session behind " + next);
      return user;
    };
  `,
  "@/modules/settings/infrastructure/permissions": `
    export const hasPermissionForUser = async (permission) =>
      permission === "assistant.commands" && globalThis.__jarvisPermission === false ? false : true;
  `,
  // The registry's three tools, one of each kind the write door reasons about.
  "@/modules/assistant/domain/tools": `
    export const ASSISTANT_TOOLS = [
      { name: "list_candidates", label: "List candidates", args: {}, run: async () => "{}" },
      { name: "delete_candidate", label: "Delete a candidate", args: {}, destructive: true, run: async () => "{}" },
      { name: "search_web", label: "Search the web", args: {}, web: true, run: async () => "{}" },
    ];
  `,
  "@/modules/assistant/application/jarvisSettings": `
    export const jarvisPresenceForViewer = async () => globalThis.__jarvisPrefs;
    export const saveJarvisPrefs = async () => { throw new Error("Unexpected preferences write"); };
  `,
  "@/modules/assistant/application/jarvisAppearanceSettings": `
    export const readJarvisAppearance = async () => { throw new Error("Unexpected appearance read"); };
    export const saveJarvisAppearance = async () => { throw new Error("Unexpected appearance write"); };
  `,
  "@/lib/data-api/server": `
    export const createServerRestClient = async () => globalThis.__jarvisRest;
  `,
  "@/modules/activity/application/record": `
    export const recordActivity = async (entry) => {
      (globalThis.__jarvisTrail ??= []).push(entry);
    };
  `,
};
const STUB_URLS = Object.fromEntries(
  Object.entries(STUB_SOURCES).map(([specifier, source]) => [
    specifier,
    `data:text/javascript,${encodeURIComponent(source)}`,
  ])
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUB_URLS[specifier]) return { url: STUB_URLS[specifier], shortCircuit: true };
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const results = [];
const mutations = [];

function verdict(problems) {
  return problems.length === 0
    ? { pass: true }
    : { pass: false, detail: [...new Set(problems)].slice(0, 5).join("; ") };
}

async function safe(fn) {
  try {
    return await fn();
  } catch (cause) {
    if (process.env.PROVE_STACK) console.error(cause.stack);
    return { pass: false, detail: `threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function expect(problems, label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const DOMAIN_REL = "src/modules/assistant/domain/commands.ts";
const MIGRATION_REL = "db/migrations/051_jarvis_voice_commands.sql";
const READER_REL = "src/modules/assistant/application/jarvisCommands.ts";
const ACTIONS_REL = "src/app/(admin)/settings/jarvis-command-actions.ts";
const PRESENCE_REL = "src/modules/assistant/presentation/JarvisPresence.tsx";
const CHAT_REL = "src/app/(admin)/assistant/AssistantChat.tsx";
const RUNNER_REL = "src/app/(admin)/assistant/actions.ts";
const STORE_REL = "src/lib/jarvis-ui.ts";

const DOMAIN_URL = pathToFileURL(path.join(root, DOMAIN_REL)).href;
const READER_URL = pathToFileURL(path.join(root, READER_REL)).href;
const ACTIONS_URL = pathToFileURL(path.join(root, ACTIONS_REL)).href;
// A fresh URL on every load, so a check reads the bytes now on disk: a monotonic
// counter, because two Date.now() calls in one millisecond would hand a mutated
// run the module imported before the mutation.
let loadCount = 0;
const load = (url) => import(`${url}?v=${(loadCount += 1)}`);

// The server half is proved against the stubs above, so every check starts from
// a clean room: no session, no table, no key, no trail left over by its
// neighbour. A check that forgets this inherits the previous one's identity, and
// an inherited identity is exactly the bug these checks exist to catch.
const GLOBAL_KEYS = [
  "__jarvisUser",
  "__jarvisRest",
  "__jarvisTrail",
  "__jarvisPermission",
  "__jarvisPrefs",
];
function resetGlobals(patch = {}) {
  for (const key of GLOBAL_KEYS) delete globalThis[key];
  Object.assign(globalThis, { __jarvisPermission: true }, patch);
}

/**
 * The one REST door the reader and the writer share, with every call recorded.
 *
 * `read` and `write` answer whatever the table is meant to do in a case: a row,
 * nothing, or the error code PostgREST gives a table that was never created.
 * `throwOn` breaks the door itself, which is how a check tells "the table is
 * absent" from "the table could not be reached".
 */
function fakeRest({ read = { data: null, error: null }, write = { error: null }, throwOn = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      const entry = { table, verb: "select", filters: [] };
      calls.push(entry);
      const settle = async () => {
        const writing = entry.verb !== "select";
        if (throwOn === (writing ? "write" : "read")) throw new Error("the REST door blew up");
        const response = writing ? write : read;
        return typeof response === "function" ? response(entry) : response;
      };
      const mutate = (verb, body) => {
        entry.verb = verb;
        entry.body = body;
        return chain;
      };
      const chain = {
        select: (columns = "*") => { entry.columns = columns; return chain; },
        eq: (column, value) => { entry.filters.push(["eq", column, value]); return chain; },
        limit: (value) => { entry.limit = value; return chain; },
        single: () => { entry.single = true; return chain; },
        maybeSingle: () => { entry.single = true; return chain; },
        insert: (body) => mutate("insert", body),
        update: (body) => mutate("update", body),
        delete: () => mutate("delete"),
        upsert: (body) => mutate("upsert", body),
        then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
  return { client, calls };
}

/** The error shape a table that was never created answers with. */
const ABSENT = { code: "42P01", message: 'relation "public.assistant_jarvis_commands" does not exist' };
const UNREADABLE = { code: "PGRST802", message: "connection reset by peer" };

// ---------------------------------------------------------------------------
// 1. The six categories and four action types are the shipped vocabulary
// ---------------------------------------------------------------------------
async function check1() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  expect(problems, "category count", m.COMMAND_CATEGORIES.length, 6);
  expect(problems, "category ids", m.COMMAND_CATEGORIES.map((c) => c.id), [
    "navigation", "hiring", "communication", "reports", "settings", "personal",
  ]);
  expect(problems, "every category label is non-empty",
    m.COMMAND_CATEGORIES.every((c) => c.label.trim().length > 0), true);
  expect(problems, "action type ids", m.COMMAND_ACTION_TYPES.map((a) => a.id), [
    "ask", "open", "tool", "note",
  ]);
  expect(problems, "every action type describes itself",
    m.COMMAND_ACTION_TYPES.every((a) => a.description.trim().length > 0), true);
  expect(problems, "phrase floor", m.COMMAND_LIMITS.phraseMin, 2);
  expect(problems, "phrase ceiling", m.COMMAND_LIMITS.phraseMax, 64);
  expect(problems, "title ceiling", m.COMMAND_LIMITS.titleMax, 80);
  expect(problems, "notes ceiling", m.COMMAND_LIMITS.notesMax, 500);
  expect(problems, "payload ceiling", m.COMMAND_LIMITS.payloadBytes, 4096);
  expect(problems, "spoken note ceiling", m.COMMAND_LIMITS.noteTextMax, 280);
  expect(problems, "ask prompt ceiling", m.COMMAND_LIMITS.promptMax, 2000);
  expect(problems, "read ceiling", m.COMMAND_LIMITS.rows, 200);
  // The stop-word splitter and the command splitter are one rule written twice,
  // on purpose (this module may not import `jarvis.ts`). Pinned, because the day
  // they differ, `stop` is a word in one and not in the other — and a person who
  // says "stop" to a command that tokenises `stop.` as one token is still talking
  // to JARVIS, just not to the thing they meant.
  const splitOf = (src) => (src.match(/const TOKEN_SPLIT = (\/.*\/);/) ?? [])[1];
  expect(problems, "one token rule, spelled twice",
    splitOf(read(DOMAIN_REL)), splitOf(read("src/modules/assistant/domain/jarvis.ts")));
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 2. The write door refuses every field it cannot express
// ---------------------------------------------------------------------------
async function check2() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const TOOLS = [
    { name: "list_candidates", label: "List candidates" },
    { name: "delete_candidate", label: "Delete a candidate", destructive: true },
    { name: "search_web", label: "Search the web", web: true },
  ];
  const PREV = {
    id: "c1", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open the outbox",
    title: "Outbox", category: "communication", rawCategory: null,
    action: { type: "open", href: "/whatsapp" }, notes: null, enabled: true, problem: null,
  };
  const ok = (draft) => m.parseCommandDraft(draft, PREV, TOOLS);
  const refused = (label, draft, field) => {
    const out = ok(draft);
    if (out.ok !== false) problems.push(`${label}: expected a refusal`);
    else if (out.field !== field) problems.push(`${label}: refused ${out.field}, expected ${field}`);
  };
  // A refusal is "stated" only if its sentence is part of the proof, so the refusals
  // a person has to act on are quoted as well as filed under a field.
  const refusedWith = (label, draft, field, needle) => {
    const out = ok(draft);
    if (out.ok !== false) problems.push(`${label}: expected a refusal`);
    else if (out.field !== field) problems.push(`${label}: refused ${out.field}, expected ${field}`);
    else if (!needle.test(out.message ?? "")) problems.push(`${label}: said “${out.message}”, expected ${needle}`);
  };
  const good = {
    trigger_phrase: "open the outbox", title: "Outbox", category: "communication",
    action_type: "open", action_payload: { href: "/whatsapp" }, notes: "", enabled: true,
  };

  // The happy path, once, so the refusals below are known to be about their field.
  const parsed = ok(good);
  expect(problems, "a sound draft is accepted", parsed.ok, true);
  if (parsed.ok) {
    expect(problems, "to an open action", parsed.command.action, { type: "open", href: "/whatsapp" });
    expect(problems, "with the scope it is stored under", parsed.command.scope, "personal");
    // Task A6 issues the update as `.eq("id", parsed.command.id)`, so the identity this
    // door returns is the row the write lands on. Nothing else in this group reads it.
    expect(problems, "keeping the row it was given", parsed.command.id, "c1");
  }

  // Phrase.
  refused("a one-character phrase", { ...good, trigger_phrase: "x" }, "trigger_phrase");
  refused("a 65-character phrase", { ...good, trigger_phrase: "p".repeat(65) }, "trigger_phrase");
  refused("a phrase with a newline", { ...good, trigger_phrase: "open\nthe outbox" }, "trigger_phrase");
  refused("a phrase that is only spaces", { ...good, trigger_phrase: "     " }, "trigger_phrase");

  // Title.
  refused("an empty title", { ...good, title: "  " }, "title");
  refused("a 200-character title", { ...good, title: "t".repeat(200) }, "title");

  // Category and action type must be in the vocabulary.
  refused("an invented category", { ...good, category: "payroll" }, "category");
  refused("an invented action type", { ...good, action_type: "delete" }, "action_type");

  // `open` — the guard's own rule, quoted back.
  refusedWith("an off-site href", { ...good, action_payload: { href: "https://example.com/x" } }, "action_payload", /not a staff page/);
  refusedWith("a javascript: href", { ...good, action_payload: { href: "javascript:alert(1)" } }, "action_payload", /not a staff page/);
  refusedWith("a path the guard does not cover", { ...good, action_payload: { href: "/candidate-portal" } }, "action_payload", /not a staff page/);
  refused("an empty href", { ...good, action_payload: { href: "" } }, "action_payload");
  // The guard matches the front of a path; a command link is resolved by a browser,
  // so a path that walks up out of the page its prefix names is refused here.
  refused("a path that walks up", { ...good, action_payload: { href: "/candidates/../login" } }, "action_payload");
  refused("a path that walks up in disguise", { ...good, action_payload: { href: "/candidates/%2E%2E/login" } }, "action_payload");
  expect(problems, "a staff path with a query is accepted",
    ok({ ...good, action_payload: { href: "/candidates?q=offer" } }).ok, true);
  expect(problems, "a dot inside a name is not a walk",
    ok({ ...good, action_payload: { href: "/candidates/re.marks" } }).ok, true);
  // A payload of the wrong kind names no fields; it is not the same as an empty one.
  refused("a payload that is not a set of fields", { ...good, action_payload: "open the outbox" }, "action_payload");
  refused("a payload that is a list", { ...good, action_payload: ["/whatsapp"] }, "action_payload");

  // `tool` — unknown, destructive and web names are all refused here, not at dispatch.
  const asTool = { ...good, action_type: "tool" };
  refused("an unknown tool", { ...asTool, action_payload: { tool: "drop_tables", args: {} } }, "action_payload");
  refused("a destructive tool", { ...asTool, action_payload: { tool: "delete_candidate", args: {} } }, "action_payload");
  refused("a web tool", { ...asTool, action_payload: { tool: "search_web", args: {} } }, "action_payload");
  expect(problems, "a read-only tool is accepted",
    ok({ ...asTool, action_payload: { tool: "list_candidates", args: { stage: "APPLIED" } } }).ok, true);
  expect(problems, "a tool with no arguments at all is accepted",
    ok({ ...asTool, action_payload: { tool: "list_candidates" } }).ok, true);
  refusedWith("a list in the argument map's place",
    { ...asTool, action_payload: { tool: "list_candidates", args: ["APPLIED"] } }, "action_payload", /named single values/);
  refusedWith("an argument that holds a value",
    { ...asTool, action_payload: { tool: "list_candidates", args: { filters: { stage: "APPLIED" } } } }, "action_payload", /named single values/);

  // `note` and `ask` ceilings.
  refused("a note past its ceiling",
    { ...good, action_type: "note", action_payload: { text: "n".repeat(281) } }, "action_payload");
  refused("an empty note", { ...good, action_type: "note", action_payload: { text: "" } }, "action_payload");
  expect(problems, "an ask with no prompt is a valid ask",
    ok({ ...good, action_type: "ask", action_payload: {} }).ok, true);

  // Size: the 4 KB ceiling and the question ceiling are two different refusals.
  refusedWith("an over-sized payload",
    { ...good, action_type: "ask", action_payload: { prompt: "p".repeat(5000) } }, "action_payload", /4 KB/);
  refusedWith("a saved question past its own ceiling",
    { ...good, action_type: "ask", action_payload: { prompt: "p".repeat(2500) } }, "action_payload", /2000 characters/);
  // 16 is the byte count written out, not recomputed from the door's own formula, so
  // a wrong constant here is a red check. The column's canonical `::text` is longer
  // than this compact JSON — which is why `051`'s CHECK has headroom (R13).
  expect(problems, "the door measures the compact JSON of the payload", m.payloadBytes({ prompt: "abc" }), 16);

  // Notes on the row itself.
  refused("notes past 500", { ...good, notes: "n".repeat(501) }, "notes");
  refused("notes that are not text", { ...good, notes: 123 }, "notes");

  // `enabled`: a draft that leaves it out is a partial update, not a request to
  // switch a switched-off command back on; a draft that sends a string is refused.
  const okAgainstOff = (draft) => m.parseCommandDraft(draft, { ...PREV, id: "c9", enabled: false }, TOOLS);
  const staysOff = okAgainstOff({ ...good, enabled: undefined });
  expect(problems, "omitting enabled keeps a disabled command disabled",
    staysOff.ok ? staysOff.command.enabled : "refused", false);
  const switched = okAgainstOff({ ...good, enabled: true });
  expect(problems, "and an explicit yes is an explicit yes",
    switched.ok ? switched.command.enabled : "refused", true);
  refusedWith("an enabled that is not a yes or a no", { ...good, enabled: "true" }, "enabled", /yes or a no/);

  // `id`: the door does not let a body move a saved command's identity.
  refusedWith("a draft carrying somebody else's id", { ...good, id: "c2" }, "id", /keeps its own id/);
  expect(problems, "and its own id is not a refusal", okAgainstOff({ ...good, id: "c9" }).ok, true);

  // A refusal never touches the stored value: the message is the whole answer.
  const after = ok({ ...good, trigger_phrase: "x" });
  expect(problems, "a refusal carries no command", "command" in after, false);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 3. The read door renders a hand-edited row and names what it cannot read
// ---------------------------------------------------------------------------
async function check3() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    scope: "personal",
    owner_profile_id: "p1",
    trigger_phrase: "open the outbox",
    title: "Outbox",
    category: "communication",
    action_type: "open",
    action_payload: { href: "/whatsapp" },
    notes: null,
    enabled: true,
  };

  // A row the console wrote reads back whole.
  const good = m.normalizeCommandRow(base);
  expect(problems, "a sound row is enabled", good.enabled, true);
  expect(problems, "a sound row has no problem", good.problem, null);
  expect(problems, "a sound row carries its action", good.action, { type: "open", href: "/whatsapp" });
  expect(problems, "a sound row keeps its raw category", good.rawCategory, null);

  // A category nobody authored still renders, and says what it is.
  const odd = m.normalizeCommandRow({ ...base, category: "payroll" });
  expect(problems, "an unknown category reads as personal", odd.category, "personal");
  expect(problems, "the original string survives", odd.rawCategory, "payroll");
  expect(problems, "the row reports itself", odd.problem, "category");

  // A broken action is switched off, never guessed into being an `ask`.
  const broken = m.normalizeCommandRow({ ...base, action_type: "delete" });
  expect(problems, "an unknown action type carries no action", broken.action, null);
  expect(problems, "and is disabled", broken.enabled, false);
  expect(problems, "and names why", broken.problem, "action");

  // A payload that cannot express its type is the same refusal.
  const noHref = m.normalizeCommandRow({ ...base, action_payload: {} });
  expect(problems, "an `open` with no href carries no action", noHref.action, null);
  expect(problems, "an `open` with no href is disabled", noHref.enabled, false);

  // A shared row has no owner, and says so in its scope.
  const shared = m.normalizeCommandRow({ ...base, scope: "shared", owner_profile_id: null });
  expect(problems, "shared scope survives", shared.scope, "shared");
  expect(problems, "shared owner is null", shared.ownerProfileId, null);

  // A row the database should not accept at all is still a row the console lists.
  const shortPhrase = m.normalizeCommandRow({ ...base, trigger_phrase: "x" });
  expect(problems, "an over-short phrase is disabled", shortPhrase.enabled, false);
  expect(problems, "and reported", shortPhrase.problem, "phrase");

  // Length is not a problem this door may solve: it shows the whole stored string.
  const longTitle = m.normalizeCommandRow({ ...base, title: "t".repeat(200) });
  expect(problems, "an over-long title arrives whole", longTitle.title.length, 200);
  expect(problems, "and is not reported as a problem", longTitle.problem, null);

  // A tool row whose arguments hold a shape this type cannot carry is not run.
  const objectArgs = m.normalizeCommandRow({
    ...base,
    action_type: "tool",
    action_payload: { tool: "search_people", args: { filters: { company: 4 } } },
  });
  expect(problems, "an inexpressible args map carries no action", objectArgs.action, null);
  expect(problems, "and is disabled", objectArgs.enabled, false);
  expect(problems, "and names the action as the problem", objectArgs.problem, "action");

  // The same switch-off for the two shapes the loop used to coerce, so a row no
  // save could write is never a row this door runs.
  const arrayArgs = m.normalizeCommandRow({
    ...base,
    action_type: "tool",
    action_payload: { tool: "search_people", args: ["APPLIED"] },
  });
  expect(problems, "an array in the argument map's place carries no action", arrayArgs.action, null);
  const stringArgs = m.normalizeCommandRow({
    ...base,
    action_type: "tool",
    action_payload: { tool: "search_people", args: "stage=APPLIED" },
  });
  expect(problems, "a string in the argument map's place carries no action", stringArgs.action, null);
  expect(problems, "and an argument-less tool row still runs",
    m.normalizeCommandRow({ ...base, action_type: "tool", action_payload: { tool: "search_people" } }).action,
    { type: "tool", tool: "search_people", args: {} });

  // A payload that is not a set of fields is not read as an empty one. The `ask`
  // branch is the one that runs holding no fields at all, so a string wearing a
  // payload would otherwise become a command that asks nothing.
  const scalarPayload = m.normalizeCommandRow({
    ...base,
    action_type: "ask",
    action_payload: "open the outbox",
  });
  expect(problems, "a scalar payload carries no action", scalarPayload.action, null);
  expect(problems, "and names the action as the problem", scalarPayload.problem, "action");

  // A stored path that walks up is not the page its prefix names.
  const dotHref = m.normalizeCommandRow({ ...base, action_payload: { href: "/candidates/../login" } });
  expect(problems, "a dot-segment href carries no action", dotHref.action, null);
  expect(problems, "and is disabled", dotHref.enabled, false);

  // Read again, never trusted from the save: a row whose href left the staff pages
  // after it was written is switched off by this door whatever the writer allowed.
  const offSite = m.normalizeCommandRow({ ...base, action_payload: { href: "https://example.com/x" } });
  expect(problems, "a stored off-site href carries no action", offSite.action, null);
  expect(problems, "and is disabled", offSite.enabled, false);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 4. The matcher reads whole folded phrases, longest first, own scope first
// ---------------------------------------------------------------------------
async function check4() {
  const problems = [];
  const m = await load(DOMAIN_URL);
  const cmd = (over) => ({
    id: "c", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open the outbox",
    title: "Outbox", category: "communication", rawCategory: null,
    action: { type: "open", href: "/whatsapp" }, notes: null, enabled: true, problem: null,
    ...over,
  });

  // Whole tokens, not substrings.
  const one = [cmd({})];
  expect(problems, "an exact phrase matches", !!m.matchCommand("open the outbox", one), true);
  expect(problems, "a prefix of a longer spoken word does not", !!m.matchCommand("open the outboxes", one), false);
  expect(problems, "a shorter run does not", !!m.matchCommand("open the", one), false);
  expect(problems, "a phrase inside another sentence matches", !!m.matchCommand("hey jarvis open the outbox please", one), true);

  // Folding: the same words, differently spelled.
  const arabic = [cmd({ triggerPhrase: "افتح البريد", action: { type: "open", href: "/whatsapp" } })];
  expect(problems, "an alef form still matches", !!m.matchCommand("إفتح البريد", arabic), true);
  expect(problems, "case does not matter", !!m.matchCommand("OPEN   the   Outbox", one), true);

  // Longest wins.
  const short = cmd({ id: "s", triggerPhrase: "open", title: "Short" });
  const long = cmd({ id: "l", triggerPhrase: "open the outbox", title: "Long" });
  const both = m.matchCommand("open the outbox", [short, long]);
  expect(problems, "the more specific phrase runs", both?.command.id, "l");
  const onlyShort = m.matchCommand("open now", [short, long]);
  expect(problems, "and a shorter one still works alone", onlyShort?.command.id, "s");

  // Personal beats shared, at equal length.
  const mine = cmd({ id: "mine", scope: "personal", ownerProfileId: "p1", triggerPhrase: "open" });
  const theirs = cmd({ id: "theirs", scope: "shared", ownerProfileId: null, triggerPhrase: "open" });
  expect(problems, "the person's own wins", m.matchCommand("open", [theirs, mine])?.command.id, "mine");

  // Disabled commands never reach the matcher.
  expect(problems, "a disabled command is not matched",
    m.matchCommand("open the outbox", [cmd({ enabled: false })]), null);

  // The tail: what was said after the phrase, in the person's own casing.
  const ask = [cmd({ triggerPhrase: "ask about", action: { type: "ask" } })];
  const hit = m.matchCommand("ask about Ahmed Hassan", ask);
  expect(problems, "the tail is handed back", hit?.tail, "Ahmed Hassan");
  const noTail = m.matchCommand("ask about", ask);
  expect(problems, "and is empty when nothing followed", noTail?.tail, "");
  // A written word that folds into two spoken tokens, sitting inside the matched
  // run. `follow-up` is two tokens to the matcher and one word to the person who
  // typed it, so the tail has to be cut where the *word* ends, not where the
  // tokens did — otherwise the saved question loses the first word after a
  // hyphenated phrase, which is the ordinary case, not an edge.
  const hyphen = [cmd({ triggerPhrase: "open the follow-up", action: { type: "open", href: "/jobs" } })];
  const hyphenHit = m.matchCommand("open the follow-up Ahmed Hassan", hyphen);
  expect(problems, "a hyphenated phrase leaves its own word in the tail", hyphenHit?.command.triggerPhrase, "open the follow-up");
  expect(problems, "and the words after it are all still there", hyphenHit?.tail, "Ahmed Hassan");

  // The same four rules seen from the side a listing order or an unreadable row can
  // reach, so every guard the matcher has is pinned by a mutation of its own below.
  // A task that later loosens one of them has to watch it go red rather than mean to
  // keep it.
  expect(problems, "a row with no readable action is not matched",
    m.matchCommand("open the outbox", [cmd({ action: null, problem: "action" })]), null);
  expect(problems, "a row whose phrase was reported is not matched",
    m.matchCommand("open the outbox", [cmd({ problem: "phrase" })]), null);
  expect(problems, "a phrase that folds to no tokens matches nothing",
    m.matchCommand("open the outbox", [cmd({ triggerPhrase: "!!" })]), null);
  expect(problems, "an empty transcript matches nothing", m.matchCommand("     ", one), null);
  expect(problems, "longest wins with the rows listed the other way round",
    m.matchCommand("open the outbox", [long, short])?.command.id, "l");
  expect(problems, "and a shared row listed later does not steal the tie",
    m.matchCommand("open", [mine, theirs])?.command.id, "mine");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 5. 051 stores a command, scopes it, and gates the shared half
// ---------------------------------------------------------------------------
async function check5() {
  const problems = [];
  const sql = read(MIGRATION_REL);
  const has = (label, needle) => {
    if (!sql.includes(needle)) problems.push(`${label}: missing ${JSON.stringify(needle)}`);
  };

  has("the table", "create table if not exists public.assistant_jarvis_commands");
  has("scope CHECK", "constraint assistant_jarvis_commands_scope_owner check");
  has("a personal row has an owner", "(scope = 'personal' and owner_profile_id is not null)");
  has("a shared row has none", "(scope = 'shared' and owner_profile_id is null)");
  has("phrase ceiling", "char_length(btrim(trigger_phrase)) between 2 and 64");
  has("no control characters", "trigger_phrase !~ '[\\u0000-\\u001F]'");
  has("title ceiling", "char_length(btrim(title)) between 1 and 80");
  has("notes ceiling", "char_length(notes) <= 500");
  has("payload size", "octet_length(action_payload::text) <= 16384");
  has("the six categories", "category in ('navigation','hiring','communication','reports','settings','personal')");
  has("the four action types", "action_type in ('ask','open','tool','note')");

  // Two indexes, not one coalesce: the same phrase may exist once per person and
  // once for the portal, which is what makes "Add to mine" possible at all.
  has("the personal phrase index",
    "create unique index if not exists assistant_jarvis_commands_personal_phrase");
  has("  on owner and folded phrase", "on public.assistant_jarvis_commands (owner_profile_id, lower(btrim(trigger_phrase)))");
  has("  scoped to personal", "where scope = 'personal'");
  has("the shared phrase index", "create unique index if not exists assistant_jarvis_commands_shared_phrase");
  has("  scoped to shared", "where scope = 'shared'");

  // RLS: four policies on the person's own rows, four on the portal's.
  has("row security is on", "alter table public.assistant_jarvis_commands enable row level security");
  const personal = [
    "assistant_jarvis_commands_personal_select",
    "assistant_jarvis_commands_personal_insert",
    "assistant_jarvis_commands_personal_update",
    "assistant_jarvis_commands_personal_delete",
  ];
  for (const name of personal) has(`policy ${name}`, `create policy ${name}`);
  const shared = [
    "assistant_jarvis_commands_shared_select",
    "assistant_jarvis_commands_shared_insert",
    "assistant_jarvis_commands_shared_update",
    "assistant_jarvis_commands_shared_delete",
  ];
  for (const name of shared) has(`policy ${name}`, `create policy ${name}`);
  has("own rows by profile id", "(select current_user_profile_id()) = owner_profile_id");
  has("and only by staff", "and is_staff()");
  // Counted, not merely present: four shared-write guards (one insert, two update,
  // one delete). A `has` alone stays green when a policy loses its permission, which
  // is the exact break group 5's mutation makes below, so it would prove nothing.
  if ((sql.match(/has_permission\('assistant\.commands'\)/g) ?? []).length !== 4)
    problems.push("a shared write is not behind the permission (expected four guards)");

  // The permission and its grants.
  has("the permission row", "insert into public.permissions (key, label, group_name, description)");
  has("  named", "('assistant.commands', 'Publish shared JARVIS commands', 'Assistant',");
  has("  idempotent", "on conflict (key) do nothing");
  has("SUPER_ADMIN granted", "('SUPER_ADMIN', 'assistant.commands', true)");
  has("HIRING_MANAGER granted", "('HIRING_MANAGER', 'assistant.commands', true)");
  // No SUBSIDIARY_HR_MANAGER row: the grants table's enum can name it, but no
  // account's role column can hold it, so the row would be unreachable furniture.
  if (sql.includes("'SUBSIDIARY_HR_MANAGER', 'assistant.commands'")) {
    problems.push("the migration grants a role no account can hold");
  }

  // Four starters, navigation and saved-prompt only.
  has("the starters", "insert into public.assistant_jarvis_commands (scope, trigger_phrase, title, category, action_type, action_payload, notes)");
  has("  open candidates", "'open candidates', 'Open candidates', 'navigation', 'open', '{\"href\":\"/candidates\"}'::jsonb");
  has("  open the pipeline", "'open the pipeline', 'Open the pipeline', 'navigation', 'open', '{\"href\":\"/jobs\"}'::jsonb");
  has("  today's interviews", "'today''s interviews', 'Today''s interviews', 'hiring', 'ask',");
  has("  open the outbox", "'open the outbox', 'Open the outbox', 'communication', 'open', '{\"href\":\"/whatsapp\"}'::jsonb");
  // The starters statement alone, not the whole file: `'tool'` is also a member of
  // the action-type CHECK, so a file-wide search would redden this on every run.
  const seedStart = sql.indexOf("insert into public.assistant_jarvis_commands (scope, trigger_phrase");
  const seed = seedStart === -1 ? "" : sql.slice(seedStart, sql.indexOf(";", seedStart));
  if (seed.includes("'tool'")) problems.push("a seeded starter runs a tool; none may");

  has("grants to authenticated", "grant select, insert, update, delete on public.assistant_jarvis_commands to authenticated");
  has("service role", "grant all on public.assistant_jarvis_commands to service_role");
  has("anon kept out", "revoke all on public.assistant_jarvis_commands from anon");
  has("the updated_at trigger", "execute function set_updated_at()");
  has("PostgREST reloads", "notify pgrst, 'reload schema'");
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 5b. The list is read once, and says which failure it met
// ---------------------------------------------------------------------------
/**
 * One read answers three different questions — *the table is not there*, *the table
 * could not be reached*, *there is nothing here yet* — and the console says a
 * different sentence for each. The person's next action differs, so a read that
 * collapsed two of them would send somebody to a migration that would not help, or
 * explain an outage as a missing file.
 */
async function check5b() {
  const problems = [];
  const m = await load(READER_URL);

  // A fresh stub per case, and every case starts from a clean room, because an
  // inherited identity is exactly the bug these checks exist to catch.
  const reading = (payload) => {
    const rest = fakeRest(payload);
    resetGlobals({ __jarvisRest: rest.client });
    return rest;
  };

  // The table nobody created, answered the way PostgREST answers it.
  reading({ read: { data: null, error: ABSENT } });
  const absentRead = await m.readVoiceCommands();
  expect(problems, "an absent table is a problem", absentRead.problem, "absent");
  expect(problems, "with no commands", absentRead.commands.length, 0);
  expect(problems, "nothing capped", absentRead.capped, false);
  expect(problems, "and the file named",
    /051_jarvis_voice_commands\.sql is authored but not applied/.test(absentRead.message ?? ""), true);

  // An outage is not an unapplied file. Saying it was would send the person to a
  // migration they cannot run.
  reading({ read: { data: null, error: UNREADABLE } });
  const broken = await m.readVoiceCommands();
  expect(problems, "an outage is a different problem", broken.problem, "unreadable");
  expect(problems, "and does not name the migration", /051/.test(broken.message ?? ""), false);
  expect(problems, "and still says nothing will run", /nothing spoken will run/.test(broken.message ?? ""), true);

  // Present and empty: a person who has saved nothing, on a database that has the
  // table. Neither failure, and no sentence.
  reading({ read: { data: [], error: null } });
  const empty = await m.readVoiceCommands();
  expect(problems, "an empty list is not a problem", empty.problem, null);
  expect(problems, "and says nothing", empty.message, null);
  expect(problems, "with no commands", empty.commands.length, 0);

  // Present with rows, personal and shared, merged in one read because RLS decides
  // what the person may see and a second, scope-filtered query would be a weaker
  // copy of that decision.
  const rows = [
    { id: "1", scope: "personal", owner_profile_id: "p1", trigger_phrase: "open mine", title: "Mine",
      category: "personal", action_type: "note", action_payload: { text: "hi" }, notes: null, enabled: true },
    { id: "2", scope: "shared", owner_profile_id: null, trigger_phrase: "open the outbox", title: "Outbox",
      category: "communication", action_type: "open", action_payload: { href: "/whatsapp" }, notes: null, enabled: true },
  ];
  const filledRest = reading({ read: { data: rows, error: null } });
  const filled = await m.readVoiceCommands();
  expect(problems, "both halves arrive", filled.commands.map((command) => command.scope), ["personal", "shared"]);
  expect(problems, "one table read, not one per scope",
    filledRest.calls.filter((call) => call.table === "assistant_jarvis_commands").length, 1);
  expect(problems, "asking for one row more than it shows", filledRest.calls[0]?.limit, 201);

  // The cap, disclosed rather than silently applied.
  const many = Array.from({ length: 201 }, (_, index) => ({
    id: `m${index}`, scope: "personal", owner_profile_id: "p1", trigger_phrase: `phrase ${index}`,
    title: `T${index}`, category: "personal", action_type: "note",
    action_payload: { text: "x" }, notes: null, enabled: true,
  }));
  reading({ read: { data: many, error: null } });
  const capped = await m.readVoiceCommands();
  expect(problems, "the read is bounded", capped.commands.length, 200);
  expect(problems, "and says it was", capped.capped, true);
  expect(problems, "naming the number it kept", /first 200 commands/.test(capped.message ?? ""), true);

  // The one-row read A6's update uses: the same answered list, found in it.
  reading({ read: { data: rows, error: null } });
  const found = await m.readVoiceCommand("2");
  expect(problems, "the one-row read finds its row", found.command?.id, "2");
  expect(problems, "through the same answered read", found.read.problem, null);
  const miss = await m.readVoiceCommand("nope");
  expect(problems, "a miss is a miss, not a failure", miss.command, null);
  expect(problems, "with the read still answering", miss.read.problem, null);
  return verdict(problems);
}

// ---------------------------------------------------------------------------
// 5c. The migration-claims proof asks about 051 by the table it creates
// ---------------------------------------------------------------------------
async function check5c() {
  const problems = [];
  const claims = read("scripts/prove-migration-claims.mjs");
  if (!claims.includes('file: "051_jarvis_voice_commands.sql"')) {
    problems.push("prove-migration-claims does not ask about 051");
  }
  if (!claims.includes("to_regclass('public.assistant_jarvis_commands')")) {
    problems.push("the 051 probe does not name the table");
  }
  // That proof requires every migration it asks about to be named in src/, with the
  // polarity stated within a sentence. This sentence is the one that does it, so the
  // two halves of the task have to land together or the claims proof goes red.
  const reader = read(READER_REL);
  const at = reader.indexOf("db/migrations/051_jarvis_voice_commands.sql");
  if (at === -1) problems.push("no src/ file names 051, so the claims proof cannot read it");
  else if (!/not applied/.test(reader.slice(at, at + 200))) {
    problems.push("the sentence naming 051 does not say whether this database has it");
  }
  return verdict(problems);
}

async function check2b() {
  const problems = [];
  if (!existsSync(path.join(root, ACTIONS_REL))) return verdict(["The five command actions are missing"]);
  const actions = await load(ACTIONS_URL);
  const row = {
    id: "c1", scope: "personal", owner_profile_id: "p1", trigger_phrase: "open mine",
    title: "Mine", category: "personal", action_type: "note",
    action_payload: { text: "hello" }, notes: null, enabled: true,
  };
  const draft = {
    trigger_phrase: "open mine", title: "Mine", category: "personal",
    action_type: "note", action_payload: { text: "hello" }, notes: "", enabled: true,
  };
  const user = { profileId: "p1", fullName: "Test staff", role: "SUPER_ADMIN" };
  const setup = (rows = [row], options = {}, permission = true) => {
    const rest = fakeRest({
      read: { data: rows, error: null },
      write: (call) => ({ data: { ...row, ...call.body, id: call.verb === "insert" ? "created-id" : "c1" }, error: null }),
      ...options,
    });
    const trail = [];
    resetGlobals({ __jarvisUser: user, __jarvisRest: rest.client, __jarvisTrail: trail, __jarvisPermission: permission });
    return { ...rest, trail };
  };
  const writes = (rest) => rest.calls.filter((call) => call.verb !== "select");
  const trailed = (rest, label) => {
    expect(problems, `${label} leaves exactly one trail entry`, rest.trail.length, 1);
    expect(problems, `${label} records settings`, rest.trail[0]?.area, "settings");
    expect(problems, `${label} records a setting entity`, rest.trail[0]?.entity, "setting");
    expect(problems, `${label} records the session actor`, rest.trail[0]?.actorId, "p1");
  };
  let rest = setup();
  const saved = await actions.saveCommand({ ...draft, scope: "shared", owner_profile_id: "p2" }, "personal");
  expect(problems, "a good save succeeds", saved.ok, true);
  expect(problems, "the save returns the database identity", saved.command?.id, "created-id");
  const inserted = writes(rest)[0];
  expect(problems, "the command table is written", inserted?.table, "assistant_jarvis_commands");
  expect(problems, "new commands insert", inserted?.verb, "insert");
  expect(problems, "only table columns are sent", Object.keys(inserted?.body ?? {}).sort(), [
    "action_payload", "action_type", "category", "enabled", "notes", "owner_profile_id", "scope", "title", "trigger_phrase",
  ]);
  expect(problems, "scope comes from the argument", inserted?.body?.scope, "personal");
  expect(problems, "owner comes from the session", inserted?.body?.owner_profile_id, "p1");
  expect(problems, "action type is a string", inserted?.body?.action_type, "note");
  expect(problems, "action payload is separate", inserted?.body?.action_payload, { text: "hello" });
  trailed(rest, "save");

  rest = setup();
  expect(problems, "updating an existing row succeeds", (await actions.saveCommand({ ...draft, id: "c1" }, "personal")).ok, true);
  expect(problems, "update names its row", writes(rest)[0]?.filters?.some((f) => JSON.stringify(f) === JSON.stringify(["eq", "id", "c1"])), true);
  expect(problems, "existing rows update", writes(rest)[0]?.verb, "update");

  rest = setup([], {}, true);
  expect(problems, "shared save with permission succeeds", (await actions.saveCommand(draft, "shared")).ok, true);
  expect(problems, "shared rows have no owner", writes(rest)[0]?.body?.owner_profile_id, null);

  const shared = { ...row, id: "s1", scope: "shared", owner_profile_id: null };
  for (const [label, run] of [
    ["save", () => actions.saveCommand(draft, "shared")],
    ["duplicate", () => actions.duplicateCommand("s1")],
    ["delete", () => actions.deleteCommand("s1")],
    ["switch", () => actions.setCommandEnabled("s1", false)],
    ["move shared into personal", () => actions.saveCommand({ ...draft, id: "s1" }, "personal")],
  ]) {
    rest = setup([shared], {}, false);
    const refused = await run();
    expect(problems, `${label} refuses shared writes without permission`, refused.ok, false);
    expect(problems, `${label} has no write`, writes(rest).length, 0);
    expect(problems, `${label} leaves no false trail`, rest.trail.length, 0);
  }

  for (const [label, run] of [
    ["save", () => actions.saveCommand({ ...draft, id: "c1" }, "personal")],
    ["duplicate", () => actions.duplicateCommand("c1")],
    ["delete", () => actions.deleteCommand("c1")],
    ["switch", () => actions.setCommandEnabled("c1", true)],
  ]) {
    rest = setup([{ ...row, owner_profile_id: "p2" }]);
    expect(problems, `${label} cannot write another person's row`, (await run()).ok, false);
    expect(problems, `${label} stops before transport`, writes(rest).length, 0);
  }

  rest = setup([], { write: { error: { code: "23505", message: "duplicate key" } } });
  const clash = await actions.saveCommand(draft, "personal");
  expect(problems, "duplicate phrase refuses", clash.ok, false);
  expect(problems, "duplicate phrase names its field", clash.field, "trigger_phrase");
  expect(problems, "duplicate phrase quotes the phrase", /open mine/.test(clash.error ?? ""), true);
  expect(problems, "failed writes are not trailed", rest.trail.length, 0);

  for (const error of [ABSENT, UNREADABLE]) {
    rest = setup([], { read: { data: null, error } });
    const refused = await actions.saveCommand(draft, "personal");
    expect(problems, "a failed read refuses a save", refused.ok, false);
    expect(problems, "only absence names 051", /051_jarvis_voice_commands\.sql/.test(refused.error ?? ""), error === ABSENT);
    expect(problems, "a failed read never becomes an insert", writes(rest).length, 0);
  }

  rest = setup();
  expect(problems, "switch succeeds", (await actions.setCommandEnabled("c1", false)).ok, true);
  expect(problems, "switch writes only enabled", writes(rest)[0]?.body, { enabled: false });
  trailed(rest, "switch");
  rest = setup();
  expect(problems, "delete succeeds", (await actions.deleteCommand("c1")).ok, true);
  expect(problems, "one delete only", writes(rest).map((c) => c.verb), ["delete"]);
  expect(problems, "delete names its row", writes(rest)[0]?.filters?.some((f) => JSON.stringify(f) === JSON.stringify(["eq", "id", "c1"])), true);
  trailed(rest, "delete");
  rest = setup();
  expect(problems, "duplicate succeeds", (await actions.duplicateCommand("c1")).ok, true);
  expect(problems, "duplicate uses a new phrase", writes(rest)[0]?.body?.trigger_phrase, "open mine copy");
  expect(problems, "duplicate stays personal", writes(rest)[0]?.body?.owner_profile_id, "p1");
  trailed(rest, "duplicate");
  rest = setup([shared], {}, false);
  expect(problems, "adoption needs no publish permission", (await actions.adoptSharedCommand("s1")).ok, true);
  expect(problems, "adoption is personal", writes(rest)[0]?.body?.scope, "personal");
  expect(problems, "adoption keeps phrase", writes(rest)[0]?.body?.trigger_phrase, "open mine");
  expect(problems, "adoption uses session owner", writes(rest)[0]?.body?.owner_profile_id, "p1");
  trailed(rest, "adoption");

  for (const [label, run] of [
    ["missing update", () => actions.saveCommand({ ...draft, id: "missing" }, "personal")],
    ["invalid scope", () => actions.saveCommand(draft, "invented")],
    ["invalid enabled", () => actions.setCommandEnabled("c1", "false")],
    ["invalid draft", () => actions.saveCommand(null, "personal")],
    ["personal adoption", () => actions.adoptSharedCommand("c1")],
    ["invalid phrase", () => actions.saveCommand({ ...draft, trigger_phrase: "x" }, "personal")],
  ]) {
    rest = setup();
    expect(problems, `${label} refuses`, (await run()).ok, false);
    expect(problems, `${label} never writes`, writes(rest).length, 0);
  }
  for (const run of [
    () => actions.saveCommand({ ...draft, id: "c1" }, "personal"),
    () => actions.deleteCommand("c1"),
    () => actions.setCommandEnabled("c1", false),
  ]) {
    rest = setup([row], { write: { data: null, error: null } });
    expect(problems, "zero affected rows is not success", (await run()).ok, false);
    expect(problems, "zero affected rows has no success trail", rest.trail.length, 0);
  }

  rest = setup([{ ...row, action_payload: { text: "" } }]);
  expect(problems, "an unreadable action cannot be enabled", (await actions.setCommandEnabled("c1", true)).ok, false);
  expect(problems, "enabling an unreadable action never writes", writes(rest).length, 0);
  expect(problems, "an unreadable action can be disabled", (await actions.setCommandEnabled("c1", false)).ok, true);

  for (const [source, run] of [
    [{ ...row, category: "unknown" }, () => actions.duplicateCommand("c1")],
    [{ ...shared, category: "unknown" }, () => actions.adoptSharedCommand("s1")],
  ]) {
    rest = setup([source]);
    expect(problems, "copying does not repair an unknown stored category", (await run()).ok, false);
    expect(problems, "an invalid copy never writes", writes(rest).length, 0);
  }

  rest = setup([{ ...row, trigger_phrase: "a".repeat(64), title: "b".repeat(80) }]);
  expect(problems, "a maximum-length command can be duplicated", (await actions.duplicateCommand("c1")).ok, true);
  expect(problems, "the duplicate retains its phrase suffix", writes(rest)[0]?.body?.trigger_phrase, "a".repeat(59) + " copy");
  expect(problems, "the duplicate retains its title suffix", writes(rest)[0]?.body?.title, "b".repeat(73) + " (copy)");

  for (const run of [
    () => actions.saveCommand(draft, "personal"),
    () => actions.duplicateCommand("c1"),
    () => actions.deleteCommand("c1"),
    () => actions.setCommandEnabled("c1", false),
    () => actions.adoptSharedCommand("s1"),
  ]) {
    rest = setup([row, shared]);
    globalThis.__jarvisUser = null;
    let rejected = false;
    try { await run(); } catch (error) { rejected = /no staff session/.test(error.message); }
    expect(problems, "every action requires a staff session", rejected, true);
    expect(problems, "signed-out actions never write", writes(rest).length, 0);
  }
  return verdict(problems);
}

async function check6a() {
  const problems = [];
  const nav = await load(pathToFileURL(path.join(root, "src/modules/settings/domain/settingsNav.ts")).href);
  const area = nav.areaById("assistant");
  expect(problems, "commands resolves to its own section", nav.sectionFor(area, "commands").id, "commands");
  expect(problems, "the default stays presence", nav.sectionFor(area, undefined).id, "presence");
  const { DEFAULT_JARVIS_PREFS } = await load(pathToFileURL(path.join(root, "src/modules/assistant/domain/jarvis.ts")).href);
  const actions = await load(pathToFileURL(path.join(root, "src/app/(admin)/settings/jarvis-actions.ts")).href);
  const row = { id: "presence-command", scope: "personal", owner_profile_id: "p1", trigger_phrase: "open reports", title: "Reports", category: "reports", action_type: "open", action_payload: { href: "/reports" }, notes: null, enabled: true };
  for (const [data, error, expected] of [
    [[row], null, ["presence-command"]],
    [null, { code: "42P01", message: "missing table" }, []],
    [null, { code: "42501", message: "unreadable" }, []],
  ]) {
    const rest = fakeRest({ read: { data, error } });
    resetGlobals({ __jarvisUser: { profileId: "p1", role: "RECRUITER" }, __jarvisPrefs: DEFAULT_JARVIS_PREFS, __jarvisRest: rest.client });
    const result = await actions.getJarvisPresence();
    expect(problems, "preferences survive a command read", result.prefs, DEFAULT_JARVIS_PREFS);
    expect(problems, "presence carries only the reader's commands", result.commands?.map((entry) => entry.id), expected);
    expect(problems, "one command read per presence refresh", rest.calls.filter((call) => call.table === "assistant_jarvis_commands").length, 1);
  }
  const rest = fakeRest({ read: { data: [row], error: null } });
  resetGlobals({ __jarvisUser: { profileId: "p1", role: "RECRUITER" }, __jarvisPrefs: { reason: "unreadable", message: "Preferences cannot be read" }, __jarvisRest: rest.client });
  const unarmed = await actions.getJarvisPresence();
  expect(problems, "unarmed presence stays unarmed", unarmed.ok, false);
  expect(problems, "unarmed response carries no commands", "commands" in unarmed, false);
  resetGlobals({ __jarvisRest: rest.client });
  let rejected = false;
  try { await actions.getJarvisPresence(); } catch { rejected = true; }
  expect(problems, "presence still needs staff", rejected, true);
  expect(problems, "commands do not join live polling", /assistant_jarvis_commands/.test(read("src/modules/live/domain/watch.ts")), false);
  return verdict(problems);
}

const CHECKS = [
  ["1. The six categories and four action types are the shipped vocabulary", check1],
  ["2. The write door refuses every field it cannot express", check2],
  ["3. The read door renders a hand-edited row and names what it cannot read", check3],
  ["4. The matcher reads whole folded phrases, longest first, own scope first", check4],
  ["5. 051 stores a command, scopes it, and gates the shared half", check5],
  ["5b. The list is read once, and says which failure it met", check5b],
  ["5c. The migration-claims proof asks about 051 by the table it creates", check5c],
  ["2b. The five actions write the columns the table has, and never a scope the body named", check2b],
  ["6a. Settings resolves the manager and presence carries its scoped command read", check6a],
  ["6b. Commands dispatch before the model and retain approval and transcript boundaries", async () => {
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern=command (dispatch|server)", "scripts/prove-assistant-merge.mjs"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    return { pass: run.status === 0, detail: run.status === 0 ? "Behavioral dispatch and server checks passed" : `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
  }],
];

for (const [name, run] of CHECKS) {
  results.push([name, await safe(run)]);
}

// ---------------------------------------------------------------------------
// Mutation proofs
// ---------------------------------------------------------------------------

const checkIsRed = async (number) => {
  const outcome = await safe(CHECKS[number - 1][1]);
  const threw = String(outcome.detail ?? "").startsWith("threw:");
  if (threw) return { pass: false, detail: outcome.detail };
  if (outcome.pass) return { pass: false, detail: "check stayed green" };
  return { pass: true, detail: outcome.detail };
};

async function mutation(label, rel, needle, replacement, verify) {
  const file = path.join(root, rel);
  let original = null;
  const restore = () => {
    if (original === null) return;
    try {
      writeFileSync(file, original);
    } catch {
      // Nothing left to write to; the next run's read will report the damage.
    }
    original = null;
  };
  const onSignal = () => {
    restore();
    process.exit(1);
  };
  try {
    // Read inside the `try`, so a missing target is a red mutation, not a crash
    // before any results print.
    original = readFileSync(file, "utf8");
    // The repository's SQL carries CRLF and its TypeScript LF, so a multi-line
    // needle is matched in whichever form the file actually holds, and the
    // replacement is written back in that same form.
    const forms = [needle, needle.replace(/\n/g, "\r\n")];
    const matched = forms.find((form) => original.includes(form));
    if (!matched) {
      mutations.push({ label, pass: false, detail: `needle not found in ${rel}` });
      return;
    }
    const asMatched = matched === needle ? replacement : replacement.replace(/\n/g, "\r\n");
    const mutated = original.replace(matched, () => asMatched);
    process.once("exit", restore);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    writeFileSync(file, mutated);
    mutations.push({ label, ...(await verify()) });
  } catch (cause) {
    mutations.push({ label, pass: false, detail: `threw: ${cause.message}` });
  } finally {
    process.off("exit", restore);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restore();
  }
}

await mutation(
  "1. The write door letting an off-site href through → check 2 red",
  DOMAIN_REL,
  "    if (!isStaffPath(pathname)) {",
  "    if (false) {",
  async () => checkIsRed(2)
);

// Every guard this task added is pinned by a mutation of its own, so a later task
// that quietly restores a coercion has to watch a check go red to do it. The last
// four are proven from the read door's side — the same breaks, seen there.
await mutation(
  "2. The shared argument predicate coercing a container it cannot express → check 3 red",
  DOMAIN_REL,
  "  if (!isPlainObject(container)) return null;",
  "  if (!isPlainObject(container)) return {};",
  async () => checkIsRed(3)
);

await mutation(
  "3. The read door trusting a stored payload it was not given as fields → check 3 red",
  DOMAIN_REL,
  "  if (payload !== undefined && payload !== null && !isPlainObject(payload)) return null;",
  "  if (false) return null;",
  async () => checkIsRed(3)
);

await mutation(
  "4. The read door letting a stored path walk up → check 3 red",
  DOMAIN_REL,
  "      if (hasDotSegment(pathname)) return null;",
  "      if (false) return null;",
  async () => checkIsRed(3)
);

await mutation(
  "5. The read door trusting the save about which pages are staff pages → check 3 red",
  DOMAIN_REL,
  "      if (!isStaffPath(pathname)) return null;",
  "      if (false) return null;",
  async () => checkIsRed(3)
);

// The matcher's guards, each loosened exactly once and never tightened: every
// replacement below accepts something its guard refused, so a mutation that stops
// turning check 4 red means the guard stopped being what holds the rule.
await mutation(
  "6. The matcher accepting a substring instead of a run of tokens → check 4 red",
  DOMAIN_REL,
  "    if (haystack[at + index] !== needle[index]) return false;",
  "    if (!haystack[at + index]?.startsWith(needle[index])) return false;",
  async () => checkIsRed(4)
);

await mutation(
  "7. The matcher letting a row it was told to drop before matching → check 4 red",
  DOMAIN_REL,
  '    if (!command.enabled || command.action === null || command.problem === "phrase") continue;',
  "    if (false) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "8. The matcher letting a phrase that folds to no tokens match every sentence → check 4 red",
  DOMAIN_REL,
  "    if (wanted.length === 0) continue;",
  "    if (false) continue;",
  async () => checkIsRed(4)
);

await mutation(
  "9. The matcher letting a shorter phrase overwrite the longest one → check 4 red",
  DOMAIN_REL,
  "        wanted.length > best.length ||",
  "        true ||",
  async () => checkIsRed(4)
);

await mutation(
  "10. The matcher letting any equal-length phrase overwrite the person's own → check 4 red",
  DOMAIN_REL,
  '        (wanted.length === best.length && command.scope === "personal" && best.command.scope === "shared");',
  "        (wanted.length === best.length && true);",
  async () => checkIsRed(4)
);

// The folded-to-raw map. This one is not a permissiveness question — the break it
// guards is a *wrong* tail, not an extra match — so the needle is the slice itself,
// and the replacement is the code this task shipped before its own fix round: it
// passes every fixture that does not fold a word into two tokens, and fails the
// hyphenated one.
await mutation(
  "11. The tail cut at the token count instead of the word count → check 4 red",
  DOMAIN_REL,
  '  return { command: best.command, tail: raw.slice(after[best.at + best.length - 1]).join(" ") };',
  '  return { command: best.command, tail: raw.slice(best.at + best.length).join(" ") };',
  async () => checkIsRed(4)
);

// The duplicate splitter, diverged by a real edit rather than by deleting the line:
// a period no longer splits, so `open. the outbox` folds to a token the stored
// phrase can never equal. The divergence is also a behaviour break, which is why the
// needle is a character class.
await mutation(
  "12. The command splitter splitting on fewer characters than the stop-word splitter → check 1 red",
  DOMAIN_REL,
  "const TOKEN_SPLIT = /[\\s,.;:!?\"'()]+/;",
  "const TOKEN_SPLIT = /[\\s,;:!?\"'()]+/;",
  async () => checkIsRed(1)
);

// One of the four shared-write guards, and the *insert* one on purpose: the
// update and delete policies still spell the permission, so a `has` on that string
// would stay green. Check 5 counts them, which is what makes this go red.
await mutation(
  "13. A shared row writable by any staff member → check 5 red",
  MIGRATION_REL,
  "    scope = 'shared' and is_staff() and has_permission('assistant.commands')\n  );\n\ncreate policy assistant_jarvis_commands_shared_update",
  "    scope = 'shared' and is_staff()\n  );\n\ncreate policy assistant_jarvis_commands_shared_update",
  async () => checkIsRed(5)
);

// The reader's two decisions that change what a person is told. The first is the
// one that costs a working portal an outage explanation: an unreadable table
// reported as an unapplied file sends somebody to run a migration that is already
// there. The second is the cap — a list silently cut is a list that lies about what
// the person can say.
await mutation(
  "14. The reader reporting an outage as an unapplied file → check 5b red",
  READER_REL,
  "    if (isMissing(error)) {",
  "    if (true) {",
  async () => checkIsRed(6)
);

await mutation(
  "15. The reader keeping every row it was given → check 5b red",
  READER_REL,
  "  const capped = rows.length > COMMAND_LIMITS.rows;",
  "  const capped = false;",
  async () => checkIsRed(6)
);

await mutation(
  "16. A shared save skipping publish permission → check 2b red",
  ACTIONS_REL,
  '  if (scope === "shared" && !(await hasPermissionForUser("assistant.commands"))) {',
  '  if (scope === "shared" && false) {',
  async () => checkIsRed(8)
);

await mutation(
  "17. Existing shared commands writable without permission → check 2b red",
  ACTIONS_REL,
  '    return await hasPermissionForUser("assistant.commands")',
  '    return true',
  async () => checkIsRed(8)
);

await mutation(
  "18. Personal writes ignoring the session owner → check 2b red",
  ACTIONS_REL,
  '  return command.ownerProfileId === profileId ? null : NOT_FOUND;',
  '  return null;',
  async () => checkIsRed(8)
);

await mutation(
  "19. A zero-row delete reported as successful → check 2b red",
  ACTIONS_REL,
  '  if (!data) return { ok: false, error: NOT_FOUND };\n  await trail(staff.profileId, "command deleted",',
  '  await trail(staff.profileId, "command deleted",',
  async () => checkIsRed(8)
);

await mutation(
  "20. Enabling a stored command whose action cannot be read → check 2b red",
  ACTIONS_REL,
  '  if (enabled && command.problem) return',
  '  if (false) return',
  async () => checkIsRed(8)
);

await mutation(
  "21. Copying an unknown category silently repairs it → check 2b red",
  ACTIONS_REL,
  '    category: command.rawCategory ?? command.category,',
  '    category: command.category,',
  async () => checkIsRed(8)
);

function managerIsRed(name) {
  const run = spawnSync(process.execPath, [
    "--test", "--test-reporter=tap", `--test-name-pattern=${name}`,
    "scripts/prove-assistant-merge.mjs",
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const pass = run.status === 1 && output.includes("ERR_ASSERTION") && /# fail 1\b/.test(output);
  return { pass, detail: pass ? `${name}: assertion failed` : output || String(run.error) };
}

const MANAGER_REL = "src/app/(admin)/settings/JarvisCommandsConsole.tsx";
for (const [label, needle, replacement, testName] of [
  ["22. Shared readers gain editor controls",
    '(scope === "personal" || canPublish)', 'true',
    "command manager gives shared readers adoption"],
  ["23. Search stops folding spoken punctuation and case",
    'const needle = fold(query);', 'const needle = query;',
    "command manager filters folded phrase"],
  ["24. Query changes discard the current section and filters",
    'new URLSearchParams(window.location.search)', 'new URLSearchParams()',
    "command manager filters folded phrase"],
  ["25. A refused save loses its field error",
    'if (!result.ok) { setRefusal(result); return; }', 'if (!result.ok) { return; }',
    "command manager edits each action payload"],
  ["26. Returned command rows never reach the list",
    'if (command) setRows(', 'if (false) setRows(',
    "command manager applies returned rows"],
  ["27. The first delete click skips confirmation",
    'onClick={() => setConfirming(true)}', 'onClick={onDelete}',
    "command manager applies returned rows"],
  ["28. Shared authoring sends personal scope",
    'saveCommand(draft, scope)', 'saveCommand(draft, "personal")',
    "command manager lets a publisher author shared commands"],
  ["29. A malformed stored category loses its raw value",
    'command?.rawCategory ?? command?.category ?? "personal"', 'command?.category ?? "personal"',
    "command manager reports malformed stored values"],
]) {
  await mutation(`${label} → manager assertion red`, MANAGER_REL, needle, replacement,
    async () => managerIsRed(testName));
}

await mutation(
  "30. Presence drops the scoped commands it read → check 6a red",
  "src/app/(admin)/settings/jarvis-actions.ts",
  "commands: commands.commands",
  "commands: []",
  async () => checkIsRed(9)
);

for (const [label, rel, needle, replacement, testName] of [
  ["31. Matched commands fall through to the model", PRESENCE_REL,
    "if (matched && action) {", "if (false) {",
    "command dispatch presence routes open"],
  ["32. Pending commands are silently overwritten", STORE_REL,
    "if (state.pendingCommand) {", "if (false) {",
    "command dispatch store keeps one"],
  ["33. Saved questions are not sent", CHAT_REL,
    "await send(request.prompt);", "return;",
    "command dispatch chat sends a saved ask"],
  ["34. The browser's title replaces the stored label", RUNNER_REL,
    "title: command.title,\n    reply,", 'title: input.title,\n    reply,',
    "command server re-reads the row"],
  ["35. Disabled commands can run", RUNNER_REL,
    "!command.enabled || command.problem", "command.problem",
    "command server refuses missing disabled"],
  ["36. The destructive switch is opened", RUNNER_REL,
    "runTool(action.tool, action.args, false, staff.profileId, false, autonomy.level)", "runTool(action.tool, action.args, true, staff.profileId, false, autonomy.level)",
    "command server keeps destructive"],
  ["37. The web switch is opened", RUNNER_REL,
    "runTool(action.tool, action.args, false, staff.profileId, false, autonomy.level)", "runTool(action.tool, action.args, false, staff.profileId, true, autonomy.level)",
    "command server keeps destructive"],
  ["38. A pending approval is called a refusal", RUNNER_REL,
    "const reply = step.approval", "const reply = false",
    "command server keeps destructive"],
  ["39. Commands overwrite the chosen model engine", "src/modules/assistant/infrastructure/transcriptStore.ts",
    "...(input.engine === null ? {} : { engine: input.engine })", "engine: input.engine",
    "command server keeps destructive"],
  ["40. Save failures lose their disclosure", RUNNER_REL,
    "{ saveError: saved.error }", "{}",
    "command server preserves results"],
  ["41. Commands steal a pending approval verdict", PRESENCE_REL,
    "ui.pendingApproval ? null : matchCommand(", "matchCommand(",
    "command dispatch preserves a pending approval"],
  ["42. A matched note leaves the follow-up window open", PRESENCE_REL,
    "setJarvisAwaiting(false);", "setJarvisAwaiting(true);",
    "command dispatch ends the follow-up"],
  ["43. A saved question buries a pending approval", CHAT_REL,
    "if (liveApproval) {\n        setJarvisCommandNote", "if (false) {\n        setJarvisCommandNote",
    "command dispatch chat keeps an approval"],
  ["44. A consumed command remains replayable", STORE_REL,
    "emit({ ...state, pendingCommand: null });", "emit({ ...state });",
    "command dispatch store keeps one"],
  ["45. Draft protection is skipped", CHAT_REL,
    "const blocked = spokenTurnBlocked();\n      if (blocked)", "const blocked = null;\n      if (blocked)",
    "command dispatch chat sends a saved ask"],
]) {
  await mutation(`${label} → behavioral assertion red`, rel, needle, replacement, async () => managerIsRed(testName));
}

const failed = results.filter(([, outcome]) => !outcome.pass);
console.log("");
for (const [name, outcome] of results) {
  console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${name}`);
  if (!outcome.pass) console.log(`      ${outcome.detail}`);
}
for (const entry of mutations) {
  console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.label}`);
  if (entry.detail) console.log(`      ${entry.detail}`);
}
console.log("");
console.log(
  `${results.length - failed.length}/${results.length} checks held, ${mutations.filter((m) => m.pass).length}/${mutations.length} mutations turned red.`
);
process.exitCode = failed.length === 0 && mutations.every((m) => m.pass) ? 0 : 1;
