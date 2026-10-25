/**
 * The one writer for the person profile spine (spec §3). Every door — the
 * hand-record drawer, the profile editor, the CV extractor, the future apply
 * form — calls through here; nothing else writes the spine.
 *
 * The writer owns two things and only two things:
 *
 *   1. the consent gate (spec §3.2) — a change whose group has no live, current
 *      consent is refused *before* any value is read or written;
 *   2. the precedence ladder (spec §3.3) — the rung belongs to the *door*, so a
 *      model's reading never erases a recruiter's hand, and the ladder decides
 *      what the profile believes, never what a person was asked and answered.
 *
 * Writes are `service_role` writes. Per 043 §1.11 the `authenticated` role only
 * ever gets SELECT on the spine tables; INSERT/UPDATE is `service_role` only. So
 * the caller (Task 11 onward) authorises the actor with `hasPermissionForUser`
 * first, then hands the change to this module, which writes on the service role —
 * the same "RLS is the read gate, the writer is the write gate" rule spec §10
 * states. This module is NOT itself a security boundary; it is the correctness
 * boundary (registry key, consent, ladder, limits, event).
 *
 * Transactionality: 043 ships no writer RPC, so a change's value write and its
 * `person_events` row are issued as one transaction on the `postgres` superuser
 * pool (`getAuthPool`, the same privileged connection `authAdmin` uses). The
 * event is written *inside* the value's transaction, never after (spec §3, Step 2
 * of the brief). The consent read goes through the REST seam to match 041's
 * newest-row-wins reading exactly.
 *
 * Plain-Node importable: this file is imported by the Step 5 probe and (later)
 * Task 16's proof script under `node --experimental-strip-types`, so its only
 * STATIC imports are the pure domain registry modules (relative, `.ts`
 * extension). Anything that pulls `server-only` or the `@/` alias — the service
 * REST client and the `pg` pool — is loaded by `await import()` inside a function
 * body, which the probe never executes.
 */
import type { PersonField, PersonFieldGroup, PersonCollection } from "../domain/person-fields.ts";
import type { PoolClient } from "pg";

import { consentPurposeFor, listCollectionFor, personField } from "../domain/person-fields.ts";
import { PERSON_LIMITS } from "../domain/person-limits.ts";
import { NOTICE_VERSION, noticeFor } from "../domain/person-notice.ts";

// ————————————————————————————————————————————————————————————————————————————
// §3.1 / §3.3 — the vocabulary and the ladder
// ————————————————————————————————————————————————————————————————————————————

/** The six doors that may write the spine. `merge` is not a door — see `Door`. */
export type Door =
  | "hand_record"
  | "profile_edit"
  | "cv_extraction"
  | "candidate_form"
  | "privacy_page"
  | "system";

/** Who to blame in the event. `door` says how much to believe them; this says who did it. */
export type ActorKind = "staff" | "candidate" | "extractor" | "system";

export interface PersonFieldChange {
  key: string;
  value: unknown;
  door: Door;
  actorId: string | null;
  actorKind: ActorKind;
}

export interface PersonWriteResult {
  applied: string[];
  refused: { key: string; reason: string }[];
  conflicts: { key: string; held: string; incoming: string; winner: string }[];
  personId: string;
}

export interface ConsentChecker {
  consentAlive(personId: string, group: PersonFieldGroup): Promise<boolean>;
}

/**
 * The precedence ladder (spec §3.3). A plain object literal — the rungs are
 * fixed facts of the design, not computed. The six keys are exactly the §1.10
 * `person_events_door_check` values minus `merge`, which Proof 2 asserts.
 */
export const PRECEDENCE: Record<Door, number> = {
  privacy_page: 40, // the candidate, holding the signed link sent to their own address
  hand_record: 30, // a recruiter's hand, on the record they are editing
  profile_edit: 30, // the same hand, later
  candidate_form: 20, // the candidate's own answer, at a door that cannot verify it
  cv_extraction: 10, // a model reading a document
  system: 5, // backfill, retention
};

// ————————————————————————————————————————————————————————————————————————————
// collection metadata — how a `list` key's items become rows
// ————————————————————————————————————————————————————————————————————————————

