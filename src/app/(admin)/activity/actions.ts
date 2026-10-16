"use server";

import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import {
  readActivityTally,
  readActivityTrail,
  type TrailReadResult,
} from "@/modules/activity/application/record";
import {
  resolveTrailQuery,
  scopeFor,
  SCREEN_ROWS,
  type AppliedFilters,
  type TrailQuery,
} from "@/modules/activity/domain/trailQuery";
import type { ActivityRow, ActorKind } from "@/modules/activity/domain/trail";

export type { AppliedFilters, TrailQuery } from "@/modules/activity/domain/trailQuery";

const AUDIT_DENIED =
  "Reading the change trail needs the Manage platform settings permission.";

export interface TrailView {
  rows: ActivityRow[];
  total: number;
  more: boolean;
  /** One line saying what this list is cut by, written into the downloads too. */
  scope: string;
  timeZone: string;
  filters: AppliedFilters;
  /** All-time split by who caused a change, so the pills can show their weight. */
  tally: Record<ActorKind, number>;
}

export interface TrailPreview {
  ok: boolean;
  error?: string;
  view?: TrailView;
}

/**
 * One page of the trail, re-checked on every call.
 *
 * The page renders the first cut server-side and this action serves the rest, so
 * both ask the database for `settings.manage_platform` rather than trusting the
 * caller — a server action is a public endpoint.
 */
export async function getTrail(raw: TrailQuery = {}): Promise<TrailPreview> {
  await requireStaff("/activity");
  if (!(await hasPermissionForUser("settings.manage_platform"))) {
    return { ok: false, error: AUDIT_DENIED };
  }

  const { filters, applied } = resolveTrailQuery(raw, SCREEN_ROWS, new Date());

  const [read, tally, timeZone]: [TrailReadResult, Record<ActorKind, number>, string] =
    await Promise.all([
      readActivityTrail(filters),
      readActivityTally(),
      getOrganisationTimeZone(),
    ]);

  // Shown instead of an empty feed: a trail that could not be read is not the
  // same statement as a trail with nothing in it.
  if (read.error) return { ok: false, error: read.error };

  return {
    ok: true,
    view: {
      rows: read.rows,
      total: read.total,
      more: read.more,
      scope: scopeFor(applied),
      timeZone,
      filters: applied,
      tally,
    },
  };
}
