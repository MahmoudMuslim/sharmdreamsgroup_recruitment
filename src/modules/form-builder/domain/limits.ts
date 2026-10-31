/**
 * Every ceiling the form builder enforces, as a name (spec §11).
 *
 * One object so the proof, the save action, the upload door and the UI copy
 * cannot drift apart. 044's CHECKs are the second gate for the shapes they can
 * express (`fields_per_form` is not one of them — a row count has no CHECK);
 * the numbers here are the only ceiling a resolved layout, a normalised answer
 * and an uploaded byte are actually measured against.
 *
 * `orphan_upload_window_hours` is spec §8's decision: the window after which an
 * unclaimed upload row is deleted is a constant here, not an `app_settings`
 * value, so it cannot be widened by accident.
 *
 * Pure module — no imports, nothing async, no database.
 */

export const LIMITS = {
  // §11 — the form and the layout.
  fields_per_form: 40,
  section_headings_per_form: 12,
  options_per_choice_field: 30,
  files_per_field: 1,
  global_forms: 12,
  forms_assigned_per_opening: 8,
  resolved_fields_per_application: 80,

  // §11 — bytes. `file` matches ATTACHMENT_RULES for `resumes`.
  file_bytes: 10 * 1024 * 1024,
  photo_bytes: 5 * 1024 * 1024,

  // §11 — text.
  long_text_chars: 5000,

  // §11 — the four type-specific ceilings, split into the numbers a normaliser
  // and a builder both need (`percentage_min` is also the floor a config's
  // `min` is clamped to, never a value an author can widen).
  percentage_min: 0,
  percentage_max: 100,
  percentage_decimals: 2,
  duration_value_min: 1,
  duration_value_max: 9999,
  geolocation_lat_range: [-90, 90] as const,
  geolocation_lng_range: [-180, 180] as const,
  geolocation_dp: 6,
  time_pattern: /^([01]\d|2[0-3]):[0-5]\d$/,

  // §1.5 / §11 — the snapshot and the orphan sweep.
  form_answers_entries: 80,
  orphan_upload_window_hours: 24,
} as const;
