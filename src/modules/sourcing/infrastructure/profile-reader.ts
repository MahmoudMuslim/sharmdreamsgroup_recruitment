import "server-only";

/**
 * Reads a prospect's public profile page into text for the extractor.
 *
 * A recruiter pastes a profile URL and this returns what the page actually said,
 * or a precise reason it did not. There is no pretending: LinkedIn answers an
 * automated request with HTTP 999 and no amount of header tuning changes that,
 * so a blocked read says so and points at the paste/export path that does work.
 * The user-agent identifies this application rather than impersonating a
 * browser, because a disguised crawler is exactly what these sites block for.
 *
 * The URL arrives from a person in the admin portal, but it is fetched from the
 * server, so it is treated as untrusted input: http(s) only, resolved addresses
 * must be public, and redirects are re-validated one hop at a time. Without that,
 * a pasted link would be a way to reach the database box from the web app.
 */

import { lookup } from "node:dns/promises";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 30_000;
const TIMEOUT_MS = 12_000;
const MAX_HOPS = 4;

const USER_AGENT = "SharmDreamsTalentCloud/1.0 (recruiter-initiated profile read)";

export interface ProfileRead {
  /** The page as plain text, plus any structured blocks found in it. */
  text: string;
  /** What was read, in the words the drawer shows. */
  detail: string;
  /** Whichever host the text finally came from. */
  host: string;
}

export interface ProfileReadBlocked {
  /** Why nothing could be read, phrased for a recruiter. */
  reason: string;
  /** What to do instead, phrased for a recruiter. */
  hint: string;
}

export type ProfileReadOutcome = ProfileRead | (ProfileReadBlocked & { ok: false });

function blocked(reason: string, hint: string): ProfileReadBlocked & { ok: false } {
  return { ok: false, reason, hint };
}

function isRead(value: ProfileReadOutcome): value is ProfileRead {
  return !("ok" in value);
}

/* -------------------------------------------------------------------------- */
/* Address safety                                                              */
/* -------------------------------------------------------------------------- */

/** True for loopback, private, link-local and other non-public ranges. */
function isPrivateAddress(address: string): boolean {
  const ip = address.includes(".") ? address : address.toLowerCase();

  if (/^::1$|^::$/.test(ip)) return true;
  if (/^f[0-9a-f]{2}:|^[0-9a-f]{2,4}:/.test(ip) && !/^2/.test(ip)) return true; // ULA + other v6 locals
  if (/^(::ffff:)?127\.|^(::ffff:)?10\.|^(::ffff:)?192\.168\./.test(ip)) return true;
  if (/^(::ffff:)?169\.254\./.test(ip)) return true;
  if (/^(::ffff:)?172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(::ffff:)?0\.|^(::ffff:)?100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  return false;
}

/**
 * Rejects anything that is not a public http(s) page.
 *
 * `localhost`, the cloud metadata address and private ranges are refused before
 * name resolution, then the resolved addresses are checked as well, so a public
 * hostname that points at an internal address is still refused.
 */
async function safeUrl(raw: string): Promise<URL | string> {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return "That is not a web address.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https links can be read.";
  if (url.username || url.password) return "A link with credentials in it will not be fetched.";

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    return "That address points at a private host.";
  }
  if (/^[0-9.]+$/.test(host) && isPrivateAddress(host)) return "That address points at a private network.";

  try {
    const records = await lookup(host, { all: true });
    if (records.some((record) => isPrivateAddress(record.address))) {
      return "That address resolves to a private network.";
    }
  } catch {
    return "That host name does not resolve.";
  }

  return url;
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

async function fetchPage(start: URL): Promise<{ body: string; finalUrl: URL; status: number; type: string }> {
  let target = start;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const response = await fetch(target.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      const next = new URL(location, target);
      const checked = await safeUrl(next.toString());
      if (typeof checked === "string") {
        return { body: "", finalUrl: next, status: response.status, type: "redirect-refused" };
      }
      target = checked;
      continue;
    }

    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      return { body: "", finalUrl: target, status: response.status, type: "too-large" };
    }

    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    const buffer = await readCapped(response.body);
    return { body: buffer, finalUrl: target, status: response.status, type };
  }

  return { body: "", finalUrl: target, status: 0, type: "too-many-redirects" };
}

/** Streams the body so a page larger than the cap never lands fully in memory. */
async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= MAX_BYTES) {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, MAX_BYTES).toString("utf-8");
}

/* -------------------------------------------------------------------------- */
/* Text extraction                                                             */
/* -------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,7});/g, (whole, entity: string) => {
    const hex = /^#x/i.test(entity);
    const code = hex
      ? Number.parseInt(entity.slice(2), 16)
      : entity.startsWith("#")
        ? Number.parseInt(entity.slice(1), 10)
        : Number.NaN;

    if (Number.isFinite(code)) {
      // A lone surrogate or an out-of-range number would throw, and a page
      // full of authoring artefacts is not worth failing a read over.
      const usable = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return usable ? String.fromCodePoint(code) : whole;
    }

    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Block edges become newlines before tags are dropped, so lines stay lines. */
