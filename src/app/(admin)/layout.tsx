import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";

/**
 * Every recruiter-portal screen is drawn inside one shell.
 *
 * The shell used to be rendered by each page, which meant a recruiter walking from
 * the dashboard to the candidates desk tore down and rebuilt the rail, the app bar
 * and the assistant dock on every step — and while the new page was mounting, the
 * old shell was still in the document, so the two anchored chrome layers carried
 * the same view-transition name. A name used twice is a transition the browser
 * refuses to run, which is why the route animation added alongside this never
 * fired. Rendered from a layout, the chrome exists once and only the page inside
 * it swaps.
 *
 * The page is what animates: `<ViewTransition>` runs enter and exit only when the
 * wrapper itself mounts or unmounts, so each page wraps its own content in
 * `PageTransition` rather than leaving it to this persistent chrome.
 *
 * The guard here is the fallback, not the door: `proxy.ts` turns an unauthenticated
 * or candidate-owned request to `/login` with the page and view it asked for, and
 * every page still calls `requireStaff` for its own reads — so the return path
 * survives. This only fires when the session the cookie jar advertised turns out
 * to have no staff profile behind it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The shell names the signed-in recruiter and its subtree reads the clock while
  // rendering, so it can only be drawn per request. Held to a prerender, Next
  // names that clock an unstable value and every navigation that needs this
  // layout stalls on the error instead of completing.
  await connection();
  const user = await getSessionUser();

  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal?denied=staff-only");

  // The bar's clock reads the group's wall clock, not the browser's, so a
  // recruiter abroad sees the hour every booked panel was typed against. Read
  // after the guard: a request being redirected needs no settings.
  const timeZone = await getOrganisationTimeZone();

  return (
    <AdminShell user={user} timeZone={timeZone}>
      {children}
    </AdminShell>
  );
}
