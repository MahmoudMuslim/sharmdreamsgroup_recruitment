/**
 * The documents the portal can hand out.
 *
 * Two kinds live here. `analyticsDocument` flattens the aggregate report the
 * Analytics page draws. The five row-level reports list the individual records
 * behind those aggregates — which candidate never opened the test, which
 * message failed, which prospect went quiet — because an aggregate cannot be
 * worked from and a list cannot be counted at a glance.
 *
 * Both produce the same `ExportDocument`, which is why CSV, Excel and PDF of
 * one report cannot disagree: they are three renderings of one cell grid.
 */

import "server-only";

import { CANDIDATE_ROW_LIMIT } from "@/modules/candidates/domain/listFilters";
import { dayKeyInZone, formatInZone } from "@/lib/timezone";
import type { ExportCell, ExportDocument, ExportSheet } from "./exportDocument";
import type { AnalyticsReport } from "./report";

export type ReportId = "pipeline" | "assessments" | "sourcing" | "messages" | "interviews";

export type ReportDefinition = (typeof REPORTS)[number];

/**
 * What each list is, in the words the page and every exported file use.
 *
 * `caveats` is not decoration: a list of rows invites a reader to assume the
 * rows are the whole history, and for most of these tables that is false.
 */
export const REPORTS: {
  id: ReportId;
  label: string;
  blurb: string;
  caveats: string[];
}[] = [
  {
    id: "pipeline",
    label: "Every application",
    blurb:
      "One row per application in the window: who applied, for what, where they stand now and how long the hire took.",
    caveats: [
      "Stage dates are not kept. A move overwrites the row, so Applied and Last update are the only history a stage column sits between.",
      "Days to hire is measured from the application to the hire date; a hire recorded without a date shows no figure rather than a guessed one.",
      "Archived records stay in the list and say so in the stage column.",
    ],
  },
  {
    id: "assessments",
    label: "Every issued test",
    blurb:
      "One row per assessment invite with its timings: when it went out, whether it was opened, how long the candidate spent and what they scored.",
    caveats: [
      "A revoked or expired invite stays in the list, because the test was still issued.",
      "Minutes on test is measured from the first question opened to the submit, so a candidate who starts, leaves and returns shows the whole span.",
    ],
  },
  {
    id: "sourcing",
    label: "Every sourced prospect",
    blurb:
      "One row per off-pipeline prospect: where they came from, what stage a recruiter put them at, and whether they became an application.",
    caveats: [
      "The stage column is what a recruiter set by hand. The message count is what the system actually logged, so the two can disagree.",
      "Prospects added before this window appear only when the window is All time.",
    ],
  },
  {
    id: "messages",
    label: "Every candidate message",
    blurb:
      "One row per message the portal sent: channel, recipient, subject, and whether it landed.",
    caveats: [
      "Delivered is the state the row holds now, not a record of every attempt; a message that failed twice then went through reads as delivered.",
      "An email or campaign also writes a row for the copy it leaves in the candidate's inbox; that notice row is counted as logged, never as a delivery, because a notice is written rather than sent.",
      "Message bodies are not here — the Outbox page shows them.",
      "WhatsApp rows carry the reason Meta rejected the send when there is one.",
    ],
  },
  {
    id: "interviews",
    label: "Every interview panel",
    blurb:
      "One row per scheduled panel: the slot, the candidate, who is interviewing, and how long after the application it fell.",
    caveats: [
      "Only panels booked inside the portal appear. A call arranged straight in someone's calendar is invisible here.",
      "Lead days counts from the application to the slot, not from the invite.",
    ],
  },
];

export function reportDefinition(id: unknown): ReportDefinition | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}

/**
 * A list the portal already shows on screen, described the way a report is.
 *
 * `REPORTS` are cut by a time window; a console like Candidates is cut by its
 * own filters. Both need the same three things in a file — a name, a blurb and
 * the reasons the rows are not the whole picture — so one shape carries both.
 */
export interface ListDefinition {
  label: string;
  blurb: string;
  caveats: string[];
}

export const CANDIDATE_LIST: ListDefinition = {
  label: "Candidate pipeline",
  blurb:
    "One row per application matching the filters on the candidates screen: contact details, the role and the company it was filed under, where the candidate stands, what the AI and the test said, and whether a panel is booked.",
  caveats: [
    `The candidates screen lists the newest ${CANDIDATE_ROW_LIMIT} applications its filters match, while its rail counts cover the whole set. This file is built from every application matching the same filters, so it can hold more rows than were on screen.`,
    "Stage dates are not kept. A move overwrites the row, so Applied and Last update are the only history a stage column sits between.",
    "Assessment columns show the newest attempt issued to a candidate. When several were issued, the older ones are not here.",
    "Next panel is the soonest slot still on the calendar. A call arranged outside the portal is not recorded anywhere, so it does not appear.",
  ],
};

