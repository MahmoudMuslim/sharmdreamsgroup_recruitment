import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getPublicJobs } from "@/app/careers/actions";
import { appConfig } from "@/lib/config";
import { partitionByDate, sitemapEntries } from "@/modules/careers/job-distribution";

/**
 * Every public URL the site has, and only those.
 *
 * The board's own cached read is the source, so `jobs_public_read` decides what
 * appears — a draft cannot be listed here any more than it can be shown on
 * `/careers`. Nothing from the staff console, the candidate portal or the apply
 * wizard is in this list: they are not public, and a crawler finding them buys
 * nothing but a wasted fetch.
 *
 * It reads the database, so it must not be prerendered: the Docker image builds
 * with no database and no secrets (`.dockerignore` excludes `.env*`), and a
 * `use cache` scope reachable from a prerendered route is executed during the
 * build's cache-warming phase. `await connection()` is the same mechanism, and
 * the same reason, as `src/app/careers/page.tsx`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const jobs = await getPublicJobs();
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  const base = appConfig.url.replace(/\/+$/, "");
  const landing = new Date();

  return [
    { url: `${base}/`, lastModified: landing, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/careers`, lastModified: landing, changeFrequency: "daily", priority: 0.9 },
    ...sitemapEntries(publishable, appConfig.url),
  ];
}
