/* scripts/prove-notification-templates.mjs
 * Run: node --experimental-strip-types scripts/prove-notification-templates.mjs
 *
 * The templates console opens with "Every row below is live copy: each alert looks
 * its row up at send time". Three readers decide whether that is true, and until
 * now none of them were measured against the table or against the console's own
 * "Not sent yet" badge:
 *
 *   1. `resolveTemplate` asks for WhatsApp's keys with `.eq("channel","WHATSAPP")`;
 *   2. `resolveEmailCopy` asks for email's with `.eq("channel","EMAIL")`;
 *   3. the Sourcing board asks for its two prospects by key alone, no channel.
 *
 * So a row shapes a message only when *its channel and its key together* appear in
 * one of those three asks. The badge used to answer a looser question — is this key
 * on any channel's list? — which called an `IN_APP` row live copy and promised that
 * deleting it would send the shipped wording, while the tab strip on the same page
 * said plainly that no flow reads an `IN_APP` row. The same looseness would have
 * sworn that a `stage_offer` row filed under Email is the offer letter.
 *
 * The checks are deliberately two-sided: the readers are parsed out of the dispatch
 * files, the wiring is called for real out of the domain module, and the two must
 * agree in both directions, so a new key or a fourth reader cannot be half declared.
 * The live table and the `db/schema.sql` rows a fresh install is built from are read
 * for real, because a proof that only inspects source would not see a row somebody
 * saved straight into the database.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const mod = await import("../src/modules/settings/domain/templates.ts");
const {
  ASSESSMENT_INVITE_TEMPLATE,
  EMAIL_INTERVIEW_TEMPLATES,
  EMAIL_STAGE_TEMPLATES,
  EMAIL_SUBJECT_DEFAULTS,
  EMAIL_SUBJECT_FALLBACK,
  EMAIL_TEMPLATE_DEFAULTS,
  PROSPECT_OUTREACH_TEMPLATES,
  STAGE_FALLBACK_TEMPLATE,
  TEMPLATE_DEFAULTS,
  TEMPLATE_PURPOSE,
  WHATSAPP_INTERVIEW_TEMPLATES,
  WHATSAPP_STAGE_TEMPLATES,
  shippedTemplate,
  templateIsWired,
} = mod;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}

const WHATSAPP_FILE = "src/modules/omnichannel/application/whatsapp-dispatch.ts";
const EMAIL_FILE = "src/modules/omnichannel/application/candidate-notifications.ts";
const BOARD_FILE = "src/app/(admin)/sourcing/actions.ts";
const CONSOLE_FILE = "src/app/(admin)/settings/TemplatesConsole.tsx";

/**
 * The keys one reader asks for, recovered from its call sites.
 *
 * An argument is either one of the domain's exported tables or a local const that
 * indexes one (`const emailKey = EMAIL_STAGE_TEMPLATES[stage]`), and locals nest
 * (`const keys = emailKey ? [emailKey, STAGE_FALLBACK_TEMPLATE] : […]`), so the walk
 * follows assignments until nothing is left to expand. Strings are blanked out first:
 * `const stage = "NEW"` names a stage, not a table, and a reader that asks for a key
 * the domain does not export is a finding, not a crash.
 */
const DOMAIN_TABLES = Object.keys(mod).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n));
const KEY_TABLES = {
  WHATSAPP_STAGE_TEMPLATES: () => Object.values(WHATSAPP_STAGE_TEMPLATES),
  WHATSAPP_INTERVIEW_TEMPLATES: () => Object.values(WHATSAPP_INTERVIEW_TEMPLATES),
  EMAIL_STAGE_TEMPLATES: () => Object.values(EMAIL_STAGE_TEMPLATES),
  EMAIL_INTERVIEW_TEMPLATES: () => Object.values(EMAIL_INTERVIEW_TEMPLATES),
  PROSPECT_OUTREACH_TEMPLATES: () => Object.values(PROSPECT_OUTREACH_TEMPLATES),
  ASSESSMENT_INVITE_TEMPLATE: () => [ASSESSMENT_INVITE_TEMPLATE],
  STAGE_FALLBACK_TEMPLATE: () => [STAGE_FALLBACK_TEMPLATE],
};

