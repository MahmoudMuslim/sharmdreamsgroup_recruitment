import "server-only";

/**
 * The one tiered reader for the person profile spine (spec §3.5). It composes a
 * person from the thirteen 043 tables, gated by the caller's granted permissions,
 * logs every Tier-3 *health* open through the activity trail, and degrades
 * honestly when the spine has not been applied.
 *
 * Three rules from the design bind this file:
 *
 *   1. A denied group is "Not shown to you", never "nothing there" (spec §7 / §9).
 *      A table the caller cannot read keeps its key `undefined`; a table they can
 *      read but that holds no rows returns `[]`. The surface tells those two apart.
 *   2. The registry (Task 2) is the only source for which `person_profiles`
 *      columns the caller may see. The base `profile` read is built from
 *      `visibleFields(granted)`, so a Tier-3 scalar column added to the profile
 *      table in future cannot silently leak to an ungranted caller — it simply
 *      never enters the column list. Per §7 a withheld scalar is "not in the
 *      payload", so it is filtered silently and does NOT appear in `hidden`.
 *   3. Reading Tier-3 health is logged, not just written (decision 5). One
 *      `activity` row per successful open — family and emergency opens are not
 *      logged (only the health open is named in §3.5 / §7).
 *
 * "RLS is the read gate" (spec §10): reads go through `createServerRestClient()`,
 * the caller's own session, exactly as Task 5's writer reads through the REST
 * seam. This reader never bypasses RLS with the service role; it reads as the
 * staff member and trusts the policies to refuse what they have not granted.
 *
 * Migration 043 is authored, NOT applied. Every read is wrapped so a missing
 * spine table (`isMissingSchemaError`) answers `{ available: false, note }` and
 * hides nothing — degrade the page, never the record (spec §9). A transport
 * failure is NOT a missing-table error and is allowed to propagate.
 */

import { createServerRestClient } from "@/lib/data-api/server";
import type { SessionUser } from "@/lib/auth/session";
import { recordActivity } from "@/modules/activity/application/record";
import { permissionsForCurrentUser } from "@/modules/settings/infrastructure/permissions";
import type { PermissionKey } from "@/modules/settings/domain/types";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import { visibleFields } from "@/modules/candidates/domain/person-fields";
import type { PersonFieldGroup } from "@/modules/candidates/domain/person-fields";
import { PERSON_LIMITS } from "@/modules/candidates/domain/person-limits";

// ————————————————————————————————————————————————————————————————————————————
// the return shape
// ————————————————————————————————————————————————————————————————————————————

type Row = Record<string, unknown>;

/**
 * Everything the profile surfaces (Task 13) render. The base tier-1/tier-2 keys
 * are always present once `available` is true; the Tier-3 keys are present ONLY
 * when the matching grant is held, and absent (undefined) otherwise — the
 * difference between "you may not see this" and "there is nothing to see".
 */
export interface PersonBundle {
  /** False only when 043 is not applied; the page degrades to the application row. */
  available: boolean;
  /** A short, honest reason shown beside `available: false`. */
  note?: string;
  /** The registry groups withheld from THIS caller (§7's "Not shown to you"). */
  hidden: PersonFieldGroup[];

  // ——— tier 1 / tier 2 — always set on the success path —
  // Optional so the `{ available: false, note, hidden: [] }` degrade (043 not
  // applied) can be returned without inventing empty rows the surface would
  // then have to distinguish from real "no data yet". Task 13 guards on
  // `available` before touching any of these.
  profile?: Row | null;
  emails?: Row[];
  languages?: Row[];
  education?: Row[];
  employment?: Row[];
  skills?: Row[];
  certifications?: Row[];
  /** Consent rows are staff-visible: the ABSENCE of a consent is a fact to show (spec §1.11). */
  consents?: Row[];
  /** Tier-filtered so an event about a withheld field never lands here (spec §1.10). */
  events?: Row[];

