import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { MASTER_LIST_WORDS, type MasterRowKey } from "@/modules/settings/domain/masterDataLists";
import {
  driftScopeSentence,
  driftWords,
  filingChoices,
  filingDrift,
  resolveFiling,
  type DriftGroup,
  type FilingRow,
  type FilingVocabularies,
  type FiledEntity,
} from "@/modules/settings/domain/masterDataFiling";

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The four vocabularies a job opening names, read live.
 *
 * `job_openings` stores a company by id and a department, a location and a salary
 * currency as *text*, so nothing at the database level stops an opening filing
 * itself under "Finance" when the department list only holds "Finance & Investment".
 * The seeds did exactly that. The desk this read feeds names every opening still
 * carrying one, because a count written into a comment is out of date the next
 * time someone refiles a role.
 *
 * The read deliberately keeps retired rows: a write has to tell "this list does not
 * hold that name" apart from "it does, but it is retired", and the drawer needs the
 * same distinction to label a value a legacy opening already carries.
 */
const FILING_FIELDS: readonly {
  entity: FiledEntity;
  field: "tenant_id" | "department" | "location" | "salary_currency";
  by: MasterRowKey;
  table: string;
  columns: string;
}[] = [
  {
    entity: "companies",
    field: "tenant_id",
    by: "id",
    table: "tenants_and_companies",
    columns: "id, name, is_active",
  },
  { entity: "departments", field: "department", by: "name", table: "departments", columns: "id, name, is_active" },
  { entity: "locations", field: "location", by: "name", table: "locations", columns: "id, name, is_active" },
  {
    entity: "currencies",
    field: "salary_currency",
    by: "code",
    table: "currencies",
    columns: "id, code, label, is_active",
  },
];

/** The four fields an opening files itself under, as the writer sends them. */
export interface JobFilingFields {
  tenant_id: string;
  department: string;
  location: string;
  salary_currency: string;
}

export interface FilingRead {
  vocabularies: FilingVocabularies;
  /** Lists the database would not return, named so a write can refuse instead of guessing. */
  unreadable: FiledEntity[];
}

/** Every row of the four lists, in the order the console shows them. */
export async function getFilingVocabularies(restClient: StaffClient): Promise<FilingRead> {
  const reads = await Promise.all(
    FILING_FIELDS.map(({ table, columns }) =>
      restClient.from(table).select(columns).order("sort_order")
    )
  );

  const vocabularies = {} as FilingVocabularies;
  const unreadable: FiledEntity[] = [];
  FILING_FIELDS.forEach(({ entity }, index) => {
    const { data, error } = reads[index];
    if (error) unreadable.push(entity);
    vocabularies[entity] = (data ?? []) as FilingRow[];
  });

  return { vocabularies, unreadable };
}

/**
 * The four filing values, in the vocabulary's own spelling — or the refusal.
 *
 * `stored` is what an existing opening already holds. Passing it lets a recruiter
 * fix a title on a role seeded before the master tables were populated, instead of
 * being blocked by history they did not write; a value that agrees with the row's
 * own passes even when the list has never held it.
 *
 * A list that failed to load refuses the whole write. Returning the file as
 * unfilable would be a lie — the vocabulary may be perfectly populated — and
 * writing it unvalidated is how the drift started.
 */
export async function resolveJobFiling(input: {
  restClient: StaffClient;
  submitted: JobFilingFields;
  stored?: Partial<JobFilingFields> | null;
}): Promise<{ ok: true; filed: JobFilingFields } | { ok: false; error: string }> {
  const { vocabularies, unreadable } = await getFilingVocabularies(input.restClient);
  if (unreadable.length > 0) {
    const lists = unreadable.map((entity) => MASTER_LIST_WORDS[entity]).join(", ");
    return {
      ok: false,
      error: `The master data (${lists}) did not load, so nothing was filed. Try again.`,
    };
  }

  const filed: JobFilingFields = { ...input.submitted };
  const refusal: string[] = [];

  for (const { entity, field, by } of FILING_FIELDS) {
    const result = resolveFiling({
      entity,
      rows: vocabularies[entity],
      submitted: filed[field],
      by,
      stored: input.stored?.[field],
    });
    if (!result.ok) refusal.push(result.error);
    else filed[field] = result.name;
  }

  if (refusal.length > 0) return { ok: false, error: refusal.join(" ") };
  return { ok: true, filed };
}

/* ------------------------------- Filing drift ------------------------------- */

/** Which column carries the reference, and how the list keys it. */
const FILED_COLUMN = new Map<FiledEntity, { field: keyof JobFilingFields; by: MasterRowKey }>(
  FILING_FIELDS.map(({ entity, field, by }) => [entity, { field, by }])
);

/** The column a refile writes for one vocabulary. */
export function filedColumn(entity: FiledEntity): { field: keyof JobFilingFields; by: MasterRowKey } {
  const column = FILED_COLUMN.get(entity);
  if (!column) throw new Error(`No job column files ${entity}.`);
  return column;
}

/** An opening as the drift desk names it. */
export interface DriftOpening {
  id: string;
  title: string;
  status: string;
}

/** What one vocabulary does not recognise, and where a refile could go. */
export interface EntityDrift {
  entity: FiledEntity;
  groups: DriftGroup<DriftOpening>[];
  /** Live rows only — the same list the drawer's picker offers. */
  choices: { value: string; label: string }[];
}

const DRIFT_COLUMNS =
  "id, title, status, tenant_id, department, location, salary_currency";