function tablesConsulted(rel, fnName) {
  // Comments and string literals go first: the dispatch files describe these tables
  // in prose and name stages like "NEW" in code, and neither is a key the reader asks
  // the database for.
  const text = read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"[^"\n]*"/g, '""');
  const tables = new Set();
  const localsSeen = new Set();
  const queue = [];
  for (const m of text.matchAll(new RegExp(`await ${fnName}\\(\\s*([^)]{1,200}?)\\s*\\)`, "g"))) {
    queue.push(m[1]);
  }
  while (queue.length) {
    const expr = queue.shift();
    for (const name of DOMAIN_TABLES) {
      if (new RegExp(`\\b${name}\\b`).test(expr)) tables.add(name);
    }
    for (const m of expr.matchAll(/\b([a-z_$][\w$]*)\b/g)) {
      const id = m[1];
      if (localsSeen.has(id)) continue;
      localsSeen.add(id);
      for (const a of text.matchAll(new RegExp(`const ${id}\\s*(?::[^=;]+)?=\\s*([^;]+);`, "g"))) {
        queue.push(a[1]);
      }
    }
  }
  return tables;
}

function keysConsulted(rel, fnName, label) {
  const consulted = tablesConsulted(rel, fnName);
  const out = new Set();
  const undeclared = [];
  for (const name of consulted) {
    const values = KEY_TABLES[name];
    if (!values) undeclared.push(name);
    else for (const key of values()) out.add(key);
  }
  check(
    `the ${label} reader asks only for keys the domain exports a table for`,
    consulted.size > 0 && undeclared.length === 0,
    undeclared.length
      ? `${undeclared.join(", ")} carries keys this proof cannot expand — declare it above`
      : `${[...consulted].sort().join(", ")}`
  );
  return out;
}

const prospectKeys = new Set(Object.values(PROSPECT_OUTREACH_TEMPLATES));
const whatsappKeys = keysConsulted(WHATSAPP_FILE, "resolveTemplate", "WhatsApp");
const emailKeys = keysConsulted(EMAIL_FILE, "resolveEmailCopy", "email");

check(
  "the WhatsApp reader asks for its own stage and interview keys plus the invite and the fallback",
  [...whatsappKeys].every(
    (k) =>
      Object.values(WHATSAPP_STAGE_TEMPLATES).includes(k) ||
      Object.values(WHATSAPP_INTERVIEW_TEMPLATES).includes(k) ||
      k === ASSESSMENT_INVITE_TEMPLATE ||
      k === STAGE_FALLBACK_TEMPLATE
  ) && whatsappKeys.size > 0,
  `${whatsappKeys.size} keys: ${[...whatsappKeys].sort().join(", ")}`
);
check(
  "the email reader asks for its own stage and interview keys plus the invite and the fallback",
  [...emailKeys].every(
    (k) =>
      Object.values(EMAIL_STAGE_TEMPLATES).includes(k) ||
      Object.values(EMAIL_INTERVIEW_TEMPLATES).includes(k) ||
      k === ASSESSMENT_INVITE_TEMPLATE ||
      k === STAGE_FALLBACK_TEMPLATE
  ) && emailKeys.size > 0,
  `${emailKeys.size} keys: ${[...emailKeys].sort().join(", ")}`
);

// The channel filter is what makes a row's channel part of the question at all.
check(
  "the two channel readers ask by channel, so a key filed under the other channel is never looked up",
  /\.eq\("channel",\s*"WHATSAPP"\)/.test(read(WHATSAPP_FILE)) &&
    /\.eq\("channel",\s*"EMAIL"\)/.test(read(EMAIL_FILE)),
  "resolveTemplate filters WHATSAPP, resolveEmailCopy filters EMAIL"
);

