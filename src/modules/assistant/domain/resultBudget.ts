/**
 * The answer envelope: a tool result the model can actually trust.
 *
 * Every tool result is context, not a document, so it has a size budget. The
 * first version of that budget cut the JSON string at 6000 characters and glued a
 * `…` on the end, which is wrong twice over. The severed string is not JSON, so
 * nothing downstream can read it as data; and the cut happens *after* the tool has
 * written its own disclosure, so `reachNote`'s "All 200 are listed" survives at the
 * head of the answer while rows 91–200 are gone — the answer's honesty is undone by
 * the envelope carrying it. It was not hypothetical: the all-six master-data read
 * measured 7865 characters of live rows, and the longest live CV text is 5460
 * characters against the same budget.
 *
 * So the budget reshapes the *value* instead of the string: rows are dropped whole
 * from the tail of the heaviest list — never below that list's first row — long text
 * is cut at a character boundary, and whatever was left out is stated first, inside
 * the answer, in numbers. The output is always valid JSON and always says how much
 * of itself is missing.
 */

/** Bound so one read cannot eat the turn's context. Shared by both engines. */
export const MAX_RESULT_CHARS = 6000;

/** The key the shrinker always puts first, so the disclosure survives the cut. */
export const RESULT_BUDGET_KEY = "result_budget";

/** Marks a string that was cut, so a half-sentence cannot be read as a whole one. */
const CUT_MARKER = "…[cut by the assistant — the rest is not in this answer]";

/** Leads the very first pass, before any count is known. Never the last word. */
const FIRST_NOTE =
  "This answer is longer than one tool result can carry, so it is being shortened; the counts that say what was left out follow in this line.";

/** A list the shrinker took rows from, counted against what it originally held. */
type ListLoss = { path: string; total: number; kept: number };
/** A string the shrinker cut, counted against what it originally held. */
type TextLoss = { path: string; total: number; kept: number };

function stringifySafe(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    // A circular or otherwise unserialisable answer: the text is still worth
    // sending, and wrapping it keeps the envelope's output valid JSON.
    try {
      return JSON.stringify({ tool_result: String(value) });
    } catch {
      return null;
    }
  }
}

/**
 * A slice boundary that cannot split a surrogate pair — the portal's names are
 * Arabic as often as they are Latin, and half a pair is an invalid character.
 */
function safeCut(text: string, length: number): string {
  if (length >= text.length) return text;
  if (length <= 0) return "";
  const high = text.charCodeAt(length - 1);
  return high >= 0xd800 && high <= 0xdbff ? text.slice(0, length - 1) : text.slice(0, length);
}

/** Every array in the tree, labelled by the keys that lead to it. */
function arraysIn(node: unknown): { path: string; value: unknown[] }[] {
  const found: { path: string; value: unknown[] }[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      found.push({ path, value });
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
        walk(sub, path === "" ? key : `${path}.${key}`);
      }
    }
  };
  walk(node, "");
  return found;
}

/**
 * Every string leaf, with the object or list that holds it so it can be rewritten,
 * and the path it sits at so the note can name it. A string standing on its own in
 * a list (`notes: ["…"]`) is still text the answer can narrow, so the list itself
 * holds it and the key is the index.
 */
function stringsIn(node: unknown): { parent: Record<string, unknown>; key: string; path: string }[] {
  const found: { parent: Record<string, unknown>; key: string; path: string }[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      // A list is written through the same `parent[key]` as an object: index as key.
      const holder = value as unknown as Record<string, unknown>;
      value.forEach((item, index) => {
        const at = `${path}[${index}]`;
        if (typeof item === "string") found.push({ parent: holder, key: String(index), path: at });
        else walk(item, at);
      });
      return;
    }
    if (value && typeof value === "object") {
      const holder = value as Record<string, unknown>;
      for (const [key, sub] of Object.entries(holder)) {
        const at = path === "" ? key : `${path}.${key}`;
        if (typeof sub === "string") {
          if (key !== RESULT_BUDGET_KEY) found.push({ parent: holder, key, path: at });
        } else {
          walk(sub, at);
        }
      }
    }
  };
  walk(node, "");
  return found;
}

