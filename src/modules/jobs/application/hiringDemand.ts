import "server-only";

import { createSupabaseServerClient } from "@/lib/data-api/server";
import { GRID_ROW_LIMIT } from "@/modules/jobs/domain/hireable";

type StaffClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** What the headcount read came back with: a per-opening target, or the fact it could not be had. */
export interface HeadcountRead {
  /** `job_openings.id` → `positions_needed`. Absent for an opening the read did not carry. */
  neededById: Map<string, number | null>;
  /** True when the read failed — the column is not applied yet, or the request was refused.
   * The grid says so rather than showing "no target set" for every role as if that were the data. */
  unavailable: boolean;
}

/**
 * The `positions_needed` target for the openings the grid holds.
 *
 * Read separately from the grid's own row read rather than folded into its
 * projection, because the column may not exist yet: this feature ships ahead of the
 * ALTER (migration 031 is authored, not applied), and putting an unreadable column
 * into the main `select` would 400 the entire read and blank the whole openings
 * page — including the pipeline and hire counts, which need no migration at all.
 * Isolated here, a missing column costs only the target figure, and the page keeps
 * answering.
 *
 * It reads the newest `GRID_ROW_LIMIT` openings in the grid's own order and is
 * matched back by id, not by position, so a row the two reads disagree about is
 * simply reported as "no target" rather than mismatched onto another opening.
 */
export async function getOpeningsHeadcount(supabase: StaffClient): Promise<HeadcountRead> {
  const { data, error } = await supabase
    .from("job_openings")
    .select("id, positions_needed")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, GRID_ROW_LIMIT - 1);

  if (error) return { neededById: new Map(), unavailable: true };

  const rows = (data ?? []) as unknown as { id: string; positions_needed: number | null }[];
  return {
    neededById: new Map(rows.map((row) => [row.id, row.positions_needed ?? null])),
    unavailable: false,
  };
}
