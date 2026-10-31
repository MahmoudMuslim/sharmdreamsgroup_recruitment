import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewRecommendations,
  selectWithinBudget,
  summarizeSelection,
} from "../src/modules/assessment/domain/testRecommendations.ts";

const requirements = [
  { id: "r-service", text: "Resolve guest complaints" },
  { id: "r-safety", text: "Follow emergency procedures" },
  { id: "r-language", text: "Communicate in English" },
];
const suites = [
  {
    id: "suite-service",
    name: "Guest service",
    description: "Description-only claims about emergency procedures",
    durationMinutes: 20,
    questions: [
      {
        id: "q-service",
        title: "Title-only claims about emergency procedures",
        prompt: "Explain how you would\n  resolve a guest complaint\tand document the outcome.",
      },
      {
        id: "q-language",
        title: "Guest conversation",
        prompt: "Write a clear English response to the guest requesting assistance.",
      },
    ],
  },
  {
    id: "suite-safety",
    name: "Safety procedures",
    description: "Emergency response assessment",
    durationMinutes: 10,
    questions: [
      {
        id: "q-safety",
        title: "Emergency response",
        prompt: "Describe the emergency evacuation procedure for a hotel fire.",
      },
    ],
  },
];
const serviceEvidence = {
  requirementId: "r-service",
  questionId: "q-service",
  quote: "resolve a guest complaint",
  explanation: "Asks the candidate to describe complaint handling.",
};
const safetyEvidence = {
  requirementId: "r-safety",
  questionId: "q-safety",
  quote: "emergency evacuation procedure",
  explanation: "Asks the candidate to describe an emergency procedure.",
};
const languageEvidence = {
  requirementId: "r-language",
  questionId: "q-language",
  quote: "Write a clear English response",
  explanation: "Requests an English response.",
};
const payload = (evidence = [serviceEvidence]) => ({
  recommendations: [{ suiteId: "suite-service", evidence }],
});
const selections = [
  {
    id: "suite-service",
    name: "Guest service",
    durationMinutes: 20,
    evidence: [{ ...serviceEvidence, questionTitle: "Guest complaint" }],
  },
  {
    id: "suite-safety",
    name: "Safety procedures",
    durationMinutes: 10,
    evidence: [{ ...safetyEvidence, questionTitle: "Emergency response" }],
  },
];

for (const [label, parsed] of [
  ["null", null],
  ["undefined", undefined],
  ["array", []],
  ["string", "{\"recommendations\":[]}"],
  ["number", 3],
  ["missing recommendations", {}],
  ["null recommendations", { recommendations: null }],
  ["object recommendations", { recommendations: {} }],
]) {
  test(`review throws Error for top-level ${label}`, () => {
    assert.throws(() => reviewRecommendations(parsed, requirements, suites), Error);
  });
}

test("review accepts an empty recommendations array", () => {
  assert.deepEqual(reviewRecommendations({ recommendations: [] }, requirements, suites), {
    recommendations: [],
    rejected: 0,
  });
});

test("review uses catalogue metadata and ignores model scores and totals", () => {
  const parsed = {
    totalMinutes: 1,
    matchedRequirementIds: ["r-safety"],
    recommendations: [{
      suiteId: "suite-service",
      id: "forged-id",
      name: "Forged suite",
      durationMinutes: 1,
      score: 100,
      evidence: [{ ...serviceEvidence, questionTitle: "Forged title", score: 100 }],
    }],
  };
  assert.deepEqual(reviewRecommendations(parsed, requirements, suites), {
    recommendations: [{
      id: "suite-service",
      name: "Guest service",
      durationMinutes: 20,
      evidence: [{
        requirementId: "r-service",
        questionId: "q-service",
        questionTitle: "Title-only claims about emergency procedures",
        quote: "resolve a guest complaint",
        explanation: "Asks the candidate to describe complaint handling.",
      }],
    }],
    rejected: 0,
  });
});

test("review normalizes whitespace on both quote and prompt before exact matching", () => {
  const result = reviewRecommendations(payload([{
    ...serviceEvidence,
    quote: "  would\tresolve\n a  guest complaint and  ",
    explanation: "  Describes complaint handling.  ",
  }]), requirements, suites);
  assert.equal(result.rejected, 0);
  assert.equal(result.recommendations[0]?.evidence[0]?.quote, "would resolve a guest complaint and");
  assert.equal(result.recommendations[0]?.evidence[0]?.explanation, "Describes complaint handling.");
});