/**
 * Drop rows from the tail of the biggest list until `overflow` is covered.
 *
 * "Biggest" is per-row weight, not count: one list of 4000-character answers beats
 * a list of 12 ids for the budget, and dropping the ids would throw away rows to
 * save nothing. A list never goes below its first row here — an answer that names
 * six vocabularies and returns rows from five of them reads as "the sixth does not
 * exist", which is the exact falsehood the envelope exists to prevent. A list whose
 * single row is too wide for the answer is narrowed by `cutText` instead.
 */
function trimRows(node: unknown, overflow: number, losses: Map<string, ListLoss>): boolean {
  const arrays = arraysIn(node).filter((entry) => entry.value.length > 1);
  if (arrays.length === 0) return false;
  const weight = (entry: { value: unknown[] }) =>
    (stringifySafe(entry.value)?.length ?? 0) / entry.value.length;
  const target = arrays.reduce((best, entry) => (weight(entry) >= weight(best) ? entry : best));
  const each = Math.max(1, Math.floor(weight(target)));
  const before = target.value.length;
  // A pass gives up at most a third of the rows it is looking at, so a wide answer
  // is narrowed across every list it holds rather than emptied along one of them.
  const gentle = Math.max(1, Math.ceil(before / 3));
  const demand = Math.min(before - 1, Math.max(1, Math.min(gentle, Math.ceil(overflow / each))));
  target.value.length = before - demand;
  const loss = losses.get(target.path) ?? { path: target.path, total: before, kept: before };
  loss.kept = target.value.length;
  losses.set(target.path, loss);
  return true;
}

/**
 * Cut the longest remaining string as far as `overflow` needs.
 *
 * Returns false once nothing long enough to be worth a cut is left, which is what
 * lets the caller tell "a wall of text" from "a list too wide to shrink".
 */
function cutText(node: unknown, overflow: number, losses: Map<string, TextLoss>): boolean {
  const leaves = stringsIn(node)
    .filter((leaf) => (leaf.parent[leaf.key] as string).length > CUT_MARKER.length + 200)
    .sort((a, b) => (b.parent[b.key] as string).length - (a.parent[a.key] as string).length);
  if (leaves.length === 0) return false;
  const leaf = leaves[0]!;
  const full = leaf.parent[leaf.key] as string;
  const keep = Math.max(200, Math.floor(full.length - overflow - CUT_MARKER.length));
  const head = safeCut(full, Math.min(keep, full.length - 1));
  leaf.parent[leaf.key] = `${head}${CUT_MARKER}`;
  const previous = losses.get(leaf.path);
  losses.set(
    leaf.path,
    previous
      ? { ...previous, kept: head.length }
      : { path: leaf.path, total: full.length, kept: head.length }
  );
  return true;
}

/** The sentence that leads every reshaped answer, in the numbers that were taken. */
function noteFor(rows: ListLoss[], texts: TextLoss[], severed: boolean): string {
  const parts: string[] = [];
  const dropped = rows.filter((row) => row.total > row.kept);
  if (dropped.length > 0) {
    const first = dropped[0]!;
    const lost = first.total - first.kept;
    const counted = dropped.reduce((sum, row) => sum + (row.total - row.kept), 0);
    const tail = dropped.length > 1 ? `, and ${(counted - lost).toLocaleString()} more rows from ${
        dropped.length - 1
      } other list${dropped.length - 1 === 1 ? "" : "s"}` : "";
    parts.push(
      `${first.total.toLocaleString()} rows were read from "${first.path}" and only the first ${first.kept.toLocaleString()} are here, in the order they were read — ${lost.toLocaleString()} were left out by this answer's size limit${tail}`
    );
  }
  for (const text of texts) {
    parts.push(`"${text.path}" was cut at ${text.kept.toLocaleString()} of ${text.total.toLocaleString()} characters`);
  }
  if (severed) parts.push("the answer could not be reshaped to fit, so only its opening is kept");
  const droppedRows = dropped.length > 0;
  const cutStrings = texts.length > 0;
  const closer =
    droppedRows && cutStrings
      ? "rows and characters were both left out"
      : cutStrings
        ? "the text it quoted is not whole"
        : droppedRows
          ? "the rows it counted are not all here"
          : "only an opening of the answer is here";
  return `${parts.join("; ")}. This line is the truth about the text below it, whatever that text claims about being complete — ${closer}. Ask again with a narrower scope, a deeper page, or one list at a time for what is missing.`;
}

