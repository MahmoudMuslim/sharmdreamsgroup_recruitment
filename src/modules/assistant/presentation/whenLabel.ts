/**
 * When a saved conversation was last used, in the words a recruiter reads.
 *
 * The Assistant page's rail and the docked panel's session list show the same
 * rows, so the label must not be able to drift between the two doors.
 */
export function whenLabel(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
