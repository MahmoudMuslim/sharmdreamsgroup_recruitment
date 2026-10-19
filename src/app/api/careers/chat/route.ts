import { groupProfile, companyOfJob } from "@/modules/careers/company-profile";
import { boardCard, roleCard } from "@/modules/careers/chatbot/role-card";
import { parseTurns } from "@/modules/careers/chatbot/conversation";
import { answerAsCareersBot, describeChatFailure } from "@/modules/careers/chatbot/answer";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/config";
import { getPublicCompanies, getPublicJob, getPublicJobs } from "@/app/careers/actions";

/**
 * Public question-and-answer endpoint for the careers assistant.
 *
 * Stateless by design: the widget owns its transcript and sends it back with
 * every question, so this route holds nothing between turns and a visitor who
 * closes the panel leaves no server-side record behind. The only durable copy
 * is the one they hand over at `/api/careers/lead`.
 *
 * The grounding is the point of the route. The answer is built from the same
 * cached reads the page itself rendered, so what the assistant says about pay,
 * location or requirements cannot disagree with what the page prints — and a
 * fact neither carries is one the assistant is instructed to call unstated.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Could not read that request.");
  }

  const input = body as { jobId?: unknown; locale?: unknown; messages?: unknown };

  const turns = parseTurns(input.messages);
  if (!turns) return bad("Ask a question first.");

  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(String(input.locale))
    ? (input.locale as SupportedLocale)
    : "en";

  const jobId = typeof input.jobId === "string" && UUID.test(input.jobId) ? input.jobId : null;

  // Read together: the board and the company rows are needed whichever way this
  // goes, and both are cached the way the pages cache them.
  const [jobs, companies] = await Promise.all([getPublicJobs(), getPublicCompanies()]);
  const group = groupProfile(companies);

  let card: string;

  if (jobId) {
    const job = await getPublicJob(jobId);
    // A draft or closed role has no page, so it gets no assistant either.
    if (!job) return bad("This role is no longer accepting applications.", 404);
    card = roleCard({
      job,
      company: companyOfJob(job, companies),
      group,
      otherJobs: jobs.filter((each) => each.id !== job.id),
      companies,
    });
  } else {
    card = boardCard({ jobs, companies, group });
  }

  try {
    const answer = await answerAsCareersBot({
      card,
      turns,
      locale,
      groupName: group?.name ?? "Sharm Dreams Group",
    });

    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "[careers] assistant failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return Response.json({ error: describeChatFailure(error) }, { status: 500 });
  }
}