/** Shared context every sheet needs: whose clock the stamps use, and what must be hidden. */
export interface SheetContext {
  timeZone: string;
  scoresHidden: boolean;
}

function stamp(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const day = dayKeyInZone(iso, timeZone);
  if (!day) return "";
  const clock = formatInZone(iso, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${clock.slice(0, 5)}`;
}

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / 86_400_000) * 10) / 10;
}

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

function percentOf(score: number | null, max: number | null): number | null {
  if (score === null || max === null || max <= 0) return null;
  return Math.round((score / max) * 1000) / 10;
}

/* ------------------------------------------------------------- row types -- */

export interface PipelineRow {
  full_name: string;
  email: string | null;
  phone: string | null;
  opening: string | null;
  stage: string;
  source: string;
  ai_match_score: number | null;
  created_at: string | null;
  updated_at: string | null;
  hired_at: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
}

export interface AssessmentRow {
  full_name: string | null;
  opening: string | null;
  suite: string | null;
  status: string;
  invited_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  total_score: number | null;
  max_score: number | null;
}

export interface SourcedRow {
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  origin: string;
  stage: string;
  created_at: string | null;
  last_contacted_at: string | null;
  application_id: string | null;
  profile_source: string | null;
  messages: number;
}

export interface MessageRow {
  created_at: string | null;
  channel: string;
  direction: string;
  recipient: string;
  subject: string | null;
  delivered: boolean;
  read_at: string | null;
  error_message: string | null;
  full_name: string | null;
  opening: string | null;
}

export interface PanelRow {
  scheduled_at: string | null;
  full_name: string | null;
  opening: string | null;
  interviewer: string | null;
  status: string;
  duration_minutes: number | null;
  created_at: string | null;
  application_created_at: string | null;
  meeting_link: string | null;
  calendar_provider: string | null;
}

/** One application as the candidates console shows it, plus what a file needs. */
export interface CandidateListRow {
  full_name: string;
  tracking_code: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  /** The company the application's opening belongs to, reached through `job_openings`. */
  company_name: string | null;
  stage: string;
  source: string;
  /** Null until screened, and while this reader's scores are masked. */
  ai_match_score: number | null;
  attempt_status: string | null;
  attempt_score: number | null;
  attempt_max: number | null;
  next_panel_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  hired_at: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
}

/* ---------------------------------------------------------------- sheets -- */

interface ReportColumn<T> {
  header: string;
  value: (row: T) => ExportCell;
  /** Dropped entirely when score masking applies to this reader. */
  masked?: boolean;
}

function sheet<T>(
  name: string,
  context: SheetContext,
  columns: ReportColumn<T>[],
  rows: T[]
): ExportSheet {
  /* Score columns leave with the scores: an average in a spreadsheet is just
   * another way of showing a number the reader is not allowed to see. */
  const visible = columns.filter((column) => !(column.masked && context.scoresHidden));
  return {
    name,
    columns: visible.map((column) => column.header),
    rows: rows.map((row) => visible.map((column) => column.value(row))),
  };
}

export function pipelineSheet(rows: PipelineRow[], context: SheetContext): ExportSheet {
  return sheet(
    "Applications",
    context,
    [
      { header: "Candidate", value: (row) => row.full_name },
      { header: "Email", value: (row) => row.email },
      { header: "Phone", value: (row) => row.phone },
      { header: "Opening", value: (row) => row.opening },
      { header: "Stage", value: (row) => (row.archived_at ? `${row.stage} (archived)` : row.stage) },
      { header: "Source", value: (row) => row.source },
      {
        header: "AI fit %",
        masked: true,
        value: (row) => row.ai_match_score,
      },
      { header: "Applied", value: (row) => stamp(row.created_at, context.timeZone) },
      { header: "Last update", value: (row) => stamp(row.updated_at, context.timeZone) },
      { header: "Hired on", value: (row) => stamp(row.hired_at, context.timeZone) },
      {
        header: "Days to hire",
        value: (row) => daysBetween(row.created_at, row.hired_at),
      },
      { header: "Rejection reason", value: (row) => row.rejection_reason },
    ],
    rows
  );
}

export function assessmentSheet(rows: AssessmentRow[], context: SheetContext): ExportSheet {
  return sheet(
    "Assessments",
    context,
    [
      { header: "Candidate", value: (row) => row.full_name },
      { header: "Opening", value: (row) => row.opening },
      { header: "Suite", value: (row) => row.suite },
      { header: "Status", value: (row) => row.status },
      { header: "Invited", value: (row) => stamp(row.invited_at, context.timeZone) },
      { header: "Opened", value: (row) => stamp(row.started_at, context.timeZone) },
      { header: "Submitted", value: (row) => stamp(row.submitted_at, context.timeZone) },
      {
        header: "Minutes on test",
        value: (row) => minutesBetween(row.started_at, row.submitted_at),
      },
      { header: "Expires", value: (row) => stamp(row.expires_at, context.timeZone) },
      { header: "Score", masked: true, value: (row) => row.total_score },
      { header: "Out of", masked: true, value: (row) => row.max_score },
      {
        header: "Score %",
        masked: true,
        value: (row) => percentOf(row.total_score, row.max_score),
      },
    ],
    rows
  );
}

export function sourcingSheet(rows: SourcedRow[], context: SheetContext): ExportSheet {
  return sheet(
    "Prospects",
    context,
    [
      { header: "Name", value: (row) => row.full_name },
      { header: "Headline", value: (row) => row.headline },
      { header: "Company", value: (row) => row.company },
      { header: "Location", value: (row) => row.location },
      { header: "Email", value: (row) => row.email },
      { header: "Origin", value: (row) => row.origin },
      { header: "Stage", value: (row) => row.stage },
      { header: "Added", value: (row) => stamp(row.created_at, context.timeZone) },
      { header: "Last contacted", value: (row) => stamp(row.last_contacted_at, context.timeZone) },
      { header: "Logged messages", value: (row) => row.messages },
      { header: "Converted", value: (row) => (row.application_id ? "yes" : "no") },
      { header: "Profile from", value: (row) => row.profile_source },
    ],
    rows
  );
}

export function messageSheet(rows: MessageRow[], context: SheetContext): ExportSheet {
  return sheet(
    "Messages",
    context,
    [
      { header: "Sent", value: (row) => stamp(row.created_at, context.timeZone) },
      { header: "Channel", value: (row) => row.channel },
      { header: "Direction", value: (row) => row.direction },
      { header: "Recipient", value: (row) => row.recipient },
      { header: "Subject", value: (row) => row.subject },
      { header: "Candidate", value: (row) => row.full_name },
      { header: "Opening", value: (row) => row.opening },
      {
        header: "Delivered",
        value: (row) =>
          row.channel === "IN_APP" ? "written to inbox" : row.delivered ? "yes" : "no",
      },
      { header: "Read", value: (row) => stamp(row.read_at, context.timeZone) },
      { header: "Error", value: (row) => row.error_message },
    ],
    rows
  );
}

export function panelSheet(rows: PanelRow[], context: SheetContext): ExportSheet {
  return sheet(
    "Interviews",
    context,
    [
      { header: "Scheduled", value: (row) => stamp(row.scheduled_at, context.timeZone) },
      { header: "Candidate", value: (row) => row.full_name },
      { header: "Opening", value: (row) => row.opening },
      { header: "Interviewer", value: (row) => row.interviewer },
      { header: "Status", value: (row) => row.status },
      { header: "Minutes", value: (row) => row.duration_minutes },
      { header: "Booked on", value: (row) => stamp(row.created_at, context.timeZone) },
      {
        header: "Lead days",
        value: (row) => daysBetween(row.application_created_at, row.scheduled_at),
      },
      { header: "Calendar", value: (row) => row.calendar_provider },
      { header: "Meeting link", value: (row) => row.meeting_link },
    ],
    rows
  );
}

/**
 * The candidates console's own columns, widened to what a recruiter works from
 * offline: the tracking code they would quote back, both numbers the test has,
 * and the next slot on the calendar.
 */
export function candidateListSheet(
  rows: CandidateListRow[],
  context: SheetContext
): ExportSheet {
  return sheet(
    "Candidates",
    context,
    [
      { header: "Candidate", value: (row) => row.full_name },
      { header: "Tracking code", value: (row) => row.tracking_code },
      { header: "Email", value: (row) => row.email },
      { header: "Phone", value: (row) => row.phone },
      { header: "Role", value: (row) => row.job_title },
      { header: "Company", value: (row) => row.company_name },
      {
        header: "Stage",
        value: (row) => (row.archived_at ? `${row.stage} (filed)` : row.stage),
      },
      { header: "Source", value: (row) => row.source },
      { header: "AI fit %", masked: true, value: (row) => row.ai_match_score },
      {
        header: "Assessment",
        value: (row) => (row.attempt_status ? row.attempt_status.replace("_", " ") : "Not assigned"),
      },
      { header: "Test score", masked: true, value: (row) => row.attempt_score },
      { header: "Out of", masked: true, value: (row) => row.attempt_max },
      { header: "Applied", value: (row) => stamp(row.created_at, context.timeZone) },
      { header: "Last update", value: (row) => stamp(row.updated_at, context.timeZone) },
      { header: "Next panel", value: (row) => stamp(row.next_panel_at, context.timeZone) },
      { header: "Hired on", value: (row) => stamp(row.hired_at, context.timeZone) },
      { header: "Rejection reason", value: (row) => row.rejection_reason },
    ],
    rows
  );
}

/* -------------------------------------------------------------- documents -- */
export interface DocumentContext extends SheetContext {
  /**
   * How this file was cut: a window for a report, a filter set for a list.
   *
   * Written into every format, because a spreadsheet that says "Applications"
   * without saying which ones is how a filtered export gets read as a total.
   */
  scope: string;
  generatedAt: string;
  /** Named in every file, so a forwarded export still says who pulled it. */
  exportedBy: string;
  /** What goes into a file name: "sharm-dreams-pipeline-90-2026-10-15". */
  baseName: string;
}

function metaFor(context: DocumentContext): { label: string; value: string }[] {
  return [
    { label: "Covers", value: context.scope },
    { label: "Time zone", value: context.timeZone },
    { label: "Generated", value: stamp(context.generatedAt, context.timeZone) || context.generatedAt },
    { label: "Exported by", value: context.exportedBy },
  ];
}

/** The aggregate report as one Section / Metric / Value sheet. */
export function analyticsDocument(
  report: AnalyticsReport,
  context: DocumentContext
): ExportDocument {
  const rows: ExportCell[][] = [];
  const add = (section: string, metric: string, value: ExportCell) =>
    rows.push([section, metric, value]);

  const a = report.assessments;
  add("assessments", "issued", a.issued);
  add("assessments", "opened", a.opened);
  add("assessments", "submitted", a.submitted);
  add("assessments", "graded", a.graded);
  add("assessments", "in_progress", a.inProgress);
  add("assessments", "not_started", a.notStarted);
  add("assessments", "expired", a.expired);
  add("assessments", "open_rate_percent", a.openRate);
  add("assessments", "finish_rate_percent", a.finishRate);
  add("assessments", "median_hours_to_open", a.medianInviteToOpenHours);
  add("assessments", "median_minutes_on_test", a.medianTimeOnTestMinutes);
  if (report.scoresHidden) {
    add("assessments", "score_distribution", "withheld from this account");
  } else {
    add("assessments", "median_score_percent", a.medianScorePercent);
    for (const band of a.scoreBands) add("assessments", `score_${band.label}`, band.count);
  }

  const s = report.sourcing;
  add("sourcing", "prospects", s.total);
  add("sourcing", "contacted", s.contacted);
  add("sourcing", "replied", s.replied);
  add("sourcing", "interview", s.interviewing);
  add("sourcing", "converted", s.converted);
  add("sourcing", "passed", s.passed);
  add("sourcing", "median_hours_to_first_contact", s.medianHoursToFirstContact);
  add("sourcing", "reply_rate_percent", s.replyRate);
  add("sourcing", "conversion_rate_percent", s.conversionRate);

  for (const row of report.messages.byChannel) {
    add("messages", `${row.channel}_sent`, row.sent);
    add(
      "messages",
      `${row.channel}_delivered`,
      row.delivered ?? "not measured — a notice is written, not delivered"
    );
    add(
      "messages",
      `${row.channel}_undelivered`,
      row.undelivered ?? "not measured — a notice is written, not delivered"
    );
    if (row.channel === "IN_APP") add("messages", "IN_APP_read", row.read);
  }

  const i = report.interviews;
  add("interviews", "booked", i.booked);
  add("interviews", "completed", i.completed);
  add("interviews", "cancelled", i.cancelled);
  add("interviews", "no_show", i.noShow);
  add("interviews", "upcoming", i.upcoming);
  add("interviews", "no_show_rate_percent", i.noShowRate);
  add("interviews", "median_lead_days", i.medianLeadDays);
  for (const panel of i.byInterviewer) add("interviews", `panels:${panel.name}`, panel.panels);

  return {
    title: `Hiring analytics, ${context.scope}`,
    description:
      "Aggregates over the window: whether issued tests get opened and finished, how an outbound pool converts, whether messages land and how loaded the interview panel is.",
    meta: metaFor(context),
    limitations: report.limitations,
    sheets: [{ name: "Summary", columns: ["Section", "Metric", "Value"], rows }],
    baseName: context.baseName,
  };
}

/** One row-level list, with its own caveats riding along in the file. */
export function rowReportDocument(
  definition: ListDefinition,
  rows: ExportSheet,
  context: DocumentContext,
  /** The reader's caveats plus whatever the read could not deliver in full. */
  limitations: string[]
): ExportDocument {
  return {
    title: `${definition.label}, ${context.scope}`,
    description: definition.blurb,
    meta: [...metaFor(context), { label: "Rows in this file", value: String(rows.rows.length) }],
    limitations,
    sheets: [rows],
    baseName: context.baseName,
  };
}
