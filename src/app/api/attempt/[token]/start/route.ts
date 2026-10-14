import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isLinkExpired } from "@/modules/assessment/application/linkValidity";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: attempt, error } = await supabase
    .from("candidate_attempts")
    .select("id, status, time_limit_minutes, created_at, expires_at")
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
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
  return NextResponse.json({ ok: true, expires_at: expiresAt });
}
