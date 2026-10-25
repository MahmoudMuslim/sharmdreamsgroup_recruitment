/**
 * Who a candidate *is*, as opposed to which row they are on.
 *
 * `applications` is one row per person **per opening**, which is the shape hiring
 * needs — the same engineer can be in play for two teams — and the shape that
 * makes a recruiter see one person several times. So the portal needs two
 * different rules and they must not be confused:
 *
 *   - one *application* per person per opening, which the database already
 *     enforces with `applications_one_live_per_job` on `(job_id, lower(email))`;
 *   - one *profile* per person, which nothing enforced until this module existed,
 *     because the profile was wherever the clicked row happened to sit.
 *
 * The rule here is the second one: a person is their email address, read
 * case-insensitively, and every row carrying that address belongs to the same
 * human being. That is also what the unique index keys on, so the profile's
 * identity and the database's duplicate check cannot drift apart.
 *
 * Pure and imported by both the reader and the plain-Node probe, because "which
 * rows are the same person" is exactly the kind of claim the portal should not
 * have to take on faith from a UI.
 */

/** Enough of an `applications` row to decide who it belongs to. */
export interface PersonRow {
  id: string;
  email: string;
  archived_at: string | null;
}

/**
 * The spelling a person's identity is stored under.
 *
 * Emails are compared lowercased everywhere — the write doors, the duplicate
 * check, the profile lookup — so one rule spells it and nothing else has to
 * remember to.
 */
export function personKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The shape a write into `person_emails` must find before it is accepted.
 *
 * `personKey` spells an address; this decides whether a string is an address at
 * all. A CV extraction hands back whatever the model read off the page, and a
 * half-typed or fabricated address written into the spine would mis-file the
 * person — so a door that writes an email into the spine runs it through here
 * first and drops the row when this returns null, rather than storing a guess.
 */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function normalizePersonEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
}

/**
 * The values a stored email can arrive in, for a read that must not miss a row.
 *
 * `applications.email` is plain text with no normalisation, so rows written
 * before the doors started lowercasing keep whatever the candidate typed. The
 * database's own index compares `lower(email)`, and PostgREST cannot filter on an
 * expression, so a read asks for both spellings: the one this row carries and the
 * one every new row gets. Two values cover every case pair, which is what a
 * person's address actually varies over.
 */
export function emailSpellings(email: string): string[] {
  const raw = email.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  return raw === lower ? [lower] : [raw, lower];
}

/** Whether two addresses name the same person. */
export function isSamePerson(a: string, b: string): boolean {
  const left = personKey(a);
  const right = personKey(b);
  return left.length > 0 && left === right;
}

/** Rows that are not filed out of the pipeline. */
export function liveRows<T extends PersonRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.archived_at === null);
}

/**
 * Every row of that person, in the order they were handed in.
 *
 * Not sorted here: the callers want different orders (the profile prints newest
 * first, the canonical address wants oldest first), and a sort baked into the
 * filter is a second rule nobody asked for.
 */
export function rowsOfPerson<T extends PersonRow>(
  rows: readonly T[],
  email: string
): T[] {
  const key = personKey(email);
  return rows.filter((row) => personKey(row.email) === key);
}

/**
 * What one profile is made of.
 *
 * `canonicalId` is the row whose id the profile's own address carries: the
 * oldest live row, falling back to the oldest row of any kind. It is a person's
 * first contact with the group, so it survives the rest being filed away, and it
 * does not move when a newer application arrives — which is the point: one
 * person, one address, however many openings they are in.
 */
export interface PersonSummary<T extends PersonRow> {
  rows: T[];
  live: T[];
  applications: number;
  archived: number;
  canonicalId: string | null;
  /** More than one live row: the same human being sitting in two pipelines. */
  repeated: boolean;
}

export function summarizePerson<T extends PersonRow & { created_at: string }>(
  rows: readonly T[],
  email: string
): PersonSummary<T> {
  // Newest first, so the profile opens on what the person is in play for now.
  // Timestamps are compared as the ISO text they are stored in, which orders them
  // the same way their instants do and needs no parser to be wrong about.
  const mine = rowsOfPerson(rows, email).sort(
    (a, b) => compareDates(b, a) || compareIds(b.id, a.id)
  );
  const live = liveRows(mine);
  // The oldest live row, or the oldest row at all when every one is filed away:
  // a person's first contact does not move when a newer application arrives.
  const oldest = [...(live.length ? live : mine)].sort(
    (a, b) => compareDates(a, b) || compareIds(a.id, b.id)
  )[0];

  return {
    rows: mine,
    live,
    applications: mine.length,
    archived: mine.length - live.length,
    canonicalId: oldest?.id ?? null,
    repeated: live.length > 1,
  };
}

function compareIds(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** `a` before `b` in time, from their stored ISO text. */
function compareDates(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? -1 : 1;
}

/**
 * The sentence a filing door prints when the address is already on file.
 *
 * Naming the openings, not just "a duplicate exists", is what lets a recruiter
 * tell the two cases apart: the same person in the *same* opening is a mistake
 * the database refuses, while the same person in *another* opening is a second
 * application on the one profile they already have, and filing it is normal.
 *
 * Both doors in `candidate-actions.ts` that put an address on a role print this —
 * recording a walk-in, and correcting the address on a record that exists.
 */
export function alreadyOnFile(input: {
  openings: readonly string[];
  sameOpening: string | null;
}): { refusal: string | null; notice: string | null } {
  const openings = input.openings.filter(Boolean);
  if (input.sameOpening) {
    return {
      refusal: `This address already has a live application for ${input.sameOpening}. Open that record instead of adding a second one.`,
      notice: null,
    };
  }
  if (openings.length === 0) return { refusal: null, notice: null };
  const listed =
    openings.length === 1
      ? openings[0]
      : `${openings.slice(0, -1).join(", ")} and ${openings[openings.length - 1]}`;
  return {
    refusal: null,
    notice: `Already on file for ${listed}. This joins them to the same profile — one candidate, one page, whatever openings they are in.`,
  };
}
