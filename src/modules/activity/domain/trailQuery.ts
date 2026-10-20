/**
 * Turns the filter bag a console (or a download link) sends into a read the
 * database will accept.
 *
 * Both doors — the server action and the export route — go through here, so a
 * CSV cannot be cut by a filter the screen would have refused. That is the whole
 * reason the coercion does not live in the page: two parsers drift, and one of
 * them starts trusting a query string.
 *
 * Pure, and deliberately in `domain/` rather than `application/`: the screen
 * builds its own download URLs from the cut it is holding, so it imports
 * `queryToParams`, and a client component cannot import a module that declares
 * `server-only`. Nothing here touches the database or the session — the server
 * re-coerces every query string on the way to the read regardless of what the
 * client computed.
 */

import {
  ACTIVITY_ENTITIES,
  ACTOR_KIND_LABELS,
  isActivityArea,
  isActivitySurface,
  isActorKind,
  isTrailWindow,
  trailWindow,
  type ActivityArea,
  type ActivityFilters,
  type ActivitySurface,
  type ActorKind,
  type TrailWindowKey,
} from "@/modules/activity/domain/trail";
import { parsePage } from "@/lib/paging";

/**
 * How deep one page of the trail is.
 *
 * A page and not a ceiling: the console walks the trail with a pager, so the read
 * behind it asks the database for one page at a time instead of for the newest
 * 120 rows and a note saying the rest are in a download. A download still asks for
 * `EXPORT_ROWS`, which is the module's own ceiling.
 */
export const TRAIL_PAGE_ROWS = 40;

/**
 * A record id as the trail stores them: UUIDs, and short codes for anything
 * without one. The charset is what makes the value safe to hand to an `eq`
 * filter — no operator can be spelled with these characters.
 */
const ID_PATTERN = /^[0-9a-z][0-9a-z_-]{6,63}$/i;

export interface TrailQuery {
  area?: unknown;
  actorKind?: unknown;
  surface?: unknown;
  entity?: unknown;
  entityId?: unknown;
  query?: unknown;
  window?: unknown;
  page?: unknown;
}

/** The filters as the server accepted them, so a reader describes these, not its own state. */
export interface AppliedFilters {
  area: ActivityArea | null;
  actorKind: ActorKind | null;
  surface: ActivitySurface | null;
  entity: string | null;
  entityId: string | null;
  query: string;
  window: TrailWindowKey;
}

export interface ResolvedTrailQuery {
  filters: ActivityFilters;
  applied: AppliedFilters;
}

/**
 * @param now the moment the window is measured back from, supplied by the server
 *   route that owns the read. This module stays free of the clock so a page
 *   render cannot quietly become non-dynamic by calling it.
 */
export function resolveTrailQuery(
  raw: TrailQuery,
  limit: number,
  now: Date
): ResolvedTrailQuery {
  const area = isActivityArea(raw.area) ? raw.area : null;
  const actorKind = isActorKind(raw.actorKind) ? raw.actorKind : null;
  const surface = isActivitySurface(raw.surface) ? raw.surface : null;
  const entity =
    typeof raw.entity === "string" &&
    (ACTIVITY_ENTITIES as readonly string[]).includes(raw.entity)
      ? raw.entity
      : null;
  const entityId =
    typeof raw.entityId === "string" && ID_PATTERN.test(raw.entityId) ? raw.entityId : null;
  const query = typeof raw.query === "string" ? raw.query.trim().slice(0, 80) : "";
  const win = isTrailWindow(raw.window) ? raw.window : "30d";
  const bounds = trailWindow(win);

  return {
    applied: { area, actorKind, surface, entity, entityId, query, window: win },
    filters: {
      area,
      actorKind,
      surface,
      entity,
      entityId,
      query: query || null,
      limit,
      page: parsePage(raw.page as string | number | null | undefined),
      since:
        bounds.hours === null
          ? null
          : new Date(now.getTime() - bounds.hours * 3_600_000).toISOString(),
    },
  };
}

/** One line saying what a list is cut by — shown on screen and written into every file. */
export function scopeFor(applied: AppliedFilters): string {
  const bounds = trailWindow(applied.window);
  const parts = [
    bounds.hours === null ? "everything on record" : `last ${bounds.label.toLowerCase()}`,
    applied.actorKind ? `${ACTOR_KIND_LABELS[applied.actorKind]}-made` : null,
    applied.surface ? `through the ${applied.surface}` : null,
    applied.area ? `${applied.area} only` : null,
    applied.entity
      ? applied.entityId
        ? `history of one ${applied.entity}`
        : `${applied.entity} records`
      : null,
    applied.query ? `matching “${applied.query}”` : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** The same cut, spelled back as query parameters for the download links. */
export function queryToParams(applied: AppliedFilters): URLSearchParams {
  const params = new URLSearchParams({ window: applied.window });
  if (applied.area) params.set("area", applied.area);
  if (applied.actorKind) params.set("actorKind", applied.actorKind);
  if (applied.surface) params.set("surface", applied.surface);
  if (applied.entity) params.set("entity", applied.entity);
  if (applied.entityId) params.set("entityId", applied.entityId);
  if (applied.query) params.set("q", applied.query);
  return params;
}

export function paramsToQuery(params: URLSearchParams): TrailQuery {
  return {
    area: params.get("area"),
    actorKind: params.get("actorKind"),
    surface: params.get("surface"),
    entity: params.get("entity"),
    entityId: params.get("entityId"),
    query: params.get("q"),
    window: params.get("window"),
    // Absent on a download URL, which is built by `queryToParams` and never
    // carries a page: an export wants the whole cut, not the screen's slice.
    page: params.get("page"),
  };
}
