"use client";

import { useEffect, useState } from "react";
import { formatBarClock } from "@/modules/shell/domain/barClock";

/**
 * The organisation's wall clock in the bar — date and time, 12-hour.
 *
 * The tick lives in this component and nowhere else: the bar owns the search
 * box and three panels, and a state change up there every second would rebuild
 * all of them. Here it re-renders one `<time>`.
 *
 * The first render is a placeholder because the server and the browser have no
 * shared "now" — the effect fills it immediately and then on every second, so
 * hydration compares placeholder to placeholder and the text starts moving a
 * frame later.
 *
 * The zone is the organisation's, passed from the admin layout, not the
 * browser's: every other dated label in the portal is read against that wall
 * clock, and a recruiter abroad looking at a 9 a.m. panel should not read their
 * own laptop's hour beside it. The zone is named in the tooltip.
 *
 * The date is the first thing to go when the bar runs out of room — the time is
 * what the clock is for. Between the tablet and wide-desktop breakpoints it
 * prints only the time; at `xl` the weekday and date return. The tooltip always
 * carries the full reading and the zone.
 */
export function AppBarClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const text = now ? formatBarClock(now, timeZone) : null;
  const label = text ? `${text.full} — ${timeZone}` : `Organisation time — ${timeZone}`;

  return (
    <time
      dateTime={now ?? undefined}
      title={label}
      aria-label={label}
      className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink/65 md:flex"
    >
      <span className="hidden tabular-nums xl:inline">
        {text ? `${text.weekday} ${text.day}` : "—"}
      </span>
      <span className="hidden text-brand-gold xl:inline" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">{text?.time ?? "--:--:--"}</span>
    </time>
  );
}
