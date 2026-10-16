import { sourceLabel } from "@/lib/utils";

/**
 * Charts the assistant draws out of its own reads.
 *
 * Asked "how is the pipeline?", a recruiter is otherwise handed a list of
 * numbers in a chat bubble and has to rebuild the shape of it mentally. This
 * turns a tool result into that shape — and the model only ever names which
 * view it wants, never a figure, so a bar cannot describe a number the read did
 * not return.
 *
 * Every chart states its population, how its bars are to be read, and what a
 * naive reader would get wrong, because a bar with no denominator makes a claim
 * of its own: the longest bar always looks "full", and whether full means every
 * live application or merely the busiest day changes what the picture says.
 */

export const CHART_VIEWS = [
  "pipeline",
  "channels",
  "fit_bands",
  "time_to_hire",
  "daily_volume",
] as const;

export type ChartView = (typeof CHART_VIEWS)[number];

export type ChartTone = "gold" | "ink" | "success" | "danger";

export interface AssistantChartRow {
  label: string;
  value: number;
  /** A second figure beside the bar, phrased in the read's own terms. */
  note: string | null;
  tone: ChartTone;
}

export interface AssistantChart {
  view: ChartView;
  title: string;
  /** A time series reads better as a strip of columns than as a list of rows. */
  shape: "bars" | "columns";
  unit: string;
  /** What the bars are drawn over — a count is never left to be read as a rate. */
  population: string;
  /** How the longest bar and the figure beside each row are to be read. */
  scale: string;
  /** The claim a careless reader would get wrong. */
  caveat: string | null;
  peak: number;
  rows: AssistantChartRow[];
}

export type ChartBuild =
  | { chart: AssistantChart; reason: null }
  | { chart: null; reason: string };

export function isChartView(value: string): value is ChartView {
  return (CHART_VIEWS as readonly string[]).includes(value);
}

const STAGE_NAMES: Record<string, string> = {
  NEW: "New",
  AI_SCREENING: "AI screening",
  ASSESSMENT: "Assessment",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/* ------------------------------ Result parsing ----------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** PostgREST and the enum joins can hand a count back as a string. */
function amount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function amountOr(value: unknown, fallback: number): number {
  return amount(value) ?? fallback;
}

function series(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
  );
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function stageName(code: string): string {
  if (STAGE_NAMES[code]) return STAGE_NAMES[code];
  return code
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

/** `2026-10-15` → `Oct 15`, from a fixed table so the label cannot drift with locale. */
function dayLabel(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return iso;
  const month = MONTHS[Number(parts[2]) - 1];
  return month ? `${month} ${Number(parts[3])}` : iso;
}

/**
 * The largest value in the series, kept as it is.
 *
 * Not floored at 1: a chart whose every row is zero has to say so, and a peak
 * inflated to 1 would caption "the busiest day had 1 submission" over a window
 * that holds none. Renderers guard the division themselves.
 */
function peakOf(rows: AssistantChartRow[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.value), 0);
}

/* --------------------------------- Builders -------------------------------- */

/**
 * Stage populations, not a flow.
 *
 * `pipeline` carries a `conversion_rate` measured against the previous stage,
 * which invites the reading that this many people moved on. The counts are who
 * is sitting at each stage right now, so the chart compares them against the
 * pipeline instead, and says so.
 */
function pipelineChart(result: Record<string, unknown>): ChartBuild {
  const total = amountOr(result.total_applications, 0);
  const rows = series(result.pipeline).reduce<AssistantChartRow[]>((acc, step) => {
    const value = amount(step.count);
    if (value === null) return acc;
    const code = typeof step.stage === "string" ? step.stage : "";
    const pct = share(value, total);
    acc.push({
      label: stageName(code),
      value,
      note: pct === null ? null : `${pct}%`,
      tone: code === "HIRED" ? "success" : code === "REJECTED" ? "danger" : "gold",
    });
    return acc;
  }, []);

  if (rows.length === 0 || total === 0) {
    return { chart: null, reason: "No application is sitting at any stage, so there is no funnel to draw." };
  }

  const held = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    chart: {
      view: "pipeline",
      title: "Where the pipeline sits right now",
      shape: "bars",
      unit: "applications",
      population: `${total.toLocaleString()} live applications, none archived`,
      scale: "the longest bar is the busiest stage; % is each stage's share of that total",
      caveat:
        held === total
          ? "Each application is counted at one stage only, so these bars add up to the whole pipeline — someone at Interview has already left New behind."
          : `${held} of the ${total} applications are at a stage this read names; the rest are not in these bars.`,
      peak: peakOf(rows),
      rows,
    },
    reason: null,
  };
}

