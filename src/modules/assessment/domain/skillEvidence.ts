/**
 * What a paper's rubric marks say about each catalogue skill.
 *
 * The input is snapshots: each response carries the criteria it was marked on,
 * including the skill tag that was on the criterion when the mark was given. The
 * output is arithmetic over those snapshots and nothing else — no catalogue
 * read, no `candidate_skills` write, and no conversion to a 1–5 level. A level is
 * a proficiency claim; a percentage here is a share of the marks the questions
 * actually offered.
 */

import { awardedCriteriaOf } from "./attemptAnswers.ts";

/** One criterion as the roll-up reads it — stored snapshot or test fixture. */
export interface SkillEvidenceCriterion {
  skill_id?: string | null;
  skill_name?: string | null;
  label: string;
  marks?: number | null;
  allowance?: number | null;
  evidence?: string | null;
}

/** One question-and-criterion that contributed to a skill's total. */
export interface SkillContribution {
  question_title: string;
  criterion_label: string;
  awarded: number | null;
  allowance: number | null;
  evidence: string | null;
}

export interface SkillEvidenceLine {
  skill_id: string;
  skill_name: string;
  /** Null when any contribution's marks are withheld or unreadable. */
  awarded: number | null;
  allowance: number | null;
  /** Whole number 0–100, or null while figures are withheld. */
  percent: number | null;
  /**
   * Distinct questions behind this line — not the number of criteria.
   *
   * Two criteria on one question, or a retake of one question on two papers,
   * produced one question's evidence; counting contributions would print "2
   * questions" for a single question's marks.
   */
  questionCount: number;
  /**
   * Papers behind this line — the population its total adds up.
   *
   * A retake is one question but two sittings, and the marks of both sittings are
   * summed; a paper carrying two criteria for the skill is still one sitting, and
   * a paper with no key is its own. When this is larger than `questionCount` the
   * line says so, because a figure totalled across sittings is not the same claim
   * as one totalled over distinct questions.
   */
  sittingCount: number;
  contributions: SkillContribution[];
}

export interface SkillEvidencePaper {
  title: string;
  /**
   * The question this paper is an answer to, when the caller knows it.
   *
   * Follow-up attempts let one application hold the same question twice, so the
   * count of questions is a count of distinct keys. A paper without a key cannot
   * be matched to another and therefore counts as its own question — the report
   * would rather over-count an unidentified paper than fold two questions into one.
   */
  key?: string | null;
  criteria: readonly SkillEvidenceCriterion[];
}

function taggedId(criterion: SkillEvidenceCriterion): string | null {
  return typeof criterion.skill_id === "string" && criterion.skill_id.trim()
    ? criterion.skill_id.trim()
    : null;
}

function snapshotName(criterion: SkillEvidenceCriterion): string {
  return typeof criterion.skill_name === "string" ? criterion.skill_name.trim() : "";
}

/** The paper's question identity, or null when the caller did not supply one. */
function paperKey(paper: SkillEvidencePaper): string | null {
  return typeof paper.key === "string" && paper.key.trim() ? paper.key.trim() : null;
}

/**
 * Add one figure, or lose the total.
 *
 * A missing or non-numeric mark means the snapshot cannot be totalled honestly —
 * a masked reviewer's row is exactly this. Returning null instead of skipping it
 * keeps a partial sum from being printed as a skill's whole evidence.
 */
function add(total: number | null, value: number | null | undefined): number | null {
  if (total === null || typeof value !== "number" || !Number.isFinite(value)) return null;
  return total + value;
}

