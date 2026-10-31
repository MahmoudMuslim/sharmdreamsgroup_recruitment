import { getServiceRestClient } from "@/lib/data-api/service";
import { recordActivity } from "@/modules/activity/application/record";
import { APPLICATION_EMBED, attemptContext, runnerActor } from "@/modules/assessment/application/runner-trail";
import { NextResponse } from "next/server";

/** Events we accept from the browser, mapped to a stored severity. */
const EVENT_RULES: Record<string, "INFO" | "WARN" | "CRITICAL"> = {
  FOCUS_LOST: "WARN",
  TAB_HIDDEN: "WARN",
  FULLSCREEN_EXIT: "INFO",
  PASTE_DETECTED: "WARN",
  PASTE_BLOCKED: "CRITICAL",
  COPY_DETECTED: "INFO",
  AI_PASTE_SUSPECTED: "CRITICAL",
  MULTI_DEVICE: "CRITICAL",
};

interface IntegrityPayload {
  attemptToken: string;
  events: {
    type: keyof typeof EVENT_RULES;
    questionId?: string | null;
    /** Short, non-sensitive context. Never full pasted content. */
    detail?: string;
    sessionFingerprint?: string;
    deviceLabel?: string;
  }[];
}

/**
 * Persists assessment-integrity events for an attempt.
 *
 * The token is the same unguessable secret that gates the runner, so it
 * authorises the write. Detail strings are length-capped server-side and the
 * client never sends pasted content — only a length and a short excerpt flag —
 * so this log cannot become a store of anything a candidate typed.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as IntegrityPayload | null;

  if (!body || typeof body.attemptToken !== "string" || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "Invalid integrity payload" }, { status: 400 });
  }

  // Guard against a runaway client flooding the log.
  if (body.events.length > 100) {
    return NextResponse.json({ error: "Too many events in one batch" }, { status: 413 });
  }

  const restClient = getServiceRestClient();

  const { data: attempt } = await restClient
    .from("candidate_attempts")
    .select(`id, status, ${APPLICATION_EMBED}`)
    .eq("access_token", body.attemptToken)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  if (attempt.status === "SUBMITTED" || attempt.status === "GRADED" || attempt.status === "EXPIRED") {
    return NextResponse.json({ error: "Assessment is closed" }, { status: 409 });
  }

  const rows = body.events
    .filter((event) => event.type in EVENT_RULES)
    .map((event) => ({
      attempt_id: attempt.id,
      question_id: event.questionId ?? null,
      event_type: event.type,
      severity: EVENT_RULES[event.type],
      detail: event.detail ? event.detail.slice(0, 180) : null,
      session_fingerprint: event.sessionFingerprint?.slice(0, 64) ?? null,
      device_label: event.deviceLabel?.slice(0, 120) ?? null,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, recorded: 0 });
  }

  const { error } = await restClient.from("integrity_events").insert(rows);

  if (error) {
    return NextResponse.json({ error: "Failed to record integrity events" }, { status: 500 });
  }

  await restClient.rpc("refresh_attempt_integrity", { target_attempt: attempt.id });

  // Only the flags a recruiter would act on leave a trail row. A batch per
  // focus-loss would fill the change log with the noise of an honest candidate
  // switching tabs, and bury the ones that matter.
  const critical = rows.filter((row) => row.severity === "CRITICAL");
  if (critical.length > 0) {
    const { candidateName } = attemptContext(attempt);
    await recordActivity({
      ...runnerActor(candidateName),
      area: "assessments",
      action: "integrity_flag",
      entity: "attempt",
      entityId: attempt.id,
      summary: `${critical.length} critical integrity event${critical.length === 1 ? "" : "s"} during ${candidateName}'s test: ${[...new Set(critical.map((row) => row.event_type))].join(", ")}`,
      detail: {
        events: critical.map((row) => row.event_type),
        batch_size: rows.length,
        devices: [...new Set(critical.map((row) => row.device_label).filter(Boolean))],
      },
    });
  }

  return NextResponse.json({ ok: true, recorded: rows.length });
}