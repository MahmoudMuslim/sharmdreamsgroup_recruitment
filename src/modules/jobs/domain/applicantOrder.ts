/**
 * The two orders one opening's applicants can be drawn in, and the address that
 * asks for each.
 *
 * `newest` is the read's own order — rows arrive stamped by `created_at`, so the
 * drawer opens on it without a second request and a link that wants it says
 * nothing. `ranked` is a second read over each applicant's own signals, so a link
 * that promises it has to carry it: the chat's ranking answer tells a recruiter
 * the shortlist is on the applicants drawer, and `/jobs?job=<id>&order=ranked` is
 * the address that makes that sentence true when it is clicked.
 *
 * The token lives here rather than in the drawer because two doors spell it — the
 * grid reads the address, and the assistant's link builder writes it — and a
 * second spelling would be a link that lands on the other order.
 */
export const APPLICANT_ORDERS = ["newest", "ranked"] as const;

export type ApplicantOrder = (typeof APPLICANT_ORDERS)[number];

export const DEFAULT_APPLICANT_ORDER: ApplicantOrder = "newest";

/** Inferred as its own literal, so the address below can be typed without widening. */
export const RANKED_ORDER = "ranked";

export const ORDER_PARAM = "order";

/** The order an address asks for; an unknown or repeated token is the default list. */
export function applicantOrderFromParams(
  params: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined
): ApplicantOrder {
  if (!params) return DEFAULT_APPLICANT_ORDER;
  const raw = params instanceof URLSearchParams ? params.get(ORDER_PARAM) : params[ORDER_PARAM];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return (APPLICANT_ORDERS as readonly string[]).includes(token ?? "")
    ? (token as ApplicantOrder)
    : DEFAULT_APPLICANT_ORDER;
}

/**
 * The address that opens one opening's applicants drawer already ranked.
 *
 * Typed as the literal it builds rather than `string`: this href is handed to a
 * `StaffLink`, whose whole point is that a chat answer cannot invent a route the
 * portal does not have.
 */
export function rankedApplicantsHref(jobId: string): `/jobs?job=${string}&order=ranked` {
  return `/jobs?job=${encodeURIComponent(jobId)}&${ORDER_PARAM}=${RANKED_ORDER}`;
}
