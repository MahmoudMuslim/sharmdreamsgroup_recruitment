import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isLinkExpired } from "@/modules/assessment/application/linkValidity";
import { recordActivity } from "@/modules/activity/application/record";
import { APPLICATION_EMBED, attemptContext, runnerActor } from "@/modules/assessment/application/runner-trail";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: attempt, error } = await supabase
    .from("candidate_attempts")
    .select(`id, status, time_limit_minutes, created_at, expires_at, ${APPLICATION_EMBED}`)
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const { candidateName, jobTitle } = attemptContext(attempt);
  const actor = runnerActor(candidateName);

  if (attempt.status !== "NOT_STARTED") {
    return NextResponse.json({ ok: true, alreadyStarted: true });
  }

  // The runner marks the attempt EXPIRED when its link is opened late; this is
  // the same deadline checked at the moment the clock would start, so a tab
  // left open across the window cannot begin a test that is already spent.
  const overdue = attempt.expires_at
    ? new Date(attempt.expires_at) < new Date()
    : await isLinkExpired(attempt.created_at);

  if (overdue) {
    await supabase.from("candidate_attempts").update({ status: "EXPIRED" }).eq("id", attempt.id);
    await recordActivity({
      ...actor,
      area: "assessments",
      action: "attempt_expired",
      entity: "attempt",
      entityId: attempt.id,
      summary: `${candidateName} opened the ${jobTitle} test after its link had run out, so it was closed unstarted`,
      detail: { from: attempt.status, to: "EXPIRED" },
    });
    return NextResponse.json({ error: "This invitation link has expired" }, { status: 409 });
  }

  const expiresAt = new Date(Date.now() + attempt.time_limit_minutes * 60 * 1000).toISOString();
  const { error: updateError } = await supabase
    .from("candidate_attempts")
    .update({ status: "IN_PROGRESS", started_at: new Date().toISOString(), expires_at: expiresAt })
    .eq("id", attempt.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to start assessment" }, { status: 500 });
  }

  await recordActivity({
    ...actor,
    area: "assessments",
    action: "attempt_started",
    entity: "attempt",
    entityId: attempt.id,
    summary: `${candidateName} started the ${jobTitle} test — ${attempt.time_limit_minutes} minutes on the clock`,
    detail: { from: attempt.status, to: "IN_PROGRESS", minutes: attempt.time_limit_minutes },
  });

  return NextResponse.json({ ok: true, expires_at: expiresAt });
}
