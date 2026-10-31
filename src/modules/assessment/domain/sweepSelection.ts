/**
 * Which submitted papers a re-grade sweep may visit.
 *
 * A paper whose answers all carry a mark needs no model — the engine's finalize
 * step closes it — so it is visited whether or not AI is available. A finalize
 * write that failed after the last mark leaves such a paper stuck in SUBMITTED,
 * and this is the only pass that looks for it.
 *
 * A paper with open answers is visited only while a model is configured, and
 * only if at least one of those answers is still worth sending. An answer the
 * engine parked for a person — no speech, a recording too large to transcribe,
 * no transcription key — is not retried here: a five-minute sweep that paid for
 * the same impossible call and wrote the same note again would bury the trail
 * rather than finish the paper. A recruiter can still offer it to the engine
 * from the report's button.
 *
 * A paper with no stored answers is never finished by a pass, so it is never
 * selected.
 */
export interface SweepResponse {
  score: number | null;
  ai_evaluation?: { parked?: boolean } | null;
}

export interface SweepCandidate {
  id: string;
  candidate_responses: readonly SweepResponse[] | null;
}

export function sweepCandidates(
  rows: readonly SweepCandidate[],
  aiReady: boolean
): string[] {
  const ids = rows
    .filter((row) => {
      const answers = row.candidate_responses ?? [];
      if (answers.length === 0) return false;
      if (answers.every((answer) => answer.score !== null)) return true;
      return (
        aiReady &&
        answers.some(
          (answer) => answer.score === null && answer.ai_evaluation?.parked !== true
        )
      );
    })
    .map((row) => row.id);

  return [...new Set(ids)];
}
