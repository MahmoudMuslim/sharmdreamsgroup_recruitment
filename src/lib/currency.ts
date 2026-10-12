/**
 * Salary formatting.
 *
 * Job salaries carry an ISO 4217 code alongside the amounts, so nothing may
 * assume dollars. `Intl.NumberFormat` is used rather than a hand-rolled
 * formatter because it already knows the correct symbol placement, grouping and
 * decimal convention per currency — EGP "18,000", USD "$18,000", JOD "18,000 JOD".
 */

/** Currencies whose symbol is the code itself, so repeating it looks wrong. */
const NO_GLYPH = new Set(["EGP", "AED", "SAR", "QAR", "KWD", "JOD", "MAD", "CHF", "TND"]);

interface CurrencyLookup {
  code: string;
  symbol: string;
  label: string;
}

export interface SalaryRange {
  min: number | null;
  max: number | null;
  currency: string;
}

/**
 * Formats one figure.
 *
 * `Intl` is given the currency code when the platform defines that currency,
 * and the code alone otherwise — a retirement or a mistyped code must not turn
 * a salary into "NaN" or throw inside a server render.
 */
export function formatMoney(amount: number, currencyCode: string, known?: CurrencyLookup[]): string {
  const code = (currencyCode || "USD").toUpperCase();
  const isKnown = known?.some((c) => c.code === code) ?? true;

  if (!isKnown) {
    // Unknown code: group the digits and append the code, which is honest.
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${code}`;
  }

  if (NO_GLYPH.has(code)) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${code}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${code}`;
  }
}

/**
 * Formats a salary range for display.
 *
 * Returns an empty string when there is nothing to show, so callers can use it
 * directly as a conditional without a second null check.
 */
export function formatSalaryRange(range: SalaryRange, known?: CurrencyLookup[]): string {
  const { min, max, currency } = range;

  if (min === null && max === null) return "";
  if (min !== null && max !== null) {
    return `${formatMoney(min, currency, known)} – ${formatMoney(max, currency, known)}`;
  }
  // Only one bound was given — show it rather than implying a range.
  const only = min ?? max;
  if (only === null) return "";
  return `from ${formatMoney(only, currency, known)}`;
}

/** Short symbol for compact rows, e.g. a badge showing "EGP". */
export function currencySymbol(code: string, known?: CurrencyLookup[]): string {
  const match = known?.find((c) => c.code === (code || "").toUpperCase());
  return match?.symbol || (code || "USD").toUpperCase();
}