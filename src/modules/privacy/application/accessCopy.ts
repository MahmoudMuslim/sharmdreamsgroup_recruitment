import "server-only";

import { getServiceRestClient } from "@/lib/data-api/service";

import { emailSpellings } from "@/modules/candidates/domain/personIdentity";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";

/**
 * What a person is sent when they ask for a copy of what is held.
 *
 * The copy is mail rather than a screen because the request was filed by an
 * anonymous visitor who proved the address is theirs; answering into the browser
 * would hand the data to whoever is sitting in front of it now. It is built from
 * the person's own rows — every application under the address, the consent
 * history, the papers they sat and the answers they wrote — and sent to the
 * address the request was filed with, which is the address the verification step
 * matched against a record.
 *
 * Bounded on purpose: an old application can carry thousands of answers, and a
 * mail server will take a truncated letter where it rejects a huge one. Every cut
 * is printed in the letter, so nobody mistakes a partial copy for the whole.
 */

/** How many written answers one letter carries before it says it stopped. */
const MAX_ANSWERS = 300;

/** How much of one answer is quoted. */
const MAX_ANSWER_CHARS = 4_000;

/** How many applications one person's copy covers before it says it stopped. */
const MAX_APPLICATIONS = 20;

type ServiceClient = ReturnType<typeof getServiceRestClient>;

function nested<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function cut(value: unknown, limit = MAX_ANSWER_CHARS): string {
  const raw = text(value).trim();
  return raw.length > limit ? `${raw.slice(0, limit)}… [cut at ${limit} characters]` : raw;
}

function iso(value: unknown): string {
  const raw = text(value);
  return raw ? new Date(raw).toISOString() : "";
}

interface ApplicationRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  stage: string;
  created_at: string;
  ai_score: string;
  ai_screening_summary: string;
  jobTitle: string;
}

async function readApplications(
  service: ServiceClient,
  email: string
): Promise<{ rows: ApplicationRow[]; capped: boolean; error?: string }> {
  const { data, error } = await service
    .from("applications")
    .select(
      "id, full_name, email, phone, stage, created_at, ai_score, ai_screening_summary, " +
        "job_openings ( title )"
    )
    .in("email", emailSpellings(email))
    .order("created_at", { ascending: true })
    .limit(MAX_APPLICATIONS + 1);

  if (error) return { rows: [], capped: false, error: error.message };

  const all = ((data ?? []) as Record<string, unknown>[]).map((raw) => {
    const job = nested<{ title?: string }>(raw.job_openings);
    return {
      id: String(raw.id),
      full_name: text(raw.full_name),
      email: text(raw.email),
      phone: text(raw.phone),
      stage: text(raw.stage),
      created_at: iso(raw.created_at),
      ai_score: text(raw.ai_score),
      ai_screening_summary: text(raw.ai_screening_summary),
      jobTitle: job?.title ? String(job.title) : "an unnamed role",
    };
  });

  return {
    rows: all.length > MAX_APPLICATIONS ? all.slice(0, MAX_APPLICATIONS) : all,
    capped: all.length > MAX_APPLICATIONS,
  };
}

async function readConsents(
  service: ServiceClient,
  applicationId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("candidate_consents")
    .select("purpose, granted, notice_version, recorded_at")
    .eq("application_id", applicationId)
    .order("recorded_at", { ascending: true });

  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(
    (raw) =>
      `${iso(raw.recorded_at)} — ${text(raw.purpose)}: ${
        raw.granted === true ? "granted" : "declined"
      } (notice ${text(raw.notice_version)})`
  );
}

interface AttemptBlock {
  lines: string[];
  answers: number;
}

