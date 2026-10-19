import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";
import { cronConfig } from "@/lib/config.server";
import { MAX_ATTEMPTS } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { OutboxView } from "./OutboxView";
import { MessagePanel } from "./MessagePanel";
import { isFailedView, isOutboxBucket } from "./outbox-model";
import { getEmailOutbox, getOutbox } from "./actions";

export const metadata = {
  title: "Candidate messaging",
  description: "Every candidate alert queued, delivered, mailed or left in the portal",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function WhatsAppOutboxPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  await requireStaff("/whatsapp");
  const params = await searchParams;
  // The two rails the attention feed can point at. Read server-side, so what the
  // feed counts is what this render actually queries — not a client-side slice of
  // a capped list that may have already dropped the row.
  const bucket = isOutboxBucket(params.bucket);
  const failedOnly = isFailedView(params.failed);

  const [canManage, outbox, messages, whatsappEnabled] = await Promise.all([
    hasPermissionForUser("messages.send"),
    getOutbox({ bucket, failed: failedOnly }),
    getEmailOutbox({ failed: failedOnly }),
    getBoolSetting("notifications.whatsapp_enabled", false),
  ]);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Candidate alerts"
        title="Candidate messaging"
        description="What the pipeline queued for WhatsApp, what the email relay accepted, and what is waiting in the candidate's portal inbox."
      />

      <OutboxView
        key={`${bucket ?? "ALL"}|${failedOnly ? "failed" : "all"}`}
        jobs={outbox.jobs}
        history={outbox.history}
        recipients={outbox.recipients}
        buckets={outbox.buckets}
        failedLogTotal={outbox.failedLogTotal}
        bucket={bucket ?? "ALL"}
        failedOnly={failedOnly}
        canManage={canManage}
        flags={{
          whatsappEnabled,
          // Only whether the secret exists — never its value.
          cronArmed: Boolean(cronConfig.secret),
          batchSize: cronConfig.whatsappBatchSize,
          maxAttempts: MAX_ATTEMPTS,
        }}
        now={new Date().toISOString()}
      />

      <div className="mt-6">
        <MessagePanel
          emails={messages.emails}
          notices={messages.notices}
          totals={messages.totals}
          failedOnly={failedOnly}
          flags={messages.flags}
          canManage={canManage}
        />
      </div>
    </PageTransition>
  );
}
