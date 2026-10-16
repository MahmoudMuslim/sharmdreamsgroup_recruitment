/**
 * The candidate board's own bound.
 *
 * The read that cuts the board and the view that has to explain the cut are on
 * opposite sides of the server/client line, so the number lives in a module
 * neither of them owns — the same reason the outbox keeps its page limits here.
 * A literal in each file is one edit away from a sentence that lies.
 */
export const BOARD_LIMIT = 200;
