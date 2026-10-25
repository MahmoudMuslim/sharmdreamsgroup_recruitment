import { formatInZone } from "@/lib/timezone";

/**
 * The reading the app bar's clock prints.
 *
 * `en-GB` writes the meridiem in lower case (`1:05:09 pm`), which reads as an
 * abbreviation mid-sentence rather than a clock face, so the mirror form is
 * raised to `PM` here — one place, rather than at every render.
 *
 * The hour is `numeric` and carries `hour12: true`, so midnight is `12:05:09 AM`
 * and one in the afternoon is `1:05:09 PM`: the bar never prints a 24-hour
 * `13:05` and never pads the hour to `01`.
 */
export type BarClockText = {
  /** The clock face, e.g. `1:05:09 PM`. */
  time: string;
  /** Day and month, e.g. `25 Oct`. */
  day: string;
  /** Three-letter weekday, e.g. `Sun`. */
  weekday: string;
  /** The whole reading with the weekday and year spelled out, for a tooltip. */
  full: string;
};

const MERIDIEM = /\b(am|pm)\b/i;

function capsMeridiem(text: string): string {
  return text.replace(MERIDIEM, (part) => part.toUpperCase());
}

export function formatBarClock(iso: string, timeZone: string): BarClockText {
  return {
    time: capsMeridiem(
      formatInZone(iso, timeZone, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    ),
    day: formatInZone(iso, timeZone, { day: "numeric", month: "short" }),
    weekday: formatInZone(iso, timeZone, { weekday: "short" }),
    full: capsMeridiem(
      formatInZone(iso, timeZone, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    ),
  };
}
