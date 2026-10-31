import {
  project,
  resolveFormForJob,
} from "@/modules/form-builder/application/publicForm";

/**
 * The public layout for one role (spec §5, plan Task 10).
 *
 * A route handler, not part of the cached job page, for the same reason
 * `/api/careers/questions` is one: a recruiter's publish or edit reaches the
 * next page load instead of sitting in a cache window. Consuming `request.url`
 * makes this request-time; the `no-store` header says so to every proxy between
 * here and the candidate.
 *
 * The response is `project`'s shape only — labels, types, options as labels,
 * the derived `accept` and the server-side byte ceiling. System keys, field
 * config and registry keys never leave the module. When the layout cannot be
 * resolved the handler still answers 200 with `{ fallback: "wizard" }`, which
 * is spec §9's degrade-the-page rule.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";

  if (!UUID_PATTERN.test(jobId)) {
    return Response.json(
      { error: jobId ? "Unknown role." : "jobId required" },
      { status: 400 },
    );
  }

  const layout = await resolveFormForJob(jobId);
  if ("fallback" in layout) {
    return Response.json(layout, { headers: NO_STORE });
  }

  return Response.json(project(layout), { headers: NO_STORE });
}