/**
 * Per-collection write descriptors derived from 043 §1.5–§1.8. `columns` is the
 * insert whitelist (everything else on an offered item is dropped, so a stray
 * form key cannot reach SQL); `hasSource` mirrors the tables that carry a
 * `source` column (education/employment/skills/certifications — NOT languages,
 * dependants or emergency_contacts); `cap` reads the matching `PERSON_LIMITS`
 * row ceiling; `identity` / `readColumns` / `keyOf` implement spec §3.4's
 * trim-and-case-fold duplicate check so the writer *names* the collision before
 * the case-folded unique index refuses the same insert.
 */
interface CollectionMeta {
  table: string;
  columns: readonly string[];
  hasSource: boolean;
  cap: number;
  readColumns: readonly string[];
  /** Stable identity string from a new item, or `null` when the collection has no app-side dup rule. */
  identity: (item: Record<string, unknown>) => string | null;
  /** Same identity, computed from a row already stored (a `Record` of `readColumns`). */
  keyOf: (row: Record<string, unknown>) => string | null;
}

const fold = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const raw = (v: unknown): string => String(v ?? "").trim();

const COLLECTIONS: Record<PersonCollection, CollectionMeta> = {
  education: {
    table: "person_education",
    columns: ["level", "institution", "degree", "field", "major", "minor", "graduation_year", "start_year", "end_year", "gpa", "honors", "as_written"],
    hasSource: true,
    cap: PERSON_LIMITS.education_rows,
    readColumns: ["institution", "graduation_year"],
    // 043 puts no unique index on education, so the writer adds none either.
    identity: () => null,
    keyOf: () => null,
  },
  employment: {
    table: "person_employment",
    columns: ["employer", "title", "location", "employment_type", "start_year", "start_month", "end_year", "end_month", "ongoing", "duties", "as_written"],
    hasSource: true,
    cap: PERSON_LIMITS.employment_rows,
    readColumns: ["employer", "start_year", "end_year"],
    // spec §3.4: the writer's exact-match check on (employer, start_year, end_year).
    identity: (i) => `${raw(i.employer)}|${String(i.start_year ?? "")}|${String(i.end_year ?? "")}`,
    keyOf: (r) => `${raw(r.employer)}|${String(r.start_year ?? "")}|${String(r.end_year ?? "")}`,
  },
  languages: {
    table: "person_languages",
    columns: ["language", "proficiency"],
    hasSource: false,
    cap: PERSON_LIMITS.languages_rows,
    readColumns: ["language"],
    // unique (person_id, language) is case-sensitive in 043, so the writer keeps it case-sensitive.
    identity: (i) => raw(i.language),
    keyOf: (r) => raw(r.language),
  },
  skills: {
    table: "person_skills",
    columns: ["skill", "proficiency", "as_written"],
    hasSource: true,
    cap: PERSON_LIMITS.skills_rows,
    readColumns: ["skill"],
    identity: (i) => fold(i.skill),
    keyOf: (r) => fold(r.skill),
  },
  certifications: {
    table: "person_certifications",
    columns: ["title", "issuer", "year", "as_written"],
    hasSource: true,
    cap: PERSON_LIMITS.certifications_rows,
    readColumns: ["title", "issuer"],
    // matches the coalesced unique index: lower(title) + lower(coalesce(issuer,'')).
    identity: (i) => `${fold(i.title)}|${fold(i.issuer)}`,
    keyOf: (r) => `${fold(r.title)}|${fold(r.issuer)}`,
  },
  dependants: {
    table: "person_dependants",
    columns: ["name", "relationship", "date_of_birth", "note"],
    hasSource: false,
    cap: PERSON_LIMITS.dependants_rows,
    readColumns: ["name"],
    identity: (i) => fold(i.name),
    keyOf: (r) => fold(r.name),
  },
  emergency_contacts: {
    table: "person_emergency_contacts",
    columns: ["sequence", "name", "relationship", "phone", "note"],
    hasSource: false,
    cap: PERSON_LIMITS.emergency_contacts_rows,
    readColumns: ["sequence"],
    identity: (i) => String(i.sequence ?? ""),
    keyOf: (r) => String(r.sequence ?? ""),
  },
};

