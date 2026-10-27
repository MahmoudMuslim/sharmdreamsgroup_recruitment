import { connection } from "next/server";
import { getPublicJobs } from "@/app/careers/actions";
import { partitionByDate, jobsCsv } from "@/modules/careers/job-distribution";
import { appConfig } from "@/lib/config";

/**
 * The hand-off file a recruiter uploads to a named board.
 *
 * This is the only credential-free route onto a board the platform has no account
 * with, and it is a hand-off, not automation: someone downloads it, uploads it,
 * and answers the questions the record cannot — the salary period among them.
 *
 * Reads the same published rows as the board, so a draft cannot be exported; the
 * database, not this file, is what decides. `await connection()` for the
 * build-time reason the sitemap gives.
 */
export async function GET(): Promise<Response> {
  await connection();
  const jobs = await getPublicJobs();
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  return new Response(jobsCsv(publishable, appConfig.url), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sharm-dreams-openings.csv"',
      "Cache-Control": "no-store",
    },
  });
}
