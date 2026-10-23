/* scripts/prove-chat-emphasis.mjs
 * Run: node --experimental-strip-types scripts/prove-chat-emphasis.mjs
 *
 * The admin chat renders a model's reply through its own markdown parser, and one
 * of its rules turns `_word_` into italics. The same pair of characters is normal
 * inside a column name, so a reply echoing `min_salary_usd` came out italic and
 * missing both underscores — a field name that matches nothing on any console, in
 * the message that tells a recruiter what a change touched.
 *
 * This runs the real pattern, lifted out of the component's source, against the
 * real boundary rule, so the two halves are tested together without a browser:
 *
 *   1. a field name survives a reply whole — the rendered text loses no character;
 *   2. the pattern alone still finds the pair, which is what proves the boundary
 *      rule and not the pattern is doing the work;
 *   3. genuine `_emphasis_` still becomes emphasis, at a sentence's start and end;
 *   4. a code span keeps its underscores and is never italicised;
 *   5. the wiring — the component imports the rule and applies it to the underscore
 *      branch only, and the rule's module stays import-free so it can run here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { insideAWord } from "../src/modules/assistant/domain/inlineEmphasis.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const VIEW = "src/modules/assistant/presentation/RichReply.tsx";
const RULE = "src/modules/assistant/domain/inlineEmphasis.ts";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, pass: ok });
  console.log(`${ok ? "ok   " : "FAIL "} ${name}${ok || !detail ? "" : `  [${detail}]`}`);
}
function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

// The pattern is read out of the component rather than repeated, so editing it
// here or there is the same change as far as this proof is concerned.
const source = read(VIEW);
const literal = /^const INLINE = (\/.+\/[a-z]*);$/m.exec(source);
check("the renderer declares one INLINE pattern", Boolean(literal), "no `const INLINE = /…/;` line");
const pattern = literal ? literal[1] : "//";
const INLINE = new RegExp(pattern.slice(1, pattern.lastIndexOf("/")), pattern.slice(pattern.lastIndexOf("/") + 1));

/**
 * What the component would put on screen, as text.
 *
 * Mirrors its loop: the delimiters of a span it accepts are dropped, everything
 * else — including a rejected `_…_` pair — is printed as it arrived.
 */
function renderedText(text) {
  let out = "";
  let cursor = 0;
  let match;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    out += text.slice(cursor, match.index);
    out +=
      match[3] && insideAWord(text, match.index, INLINE.lastIndex)
        ? match[0]
        : (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[0]);
    cursor = INLINE.lastIndex;
  }
  return out + text.slice(cursor);
}

/** The `_…_` spans in a reply and what the rule decided about each. */
function decisions(text) {
  const out = [];
  INLINE.lastIndex = 0;
  let match;
  while ((match = INLINE.exec(text)) !== null) {
    if (!match[3]) continue;
    out.push({ span: match[0], as: insideAWord(text, match.index, INLINE.lastIndex) ? "words" : "emphasis" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. A field name survives the reply whole
// ---------------------------------------------------------------------------
// The exact shape the trail writes and the assistant echoes: a change phrase
// naming columns, then a sentence about one of them.
const echo =
  "changed 4 fields (grade, responsibilities, requirements, max_salary_usd). " +
  "I set min_salary_usd to 4500 and left max_salary_usd as it was.";
check("an echoed column list renders with every character intact", renderedText(echo) === echo, renderedText(echo));
check("so no pair in it is italicised", decisions(echo).every((d) => d.as === "words"), JSON.stringify(decisions(echo)));
check("and the pairs are there to be protected", decisions(echo).length > 0, String(decisions(echo).length));

const pathLike = "the file is at reports_pipeline_velocity.mjs and the key is data_set_name";
check("a dotted identifier keeps its underscores too", renderedText(pathLike) === pathLike, renderedText(pathLike));

// ---------------------------------------------------------------------------
// 2. The pattern is still the greedy one — the rule, not the regex, saves it
// ---------------------------------------------------------------------------
INLINE.lastIndex = 0;
const found = [...echo.matchAll(INLINE)].filter((m) => m[3]);
check("the pattern alone still italicises the first field name", found.length > 0 && found[0][3] === "salary", JSON.stringify(found[0]?.[3]));
check("which is why the boundary rule has to exist", found.length > 0 && decisions(echo).length === found.length, `${found.length} vs ${decisions(echo).length}`);

// ---------------------------------------------------------------------------
// 3. Real emphasis still renders
// ---------------------------------------------------------------------------
check("a pair between words is still emphasis", same(decisions("this is _italic_ text"), [{ span: "_italic_", as: "emphasis" }]));
check("and its underscores are the only thing dropped", renderedText("this is _italic_ text") === "this is italic text", renderedText("this is _italic_ text"));
check("a pair opening a message is emphasis", decisions("_first_ thing").every((d) => d.as === "emphasis"), JSON.stringify(decisions("_first_ thing")));
check("a pair closing one is emphasis", decisions("the _last_ word").every((d) => d.as === "emphasis"), JSON.stringify(decisions("the _last_ word")));
check("emphasis before punctuation still renders", renderedText("call it _snake_, not the column") === "call it snake, not the column", renderedText("call it _snake_, not the column"));
check("a field name beside a real pair is told apart", renderedText("the field min_salary_usd is _the one_ to check") === "the field min_salary_usd is the one to check", renderedText("the field min_salary_usd is _the one_ to check"));

// ---------------------------------------------------------------------------
// 4. A code span is never emphasis
// ---------------------------------------------------------------------------
check("a quoted field name keeps its underscores", renderedText("`min_salary_usd`") === "min_salary_usd", renderedText("`min_salary_usd`"));
check("and is not italicised", decisions("`min_salary_usd`").length === 0, JSON.stringify(decisions("`min_salary_usd`")));

// ---------------------------------------------------------------------------
// 5. Wiring — the component asks the rule about the underscore branch only
// ---------------------------------------------------------------------------
function sourceHas(label, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(label, missing.length === 0, missing.length ? `missing ${missing.map((n) => JSON.stringify(n)).join(", ")}` : "");
}

sourceHas("the renderer imports the boundary rule", VIEW, [
  'import { insideAWord } from "@/modules/assistant/domain/inlineEmphasis";',
]);
sourceHas("it applies the rule to the underscore span only", VIEW, [
  "if (match[3] && insideAWord(text, match.index, INLINE.lastIndex)) {",
]);
sourceHas("a rejected span is printed exactly as it arrived", VIEW, [
  "nodes.push(match[0]);",
  "cursor = INLINE.lastIndex;",
]);
sourceHas("bold, italics and code still render after the guard", VIEW, [
  "if (match[1]) nodes.push(<strong key={match.index}>{match[1]}</strong>);",
  "else if (match[2] || match[3]) nodes.push(<em key={match.index}>{match[2] ?? match[3]}</em>);",
]);

const rule = read(RULE);
check("the rule's module imports nothing, so this script can run it", !/^import /m.test(rule), "has imports");
check("and it binds an underscore to letters, digits and a backtick", /\/\[\\w`\]\/|const BINDING = \/\[\\w`\]\//.test(rule), rule.slice(rule.indexOf("const BINDING"), rule.indexOf("const BINDING") + 40));

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
