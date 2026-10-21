/* The `.ts` extension is load-bearing, not style: Step 8's live probe imports
 * this file through `node --experimental-strip-types`, and Node's ESM resolver
 * does not guess extensions the way `moduleResolution: "bundler"` lets tsc and
 * Next do. `allowImportingTsExtensions` is already on in tsconfig.json. */
import { QueryBuilder, buildUrl, type Rows, type Shape } from "./query-builder.ts";

export interface RestError { message: string; code?: string; details?: string; hint?: string }

export interface Result<T = unknown> {
  data: T | null;
  error: RestError | null;
  count: number | null;
}

/** A bearer, or a factory for one. The factory may be async because a
 * service-role bearer is a *minted* token with a 60 s life (Task 8), and a
 * client built once at module scope cannot hold a token that expires — see
 * Step 7. Staff and anon callers keep passing a plain string or `null`. */
type Bearer = string | null;
type BearerSource = Bearer | (() => Bearer | Promise<Bearer>);

interface RestClientConfig {
  baseUrl: string;                      // http://localhost:54321/rest/v1
  token: BearerSource;                  // the bearer this request carries
  fetchImpl?: typeof fetch;
}

export function createRestClient(config: RestClientConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  // A trailing slash here produces `http://…/rest/v1//applications`, which
  // PostgREST answers with a 404 that reads like a missing table. Config's own
  // `restUrl` default has always ended in `/rest/v1/`, so the transport strips
  // it rather than trusting every caller.
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  async function authHeaders(): Promise<Record<string, string>> {
    const bearer = typeof config.token === "function" ? await config.token() : config.token;
    return bearer ? { Authorization: `Bearer ${bearer}` } : {};
  }

  async function send<R = unknown>(url: string, shape: Shape, headers: Record<string, string>): Promise<Result<R>> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: shape.method,
        headers,
        ...(["GET", "HEAD", "DELETE"].includes(shape.method) ? {} : { body: JSON.stringify(shape.body ?? null) }),
        cache: "no-store",
      });
    } catch (cause) {
      return { data: null, error: { message: `rest: ${baseUrl} unreachable — ${(cause as Error).message}` }, count: null };
    }

    const range = res.headers.get("content-range");
    const count = range && /\/\d+$/.test(range) ? Number(range.split("/")[1]) : null;
    if (res.status === 204 || res.status === 205) return { data: null, error: null, count };

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        data: null,
        error: { message: body?.message ?? res.statusText, code: body?.code, details: body?.details, hint: body?.hint },
        count,
      };
    }
    // A head-count request has no body by contract; the count is the answer.
    if (shape.method === "HEAD") return { data: null, error: null, count };

    /* Read the body as TEXT and parse it by hand, because a 2xx is not a
     * promise of JSON: a bare `insert()` with no `return=representation` is a
     * 201 with an EMPTY body, and PostgREST can also answer 200 with a non-JSON
     * document (an HTML error page from the gateway in front of it). A bare
     * `await res.json()` threw on both, and the throw escaped as an unhandled
     * rejection out of the awaited chain — the one failure mode this transport
     * is supposed to convert into `{ data: null, error }`. An empty or
     * unparseable success body answers exactly like the 204 branch above: no
     * rows, no error, because the write happened and nothing was promised back. */
    const text = await res.text();
    if (text === "") return { data: null, error: null, count };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { data: null, error: null, count };
    }

    // `parsed` crosses to `R` here, at the one place a body becomes rows. `R`
    // is the row type the builder carries (`any[]` for a read, a single row for
    // `.single()`), which is how the ported chains keep their old types; the
    // transport has no schema to check it against — PostgREST gave us JSON and
    // the caller annotated the row.
    const rows = parsed as R;

    if (shape.single || shape.maybeSingle) {
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.length === 0 && shape.maybeSingle) return { data: null, error: null, count };
      if (list.length !== 1) {
        return { data: null, error: { message: `rest: expected one row, got ${list.length}`, code: "PGRST116" }, count };
      }
      return { data: list[0] as R, error: null, count };
    }
    return { data: rows, error: null, count };
  }

  async function run<R>(table: string, builder: QueryBuilder<R>): Promise<Result<R>> {
    const shape = builder.shape_();
    const headers: Record<string, string> = {
      // `single()` alone asks for the object form. `maybeSingle()` must NOT: a
      // zero-row result under `application/vnd.pgrst.object+json` is a 406
      // PGRST116 (measured on the local stack), which would turn every honest
      // "no such row" at the 141 maybeSingle sites into an error, while the
      // plain array form lets the branch above answer `data: null, error: null`
      // exactly the way supabase-js does.
      Accept: shape.single && !shape.maybeSingle
        ? "application/vnd.pgrst.object+json"
        : "application/json",
      ...(await authHeaders()),
    };

    const prefer: string[] = [];
    if (shape.count) prefer.push(`count=${shape.count}`);
    /* Representation follows the REQUEST, not the verb. `shape.returning` is set
     * only by an explicit `.select(…)` / `.single()` / `.maybeSingle()` in the
     * chain, which is what the two idioms mean in supabase-js:
     *   `.insert(row).select("id").single()` → POST + return=representation, and
     *     the action learns its new id;
     *   `.delete().eq("id", id).select()`    → DELETE + return=representation,
     *     and the removed rows come back — which is why DELETE is in this test
     *     even though the verb alone would never ask for rows.
     * A bare `.insert(row)` sends no representation and answers `data: null`,
     * the same answer the vendor's client gives, so the ~91 call sites that only
     * destructure `error` keep seeing exactly that. Gating on the verb instead
     * would hand them rows they never asked for. */
    if (shape.returning && (shape.method === "POST" || shape.method === "PATCH" || shape.method === "DELETE")) {
      prefer.push("return=representation");
    }
    if (shape.method === "POST" && shape.onConflict) {
      prefer.unshift(shape.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates");
    }
    if (prefer.length) headers.Prefer = prefer.join(",");
    if (shape.method === "POST" || shape.method === "PATCH") headers["Content-Type"] = "application/json";

    return send(`${baseUrl}${buildUrl(table, builder)}`, shape, headers);
  }

  return {
    from(table: string) {
      const builder = new QueryBuilder();
      // Thenable, because every existing site writes
      // `await supabase.from(x).select(y)` with no terminal call. Without this
      // the port would mean editing 454 chains — the thing spec §1 forbids.
      return Object.assign(builder, {
        then<T1, T2>(
          onFulfilled?: ((r: Result<Rows>) => T1 | PromiseLike<T1>) | null,
          onRejected?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
        ) {
          return run(table, builder).then(onFulfilled, onRejected);
        },
      });
    },

    async rpc(name: string, body?: object): Promise<Result> {
      const url = `${baseUrl}/rpc/${encodeURIComponent(name)}`;
      let res: Response | null = null;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...(await authHeaders()) },
          body: JSON.stringify(body ?? {}),
          cache: "no-store",
        });
      } catch {
        return { data: null, error: { message: `rest: rpc ${name} unreachable` }, count: null };
      }
      const range = res.headers.get("content-range");
      const count = range && /\/\d+$/.test(range) ? Number(range.split("/")[1]) : null;
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        return { data: null, error: { message: j?.message ?? res.statusText, code: j?.code }, count };
      }
      if (res.status === 204) return { data: null, error: null, count };
      const text = await res.text();
      // Same rule as `send()`: a 2xx that is not JSON answers `data: null`
      // rather than throwing out of the awaited call.
      if (!text) return { data: null, error: null, count };
      try {
        return { data: JSON.parse(text) as unknown, error: null, count };
      } catch {
        return { data: null, error: null, count };
      }
    },
  };
}

export type RestClient = ReturnType<typeof createRestClient>;
