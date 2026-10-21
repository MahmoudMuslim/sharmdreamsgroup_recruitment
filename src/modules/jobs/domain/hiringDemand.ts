/**
 * Hiring demand for one opening: the target, and who sits in the funnel now.
 *
 * The portal could always count applicants; what it could not say was whether a
 * count meant a role was full or still empty, because nothing recorded how many
 * people the requisition wanted. #255 pairs the `positions_needed` target with two
 * stage-grouped counts so a recruiter reads a gap, not just a tally.
 *
 * Pure by design — no database, no `server-only` — so the grid, the page read and a
 * probe all describe the same set with the same words.
 *
 * These counts are populations at an instant, not movements: "5 in pipeline" is who
 * holds one of those stages right now, and "2 hired" is who sits in HIRED right now.
 * Nothing here is a conversion, a velocity or a rate — the stage figures never
 * describe a transition, only a position (see the pipeline-counts rule).
 */

/**
 * The stages that are still being worked — a person sits here only if a decision
 * is owed. `HIRED` and `REJECTED` are terminal and counted separately (or not at
 * all), so the in-pipeline set is everything else a candidate can rest in without
 * the role having stopped hiring for them.
 *
 * Mirrors the `application_stage` enum in `db/schema.sql`; a fifth active
 * stage added there has to be added here too, or a real person is counted as
 * neither in-pipeline nor hired.
 */
export const IN_PIPELINE_STAGES = [
  "NEW",
  "AI_SCREENING",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
] as const;

/** The one terminal stage that means the seat is filled. */
export const HIRED_STAGE = "HIRED";

/** The demand a grid reads for one opening — three numbers, each nullable-safe. */
export interface HiringDemand {
  /** The `positions_needed` target, or null when no target was recorded (or the
   * column is not applied yet). Never invented and never defaulted to 0. */
  needed: number | null;
  /** Applicants still in `IN_PIPELINE_STAGES` and not archived. */
  inPipeline: number;
  /** Applicants in HIRED and not archived. */
  hired: number;
}

/** How many seats the target still wants, or null when there is no target to subtract. */
export function seatsStillToFill(demand: HiringDemand): number | null {
  if (demand.needed === null) return null;
  return Math.max(0, demand.needed - demand.hired);
}

/**
 * The one-line demand sentence a card prints.
 *
 * When a target is recorded it leads with the gap so the recruiter sees the
 * shortfall first; when it is not, it says so plainly rather than showing "0
 * still to fill" for a role nobody set a headcount on. The pipeline and hire
 * figures are always named as what they are — who sits in each set now.
 */
export function demandLine(demand: HiringDemand): string {
  const stillToFill = seatsStillToFill(demand);
  if (demand.needed === null) {
    return `${demand.inPipeline} in pipeline · ${demand.hired} hired · no target set`;
  }
  const remaining =
    stillToFill === 0 ? "target met" : `${stillToFill} still to fill`;
  return `needs ${demand.needed} · ${demand.inPipeline} in pipeline · ${demand.hired} hired · ${remaining}`;
}

/**
 * Said on the grid when the headcount target could not be read at all.
 *
 * A missing column and an unset target look the same to the card ("no target
 * set"), so when the read failed rather than came back empty the grid says which
 * it is — otherwise a recruiter is told every role lacks a target when the truth
 * is the demand column is not there yet.
 */
export function demandUnavailableNote(): string {
  return "The headcount target could not be read, so only the pipeline and hire counts are shown.";
}
