import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { getBoolSetting } from "@/modules/settings/infrastructure/settingsReader";
import { cronConfig } from "@/lib/config.server";
import { MAX_ATTEMPTS } from "@/modules/omnichannel/application/whatsapp-dispatch";
import { OutboxView } from "./OutboxView";
import { MessagePanel } from "./MessagePanel";
import { getEmailOutbox, getOutbox } from "./actions";

export const metadata = {
  title: "Candidate messaging",
  description: "Every candidate alert queued, delivered, mailed or left in the portal",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function WhatsAppOutboxPage() {
  await connection();
  const user = await requireStaff("/whatsapp");

  const [canManage, outbox, messages, whatsappEnabled] = await Promise.all([
    hasPermissionForUser("messages.send"),
    getOutbox(),
    getEmailOutbox(),
    getBoolSetting("notifications.whatsapp_enabled", false),
  ]);

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Candidate alerts"
        title="Candidate messaging"
        description="What the pipeline queued for WhatsApp, what the email relay accepted, and what is waiting in the candidate's portal inbox."
      />

      <OutboxView
        jobs={outbox.jobs}
        history={outbox.history}
        recipients={outbox.recipients}
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
          flags={messages.flags}
          canManage={canManage}
        />
      </div>
    </AdminShell>
  );
}
