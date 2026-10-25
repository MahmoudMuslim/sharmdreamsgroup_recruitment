/**
 * Career indicators — pure, month-aware, and honest about what it knows.
 *
 * Spec §6 (`docs/superpowers/specs/2026-10-25-person-profile-spine-design.md`):
 * `job_stability` is deliberately **not a score**. It is four numbers, a
 * coverage report and a caveat list, and no verdict is attached to anyone.
 * A figure that silently treats "2019" as January is a fabricated precision,
 * so every assumption this module makes is either disclosed in `coverage`
 * or pushed into `caveats` for the surface (Task 13) to print inline.
 *
 * Resolved ambiguities (the brief left these to the implementation):
 *  - A year-only **closed** period — one where `startMonth` or `endMonth` is
 *    null and the role actually ended — counts a flat 12 months whether it
 *    sits in the middle or at the end of the list. It does NOT span to the
 *    next role's start; spanning would invent boundaries the row never had.
 *    The only case that runs to `now` is a missing end (§6: a role with no
 *    `endYear` and not `ongoing`), plus an ongoing role's own clock.
 *  - `coverage.withEnd` counts a role whose end is *known*, and an ongoing
 *    role's end is known: it is "current". So `ongoing: true` contributes
 *    to `withEnd` even though `endYear` is null.
 *  - Day arithmetic uses UTC anchors built from the calendar fields of the
 *    rows and of `now`, so a recruiter's machine timezone (and DST) cannot
 *    change a candidate's numbers, and the Task 16 proof script gets the
 *    same result on any host.
 *
 * No database, no `server-only`, no side effects, no `Date.now()` — the
 * caller passes `now` so the fixture below is reproducible.
 */

/** One employment row, as the spine stores it. Months are 1–12 or null. */
export interface EmploymentRow {
  employer: string;
  startYear: number;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  ongoing: boolean;
}

/** Four numbers, a coverage report and a caveat list. Never a score. */
export interface CareerIndicators {
  totalMonths: number;
  roles: number;
  longestRoleMonths: number | null;
  shortestRoleMonths: number | null;
  gapMonthsTotal: number;
  longestGapMonths: number | null;
  changesPerFiveYears: number | null;
  coverage: { rows: number; withMonths: number; withEnd: number };
  caveats: string[];
}

/** The spec's "~30.44": the average Gregorian month in days. */
const DAYS_PER_MONTH = 30.44;
const MS_PER_DAY = 86_400_000;

/** Round at the print boundary only — never on an accumulated running total. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface Day {
  year: number;
  month: number; // 1-12
  day: number;
}

function utcMs(d: Day): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function daysBetween(a: Day, b: Day): number {
  return (utcMs(b) - utcMs(a)) / MS_PER_DAY;
}

/** A period with its month-length resolved under the §6 rules. */
interface ComputedPeriod {
  row: EmploymentRow;
  start: Day;
  end: Day;
  months: number;
}

