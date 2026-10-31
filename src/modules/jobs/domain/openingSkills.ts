/**
 * The skills a requisition asks for, and what one applicant has shown of them.
 *
 * Three rules live here, and nowhere else, because three doors read them: the job
 * form's picker, the applicants drawer, and the assistant's write. A list the form
 * can produce but the drawer cannot read, or a level one door rounds while another
 * refuses it, is how an opening ends up storing a skill nobody can display.
 *
 * The shape mirrors `role_family_skills` — the same 1..5 level, one row per
 * (parent, skill) — because a requisition's list is that family's list narrowed to
 * one vacancy, and one number has to mean one thing wherever it is printed.
 *
 * What a suggestion may be is deliberately narrow. The matcher's only vocabulary is
 * the catalogue's own spelling: a name with a qualifier ("Excel (advanced)") is also
 * found without it, and a name that lists alternatives ("NPV / IRR analysis") is
 * found by either half. Nothing else. A synonym table would let the portal offer a
 * skill the requisition never named, which is the same mistake as a scoring weight
 * nobody chose — so a chip the recruiter can quote back from their own line is the
 * only thing this returns.
 *
 * The comparison is honest about the absence of evidence. `candidate_skills` holds
 * what screening recorded about one application; a required skill with no row means
 * nobody looked, not that the person lacks it. That prints as no evidence, never as
 * a gap — the same reason the pipeline counts stopped being labelled a conversion.
 */

export const MIN_SKILL_LEVEL = 1;
export const MAX_SKILL_LEVEL = 5;

/**
 * How many skills one requisition may list.
 *
 * The role-family seed holds ten at most, and a list longer than a screen is a list
 * no recruiter reads; the cap is here rather than only in the picker because the
 * assistant writes through the same door as the form.
 */
export const MAX_REQUIRED_SKILLS = 12;

/** The cap told in one sentence, by the save and by the picker alike. */
export const SKILL_CAP_ERROR = `A requisition lists at most ${MAX_REQUIRED_SKILLS} skills — keep the ones that decide the hire.`;

/**
 * The level a picked skill carries until a recruiter sets one.
 *
 * The same number `job_opening_skills.required_level` defaults to, so a form that
 * offers no level and a write that named none store one thing.
 */
export const DEFAULT_REQUIRED_LEVEL = 3;

/** Every level a picker may offer, in order — the scale, not a subset of it. */
export const SKILL_LEVELS: readonly number[] = Array.from(
  { length: MAX_SKILL_LEVEL - MIN_SKILL_LEVEL + 1 },
  (_, index) => MIN_SKILL_LEVEL + index
);

