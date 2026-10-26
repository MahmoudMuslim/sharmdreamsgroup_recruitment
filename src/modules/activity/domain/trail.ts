/**
 * The shape of the portal's change trail.
 *
 * One row answers "who changed what, when" — including the changes nobody made
 * by hand, which is what makes this table different from the two partial ledgers
 * it sits beside (`settings_audit_log` stores values without a reliable actor,
 * `credential_audit_log` stores only provider secrets). A row is written by the
 * code that performed the write, because that is the only place that knows
 * whether a person, a model, a candidate or a scheduler caused it.
 *
 * Pure by design — no database, no `server-only` — so a client console can read
 * the vocabulary and filter by it exactly as the writers do.
 */

import type { StaffLink } from "@/lib/auth/staffRoutes";

export const ACTOR_KINDS = ["STAFF", "AI", "CANDIDATE", "SYSTEM"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ACTOR_KIND_LABELS: Record<ActorKind, string> = {
  STAFF: "Person",
  AI: "AI",
  CANDIDATE: "Candidate",
  SYSTEM: "Scheduler",
};

/**
 * What the portal calls the surface a change arrived through.
 *
 * `area` says which part of the hiring data moved; `via` says how the request
 * got there. A stage move clicked in the candidates console and the same move
 * made by the assistant's tool are the same area through two surfaces, and the
 * console has to be able to tell them apart.
 */
export const ACTIVITY_SURFACES = [
  "console",
  "assistant",
  "career site",
  "assessment runner",
  "cron",
  "webhook",
  "system",
] as const;
export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number];

/** Which part of the portal a change touched. Every writer picks one of these. */
export const ACTIVITY_AREAS = [
  "candidates",
  "jobs",
  "forms",
  "assessments",
  "interviews",
  "onboarding",
  "sourcing",
  "gate questions",
  "files",
  "messaging",
  "time",
  "settings",
  "team",
  "access",
  "master data",
  "career site",
  "referrals",
  "privacy",
  "system",
] as const;
export type ActivityArea = (typeof ACTIVITY_AREAS)[number];

/** The record a row points at, used to pull one candidate's or job's history. */
export const ACTIVITY_ENTITIES = [
  "application",
  "application form",
  "assistant session",
  "attempt",
  "attachment",
  "assessment question",
  "assessment template",
  "company",
  "credential",
  "currency",
  "department",
  "gate question",
  "interview",
  "job opening",
  "location",
  "message",
  "model routing",
  "onboarding plan",
  "onboarding task",
  "person health data",
  "position",
  "prospect",
  "referral",
  "role",
  "role family",
  "setting",
  "skill",
  "staff user",
  "scheduled message",
  "template",
  "time entry",
  "user invite",
] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

/** A change as its writer describes it. Only `summary` is shown in the list. */
export interface ActivityEntry {
  area: ActivityArea;
  action: string;
  entity: ActivityEntity;
  entityId?: string | null;
  summary: string;
  /** Field-by-field before/after. Passed through `redactDetail` before it lands. */
  detail?: Record<string, unknown> | null;
  companyId?: string | null;
  /**
   * The human account accountable for the change. For an AI-made change this is
   * the person whose request caused it — null when nobody asked, as in a cron
   * sweep or a candidate's own submission.
   */
  actorId?: string | null;
  actorKind?: ActorKind;
  /** Who actually wrote the row: a named person, an engine, a dispatcher. */
  actorLabel?: string;
  via?: ActivitySurface;
}

/** A trail row as the console reads it. */
export interface ActivityRow {
  id: string;
  created_at: string;
  area: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  actor_kind: ActorKind;
  actor_label: string;
  via: string;
  company_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
}

export interface ActivityFilters {
  area: ActivityArea | null;
  actorKind: ActorKind | null;
  surface: ActivitySurface | null;
  /** Narrows to the history of one record, e.g. a single application. */
  entity?: string | null;
  entityId?: string | null;
  /** Free text over the summary and the actor label. */
  query?: string | null;
  since?: string | null;
  limit?: number;
  /**
   * Which page of the cut to read, 1-based. Absent means page 1, which is the
   * whole of what a download asks for — an export wants every row the cut holds,
   * not the screen's slice of it, so the export route never sets this.
   */
  page?: number;
}