function computePeriod(row: EmploymentRow, now: Date): { period: ComputedPeriod; caveat: string | null } {
  const nowDay: Day = {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
  const start: Day = { year: row.startYear, month: row.startMonth ?? 1, day: 1 };
  let caveat: string | null = null;
  let months: number;
  let end: Day;

  if (row.ongoing) {
    // Ongoing counts to `now`; its endYear/endMonth are ignored entirely.
    end = nowDay;
    months = daysBetween(start, end) / DAYS_PER_MONTH;
  } else if (row.endYear === null) {
    // Missing end, not ongoing: count to now and SAY so. Never fabricate a
    // end date, and never let the reader think the row stated one.
    end = nowDay;
    months = daysBetween(start, end) / DAYS_PER_MONTH;
    caveat =
      `${row.employer} states no end date and is not marked ongoing; ` +
      'it is counted to now.';
  } else if (row.startMonth === null || row.endMonth === null) {
    // Year-only closed period — middle or last, it counts a flat 12 months
    // ("the rest are counted as whole years"). The gap anchor assumes the
    // stated year ran to its end.
    end = { year: row.endYear, month: row.endMonth ?? 12, day: row.endMonth === null ? 31 : 1 };
    months = 12;
  } else {
    end = { year: row.endYear, month: row.endMonth, day: 1 };
    months = (row.endYear - row.startYear) * 12 + (row.endMonth - row.startMonth);
    if (months < 0) months = 0; // nonsense input is clipped, not laundered into a negative
  }

  return { period: { row, start, end, months }, caveat };
}

/**
 * The month-aware career figures for one person's employment rows.
 *
 * `now` is injected by the caller (never read from the clock here) so the
 * fixture below — and therefore the Task 16 proof script — is reproducible.
 */
export function computeCareerIndicators(
  roles: readonly EmploymentRow[],
  now: Date
): CareerIndicators {
  const caveats: string[] = [];
  const periods: ComputedPeriod[] = [];

  for (const row of roles) {
    const { period, caveat } = computePeriod(row, now);
    if (caveat !== null) caveats.push(caveat);
    periods.push(period);
  }

  // Gaps are measured over the timeline, so sort by stated start; a
  // year-only start anchors to January (`startMonth ?? 1`).
  periods.sort((a, b) => utcMs(a.start) - utcMs(b.start));

  const months = periods.map((p) => p.months);
  const totalMonthsRaw = months.reduce((sum, m) => sum + m, 0);

  const gaps: number[] = [];
  for (let i = 1; i < periods.length; i++) {
    const days = daysBetween(periods[i - 1].end, periods[i].start);
    // A negative gap is two roles overlapping, not a gap; clip to zero
    // rather than subtracting overlap from the gap total.
    gaps.push(days > 0 ? days / DAYS_PER_MONTH : 0);
  }
  const gapMonthsTotalRaw = gaps.reduce((sum, g) => sum + g, 0);

  const hasEnd = (r: EmploymentRow): boolean => r.ongoing || r.endYear !== null;

  const totalMonths = round2(totalMonthsRaw);
  return {
    totalMonths,
    roles: roles.length,
    longestRoleMonths: months.length === 0 ? null : round2(Math.max(...months)),
    shortestRoleMonths: months.length === 0 ? null : round2(Math.min(...months)),
    gapMonthsTotal: round2(gapMonthsTotalRaw),
    longestGapMonths: gaps.length === 0 ? null : round2(Math.max(...gaps)),
    // `null`, never Infinity or NaN, when there is no career span to divide by.
    changesPerFiveYears: totalMonths === 0 ? null : round2(roles.length / (totalMonths / 60)),
    coverage: {
      rows: roles.length,
      // A row "states a month" only when its START month was given — that is
      // the precision the total depends on, so only it earns the credit.
      withMonths: roles.filter((r) => r.startMonth !== null).length,
      // An ongoing row's end IS known — it is "current" — so it counts here.
      withEnd: roles.filter(hasEnd).length,
    },
    caveats,
  };
}

/**
 * The five-role fixture the Task 16 proof script imports and asserts
 * `computeCareerIndicators(FIXTURE.roles, FIXTURE.now)` deep-equals
 * `FIXTURE.expect`. The arithmetic is spelled out per role so a reviewer
 * can trace it without running anything:
 *
 *   now = 2026-10-01 (UTC)
 *
 *   1. Alpha Ltd    2018-03 → 2020-05  both months → (2020-2018)*12 + (5-3) = 26
 *   2. Beta GmbH    2020    → 2021     year-only closed → 12 (startMonth null
 *                                       → no credit in `withMonths`; gap anchor
 *                                       is 2021-12-31)
 *   3. Gamma LLC    2022-06 → 2023-08  both months → 12 + (8-6) + ... = 14
 *   4. Delta Co     2024-01 → (no end, not ongoing) → counted to now:
 *                                       2024-01-01→2026-10-01 = 1004 days
 *                                       1004 / 30.44 = 32.982924 → prints 32.98
 *                                       + one caveat
 *   5. Epsilon Inc  2025-04 → ongoing  → counted to now: 548 days
 *                                       548 / 30.44 = 18.002628 → prints 18.00
 *
 *   totalMonths = 26 + 12 + 14 + 32.982924 + 18.002628 = 102.985552 → 102.99
 *
 *   gaps (sorted order is 1..5 as listed):
 *     Alpha→Beta   2020-05-01 → 2020-01-01  negative (overlap) → 0
 *     Beta→Gamma   2021-12-31 → 2022-06-01  152 days → 4.993430
 *     Gamma→Delta  2023-08-01 → 2024-01-01  153 days → 5.026281
 *     Delta→Eps    now        → 2025-04-01  negative (overlap) → 0
 *   gapMonthsTotal = 305 / 30.44 = 10.019711 → 10.02
 *   longestGapMonths = 5.03
 *
 *   longest = 32.98, shortest = 12
 *   changesPerFiveYears = 5 / (102.99 / 60) = 2.912905 → 2.91
 *   coverage: rows 5; withMonths 4 (all but Beta); withEnd 4 (all but Delta;
 *             Epsilon is ongoing, and "current" is a known end)
 *   caveats: exactly one, for Delta Co.
 */
export const FIXTURE: { roles: EmploymentRow[]; now: Date; expect: CareerIndicators } = {
  roles: [
    { employer: 'Alpha Ltd', startYear: 2018, startMonth: 3, endYear: 2020, endMonth: 5, ongoing: false },
    { employer: 'Beta GmbH', startYear: 2020, startMonth: null, endYear: 2021, endMonth: null, ongoing: false },
    { employer: 'Gamma LLC', startYear: 2022, startMonth: 6, endYear: 2023, endMonth: 8, ongoing: false },
    { employer: 'Delta Co', startYear: 2024, startMonth: 1, endYear: null, endMonth: null, ongoing: false },
    { employer: 'Epsilon Inc', startYear: 2025, startMonth: 4, endYear: null, endMonth: null, ongoing: true },
  ],
  now: new Date(Date.UTC(2026, 9, 1)),
  expect: {
    totalMonths: 102.99,
    roles: 5,
    longestRoleMonths: 32.98,
    shortestRoleMonths: 12,
    gapMonthsTotal: 10.02,
    longestGapMonths: 5.03,
    changesPerFiveYears: 2.91,
    coverage: { rows: 5, withMonths: 4, withEnd: 4 },
    caveats: [
      'Delta Co states no end date and is not marked ongoing; it is counted to now.',
    ],
  },
};
