import "server-only";

/**
 * Writes and reads the portal's change trail.
 *
 * `recordActivity` is called by the code that performed the write, because only
 * that code knows who — or what — caused it. It never throws: a trail that can
 * break a hiring action would be switched off by its own cost, so a failed row
 * is logged and the caller's work stands. What it does report is the failure, in
 * the return value, for the handful of writers whose copy has to say whether the
 * record was kept.
 *
 * The context is how a change made deep inside a chain keeps its origin. The
 * assistant runs the same action a recruiter clicks; a cron sweep runs the same
 * grader a submit route calls. Rather than thread a "who asked for this"
 * parameter through every signature, the entry point opens a context and
 * everything written underneath inherits it.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionUser } from "@/lib/auth/session";
import {
  clampActorLabel,
  redactDetail,
  summarize,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityRow,
  type ActorKind,
  type ActivitySurface,
} from "@/modules/activity/domain/trail";

interface TrailContext {
  /** How the request arrived: console, assistant, cron, career site… */
  via?: ActivitySurface;
  /** What performed the writes underneath — a person or a machine. */
  actorKind?: ActorKind;
  /** The machine's own name when `actorKind` is not `STAFF`. */
  actorLabel?: string;
  /**
   * The person the machine acted for. A writer deep in a chain (an AI drafting
   * six questions, one row at a time) has no signature of its own to carry it,
   * so it inherits the owner from the context the entry point opened.
   */
  actorId?: string | null;
  companyId?: string | null;
}

const context = new AsyncLocalStorage<TrailContext>();

export async function withActivityContext<T>(
  overlay: TrailContext,
  run: () => Promise<T>
): Promise<T> {
  const inherited = context.getStore();
  return context.run({ ...inherited, ...overlay }, run);
}

export function currentActivityContext(): TrailContext {
  return context.getStore() ?? {};
}

