import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs before every matched request to refresh the Supabase auth cookie and
 * gate the recruiter portal. Named `proxy` per the Next.js 16 convention
 * (replaces the deprecated `middleware` file convention).
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files, so the auth cookie is
     * refreshed before any Server Component reads it.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};