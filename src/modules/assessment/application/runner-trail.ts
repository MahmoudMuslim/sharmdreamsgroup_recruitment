import "server-only";

/**
 * The trail rows the assessment runner leaves.
 *
 * Every write the runner makes is caused by the candidate sitting the test, so
 * the actor is that candidate — not the recruiter who issued the link, and not
 * whatever staff session happens to be in the cookie jar while a tab is open.
 * The routes read the attempt by its access token, so the same join that proves
 * the token names the person on the row.
 */

import type { ActivityEntry } from "@/modules/activity/domain/trail";

interface ApplicationEmbed {
  id?: string | null;
  stage?: string | null;
  full_name?: string | null;
  job_openings?: { title?: string } | { title?: string }[] | null;
}

export interface AttemptContext {
  applicationId: string | null;
  applicationStage: string | null;
  candidateName: string;
  jobTitle: string;
}

/**
 * The candidate and role behind an attempt row.
 *
 * PostgREST returns a to-one embed as an object and a to-many as a one-item
 * array, so both shapes are accepted rather than assumed.
 */
export function attemptContext(row: unknown): AttemptContext {
  const embedded = (row as { applications?: ApplicationEmbed | ApplicationEmbed[] } | null)?.applications;
  const application = Array.isArray(embedded) ? embedded[0] : embedded;
  const job = Array.isArray(application?.job_openings)
    ? application?.job_openings[0]
    : application?.job_openings;

  return {
    applicationId: application?.id ?? null,
    applicationStage: application?.stage ?? null,
    candidateName: application?.full_name ?? "A candidate",
    jobTitle: job?.title ?? "the role",
  };
}

/** The join every runner route adds to its own read, so a row can be described. */
export const APPLICATION_EMBED =
  "applications ( id, stage, full_name, job_openings ( title ) )";

/** The candidate as the trail records them. */
export function runnerActor(
  candidateName: string
): Pick<ActivityEntry, "actorKind" | "actorLabel" | "via"> {
  return { actorKind: "CANDIDATE", actorLabel: candidateName, via: "assessment runner" };
}