test("review rejects other-suite questions, fabricated quotes, titles and descriptions", () => {
  const result = reviewRecommendations(payload([
    safetyEvidence,
    { ...serviceEvidence, quote: suites[0].questions[0].title },
    { ...serviceEvidence, quote: suites[0].description },
    { ...serviceEvidence, quote: "resolve all guest complaints" },
    { ...serviceEvidence, quote: "Resolve a guest complaint" },
    { ...serviceEvidence, quote: "resolve a guest complaint ... document the outcome" },
    serviceEvidence,
  ]), requirements, suites);
  assert.equal(result.rejected, 6);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].evidence.length, 1);
});

test("review looks up a shared question ID inside the exact recommended suite", () => {
  const catalogue = [suites[0], {
    ...suites[1],
    questions: [{ ...suites[1].questions[0], id: "q-service" }],
  }];
  assert.deepEqual(reviewRecommendations(payload([{
    ...safetyEvidence, questionId: "q-service",
  }]), requirements, catalogue), { recommendations: [], rejected: 1 });
});

test("review drops malformed rows and unknown or nonstring suite IDs once per row", () => {
  const result = reviewRecommendations({ recommendations: [
    null, [], "suite-service", {},
    { suiteId: "missing", evidence: [serviceEvidence] },
    { suiteId: 1, evidence: [serviceEvidence] },
    { suiteId: { id: "suite-service" }, evidence: [serviceEvidence] },
    { suiteId: "suite-service", evidence: null },
    { suiteId: "suite-service", evidence: {} },
    { suiteId: "suite-service" },
    { suiteId: "__proto__", evidence: [serviceEvidence] },
    { suiteId: "constructor", evidence: [serviceEvidence] },
    { suiteId: "suite-service", evidence: [serviceEvidence] },
  ] }, requirements, suites);
  assert.equal(result.rejected, 12);
  assert.deepEqual(result.recommendations.map((suite) => suite.id), ["suite-service"]);
});

test("review drops malformed evidence without losing a valid sibling", () => {
  const result = reviewRecommendations(payload([
    null, [], false, "evidence", {},
    { ...serviceEvidence, requirementId: "missing" },
    { ...serviceEvidence, requirementId: 3 },
    { ...serviceEvidence, requirementId: ["r-service"] },
    { ...serviceEvidence, requirementId: "__proto__" },
    { ...serviceEvidence, questionId: "missing" },
    { ...serviceEvidence, questionId: 3 },
    { ...serviceEvidence, questionId: ["q-service"] },
    { ...serviceEvidence, questionId: "constructor" },
    { ...serviceEvidence, quote: 123 },
    { ...serviceEvidence, quote: null },
    { ...serviceEvidence, explanation: 123 },
    { ...serviceEvidence, explanation: null },
    { ...serviceEvidence, explanation: " \n\t " },
    serviceEvidence,
  ]), requirements, suites);
  assert.equal(result.rejected, 18);
  assert.equal(result.recommendations[0]?.evidence.length, 1);
});

for (const [length, accepted] of [[11, false], [12, true], [600, true], [601, false]]) {
  test(`review enforces normalized quote length ${length}`, () => {
    const catalogue = [{
      ...suites[0],
      questions: [{ ...suites[0].questions[0], prompt: "x".repeat(601) }],
    }];
    const result = reviewRecommendations(payload([{
      ...serviceEvidence, quote: ` \n${"x".repeat(length)}\t `,
    }]), requirements, catalogue);
    assert.equal(result.rejected, accepted ? 0 : 1);
    assert.equal(result.recommendations.length, accepted ? 1 : 0);
  });
}

for (const [length, accepted] of [[600, true], [601, false]]) {
  test(`review enforces explanation length ${length}`, () => {
    const result = reviewRecommendations(payload([{
      ...serviceEvidence, explanation: "x".repeat(length),
    }]), requirements, suites);
    assert.equal(result.rejected, accepted ? 0 : 1);
    assert.equal(result.recommendations.length, accepted ? 1 : 0);
  });
}

test("review excludes suites with empty or entirely invalid evidence", () => {
  assert.deepEqual(reviewRecommendations({ recommendations: [
    { suiteId: "suite-service", evidence: [] },
    { suiteId: "suite-safety", evidence: [serviceEvidence] },
  ] }, requirements, suites), { recommendations: [], rejected: 1 });
});

test("review cannot suggest coverage without supplied requirements or suites", () => {
  assert.deepEqual(reviewRecommendations(payload(), [], suites), { recommendations: [], rejected: 1 });
  assert.deepEqual(reviewRecommendations(payload(), requirements, []), { recommendations: [], rejected: 1 });
});

