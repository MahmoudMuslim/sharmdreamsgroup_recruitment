/**
 * The portal's own way to reach the public internet.
 *
 * Both assistant engines use this, which is the point: the Qoder runtime has its
 * own search tools, but the model gateway is a plain completions client with no
 * network path of its own. A recruiter who picks Gemini, DeepSeek or the routing
 * table's primary and switches web search on must still get a real lookup, so the
 * lookup belongs to the portal rather than to either engine.
 *
 * The search runs through OpenRouter's web plugin, which is the only provider in
 * this stack that will hand back the pages it found. Its citations carry the URL,
 * the page title and an excerpt of the page itself, so the answer is built from
 * what was fetched — never from what a model remembers. The prose the search model
 * writes is discarded on purpose: it costs tokens, and a model summarising its own
 * retrieval is exactly the second-hand figure this portal refuses to put in front of
 * a recruiter.
 *
 * `readWebPage` is guarded as an SSRF door, because the URL comes from a model:
 * only public http/https hosts, resolved before connecting, with every private,
 * loopback, link-local and metadata range refused on every redirect hop.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { aiConfig } from "@/lib/config.server";
import { resolveCredentials } from "@/modules/settings/infrastructure/credentialResolver";

/** Sources one search returns. Under the tool-result clip, so all of them arrive. */
const MAX_SOURCES = 6;
/** What of each page is quoted back. Long enough for a figure and its caption. */
const SNIPPET_CHARS = 700;
/** The search call is a retrieval, not an answer, so it is given almost no output. */
const SEARCH_OUTPUT_TOKENS = 64;
const SEARCH_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS = 25_000;
const MAX_PAGE_BYTES = 400_000;
/** Kept well under the 6000-char tool-result clip so the page arrives whole. */
const PAGE_CHARS = 4_500;
const MAX_REDIRECT_HOPS = 4;

/**
 * Search-carrier models, in order.
 *
 * Every one is an OpenRouter free-tier id: the retrieval is billed per search
 * result rather than per token, so paying for inference on top of it would double
 * the cost of a lookup for no gain. The chain exists because free ids are the
 * first to be rate-limited — see [[ai-provider-flakiness]].
 */
const SEARCH_MODELS = [
  "minimax/minimax-m3.1-flash:free",
  "nvidia/nemotron-3.5-lightning:free",
  "liquid/lfm-2.5-2.6b:free",
] as const;

export interface WebSource {
  title: string;
  url: string;
  /** The domain, because a band read on an aggregator means nothing without it. */
  host: string;
  snippet: string;
}

export interface WebSearchRead {
  ok: boolean;
  query: string;
  sources: WebSource[];
  /** How the lookup ran and what it did not cover — the model must repeat this. */
  note: string;
  error: string | null;
}

export interface WebPageRead {
  ok: boolean;
  url: string;
  host: string;
  title: string;
  text: string;
  note: string;
  error: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "a web page";
  }
}

/** The dotted quad as four numbers, or null when it is not IPv4. */
function ipv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

/**
 * Whether an address may not be dialed from the portal.
 *
 * Covers the ranges a hosted Postgres, a cloud metadata endpoint or a service on
 * the same machine would answer on — RFC1918, loopback, link-local, CGNAT,
 * multicast, reserved, and the IPv6 equivalents including the mapped and 6to4
 * forms that hide an IPv4 address inside them.
 */
function isBlockedAddress(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 0 || b === 168)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  const lower = address.toLowerCase().split("%")[0];
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  // ::ffff:a.b.c.d and 6to4/6to4-mapped forms carry an IPv4 address to check.
  const embedded = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower)?.[1];
  if (embedded) return isBlockedAddress(embedded);
  const hexTail = /^2002:/.test(lower) ? lower.slice(5).replace(/:/g, "").slice(0, 8) : "";
  if (hexTail.length === 8) {
    const octets = hexTail.match(/../g)?.map((pair) => Number.parseInt(pair, 16));
    if (octets?.length === 4) return isBlockedAddress(octets.join("."));
  }
  return false;
}