/**
 * The collection tables carry a `source` CHECK of only
 * ('hand_record','cv_extraction','candidate_form'). Every staff door
 * (hand_record, profile_edit, privacy_page, system) is a human at a desk, so it
 * records as `hand_record`; the model records as `cv_extraction`; the anonymous
 * apply form records as `candidate_form`.
 */
function collectionSource(door: Door): "hand_record" | "cv_extraction" | "candidate_form" {
  if (door === "cv_extraction") return "cv_extraction";
  if (door === "candidate_form") return "candidate_form";
  return "hand_record";
}

// ————————————————————————————————————————————————————————————————————————————
// value rendering for the event trail (spec §11 / §1.10)
// ————————————————————————————————————————————————————————————————————————————

/**
 * Render a value for `person_events.old_value`/`new_value`. The columns are text
 * with a 500-character ceiling; anything longer is stored as its first 80
 * characters followed by `… [N chars]`, so a change trail never becomes the
 * largest copy of the sensitive data in the system. The full value always lives
 * in its own table — that is where the reader gets it.
 */
function toEventText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  const cap = PERSON_LIMITS.events_value_column;
  if (s.length <= cap) return s;
  return `${s.slice(0, 80)}… [${s.length.toLocaleString("en-US")} chars]`;
}

// ————————————————————————————————————————————————————————————————————————————
// the client seams, reached lazily so the probe can import this file
// ————————————————————————————————————————————————————————————————————————————

type ServiceClient = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function serviceRest(): Promise<ServiceClient> {
  const { getServiceRestClient } = await import("@/lib/data-api/service");
  return getServiceRestClient() as unknown as ServiceClient;
}

async function connect(): Promise<PoolClient> {
  const { getAuthPool } = await import("@/lib/auth/db");
  return getAuthPool().connect();
}

// ————————————————————————————————————————————————————————————————————————————
// §3.2 — the consent checker
// ————————————————————————————————————————————————————————————————————————————

/**
 * A live consent is the newest `person_consents` row for the (person, purpose)
 * with `granted = true` against the current `NOTICE_VERSION` — the exact
 * newest-row-wins + versioned rule 041 states for `candidate_consents`. Absent,
 * refused, withdrawn, or given against an older notice all read false, so the
 * caller refuses the field and names the group.
 */
export async function defaultConsentChecker(): Promise<ConsentChecker> {
  return {
    async consentAlive(personId: string, group: PersonFieldGroup): Promise<boolean> {
      const client = await serviceRest();
      // Newest row wins; `.single()` on a zero-row read answers {data:null,
      // error:PGRST116}, and `!!data` below turns that into `false` — an absent
      // consent is refused, exactly as spec §3.2 requires.
      const { data } = await client
        .from("person_consents")
        .select("granted, notice_version")
        .eq("person_id", personId)
        .eq("purpose", group)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();
      const row = data as { granted: boolean; notice_version: string } | null;
      return !!row && row.granted === true && row.notice_version === NOTICE_VERSION;
    },
  };
}

// ————————————————————————————————————————————————————————————————————————————
// §3.1 / §3.3 / §3.4 — applyPersonField
// ————————————————————————————————————————————————————————————————————————————

/**
 * Run every change through consent → ladder → write → event.
 *
 * Returns a `PersonWriteResult` whose `refused` and `conflicts` arrays name every
 * thing it would not write; a `{ error }` is reserved for an infrastructure
 * failure the loop could not isolate to one change (the pool being unreachable).
 *
 * Each change is its own transaction: its value write and its `person_events`
 * row commit together, or neither does. A DB-level refusal (a CHECK the writer
 * does not pre-empt, an FK, a case-folded unique index winning the race) aborts
 * only that change's transaction and is reported as a refusal.
 */
