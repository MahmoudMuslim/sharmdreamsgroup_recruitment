export interface RecommendationRequirement {
  id: string;
  text: string;
}

export interface RecommendationQuestion {
  id: string;
  title: string;
  prompt: string;
}

export interface RecommendationSuite {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  questions: RecommendationQuestion[];
}

export interface RecommendationEvidence {
  requirementId: string;
  questionId: string;
  questionTitle: string;
  quote: string;
  explanation: string;
}

export interface RecommendedSuite {
  id: string;
  name: string;
  durationMinutes: number;
  evidence: RecommendationEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function reviewRecommendations(
  parsed: unknown,
  requirements: RecommendationRequirement[],
  suites: RecommendationSuite[]
): { recommendations: RecommendedSuite[]; rejected: number } {
  if (!isRecord(parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error("Expected an object containing a recommendations array.");
  }

  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const suitesById = new Map(suites.map((suite) => [suite.id, suite]));
  const reviewed = new Map<string, {
    recommendation: RecommendedSuite;
    evidenceKeys: Set<string>;
  }>();
  let rejected = 0;

  for (const row of parsed.recommendations) {
    if (!isRecord(row) || typeof row.suiteId !== "string" || !Array.isArray(row.evidence)) {
      rejected++;
      continue;
    }
    const suite = suitesById.get(row.suiteId);
    if (!suite || !Number.isInteger(suite.durationMinutes) || suite.durationMinutes <= 0) {
      rejected++;
      continue;
    }

    let entry = reviewed.get(suite.id);
    if (!entry) {
      entry = {
        recommendation: {
          id: suite.id,
          name: suite.name,
          durationMinutes: suite.durationMinutes,
          evidence: [],
        },
        evidenceKeys: new Set(),
      };
      reviewed.set(suite.id, entry);
    }

    for (const evidence of row.evidence) {
      if (
        !isRecord(evidence) ||
        typeof evidence.requirementId !== "string" ||
        !requirementIds.has(evidence.requirementId) ||
        typeof evidence.questionId !== "string" ||
        typeof evidence.quote !== "string" ||
        typeof evidence.explanation !== "string" ||
        evidence.explanation.length > 600 ||
        !evidence.explanation.trim()
      ) {
        rejected++;
        continue;
      }
      const question = suite.questions.find((item) => item.id === evidence.questionId);
      const quote = normalizeWhitespace(evidence.quote);
      if (
        !question ||
        quote.length < 12 ||
        quote.length > 600 ||
        !normalizeWhitespace(question.prompt).includes(quote)
      ) {
        rejected++;
        continue;
      }

      const key = JSON.stringify([evidence.requirementId, evidence.questionId]);
      if (entry.evidenceKeys.has(key)) continue;
      entry.evidenceKeys.add(key);
      entry.recommendation.evidence.push({
        requirementId: evidence.requirementId,
        questionId: question.id,
        questionTitle: question.title,
        quote,
        explanation: evidence.explanation.trim(),
      });
    }
  }

  const recommendations = [...reviewed.values()]
    .map((entry) => entry.recommendation)
    .filter((suite) => suite.evidence.length > 0);
  recommendations.sort((left, right) =>
    new Set(right.evidence.map((item) => item.requirementId)).size -
      new Set(left.evidence.map((item) => item.requirementId)).size ||
    left.durationMinutes - right.durationMinutes ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
  return { recommendations, rejected };
}

export function selectWithinBudget(
  recommendations: RecommendedSuite[],
  budgetMinutes: number
): string[] {
  if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) return [];

  const selectedIds: string[] = [];
  const matchedIds = new Set<string>();
  let totalMinutes = 0;
  for (const suite of recommendations) {
    if (totalMinutes + suite.durationMinutes > budgetMinutes) continue;
    if (!suite.evidence.some((item) => !matchedIds.has(item.requirementId))) continue;
    selectedIds.push(suite.id);
    totalMinutes += suite.durationMinutes;
    suite.evidence.forEach((item) => matchedIds.add(item.requirementId));
  }
  return selectedIds;
}

export function summarizeSelection(
  requirements: RecommendationRequirement[],
  recommendations: RecommendedSuite[],
  selectedIds: string[],
  budgetMinutes: number
): {
  totalMinutes: number;
  matchedRequirementIds: string[];
  gaps: RecommendationRequirement[];
  overBudget: boolean;
} {
  const suitesById = new Map(recommendations.map((suite) => [suite.id, suite]));
  const matchedIds = new Set<string>();
  let totalMinutes = 0;
  for (const id of new Set(selectedIds)) {
    const suite = suitesById.get(id);
    if (!suite) continue;
    totalMinutes += suite.durationMinutes;
    suite.evidence.forEach((item) => matchedIds.add(item.requirementId));
  }
  return {
    totalMinutes,
    matchedRequirementIds: requirements
      .filter((requirement) => matchedIds.has(requirement.id))
      .map((requirement) => requirement.id),
    gaps: requirements.filter((requirement) => !matchedIds.has(requirement.id)),
    overBudget: totalMinutes > budgetMinutes,
  };
}
