"use server";

/**
 * Saving what a requisition asks for.
 *
 * This is the only door that writes `job_opening_skills`, and it is deliberately
 * not part of `updateJobOpening`: the opening's own columns live on a database
 * that has them, and this table is on a migration that has not been applied.
 * Folding the two into one request would mean an unapplied 037 refused every
 * edit of every opening — a cost on the whole screen for a feature on one picker.
 *
 * The order of the two writes is the whole safety story. There is no transaction
 * across REST, so the new rows go in first and the deselected ones come out
 * second: a failure in between leaves one skill on the list that ought to have
 * been removed, which the recruiter can see and save again. Doing it the other
 * way round would leave an opening with no requirements at all.
 *
 * What may be written is decided by the domain module, not here — the form, the
 * applicants drawer and the assistant all read the same rules. A list that fails
 * validation writes nothing at all, including no deletion, so a typo cannot
 * quietly empty an opening's requirements.
 */

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { recordActivity } from "@/modules/activity/application/record";
import { isMissingSchemaError } from "@/modules/jobs/domain/openingTerms";
import { readOpeningTitleAndStatus } from "@/infrastructure/repositories/jobOpening";
import {
  MAX_SKILL_LEVEL,
  MIN_SKILL_LEVEL,
  OPENING_SKILLS_WRITE_REFUSAL,
  SKILL_SOURCES,
  readRequiredSkills,
  type RequiredSkill,
} from "@/modules/jobs/domain/openingSkills";
import {
  getOpeningsRequiredSkills,
  getSkillsCatalogue,
} from "@/modules/jobs/application/openingSkillsRead";

export interface OpeningSkillsResult {
  ok: boolean;
  error?: string;
  /** The list as it now stands, so the caller repaints from the save rather than from what it sent. */
  skills?: RequiredSkill[];
}

/** Turns the errors this table can raise into recruiter language. */
function describeSkillsWriteError(error: { code?: string; message: string }): string {
  // The stored rows were read a moment ago, so reaching here is a schema cache
  // that has not caught up with the migration. Same answer as the read's: the
  // table is not there, and 037 is the file that says so.
  if (isMissingSchemaError(error)) return OPENING_SKILLS_WRITE_REFUSAL;
  if (error.code === "23503") {
    return "That skill is no longer in the master list, so it cannot be required. Reload the form and pick the skills again.";
  }
  if (error.code === "23514") {
    return `Each required skill carries a whole level from ${MIN_SKILL_LEVEL} to ${MAX_SKILL_LEVEL} and says how it was chosen: ${SKILL_SOURCES.join(" or ")}.`;
  }
  return error.message;
}

/**
 * Replaces one opening's required skills with the list a recruiter submitted.
 *
 * `rows` is untrusted: it arrives from the form's picker or from a chat tool, and
 * a list is only ever a list of ids plus levels until the catalogue says
 * otherwise.
 */
export async function saveOpeningSkills(
  jobId: string,
  rows: unknown
): Promise<OpeningSkillsResult> {
  await requireStaff("/jobs");
  if (!(await hasPermissionForUser("jobs.manage"))) {
    return { ok: false, error: "You need the Manage jobs permission." };
  }

  const restClient = await createServerRestClient();

  const found = await readOpeningTitleAndStatus(restClient, jobId);
  if (!found.ok) return { ok: false, error: "That opening no longer exists." };
  const opening = found.opening;

  const catalogue = await getSkillsCatalogue(restClient);
  if (!catalogue.available) {
    return { ok: false, error: catalogue.note ?? "The skills catalogue could not be read." };
  }

  const submitted = readRequiredSkills(rows, catalogue.skills);
  if (!submitted.ok) return { ok: false, error: submitted.error };

  const stored = await getOpeningsRequiredSkills(restClient, [jobId]);
  if (!stored.available) {
    return {
      ok: false,
      error: stored.missing ? OPENING_SKILLS_WRITE_REFUSAL : (stored.note ?? "Required skills could not be read."),
    };
  }

  const before = stored.requiredById.get(jobId) ?? [];
  const names = new Map(catalogue.skills.map((skill) => [skill.id, skill.name]));
  const keptIds = new Set(submitted.skills.map((skill) => skill.skill_id));
  const removed = before.filter((skill) => !keptIds.has(skill.skill_id));
  // Only what actually changed goes on the wire: re-saving the same list from the
  // drawer must not rewrite twelve rows or leave a trail row saying it did.
  const changed = submitted.skills.filter((skill) => {
    const previous = before.find((row) => row.skill_id === skill.skill_id);
    return (
      !previous ||
      previous.required_level !== skill.required_level ||
      previous.source !== skill.source
    );
  });

  if (changed.length === 0 && removed.length === 0) {
    return { ok: true, skills: submitted.skills };
  }

  if (changed.length > 0) {
    const { error } = await restClient
      .from("job_opening_skills")
      .upsert(
        changed.map((skill) => ({
          opening_id: jobId,
          skill_id: skill.skill_id,
          required_level: skill.required_level,
          source: skill.source,
        })),
        { onConflict: "opening_id,skill_id" }
      );
    if (error) return { ok: false, error: describeSkillsWriteError(error) };
  }

  if (removed.length > 0) {
    const { error } = await restClient
      .from("job_opening_skills")
      .delete()
      .eq("opening_id", jobId)
      .in(
        "skill_id",
        removed.map((skill) => skill.skill_id)
      );
    if (error) return { ok: false, error: describeSkillsWriteError(error) };
  }

  const label = (id: string) => names.get(id) ?? id;
  const added = changed.filter((skill) => !before.some((row) => row.skill_id === skill.skill_id));

  await recordActivity({
    area: "jobs",
    action: "job_skills",
    entity: "job opening",
    entityId: jobId,
    summary:
      submitted.skills.length === 0
        ? `Cleared the required skills of the opening “${opening.title}” — ${removed.length} ${
            removed.length === 1 ? "skill" : "skills"
          } removed`
        : `Recorded ${submitted.skills.length} required ${
            submitted.skills.length === 1 ? "skill" : "skills"
          } on the opening “${opening.title}”`,
    detail: {
      required: submitted.skills.map((skill) => ({
        skill: label(skill.skill_id),
        level: skill.required_level,
      })),
      ...(added.length > 0 ? { added: added.map((skill) => label(skill.skill_id)) } : {}),
      ...(removed.length > 0 ? { removed: removed.map((skill) => label(skill.skill_id)) } : {}),
      ...(changed.length - added.length > 0
        ? { level_changed: changed.filter((skill) => added.includes(skill)).map((skill) => label(skill.skill_id)) }
        : {}),
    },
  });

  revalidatePath("/jobs");
  return { ok: true, skills: submitted.skills };
}
