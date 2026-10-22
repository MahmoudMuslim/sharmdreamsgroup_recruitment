import type { Result } from "./client.ts";

type Filter = [column: string, operator: string, value: unknown];
type Modifier =
  | { kind: "order"; key: string; spec: string }
  | { kind: "limit"; value: number }
  | { kind: "offset"; value: number };

export interface Shape {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD";
  select?: string;
  filters: Filter[];
  modifiers: Modifier[];
  body?: unknown;
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
  onConflict?: string;
  ignoreDuplicates?: boolean;
  single: boolean;
  maybeSingle: boolean;
  /**
   * The chain asked for ROWS back — an explicit `.select(…)`, `.single()` or
   * `.maybeSingle()` — as opposed to a bare write, whose result the caller only
   * checks for `error`. This is what decides `Prefer: return=representation`,
   * not the verb: supabase-js sends no representation for `insert(x)` and
   * answers `data: null`, and a caller that never asked for rows must not
   * start receiving them. See `select()` for why the verb cannot decide it.
   */
  returning: boolean;
}

/** Operators that take a pre-formed value the caller already bracketed. */
const RAW_VALUE_OPS = new Set(["in", "or", "and"]);

/** Operators whose name is part of the filter key rather than a column test. */
const LOGIC_OPS = new Set(["or", "and"]);

/**
 * The verbs `insert`/`update`/`delete`/`upsert` record. Membership is what
 * `select()` tests before it is allowed to pick a read verb, so a chained read
 * can never downgrade a mutation back into a GET.
 */
const WRITE_METHODS = new Set<string>(["POST", "PATCH", "DELETE"]);

const FILTER_OPS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "in", "is",
  "contains", "containedBy", "overlaps", "cs", "cd", "ov", "sl", "sr", "not", "or", "and",
]);

/**
 * A value PostgREST must see quoted. Anything holding a character the grammar
 * owns (comma, bracket, dot) or leading/trailing whitespace gets double quotes,
 * because `eq.a,b` silently means two filters while `eq."a,b"` means one value.
 */
