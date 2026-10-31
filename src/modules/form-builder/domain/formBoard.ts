/**
 * The forms board's view state (`/forms`, spec §6).
 *
 * The board has one set of rows — the window `listForms` read — and two drawings
 * of it: the columns by state, and a list. Both read the same four facts from the
 * address, so a link the assistant or the Guide hands out lands on the surface,
 * the rail, the order and the words a recruiter had typed, and switching one never
 * quietly resets another. That is why the href is built here: every control names
 * the whole view, so lighting a rail cannot drop the search that is still on screen.
 *
 * The query and the rail narrow what the two surfaces draw, and the sort orders it.
 * None of them asks the database again: the read is bounded (200 forms), so the
 * surface a recruiter is on and the window it came from are the same set — and the
 * board's footer says so when the window is full.
 *
 * Every tie ends at an id, so two runs over the same rows cannot disagree.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

export type BoardSurface = "board" | "list";

/** `all` is the rail nobody lit; the other three are where a form actually sits. */
export type BoardState = "all" | "draft" | "published" | "retired";

export type BoardSort = "named" | "recent" | "questions" | "roles";

/** What the board needs from a row — `FormSummary` satisfies it without importing the application layer. */
export interface BoardRow {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  status: "DRAFT" | "PUBLISHED";
  archivedAt: string | null;
  fieldCount: number;
  assignedJobs: readonly { id: string }[];
  updatedAt: string;
}

export interface BoardView {
  surface: BoardSurface;
  state: BoardState;
  sort: BoardSort;
  q: string;
}

export const BOARD_STATES: readonly Exclude<BoardState, "all">[] = [
  "draft",
  "published",
  "retired",
];

export const BOARD_SORTS: readonly BoardSort[] = ["named", "recent", "questions", "roles"];

export const DEFAULT_VIEW: BoardView = { surface: "board", state: "all", sort: "named", q: "" };

/**
 * Where a form sits. A retired form has no other column: `retireForm` sets the
 * date and leaves the status alone, so the date is the fact and the status is not.
 */
export function stateOfForm(row: BoardRow): Exclude<BoardState, "all"> {
  if (row.archivedAt) return "retired";
  return row.status === "PUBLISHED" ? "published" : "draft";
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes((raw ?? "") as T) ? (raw as T) : fallback;
}

/** The address, read leniently: an unknown value falls back rather than blanking the board. */
export function parseBoardView(params: URLSearchParams): BoardView {
  return {
    surface: params.get("view") === "list" ? "list" : "board",
    state: oneOf(params.get("state"), ["all", ...BOARD_STATES] as const, DEFAULT_VIEW.state),
    sort: oneOf(params.get("sort"), BOARD_SORTS, DEFAULT_VIEW.sort),
    q: (params.get("q") ?? "").trim(),
  };
}

/** A word is a substring of the name or of the description a recruiter wrote for staff. */
function matchesQuery(row: BoardRow, q: string): boolean {
  if (q === "") return true;
  const needle = q.toLowerCase();
  return (
    row.name.toLowerCase().includes(needle) ||
    (row.description ?? "").toLowerCase().includes(needle)
  );
}

/**
 * The rail and the words, in that order.
 *
 * The rail is applied here rather than by hiding columns, so the two surfaces
 * filter identically and the list's row count is the columns' card count.
 *
 * Generic in the row, so a console that holds richer rows than `BoardRow` gets its
 * own type back out and never has to look a column up again by id.
 */
export function filterBoardRows<T extends BoardRow>(
  rows: readonly T[],
  view: BoardView,
): T[] {
  return rows.filter(
    (row) =>
      (view.state === "all" || stateOfForm(row) === view.state) && matchesQuery(row, view.q),
  );
}

/** Ordered, always a new array. `named` is the only ascending sort — the rest count down. */
export function sortBoardRows<T extends BoardRow>(rows: readonly T[], sort: BoardSort): T[] {
  const sorted = [...rows];
  const byId = (a: BoardRow, b: BoardRow) => a.id.localeCompare(b.id);

  if (sort === "named") {
    return sorted.sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || byId(a, b),
    );
  }
  if (sort === "recent") {
    return sorted.sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || byId(a, b),
    );
  }
  if (sort === "questions") {
    return sorted.sort((a, b) => b.fieldCount - a.fieldCount || byId(a, b));
  }
  return sorted.sort(
    (a, b) =>
      (b.isGlobal ? Number.MAX_SAFE_INTEGER : b.assignedJobs.length) -
        (a.isGlobal ? Number.MAX_SAFE_INTEGER : a.assignedJobs.length) ||
      byId(a, b),
  );
}

/**
 * The rail's counts, over the window the board holds — never over what the current
 * rail or words left standing, so a chip cannot promise rows the surface below
 * cannot show.
 */
export function countBoardStates(rows: readonly BoardRow[]): Record<BoardState, number> {
  const counts: Record<BoardState, number> = { all: rows.length, draft: 0, published: 0, retired: 0 };
  for (const row of rows) counts[stateOfForm(row)] += 1;
  return counts;
}

/**
 * The address for a view, with the defaults left out.
 *
 * `/forms` on its own is the board, all states, A–Z, no words — so the common case
 * stays the short link, and a view worth pasting keeps its query.
 */
export function boardHref(view: BoardView): string {
  const params = new URLSearchParams();
  if (view.surface !== DEFAULT_VIEW.surface) params.set("view", view.surface);
  if (view.state !== DEFAULT_VIEW.state) params.set("state", view.state);
  if (view.sort !== DEFAULT_VIEW.sort) params.set("sort", view.sort);
  if (view.q !== "") params.set("q", view.q);
  const qs = params.toString();
  return qs ? `/forms?${qs}` : "/forms";
}

/**
 * The row report a form's usage figure links to: every application in the window,
 * narrowed to the ones that filed against this form.
 *
 * `application_forms` is the report that carries one row per application with the
 * form it was asked; `form_questions` carries the question roll-up. The board links
 * to the applications, because the figure on the card is a count of applications.
 *
 * The window is `all`, not the report page's 90-day default: the figure beside the
 * card was counted over every application the read held, so a 90-day report would
 * print fewer rows than the number the reader clicked — the link promises "every
 * application filed against this form", and this is the window that can keep it.
 * The id is escaped, so a malformed id cannot break the query it sits in.
 */
export function formUsageHref(formId: string): string {
  return `/reports?report=application_forms&window=all&form=${encodeURIComponent(formId)}`;
}