/** Budget first, always: a key the model cannot miss and a cut cannot orphan. */
function compose(payload: Record<string, unknown>, note: string): string {
  const budget = `"${RESULT_BUDGET_KEY}":${JSON.stringify(note)}`;
  const body = stringifySafe(payload) ?? "null";
  const rest = body.slice(1);
  return rest === "}" ? `{${budget}}` : `{${budget},${rest}`;
}

/**
 * A quoted string field that fits under `overhead` characters of surrounding JSON.
 *
 * Escaping inflates a string once it is quoted — a JSON opening is full of `"` — so
 * the cut is measured on the escaped form, not on the text.
 */
function quotedToFit(text: string, overhead: number, limit: number): string {
  let room = text.length;
  for (let guard = 0; guard < 80; guard += 1) {
    const candidate = JSON.stringify(safeCut(text, room));
    if (candidate.length + overhead <= limit) return candidate;
    room = Math.max(0, room - (candidate.length + overhead - limit));
    if (room === 0) return '""';
  }
  return '""';
}

/**
 * The last word when nothing structural could be dropped: the opening of the
 * original answer, inside a wrapper that is itself valid JSON and says it is an
 * opening.
 */
function sever(whole: string, note: string, limit: number): string {
  // The note already carries the "could not be reshaped" clause whenever this runs,
  // so it is passed through rather than repeated.
  const wrapper = `"${RESULT_BUDGET_KEY}":${JSON.stringify(note)},"severed_json":`;
  let room = Math.max(0, limit - wrapper.length - 2);
  for (let guard = 0; guard < 80; guard += 1) {
    const out = `{${wrapper}${JSON.stringify(safeCut(whole, room))}}`;
    if (out.length <= limit) return out;
    if (room === 0) break;
    room = Math.max(0, room - (out.length - limit));
  }
  // The note alone is wider than the budget: send as much of it as fits, and no
  // answer text, which is what the note says happened.
  const head = `{"${RESULT_BUDGET_KEY}":`;
  return `${head}${quotedToFit(note, head.length + 1, limit)}}`;
}

/**
 * The answer, whole if it fits, reshaped if it does not.
 *
 * Never returns invalid JSON, and never returns a shortened answer that says
 * nothing about being short.
 */
export function fitResult(value: unknown, limit = MAX_RESULT_CHARS): string {
  const whole = stringifySafe(value);
  if (whole === null) {
    return `{"${RESULT_BUDGET_KEY}":"The tool returned something that could not be read as data."}`;
  }
  if (whole.length <= limit) return whole;

  // A bare string or array has no branch to trim, so it is given one: every
  // reshaped answer is an object, and the list or text sits under `result`.
  const parsed: unknown = JSON.parse(whole);
  const payload: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };
  const rowLosses = new Map<string, ListLoss>();
  const textLosses = new Map<string, TextLoss>();
  let severed = false;

  // Each pass measures the answer it is about to send, drops what it cannot carry,
  // and states the counts it knows. It ends when the shape fits or when there is
  // nothing structural left to give.
  for (let pass = 0; pass < 400; pass += 1) {
    const rows = [...rowLosses.values()];
    const texts = [...textLosses.values()];
    const note = rows.length + texts.length === 0 ? FIRST_NOTE : noteFor(rows, texts, severed);
    const text = compose(payload, note);
    if (text.length <= limit && rows.length + texts.length > 0) return text;

    const overflow = Math.max(1, text.length - limit);
    if (trimRows(payload, overflow, rowLosses)) continue;
    if (cutText(payload, overflow, textLosses)) continue;

    severed = true;
    break;
  }

  if (!severed) {
    const shaped = compose(payload, noteFor([...rowLosses.values()], [...textLosses.values()], false));
    if (shaped.length <= limit) return shaped;
  }
  return sever(whole, noteFor([...rowLosses.values()], [...textLosses.values()], true), limit);
}