/**
 * Every opening filed with a value its vocabulary does not carry as written.
 *
 * #287 closed the door; this is what is already standing in the room. The seeds put
 * "Finance" on a role while the list spells the row "Finance & Investment", and the
 * public board has been offering applicants both as separate departments ever since —
 * so the desk has to name the value, the openings carrying it, and a destination the
 * write path will accept.
 *
 * Read through the staff client, so a recruiter with a scoped account sees the drift
 * in the openings they can see, and nothing else.
 */
export async function getFilingDrift(
  restClient: StaffClient,
  only?: FiledEntity
): Promise<{ drift: EntityDrift[]; openings: number; unreadable: FiledEntity[]; error: string | null }> {
  const [read, openings] = await Promise.all([
    getFilingVocabularies(restClient),
    restClient.from("job_openings").select(DRIFT_COLUMNS).order("created_at", { ascending: false }),
  ]);

  const rows = (openings.data ?? []) as unknown as (JobFilingFields & DriftOpening)[];
  const wanted: FiledEntity[] = only
    ? [only]
    : FILING_FIELDS.map((field) => field.entity);
  if (openings.error) {
    return {
      drift: [],
      openings: 0,
      unreadable: read.unreadable.filter((entity) => wanted.includes(entity)),
      error: `The openings could not be read (${openings.error.message}), so nothing was counted.`,
    };
  }

  // A list that did not load holds no rows, which would make every opening look
  // like it was filed off-vocabulary. That is reported as unreadable, never counted.
  const unreadable = read.unreadable.filter((entity) => wanted.includes(entity));

  const drift = wanted.flatMap((entity) => {
    if (unreadable.includes(entity)) return [];
    const { field, by } = filedColumn(entity);
    const groups = filingDrift({
      entity,
      rows: read.vocabularies[entity],
      by,
      entries: rows.map((row) => ({
        value: row[field],
        record: { id: row.id, title: row.title, status: row.status },
      })),
    });
    if (groups.length === 0) return [];
    return [{ entity, groups, choices: filingChoices(entity, read.vocabularies[entity], by) }];
  });

  return { drift, openings: rows.length, unreadable, error: null };
}

/**
 * A drifting value as a screen and a chat answer both print it.
 *
 * One shaping for both doors, so the words a recruiter reads in Settings and the
 * words the assistant quotes are the same sentence from the same read — and the
 * openings named are the ones counted, up to a bound that says what it left out.
 */
export interface DriftCard {
  entity: FiledEntity;
  list: string;
  state: DriftGroup<DriftOpening>["state"];
  /** The text to move *off* — exactly what the openings carry. */
  source: string;
  line: string;
  count: number;
  openings: { title: string; status: string }[];
  hidden: number;
}

/** How many of a group's openings an answer names before counting the rest. */
const DRIFT_ROWS_SHOWN = 6;

/**
 * The desk's words for one drift read.
 *
 * Split from the read so the sentences a recruiter sees in Settings and the ones
 * the assistant quotes are computed by the same function over the same rows — and
 * so a probe can print them without a request's cookie jar.
 */
export function shapeDrift(read: {
  drift: EntityDrift[];
  openings: number;
  unreadable: FiledEntity[];
  error: string | null;
}): {
  cards: DriftCard[];
  /** The live rows a refile may choose, once per list the cards name. */
  destinations: Partial<Record<FiledEntity, { value: string; label: string }[]>>;
  openings: number;
  /** How many openings the count covers — the scope line a desk and a chat answer print. */
  note: string;
  /** A list that did not load, named so no door calls what it skipped clean. */
  warning: string | null;
  /** A read that could not be made at all. */
  error: string | null;
} {
  if (read.error) {
    return { cards: [], destinations: {}, openings: 0, note: "", warning: null, error: read.error };
  }

  const cards = read.drift.flatMap(({ entity, groups }) =>
    groups.map((group) => ({
      entity,
      list: MASTER_LIST_WORDS[entity],
      state: group.state,
      source: group.value,
      line: driftWords(entity, group),
      count: group.records.length,
      openings: group.records.slice(0, DRIFT_ROWS_SHOWN).map((job) => ({
        title: job.title,
        status: job.status,
      })),
      hidden: Math.max(0, group.records.length - DRIFT_ROWS_SHOWN),
    }))
  );

  // The rows a refile may choose, once per list rather than once per card. Every
  // drifting value of one list shares the destinations, and a chat answer that
  // repeated the department list four times was cut by the result clip before it
  // reached the model — so the card names its `entity` and the destination lives
  // beside it, where one copy serves the screen and the answer alike.
  const destinations = Object.fromEntries(
    read.drift.map(({ entity, choices }) => [entity, choices])
  ) as Partial<Record<FiledEntity, { value: string; label: string }[]>>;

  // A list that did not load holds no rows, so the openings under it are *not*
  // counted — the read says which list it skipped instead of calling the rest clean.
  const skipped = read.unreadable.map((entity) => MASTER_LIST_WORDS[entity]).join(", ");

  return {
    cards,
    destinations,
    openings: read.openings,
    note: driftScopeSentence(read.openings),
    warning: read.unreadable.length
      ? `The ${skipped} list${read.unreadable.length === 1 ? "" : "s"} did not load, so nothing was counted against it.`
      : null,
    error: null,
  };
}

/**
 * Every filed value the vocabulary does not carry as written, as the desk shows it.
 *
 * Session-gated and scoped like the rest of the assistant's reads, because the
 * chat calls it directly; the settings page has already passed its own door and
 * simply re-reads through the same staff client.
 */
export async function readFilingDrift(only?: FiledEntity) {
  await requireStaff("/settings");
  const restClient = await createServerRestClient();
  return shapeDrift(await getFilingDrift(restClient, only));
}
