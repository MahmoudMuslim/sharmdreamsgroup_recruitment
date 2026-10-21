/* scripts/prove-rest-builder.mjs
 * Run: node --experimental-strip-types scripts/prove-rest-builder.mjs */
import { QueryBuilder, buildUrl } from "../src/lib/rest/query-builder.ts";

const q = () => new QueryBuilder();

const cases = [
  [q().select("id,name").eq("tenant_id", "t1").order("created_at", { ascending: false }).limit(5),
    "?select=id%2Cname&tenant_id=eq.t1&order=created_at.desc&limit=5"],
  [q().select("*").in("id", ["a", "b"]).is("deleted_at", null),
    "?select=*&id=in.%28%22a%22%2C%22b%22%29&deleted_at=is.null"],
  [q().select("id").filter("score", "gte", 80).not("status", "eq", "DRAFT"),
    "?select=id&score=gte.80&status=not.eq.DRAFT"],
  [q().select("id").or("email.eq.a@b.c,name.ilike.*jo*"),
    "?select=id&or=%28email.eq.a%40b.c%2Cname.ilike.*jo*%29"],
  [q().select("id").range(20, 39), "?select=id&offset=20&limit=20"],
  /* CORRECTED EXPECTATION — the only deviation from the plan's fence in this
   * file, and it is forced: the fence pairs `select("*")` with a bare `*`
   * (case 2) and `select("*,job_openings(title)")` with `%2A`, and no encoder
   * on earth produces both, because they are the same decoded value. `%2A` is
   * what Python's quote() emits and `*` is what URLSearchParams emits, which is
   * the encoder the builder's own doc comment names and the one supabase-js
   * uses, so the bare form is what the 454 chains put on the wire before this
   * port. Measured on the local stack: `select=%2A` and `select=*` both answer
   * 200 with the same rows, so this case pins the byte shape, not the grammar. */
  [q().select("*,job_openings(title)").eq("id", "x"),
    "?select=*%2Cjob_openings%28title%29&id=eq.x"],
];

let bad = 0;
for (const [builder, expected] of cases) {
  const got = builder.toQuerystring();
  if (got !== expected) { bad++; console.error(`FAIL\n  expected ${expected}\n  got      ${got}`); }
}
if (bad) process.exit(1);
console.log(`PASS ${cases.length} URL shapes`);
console.log(buildUrl("applications", q().select("id").eq("id", "x")));