export function isActivityArea(value: unknown): value is ActivityArea {
  return typeof value === "string" && (ACTIVITY_AREAS as readonly string[]).includes(value);
}

export function isActorKind(value: unknown): value is ActorKind {
  return typeof value === "string" && (ACTOR_KINDS as readonly string[]).includes(value);
}

export function isActivitySurface(value: unknown): value is ActivitySurface {
  return (
    typeof value === "string" && (ACTIVITY_SURFACES as readonly string[]).includes(value)
  );
}

/**
 * How far back the console looks.
 *
 * The hours are a constant, never a timestamp: the client picks a length and the
 * server does the arithmetic against its own clock, so nobody can ask the trail
 * for "rows before 2020" through a query string, and the screen cannot drift a
 * window by keeping an old `since` in state.
 */
export const TRAIL_WINDOWS = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
  { key: "90d", label: "90 days", hours: 24 * 90 },
  { key: "all", label: "Everything", hours: null },
] as const;
export type TrailWindowKey = (typeof TRAIL_WINDOWS)[number]["key"];

export function isTrailWindow(value: unknown): value is TrailWindowKey {
  return TRAIL_WINDOWS.some((option) => option.key === value);
}

export interface TrailWindow {
  readonly key: TrailWindowKey;
  readonly label: string;
  readonly hours: number | null;
}

/** The window for a key, defaulting to 30 days rather than refusing the read. */
export function trailWindow(key: unknown): TrailWindow {
  return TRAIL_WINDOWS.find((option) => option.key === key) ?? TRAIL_WINDOWS[2];
}

export const ACTIVITY_LIMITS = {
  summary: 400,
  actorLabel: 160,
  entityId: 64,
  /** A detail value longer than this is summarised, never stored whole. */
  detailValue: 240,
} as const;

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Fields whose values must never reach the trail.
 *
 * An audit row that stores a CV's full text, a message body or a rotated secret
 * turns the trail into a second, less protected copy of the data it polices: it
 * is read by more roles and kept longer. The key is still recorded — that a
 * value changed is the point of the row — with the value withheld.
 */
const WITHHELD_KEY =
  /secret|password|passwd|token|api[_-]?key|authorization|credential|cv_text|cv_file|body|raw_text|transcript|answer/i;

const WITHHELD = "[withheld]";

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return clamp(String(value), ACTIVITY_LIMITS.detailValue);
}

/** Caps what a writer may attach, and drops the values that must not be kept. */
export function redactDetail(
  detail: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!detail) return null;

  const out: Record<string, unknown> = {};
  let kept = 0;

  for (const [key, value] of Object.entries(detail)) {
    if (kept >= 24) break;
    if (value === undefined) continue;

    if (WITHHELD_KEY.test(key)) {
      out[key] = WITHHELD;
      kept += 1;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = clamp(
        value.map((item) => scalar(item) ?? "").join(", "),
        ACTIVITY_LIMITS.detailValue
      );
      kept += 1;
      continue;
    }

    if (value !== null && typeof value === "object") {
      // Nested shapes are flattened one level: the trail is a reading record,
      // not a document store.
      const flat = Object.entries(value as Record<string, unknown>)
        .map(([inner, innerValue]) => `${inner}: ${scalar(innerValue) ?? ""}`)
        .join("; ");
      out[key] = clamp(flat, ACTIVITY_LIMITS.detailValue);
      kept += 1;
      continue;
    }

    out[key] = scalar(value);
    kept += 1;
  }

  return Object.keys(out).length ? out : null;
}

/** A one-line account of the change, always short enough to store. */
export function summarize(summary: string): string {
  return clamp(summary.replace(/\s+/g, " ").trim(), ACTIVITY_LIMITS.summary);
}