test("review merges duplicate suite rows and keeps the first valid evidence per pair", () => {
  const result = reviewRecommendations({ recommendations: [
    { suiteId: "suite-service", evidence: [
      { ...serviceEvidence, quote: "fabricated text here" },
      serviceEvidence,
      { ...serviceEvidence, explanation: "Later duplicate." },
    ] },
    { suiteId: "suite-service", evidence: [
      languageEvidence,
      { ...serviceEvidence, requirementId: "r-safety" },
      { ...languageEvidence, requirementId: "r-service" },
      serviceEvidence,
    ] },
  ] }, requirements, suites);
  assert.equal(result.rejected, 1);
  assert.equal(result.recommendations.length, 1);
  assert.deepEqual(result.recommendations[0].evidence.map((item) => [item.requirementId, item.questionId]), [
    ["r-service", "q-service"],
    ["r-language", "q-language"],
    ["r-safety", "q-service"],
    ["r-service", "q-language"],
  ]);
  assert.equal(result.recommendations[0].evidence[0].explanation, serviceEvidence.explanation);
});

test("review deduplication does not collide when IDs contain separators", () => {
  const catalogue = [{ ...suites[0], questions: [
    { ...suites[0].questions[0], id: "b:c" },
    { ...suites[0].questions[0], id: "c" },
  ] }];
  const result = reviewRecommendations(payload([
    { ...serviceEvidence, requirementId: "a", questionId: "b:c" },
    { ...serviceEvidence, requirementId: "a:b", questionId: "c" },
  ]), [{ id: "a", text: "First" }, { id: "a:b", text: "Second" }], catalogue);
  assert.equal(result.recommendations[0]?.evidence.length, 2);
  assert.equal(result.rejected, 0);
});

test("review ranks distinct requirements before duration, then name and ID independently of model rank", () => {
  const catalogue = [
    { ...suites[0], id: "many-questions", name: "A", durationMinutes: 1 },
    { ...suites[0], id: "broad", name: "Z", durationMinutes: 90 },
    { ...suites[0], id: "zeta", name: "Zeta", durationMinutes: 10 },
    { ...suites[0], id: "alpha-b", name: "Alpha", durationMinutes: 10 },
    { ...suites[0], id: "alpha-a", name: "Alpha", durationMinutes: 10 },
  ];
  const rows = [
    { suiteId: "many-questions", rank: 1, score: 100, evidence: [serviceEvidence, { ...languageEvidence, requirementId: "r-service" }] },
    { suiteId: "zeta", rank: 2, evidence: [serviceEvidence] },
    { suiteId: "alpha-b", rank: 3, evidence: [serviceEvidence] },
    { suiteId: "alpha-a", rank: 4, evidence: [serviceEvidence] },
    { suiteId: "broad", rank: 99, score: 0, evidence: [serviceEvidence, languageEvidence] },
  ];
  const expected = ["broad", "many-questions", "alpha-a", "alpha-b", "zeta"];
  assert.deepEqual(reviewRecommendations({ recommendations: rows }, requirements, catalogue).recommendations.map((suite) => suite.id), expected);
  assert.deepEqual(reviewRecommendations({ recommendations: [...rows].reverse() }, requirements, [...catalogue].reverse()).recommendations.map((suite) => suite.id), expected);
});

for (const durationMinutes of [0, -1, 1.5, NaN, Infinity, -Infinity, "20"]) {
  test(`review excludes invalid catalogue duration ${String(durationMinutes)} (${typeof durationMinutes})`, () => {
    assert.deepEqual(reviewRecommendations(payload(), requirements, [{ ...suites[0], durationMinutes }]), {
      recommendations: [], rejected: 1,
    });
  });
}

test("greedy selection includes suites fitting the budget exactly", () => {
  assert.deepEqual(selectWithinBudget(selections, 30), ["suite-service", "suite-safety"]);
  assert.deepEqual(selectWithinBudget(selections, 20), ["suite-service"]);
});

test("greedy selection skips an oversized first suite and considers later fits", () => {
  assert.deepEqual(selectWithinBudget(selections, 10), ["suite-safety"]);
  assert.deepEqual(selectWithinBudget(selections, 9), []);
});

test("greedy selection skips redundant suites but accepts partially new coverage", () => {
  const ranked = [
    selections[0],
    { ...selections[0], id: "redundant", durationMinutes: 1 },
    { ...selections[1], evidence: [...selections[0].evidence, ...selections[1].evidence] },
    { ...selections[1], id: "empty", durationMinutes: 1, evidence: [] },
  ];
  assert.deepEqual(selectWithinBudget(ranked, 100), ["suite-service", "suite-safety"]);
});