async function readAttempts(
  service: ServiceClient,
  applicationId: string,
  budget: { answers: number }
): Promise<AttemptBlock> {
  const { data, error } = await service
    .from("candidate_attempts")
    .select("id, status, submitted_at, total_score, max_score, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) return { lines: [], answers: 0 };

  const lines: string[] = [];
  let answers = 0;

  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const status = text(raw.status);
    const score =
      text(raw.total_score) && text(raw.max_score)
        ? `${text(raw.total_score)} / ${text(raw.max_score)}`
        : "not marked";
    lines.push(
      `- Test issued ${iso(raw.created_at)}, status ${status || "unknown"}, score ${score}${
        raw.submitted_at ? `, submitted ${iso(raw.submitted_at)}` : ""
      }`
    );

    if (budget.answers >= MAX_ANSWERS) continue;

    const { data: responses, error: responseError } = await service
      .from("candidate_responses")
      .select(
        "answer_text, transcript, score, max_score, " +
          "question:assessment_questions!candidate_responses_question_id_fkey ( title, prompt )"
      )
      .eq("attempt_id", String(raw.id));

    if (responseError) continue;

    for (const response of (responses ?? []) as Record<string, unknown>[]) {
      if (budget.answers >= MAX_ANSWERS) break;
      const question = nested<{ title?: string; prompt?: string }>(response.question);
      const mark =
        text(response.score) && text(response.max_score)
          ? ` (${text(response.score)} / ${text(response.max_score)})`
          : "";
      lines.push(
        `  ${question?.title ? String(question.title) : "Question"}${
          question?.prompt ? ` — ${cut(question.prompt, 500)}` : ""
        }${mark}`
      );
      if (text(response.answer_text)) lines.push(`    Your answer: ${cut(response.answer_text)}`);
      if (text(response.transcript))
        lines.push(`    Transcript: ${cut(response.transcript)}`);
      answers += 1;
      budget.answers += 1;
    }
  }

  return { lines, answers };
}

async function readInterviews(
  service: ServiceClient,
  applicationId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("interview_schedules")
    .select("scheduled_at, status, meeting_link")
    .eq("application_id", applicationId)
    .order("scheduled_at", { ascending: true });

  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(
    (raw) =>
      `- ${iso(raw.scheduled_at)} — ${text(raw.status) || "unknown"}${
        text(raw.meeting_link) ? ` — ${text(raw.meeting_link)}` : ""
      }`
  );
}

/**
 * Build the letter, or say why it could not be sent.
 *
 * Nothing here writes: the action marks the request executed only after the mail
 * is accepted by the relay, so a failed send leaves the request approved and
 * retryable rather than claiming a copy nobody received.
 */
export async function sendAccessCopy(input: {
  email: string;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await EmailConnector.isConfigured())) {
    return {
      ok: false,
      error:
        "The copy cannot be sent because no mail relay is configured. " +
        "Add one under Settings → API keys; the request stays approved until it is.",
    };
  }

  const service = getServiceRestClient();
  const applications = await readApplications(service, input.email);
  if (applications.error) return { ok: false, error: applications.error };
  if (applications.rows.length === 0) {
    return { ok: false, error: "No application on file carries that address." };
  }

  const blocks: string[] = [];
  const budget = { answers: 0 };

  for (const row of applications.rows) {
    const consents = await readConsents(service, row.id);
    const attempts = await readAttempts(service, row.id, budget);
    const interviews = await readInterviews(service, row.id);

    blocks.push(
      [
        `${row.jobTitle}`,
        `  Applied ${row.created_at}; stage ${row.stage || "unknown"}.`,
        `  Name: ${row.full_name || "not recorded"}`,
        `  Email: ${row.email || "not recorded"}`,
        `  Phone: ${row.phone || "not recorded"}`,
        row.ai_score ? `  AI screening score: ${row.ai_score}` : "",
        row.ai_screening_summary ? `  AI screening summary: ${cut(row.ai_screening_summary)}` : "",
        consents.length ? `  Consents:\n${consents.map((line) => `    ${line}`).join("\n")}` : "",
        attempts.lines.length
          ? `  Assessments:\n${attempts.lines.map((line) => `    ${line}`).join("\n")}`
          : "  Assessments: none on file",
        interviews.length
          ? `  Interviews:\n${interviews.map((line) => `    ${line}`).join("\n")}`
          : "  Interviews: none on file",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const header = [
    "This is the information Sharm Dreams Group holds about you, sent because you asked for a copy through the privacy page.",
    `Prepared ${new Date().toISOString()} for ${input.email}.`,
    "",
    "If you did not ask for this, someone used the privacy page with your address. Nothing has changed: this letter only reads what was already held.",
  ].join("\n");

  const footer = [
    "",
    applications.capped
      ? `Only the first ${MAX_APPLICATIONS} applications are included; older ones can be sent on request.`
      : "",
    budget.answers >= MAX_ANSWERS
      ? `The written answers stop at ${MAX_ANSWERS}; the rest can be sent on request.`
      : "",
    "",
    "To have this erased, open the link we mailed you and choose “Erase my data”.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await EmailConnector.send({
    to: input.email,
    subject: "The information we hold about you",
    text: `${header}\n\n${blocks.join("\n\n")}\n${footer}`,
  });

  if (!result.success) {
    console.error(`[privacy] access copy for request ${input.requestId} failed:`, result.error);
    return {
      ok: false,
      error: result.error ?? "The copy could not be sent; the request stays approved.",
    };
  }

  return { ok: true };
}
