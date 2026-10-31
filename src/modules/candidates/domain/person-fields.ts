/**
 * The person field registry — the only place any person field's sensitivity
 * is declared (spec §2). The store is divided along this declaration: a
 * field's tier decides whether an extractor may touch it, whether a grant
 * gates its read, and which group its change events carry.
 *
 * Cross-checked against `db/migrations/043_person_profile_spine.sql`:
 * - the fourteen `PersonFieldGroup` members are exactly the fourteen
 *   `person_consents_purpose_check` values (043:466), and those fourteen
 *   plus `merge` are the fifteen `person_events_field_group_check` values
 *   (043:511);
 * - the seven `PersonCollection` members name the seven append-only tables
 *   `person_education`, `person_employment`, `person_languages`,
 *   `person_skills`, `person_certifications`, `person_dependants`,
 *   `person_emergency_contacts` (`person_` + collection);
 * - every `options` list mirrors its SQL CHECK verbatim, same values, same
 *   order — never wider;
 * - the three Tier-3 permissions are the three 043 seeds:
 *   `candidates.view_health_data`, `candidates.view_family_data`,
 *   `candidates.view_emergency_contacts`.
 *
 * The `extraction` group gates the act of handing a CV to a model; no stored
 * column belongs to it, so no entry below carries it.
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */

export type PersonFieldGroup =
  | "identity" | "contact" | "work_history" | "education" | "languages" | "skills" | "photo"
  | "marital_status" | "family_details" | "dependants" | "emergency_contacts"
  | "health" | "housing" | "extraction";

export type PersonFieldTier = 1 | 2 | 3;

/**
 * The staff-facing name of each group: the words a recruiter reads in the
 * binding picker's optgroups and on the form editor's step strip. One table
 * beside the union it names, because a second is how those two surfaces start
 * disagreeing about what `health` is called. What the candidate is told is in
 * `person-notice.ts`, and those words are deliberately not these — and so are
 * the two other tables that name a group on purpose for a different reader: the
 * consent box a candidate ticks at the record door, which says `Health
 * (restricted)`, and the analytics report's column heading, which says `Health &
 * accessibility`. Neither is a copy of these words waiting to be merged.
 */
export const PERSON_GROUP_LABELS: Record<PersonFieldGroup, string> = {
  identity: "Identity",
  contact: "Contact",
  work_history: "Work history",
  education: "Education",
  languages: "Languages",
  skills: "Skills & certifications",
  photo: "Photograph",
  marital_status: "Marital status",
  family_details: "Family details",
  dependants: "Dependants",
  emergency_contacts: "Emergency contacts",
  health: "Health and disability",
  housing: "Housing and commute",
  extraction: "CV extraction",
};

export type PersonCollection =
  | "education" | "employment" | "languages" | "skills" | "certifications"
  | "dependants" | "emergency_contacts";

export interface PersonField {
  key: string;
  label: string;
  group: PersonFieldGroup;
  tier: PersonFieldTier;
  table: "person_profiles" | "person_health" | "person_family_details";
  column?: string;
  collection?: PersonCollection;
  input: "text" | "date" | "number" | "select" | "textarea" | "photo" | "list";
  options?: readonly string[];
  maxChars?: number;
  permission?: "candidates.view_health_data"
             | "candidates.view_family_data"
             | "candidates.view_emergency_contacts";
}

/**
 * One entry per field the store holds and a door can edit. Entries whose
 * `input` is `"list"` carry a `collection`; their value appends rows to
 * `person_<collection>` rather than writing a column, and their `table` is
 * the subject table (`person_profiles`) the rows hang off.
 *
 * Tiers follow spec "The decision": tier 1 is the operational, CV-shaped
 * layer (the five extractable collections, the record's name, and the
 * contact/location facts a door needs to reach the person); tier 2 is the
 * personal layer (a name, a date, a status — visible to staff, never
 * extracted, never in a prompt); tier 3 is the special-category layer
 * (health, family, dependants, emergency contacts), each entry behind its
 * named grant. `marital_status`, `children_count` and `household_size` stay
 * tier 2 (the counts and statuses the owner chose to keep usable for
 * screening); the spouse's name, the wedding date and who lives in the
 * house are tier 3.
 */
