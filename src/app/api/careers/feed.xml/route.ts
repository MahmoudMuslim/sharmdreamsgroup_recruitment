import { connection } from "next/server";
import { getPublicCompanies, getPublicJobs } from "@/app/careers/actions";
import { groupProfile } from "@/modules/careers/company-profile";
import { GROUP_NAME } from "@/modules/careers/job-posting";
import { partitionByDate, rssFeed } from "@/modules/careers/job-distribution";
import { appConfig } from "@/lib/config";

/**
 * The board as a feed, for anyone who aggregates rather than crawls.
 *
 * Under `/api/careers/` because that is where the careers API already lives, and
 * because a folder named `feed.xml` inside `src/app/careers/` would sit beside the
 * `[id]` dynamic segment and read like one.
 *
 * Not prerendered, for the sitemap's reason: the image builds with no database,
 * so `await connection()` is what keeps a feed of live roles from being baked at
 * build time. `no-store` because a recruiter who hands this URL to an aggregator
 * will re-fetch it, and a day-stale copy of a closed role is worse than a
 * re-read.
 */
export async function GET(): Promise<Response> {
  await connection();
  const [jobs, companies] = await Promise.all([getPublicJobs(), getPublicCompanies()]);
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  const title = groupProfile(companies)?.name ?? GROUP_NAME;
  const base = appConfig.url.replace(/\/+$/, "");
  const body = rssFeed(publishable, {
    baseUrl: appConfig.url,
    title,
    link: `${base}/careers`,
    description: `Open roles with ${title}.`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