function literal(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const s = String(value);
  if (/^[A-Za-z0-9_:\-+.@ ]+$/.test(s) && s.trim() === s && s !== "") return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A member of an `in.(…)` list. Unlike a single filter value, every string here
 * is quoted even when it would be safe bare: `in.(a,b)` and `in.("a","b")` both
 * answer (measured on the local stack), but the list is the one place where a
 * value containing a comma or a bracket would silently split into two members,
 * and quoting every member is exactly what the vendor's client sends, so the
 * 454 chains ported onto this builder keep the bytes they were written against.
 */
function quoted(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * What awaiting a chain answers. A read answers an ARRAY of rows and a
 * `single()`/`maybeSingle()` answers one row, so these two aliases are the
 * module's only `any` — and they are deliberate. The vendor's client answered
 * `any[]` for these 454 chains, so anything narrower (`unknown`, a documented
 * row interface) turns every `data.map(row => …)` and `rows[0].id` in the
 * portal into a type error and forces the very call-site edits this task
 * forbids. PostgREST hands back JSON and the caller is the one that says what
 * the columns are; there is no schema here to type against until Task 18.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;

/**
 * The awaitable half of a chain. Two details are load-bearing rather than
 * decorative. Both callbacks are optional AND nullable, because that is what
 * `PromiseLike`'s own `then` passes (`onfulfilled?: … | null | undefined`), and
 * a stricter parameter makes a chain unusable wherever a hand-written awaitable
 * type is expected. And the signature is an interface METHOD, not a
 * function-typed property, because method signatures compare bivariantly:
 * `reportReader`'s `read()` takes a
 * `PromiseLike<{ data: unknown; error: { message: string } | null }>`, and only
 * bivariance lets a chain that answers `data: any[]` satisfy a parameter
 * annotated `data: unknown`.
 */
interface Awaitable<R> {
  then<T1, T2>(
    onFulfilled?: ((result: Result<R>) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2>;
}

export class QueryBuilder<R = Rows> {
  /**
   * Installed at runtime by the transport's `from()` (client.ts) through
   * `Object.assign`, and declared here because a chain's static type is this
   * class: the filter methods return `this`, but `single()` and `maybeSingle()`
   * re-type the row, so a `then` living only on the intersection `from()`
   * builds would be dropped by that retyping and
   * `await restClient.from(x).select(y).single()` would stop answering a
   * `Result`. `declare` (not initialise) keeps the field absent until the
   * client adds it, so a builder used outside a client is not awaitable.
   */
  declare then: Awaitable<R>["then"];

  private shape: Shape = {
    method: "GET", filters: [], modifiers: [], single: false, maybeSingle: false, returning: false,
  };

  /**
   * Read-side projection AND the write-side "give me the rows back" half of the
   * same idiom. The two roles are why this method may never touch a verb that
   * already says POST/PATCH/DELETE: every write in this repo is written as
   * `.insert(row).select("id").single()` / `.update(…).eq(…).select()` /
   * `.delete().eq(…).select()`, so a chained `.select()` that reset `method`
   * to GET turned ~34 live mutations into plain reads of the table — no write,
   * no error, and the caller read back a row it believed it had just written.
   * The verb, once recorded by a write, wins; `select()` only chooses GET/HEAD
   * when nothing has been recorded yet. (`.select()` before a write is not an
   * idiom in this tree — measured: 0 of the 125 `.from(…)` write chains.)
   */
  select(columns = "*", options?: { count?: Shape["count"]; head?: boolean }) {
    this.shape.select = columns;
    this.shape.returning = true;
    if (options?.count) this.shape.count = options.count;
    if (options?.head) this.shape.head = true;
    if (!WRITE_METHODS.has(this.shape.method)) {
      this.shape.method = options?.head ? "HEAD" : "GET";
    }
    return this;
  }

  insert(values: unknown) { this.shape.method = "POST"; this.shape.body = values; return this; }
  update(values: object) { this.shape.method = "PATCH"; this.shape.body = values; return this; }
  delete() { this.shape.method = "DELETE"; this.shape.body = undefined; return this; }
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.shape.method = "POST";
    this.shape.body = values;
    this.shape.onConflict = options?.onConflict;
    this.shape.ignoreDuplicates = options?.ignoreDuplicates;
    return this;
  }

  eq(c: string, v: unknown) { return this.push(c, "eq", v); }
  neq(c: string, v: unknown) { return this.push(c, "neq", v); }
  gt(c: string, v: unknown) { return this.push(c, "gt", v); }
  gte(c: string, v: unknown) { return this.push(c, "gte", v); }
  lt(c: string, v: unknown) { return this.push(c, "lt", v); }
  lte(c: string, v: unknown) { return this.push(c, "lte", v); }
  like(c: string, v: string) { return this.push(c, "like", v); }
  ilike(c: string, v: string) { return this.push(c, "ilike", v); }
  contains(c: string, v: unknown) { return this.push(c, "cs", v); }
  containedBy(c: string, v: unknown) { return this.push(c, "cd", v); }
  overlaps(c: string, v: unknown) { return this.push(c, "ov", v); }

  match(values: Record<string, string>) {
    for (const [column, value] of Object.entries(values)) this.push(column, "eq", value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.shape.filters.push([column, "in", `(${values.map(quoted).join(",")})`]);
    return this;
  }

  is(column: string, value: unknown) {
    this.shape.filters.push([column, "is", value === null ? "null" : String(value)]);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (!FILTER_OPS.has(operator)) throw new Error(`rest: not() operator "${operator}" is not a filter operator`);
    return this.push(column, `not.${operator}`, value);
  }

  /** `or("a.eq.1,b.eq.2")` — the caller writes the inner expression, verbatim
   * from today's call sites, so its content is never re-encoded. */
  or(composite: string) { return this.push("or", "or", stripParens(composite)); }
  and(composite: string) { return this.push("and", "and", stripParens(composite)); }

  filter(column: string, operator: string, value: unknown) {
    if (!FILTER_OPS.has(operator)) throw new Error(`rest: filter() operator "${operator}" is not supported`);
    return this.push(column, operator, RAW_VALUE_OPS.has(operator) ? value : String(value));
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string }) {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls = options?.nullsFirst === true ? "nullsfirst"
      : options?.nullsFirst === false ? "nullslast" : "";
    this.shape.modifiers.push({
      // An order on an EMBEDDED resource is its own query key (`child.order=`),
      // not the top-level `order=`, or the parent's rows get sorted and the
      // embed's stay arbitrary — which is what these two call sites ask for.
      kind: "order",
      key: options?.referencedTable ? `${options.referencedTable}.order` : "order",
      spec: nulls ? `${column}.${direction}.${nulls}` : `${column}.${direction}`,
    });
    return this;
  }

  limit(value: number) { this.shape.modifiers.push({ kind: "limit", value }); return this; }
  range(from: number, to: number) {
    this.shape.modifiers.push({ kind: "offset", value: from });
    this.shape.modifiers.push({ kind: "limit", value: to - from + 1 });
    return this;
  }

  /** Both terminals answer ONE row rather than a list, so they re-type the
   * awaited `Result.data` to a single row the way the vendor's client does.
   * They also count as the explicit ask for rows: a chain that ends in
   * `single()` is a chain that intends to read what it just wrote. */
  single(): QueryBuilder<Row> { this.shape.single = true; this.shape.returning = true; return this; }
  maybeSingle(): QueryBuilder<Row> { this.shape.maybeSingle = true; this.shape.returning = true; return this; }

  /**
   * PostgREST grammar: `column=operator.value` in insertion order, `or=(…)` /
   * `and=(…)` as their own keys, then `order`, `offset`, `limit`.
   * URLSearchParams is what percent-encodes the commas and brackets, so the
   * probe's expectations and the wire bytes cannot drift.
   */
  toQuerystring(): string {
    const params = new URLSearchParams();
    if (this.shape.select !== undefined) params.append("select", encodeSelect(this.shape.select));

    for (const [column, operator, value] of this.shape.filters) {
      if (LOGIC_OPS.has(operator)) {
        params.append(operator, `(${String(value)})`);
        continue;
      }
      const rendered = RAW_VALUE_OPS.has(operator)
        ? `${operator}.${String(value)}`
        : `${operator}.${literal(value)}`;
      params.append(column, rendered);
    }

    for (const modifier of this.shape.modifiers) {
      if (modifier.kind === "order") params.append(modifier.key, modifier.spec);
      else if (modifier.kind === "limit") params.append("limit", String(modifier.value));
      else if (modifier.kind === "offset") params.append("offset", String(modifier.value));
    }

    if (this.shape.onConflict) params.append("on_conflict", this.shape.onConflict);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  shape_(): Shape { return this.shape; }

  private push(column: string, operator: string, value: unknown) {
    this.shape.filters.push([column, operator, value]);
    return this;
  }
}

function stripParens(value: string): string {
  return value.replace(/^\s*\(/, "").replace(/\)\s*$/, "");
}

/**
 * Flatten a hand-formatted projection and strip the padding inside its brackets.
 *
 * PostgREST's select grammar accepts a space around a comma and a space between
 * an embed and its `(`, but not a newline and not a space just inside the
 * brackets: `select=a,\n b` answers `400 PGRST100 … unexpected "\n"`, and
 * `applications( full_name )` answers `400 PGRST100 … unexpected ")"` (both
 * measured against this stack's PostgREST 16.5). A wrapped projection failed
 * `/assessments` by the newline; the spaced embeds Analytics, the sourcing
 * desk and the grading reads write failed the same way, and no gate renders an
 * authenticated page to notice. Normalise here, at the seam that owns putting
 * the chain on the wire, rather than at each call site: only line breaks and
 * whitespace directly inside brackets collapse, so a projection's spacing
 * elsewhere and every quoted identifier are left as written.
 */
function encodeSelect(select: string): string {
  return select
    .replace(/\s*\n\s*/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function buildUrl(table: string, builder: QueryBuilder<Row>): string {
  return `/${table}${builder.toQuerystring()}`;
}
