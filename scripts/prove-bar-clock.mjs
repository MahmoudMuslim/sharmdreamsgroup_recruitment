/* scripts/prove-bar-clock.mjs
 * Run: node --experimental-strip-types scripts/prove-bar-clock.mjs
 *
 * The admin app bar now carries the organisation's date and time, and the
 * request that put it there named the rendering: 12-hour, not 24-hour.
 *
 * What is pinned here:
 *
 *   1. the reading — every hour of the day prints a 12-hour face with an
 *      upper-case meridiem, midnight and noon are 12, the hour is not padded,
 *      and no hour ever prints as 13–23 or 02 for 2 p.m.;
 *   2. the zone — the reading follows the timezone it is handed (Cairo walks a
 *      day over at 22:30 UTC), and a zone Intl refuses does not throw;
 *   3. the tick — the clock is its own client component, starts from a
 *      placeholder that both sides of hydration agree on, ticks once a second
 *      and clears its timer;
 *   4. the wiring — the layout reads the organisation timezone after the staff
 *      guard, the shell and the bar pass it through, and the bar is the only
 *      consumer (the candidate portal was not touched);
 *   5. the manual — the Guide says what the clock reads and that it is hidden
 *      on a narrow bar.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { formatBarClock } = await import("../src/modules/shell/domain/barClock.ts");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? "" : `got ${a}, wanted ${e}`);
}

/* -------------------------------------------------------------------------- */
/* 1. The reading                                                              */
/* -------------------------------------------------------------------------- */

const at = (hour) => `2026-10-25T${String(hour).padStart(2, "0")}:05:09Z`;
const FACE = /^(1[0-2]|[1-9]):[0-5]\d:[0-5]\d (AM|PM)$/;

check("the clock face is 12-hour with an upper-case meridiem", FACE.test(formatBarClock(at(13), "UTC").time));
equal("one in the afternoon prints 1 PM, not 13", formatBarClock(at(13), "UTC").time, "1:05:09 PM");
equal("midnight prints 12 AM", formatBarClock(at(0), "UTC").time, "12:05:09 AM");
equal("noon prints 12 PM", formatBarClock(at(12), "UTC").time, "12:05:09 PM");
equal("the last hour of the day prints 11 PM", formatBarClock(at(23), "UTC").time, "11:05:09 PM");
equal("a single-digit hour is not padded", formatBarClock(at(9), "UTC").time, "9:05:09 AM");
equal("a two-digit 12-hour is not truncated", formatBarClock(at(10), "UTC").time, "10:05:09 AM");

{
  // Every hour of a day, in five zones, must read as a 12-hour face and must
  // name the right half of the day. This is the assertion that would fail if
  // anyone changed `hour12` to `false` or dropped it.
  const zones = ["UTC", "Africa/Cairo", "America/New_York", "Asia/Kolkata", "Australia/Sydney"];
  const bad = [];
  for (const zone of zones) {
    for (let hour = 0; hour < 24; hour += 1) {
      const iso = `2026-10-25T${String(hour).padStart(2, "0")}:05:09Z`;
      const { time } = formatBarClock(iso, zone);
      if (!FACE.test(time)) {
        bad.push(`${zone} ${iso} → ${time}`);
        continue;
      }
      const printed = Number(time.split(":")[0]);
      // Read the same instant in 24-hour form, then fold it: the clock must
      // print that hour on a 12-hour dial, not the 24-hour number.
      const hour24 =
        Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: zone,
            hour: "numeric",
            hour12: false,
          }).format(new Date(iso))
        ) % 24;
      const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
      if (printed !== hour12) bad.push(`${zone} ${iso} → ${time}, hour should be ${hour12}`);
    }
  }
  check(
    "every hour of the day, in five zones, reads as a 12-hour clock",
    bad.length === 0,
    bad.slice(0, 4).join("; ")
  );
  check(
    "no reading ever starts with 13–23 or 00",
    zones.every((zone) =>
      Array.from({ length: 24 }, (_, hour) => formatBarClock(at(hour), zone).time).every(
        (time) => !/^(1[3-9]|2[0-3]|0\d)/.test(time)
      )
    )
  );
}

equal("the date is the day and month", formatBarClock(at(13), "UTC").day, "25 Oct");
equal("the weekday is three letters", formatBarClock(at(13), "UTC").weekday, "Sun");
equal(
  "the tooltip spells the weekday and the year",
  formatBarClock(at(13), "UTC").full,
  "Sunday, 25 October 2026 at 1:05:09 PM"
);

/* -------------------------------------------------------------------------- */
/* 2. The zone                                                                 */
/* -------------------------------------------------------------------------- */

