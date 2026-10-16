/**
 * The sourcing pool's bound and its ladder, in a module neither side owns.
 *
 * The read that ships the list and the rails that have to explain it sit on
 * opposite sides of the server/client line, so a literal kept by each is one
 * edit away from a number that lies — and a `"use server"` file cannot export
 * a constant at all. The board's stage wording lived here for the same reason
 * the trail quotes it: a rail that says "Applied" while a trail row says
 * "CONVERTED" reads backwards to whoever is reconciling the two.
 */

/** How many prospects one render ships. A window into the pool, not the pool. */
export const POOL_LIMIT = 500;

/**
 * How far an import looks for a prospect it is about to add.
 *
 * Only the email half of the check needs this window: a repeated profile link is
 * refused by `sourced_prospects_linkedin_key` no matter where the older row sits,
 * while an email match is only found inside the newest `DEDUPE_WINDOW` records.
 * Both facts belong to whoever is promising a list will not be duplicated, which
 * is why the number lives here rather than inside the action that uses it.
 */
export const DEDUPE_WINDOW = 5000;

/** Sourcing ladder — see the `stage` check constraint in migration 017. */
export const PROSPECT_STAGES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERVIEW",
  "CONVERTED",
  "PASSED",
] as const;

export type ProspectStage = (typeof PROSPECT_STAGES)[number];

/** What the board calls a stage, in the recruiter's words. */
export const STAGE_WORDS: Record<ProspectStage, string> = {
  NEW: "Not contacted",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  INTERVIEW: "Interview",
  CONVERTED: "Applied",
  PASSED: "Passed",
};

export function stageWord(stage: string): string {
  return STAGE_WORDS[stage as ProspectStage] ?? stage;
}

/**
 * A `?stage=` parameter, or nothing.
 *
 * The rails filter the *query*, so the value arrives from the browser and has to
 * be refused rather than trusted: a parameter naming no stage narrows nothing
 * instead of silently emptying the board.
 */
export function isProspectStage(value: unknown): ProspectStage | null {
  return typeof value === "string" && (PROSPECT_STAGES as readonly string[]).includes(value)
    ? (value as ProspectStage)
    : null;
}

/** Counts the database gave, so they describe the pool rather than a slice. */
export type PoolCounts = Record<ProspectStage, number>;

export interface ProspectPoolTotals {
  /** Every prospect in the pool, live or not. */
  total: number;
  byStage: PoolCounts;
  /** Rows this render actually holds — never more than `POOL_LIMIT`. */
  loaded: number;
  limit: number;
}
