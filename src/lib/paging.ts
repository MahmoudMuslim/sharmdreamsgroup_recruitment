/**
 * The page arithmetic every bounded list shares.
 *
 * A list the portal draws is a slice of rows the database holds, and three numbers
 * describe it: which page the reader is on, how many rows a page carries, and how
 * many rows the scope holds in total. Getting any of them wrong shows up as a
 * screen that says "no rows" about a table that has thousands, or a pager that
 * offers a page 4 of 3. So the clamping lives here once, and a page beyond the end
 * is answered with the last page rather than with nothing — the same rule
 * `listSettingsTrail` and `listCredentialAudit` were each written with before this
 * file existed.
 *
 * A page and not a cursor: the columns these lists order by are not unique, so a
 * `created_at < cursor` walk silently drops the rest of any batch it splits.
 * Ordering by the timestamp and then by `id` is a total order, which makes page N
 * a stable slice — every row appears on exactly one page.
 */

/**
 * How many rows a page carries when the list has no reason of its own to pick one.
 *
 * A board of cards wants fewer rows than a table of one-line entries, so a screen
 * may name its own size — but it should not let the reader pick one, because a
 * read whose depth the caller chooses is the shape that turns a bounded query back
 * into an unbounded one.
 */
export const PAGE_ROWS = 25;

/** The address-bar parameter that carries the page a reader asked for. */
export const PAGE_PARAM = "page";

/**
 * The page a parameter or an argument asks for.
 *
 * Lenient on purpose: page 1 is the front of the list, so a missing, negative,
 * fractional or unparseable value reads as page 1 rather than as an error or an
 * empty list. A stale bookmark that names a page the table has outgrown is clamped
 * by `clampPage`, not answered with nothing.
 */
export function parsePage(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/** Where a page starts in the list's own order, zero-based, for `.range()`. */
export function pageOffset(page: number, size: number = PAGE_ROWS): number {
  return (parsePage(page) - 1) * size;
}

/** The inclusive last index a page ends on, for `.range()`. */
export function pageEnd(page: number, size: number = PAGE_ROWS): number {
  return pageOffset(page, size) + size - 1;
}

/** How many pages it takes to walk a scope of `total` rows. Always at least one. */
export function pageCount(total: number, size: number = PAGE_ROWS): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** A page that runs past the end, pulled back onto the last page that has rows. */
export function clampPage(page: number, total: number, size: number = PAGE_ROWS): number {
  return Math.min(parsePage(page), pageCount(total, size));
}

/** One page of an array already in memory, for a list the server read whole. */
export function pageSlice<T>(rows: readonly T[], page: number, size: number = PAGE_ROWS): T[] {
  const offset = pageOffset(page, size);
  return rows.slice(offset, offset + size);
}

/** What a pager needs to draw itself and to say which rows are on screen. */
export interface PageWindow {
  /** The page actually served, after clamping. */
  page: number;
  pages: number;
  size: number;
  /** Every row the scope holds, not the rows on screen. */
  total: number;
  /** The rows on screen. `from` and `to` are 1-based and inclusive; both 0 when empty. */
  shown: number;
  from: number;
  to: number;
}

/**
 * The window a page of `shown` rows sits in.
 *
 * `shown` is passed rather than derived because a scoped read can hand back fewer
 * rows than a page carries on its last page, and because the trail-style reads
 * filter in memory before slicing. `from` and `to` are the numbers the summary
 * line prints, so a pager that says "rows 26–50 of 318" is describing the rows it
 * actually drew.
 */
export function pageWindow(
  page: number,
  total: number,
  shown: number,
  size: number = PAGE_ROWS
): PageWindow {
  const pages = pageCount(total, size);
  const current = clampPage(page, total, size);
  const offset = pageOffset(current, size);
  return {
    page: current,
    pages,
    size,
    total,
    shown,
    from: shown === 0 ? 0 : offset + 1,
    to: shown === 0 ? 0 : offset + shown,
  };
}

/**
 * The one line a pager prints under its buttons.
 *
 * It names the rows on screen, the rows the scope holds and the page size, because
 * a list that shows 25 of 318 and says only "25 rows" is a list that hides 293 of
 * them without telling the reader.
 */
export function pageSummary(window: PageWindow, noun: string): string {
  if (window.total === 0) return `No ${noun} to show.`;
  if (window.shown === 0) return `Nothing on page ${window.page}.`;
  const rows = `Rows ${window.from}–${window.to} of ${window.total} ${noun}`;
  return window.total > window.size ? `${rows} — ${window.size} a page.` : `${rows}.`;
}

/**
 * Read the page out of an address bar's worth of parameters.
 *
 * Accepts both shapes a Next.js page is handed — `URLSearchParams` from
 * `useSearchParams` and the plain record a server component gets — so a client view
 * and the action behind it agree on the page without either one parsing it again.
 */
export function pageFromParams(
  params: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined
): number {
  if (!params) return 1;
  const raw =
    params instanceof URLSearchParams ? params.get(PAGE_PARAM) : params[PAGE_PARAM];
  return parsePage(Array.isArray(raw) ? raw[0] : raw);
}