function htmlToStructuredText(html: string): string {
  const withBreaks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|section|article|h[1-6]|tr|br|header|footer|dd|dt)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(p|li|h[1-6]|tr|section|article|div)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");

  return decodeEntities(withBreaks)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The page's own metadata and structured data, ahead of the body text.
 *
 * `<title>`, the Open Graph description and any JSON-LD block are the parts a
 * site writes *about* the page, so they are the least noisy signal there is, and
 * JSON-LD is already the shape the extractor wants. Kept as a labelled prefix so
 * a recruiter reading the raw text can tell where each part came from.
 */
function pageMetadata(html: string): string {
  const parts: string[] = [];

  const title = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (title?.[1]) parts.push(`TITLE: ${decodeEntities(title[1].replace(/\s+/g, " ").trim())}`);

  for (const match of html.matchAll(
    /<meta[^>]+(?:property|name)\s*=\s*["'](og:[a-z_:]+|description|keywords)["'][^>]*>/gi
  )) {
    const tag = match[0];
    const name = match[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*"([^"]{0,600})"/i)?.[1] ?? tag.match(/content\s*=\s*'([^']{0,600})'/i)?.[1];
    if (name && content) parts.push(`${name.toUpperCase()}: ${decodeEntities(content).replace(/\s+/g, " ").trim()}`);
  }

  for (const match of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]{0,20000}?)<\/script>/gi)) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(decodeEntities(raw));
      parts.push(`STRUCTURED DATA (JSON-LD):\n${JSON.stringify(parsed, null, 1).slice(0, 8_000)}`);
    } catch {
      parts.push(`STRUCTURED DATA (JSON-LD):\n${raw.slice(0, 4_000)}`);
    }
  }

  return parts.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Host-specific readers                                                       */
/* -------------------------------------------------------------------------- */