/**
 * Refuse anything that is not a public web host before a socket is opened.
 *
 * A name is resolved rather than trusted as a name: `internal.example` and a DNS
 * record that points at 169.254.169.254 both look harmless in a URL and both
 * answer on a private address.
 */
async function blockReason(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "That is not a URL I can read.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Only http and https pages can be read, not "${url.protocol}".`;
  }
  if (url.username || url.password) {
    return "A URL with credentials in it is not fetched.";
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return "That URL names no host.";
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? "That address is inside a private, loopback or link-local range, so the portal will not open it."
      : null;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    return `The host "${host}" does not resolve.`;
  }
  if (records.length === 0) return `The host "${host}" does not resolve.`;
  const blocked = records.find((record) => isBlockedAddress(record.address));
  return blocked
    ? `"${host}" resolves to ${blocked.address}, a private or reserved address, so the portal will not open it.`
    : null;
}

/** The plugin's answer, with the excerpt markers it uses for a cut-down page. */
function tidy(text: string): string {
  return text
    .replace(/\.\.\.\s*\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

interface Citation {
  type?: unknown;
  url_citation?: { url?: unknown; title?: unknown; content?: unknown };
}

function citationsFrom(payload: unknown): WebSource[] {
  const choices = (payload as { choices?: { message?: { annotations?: unknown } }[] } | null)?.choices;
  const raw = choices?.[0]?.message?.annotations;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const entry of raw as Citation[]) {
    const citation = entry?.url_citation;
    const url = typeof citation?.url === "string" ? citation.url : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title:
        typeof citation?.title === "string" && citation.title.trim()
          ? citation.title.trim().slice(0, 160)
          : hostOf(url),
      url,
      host: hostOf(url),
      snippet:
        typeof citation?.content === "string"
          ? tidy(citation.content).slice(0, SNIPPET_CHARS)
          : "",
    });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

/**
 * Search the public web for any subject the portal's records cannot answer.
 *
 * Deliberately unrestricted in topic — a pay band, a company, a visa rule, a
 * framework's release notes, a competitor's ad all go down the same path. The
 * engine answering the recruiter is not involved in the lookup at all, which is
 * what lets the switch work whichever engine or model was chosen.
 */
export async function searchWeb(query: string, maxResults = MAX_SOURCES): Promise<WebSearchRead> {
  const words = query.trim().replace(/\s+/g, " ").slice(0, 240);
  const refused = (error: string): WebSearchRead => ({
    ok: false,
    query: words,
    sources: [],
    note: "",
    error,
  });
  if (!words) return refused("The search needs some words.");

  const credentials = await resolveCredentials("openrouter");
  const keys = credentials.map((entry) => entry.secret).filter(Boolean);
  if (keys.length === 0 && aiConfig.openRouter.apiKey) keys.push(aiConfig.openRouter.apiKey);
  if (keys.length === 0) {
    return refused(
      "Web search runs through OpenRouter, and no OpenRouter key is stored in Settings → API keys " +
        "or set in the environment, so the lookup could not run."
    );
  }

  const wanted = Math.max(1, Math.min(Math.floor(maxResults) || MAX_SOURCES, MAX_SOURCES));
  const failures: string[] = [];

  for (const model of SEARCH_MODELS) {
    for (const key of keys) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
      try {
        const response = await fetch(aiConfig.openRouter.baseUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sharmdreams.com",
            "X-Title": "Sharm Dreams Talent Cloud",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: words }],
            max_tokens: SEARCH_OUTPUT_TOKENS,
            plugins: [{ id: "web", parameters: { max_results: wanted } }],
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          failures.push(`${model} HTTP ${response.status}: ${body.slice(0, 140)}`);
          continue;
        }
        const payload = await response.json().catch(() => null);
        const sources = citationsFrom(payload);
        if (sources.length === 0) {
          const reason = (payload as { error?: { message?: string } } | null)?.error?.message;
          failures.push(`${model}: ${reason ?? "the search came back with no sources"}`);
          continue;
        }
        return {
          ok: true,
          query: words,
          sources,
          note:
            `${sources.length} page${sources.length === 1 ? "" : "s"} retrieved for "${words}" by ${model} ` +
            "through OpenRouter's web search, at the moment this turn ran. The snippet is what the page " +
            "said, not this portal's data: quote it with its URL and its host, name the market, currency " +
            "and date each figure describes, and give a range when the pages disagree. Never write a fetched " +
            "figure into a record, and never add a number these pages do not carry.",
          error: null,
        };
      } catch (error) {
        failures.push(
          `${model}: ${error instanceof Error ? (error.name === "AbortError" ? "timed out" : error.message) : "failed"}`
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return refused(`The web search could not run. ${failures.slice(0, 3).join(" | ")}`);
}

/** Strip the markup a page is wrapped in, keeping the text a person would read. */
function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const decoded = body
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number(code);
      return point > 31 && point < 0x10ffff ? String.fromCodePoint(point) : match;
    });
  const text = decoded
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title.replace(/\s+/g, " ").trim(), text };
}