export const PERSON_FIELDS: readonly PersonField[] = [
  // ——— identity ——————————————————————————————————————————————————————————
  {
    key: "legal_name",
    label: "Legal name",
    group: "identity",
    tier: 1,
    table: "person_profiles",
    column: "legal_name",
    input: "text",
    maxChars: 160, // person_profiles_name_length_check: between 2 and 160
  },
  {
    key: "preferred_name",
    label: "Preferred name",
    group: "identity",
    tier: 2,
    table: "person_profiles",
    column: "preferred_name",
    input: "text",
    maxChars: 160, // §11: text — name
  },
  {
    key: "pronouns",
    label: "Pronouns",
    group: "identity",
    tier: 2, // spec §1.1: "Tier 2 free-ish text ... not an enum"
    table: "person_profiles",
    column: "pronouns",
    input: "text",
    maxChars: 160,
  },
  {
    key: "gender",
    label: "Gender (as the person wrote it)",
    group: "identity",
    tier: 2, // spec §1.1: "Tier 2 free-ish text ... not an enum"
    table: "person_profiles",
    column: "gender",
    input: "text",
    maxChars: 160,
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    group: "identity",
    tier: 2,
    table: "person_profiles",
    column: "date_of_birth",
    input: "date",
  },
  {
    key: "birthplace",
    label: "Birthplace",
    group: "identity",
    tier: 2,
    table: "person_profiles",
    column: "birthplace",
    input: "text",
    maxChars: 160,
  },
  {
    key: "national_id",
    label: "National ID",
    group: "identity",
    tier: 2, // spec §10 / Known limits: plain column, stated exposure — not a special category
    table: "person_profiles",
    column: "national_id",
    input: "text",
    maxChars: 160,
  },
  {
    key: "nationality",
    label: "Nationality",
    group: "identity",
    tier: 2, // proof §8: a `nationality` answer from the extractor must be dropped and named
    table: "person_profiles",
    column: "nationality",
    input: "text",
    maxChars: 160,
  },

  // ——— contact ———————————————————————————————————————————————————————————
  {
    key: "phone",
    label: "Phone",
    group: "contact",
    tier: 1,
    table: "person_profiles",
    column: "phone",
    input: "text",
  },
  {
    key: "mailing_address",
    label: "Mailing address",
    group: "contact",
    tier: 2, // spec §5: the extractor reports nothing about an address
    table: "person_profiles",
    column: "mailing_address",
    input: "textarea",
    maxChars: 500, // §11: text — mailing address
  },
  {
    key: "current_city",
    label: "Current city",
    group: "contact",
    tier: 1, // the extractor's `location` lands here
    table: "person_profiles",
    column: "current_city",
    input: "text",
  },

  // ——— photo ——————————————————————————————————————————————————————————————
  {
    key: "photo_path",
    label: "Photo",
    group: "photo",
    tier: 2, // decision 6: "The photo is Tier 2, and never enters a model"
    table: "person_profiles",
    column: "photo_path",
    input: "photo",
  },
  {
    key: "photo_mime",
    label: "Photo format",
    group: "photo",
    tier: 2,
    table: "person_profiles",
    column: "photo_mime",
    input: "text",
    options: ["image/jpeg", "image/png", "image/webp"], // §11 photo rule: jpeg/png/webp
  },

  // ——— work history / education / languages / skills (the collections) —————
  {
    key: "employment",
    label: "Work history",
    group: "work_history",
    tier: 1,
    table: "person_profiles",
    collection: "employment",
    input: "list",
  },
  {
    key: "education",
    label: "Education",
    group: "education",
    tier: 1,
    table: "person_profiles",
    collection: "education",
    input: "list",
  },
  {
    key: "languages",
    label: "Languages",
    group: "languages",
    tier: 1,
    table: "person_profiles",
    collection: "languages",
    input: "list",
  },
  {
    key: "skills",
    label: "Skills",
    group: "skills",
    tier: 1, // spec §1.8: "They are Tier 1... one consent group and one event group for both"
    table: "person_profiles",
    collection: "skills",
    input: "list",
  },
  {
    key: "certifications",
    label: "Certifications",
    group: "skills", // spec §1.8: both claim collections share the `skills` purpose
    tier: 1,
    table: "person_profiles",
    collection: "certifications",
    input: "list",
  },

  // ——— marital status (the counts the owner kept for screening) ————————————
  {
    key: "marital_status",
    label: "Marital status",
    group: "marital_status",
    tier: 2, // "The decision": a status stays Tier 2 and usable for screening
    table: "person_profiles",
    column: "marital_status",
    input: "select",
    options: ["single", "married", "divorced", "widowed", "civil_partnership", "cohabiting", "prefer_not_to_say"],
    // person_profiles_marital_check, same order
  },
  {
    key: "children_count",
    label: "Children (count)",
    group: "marital_status",
    tier: 2,
    table: "person_profiles",
    column: "children_count",
    input: "number",
  },

  // ——— housing ————————————————————————————————————————————————————————————
  {
    key: "household_size",
    label: "Household size",
    group: "housing",
    tier: 2, // "The decision": a count stays Tier 2; the composition is Tier 3
    table: "person_profiles",
    column: "household_size",
    input: "number",
  },
  {
    key: "housing_tenure",
    label: "Housing tenure",
    group: "housing",
    tier: 2,
    table: "person_profiles",
    column: "housing_tenure",
    input: "select",
    options: ["own", "rent", "live_with_family", "other"],
    // person_profiles_housing_check, same order
  },
  {
    key: "commute_mode",
    label: "Commute mode",
    group: "housing",
    tier: 2,
    table: "person_profiles",
    column: "commute_mode",
    input: "select",
    options: ["car", "public", "motorbike", "bicycle", "walk", "remote", "other"],
    // person_profiles_commute_mode_check, same order
  },
  {
    key: "commute_minutes",
    label: "Commute (minutes)",
    group: "housing",
    tier: 2,
    table: "person_profiles",
    column: "commute_minutes",
    input: "number",
  },
  {
    key: "relocation_willingness",
    label: "Willing to relocate",
    group: "housing",
    tier: 2,
    table: "person_profiles",
    column: "relocation_willingness",
    input: "select",
    options: ["yes", "no", "depends"],
    // person_profiles_relocation_check, same order
  },
  {
    key: "travel_restrictions",
    label: "Travel restrictions",
    group: "housing",
    tier: 2,
    table: "person_profiles",
    column: "travel_restrictions",
    input: "textarea",
  },

  // ——— health (Tier 3, own table, own grant) ———————————————————————————————
  {
    key: "disability_status",
    label: "Disability status",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "disability_status",
    input: "select",
    options: ["yes", "no", "prefer_not_to_say"],
    // person_health_disability_check, same order
    permission: "candidates.view_health_data",
  },
  {
    key: "accommodations",
    label: "Accommodations",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "accommodations",
    input: "textarea",
    maxChars: 2000, // spec §1.2 / §11: the writer refuses at 2,000, never truncates
    permission: "candidates.view_health_data",
  },
  {
    key: "chronic_conditions",
    label: "Chronic conditions",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "chronic_conditions",
    input: "textarea",
    maxChars: 2000,
    permission: "candidates.view_health_data",
  },
  {
    key: "allergies",
    label: "Allergies",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "allergies",
    input: "textarea",
    maxChars: 2000, // §11: text — allergies
    permission: "candidates.view_health_data",
  },
  {
    key: "dietary_restrictions",
    label: "Dietary restrictions",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "dietary_restrictions",
    input: "textarea",
    permission: "candidates.view_health_data",
  },
  {
    key: "blood_type",
    label: "Blood type",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "blood_type",
    input: "select",
    options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"],
    // person_health_blood_type_check, same order
    permission: "candidates.view_health_data",
  },
  {
    key: "health_insurance",
    label: "Health insurance",
    group: "health",
    tier: 3,
    table: "person_health",
    column: "health_insurance",
    input: "select",
    options: ["active", "none", "prefer_not_to_say"],
    // person_health_insurance_check, same order
    permission: "candidates.view_health_data",
  },

  // ——— family details (Tier 3, own table, own grant) ———————————————————————
  {
    key: "partner_name",
    label: "Partner's name",
    group: "family_details",
    tier: 3, // "The decision": a name moves to Tier 3
    table: "person_family_details",
    column: "partner_name",
    input: "text",
    permission: "candidates.view_family_data",
  },
  {
    key: "partner_occupation",
    label: "Partner's occupation",
    group: "family_details",
    tier: 3,
    table: "person_family_details",
    column: "partner_occupation",
    input: "text",
    permission: "candidates.view_family_data",
  },
  {
    key: "partner_contact",
    label: "Partner's contact",
    group: "family_details",
    tier: 3,
    table: "person_family_details",
    column: "partner_contact",
    input: "text",
    permission: "candidates.view_family_data",
  },
  {
    key: "anniversary_date",
    label: "Wedding date",
    group: "family_details",
    tier: 3, // "The decision": the wedding date moves to Tier 3
    table: "person_family_details",
    column: "anniversary_date",
    input: "date",
    permission: "candidates.view_family_data",
  },
  {
    key: "household_composition",
    label: "Who lives in the house",
    group: "family_details",
    tier: 3, // "The decision": who lives in the house moves to Tier 3
    table: "person_family_details",
    column: "household_composition",
    input: "textarea",
    permission: "candidates.view_family_data",
  },
  {
    key: "family_planning",
    label: "Family planning",
    group: "family_details",
    tier: 3,
    table: "person_family_details",
    column: "family_planning",
    input: "select",
    options: ["planning", "not_planning", "already_children", "prefer_not_to_say"],
    // person_family_planning_check, same order
    permission: "candidates.view_family_data",
  },

  // ——— third-party collections (Tier 3) ——————————————————————————————————
  {
    key: "dependants",
    label: "Dependants",
    group: "dependants",
    tier: 3, // each child's name and date of birth is Tier 3
    table: "person_profiles",
    collection: "dependants",
    input: "list",
    permission: "candidates.view_family_data",
  },
  {
    key: "emergency_contacts",
    label: "Emergency contacts",
    group: "emergency_contacts",
    tier: 3, // purpose is safety, not screening — its own grant
    table: "person_profiles",
    collection: "emergency_contacts",
    input: "list",
    permission: "candidates.view_emergency_contacts",
  },
];

