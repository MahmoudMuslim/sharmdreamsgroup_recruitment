/**
 * `person_emails` — the addresses one person owns (migration 043).
 *
 * The address is the identity rule: an application written before the spine was
 * backfilled carries no `person_id`, and the address it was filed with is what
 * still finds the person. The database keeps the address lower-cased and refuses
 * a second row for the same address, so `email` here is already the key the
 * lookup is written against; `is_primary` marks the one the person is written to.
 *
 * A door that cannot read this table is looking at a database without 043, which
 * is a different answer from an address nobody owns — the layer reports which,
 * and the door phrases it.
 */
export interface PersonEmail {
  id: string;
  person_id: string;
  email: string;
  is_primary: boolean;
  added_at: string;
}
