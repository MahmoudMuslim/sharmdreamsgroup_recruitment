import type { StaffRoute } from "@/lib/auth/staffRoutes";

/**
 * One table the portal reads, described by what a write to it does.
 *
 * `stamp` is the column every write moves — a table with an `updated_at`
 * trigger, or one that is only ever inserted into. `columns` is used instead
 * when the table has no such column: the watched values of its newest rows are
 * hashed, so an edit that moves no timestamp still moves the fingerprint.
 */
export interface LiveWatch {
  /** Shown back to the browser, so the badge can name what moved. */
  area: string;
  table: string;
  stamp?: string;
  columns?: string[];
  /**
   * Portal pages that have to re-read when this area moves.
   *
   * A page name typed wrong here is not a broken link someone can click — it is
   * a page that silently never refreshes, on a watch list nobody reads twice.
   * Hence `StaffRoute`, and hence bare prefixes: the browser matches these the
   * same way the edge guard matches a pathname.
   */
  paths: readonly StaffRoute[];
}

/**
 * The hiring data an open admin page shows, and the pages it shows on.
 *
 * Deliberately not "every table": settings, AI providers and the assistant are
 * read through their own screens and already re-read the moment you save, so a
 * poll on them would only cost queries.
 */
export const LIVE_WATCH: readonly LiveWatch[] = [
  {
    area: "pipeline",
    table: "applications",
    stamp: "updated_at",
    // `/referrals` is here because a claim's progress IS the linked application's
    // stage: the board reads it rather than copying it, so a stage move has to
    // reach the book the same way it reaches the candidates list.
    paths: ["/candidates", "/dashboard", "/analytics", "/reports", "/jobs", "/files", "/whatsapp", "/referrals"],
  },
  {
    // The claims themselves, and their own area for the reason the interview
    // notes are one: a missing table refuses only the area that names it. On a
    // database where db/migrations/040_referrals.sql has never run, an entry
    // shared with the pipeline would take its live reload down with it on eight
    // pages; on one where it has run, the book still fails alone if the table
    // ever goes unreadable.
    area: "referrals",
    table: "referrals",
    stamp: "updated_at",
    paths: ["/referrals"],
  },
  {
    area: "sourcing",
    table: "sourced_prospects",
    stamp: "updated_at",
    paths: ["/sourcing", "/dashboard"],
  },
  {
    // Watched by outcome, not by `draft_saved_at`: an applicant autosaving an
    // answer every 30 seconds would otherwise reload the recruiter's screen all
    // day. A submission moves `status`, so it still arrives live.
    area: "assessments",
    table: "candidate_attempts",
    columns: ["id", "status", "submitted_at", "total_score"],
    paths: ["/assessments", "/candidates", "/dashboard"],
  },
  {
    area: "interviews",
    table: "interview_schedules",
    columns: ["id", "application_id", "scheduled_at", "status", "meeting_link"],
    paths: ["/interviews", "/candidates", "/dashboard"],
  },
  {
    // A separate row per interviewer, so a colleague's scorecard is a different
    // table from the panel itself. `round` is deliberately not added to the watch
    // above: a missing column refuses a whole hashed area, and that would take
    // the agenda's live reload down with it while 032 is unapplied.
    area: "interview scorecards",
    table: "interview_scorecards",
    stamp: "updated_at",
    paths: ["/interviews"],
  },
  {
    // A third table for the same reason the scorecards are one: a note is a
    // separate row per writer, and 038's absence has to take only this area
    // down. A column added to the schedule watch instead would refuse the whole
    // hashed area while that migration is unapplied, stopping the agenda's live
    // reload over a table it does not need to refresh the calendar.
    area: "interview notes",
    table: "interview_notes",
    stamp: "updated_at",
    paths: ["/interviews"],
  },
  {
    area: "openings",
    table: "job_openings",
    columns: ["id", "title", "status", "closing_at", "department"],
    paths: ["/jobs", "/dashboard", "/candidates"],
  },
  {
    area: "onboarding",
    table: "onboarding_plans",
    columns: ["id", "progress", "checklist"],
    paths: ["/onboarding", "/dashboard"],
  },
  {
    area: "outreach",
    table: "communication_logs",
    columns: ["id", "delivered", "error_message", "read_at"],
    paths: ["/whatsapp", "/candidates", "/files"],
  },
  {
    // The other half of /whatsapp. A queued alert is not a delivery until the
    // dispatcher writes its log row, so without this the queue itself — a
    // colleague's retry, a cancel, a job flipping to parked — sits still while
    // the page claims it is live. `error_log` is left out: it grows on every
    // failed attempt and would reload the page for noise the list already shows.
    area: "queue",
    table: "scheduled_whatsapp_jobs",
    columns: ["id", "status", "scheduled_for", "attempts", "sent_at"],
    paths: ["/whatsapp"],
  },
  {
    // A save bumps `version`, and publish moves `status` — either is a change a
    // second recruiter's console has to see without a reload. `archived_at` is
    // included because retire is a write this list also shows.
    area: "forms",
    table: "application_forms",
    columns: ["id", "version", "status", "archived_at"],
    paths: ["/forms"],
  },
  {
    area: "gate questions",
    table: "application_gate_questions",
    stamp: "updated_at",
    // The bank lists these too. A suite's questions are not watched at all —
    // `assessment_questions` carries no created or updated stamp to watch — so
    // the bank's Live badge only ever refreshes on its apply-form half.
    paths: ["/questions"],
  },
  {
    area: "files",
    table: "application_attachments",
    stamp: "created_at",
    paths: ["/files", "/candidates"],
  },
  {
    // `updated_at` rather than `started_at`: stopping a timer moves the end and
    // the trigger's stamp, not the start, and a colleague's stop is exactly the
    // change a shared ledger has to show without a refresh.
    area: "time",
    table: "time_entries",
    stamp: "updated_at",
    paths: ["/time"],
  },
] as const;

/**
 * Whether an area's watched pages include this one.
 *
 * Prefix, not equality — the same rule `isStaffPath()` uses, because it is
 * answering the same question about the same list of page names: `/files` feeds
 * `/files` and anything nested under it. One definition, read by both the
 * browser that decides whether to reload and the server that decides what to
 * probe.
 */
export function pathFeeds(pages: readonly string[] | undefined, pathname: string): boolean {
  return (pages ?? []).some(
    (page) => pathname === page || pathname.startsWith(`${page}/`)
  );
}

/**
 * The areas a connection on this page has to watch.
 *
 * The live stream used to fingerprint every watched table for every open tab,
 * whether the page read it or not: a recruiter on `/time` cost twelve reads a
 * tick to learn about six areas they could not see. The browser now names the
 * page it is on, and only the areas whose paths feed that page are polled. The
 * page-level reload rule is unchanged — it was already filtered by the same
 * paths — so this removes reads, not freshness.
 *
 * A missing path means a client that did not say where it is; it keeps the old
 * full sweep so the endpoint still works without the parameter. A path that is
 * present but not absolute or not a staff page watches nothing rather than
 * falling back to the full list, so a page name this tree does not know cannot
 * become a reason to poll everything.
 */
export function watchForPath(raw: string | null): readonly LiveWatch[] {
  if (raw === null) return LIVE_WATCH;

  const pathname = raw.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!pathname.startsWith("/")) return [];

  return LIVE_WATCH.filter((watch) => pathFeeds(watch.paths, pathname));
}