/** Look up one registry entry by key; `null` means the key is not in the registry. */
export function personField(key: string): PersonField | null {
  return PERSON_FIELDS.find((field) => field.key === key) ?? null;
}

/**
 * The closed extraction vocabulary — Tier-1 keys only. The validator
 * (Task 8) drops and names any key outside this list, so no Tier-2 fact and
 * no Tier-3 answer can ever reach the database through a model.
 */
export function extractableFieldKeys(): string[] {
  return PERSON_FIELDS.filter((field) => field.tier === 1).map((field) => field.key);
}

/** Every registry entry at the given tier. */
export function fieldsForTier(tier: PersonFieldTier): PersonField[] {
  return PERSON_FIELDS.filter((field) => field.tier === tier);
}

/**
 * The consent purpose that gates a key. Throws on an unknown key rather than
 * returning `null` — the writer resolves `personField(key)` first and only
 * calls this for a key the registry carries, so a call with an unknown key
 * is a programming error, not a data state.
 */
export function consentPurposeFor(key: string): PersonFieldGroup {
  const field = personField(key);
  if (!field) {
    throw new Error(`consentPurposeFor: "${key}" is not a registry key`);
  }
  return field.group;
}

/**
 * Fields the actor may see: a field with no `permission` is always visible;
 * a field with a `permission` is visible only when that permission name is
 * in the granted set.
 */
export function visibleFields(granted: ReadonlySet<string>): PersonField[] {
  return PERSON_FIELDS.filter((field) => !field.permission || granted.has(field.permission));
}

/** The collection a `list`-input key appends rows to; `null` for every other input. */
export function listCollectionFor(key: string): PersonCollection | null {
  const field = personField(key);
  return field && field.input === "list" ? (field.collection ?? null) : null;
}