/**
 * A stored value in the words a trail row prints: short, and never an empty cell.
 *
 * Foreign keys print as their first eight characters because the console's Record
 * column carries the full id — a uuid in a field diff is unreadable noise.
 */
export function printableValue(value: unknown, depth = 1): string {
  if (value === null || value === undefined || value === "") return "nothing";
  if (Array.isArray(value)) return value.length === 0 ? "no items" : `${value.length} items`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Question configs and permission payloads are the interesting half of a
    // diff, so one level is unpacked rather than reported as an opaque object.
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 4);
    if (entries.length === 0) return "nothing";
    return entries.map(([key, inner]) => `${key}: ${printableValue(inner, depth - 1)}`).join(", ");
  }
  const text = String(value);
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)) return text.slice(0, 8);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * The columns a write actually moved, as `field: old → new`.
 *
 * Every edit form sends its whole row back, so a writer that reported the patch
 * as-is would fill the trail with edits nobody can point at. Only the fields that
 * differ are named.
 */
export function changedFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  keys?: readonly string[]
): Record<string, string> {
  const edits: Record<string, string> = {};
  for (const key of keys ?? Object.keys(patch)) {
    if (!(key in patch)) continue;
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(patch[key] ?? null)) continue;
    edits[key] = `${printableValue(before[key])} → ${printableValue(patch[key])}`;
  }
  return edits;
}

/**
 * The columns a *form* actually moved.
 *
 * A text input posts `"100"` where the column holds `100`, and a `numeric(3,2)`
 * column reads back as `"0.30"` for the `0.3` the slider carries. Comparing those
 * strictly fills the trail with edits nobody made, so numbers are compared as
 * numbers and everything else as the words the row prints. Use `changedFields`
 * where a column holds a document — a question config or a requirements array —
 * whose inner values must not be flattened.
 */
export function scalarEdits(
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, string> {
  const edits: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in before)) {
      edits[key] = `set to ${printableValue(value)}`;
      continue;
    }
    const was = before[key];
    const moved =
      typeof value === "number" || typeof was === "number"
        ? Number(was) !== Number(value)
        : printableValue(was) !== printableValue(value);
    if (!moved) continue;
    edits[key] = `${printableValue(was)} → ${printableValue(value)}`;
  }
  return edits;
}

/** `changed 3 fields (title, status, location)` — the summary over a diff. */
export function changePhrase(edits: Record<string, string>): string {
  const names = Object.keys(edits);
  if (names.length === 0) return "saved without changing a field";
  const shown = names.slice(0, 5).join(", ");
  return `changed ${names.length} field${names.length === 1 ? "" : "s"} (${shown}${
    names.length > 5 ? ", …" : ""
  })`;
}

export function clampActorLabel(label: string): string {
  return clamp(label, ACTIVITY_LIMITS.actorLabel);
}

/**
 * How a row reads in the console.
 *
 * A person's change is their name. An AI's change names the engine and, when a
 * recruiter caused it, says so — "AI screening engine · at your request" is the
 * difference between an accountable machine and a mysterious one.
 */
export function describeActor(row: Pick<ActivityRow, "actor_kind" | "actor_label" | "actor_name">): string {
  if (row.actor_kind === "AI") {
    return row.actor_name ? `${row.actor_label} · on ${row.actor_name}'s request` : row.actor_label;
  }
  if (row.actor_kind === "CANDIDATE") {
    return row.actor_name ?? row.actor_label;
  }
  return row.actor_name ?? row.actor_label;
}

/**
 * What the trail is, in the words both the screen and the download use.
 *
 * Kept here rather than in the document builder so a client console can quote
 * the same caveats a file carries — two copies of a list of limitations is how
 * one of them stops being true.
 */
