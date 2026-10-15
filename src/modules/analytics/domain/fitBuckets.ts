/**
 * The AI fit-score bands the dashboard charts, filters and drills down on.
 *
 * Stored as bounds rather than parsed out of the label, so the distribution
 * card, the board filter and the drill-down query cannot disagree about a score
 * sitting on an edge — or a fractional one, since `ai_match_score` is numeric.
 */
export const FIT_BUCKETS: { range: string; min: number; upper: number | null }[] = [
  { range: "0–49", min: 0, upper: 50 },
  { range: "50–79", min: 50, upper: 80 },
  { range: "80–100", min: 80, upper: null },
];

export function bucketFor(range: string) {
  return FIT_BUCKETS.find((bucket) => bucket.range === range) ?? null;
}

/** True when a score falls inside the named band. An unscored fit fits nothing. */
export function inBucket(range: string, score: number | null): boolean {
  const bucket = bucketFor(range);
  if (!bucket || score === null) return false;
  return score >= bucket.min && (bucket.upper === null || score < bucket.upper);
}

/** The PostgREST filters that read the same band straight out of the database. */
export function bucketBounds(range: string): { min: number; upper: number | null } | null {
  const bucket = bucketFor(range);
  return bucket ? { min: bucket.min, upper: bucket.upper } : null;
}