export interface TrailWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Appends one row to the trail.
 *
 * Fields the writer leaves out are filled from the caller's surroundings: the
 * request context first, then the signed-in staff session, then a system actor
 * for the paths that have neither (a cron sweep, a candidate's own submission).
 */
export async function recordActivity(entry: ActivityEntry): Promise<TrailWriteResult> {
  const from = currentActivityContext();
  const session = await getSessionUser();

  const actorKind: ActorKind = entry.actorKind ?? from.actorKind ?? (session ? "STAFF" : "SYSTEM");
  const actorLabel = clampActorLabel(
    entry.actorLabel ??
      from.actorLabel ??
      (actorKind === "STAFF"
        ? session?.fullName ?? "Unknown staff member"
        : actorKind === "CANDIDATE"
          ? "Assessment runner"
          : actorKind === "AI"
            ? "AI engine"
            : "Scheduler")
  );

  const row = {
    company_id: entry.companyId ?? from.companyId ?? session?.tenantId ?? null,
    actor_id:
      entry.actorId !== undefined
        ? entry.actorId
        : from.actorId !== undefined
          ? from.actorId
          : actorKind === "STAFF"
            ? (session?.profileId ?? null)
            : null,
    actor_kind: actorKind,
    actor_label: actorLabel,
    via: entry.via ?? from.via ?? (actorKind === "SYSTEM" ? "cron" : "console"),
    area: entry.area,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ? entry.entityId.slice(0, 64) : null,
    summary: summarize(entry.summary),
    detail: redactDetail(entry.detail),
  };

  try {
    const { error } = await getSupabaseServiceClient().from("activity_log").insert(row);
    if (error) {
      console.error(`[activity] ${entry.area}/${entry.action} trail write refused:`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (cause) {
    console.error(`[activity] ${entry.area}/${entry.action} trail write failed:`, cause);
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * A named machine actor, for the writers that are not a person's own click.
 *
 * `requestedBy` is the human whose action caused the machine to run, kept on the
 * row so the console can say "the engine did this, at this person's request"
 * instead of either blaming the recruiter for a model's decision or letting the
 * decision have no owner at all.
 */
export function aiActivityActor(
  engine: string,
  requestedBy?: { profileId: string | null; companyId?: string | null } | null
): Pick<ActivityEntry, "actorKind" | "actorLabel" | "actorId" | "companyId"> {
  return {
    actorKind: "AI",
    actorLabel: clampActorLabel(engine),
    actorId: requestedBy?.profileId ?? null,
    companyId: requestedBy?.companyId ?? null,
  };
}

/**
 * A named engine, with the person accountable behind it when there is one.
 *
 * Engines run from both sides of the portal — a recruiter's button, the
 * assistant's tool, a candidate's own submission — and every one of those rows
 * names the machine rather than the person. `surfaceWithoutSession` says how the
 * request arrived when nobody is signed in, because the default surface is the
 * staff console and a candidate's submit route is not that.
 */
export async function engineActivityActor(
  engine: string,
  surfaceWithoutSession: ActivitySurface = "system"
): Promise<
  Pick<ActivityEntry, "actorKind" | "actorLabel" | "actorId" | "companyId" | "via">
> {
  const session = await getSessionUser();
  const ambient = currentActivityContext().via;
  return {
    ...aiActivityActor(
      engine,
      session ? { profileId: session.profileId, companyId: session.tenantId } : null
    ),
    via: session ? undefined : ambient ?? surfaceWithoutSession,
  };
}

/**
 * The ceiling on one read.
 *
 * The screen asks for far less; the download asks for this. It exists so no
 * filter — including "Everything" — can pull the whole table into memory.
 */
const MAX_ROWS = 2_000;

/** Escapes the two characters that would break a PostgREST `or=` filter. */
function likeTerm(value: string): string {
  return value.replace(/[,%]/g, " ").trim().slice(0, 80);
}

export interface TrailReadResult {
  rows: ActivityRow[];
  /** True when more matching rows exist than `limit` returned. */
  more: boolean;
  total: number;
  /**
   * Why the trail could not be read, or null when it could.
   *
   * A missing table and a refused read both return an empty list, and an empty
   * list is what "nothing has changed today" looks like. The console has to tell
   * those two apart, so the reason travels with the result instead of being
   * logged and dropped.
   */
  error: string | null;
}

/**
 * Reads the trail back through the caller's own session, so Row Level Security
 * — not this function — decides whether they may see it.
 */
export async function readActivityTrail(filters: ActivityFilters): Promise<TrailReadResult> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("activity_log")
    .select("id, created_at, area, action, entity, entity_id, summary, detail, actor_kind, actor_label, via, company_id, actor_id, user_profiles(full_name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (filters.area) query = query.eq("area", filters.area);
  if (filters.actorKind) query = query.eq("actor_kind", filters.actorKind);
  if (filters.surface) query = query.eq("via", filters.surface);
  if (filters.entity) query = query.eq("entity", filters.entity);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.since) query = query.gte("created_at", filters.since);

  const term = filters.query ? likeTerm(filters.query) : "";
  if (term) query = query.or(`summary.ilike.%${term}%,actor_label.ilike.%${term}%`);

  const limit = Math.min(Math.max(filters.limit ?? 120, 1), MAX_ROWS);
  const { data, count, error } = await query.limit(limit);

  if (error) {
    console.error("[activity] trail read refused:", error.message);
    const missing = /activity_log|does not exist|PGRST205/i.test(error.message);
    return {
      rows: [],
      more: false,
      total: 0,
      error: missing
        ? "The change trail has not been created yet. Apply supabase/migrations/024_activity_log.sql, then reload this page."
        : `The change trail could not be read: ${error.message}`,
    };
  }

  const rows = (data ?? []).map((row) => {
    const { user_profiles, ...rest } = row as Record<string, unknown> & {
      user_profiles: { full_name: string } | { full_name: string }[] | null;
    };
    const profile = Array.isArray(user_profiles) ? user_profiles[0] : user_profiles;
    return {
      ...rest,
      actor_name: profile?.full_name ?? null,
    } as unknown as ActivityRow;
  });

  return { rows, more: (count ?? 0) > rows.length, total: count ?? 0, error: null };
}

/** Counts the trail split by who caused it, for the console's own honesty check. */
export async function readActivityTally(): Promise<Record<ActorKind, number>> {
  const supabase = await createSupabaseServerClient();
  const tally = { STAFF: 0, AI: 0, CANDIDATE: 0, SYSTEM: 0 } as Record<ActorKind, number>;

  await Promise.all(
    (Object.keys(tally) as ActorKind[]).map(async (kind) => {
      const { count } = await supabase
        .from("activity_log")
        .select("id", { count: "exact", head: true })
        .eq("actor_kind", kind);
      tally[kind] = count ?? 0;
    })
  );

  return tally;
}