/** Read a body up to a byte ceiling, so a huge page cannot be pulled into memory. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, MAX_PAGE_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    chunks.push(total > MAX_PAGE_BYTES ? value.slice(0, value.length - (total - MAX_PAGE_BYTES)) : value);
    if (total >= MAX_PAGE_BYTES) {
      capped = true;
      break;
    }
  }
  if (capped) await reader.cancel().catch(() => undefined);
  const buffer = new Uint8Array(Math.min(total, MAX_PAGE_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

/**
 * Fetch one public page and return its text.
 *
 * Redirects are followed by hand and re-checked at every hop, because a public
 * URL that redirects to a metadata address is the classic way this door is
 * tested. Nothing is sent to the host but the GET itself: no cookie, no token,
 * no header that says this portal exists.
 */
export async function readWebPage(rawUrl: string): Promise<WebPageRead> {
  const blank = { url: rawUrl, host: hostOf(rawUrl), title: "", text: "", note: "" };
  const refused = (error: string): WebPageRead => ({ ...blank, ok: false, text: "", note: "", error });

  let url = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  if (url.length > 512) return refused("That URL is longer than the portal will follow.");

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const blocked = await blockReason(url);
    if (blocked) return refused(blocked);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9",
          "User-Agent": "SharmDreamsTalentCloud/1.0 (staff assistant; read-only)",
        },
      });
    } catch (error) {
      clearTimeout(timer);
      return refused(
        `The page could not be fetched: ${error instanceof Error ? (error.name === "AbortError" ? "it timed out" : error.message) : "unknown error"}`
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return refused(`The host answered ${response.status} without saying where it went.`);
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        return refused(`The redirect target "${location.slice(0, 120)}" is not a URL I can read.`);
      }
      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return refused(`The page answered ${response.status}, so nothing was read from it.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await readCapped(response);
    const host = hostOf(url);
    if (/pdf|image|audio|video|zip|octet-stream/i.test(contentType)) {
      return refused(
        `That is a ${contentType.split(";")[0]} file, not a page, and the portal reads no binaries here. ` +
          "Give me the page that hosts it, or the figures themselves."
      );
    }
    const isHtml = /html/i.test(contentType) || /<html|<body|<div/i.test(raw.slice(0, 400));
    const { title, text } = isHtml ? htmlToText(raw) : { title: "", text: tidy(raw) };
    if (!text) return refused("The page came back with no readable text in it.");
    const clipped = text.length > PAGE_CHARS;
    return {
      ok: true,
      url,
      host,
      title: title || host,
      text: clipped ? text.slice(0, PAGE_CHARS) : text,
      note:
        `${(clipped ? PAGE_CHARS : text.length).toLocaleString()} characters of ${host}` +
        (clipped ? ` — the page is longer, so the rest was left off (${text.length.toLocaleString()} characters read).` : ".") +
        " This is the page's own wording at the moment it was fetched. Quote it with the URL; never move a figure " +
        "from here into a record.",
      error: null,
    };
  }

  return refused(`I stopped following that link after ${MAX_REDIRECT_HOPS} redirects.`);
}