/** How a row arrived: typed by a person, or accepted from the requirement lines. */
export const SKILL_SOURCES = ["RECRUITER", "CATALOGUE_MATCH"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export interface CatalogueSkill {
  id: string;
  name: string;
}

export interface RequiredSkill {
  skill_id: string;
  required_level: number;
  source: SkillSource;
}

export interface DemonstratedSkill {
  skill_id: string;
  proficiency: number;
}

export type SkillEvidence = "meets" | "below" | "no_evidence";

export interface SkillMatchLine {
  skill_id: string;
  name: string;
  required_level: number;
  demonstrated_level: number | null;
  evidence: SkillEvidence;
}

export type RequiredSkillsRead =
  | { ok: true; skills: RequiredSkill[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWholeLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * What a submitted skill list means: the rows as stored, or the reason they are not.
 *
 * An omitted level and an omitted source take the column's own defaults, so a form
 * that offers a picker without a level still writes what the database would have
 * written for it. `null` and `"3"` are refused rather than guessed at: the first is
 * a value that is not a level and the second is a string a caller should have
 * turned into a number before asking.
 *
 * A catalogue row that is not active is not in the list the caller passes, so a
 * retired skill is refused by the same branch as an invented id — which is the point
 * of checking membership instead of trusting the caller to filter first.
 */
export function readRequiredSkills(
  rows: unknown,
  catalogue: readonly CatalogueSkill[]
): RequiredSkillsRead {
  if (!Array.isArray(rows)) return { ok: false, error: "Required skills must be a list of skills." };
  if (rows.length > MAX_REQUIRED_SKILLS) {
    return { ok: false, error: SKILL_CAP_ERROR };
  }

  const byId = new Map(catalogue.map((skill) => [skill.id, skill]));
  const seen = new Set<string>();
  const skills: RequiredSkill[] = [];

  for (const row of rows) {
    if (!isRecord(row) || typeof row.skill_id !== "string" || !row.skill_id.trim()) {
      return { ok: false, error: "Each required skill must name a skill from the catalogue." };
    }
    const skill_id = row.skill_id.trim();
    const known = byId.get(skill_id);
    if (!known) {
      return {
        ok: false,
        error: `“${skill_id}” is not in the skills catalogue, so it cannot be required. Add it in Settings → Master data → Skills first.`,
      };
    }
    if (seen.has(skill_id)) {
      return { ok: false, error: `“${known.name}” is listed twice — each skill is listed once per opening.` };
    }
    seen.add(skill_id);

    const given = row.required_level;
    let required_level = DEFAULT_REQUIRED_LEVEL;
    if (given !== undefined) {
      if (!isWholeLevel(given)) {
        return { ok: false, error: "Each required skill's level is a whole number from 1 to 5." };
      }
      if (given < MIN_SKILL_LEVEL || given > MAX_SKILL_LEVEL) {
        return { ok: false, error: `Each required skill's level is a whole number from ${MIN_SKILL_LEVEL} to ${MAX_SKILL_LEVEL}.` };
      }
      required_level = given;
    }

    const source = row.source === undefined ? "RECRUITER" : row.source;
    if (typeof source !== "string" || !(SKILL_SOURCES as readonly string[]).includes(source)) {
      return {
        ok: false,
        error: `Each required skill says how it was chosen: ${SKILL_SOURCES.join(" or ")}.`,
      };
    }

    skills.push({ skill_id, required_level, source: source as SkillSource });
  }

  return { ok: true, skills };
}

/**
 * The picker's two moves and the drawer's one comparison.
 *
 * They live beside `readRequiredSkills`, not inside the component, because the
 * form that offers a skill the writer would refuse is the same mistake as a
 * level one door rounds while another refuses. The cap and the sources are said
 * once, in the words the save itself uses, so a click cannot put the recruiter
 * into an error the button caused.
 */
export function toggleRequiredSkill(
  rows: readonly RequiredSkill[],
  skill_id: string
): RequiredSkillsRead {
  if (rows.some((row) => row.skill_id === skill_id)) {
    return { ok: true, skills: rows.filter((row) => row.skill_id !== skill_id) };
  }
  if (rows.length >= MAX_REQUIRED_SKILLS) return { ok: false, error: SKILL_CAP_ERROR };
  return {
    ok: true,
    skills: [
      ...rows,
      { skill_id, required_level: DEFAULT_REQUIRED_LEVEL, source: "RECRUITER" },
    ],
  };
}

/**
 * Accepting what the requirement lines named.
 *
 * A row the recruiter already carries is left exactly as it is — their level and
 * their source survive a second click of the same button. Either way the result
 * is a list the save will accept, so a long suggestion run cannot quietly push
 * the requisition past the ceiling the drawer already showed them.
 */
export function applySkillSuggestions(
  rows: readonly RequiredSkill[],
  suggestions: readonly { skill_id: string }[]
): RequiredSkillsRead {
  const carried = new Set(rows.map((row) => row.skill_id));
  const additions: RequiredSkill[] = [];
  for (const suggestion of suggestions) {
    if (carried.has(suggestion.skill_id)) continue;
    carried.add(suggestion.skill_id);
    additions.push({
      skill_id: suggestion.skill_id,
      required_level: DEFAULT_REQUIRED_LEVEL,
      source: "CATALOGUE_MATCH",
    });
  }
  if (rows.length + additions.length > MAX_REQUIRED_SKILLS) {
    return { ok: false, error: SKILL_CAP_ERROR };
  }
  return { ok: true, skills: [...rows, ...additions] };
}

/**
 * Whether a save has anything to write.
 *
 * Order-insensitive and keyed on all three columns: the drawer keeps the rows in
 * the order they were added, the read returns them in the order the database
 * stored, and a list that agrees on every skill, level and source is the same
 * list — which is what spares a recruiter who edited only the title a write and
 * a trail row that says they changed the skills.
 */
export function sameRequiredSkills(
  a: readonly RequiredSkill[],
  b: readonly RequiredSkill[]
): boolean {
  if (a.length !== b.length) return false;
  const key = (row: RequiredSkill) => `${row.skill_id}|${row.required_level}|${row.source}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeForPhrase(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The spellings a catalogue name is found under: itself, itself without a
 * parenthetical qualifier, and either half of a name that lists alternatives.
 *
 * Derived from the characters the catalogue actually uses, never from a table of
 * near-synonyms the portal invented.
 */
function aliasesOf(name: string): string[] {
  const plain = normalize(name);
  const withoutQualifier = normalize(plain.replace(/\([^)]*\)/g, " "));
  const halves = plain
    .split("/")
    .map((part) => normalize(part.replace(/\([^)]*\)/g, " ")))
    .filter(Boolean);
  return [...new Set([plain, withoutQualifier, ...halves])].filter((alias) => alias.length > 1);
}

function phraseIn(phrase: string, line: string): boolean {
  // Word boundaries on letters and digits only, so "ats" is found in "ATS / HRIS
  // tooling" and in "ats experience" but never inside "formats".
  const pattern = new RegExp(`(?<![0-9a-z])${escapeForPhrase(phrase)}(?![0-9a-z])`, "i");
  return pattern.test(line);
}

/**
 * Which catalogue skills the requirement lines themselves name.
 *
 * One entry per skill, quoting the first line that said it, in catalogue order so
 * two recruiters editing the same opening see the same chips in the same order.
 */
export function suggestSkillsFromRequirements(
  lines: readonly string[],
  catalogue: readonly CatalogueSkill[]
): { skill_id: string; name: string; line: string }[] {
  const text = lines
    .map((line) => ({ raw: line, flat: normalize(line) }))
    .filter((entry) => entry.flat.length > 0);
  const found: { skill_id: string; name: string; line: string }[] = [];

  for (const skill of catalogue) {
    const aliases = aliasesOf(skill.name);
    if (!aliases.length) continue;
    const hit = text.find((entry) => aliases.some((alias) => phraseIn(alias, entry.flat)));
    if (hit) found.push({ skill_id: skill.id, name: skill.name, line: hit.raw });
  }

  return found;
}

/**
 * What a reader of the CV said the candidate showed, kept only as far as the
 * catalogue and the scale allow.
 *
 * `raw` is a model's answer rather than a form's, so the only useful property is
 * whether its name is one the catalogue holds: `candidate_skills.skill_id` is a
 * foreign key, and a row for a skill nobody seeded can be neither displayed nor
 * removed by anyone. The spellings accepted are the catalogue's own — the same
 * `aliasesOf` set the requirement-line matcher uses, never a synonym table.
 *
 * A level is rounded and clamped to the scale instead of refused, because the
 * cost of a loose number here is the loss of a person's evidence: dropping a "7"
 * would say the CV showed nothing, which is not what the CV showed. A value that
 * is not a number at all says nothing about a level either, and is dropped.
 */
export function readDemonstratedSkills(
  raw: unknown,
  catalogue: readonly CatalogueSkill[]
): DemonstratedSkill[] {
  if (!Array.isArray(raw)) return [];

  const idByAlias = new Map<string, string>();
  for (const skill of catalogue) {
    for (const alias of aliasesOf(skill.name)) {
      if (!idByAlias.has(alias)) idByAlias.set(alias, skill.id);
    }
  }

  const strongest = new Map<string, number>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.skill !== "string") continue;
    const skill_id = idByAlias.get(normalize(entry.skill));
    if (!skill_id) continue;
    const level = demonstratedLevelOf(entry.level);
    if (level === null) continue;
    strongest.set(skill_id, Math.max(strongest.get(skill_id) ?? 0, level));
  }

  return [...strongest].map(([skill_id, proficiency]) => ({ skill_id, proficiency }));
}

/** The mark on the scale a loose answer means, or null when it means no mark. */
function demonstratedLevelOf(value: unknown): number | null {
  const given = typeof value === "string" ? Number(value) : value;
  if (typeof given !== "number" || !Number.isFinite(given)) return null;
  return Math.min(MAX_SKILL_LEVEL, Math.max(MIN_SKILL_LEVEL, Math.round(given)));
}

/** The best level recorded for one skill, or null when nothing was. */
function demonstratedLevel(rows: readonly DemonstratedSkill[], skill_id: string): number | null {
  const levels = rows
    .filter((row) => row.skill_id === skill_id && isWholeLevel(row.proficiency))
    .map((row) => row.proficiency as number)
    .filter((level) => level >= MIN_SKILL_LEVEL && level <= MAX_SKILL_LEVEL);
  return levels.length ? Math.max(...levels) : null;
}

/**
 * Each required skill beside what this application has shown of it.
 *
 * The requisition's order is kept, and a skill that is not in the catalogue keeps
 * its id as its label rather than being dropped: a row the database holds is a row
 * the recruiter has to be able to see and remove, even after the catalogue entry
 * behind it was retired.
 */
export function matchRequiredSkills(
  required: readonly RequiredSkill[],
  demonstrated: readonly DemonstratedSkill[],
  catalogue: readonly CatalogueSkill[]
): SkillMatchLine[] {
  const names = new Map(catalogue.map((skill) => [skill.id, skill.name]));
  return required.map((row) => {
    const level = demonstratedLevel(demonstrated, row.skill_id);
    return {
      skill_id: row.skill_id,
      name: names.get(row.skill_id) ?? row.skill_id,
      required_level: row.required_level,
      demonstrated_level: level,
      evidence: level === null ? "no_evidence" : level >= row.required_level ? "meets" : "below",
    };
  });
}

export function skillMatchSummary(lines: readonly SkillMatchLine[]): {
  required: number;
  meets: number;
  below: number;
  unevidenced: number;
} {
  return {
    required: lines.length,
    meets: lines.filter((line) => line.evidence === "meets").length,
    below: lines.filter((line) => line.evidence === "below").length,
    unevidenced: lines.filter((line) => line.evidence === "no_evidence").length,
  };
}

/**
 * What the applicants drawer prints for one candidate, or "" when there is nothing
 * to say.
 *
 * With no recorded skill at all the sentence is about the record, not the person:
 * calling an unread CV a list of gaps is exactly the invention this portal has
 * already had to take back twice.
 */
export function skillMatchSentence(lines: readonly SkillMatchLine[]): string {
  const { required, meets, below, unevidenced } = skillMatchSummary(lines);
  if (required === 0) return "";
  if (meets + below === 0) {
    return `No skill evidence recorded yet — this opening lists ${required} required skills.`;
  }
  return `Meets ${meets} of ${required}, below ${below}, no evidence for ${unevidenced}.`;
}

/** The file that adds the table, applied on this database. */
export const OPENING_SKILLS_MIGRATION = "db/migrations/037_opening_skills.sql";

/** What a screen says on a database that predates it. */
export const OPENING_SKILLS_SCHEMA_NOTE =
  `Requisitions cannot carry a skill list on this database yet — ${OPENING_SKILLS_MIGRATION} is authored but not applied, so job_opening_skills has no rows to read or write.`;

/** What a write that named skills is told on a database where the table is absent. */
export const OPENING_SKILLS_WRITE_REFUSAL =
  `This opening's skill list could not be saved: ${OPENING_SKILLS_MIGRATION} is authored but not applied, so job_opening_skills does not exist yet. Save the rest of the opening and record the skills once the file is applied.`;