  // ——— tier 3 — set only when the matching grant is held —
  /** `person_health` (1:1) — present (row or null) iff `candidates.view_health_data`. */
  health?: Row | null;
  /** `person_family_details` (1:1) — present (row or null) iff `candidates.view_family_data`. */
  family?: Row | null;
  /** `person_dependants` (list) — present array iff `candidates.view_family_data`. */
  dependants?: Row[];
  /** `person_emergency_contacts` (list) — present array iff `candidates.view_emergency_contacts`. */
  emergencyContacts?: Row[];
}

// The three Tier-3 grants are literal permission keys seeded in 043 §1.11. The
// `PermissionKey` union now carries them (pre-widened for this reader so the
// `.has(...)` checks typecheck without a cast); Task 14 owns the docs half.
const VIEW_HEALTH: PermissionKey = "candidates.view_health_data";
const VIEW_FAMILY: PermissionKey = "candidates.view_family_data";
const VIEW_EMERGENCY: PermissionKey = "candidates.view_emergency_contacts";

/** The event `field_group` values that sit behind a grant, and which one. */
const EVENT_GROUP_PERMISSION: Record<string, PermissionKey> = {
  health: VIEW_HEALTH,
  family_details: VIEW_FAMILY,
  dependants: VIEW_FAMILY,
  emergency_contacts: VIEW_EMERGENCY,
};

/**
 * Internal signal: a spine table the database does not have yet. Thrown by the
 * read helpers when `isMissingSchemaError` answers true and caught at the top of
 * `readPersonBundle` to produce the `{ available: false, note }` degrade. A
 * transport or other error is NOT wrapped in this and propagates unchanged.
 */
class PersonSchemaMissing extends Error {
  constructor(table: string) {
    super(`person spine table missing: ${table}`);
    this.name = "PersonSchemaMissing";
  }
}

const MISSING_NOTE = "Person details need migration 043.";

/** The caller-session REST client, exactly as the one seam builds it per request. */
type Client = Awaited<ReturnType<typeof createServerRestClient>>;

// ————————————————————————————————————————————————————————————————————————————
// the read helpers
// ————————————————————————————————————————————————————————————————————————————

/** Read a list table's rows for this person; `[]` is a real answer, an error is not. */
async function readRows(
  client: Client,
  table: string,
  columns: string,
  personId: string,
  options: { order?: { column: string; ascending: boolean }; limit?: number } = {}
): Promise<Row[]> {
  let query = client.from(table).select(columns).eq("person_id", personId);
  if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending });
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (isMissingSchemaError(error)) throw new PersonSchemaMissing(table);
  if (error) throw new Error(`readPersonBundle: ${table} read failed — ${error.message ?? "unknown error"}`);
  return (data ?? []) as Row[];
}

/** Read a 1:1 table's single row for this person; `null` is a real answer. */
async function readOne(
  client: Client,
  table: string,
  columns: string,
  personId: string
): Promise<Row | null> {
  const { data, error } = await client.from(table).select(columns).eq("person_id", personId).maybeSingle();
  if (isMissingSchemaError(error)) throw new PersonSchemaMissing(table);
  if (error) throw new Error(`readPersonBundle: ${table} read failed — ${error.message ?? "unknown error"}`);
  return (data ?? null) as Row | null;
}

/**
 * The `person_profiles` row, read by its own id and filtered to the columns the
 * registry says THIS caller may see. `visibleFields(granted)` is the whole tier
 * gate: a field with no `permission` is always in the list; a field with one is
 * in it only when that grant is held. Today no `person_profiles` scalar carries
 * a permission (they are Tier 1/2 by construction), but reading the column list
 * through the registry is what makes a future Tier-3 scalar leak impossible.
 */
async function readProfile(
  client: Client,
  personId: string,
  granted: ReadonlySet<string>
): Promise<Row | null> {
  const visibleColumns = visibleFields(granted)
    .filter((field) => field.table === "person_profiles" && field.input !== "list" && field.column)
    .map((field) => field.column as string);

  const select = ["id", "created_at", "updated_at", "erased_at", ...visibleColumns].join(", ");
  const { data, error } = await client.from("person_profiles").select(select).eq("id", personId).maybeSingle();
  if (isMissingSchemaError(error)) throw new PersonSchemaMissing("person_profiles");
  if (error) throw new Error(`readPersonBundle: person_profiles read failed — ${error.message ?? "unknown error"}`);
  return (data ?? null) as Row | null;
}

