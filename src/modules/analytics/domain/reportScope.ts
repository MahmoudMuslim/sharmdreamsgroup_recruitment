/**
 * Which row reports a form may narrow.
 *
 * Two of the nine reports are built from the form snapshot — every application
 * form, and every question a form asked — so those two can be cut to one form and
 * the other seven cannot. The set lives here rather than in `documents.ts`
 * because the reports screen filters rows in the browser: `documents.ts` is
 * `server-only`, and a client component may not import it. The type-only import
 * below is erased at compile time, so this module carries no server code with it.
 *
 * A form id that names no application is simply absent from those two lists; the
 * filter never invents a row.
 */

import type { ReportId } from "./documents";

export const FORM_REPORTS: ReadonlySet<ReportId> = new Set([
  "application_forms",
  "form_questions",
]);

/** True when a report can be narrowed to one form. */
export function isFormReport(id: ReportId): boolean {
  return FORM_REPORTS.has(id);
}
