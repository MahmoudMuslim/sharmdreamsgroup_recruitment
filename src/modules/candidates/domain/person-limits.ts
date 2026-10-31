/**
 * The one limits module for the person profile spine (spec §11). Every
 * ceiling the store enforces is a name here, cited by every control, message
 * and proof — never a number typed at the point of use.
 *
 * Cross-checked against spec §11 and `db/migrations/043_person_profile_spine.sql`:
 * - the seven row caps are app-side guards against runaway extraction; 043
 *   puts no row-count CHECK in the DDL, so this module is the only place
 *   those numbers live;
 * - `text_name_employer_institution` (160) matches
 *   `person_profiles_name_length_check` (043:74, between 2 and 160),
 *   `person_employment_employer_length_check` (043:361) and
 *   `person_certifications_title_length_check` / `..._issuer_length_check`
 *   (043:425–427);
 * - `text_long` (2,000) is the duties/accommodations/conditions/allergies
 *   ceiling — the writer refuses at the cap, it never truncates (spec §1.2);
 * - `text_as_written` (500) covers `as_written`, `mailing_address` and
 *   honors; `events_value_column` (500) is the `person_events`
 *   old_value/new_value ceiling, after which the event carries a
 *   length-and-hash note (spec §11);
 * - `photo_bytes` (5 MB) + `photo_mime` are the candidate-photos rule from
 *   spec §10 (size re-checked before buffering, magic bytes after);
 *   `cv_bytes` equals `CV_MAX_MB * 1024 * 1024` from
 *   `src/modules/careers/cv-rules.ts` — the same 5 MB, stated as a literal
 *   here so this module consumes nothing (cv-rules reaches server-only code;
 *   the domain stays dependency-free);
 * - `extraction_input_chars` (28,000) matches `extractProfile`'s input cut
 *   (`raw.slice(0, 28_000)`) and `extraction_output_tokens` (3,000) its
 *   `maxTokens` — both at
 *   `src/modules/sourcing/infrastructure/profile-extract.ts` (spec §5);
 * - `events_read_rows` (500) is the newest-500 read cap — the events table
 *   itself is unbounded;
 * - the three `access_copy_*` numbers are the existing caps in
 *   `src/modules/privacy/application/accessCopy.ts`
 *   (MAX_APPLICATIONS = 20, MAX_ANSWERS = 300, MAX_ANSWER_CHARS = 4_000)
 *   folded into this one table (spec §8 / §11); collection rows in the
 *   access copy are bounded by the per-table caps above, not a second higher
 *   cap.
 *
 * Pure module — no imports, nothing async, no database.
 */

export const PERSON_LIMITS = {
  education_rows: 60,
  employment_rows: 80,
  languages_rows: 20,
  skills_rows: 100,
  certifications_rows: 40,
  dependants_rows: 20,
  emergency_contacts_rows: 2,
  events_read_rows: 500,
  text_name_employer_institution: 160,
  text_long: 2000,
  text_as_written: 500,
  events_value_column: 500,
  photo_bytes: 5 * 1024 * 1024,
  photo_mime: ["image/jpeg", "image/png", "image/webp"] as const,
  cv_bytes: 5 * 1024 * 1024,
  extraction_input_chars: 28000,
  extraction_output_tokens: 3000,
  access_copy_applications: 20,
  access_copy_answers: 300,
  access_copy_answer_chars: 4000,
} as const;

export type PersonLimitKey = keyof typeof PERSON_LIMITS;