export async function applyPersonField(
  personId: string,
  changes: readonly PersonFieldChange[],
  consent: ConsentChecker
): Promise<PersonWriteResult | { error: string }> {
  const applied: string[] = [];
  const refused: { key: string; reason: string }[] = [];
  const conflicts: { key: string; held: string; incoming: string; winner: string }[] = [];

  for (const change of changes) {
    // — Step 1: the registry is the only key source. —————————————
    const field = personField(change.key);
    if (!field) {
      refused.push({
        key: change.key,
        reason: `"${change.key}" is not a registry key — a stray form field is refused before SQL, so nothing was written.`,
      });
      continue;
    }

    // — Step 2: consent before value. —————————————
    const group = consentPurposeFor(change.key);
    let alive: boolean;
    try {
      alive = await consent.consentAlive(personId, group);
    } catch (cause) {
      return { error: `consent read failed for person ${personId}: ${(cause as Error).message}` };
    }
    if (!alive) {
      refused.push({
        key: change.key,
        reason: `${field.label} needs an active consent for the "${group}" group. ${noticeFor(group).withdraw} Nothing was saved.`,
      });
      continue;
    }

    // — pre-transaction value guards (never truncate, refuse at the cap) —
    if (field.input === "list") {
      if (!Array.isArray(change.value)) {
        refused.push({ key: change.key, reason: `${field.label} expects a list of items; the value was not an array — nothing was written.` });
        continue;
      }
      if (change.value.length === 0) {
        refused.push({ key: change.key, reason: `${field.label}: the offered list was empty, so nothing was appended.` });
        continue;
      }
    } else if (
      field.maxChars !== undefined &&
      typeof change.value === "string" &&
      change.value.length > field.maxChars
    ) {
      refused.push({
        key: change.key,
        reason: `${field.label} is ${change.value.length} characters; the limit is ${field.maxChars}. The writer refuses at the cap, it never truncates.`,
      });
      continue;
    }

    // — one transaction per change: read → ladder → write → event —
    let client: PoolClient;
    try {
      client = await connect();
    } catch (cause) {
      return { error: `person writer could not reach the database: ${(cause as Error).message}` };
    }
    try {
      await client.query("begin");
      const outcome = field.input === "list"
        ? await applyList(client, personId, field, change)
        : await applyScalar(client, personId, field, change);
      await client.query("commit");

      if (outcome.kind === "applied") {
        applied.push(change.key);
        for (const note of outcome.notes ?? []) refused.push({ key: change.key, reason: note });
      } else if (outcome.kind === "refused") {
        refused.push({ key: change.key, reason: outcome.reason });
      } else {
        conflicts.push({ key: change.key, held: outcome.held, incoming: change.door, winner: "held" });
      }
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      // A CHECK / FK / unique violation is a refusal, not a crash: name it.
      refused.push({ key: change.key, reason: `${field.label} was refused by the store: ${(cause as Error).message}` });
    } finally {
      client.release();
    }
  }

  return { applied, refused, conflicts, personId };
}

type Outcome =
  | { kind: "applied"; notes?: string[] }
  | { kind: "refused"; reason: string }
  | { kind: "conflict"; held: string };

/**
 * Scalar column write. Reads the current column value and the door recorded in
 * this field's latest `person_events` row, bends the ladder only where spec §3.3
 * says to (date_of_birth, cv_extraction), and — when the incoming rung wins or
 * ties, or the field is empty — writes the column and stamps one event naming
 * both sides.
 */
async function applyScalar(
  client: PoolClient,
  personId: string,
  field: PersonField,
  change: PersonFieldChange
): Promise<Outcome> {
  const column = field.column;
  if (!column) {
    return { kind: "refused", reason: `${field.label} has no column the writer can address.` };
  }

  // current value + the door that last wrote it, both read inside the transaction.
  const heldValue = await readColumn(client, field, column, personId);
  const heldDoor = await readHeldDoor(client, personId, field.key);
  const incoming = PRECEDENCE[change.door];

  // date_of_birth: immutable once any human set it — only privacy_page may change it,
  // and the event below is what records the reason (the trail names door + actor).
  if (field.key === "date_of_birth" && heldValue !== null && change.door !== "privacy_page") {
    return {
      kind: "refused",
      reason: "Date of birth is immutable once set. Only the privacy page may change it, and the reason is recorded there.",
    };
  }

  // cv_extraction may fill a field that is empty and nothing else, ever.
  if (change.door === "cv_extraction") {
    if (heldValue !== null) {
      return { kind: "conflict", held: heldDoor ?? "an already-held value" };
    }
    // fill the empty field, then fall through to write.
  } else if (heldValue !== null && heldDoor) {
    // a held value with a known door: the ladder decides.
    if (PRECEDENCE[heldDoor as Door] > incoming) {
      return { kind: "conflict", held: heldDoor };
    }
    // held < incoming: overwrite. held === incoming: overwrite and record both
    // sides — the event's old_value/new_value pair is exactly that record.
  }
  // Otherwise (empty field, or a backfilled value with no event row) → write.

  await writeColumn(client, field, column, personId, change.value);
  await stampEvent(client, personId, field, change, heldValue, change.value);
  return { kind: "applied" };
}