export const TRAIL_LIST = {
  label: "Change trail",
  blurb:
    "One row per change to the hiring data or the platform: who or what made it, when, which record it touched, and what the change was. Changes made by the AI engine, a candidate or a scheduler are named as such, with the person accountable behind them when there is one.",
  caveats: [
    "The trail begins on the day its table was created. Changes made before it are not here, and history cannot be rebuilt from the rows that exist.",
    "Values that must not be kept — CV text, message bodies, transcripts, credentials — are recorded as [withheld]. That a field changed is the record; its content is not.",
    "Only the writers that were wired to the trail leave a row. A change made through a screen that has not been wired yet appears nowhere, so an empty stretch can mean a change nobody recorded rather than one that did not happen.",
    "This table is written by the portal, not by the database. A change made directly in the database — by hand or by a migration — is not recorded.",
    "Nothing is deleted from the trail, and nothing expires. A row outlives the record it describes: an archived candidate's changes stay countable.",
  ],
};

/** The verb phrase shown beside the actor, derived from the stored action key. */
export function prettyAction(action: string): string {
  return action.replace(/[_.]/g, " ").replace(/^\w/, (c) => c.toUpperCase()).toLowerCase();
}

/**
 * Where a row points back to.
 *
 * Only a handful of records have a deep link: an application row lands on that
 * person's own profile page, which is keyed by their address rather than by the
 * row, so a trail of stage moves across three openings reads as one candidate's
 * story. Everything else links to the console that holds it, which is said in the
 * label rather than promised by it — an audit row should not look like a bookmark
 * it is not.
 */
export function recordHref(
  entity: string,
  entityId: string | null
): { href: StaffLink; label: string } | null {
  const uuid = typeof entityId === "string" && /^[0-9a-f]{8}([0-9a-f-]{28,56})$/i.test(entityId);

  if (entity === "application" && uuid) {
    return {
      href: `/candidates/${entityId}`,
      label: "Open their profile",
    };
  }

  const CONSOLES: Partial<Record<ActivityEntity, { href: StaffLink; label: string }>> = {
    attempt: { href: "/candidates", label: "Candidate console" },
    "job opening": { href: "/jobs", label: "Jobs board" },
    interview: { href: "/interviews", label: "Interview agenda" },
    "onboarding plan": { href: "/onboarding", label: "Onboarding" },
    "onboarding task": { href: "/onboarding", label: "Onboarding" },
    prospect: { href: "/sourcing", label: "Sourcing pool" },
    referral: { href: "/referrals", label: "Referral book" },
    "gate question": { href: "/questions?store=gate", label: "Question bank — apply form" },
    attachment: { href: "/files", label: "File manager" },
    message: { href: "/whatsapp", label: "Outbox" },
    "scheduled message": { href: "/whatsapp", label: "Outbox" },
    "assessment template": { href: "/assessments", label: "Test suites" },
    "assessment question": { href: "/assessments", label: "Test suites" },
    "assistant session": { href: "/assistant", label: "Assistant history" },
    "model routing": { href: "/settings?area=providers&section=models", label: "AI models" },
    credential: { href: "/settings?area=providers&section=credentials", label: "API keys" },
    "user invite": { href: "/settings?area=access&section=team", label: "Team" },
    setting: { href: "/settings", label: "Settings" },
    template: { href: "/settings?area=access&section=templates", label: "Message templates" },
    "time entry": { href: "/time", label: "Time ledger" },
    role: { href: "/settings?area=access&section=permissions", label: "Roles & permissions" },
    "staff user": { href: "/settings?area=access&section=team", label: "Team" },
    company: { href: "/settings?area=organisation&section=companies", label: "Companies" },
    department: { href: "/settings?area=organisation&section=departments", label: "Departments" },
    location: { href: "/settings?area=organisation&section=locations", label: "Locations" },
    currency: { href: "/settings?area=organisation&section=currencies", label: "Currencies" },
    "role family": { href: "/settings?area=organisation&section=role_families", label: "Role families" },
    skill: { href: "/settings?area=organisation&section=skills", label: "Skills" },
    position: { href: "/settings?area=organisation&section=positions", label: "Positions" },
  };

  return CONSOLES[entity as ActivityEntity] ?? null;
}
