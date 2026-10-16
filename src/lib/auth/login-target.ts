/**
 * The sign-in address for a page somebody was turned away from.
 *
 * Two doors bounce a recruiter to `/login` — the proxy, which sees the request's
 * own URL including its query, and `requireStaff`, which only knows the page it
 * was called from. Both need the same shape, because a `next` is what decides
 * whether the recruiter lands back on the view they were looking at: the rails
 * (`?stage=`, `?source=`), the deep links (`?application=`, `?prospect=`) and the
 * archive and grading views (`?archived=1`, `?ungraded=1`) are all in the query,
 * and a page that reloads without it shows a different table than the one the
 * recruiter clicked away from.
 *
 * Kept pure and free of `server-only` so the proxy can import it on the edge.
 */
export function loginSearch(pathWithQuery: string, reason?: "idle"): string {
  const next = `next=${encodeURIComponent(pathWithQuery)}`;
  return reason ? `?${next}&reason=${reason}` : `?${next}`;
}