// The board is the one reader that ignores the channel column, and the only place an
// exemption like that is allowed to live. Pinning its shape is what stops the
// looseness arriving with a fourth reader nobody thought about.
const boardText = read(BOARD_FILE);
check(
  "the Sourcing board reads its two prospect rows by key alone, with no channel filter",
  /\.in\(\s*"key",\s*Object\.values\(PROSPECT_OUTREACH_TEMPLATES\)\s*\)/.test(boardText) &&
    !/\.eq\(\s*"channel"/.test(boardText),
  "getOutreachCopy is the reader that picks them up by key"
);

// Every file that touches the table. A new reader is a new promise about live copy,
// so it has to be named here rather than quietly change what "wired" means.
function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const readers = walk("src")
  .filter((rel) => /\.from\(\s*"notification_templates"/.test(read(rel)))
  .sort();
const EXPECTED_READERS = [
  BOARD_FILE,
  EMAIL_FILE,
  "src/app/(admin)/settings/actions.ts",
  WHATSAPP_FILE,
].sort();
check(
  "no file reads the table besides the three senders and the console",
  JSON.stringify(readers) === JSON.stringify(EXPECTED_READERS),
  readers.join(", ")
);

// ---------------------------------------------------------------------------
// The wiring predicate, called for real, has to answer the readers' question in
// both directions: every pair some dispatch asks for is live copy, and every pair
// nobody asks for is not.
// ---------------------------------------------------------------------------
const allKeys = new Set([...whatsappKeys, ...emailKeys, ...prospectKeys]);
const READS_BY_CHANNEL = {
  WHATSAPP: new Set([...whatsappKeys, ...prospectKeys]),
  EMAIL: new Set([...emailKeys, ...prospectKeys]),
  IN_APP: new Set(prospectKeys),
};
const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", EMAIL: "email", IN_APP: "portal notice" };

for (const [channel, expected] of Object.entries(READS_BY_CHANNEL)) {
  const wrong = [...allKeys].filter(
    (key) => templateIsWired({ key, channel }) !== expected.has(key)
  );
  check(
    `the "Not sent yet" badge on a ${CHANNEL_LABEL[channel]} row answers the same question its reader does`,
    wrong.length === 0,
    wrong.length
      ? `${wrong.join(", ")} — badge and dispatch disagree`
      : `${expected.size} of ${allKeys.size} keys read on this channel`
  );
}

// The claim the tab strip already makes in prose, checked against the rule it implies.
check(
  "an IN_APP row shapes no message, and the console says so beside the tab",
  [...allKeys].filter((k) => templateIsWired({ key: k, channel: "IN_APP" })).length ===
    prospectKeys.size && /no flow reads an `IN_APP`/.test(read(CONSOLE_FILE)),
  "the badge and the tab comment agree that a portal notice is read from the email copy, not a row"
);

// A second list of keys in the console would be a second source of truth.
check(
  "the console asks the domain which rows are live copy instead of judging for itself",
  /templateIsWired\(template\)/.test(read(CONSOLE_FILE)) &&
    !/"(stage|interview|application|offer|assessment|status|prospect)_[a-z_]+"/.test(read(CONSOLE_FILE)),
  "no template key is spelled out in the console file"
);

// ---------------------------------------------------------------------------
// Copy shipped in code has to cover every chain, or "deleting a row never silences
// the message" is a sentence nobody tested. `resolveTemplate` throws past its last
// default and `resolveEmailCopy` returns null, so both chains are walked here.
// ---------------------------------------------------------------------------
const noWhatsappCopy = [...whatsappKeys].filter((k) => !TEMPLATE_DEFAULTS[k]);
check(
  "every key the WhatsApp reader asks for has copy shipped in code, so the dispatch never runs out",
  noWhatsappCopy.length === 0,
  noWhatsappCopy.length
    ? `${noWhatsappCopy.join(", ")} — resolveTemplate would throw on it`
    : `the throw at resolveTemplate stays unreachable for ${whatsappKeys.size} keys`
);

const noEmailBody = [...emailKeys].filter(
  (k) =>
    k !== STAGE_FALLBACK_TEMPLATE &&
    !EMAIL_TEMPLATE_DEFAULTS[k] &&
    !TEMPLATE_DEFAULTS[k] &&
    !TEMPLATE_DEFAULTS[STAGE_FALLBACK_TEMPLATE]
);
check(
  "every key the email reader asks for resolves on its own or through the generic line",
  noEmailBody.length === 0 && Boolean(TEMPLATE_DEFAULTS[STAGE_FALLBACK_TEMPLATE]),
  noEmailBody.length
    ? `${noEmailBody.join(", ")} — and no fallback line to rescue it`
    : `${emailKeys.size} keys, each with letter copy, chat copy or ${STAGE_FALLBACK_TEMPLATE}`
);

const noEmailSubject = [...emailKeys].filter((k) => !EMAIL_SUBJECT_DEFAULTS[k]);
check(
  "every emailed key has a shipped subject line, so the fallback line stays a last resort",
  noEmailSubject.length === 0,
  noEmailSubject.length
    ? `${noEmailSubject.join(", ")} would send on "${EMAIL_SUBJECT_FALLBACK}"`
    : `${emailKeys.size} of ${emailKeys.size}`
);

// The console previews `shippedTemplate`; the send path walks its own chain. They
// have to land on the same wording — the domain's header promises "the exact same
// function runs inside the dispatch path and inside the Settings preview".
const mismatched = [];
const fallbackOnly = [];
for (const channel of ["WHATSAPP", "EMAIL"]) {
  for (const key of READS_BY_CHANNEL[channel]) {
    if (prospectKeys.has(key)) continue;
    const shipped = shippedTemplate(key, channel);
    const chainBody =
      channel === "WHATSAPP"
        ? TEMPLATE_DEFAULTS[key]
        : EMAIL_TEMPLATE_DEFAULTS[key] ??
          TEMPLATE_DEFAULTS[key] ??
          TEMPLATE_DEFAULTS[STAGE_FALLBACK_TEMPLATE];
    if (!shipped) {
      // A null lookup is the console's signal for "this row has no copy behind it".
      // That is only honest when the chain really does land on the generic line.
      if (chainBody === TEMPLATE_DEFAULTS[STAGE_FALLBACK_TEMPLATE]) fallbackOnly.push(key);
      else mismatched.push(`${channel}/${key}: the console says no copy is shipped, the dispatch has some`);
    } else if (shipped.body !== chainBody) {
      mismatched.push(`${channel}/${key}: the preview and the dispatch differ`);
    } else if (channel === "EMAIL") {
      // The subject is the half an email is filed under, so it has to agree too.
      // Without this the body comparison passes while the console offers to write
      // a subject the mailer would never have printed.
      const chainSubject = EMAIL_SUBJECT_DEFAULTS[key] || EMAIL_SUBJECT_FALLBACK;
      if (shipped.subject !== chainSubject) {
        mismatched.push(`${channel}/${key}: the preview offers "${shipped.subject || "(blank)"}" where the mailer would write "${chainSubject}"`);
      }
    }
  }
}
check(
  "the shipped copy the console previews is the copy the dispatch falls through to",
  mismatched.length === 0,
  mismatched.length ? mismatched.join(" | ") : `${allKeys.size} keys walked through both chains`
);
console.log(
  `     rows whose deletion sends the generic ${STAGE_FALLBACK_TEMPLATE} line instead of their own letter: ${
    fallbackOnly.join(", ") || "none"
  }`
);

// ---------------------------------------------------------------------------
// The prose that hangs off the keys: a row with no purpose sentence renders "No
// flow reads this key yet" beside copy that is being sent.
// ---------------------------------------------------------------------------
const purposeless = [...allKeys].filter((k) => !TEMPLATE_PURPOSE[k]);
check(
  "every key a channel reads has a purpose sentence in the console",
  purposeless.length === 0,
  purposeless.length ? purposeless.join(", ") : `${allKeys.size} keys, each described`
);
const unclaimed = Object.keys(TEMPLATE_PURPOSE).filter((k) => !allKeys.has(k));
check(
  "no purpose sentence describes a key that nothing reads",
  unclaimed.length === 0,
  unclaimed.length ? unclaimed.join(", ") : "the table and the readers are the same list"
);

// The stage maps are indexed by the pipeline's own stages, and the WhatsApp dispatch
// indexes its map with no guard, so a stage added to the enum without a template key
// would put `undefined` into the ask list. The stages are read out of core's
// vocabulary tuple — `src/types` stopped writing them when the row types moved to
// `src/core/entities`, and `prove-core-entities.mjs` pins that tuple to the enum the
// database holds, so this list is one step away from the schema on purpose.
const stagesTuple = /export const APPLICATION_STAGES = \[([\s\S]*?)\]/.exec(read("src/core/entities/vocabularies.ts"));
if (!stagesTuple) {
  console.log(
    '\nFAIL src/core/entities/vocabularies.ts no longer writes `export const APPLICATION_STAGES = [...]`.\n' +
      "     The stage-keyed templates are checked against that tuple, so this proof has nothing to read.\n"
  );
  process.exit(1);
}
const stageUnion = [...stagesTuple[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
const stagesWithoutKey = stageUnion.filter(
  (s) => !WHATSAPP_STAGE_TEMPLATES[s] || !EMAIL_STAGE_TEMPLATES[s]
);
check(
  "both channels have a template key for every stage the pipeline can hold",
  stagesWithoutKey.length === 0 && stageUnion.length > 0,
  stagesWithoutKey.length
    ? `${stagesWithoutKey.join(", ")} would move with no key of its own`
    : `${stageUnion.length} stages, each on both channels`
);
const extraStages = Object.keys(WHATSAPP_STAGE_TEMPLATES).filter((s) => !stageUnion.includes(s));
check(
  "the stage maps name no stage the pipeline does not hold",
  extraStages.length === 0,
  extraStages.length
    ? `${extraStages.join(", ")} — the ${WHATSAPP_FILE.split("/").pop()} lookup would answer undefined`
    : "both maps cover exactly the enum's stages"
);

// One spelling for the subject a letter gets when nothing else names one. Two
// spellings is how the preview and the postcard part company.
check(
  "the email dispatch fills a missing subject from the same constant the console shows",
  (read(EMAIL_FILE).match(/EMAIL_SUBJECT_DEFAULTS\[key\] \|\| EMAIL_SUBJECT_FALLBACK/g) ?? [])
    .length === 2 && !read(EMAIL_FILE).includes(`"${EMAIL_SUBJECT_FALLBACK}"`),
  "both resolveEmailCopy branches use the exported constant"
);

// ---------------------------------------------------------------------------
// The table's own rows, and the dump a fresh install is built from.
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
      "Start the stack with `npm run docker:up` — this proof asks the running instance which rows it holds."
  );
  console.log("It does not print the connection string.");
  process.exitCode = 1;
}

if (reachable) {
  const rows = (
    await client.query(
      "select key, channel, subject, body from notification_templates order by channel, key"
    )
  ).rows;

  const unread = rows.filter((r) => !templateIsWired({ key: r.key, channel: r.channel }));
  check(
    "every stored row is looked up by a reader on its own channel",
    unread.length === 0,
    unread.length
      ? `${unread.map((r) => `${r.channel}/${r.key}`).join(", ")} — edited copy that sends nothing`
      : `${rows.length} rows, each read at send time`
  );

  const noPurpose = rows.filter((r) => !TEMPLATE_PURPOSE[r.key]);
  check(
    "no stored row sits under a key the console cannot describe",
    noPurpose.length === 0,
    noPurpose.length
      ? `${noPurpose.map((r) => r.key).join(", ")} — its card would read "No flow reads this key yet"`
      : "every row has a purpose sentence"
  );

  const emailRows = rows.filter((r) => r.channel === "EMAIL");
  const blankSubject = emailRows.filter((r) => !(r.subject ?? "").trim());
  check(
    "no emailed row carries a subject the console would have to guess",
    blankSubject.length === 0,
    blankSubject.length
      ? `${blankSubject.map((r) => r.key).join(", ")} arrive on "${EMAIL_SUBJECT_FALLBACK}"`
      : `${emailRows.length} email rows, each with its own subject`
  );

  // A fresh install is built from the dump, so a key or channel living only in this
  // database would be missing there. Copy is *expected* to differ — a recruiter
  // edits it — so only the identity of a row is compared.
  const dumped = [
    ...read("db/schema.sql").matchAll(
      /insert into public\.notification_templates[^;]*?values \('[^']+', '([a-z_]+)', '(EMAIL|WHATSAPP|IN_APP)'/g
    ),
  ].map((m) => `${m[2]}/${m[1]}`);
  const livePairs = rows.map((r) => `${r.channel}/${r.key}`);
  const onlyLive = livePairs.filter((p) => !dumped.includes(p));
  const onlyDump = dumped.filter((p) => !livePairs.includes(p));
  check(
    "the rows a fresh install gets are the rows this database holds",
    onlyLive.length === 0 && onlyDump.length === 0,
    onlyLive.length || onlyDump.length
      ? `live only: ${onlyLive.join(", ") || "none"} | dump only: ${onlyDump.join(", ") || "none"}`
      : `${livePairs.length} rows in both`
  );

  // Keys a channel reads out of code because no row exists for it today. Not a gap —
  // shipping copy is the point — but the list says how much of the console's promise
  // rests on defaults rather than stored wording, and how many rows the portal has.
  const held = new Set(livePairs);
  const fromCode = [];
  for (const channel of ["WHATSAPP", "EMAIL", "IN_APP"]) {
    for (const key of READS_BY_CHANNEL[channel]) {
      if (!held.has(`${channel}/${key}`)) fromCode.push(`${channel}/${key}`);
    }
  }
  console.log(
    `     channel/key pairs a reader asks for that have no stored row, so they send the copy shipped in code: ${
      fromCode.join(", ") || "none"
    }`
  );
  console.log(
    `     ${rows.filter((r) => r.channel === "IN_APP").length} IN_APP row(s) held — the badge's answer for one is only exercised by inserting a row`
  );

  await client.end();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
