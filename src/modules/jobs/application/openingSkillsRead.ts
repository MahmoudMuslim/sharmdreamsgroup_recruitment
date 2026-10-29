import "server-only";

/**
 * The two reads a requisition's skill list needs.
 *
 * Both are separate queries from the openings grid's own row read, for the reason
 * `openingTermsRead.ts` gives for the seniority column: the table ships ahead of
 * its ALTER. `db/migrations/037_opening_skills.sql` is APPLIED on this local
 * database, so `job_opening_skills` is here; on a database where that file has
 * never run it is not, and a page that named it inside the grid's `select` would
 * lose the openings, the applicants and the rails to a table only the skill picker
 * wants. Isolated here, a missing table costs the skill list and says which
 * migration is missing.
 *
 * The caller passes the ids it already holds. Reading the whole table instead
 * would answer for openings the screen is not showing, and a bounded grid would
 * print "no skills required" for the openings that fell outside the window —
 * a wrong answer rather than a missing one.
 */

import { createServerRestClient } from "@/lib/data-api/server";
import { isMissingSchemaError } from "@/modules/jobs/domain/openingTerms";
import {
  MAX_REQUIRED_SKILLS,
  MAX_SKILL_LEVEL,
  MIN_SKILL_LEVEL,
  OPENING_SKILLS_SCHEMA_NOTE,
  SKILL_SOURCES,
  type CatalogueSkill,
  type RequiredSkill,
} from "@/modules/jobs/domain/openingSkills";

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * Whatever is asked for, the catalogue read only ever does one thing with it.
 *
 * Typed by member rather than by the staff client because the screening
 * use-case holds the service-role one — it runs from the public apply flow as
 * well as from a recruiter's button — and the master list is the same table to
 * either of them.
 */
type Readable = Pick<StaffClient, "from">;

/** The live rows of the skills master list, in the console's order. */
export interface SkillsCatalogue {
  skills: CatalogueSkill[];
  /**
   * Every row, retired included — the picker's vocabulary for naming what an
   * opening already carries. Kept apart from `skills` because the two answer
   * different questions: which may be added next, and what a stored id is called.
   */
  all: CatalogueSkill[];
  /**
   * False when the read itself failed. Kept apart from an empty list because the
   * two print differently: an empty catalogue means nobody has seeded a skill,
   * a failed read means the picker has nothing to offer for a reason the
   * recruiter has to be told.
   */
  available: boolean;
  note: string | null;
}

/** Each opening's required skills, or the fact they could not be read. */
export interface OpeningSkillsRead {
  /** `job_openings.id` → that opening's rows, in the order they were read. */
  requiredById: Map<string, RequiredSkill[]>;
  available: boolean;
  /**
   * True only when the table itself is not there — the distinction the writer
   * needs, because a missing table is migration 037 and anything else is a real
   * database failure that must not be dressed up as one.
   */
  missing: boolean;
  note: string | null;
}

/**
 * The skills a requisition may be pointed at, and the vocabulary the CV
 * screener is allowed to answer in.
 *
 * `skills` holds the active rows only, so a recruiter cannot add a skill the
 * master-data console has struck off and a save refuses an opening that quietly
 * kept one — and, for the same reason, the screening engine never sees a retired
 * name it could put on a candidate. `all` keeps the retired rows too, because an
 * opening that carried a skill before it was struck off still has to print that
 * row's name and let the recruiter remove it — a stored row the screen can only
 * show as a bare uuid is a row nobody can reason about. One read serves both, for
 * the same reason the master-data filing lists are read once and kept in full:
 * two doors, one vocabulary.
 */
export async function getSkillsCatalogue(restClient: Readable): Promise<SkillsCatalogue> {
  const { data, error } = await restClient
    .from("skills")
    .select("id, name, is_active")
    .order("sort_order");

  if (error) {
    return {
      skills: [],
      all: [],
      available: false,
      note: `The skills catalogue could not be read: ${error.message}.`,
    };
  }

  const rows = ((data ?? []) as { id: string; name: string; is_active?: boolean }[]).filter(
    (row) => typeof row?.name === "string" && row.name.trim().length > 0
  );
  const named = (row: { id: string; name: string }) => ({ id: String(row.id), name: row.name });

  return {
    skills: rows.filter((row) => row.is_active === true).map(named),
    all: rows.map(named),
    available: true,
    note: null,
  };
}

function readSkills(
  data: unknown,
  error: { code?: string | null; message?: string | null } | null
): OpeningSkillsRead {
  if (error) {
    const missing = isMissingSchemaError(error);
    return {
      requiredById: new Map(),
      available: false,
      missing,
      note: missing ? OPENING_SKILLS_SCHEMA_NOTE : `Required skills could not be read: ${error.message}.`,
    };
  }

  const requiredById = new Map<string, RequiredSkill[]>();
  for (const row of (data ?? []) as {
    opening_id: string;
    skill_id: string;
    required_level: number;
    source: string;
  }[]) {
    // A row the table's own checks would not have accepted is not printed as a
    // requirement: a level outside the scale or a source the migration does not
    // name would otherwise reach a recruiter as advice. Same rule as the
    // seniority read, which drops a level that is not in the closed list.
    if (typeof row?.skill_id !== "string" || typeof row?.opening_id !== "string") continue;
    if (!Number.isInteger(row.required_level)) continue;
    if (row.required_level < MIN_SKILL_LEVEL || row.required_level > MAX_SKILL_LEVEL) continue;
    if (!(SKILL_SOURCES as readonly string[]).includes(row.source)) continue;

    const skill: RequiredSkill = {
      skill_id: row.skill_id,
      required_level: row.required_level,
      source: row.source as RequiredSkill["source"],
    };
    const held = requiredById.get(row.opening_id);
    if (held) held.push(skill);
    else requiredById.set(row.opening_id, [skill]);
  }

  return { requiredById, available: true, missing: false, note: null };
}

/**
 * The required skills for the openings a screen already holds.
 *
 * The ceiling is the list's own shape — one row per skill, at most
 * `MAX_REQUIRED_SKILLS` per opening — so a read cannot grow with the table, and
 * an opening whose rows were not reached is reported by the caller as no skills
 * rather than a partial list. That is why callers pass the ids they are showing.
 */
export async function getOpeningsRequiredSkills(
  restClient: StaffClient,
  ids: readonly string[]
): Promise<OpeningSkillsRead> {
  if (ids.length === 0) {
    return { requiredById: new Map(), available: true, missing: false, note: null };
  }

  const { data, error } = await restClient
    .from("job_opening_skills")
    .select("opening_id, skill_id, required_level, source")
    .in("opening_id", [...ids])
    .limit(ids.length * MAX_REQUIRED_SKILLS);

  return readSkills(data, error);
}