export function rollUpSkillEvidence(
  papers: readonly SkillEvidencePaper[]
): SkillEvidenceLine[] {
  interface Group {
    skill_id: string;
    skill_name: string;
    awarded: number | null;
    allowance: number | null;
    contributions: SkillContribution[];
    /** Distinct question keys already counted for this skill. */
    keys: Set<string>;
    /** Contributing papers with no key; each is its own question. */
    keyless: number;
    /** Contributing papers, however many criteria or retakes they carry. */
    sittings: number;
  }

  const groups = new Map<string, Group>();
  for (const paper of papers) {
    const touched = new Set<string>();
    for (const criterion of paper.criteria) {
      const skillId = taggedId(criterion);
      if (!skillId) continue;
      const group: Group = groups.get(skillId) ?? {
        skill_id: skillId,
        skill_name: "",
        awarded: 0,
        allowance: 0,
        contributions: [],
        keys: new Set<string>(),
        keyless: 0,
        sittings: 0,
      };
      if (!group.skill_name) group.skill_name = snapshotName(criterion);
      group.awarded = add(group.awarded, criterion.marks);
      group.allowance = add(group.allowance, criterion.allowance);
      group.contributions.push({
        question_title: paper.title,
        criterion_label: criterion.label,
        awarded: typeof criterion.marks === "number" ? criterion.marks : null,
        allowance: typeof criterion.allowance === "number" ? criterion.allowance : null,
        evidence: typeof criterion.evidence === "string" && criterion.evidence.trim()
          ? criterion.evidence
          : null,
      });
      touched.add(skillId);
      groups.set(skillId, group);
    }

    // One paper is one question per skill however many criteria it carries, and a
    // key already counted is a second attempt at a question already counted. The
    // paper still counts as a sitting either way: its marks are in the total.
    const key = paperKey(paper);
    for (const skillId of touched) {
      const group = groups.get(skillId);
      if (!group) continue;
      group.sittings += 1;
      if (key) group.keys.add(key);
      else group.keyless += 1;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      skill_id: group.skill_id,
      skill_name: group.skill_name || group.skill_id,
      awarded: group.awarded,
      allowance: group.allowance,
      percent:
        group.awarded === null || group.allowance === null
          ? null
          : group.allowance > 0
            ? Math.round((group.awarded / group.allowance) * 100)
            : 0,
      questionCount: group.keys.size + group.keyless,
      sittingCount: group.sittings,
      contributions: group.contributions,
    }))
    .sort(
      (a, b) =>
        a.skill_name.localeCompare(b.skill_name, "en") ||
        a.skill_id.localeCompare(b.skill_id, "en")
    );
}

/** What the block covers, printed beside it so a partial paper never looks whole. */
export function skillEvidenceCoverage(papers: readonly SkillEvidencePaper[]): string {
  let criteria = 0;
  const keys = new Set<string>();
  let keyless = 0;
  let sittings = 0;
  for (const paper of papers) {
    const tagged = paper.criteria.filter((criterion) => taggedId(criterion) !== null).length;
    criteria += tagged;
    if (tagged === 0) continue;
    // The same identity rule the lines count by, so the two can never disagree
    // about how many questions a retake is. The paper still counts as a sitting:
    // every tagged mark it carries is in the total.
    sittings += 1;
    const key = paperKey(paper);
    if (key) keys.add(key);
    else keyless += 1;
  }
  const questions = keys.size + keyless;
  const across = sittings > questions ? ` across ${sittings} sittings` : "";
  // The applicant read aggregates several papers, so the noun follows the same
  // sittings figure the sentence already counted.
  const paper = sittings === 1 ? "this paper" : "these papers";
  return `From ${criteria} tagged ${criteria === 1 ? "criterion" : "criteria"} on ${questions} ${
    questions === 1 ? "question" : "questions"
  }${across}. A percentage is evidence from ${paper}, not a proficiency level.`;
}

/** The applicant line: the test figure is additive beside the CV's own levels. */
export interface SkillEvidenceContext {
  required_level?: number | null;
  demonstrated_level?: number | null;
  /**
   * True when a null percentage means "withheld from this reviewer" rather than
   * "no figure on file". A masked figure and an unreadable one are different
   * claims, and only the caller knows which it is holding.
   */
  figures_withheld?: boolean;
}

export function skillEvidenceSentence(
  line: SkillEvidenceLine,
  context: SkillEvidenceContext = {}
): string {
  const parts = [line.skill_name];
  if (context.required_level !== null && context.required_level !== undefined) {
    parts.push(`required ${context.required_level}`);
  }
  if (context.demonstrated_level !== null && context.demonstrated_level !== undefined) {
    parts.push(`shown ${context.demonstrated_level}`);
  }
  const count = `${line.questionCount} ${
    line.questionCount === 1 ? "question" : "questions"
  }${line.sittingCount > line.questionCount ? ` across ${line.sittingCount} sittings` : ""}`;
  parts.push(
    // Withheld wins over a figure: a caller holding a stale percentage beside a
    // fresh mask must still never print the number.
    context.figures_withheld
      ? `test evidence Hidden (${count})`
      : line.percent !== null
        ? `test evidence ${line.percent}% (${count})`
        : `test evidence no mark on file (${count})`
  );
  return parts.join(" · ");
}

/** One row of the applicant's bounded read, turned into a paper the roll-up reads. */
export interface SkillEvidenceSource {
  question_id: string | null;
  question_title: string | null;
  ai_evaluation: { criteria?: unknown } | null;
}

export function skillEvidencePapers(
  sources: readonly SkillEvidenceSource[],
  masked: boolean
): SkillEvidencePaper[] {
  return sources.map((source) => ({
    key: source.question_id,
    title: source.question_title ?? "Assessment question",
    criteria: awardedCriteriaOf(source.ai_evaluation, masked),
  }));
}
