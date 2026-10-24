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
  contributions: SkillContribution[];
}

export interface SkillEvidencePaper {
  title: string;
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
  }

  const groups = new Map<string, Group>();
  for (const paper of papers) {
    for (const criterion of paper.criteria) {
      const skillId = taggedId(criterion);
      if (!skillId) continue;
      const group: Group = groups.get(skillId) ?? {
        skill_id: skillId,
        skill_name: "",
        awarded: 0,
        allowance: 0,
        contributions: [],
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
      groups.set(skillId, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      skill_name: group.skill_name || group.skill_id,
      percent:
        group.awarded === null || group.allowance === null
          ? null
          : group.allowance > 0
            ? Math.round((group.awarded / group.allowance) * 100)
            : 0,
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
  let questions = 0;
  for (const paper of papers) {
    const tagged = paper.criteria.filter((criterion) => taggedId(criterion) !== null).length;
    criteria += tagged;
    if (tagged > 0) questions += 1;
  }
  return `From ${criteria} tagged ${criteria === 1 ? "criterion" : "criteria"} on ${questions} ${
    questions === 1 ? "question" : "questions"
  }. A percentage is evidence from this paper, not a proficiency level.`;
}

/** The applicant line: the test figure is additive beside the CV's own levels. */
export interface SkillEvidenceContext {
  required_level?: number | null;
  demonstrated_level?: number | null;
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
  const count = `${line.contributions.length} ${
    line.contributions.length === 1 ? "question" : "questions"
  }`;
  parts.push(
    line.percent === null
      ? `test evidence Hidden (${count})`
      : `test evidence ${line.percent}% (${count})`
  );
  return parts.join(" · ");
}

/** One row of the applicant's bounded read, turned into a paper the roll-up reads. */
export interface SkillEvidenceSource {
  question_title: string | null;
  ai_evaluation: { criteria?: unknown } | null;
}

export function skillEvidencePapers(
  sources: readonly SkillEvidenceSource[],
  masked: boolean
): SkillEvidencePaper[] {
  return sources.map((source) => ({
    title: source.question_title ?? "Assessment question",
    criteria: awardedCriteriaOf(source.ai_evaluation, masked),
  }));
}
