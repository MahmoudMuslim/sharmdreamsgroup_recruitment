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
 * becoming another silent hole.
 *
 * The other direction is a type error, not a script: the rail's entries, the
 * chat's click-throughs, the change trail's alert destinations and the live
 * channel's page lists are all typed against `StaffRoute` (or `StaffLink` below),
 * so a path dropped from this list stops being a page that quietly 404s and
 * becomes a build that does not compile wherever a link names it.
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
  "/questions",
  "/assessments",
  "/interviews",
  "/onboarding",
  "/referrals",
  "/files",
  "/whatsapp",
  "/assistant",
  "/settings",
] as const;

/** One of the staff pages, as a path prefix — `"/files"`, not a URL with a query. */
export type StaffRoute = (typeof STAFF_ROUTES)[number];

/**
 * A link a recruiter can be handed: a staff page, with the query that selects the
 * view inside it when there is one.
 *
 * Three tables outside this file write these as strings: the chat's
 * click-throughs (`assistant/domain/links.ts`), the alert destinations in the
 * change trail (`activity/domain/trail.ts`) and the pages a live area refreshes
 * (`live/infrastructure/changeWatch.ts`). A string there that names a page which
 * no longer exists fails in the one place nobody looks — the link 404s, the alert
 * lands nowhere, the page silently never refreshes — so all three are typed
 * against this rather than checked by a script, because they are built at runtime
 * out of ids and only a type follows a value through a template literal.
 *
 * A nested path is a link too: `/candidates/<id>` is one candidate's own profile
 * page, reached by clicking a name in a list. `isStaffPath` already guarded every
 * path under a staff page by prefix, so the type now matches the guard instead of
 * describing a narrower portal than the middleware protects.
 */
export type StaffLink = StaffRoute | `${StaffRoute}/${string}` | `${StaffRoute}?${string}`;

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