equal(
  "Cairo gains three hours in October",
  formatBarClock(at(13), "Africa/Cairo").time,
  "4:05:09 PM"
);
equal(
  "Cairo walks the calendar over at 22:30 UTC",
  [formatBarClock("2026-10-25T22:30:00Z", "Africa/Cairo").time,
   formatBarClock("2026-10-25T22:30:00Z", "Africa/Cairo").day,
   formatBarClock("2026-10-25T22:30:00Z", "Africa/Cairo").weekday],
  ["1:30:00 AM", "26 Oct", "Mon"]
);
equal(
  "New York reads the same instant eight hours back",
  formatBarClock(at(13), "America/New_York").time,
  "9:05:09 AM"
);
{
  const fallback = formatBarClock(at(13), "Not/AZone");
  check(
    "a zone Intl refuses degrades to a 12-hour reading instead of throwing",
    FACE.test(fallback.time),
    fallback.time
  );
}
{
  const broken = formatBarClock("not-an-instant", "Africa/Cairo");
  check(
    "a malformed instant prints a dash rather than NaN",
    broken.time === "—" && broken.day === "—" && broken.full === "—",
    JSON.stringify(broken)
  );
}

/* -------------------------------------------------------------------------- */
/* 3. The tick                                                                 */
/* -------------------------------------------------------------------------- */

const clock = read("src/modules/shell/presentation/AppBarClock.tsx");
check("the clock is a client component", clock.startsWith('"use client";'));
check("the formatter lives in the domain module", clock.includes("formatBarClock(now, timeZone)"));
check(
  "the first render is a placeholder both sides agree on",
  clock.includes("useState<string | null>(null)")
);
check("the timer ticks once a second", clock.includes("window.setInterval(tick, 1000)"));
check("the timer is cleared on unmount", clock.includes("window.clearInterval(timer)"));
check("the clock is a time element with a machine-readable instant", clock.includes("<time") && clock.includes("dateTime={now ?? undefined}"));
check("the zone is named in the accessible label", clock.includes("— ${timeZone}"));
check(
  "the bar drops the clock below the tablet breakpoint",
  clock.includes("hidden") && clock.includes("md:flex")
);
check(
  "the date is hidden until the bar is wide",
  clock.includes('className="hidden tabular-nums xl:inline"')
);
check(
  "the time itself is never hidden",
  clock.includes('<span className="tabular-nums">{text?.time ?? "--:--:--"}</span>')
);
check("the clock itself never formats in 24-hour", !clock.includes("hour12: false") && !clock.includes("hourCycle"));

const domain = read("src/modules/shell/domain/barClock.ts");
check("the formatter asks for a 12-hour clock", domain.includes("hour12: true"));
check("the formatter never asks for a 24-hour clock", !domain.includes("hour12: false") && !domain.includes("hourCycle"));
check("the formatter raises the meridiem", domain.includes(".toUpperCase()"));

/* -------------------------------------------------------------------------- */
/* 4. The wiring                                                               */
/* -------------------------------------------------------------------------- */

const bar = read("src/modules/shell/presentation/AppBar.tsx");
check("the bar takes the zone", bar.includes("timeZone: string;"));
check("the bar renders the clock", bar.includes("<AppBarClock timeZone={timeZone} />"));
check("the bar imports the clock locally", bar.includes('import { AppBarClock } from "./AppBarClock";'));

const shell = read("src/modules/analytics/presentation/AdminShell.tsx");
check("the shell accepts the zone", shell.includes("timeZone: string;"));
check(
  "the shell passes the zone to the bar",
  shell.includes("<AppBar user={user} timeZone={timeZone}")
);

const layout = read("src/app/(admin)/layout.tsx");
check(
  "the layout reads the organisation timezone",
  layout.includes("getOrganisationTimeZone") && layout.includes("await getOrganisationTimeZone()")
);
check(
  "the layout passes it to the shell",
  layout.includes("<AdminShell user={user} timeZone={timeZone}>")
);
check(
  "the settings read happens after the staff guard",
  layout.indexOf("await getOrganisationTimeZone()") > layout.indexOf("isStaff(user.role)")
);

const reader = read("src/modules/settings/infrastructure/settingsReader.ts");
check(
  "the zone reader validates and falls back to UTC",
  reader.includes('getStringSetting("organisation.timezone", "UTC")') &&
    reader.includes("isValidTimeZone(zone) ? zone : \"UTC\"")
);

{
  // The clock belongs to the recruiter portal. Walk the whole src tree and name
  // every file that mentions it: the component and the bar that renders it, and
  // nothing on the candidate or public doors.
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && readFileSync(full, "utf8").includes("AppBarClock")) {
        hits.push(path.relative(root, full).replaceAll("\\", "/"));
      }
    }
  };
  walk(path.join(root, "src"));
  equal("only the portal bar and its clock mention the clock", hits.sort(), [
    "src/modules/shell/presentation/AppBar.tsx",
    "src/modules/shell/presentation/AppBarClock.tsx",
  ]);
}

/* -------------------------------------------------------------------------- */
/* 5. The manual                                                               */
/* -------------------------------------------------------------------------- */

const guide = read("src/modules/shell/presentation/AppBarGuide.tsx");
check("the Guide explains the clock", guide.includes("The clock at the right of this bar"));
check("the Guide says it is 12-hour", guide.includes("12-hour time"));
check("the Guide names the tooltip zone", guide.includes("zone named in its tooltip"));
check("the Guide says a narrow bar keeps only the time", guide.includes("keeps only"));
check("the Guide admits the narrow-bar omission", guide.includes("search box keeps its room"));

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  if (!result.pass) console.log(`FAIL ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
