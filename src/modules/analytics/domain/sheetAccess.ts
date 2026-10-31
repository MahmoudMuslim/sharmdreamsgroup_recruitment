/**
 * Which columns of an export are somebody's private data, and what happens when
 * the account in front of the door may not have them.
 *
 * A report page hides a button; a download route checks `analytics.export`. Neither
 * of those decides whether an applicant's phone number rides out with the file,
 * because the permission that guards it on screen is a different one: the portal
 * already holds candidate contact details behind `candidates.read` at the file
 * doors, and a spreadsheet is the same data in a form that outlives the session.
 * So the same permission decides here, at the only place a file is made.
 *
 * Pure, and imported by the sheet builders through a relative path, for one
 * reason: which columns leave is a rule worth proving, and a module that sits
 * behind `server-only` cannot be read by `scripts/prove-export-audit.mjs`. This is
 * that rule with nothing around it — no client, no session, no database.
 *
 * Three rules hold it together.
 *
 *   1. **A guard is a property of the column, not of the sheet.** `masked` means
 *      "a number the grading settings withhold"; `contacts` means "an address or a
 *      number that belongs to a person". They are asked separately and fail
 *      separately, so closing one gate cannot quietly close the other — or, worse,
 *      take the candidate's name with it and hand over an unreadable grid.
 *   2. **A refusal is written into the file, not just applied to it.** A reader who
 *      gets twelve columns instead of fourteen cannot tell whether the report is
 *      smaller than they expected or their account is narrower, so the file says
 *      which in its own caveats.
 *   3. **The headers are a closed list.** `CONTACT_HEADERS` is what the audit reads
 *      off a finished document to find out whether it carried contact details. A
 *      contact column named anything else would be invisible to that check, which
 *      is why the proof pins the list against every column the builders write.
 */

/** What one account is allowed to see in a file it is about to be handed. */
export interface SheetAccess {
  scoresHidden: boolean;
  contactsHidden: boolean;
}

/** The two guards a column can carry, as the sheet builders declare them. */
export interface GuardedColumn {
  masked?: boolean;
  contacts?: boolean;
}

/** The headers that are a person's own contact details. */
export const CONTACT_HEADERS = ["Email", "Phone", "Recipient"] as const;

/** Does this column survive the access the file is being built under? */
export function columnKept(column: GuardedColumn, access: SheetAccess): boolean {
  if (column.masked && access.scoresHidden) return false;
  if (column.contacts && access.contactsHidden) return false;
  return true;
}

/**
 * The sentences a file carries about what the gates took from it.
 *
 * `noun` is what the reader is holding — "this file" from the candidates toolbar,
 * "this report" from the Reports page — so one rule writes the caveat in the words
 * the surface already uses. An access that took nothing says nothing: a caveat
 * about a column nobody withheld reads as an apology for a refusal that never
 * happened.
 */
export function accessNotes(access: SheetAccess, noun: string): string[] {
  const notes: string[] = [];
  if (access.scoresHidden) {
    notes.push(
      `Score columns are left out of ${noun}: the score-masking setting withholds test and AI scores from your account.`
    );
  }
  if (access.contactsHidden) {
    notes.push(
      `Contact details are left out of ${noun}: your account does not hold the View candidates permission, which is what an email address, a phone number and a message recipient need.`
    );
  }
  return notes;
}

/**
 * Whether a finished document carries contact columns.
 *
 * Reads only the headers, never a cell: the question an auditor asks of a row
 * about a download is "did addresses leave the building", and that is answered by
 * the shape of the file rather than by its contents — which must not be copied
 * into a record that more roles read and keep longer.
 */
export function documentCarriesContacts(
  document: { sheets?: { columns?: readonly string[] }[] } | null | undefined
): boolean {
  const sheets = document?.sheets;
  if (!Array.isArray(sheets)) return false;
  return sheets.some((sheet) =>
    Array.isArray(sheet?.columns)
      ? sheet.columns.some((column) => (CONTACT_HEADERS as readonly string[]).includes(column))
      : false
  );
}
