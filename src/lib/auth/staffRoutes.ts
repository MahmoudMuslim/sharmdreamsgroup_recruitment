/**
 * The recruiter-only pages of the portal — the edge half of the staff gate.
 *
 * Every page listed here is subject to three checks the middleware runs, and the
 * reason this is one table instead of a per-page decision: an anonymous visitor
 * is sent to sign-in, a session that has idled past
 * `security.session_timeout_minutes` is signed out, and a signed-in *candidate*
 * is bounced. A page missing from this list is not wide open — its own
 * `requireStaff()` still refuses to render — which is exactly what makes the
 * omission invisible: the page looks secure while the idle sign-out and the
 * candidate bounce quietly stop applying to it. Seven of the sixteen pages sat in
 * that state until 2026-10-16.
 *
 * `scripts/check-staff-routes.mjs`, which `npm run build` runs first, compares
 * this list with the directories under `src/app/(admin)` and with the rail's
 * `NAV`, so a new page that is not registered here fails the build rather than
 * becoming another silent hole. The nav entries are typed against `StaffRoute`,
 * so the reverse omission — a rail link to a page this guard does not know — is a
 * type error.
 *
 * Kept free of imports so the edge runtime can read it: the rail's table lives in
 * `nav.ts` because it carries icons.
 */
export const STAFF_ROUTES = [
  "/dashboard",
  "/analytics",
  "/reports",
  "/time",
  "/activity",
  "/candidates",
  "/sourcing",
  "/jobs",
  "/apply-questions",
  "/assessments",
  "/interviews",
  "/onboarding",
  "/files",
  "/whatsapp",
  "/assistant",
  "/settings",
] as const;

/** One of the staff pages, as a path prefix — `"/files"`, not a URL with a query. */
export type StaffRoute = (typeof STAFF_ROUTES)[number];

/**
 * Whether a pathname belongs to a staff page.
 *
 * Prefix, not equality: `/files?bucket=resumes`, `/candidates/anything` and a
 * nested admin page are all the same door as their listing page.
 */
export function isStaffPath(pathname: string): boolean {
  return STAFF_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}