test("greedy selection follows ranked order rather than reordering to optimize coverage", () => {
  const ranked = [
    { ...selections[0], durationMinutes: 30 },
    { ...selections[1], durationMinutes: 10 },
    { ...selections[0], id: "language", durationMinutes: 10, evidence: [{ ...languageEvidence, questionTitle: "English" }] },
  ];
  assert.deepEqual(selectWithinBudget(ranked, 30), ["suite-service"]);
});

for (const budget of [0, -1, NaN, Infinity, -Infinity, "30", null, undefined]) {
  test(`greedy selection returns empty for invalid or zero budget ${String(budget)} (${typeof budget})`, () => {
    assert.deepEqual(selectWithinBudget(selections, budget), []);
  });
}

test("greedy selection supports finite fractional budgets without rounding up", () => {
  assert.deepEqual(selectWithinBudget(selections, 29.5), ["suite-service"]);
  assert.deepEqual(selectWithinBudget([], 30), []);
});

test("selection summary deduplicates IDs, ignores unknown IDs and counts real durations", () => {
  assert.deepEqual(summarizeSelection(requirements, selections, ["suite-safety", "missing", "suite-service", "suite-safety", "__proto__"], 30), {
    totalMinutes: 30,
    matchedRequirementIds: ["r-service", "r-safety"],
    gaps: [{ id: "r-language", text: "Communicate in English" }],
    overBudget: false,
  });
});

test("selection summary unions overlap and returns only supplied requirements in their order", () => {
  const rows = [{ ...selections[0], evidence: [
    { ...languageEvidence, questionTitle: "English" },
    ...selections[0].evidence,
    ...selections[0].evidence,
    { ...serviceEvidence, requirementId: "missing", questionTitle: "Unknown requirement" },
  ] }];
  assert.deepEqual(summarizeSelection(requirements, rows, ["suite-service"], 10), {
    totalMinutes: 20,
    matchedRequirementIds: ["r-service", "r-language"],
    gaps: [{ id: "r-safety", text: "Follow emergency procedures" }],
    overBudget: true,
  });
});

test("deselection reopens gaps and reduces duration below budget", () => {
  assert.equal(summarizeSelection(requirements, selections, ["suite-service", "suite-safety"], 20).overBudget, true);
  assert.deepEqual(summarizeSelection(requirements, selections, ["suite-safety"], 20), {
    totalMinutes: 10,
    matchedRequirementIds: ["r-safety"],
    gaps: [
      { id: "r-service", text: "Resolve guest complaints" },
      { id: "r-language", text: "Communicate in English" },
    ],
    overBudget: false,
  });
});

test("empty or unknown-only selection leaves every requirement as a gap", () => {
  for (const selectedIds of [[], ["missing"]]) {
    assert.deepEqual(summarizeSelection(requirements, selections, selectedIds, 0), {
      totalMinutes: 0,
      matchedRequirementIds: [],
      gaps: [
        { id: "r-service", text: "Resolve guest complaints" },
        { id: "r-safety", text: "Follow emergency procedures" },
        { id: "r-language", text: "Communicate in English" },
      ],
      overBudget: false,
    });
  }
  assert.deepEqual(summarizeSelection([], [], [], 0), {
    totalMinutes: 0, matchedRequirementIds: [], gaps: [], overBudget: false,
  });
});

test("manually selecting any suite exceeds a zero-minute budget", () => {
  assert.equal(summarizeSelection(requirements, selections, ["suite-safety"], 0).overBudget, true);
});

function freezeDeep(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

test("all three APIs leave frozen nested inputs unchanged", () => {
  const inputs = {
    requirements: structuredClone(requirements),
    suites: structuredClone(suites),
    parsed: { recommendations: [
      { suiteId: "suite-service", evidence: [serviceEvidence, serviceEvidence] },
      { suiteId: "suite-safety", evidence: [safetyEvidence] },
    ] },
    recommendations: structuredClone(selections),
    selectedIds: ["suite-service", "suite-service", "suite-safety"],
  };
  const before = structuredClone(inputs);
  freezeDeep(inputs);
  assert.deepEqual(reviewRecommendations(inputs.parsed, inputs.requirements, inputs.suites).recommendations.map((suite) => suite.id), ["suite-safety", "suite-service"]);
  assert.deepEqual(selectWithinBudget(inputs.recommendations, 30), ["suite-service", "suite-safety"]);
  assert.equal(summarizeSelection(inputs.requirements, inputs.recommendations, inputs.selectedIds, 30).totalMinutes, 30);
  assert.deepEqual(inputs, before);
});
