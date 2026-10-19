/**
 * The two directions a navigation between portal screens can carry.
 *
 * React animates a route change from the *type* stamped on the navigation, and
 * the type is never guessed — a `<Link>` or a `router.push` has to say which way
 * it goes. A move nobody tags (the browser's own Back button, `router.refresh()`
 * from the live channel, a search-param change) falls to `default: "none"` and
 * swaps without sliding. That is the honest half of the deal: the portal only
 * animates a direction it was actually told.
 *
 * These strings double as the `view-transition-class` names that globals.css
 * targets, so the tag applied here and the CSS that answers it are one spelling
 * rather than two that have to be kept in step by hand.
 */
export const NAV_FORWARD = "nav-forward";
export const NAV_BACK = "nav-back";

/** For `<Link transitionTypes={…}>` and `router.push(href, { transitionTypes: … })`. */
export const navForward = [NAV_FORWARD];
export const navBack = [NAV_BACK];

/**
 * The content column's map, passed to the shell's `<ViewTransition>`.
 *
 * The same two classes are used for entering and leaving because the CSS reads
 * the direction off the pair: a `nav-forward` old slide runs backwards, so the
 * column leaves to the left while the newcomer arrives from the right.
 */
export const pageEnter = {
  [NAV_FORWARD]: NAV_FORWARD,
  [NAV_BACK]: NAV_BACK,
  default: "none",
};
