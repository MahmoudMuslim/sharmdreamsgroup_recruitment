/**
 * The stage's geometry, in one file.
 *
 * The presence draws the orb and the conversation keeps room for it; a figure that
 * exists twice can disagree, and the disagreement is a transcript under a floating
 * circle. Everything here is CSS pixels, and every class a surface builds from it is
 * a literal, because Tailwind purges a class it would have to assemble at runtime.
 */

export const STAGE_ROUTE = "/assistant/stage";

/** The orb's canvas on the stage — the same canvas, scaled by CSS, never re-initialised. */
export const STAGE_ORB_PX = 200;

/** How small the orb draws itself once there is something on screen to read. */
export const STAGE_ORB_SCALE = 0.48;

/** How far the turned orb sits from the viewport's top and right edges. */
export const STAGE_ORB_INSET_PX = 24;

export const STAGE_ORB_EDGE_PX = Math.round(STAGE_ORB_PX * STAGE_ORB_SCALE);

/** The turned orb's centre, measured in from the edge it is tucked against. */
export const STAGE_ORB_CENTRE_PX = STAGE_ORB_INSET_PX + STAGE_ORB_EDGE_PX / 2;

/** What the conversation keeps clear of the orb: its edge and an inset on each side. */
export const STAGE_ORB_GUTTER_PX = STAGE_ORB_EDGE_PX + 2 * STAGE_ORB_INSET_PX;

export interface StageOrbVars {
  x: string;
  y: string;
  s: string;
}

/**
 * The three custom properties the wrapper's inline `transform` reads.
 *
 * `translate()` is not multiplied by `scale()` — the two functions compose, so the
 * delta is in unscaled pixels and is simply the wanted centre minus the centre the
 * `fixed left-1/2 top-1/2` placement already produced. The wide-screen horizontal
 * term is a class; the value returned here is the figure that class must spell, so a
 * changed constant and an unchanged class fails a proof instead of moving the orb to
 * somewhere nobody looked.
 */
export function stageOrbTransformVars(turned: boolean): StageOrbVars {
  if (!turned) return { x: "-50%", y: "-50%", s: "1" };
  return {
    x: `calc(50vw - ${STAGE_ORB_CENTRE_PX + STAGE_ORB_PX / 2}px)`,
    y: `calc(-50vh - ${STAGE_ORB_PX / 2 - STAGE_ORB_CENTRE_PX}px)`,
    s: String(STAGE_ORB_SCALE),
  };
}
