/**
 * Shared pipeline stages.
 *
 * Lives outside `actions.ts` because a `"use server"` module may only export
 * async functions — plain data has to sit in a normal module that both the
 * server action and the client component can import.
 */

export interface StageDefinition {
  key: string;
  label: string;
}

export const STAGES: StageDefinition[] = [
  { key: "NEW", label: "Application" },
  { key: "AI_SCREENING", label: "AI screening" },
  { key: "ASSESSMENT", label: "Assessment" },
  { key: "INTERVIEW", label: "Interview" },
  { key: "OFFER", label: "Offer" },
  { key: "HIRED", label: "Hired" },
];

export const STAGE_KEYS: string[] = STAGES.map((stage) => stage.key);

/** Index of a stage in the pipeline, or -1 when unknown. */
export function stageIndex(stage: string): number {
  return STAGE_KEYS.indexOf(stage);
}