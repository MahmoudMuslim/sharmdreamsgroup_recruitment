import { type NextRequest } from "next/server";
import { guardRequest } from "@/lib/auth/guard";

/**
 * Runs before every matched request to verify the session bearer, refresh the
 * idle stamp, and gate the recruiter portal. Named `proxy` per the Next.js 16
 * convention (replaces the deprecated `middleware` file convention).
 */
export async function proxy(request: NextRequest) {
  return guardRequest(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
