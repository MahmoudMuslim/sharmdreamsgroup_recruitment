import { NextResponse } from "next/server";
import { cronConfig } from "@/lib/config.server";
import { processDueWhatsAppJobs } from "@/modules/omnichannel/application/whatsapp-dispatch";

/**
 * Timed WhatsApp dispatcher (master spec §5): drains the scheduled queue that
 * stage-change alerts are written to.
 *
 * Protected by a shared secret — point pg_cron (or any scheduler) at this URL
 * with an `x-cron-secret` header matching CRON_SECRET. Fails closed when the
 * secret is not configured so an open endpoint can never drain the queue.
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

  const summary = await processDueWhatsAppJobs(cronConfig.whatsappBatchSize);
  return NextResponse.json(summary);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
