/**
 * The write door's check on a criterion's skill tag.
 *
 * The browser picks an id; the catalogue owns the name. Resolving here means a
 * criterion cannot be labelled with a skill the catalogue does not hold, and a
 * retired skill cannot be attached to new work by a stale form or a chat model.
 * Only the id is accepted from the caller — a name sent with the draft is
 * dropped, not trusted.
 *
 * This module deliberately does not import `getSkillsCatalogue`: that module is
 * server-only, and the rule is unit-tested in plain Node. One narrow `skills`
 * read is the whole dependency.
 */

import type { RestClient } from "@/lib/rest/client";
import type { RubricCriterion } from "@/types";

type Readable = Pick<RestClient, "from">;

export interface SkillOption {
  id: string;
  name: string;
}

export type SkillTagResolution =
  | { ok: true; criteria: RubricCriterion[] }
  | { ok: false; error: string };

interface CatalogueRow {
  id: string;
  name: string;
  is_active: boolean;
}

function withoutTag(criterion: RubricCriterion): RubricCriterion {
  return {
    label: criterion.label,
    weight: criterion.weight,
    ...(criterion.description ? { description: criterion.description } : {}),
  };
}

export async function resolveSkillTags(
  restClient: Readable,
  criteria: readonly RubricCriterion[]
): Promise<SkillTagResolution> {
  const ids = criteria
    .map((criterion) => criterion.skill_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  if (ids.length === 0) {
    return { ok: true, criteria: criteria.map(withoutTag) };
  }

  const { data, error } = await restClient.from("skills").select("id, name, is_active");
  if (error) {
    return {
      ok: false,
      error: `The skills catalogue could not be read, so this rubric's skill tags were not saved: ${error.message}.`,
    };
  }

  const byId = new Map(
    ((data ?? []) as CatalogueRow[]).map((row) => [row.id, row] as const)
  );

  const resolved: RubricCriterion[] = [];
  for (const criterion of criteria) {
    const skillId = criterion.skill_id?.trim();
    if (!skillId) {
      resolved.push(withoutTag(criterion));
      continue;
    }
    const row = byId.get(skillId);
    if (!row) {
      return {
        ok: false,
        error: `“${criterion.label}” is tagged with a skill this catalogue does not hold. Pick a skill from the list, or leave the criterion untagged.`,
      };
    }
    if (row.is_active !== true) {
      return {
        ok: false,
        error: `“${criterion.label}” is tagged with “${row.name}”, which has been retired from the skills catalogue. Pick an active skill, or leave the criterion untagged.`,
      };
    }
    resolved.push({
      label: criterion.label,
      weight: criterion.weight,
      ...(criterion.description ? { description: criterion.description } : {}),
      skill_id: row.id,
      skill_name: row.name,
    });
  }

  return { ok: true, criteria: resolved };
}
