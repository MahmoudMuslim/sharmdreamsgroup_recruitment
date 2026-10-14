/**
 * The organisation timezone, applied at the edges.
 *
 * Instants are stored as UTC everywhere. `organisation.timezone` decides whose
 * wall clock a booked "16:30" refers to, so the conversion happens only when a
 * time is typed in or read out — never in the database.
 *
 * An unrecognised zone (a hand-edited settings row, for instance) degrades to
 * UTC rather than throwing, so one bad value cannot break the agenda page.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsOf(instant: Date, timeZone: string): number[] | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);

    const pick = (type: string) => Number(formatted.find((p) => p.type === type)?.value ?? "0");
    return [
      pick("year"),
      pick("month") - 1,
      pick("day"),
      pick("hour") % 24,
      pick("minute"),
      pick("second"),
    ];
  } catch {
    return null;
  }
}

/** How far `timeZone` sits from UTC at the given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = partsOf(instant, timeZone);
  if (!parts) return 0;
  const [y, mo, d, h, mi, s] = parts;
  return Date.UTC(y, mo, d, h, mi, s) - instant.getTime();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Reads an instant as the wall clock of `timeZone`, as a `datetime-local` value. */
export function toZoneInputValue(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = partsOf(date, timeZone);
  if (!parts) return iso.slice(0, 16);
  const [y, mo, d, h, mi] = parts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/**
 * Turns a wall clock typed against `timeZone` into an absolute instant.
 *
 * Offsets are resolved twice because the first guess can land on the other side
 * of a daylight-saving change, which is exactly when the offset differs.
 */
export function fromZoneInputValue(value: string, timeZone: string): string | null {
  const match = WALL_CLOCK.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive)) return null;

  const first = naive - zoneOffsetMs(new Date(naive), timeZone);
  const instant = naive - zoneOffsetMs(new Date(first), timeZone);
  return new Date(instant).toISOString();
}

/** Formats an instant for readers of `timeZone`, naming the zone when it prints. */
export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

/** The calendar day (`YYYY-MM-DD`) that instant falls on in `timeZone`. */
export function dayKeyInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = partsOf(date, timeZone);
  if (!parts) return iso.slice(0, 10);
  const [y, mo, d] = parts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo + 1)}-${pad(d)}`;
}
