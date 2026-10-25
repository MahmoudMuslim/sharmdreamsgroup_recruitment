import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { appConfig } from "@/lib/config";

/**
 * The paths a crawler is asked to skip.
 *
 * These pages are already behind the staff route guard, so this is about crawler
 * budget, not access: the staff console is a wall of post-login redirects, the
 * candidate portal is the same for a stranger, and the apply wizard has nothing a
 * public index should hold. The careers tree is deliberately absent — it is the
 * reason the file exists.
 */
const DISALLOW = [
  "/jobs",
  "/candidates",
  "/settings",
  "/reports",
  "/assessments",
  "/interviews",
  "/activity",
  "/analytics",
  "/assistant",
  "/dashboard",
  "/files",
  "/onboarding",
  "/questions",
  "/referrals",
  "/retention",
  "/sourcing",
  "/time",
  "/whatsapp",
  "/portal",
  "/test",
  "/login",
  "/api/",
  "/careers/apply",
];

/**
 * `Sitemap:` points at the deployment's own origin.
 *
 * The file reads no database, but it reads `APP_URL` — and the image is built
 * with no `.env*` (`.dockerignore`), so a prerendered robots.txt would bake the
 * *default* origin into its sitemap pointer and never see the deployment's own.
 * The file is a dozen lines; the cost of getting that pointer wrong is a crawler
 * that never finds the sitemap. So it waits for a request, like the sitemap does.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${appConfig.url.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
