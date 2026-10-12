import { NextResponse } from "next/server";
import { cronConfig } from "@/lib/config.server";
import { regradeStuckAttempts } from "@/modules/assessment/application/gradeAttempt";

/**
 * Timed re-grade sweep: picks up submitted attempts whose AI grading failed
 * during a provider outage (responses left unscored, attempt parked in
 * SUBMITTED because resubmission is impossible) and runs the same gated
 * grading pass fresh submissions get.
 *
 * Protected like /api/cron/whatsapp — requires an `x-cron-secret` header
 * matching CRON_SECRET and fails closed when the secret is unset.
 */

async function handle(request: Request): Promise<NextResponse> {
  const secret = cronConfig.secret;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set it before scheduling this route." },
      { status: 503 }
    );
  }

  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await regradeStuckAttempts(cronConfig.gradingBatchSize);
  return NextResponse.json(summary);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
