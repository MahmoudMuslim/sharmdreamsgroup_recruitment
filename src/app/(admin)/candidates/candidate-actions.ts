"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
import type { WhatsAppOutboundMessage } from "@/types";

export interface BulkWhatsAppResult {
  ok: boolean;
  error?: string;
  queued?: number;
  skipped?: number;
  failed?: number;
}

/**
 * Sends a templated WhatsApp message to a selected set of applications.
 *
 * Placeholders in double braces are substituted per recipient so each message
 * names the right person and role. Candidates with no phone number are counted
 * as skipped rather than silently dropped, and a failure on one recipient never
 * blocks the rest of the batch.
 */
export async function sendBulkWhatsApp(input: {
  applicationIds: string[];
  templateKey: string;
  message: string;
}): Promise<BulkWhatsAppResult> {
  await requireStaff("/candidates");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.applicationIds)).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, error: "Select at least one candidate." };
  }
  if (ids.length > 200) {
    return { ok: false, error: "Send to at most 200 candidates at a time." };
  }

  const body = input.message?.trim();
  if (!body) {
    return { ok: false, error: "The message cannot be empty." };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("applications")
    .select("id, full_name, phone, stage, job_openings(title), candidate_attempts(access_token)")
    .in("id", ids);

  if (error) {
    return { ok: false, error: error.message };
  }

  const messages: WhatsAppOutboundMessage[] = [];
  let skipped = 0;

  for (const row of data ?? []) {
    const application = row as {
      full_name: string;
      phone: string | null;
      stage: string;
      job_openings?: { title?: string } | { title?: string }[] | null;
      candidate_attempts?: { access_token?: string } | { access_token?: string }[] | null;
    };

    if (!application.phone) {
      skipped += 1;
      continue;
    }

    const job = Array.isArray(application.job_openings)
      ? application.job_openings[0]
      : application.job_openings;
    const attempt = Array.isArray(application.candidate_attempts)
      ? application.candidate_attempts[0]
      : application.candidate_attempts;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const text = body
      .replace(/\{\{\s*candidate_name\s*\}\}/g, application.full_name)
      .replace(/\{\{\s*job_title\s*\}\}/g, job?.title ?? "the role")
      .replace(/\{\{\s*stage\s*\}\}/g, application.stage.replace(/_/g, " ").toLowerCase())
      .replace(
        /\{\{\s*assessment_link\s*\}\}/g,
        attempt?.access_token ? `${siteUrl}/test/${attempt.access_token}` : "your candidate portal"
      );

    messages.push({
      to: application.phone,
      text,
    });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      error: `None of the selected candidates have a phone number on file (${skipped} skipped).`,
    };
  }

  const outcome = await WhatsAppConnector.sendBulk(messages);

  if (outcome.success === 0 && outcome.failed > 0) {
    return {
      ok: false,
      error: "WhatsApp rejected every message. Check the integration credentials.",
      failed: outcome.failed,
      skipped,
    };
  }

  return {
    ok: true,
    queued: outcome.success,
    failed: outcome.failed,
    skipped,
  };
}