/**
 * Append-only collection write. Never updates the whole array — it appends one
 * row per accepted item, applying spec §3.4's trim-and-case-fold duplicate check
 * so a second "React" is refused and *named* (naming both the held and incoming
 * spellings) before the case-folded unique index would refuse it. Enforces the
 * `PERSON_LIMITS` row cap for the collection.
 */
async function applyList(
  client: PoolClient,
  personId: string,
  field: PersonField,
  change: PersonFieldChange
): Promise<Outcome> {
  const collection = listCollectionFor(field.key);
  if (!collection) {
    return { kind: "refused", reason: `${field.label} is a list with no collection to append to.` };
  }
  const meta = COLLECTIONS[collection];
  const items = change.value as unknown[];

  const { rows: existingRows } = await client.query(
    `select ${meta.readColumns.join(", ")} from ${meta.table} where person_id = $1`,
    [personId]
  );
  const existing = existingRows as Record<string, unknown>[];
  const heldKeys = new Set<string>();
  for (const row of existing) {
    const k = meta.keyOf(row);
    if (k !== null) heldKeys.add(k);
  }

  if (existing.length >= meta.cap) {
    return { kind: "refused", reason: `${field.label} already holds ${existing.length} rows, the limit is ${meta.cap}; nothing more can be appended.` };
  }

  const accepted: Record<string, unknown>[] = [];
  const dupReasons: string[] = [];
  const batchKeys = new Set<string>();

  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      dupReasons.push("an offered item was not an object");
      continue;
    }
    const obj = item as Record<string, unknown>;
    const id = meta.identity(obj);
    if (id !== null) {
      const prior = heldKeys.has(id) ? "an item already on the person" : batchKeys.has(id) ? "an earlier item in this same write" : null;
      if (prior) {
        // Name both spellings so a recruiter can see exactly the collision.
        const incomingLabel = describeItem(field.key, obj);
        dupReasons.push(`${incomingLabel} duplicates ${prior}; refused before the index`);
        continue;
      }
      batchKeys.add(id);
    }
    accepted.push(obj);
  }

  // Row-cap the accepted batch against what is already held.
  const room = meta.cap - existing.length;
  const fitting = accepted.slice(0, room);
  if (accepted.length > fitting.length) {
    dupReasons.push(`the list could only take ${room} more row(s) before its ${meta.cap}-row cap; the rest were refused`);
  }

  if (fitting.length === 0) {
    return { kind: "refused", reason: dupReasons.length ? dupReasons.join("; ") : `${field.label}: no item could be appended.` };
  }

  for (const obj of fitting) {
    await appendRow(client, meta, personId, obj, change.door);
  }
  await stampEvent(client, personId, field, change, null, fitting);

  // Some items landed and were evented; any items refused-and-named travel in
  // `notes`, so a recruiter sees exactly which duplicates did NOT become rows.
  return { kind: "applied", notes: dupReasons.length ? dupReasons : undefined };
}

function describeItem(key: string, item: Record<string, unknown>): string {
  if (key === "skills") return `skill "${String(item.skill ?? "").trim()}"`;
  if (key === "languages") return `language "${String(item.language ?? "").trim()}"`;
  if (key === "certifications") return `certification "${String(item.title ?? "").trim()}"`;
  if (key === "employment") return `role ${String(item.employer ?? "").trim()} (${String(item.start_year ?? "?")})`;
  if (key === "dependants") return `dependant "${String(item.name ?? "").trim()}"`;
  if (key === "emergency_contacts") return `emergency contact at sequence ${String(item.sequence ?? "?")}`;
  return `an item of ${key}`;
}