const GITHUB_PROFILE = /^github\.com\/([^/?#]+)$/i;
const GITHUB_API = /^api\.github\.com$/i;

/** `github.com/<login>` and `api.github.com/users/<login>` are the same person. */
function githubLogin(url: URL): string | null {
  if (GITHUB_API.test(url.hostname)) {
    const match = url.pathname.match(/^\/users\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }
  if (!/^github\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(GITHUB_PROFILE)?.[1];
  if (!match) return null;
  const reserved = new Set(["login", "join", "features", "about", "enterprise", "topics", "collections", "sponsors"]);
  return reserved.has(match.toLowerCase()) ? null : match;
}

async function githubJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

interface GithubUser {
  login?: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  email?: string | null;
  public_repos?: number;
  followers?: number;
  hireable?: boolean | null;
}

interface GithubRepo {
  name?: string;
  full_name?: string;
  description?: string | null;
  html_url?: string;
  language?: string | null;
  stargazers_count?: number;
  topics?: string[];
  pushed_at?: string;
  fork?: boolean;
}

/**
 * A GitHub profile read through the public API.
 *
 * GitHub is the one host in this list that hands back structured data instead of
 * a login wall, so it is read through the API rather than by scraping its HTML:
 * the person, then the repositories they have pushed to most recently, which is
 * where a developer's projects and languages actually show up.
 */
async function readGithub(login: string): Promise<ProfileReadOutcome> {
  const profile = await githubJson<GithubUser>(`/users/${encodeURIComponent(login)}`);
  if (!profile) return blocked(`GitHub has no public user called “${login}”.`, "Check the link, or paste the profile text instead.");

  const repos =
    (await githubJson<GithubRepo[]>(`/users/${encodeURIComponent(login)}/repos?per_page=30&sort=pushed`)) ?? [];
  const own = repos.filter((repo) => repo && !repo.fork).slice(0, 20);

  const lines: string[] = ["GITHUB PROFILE", `USERNAME: ${profile.login ?? login}`];
  const field = (label: string, value: string | null | undefined) => {
    if (value && String(value).trim()) lines.push(`${label}: ${String(value).trim()}`);
  };

  field("NAME", profile.name);
  field("BIO", profile.bio);
  field("COMPANY", profile.company);
  field("LOCATION", profile.location);
  field("WEBSITE", profile.blog);
  field("PUBLIC EMAIL", profile.email);
  if (profile.hireable) lines.push("OPEN TO WORK: yes");
  field("FOLLOWERS", profile.followers == null ? null : String(profile.followers));

  if (own.length) {
    lines.push(`\nREPOSITORIES (${own.length} most recently pushed of ${profile.public_repos ?? own.length}):`);
    for (const repo of own) {
      const topics = (repo.topics ?? []).slice(0, 8).join(", ");
      lines.push(
        [
          `- ${repo.full_name ?? repo.name}`,
          repo.description,
          [repo.language, repo.stargazers_count ? `${repo.stargazers_count} stars` : null, topics]
            .filter(Boolean)
            .join(" · "),
          repo.html_url,
        ]
          .filter(Boolean)
          .join(" — ")
      );
    }
  }

  return {
    text: lines.join("\n").slice(0, MAX_CHARS),
    detail: own.length ? `GitHub profile and ${own.length} repositories` : "GitHub profile",
    host: "github.com",
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reads whatever a public profile page will give up.
 *
 * GitHub is answered by its API. LinkedIn is attempted and, when it refuses, the
 * recruiter is told the status code it sent and given the path that does work —
 * they can see the profile in their own browser, so copying it out costs them one
 * action and produces more detail than any crawler would get.
 */
export async function readProfileFromUrl(raw: string): Promise<ProfileReadOutcome> {
  const checked = await safeUrl(raw);
  if (typeof checked === "string") return blocked(checked, "Paste the profile text instead — that always works.");

  const url = checked;

  const login = githubLogin(url);
  if (login) return readGithub(login);

  if (/linkedin\.com/i.test(url.hostname)) {
    // Attempted rather than assumed: the answer below reports what LinkedIn
    // actually returned to us just now, not what we remember about them.
    let page;
    try {
      page = await fetchPage(url);
    } catch {
      return blocked(
        "LinkedIn did not answer the request.",
        "Open the profile in your browser, select the page, copy it and paste it into “Paste profile text”."
      );
    }

    const text = page.body ? htmlToStructuredText(page.body) : "";
    if (page.status >= 200 && page.status < 300 && text.length > 400 && !/authwall|sign in to view/i.test(text.slice(0, 2_000))) {
      const meta = pageMetadata(page.body);
      return {
        text: [meta, text].filter(Boolean).join("\n\n").slice(0, MAX_CHARS),
        detail: "LinkedIn page as served to this application",
        host: url.hostname,
      };
    }

    return blocked(
      page.status === 0
        ? "LinkedIn redirected this request in a circle and never served the profile."
        : `LinkedIn answered with HTTP ${page.status}${
            /json/i.test(page.type) ? "" : ` (“${page.type.split(";")[0] || "no content type"}” returned)`
          } — the profile itself sits behind a login, so it is not readable by any automated request.`,
      "You can see the profile in your own browser: open it, select the page, copy it and use “Paste profile text”. LinkedIn's own “Save to PDF” or account export works too, under “Upload export”."
    );
  }

  let page;
  try {
    page = await fetchPage(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "the request did not complete";
    return blocked(`That page could not be fetched: ${message.slice(0, 160)}`, "Paste the page text instead.");
  }

  if (page.type === "too-large") return blocked("That page is larger than 2 MB.", "Paste the part that describes the person.");
  if (page.type === "too-many-redirects") return blocked("That link redirected too many times.", "Paste the profile text instead.");
  if (page.type === "redirect-refused") return blocked("That link redirects to a private address, so it was not followed.", "Use a public link instead.");
  if (page.status >= 400) return blocked(`That page answered with HTTP ${page.status}.`, "Check the link is public, or paste the text.");
  if (/^image\//.test(page.type) || /application\/pdf/.test(page.type)) {
    return blocked("That link is a file, not a web page.", "Use “Upload export” to read it instead.");
  }

  const body = /json/.test(page.type) ? page.body : htmlToStructuredText(page.body);
  const meta = /json/.test(page.type) ? "" : pageMetadata(page.body);
  const text = [meta, body].filter(Boolean).join("\n\n").trim();

  if (text.length < 200) {
    return blocked(
      "That page returned almost no text — it is probably rendered by JavaScript after loading.",
      "Paste the profile text instead: select the page in your browser, copy it, and paste it below."
    );
  }

  return {
    text: text.slice(0, MAX_CHARS),
    detail: `${page.finalUrl.hostname} · ${Math.round(text.length / 1000)}k characters read`,
    host: page.finalUrl.hostname,
  };
}

/** A paste needs no fetching; it only needs the length guard the prompt has. */
export function profileTextFromPaste(raw: string): ProfileRead {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  return {
    text: text.slice(0, MAX_CHARS),
    detail: `${(text.length / 1000).toFixed(1)}k characters pasted`,
    host: "paste",
  };
}

/** True when a read produced enough text to be worth sending to a model. */
export function isWorthExtracting(value: ProfileReadOutcome): value is ProfileRead {
  return isRead(value) && value.text.trim().length >= 120;
}