function channelsChart(result: Record<string, unknown>): ChartBuild {
  const total = amountOr(result.total_applications, 0);
  const rows = series(result.channels).reduce<AssistantChartRow[]>((acc, channel) => {
    const value = amount(channel.applications);
    if (value === null) return acc;
    const hires = amountOr(channel.hires, 0);
    acc.push({
      label: sourceLabel(typeof channel.source === "string" ? channel.source : ""),
      value,
      note: hires === 0 ? "no hire yet" : `${hires} hired`,
      tone: "gold",
    });
    return acc;
  }, []);

  if (rows.length === 0) {
    return { chart: null, reason: "No source has brought in an application, so there is nothing to compare." };
  }

  return {
    chart: {
      view: "channels",
      title: "Which sources brought applications",
      shape: "bars",
      unit: "applications",
      population: `${total.toLocaleString()} live applications, each counted once against where it arrived`,
      scale: "the longest bar is the busiest source; the figure beside it is what that source hired",
      caveat: "A source's hires are its applications still sitting at the Hired stage.",
      peak: peakOf(rows),
      rows,
    },
    reason: null,
  };
}

function fitChart(result: Record<string, unknown>): ChartBuild {
  if (result.scores_masked === true) {
    return {
      chart: null,
      reason:
        "Fit bands are withheld from your role by the “mask AI scores” setting, so this read holds no scores to draw.",
    };
  }

  const scored = amountOr(result.scored_applications, 0);
  const rows = series(result.fit_distribution).reduce<AssistantChartRow[]>((acc, bucket) => {
    const value = amount(bucket.count);
    if (value === null) return acc;
    const pct = share(value, scored);
    acc.push({
      label: typeof bucket.range === "string" ? bucket.range : "unlabelled band",
      value,
      note: pct === null ? null : `${pct}%`,
      tone: "ink",
    });
    return acc;
  }, []);

  if (rows.length === 0 || scored === 0) {
    return { chart: null, reason: "No application in this read carries an AI fit score yet." };
  }

  return {
    chart: {
      view: "fit_bands",
      title: "How the AI scored the pipeline",
      shape: "bars",
      unit: "applications",
      population: `${scored.toLocaleString()} applications carrying an AI fit score`,
      scale: "the longest bar is the fullest band; % is each band's share of scored applications",
      caveat: "Applications the AI has not scored are in none of these bands.",
      peak: peakOf(rows),
      rows,
    },
    reason: null,
  };
}

function timeToHireChart(result: Record<string, unknown>): ChartBuild {
  const rows = series(result.time_to_hire_trend).reduce<AssistantChartRow[]>((acc, point) => {
    const value = amount(point.avg_days);
    if (value === null) return acc;
    acc.push({
      label: typeof point.month === "string" ? point.month : "month",
      value,
      note: null,
      tone: "gold",
    });
    return acc;
  }, []);

  if (rows.length === 0) {
    return { chart: null, reason: "This read holds no months to chart." };
  }
  if (rows.every((row) => row.value === 0)) {
    return {
      chart: null,
      reason:
        "No hire in the months read has both an applied date and a hired date, so there is no duration to average.",
    };
  }

  return {
    chart: {
      view: "time_to_hire",
      title: "Days from applied to hired",
      shape: "bars",
      unit: "days",
      population: `hires recorded in each of the ${rows.length} months read`,
      scale: "the longest bar is the slowest month",
      caveat: "A month drawn at 0 days recorded no hire — it is not a same-day hire.",
      peak: peakOf(rows),
      rows,
    },
    reason: null,
  };
}

function volumeChart(result: Record<string, unknown>): ChartBuild {
  const rows = series(result.applications_last_14_days).reduce<AssistantChartRow[]>((acc, day) => {
    const value = amount(day.count);
    if (value === null) return acc;
    acc.push({
      label: typeof day.date === "string" ? dayLabel(day.date) : "day",
      value,
      note: null,
      tone: "gold",
    });
    return acc;
  }, []);

  if (rows.length === 0) {
    return { chart: null, reason: "The submission window is not in this read, so there is nothing to draw." };
  }

  const sum = rows.reduce((total, row) => total + row.value, 0);
  const peak = peakOf(rows);
  return {
    chart: {
      view: "daily_volume",
      title: "Applications per day",
      shape: "columns",
      unit: "submissions",
      population: `${sum.toLocaleString()} applications arrived across the last ${rows.length} days`,
      scale:
        peak === 0
          ? "each column is one day, and none of them took a submission"
          : `each column is one day, and the tallest is the busiest at ${peak}`,
      caveat: "Days are calendar days counted in UTC, the same axis the dashboard's application-flow card uses.",
      peak,
      rows,
    },
    reason: null,
  };
}

/**
 * One named view over one tool result.
 *
 * Returns a reason rather than a null chart alone: a view that cannot be drawn
 * (masked scores, an unscored pipeline) has to be reported by the assistant
 * instead of answered with a blank space the recruiter reads as zero.
 */
export function chartForView(view: ChartView, result: unknown): ChartBuild {
  const record = asRecord(result);
  switch (view) {
    case "pipeline":
      return pipelineChart(record);
    case "channels":
      return channelsChart(record);
    case "fit_bands":
      return fitChart(record);
    case "time_to_hire":
      return timeToHireChart(record);
    case "daily_volume":
      return volumeChart(record);
  }
}

/** The chart a finished tool call earned, if it asked for one. */
export function chartForTool(tool: string, result: unknown): AssistantChart | null {
  if (tool !== "dashboard_analytics") return null;
  const record = asRecord(result);
  const view = record.chart_view;
  if (typeof view !== "string" || !isChartView(view)) return null;
  return chartForView(view, record).chart;
}
