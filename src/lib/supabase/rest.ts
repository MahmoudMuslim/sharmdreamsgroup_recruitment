import { supabaseConfig } from "@/lib/config";

/**
 * Minimal Supabase REST (PostgREST) fetch helper for contexts where the
 * supabase-js SDK is unnecessary — e.g. the assessment draft autosave loop,
 * which patches a single row with the anon key + attempt token.
 */
export interface RestCallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Table name, e.g. "candidate_attempts" */
  table: string;
  /** PostgREST query params, e.g. { "id": "eq.123" } */
  query?: Record<string, string>;
  body?: unknown;
  /** Overrides Authorization header, e.g. `Bearer <anon>` */
  bearerToken?: string;
  signal?: AbortSignal;
}

export interface RestCallResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function supabaseRestCall<T = unknown>(options: RestCallOptions): Promise<RestCallResult<T>> {
  const { method = "GET", table, query, body, bearerToken, signal } = options;

  const params = new URLSearchParams(query ?? {});
  const url = `${supabaseConfig.restUrl}${table}${params.size > 0 ? `?${params.toString()}` : ""}`;

  const headers: Record<string, string> = {
    apikey: supabaseConfig.anonKey,
    Authorization: `Bearer ${bearerToken ?? supabaseConfig.anonKey}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=minimal" : "return=representation",
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, data: null, error: text.slice(0, 500) };
    }

    if (method === "POST") {
      return { ok: true, status: response.status, data: null, error: null };
    }

    const text = await response.text();
    const data = text.length > 0 ? (JSON.parse(text) as T) : null;
    return { ok: true, status: response.status, data, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown REST error";
    return { ok: false, status: 0, data: null, error: message };
  }
}
