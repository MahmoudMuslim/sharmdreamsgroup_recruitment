/**
 * Which attention-feed rows this browser has already acknowledged.
 *
 * The feed is recalculated from live pipeline counts every time it opens, so a
 * "read" flag cannot live in the database: marking 12 unscreened applications as
 * read would not make them screened, and storing the flag would let the portal
 * claim work was seen when it was not. What can be remembered honestly is the
 * count the recruiter was shown, so an acknowledged queue stays quiet and
 * returns by itself as soon as its count grows past that number.
 *
 * Scoped to the staff account, and modelled as an external store because
 * `localStorage` is invisible to the server: hydration renders every row as
 * unseen, then the first client paint applies what this browser remembers.
 */
export interface AlertAck {
  /** The count this row was acknowledged at. */
  readonly count: number;
  /** Hidden from the list until the count grows past `count`. */
  readonly cleared: boolean;
}

export type AlertAckMap = Readonly<Record<string, AlertAck>>;

const ACK_KEY = "sdg-alert-acks";

const EMPTY: AlertAckMap = Object.freeze({});

let store: Record<string, AlertAckMap> | null = null;
const listeners = new Set<() => void>();

/**
 * The same map object is returned until something writes it, which is what makes
 * it safe to hand to `useSyncExternalStore` as a snapshot.
 */
function load(): Record<string, AlertAckMap> {
  if (store) return store;
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    store = raw ? (JSON.parse(raw) as Record<string, AlertAckMap>) : {};
  } catch {
    store = {};
  }
  return store;
}

export function readAcks(userId: string): AlertAckMap {
  return load()[userId] ?? EMPTY;
}

function write(userId: string, next: AlertAckMap): void {
  store = { ...load(), [userId]: next };
  try {
    window.localStorage.setItem(ACK_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked (private mode) — the feed still acknowledges for this page.
  }
  listeners.forEach((notify) => notify());
}

export function subscribeAcks(notify: () => void): () => void {
  const onStorage = () => {
    // Another tab acknowledged the same rows: drop the parsed copy and re-read.
    store = null;
    notify();
  };
  listeners.add(notify);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

export const acksOnServer = (): AlertAckMap => EMPTY;

/** True once this browser has seen the row at its current count or higher. */
export function isAcknowledged(
  ack: AlertAck | undefined,
  count: number
): boolean {
  return !!ack && !ack.cleared && count <= ack.count;
}

/** True while the row is hidden, and stays hidden until the count grows. */
export function isCleared(ack: AlertAck | undefined, count: number): boolean {
  return !!ack?.cleared && count <= ack.count;
}

/**
 * Records every alert at its current count.
 *
 * Whole queues rather than ids so a recount between the click and the write
 * cannot acknowledge a number the recruiter never saw.
 */
export function acknowledgeAlerts(
  userId: string,
  alerts: readonly { id: string; count: number }[],
  cleared: boolean
): void {
  const next: Record<string, AlertAck> = { ...readAcks(userId) };
  for (const alert of alerts) {
    const ack = next[alert.id];
    // A queue that has already grown past its ack needs the new number, whether
    // or not this write clears it.
    if (!ack || alert.count > ack.count) {
      next[alert.id] = { count: alert.count, cleared: ack?.cleared ?? cleared };
    } else if (ack.cleared !== cleared) {
      next[alert.id] = { count: ack.count, cleared };
    }
  }
  write(userId, next);
}

/**
 * Splits a feed into visible rows, rows this browser cleared, and rows it has
 * never seen at their current count. One rule, shared by the panel and the Bell
 * badge, so the badge can never disagree with the list behind it.
 */
export function partitionAlerts<T extends { id: string; count: number }>(
  alerts: readonly T[],
  acks: AlertAckMap
): { rows: T[]; cleared: T[]; unseen: T[] } {
  const rows: T[] = [];
  const cleared: T[] = [];
  const unseen: T[] = [];

  for (const alert of alerts) {
    const ack = acks[alert.id];
    if (isCleared(ack, alert.count)) {
      cleared.push(alert);
      continue;
    }
    rows.push(alert);
    if (!isAcknowledged(ack, alert.count)) unseen.push(alert);
  }

  return { rows, cleared, unseen };
}

export function acknowledgeOneAlert(
  userId: string,
  alert: { id: string; count: number },
  cleared: boolean
): void {
  acknowledgeAlerts(userId, [alert], cleared);
}