// ————————————————————————————————————————————————————————————————————————————
// SQL helpers used inside a change's transaction
// ————————————————————————————————————————————————————————————————————————————

async function readColumn(client: PoolClient, field: PersonField, column: string, personId: string): Promise<unknown> {
  // Whitelisted identifier from the registry, never user input.
  const { rows } = await client.query(
    `select ${column} as v from ${field.table} where ${field.table === "person_profiles" ? "id" : "person_id"} = $1`,
    [personId]
  );
  const row = rows[0] as { v: unknown } | undefined;
  return row ? row.v : null;
}

async function readHeldDoor(client: PoolClient, personId: string, key: string): Promise<string | null> {
  const { rows } = await client.query(
    `select door from person_events where person_id = $1 and field_key = $2 order by recorded_at desc limit 1`,
    [personId, key]
  );
  return rows.length ? (rows[0] as { door: string }).door : null;
}

async function writeColumn(client: PoolClient, field: PersonField, column: string, personId: string, value: unknown): Promise<void> {
  if (field.table === "person_profiles") {
    const { rowCount } = await client.query(
      `update person_profiles set ${column} = $1, updated_at = now() where id = $2`,
      [value, personId]
    );
    if (!rowCount) throw new Error("no such person profile to update");
  } else {
    // person_health / person_family_details are 1:1 and may not exist yet.
    await client.query(
      `insert into ${field.table} (person_id, ${column}) values ($1, $2)
       on conflict (person_id) do update set ${column} = excluded.${column}, updated_at = now()`,
      [personId, value]
    );
  }
}

