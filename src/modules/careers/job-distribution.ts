/**
 * The three pull surfaces: a sitemap, an RSS feed and a CSV.
 *
 * Each takes the published roles and the one public base URL and returns the
 * whole artifact, so the routes that serve them are thin — read, call, respond —
 * and a reviewer can read the escaping rules once. `dateOf` is imported for
 * real, not as a type: the sitemap, the feed, the CSV and the JSON-LD all ask the
 * same question and must get the same day.
 */

import type { PublicJob } from "@/modules/careers/job-board";
import { dateOf } from "@/modules/careers/job-posting";

/** Structurally what `MetadataRoute.Sitemap` asks for, without importing `next`. */
export interface SitemapEntry {
  url: string;
  lastModified: string;
  changeFrequency: "daily" | "weekly";
  priority: number;
}

/** The base URL with no trailing slash, so paths never become `//careers/{id}`. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * The roles that can be published, and the ids of the ones that cannot.
 *
 * Every surface drops an undated role; only the caller can say anything about it,
 * so the split is exposed rather than buried in each writer. The route logs the
 * ids — a role silently missing from a sitemap is the kind of bug nobody notices
 * until a recruiter asks why.
 */
export function partitionByDate(jobs: PublicJob[]): {
  publishable: PublicJob[];
  undated: string[];
} {
  const publishable: PublicJob[] = [];
  const undated: string[] = [];
  for (const job of jobs) {
    if (dateOf(job)) publishable.push(job);
    else undated.push(job.id);
  }
  return { publishable, undated };
}

/**
 * One entry per published role.
 *
 * `/` and `/careers` are added by the route, which knows the site; this knows the
 * roles. An undated role is skipped here as well as in `partitionByDate` — the
 * writers stay total so no caller can build a broken artifact by handing them the
 * raw board.
 */
export function sitemapEntries(jobs: PublicJob[], baseUrl: string): SitemapEntry[] {
  const base = origin(baseUrl);
  const entries: SitemapEntry[] = [];
  for (const job of jobs) {
    const lastModified = dateOf(job);
    if (!lastModified) continue;
    entries.push({
      url: `${base}/careers/${job.id}`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  return entries;
}

/**
 * One RFC 4180 field: always quoted, internal quotes doubled.
 *
 * A role's description is free text a recruiter typed, so commas and newlines are
 * ordinary. Quoting every field rather than the ones that need it means the rule
 * has no branch to get wrong.
 */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  "title",
  "company",
  "location",
  "job_type",
  "department",
  "sector",
  "description",
  "requirements",
  "date_posted",
  "url",
];

/**
 * The hand-off file a recruiter uploads to a named board.
 *
 * There is no salary column, for the same reason there is no `baseSalary`: the
 * period is unrecorded, and a board's upload form will ask for it — the recruiter
 * answers that, explicitly, on the board. `job_type` carries the stored code
 * rather than a rendered label, because the board has its own vocabulary and the
 * record's own words are the honest thing to hand over. This is a hand-off, not
 * automation, and the CSV says so by carrying nothing a board has to be told.
 */
export function jobsCsv(jobs: PublicJob[], baseUrl: string): string {
  const base = origin(baseUrl);
  const rows = jobs
    .map((job) => {
      const posted = dateOf(job);
      if (!posted) return null;
      return [
        job.title,
        job.company_name ?? "",
        job.location,
        job.employment_type,
        job.department,
        job.sector,
        job.description,
        job.requirements.join("; "),
        posted,
        `${base}/careers/${job.id}`,
      ]
        .map((field) => csvField(field ?? ""))
        .join(",");
    })
    .filter((row): row is string => row !== null);

  return [CSV_HEADER.join(","), ...rows].join("\n");
}

/**
 * Text, escaped in the one order that works: the ampersand first.
 *
 * Quotes are deliberately left alone. A text node has no delimiter to close
 * early, so `"` carries no meaning here — escaping it would only make the title
 * harder for a human reader of the feed to recognise. The one attribute this
 * module writes is the literal `isPermaLink="true"`, so no role text ever lands
 * where a quote could break it; if the feed gains an attribute that carries a
 * role's words, that value needs its own escaper that adds `"` to `&`, `<`, `>`.
 */
function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * RFC 822, the form RSS 2.0 expects.
 *
 * `toUTCString` gives `Thu, 01 Oct 2026 00:00:00 GMT`. An unparseable date from a
 * free-text column returns "" and the caller leaves the element out rather than
 * publishing an epoch nobody meant.
 */
function rfc822(iso: string | null | undefined): string {
  if (!iso) return "";
  const asDate = new Date(iso);
  return Number.isNaN(asDate.getTime()) ? "" : asDate.toUTCString();
}

/**
 * The board as an RSS 2.0 feed, for anyone who aggregates rather than crawls.
 *
 * Text is escaped rather than wrapped in CDATA: a description containing `]]>`
 * would end the section early, and escaping is not hard. The channel title is
 * supplied by the route because it is the group's own name, not something the
 * roles carry.
 */
export function rssFeed(
  jobs: PublicJob[],
  options: {
    baseUrl: string;
    title: string;
    link?: string;
    description?: string;
    publishedAt?: string;
  }
): string {
  const base = origin(options.baseUrl);
  const board = options.link ?? `${base}/careers`;
  const items: string[] = [];

  for (const job of jobs) {
    const posted = dateOf(job);
    if (!posted) continue;
    const url = `${base}/careers/${job.id}`;
    const pubDate = rfc822(posted);
    items.push(
      [
        "    <item>",
        `      <title>${xmlText(job.title)}</title>`,
        `      <link>${xmlText(url)}</link>`,
        `      <guid isPermaLink="true">${xmlText(url)}</guid>`,
        `      <description>${xmlText(job.description)}</description>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        "    </item>",
      ].join("\n")
    );
  }

  // The newest item's date, because a feed that claims a build time before its
  // own newest entry is a feed a reader assumes is stale.
  const newest = items.length > 0
    ? rfc822(jobs.map(dateOf).filter((d): d is string => Boolean(d)).sort().reverse()[0])
    : "";
  const build = newest || rfc822(options.publishedAt);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${xmlText(options.title)}</title>`,
    `    <link>${xmlText(board)}</link>`,
    `    <description>${xmlText(options.description ?? `Open roles with ${options.title}.`)}</description>`,
    ...(build ? [`    <lastBuildDate>${build}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}