// ————————————————————————————————————————————————————————————————————————————
// §3.5 — readPersonBundle
// ————————————————————————————————————————————————————————————————————————————

/**
 * Compose the person from the tables the caller is granted to see.
 *
 * @param personId the `person_profiles.id` to read.
 * @param actor the signed-in staff session — only its `profileId` is used here,
 *        for the trail row's actor; the grants come from the request-cached
 *        session via `permissionsForCurrentUser()`, never re-derived from `actor`.
 */
export async function readPersonBundle(personId: string, actor: SessionUser): Promise<PersonBundle> {
  // One cache-hit for all three Tier-3 keys, read from the request session.
  const granted = new Set<string>(await permissionsForCurrentUser());
  const client = await createServerRestClient();

  try {
    // ——— tier 1 / tier 2 base read ———
    const profile = await readProfile(client, personId, granted);
    const emails = await readRows(client, "person_emails", "*", personId);
    const languages = await readRows(client, "person_languages", "*", personId);
    const education = await readRows(client, "person_education", "*", personId);
    const employment = await readRows(client, "person_employment", "*", personId);
    const skills = await readRows(client, "person_skills", "*", personId);
    const certifications = await readRows(client, "person_certifications", "*", personId);
    const consents = await readRows(client, "person_consents", "*", personId, {
      order: { column: "recorded_at", ascending: false },
    });
    // Read the newest events up to the ceiling, then filter in TS so a Tier-3
    // event about a field this caller cannot see never reaches the payload
    // (spec §1.10 / §7 — defense in depth over the RLS predicate already there).
    const rawEvents = await readRows(client, "person_events", "*", personId, {
      order: { column: "recorded_at", ascending: false },
      limit: PERSON_LIMITS.events_read_rows,
    });
    const events = rawEvents.filter((event) => {
      const group = String(event.field_group ?? "");
      const permission = EVENT_GROUP_PERMISSION[group];
      return !permission || granted.has(permission);
    });

    const bundle: PersonBundle = {
      available: true,
      hidden: [],
      profile,
      emails,
      languages,
      education,
      employment,
      skills,
      certifications,
      consents,
      events,
    };

    // ——— Tier 3: health (read AND logged) ———
    if (granted.has(VIEW_HEALTH)) {
      bundle.health = await readOne(client, "person_health", "*", personId);
      // One row per open, not per field. A failed trail write must never break
      // the read: recordActivity reports failure in its return, it does not
      // throw, and we ignore the result (§decision 5 — the read still stands).
      await recordActivity({
        area: "candidates",
        action: "viewed",
        entity: "person health data",
        entityId: personId,
        actorId: actor.profileId,
        companyId: actor.tenantId,
        summary: `Opened health data for person ${personId}`,
      }).catch(() => undefined);
    } else {
      bundle.hidden.push("health");
    }

    // ——— Tier 3: family + dependants (not logged; §7 names only the health open) ———
    if (granted.has(VIEW_FAMILY)) {
      bundle.family = await readOne(client, "person_family_details", "*", personId);
      bundle.dependants = await readRows(client, "person_dependants", "*", personId);
    } else {
      bundle.hidden.push("family_details", "dependants");
    }

    // ——— Tier 3: emergency contacts ———
    if (granted.has(VIEW_EMERGENCY)) {
      bundle.emergencyContacts = await readRows(client, "person_emergency_contacts", "*", personId);
    } else {
      bundle.hidden.push("emergency_contacts");
    }

    return bundle;
  } catch (cause) {
    if (cause instanceof PersonSchemaMissing) {
      // The spine is not on this database. Degrade the page, hide nothing, and
      // let the surface fall back to the application row (spec §9).
      return { available: false, hidden: [], note: MISSING_NOTE };
    }
    throw cause;
  }
}