async function appendRow(client: PoolClient, meta: CollectionMeta, personId: string, item: Record<string, unknown>, door: Door): Promise<void> {
  const cols: string[] = ["person_id"];
  const vals: unknown[] = [personId];
  for (const col of meta.columns) {
    if (Object.prototype.hasOwnProperty.call(item, col) && item[col] !== undefined) {
      cols.push(col);
      vals.push(item[col]);
    }
  }
  if (meta.hasSource) {
    cols.push("source");
    vals.push(collectionSource(door));
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  await client.query(`insert into ${meta.table} (${cols.join(", ")}) values (${placeholders})`, vals);
}

async function stampEvent(
  client: PoolClient,
  personId: string,
  field: PersonField,
  change: PersonFieldChange,
  oldValue: unknown,
  newValue: unknown
): Promise<void> {
  await client.query(
    `insert into person_events
       (person_id, field_key, field_group, old_value, new_value, door, actor_id, actor_kind)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      personId,
      field.key,
      field.group,
      toEventText(oldValue),
      toEventText(newValue),
      change.door,
      change.actorId,
      change.actorKind,
    ]
  );
}

// ————————————————————————————————————————————————————————————————————————————
// §3.4 — mergePersons
// ————————————————————————————————————————————————————————————————————————————

export interface MergeConflict {
  key: string;
  from: string;
  to: string;
}

export type MergeResult =
  | { merged: true; personId: string }
  | { merged: false; conflicts: MergeConflict[] }
  | { error: string };

/**
 * Merge one person into another (spec §3.4). Refuses while any non-null scalar
 * registry value differs between the two profiles and returns the list — a
 * silent merge is a person whose children's names came from the wrong profile
 * and nobody can say when. When nothing differs it moves the address rows, the
 * append-only collection rows and the 1:1 fact rows, repoints
 * `applications.person_id`, and stamps a `field_group = 'merge'` event on both
 * sides. All of that is one transaction: a partial merge is the exact thing this
 * function exists to prevent.
 */
export async function mergePersons(fromPersonId: string, toPersonId: string): Promise<MergeResult> {
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    return { error: "merge needs two distinct person ids" };
  }

  let client: PoolClient;
  try {
    client = await connect();
  } catch (cause) {
    return { error: `merge could not reach the database: ${(cause as Error).message}` };
  }

  try {
    await client.query("begin");

    // Compare every scalar registry field across both profiles.
    const conflicts: MergeConflict[] = [];
    const scalarFields = listScalarFields();

    for (const tableName of ["person_profiles", "person_health", "person_family_details"] as const) {
      const fields = scalarFields.filter((f) => f.table === tableName && f.column);
      if (fields.length === 0) continue;
      const pk = tableName === "person_profiles" ? "id" : "person_id";
      const select = fields.map((f) => f.column as string).join(", ");
      const [fromRow, toRow] = await Promise.all([
        readRow(client, tableName, pk, fromPersonId, select),
        readRow(client, tableName, pk, toPersonId, select),
      ]);
      for (const f of fields) {
        const col = f.column as string;
        const a = fromRow?.[col];
        const b = toRow?.[col];
        if (a != null && b != null && normalise(a) !== normalise(b)) {
          conflicts.push({ key: f.key, from: normalise(a), to: normalise(b) });
        }
      }
    }

    if (conflicts.length > 0) {
      await client.query("rollback");
      return { merged: false, conflicts };
    }

    // Relocate the append-only collections and the 1:1 tables, then the identity,
    // then the applications link. A 1:1 row that exists on both sides cannot move
    // (PK clash); the target's row is kept and the source's dropped, since the
    // comparison above proved they do not conflict on any differing value.
    for (const collection of Object.keys(COLLECTIONS) as PersonCollection[]) {
      const meta = COLLECTIONS[collection];
      await client.query(`update ${meta.table} set person_id = $1 where person_id = $2`, [toPersonId, fromPersonId]);
    }

    // moved address rows must not fight the target's primary (one primary per person).
    await client.query(`update person_emails set is_primary = false where person_id = $2`, [toPersonId, fromPersonId]);
    await client.query(`update person_emails set person_id = $1 where person_id = $2`, [toPersonId, fromPersonId]);

    // consents follow the person.
    await client.query(`update person_consents set person_id = $1 where person_id = $2`, [toPersonId, fromPersonId]);

    await client.query(`update applications set person_id = $1 where person_id = $2`, [toPersonId, fromPersonId]);

    // merge events on both sides. `merge` is a legal person_events door/group but
    // not a `Door` — written verbatim, per 043 §1.10.
    await client.query(
      `insert into person_events (person_id, field_key, field_group, old_value, new_value, door, actor_kind)
       values ($1, 'merged_into', 'merge', null, $2, 'merge', 'staff'),
              ($3, 'merged_from', 'merge', $4, null, 'merge', 'staff')`,
      [toPersonId, fromPersonId, fromPersonId, toPersonId]
    );

    await client.query("commit");
    return { merged: true, personId: toPersonId };
  } catch (cause) {
    await client.query("rollback").catch(() => undefined);
    return { error: `merge failed and was rolled back: ${(cause as Error).message}` };
  } finally {
    client.release();
  }
}

function listScalarFields(): PersonField[] {
  // A tiny local view of the registry: only the entries that address a column.
  // person-fields.ts is the authority; this just filters it for the merge read.
  const keys = [
    "legal_name", "preferred_name", "pronouns", "gender", "date_of_birth", "birthplace", "national_id", "nationality",
    "phone", "mailing_address", "current_city", "photo_path", "photo_mime",
    "marital_status", "children_count", "household_size", "housing_tenure", "commute_mode", "commute_minutes",
    "relocation_willingness", "travel_restrictions",
    "disability_status", "accommodations", "chronic_conditions", "allergies", "dietary_restrictions", "blood_type", "health_insurance",
    "partner_name", "partner_occupation", "partner_contact", "anniversary_date", "household_composition", "family_planning",
  ];
  const out: PersonField[] = [];
  for (const key of keys) {
    const f = personField(key);
    if (f && f.column) out.push(f);
  }
  return out;
}

async function readRow(client: PoolClient, table: string, pk: string, id: string, select: string): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query(`select ${select} from ${table} where ${pk} = $1`, [id]);
  return rows[0] ? (rows[0] as Record<string, unknown>) : null;
}

function normalise(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}
