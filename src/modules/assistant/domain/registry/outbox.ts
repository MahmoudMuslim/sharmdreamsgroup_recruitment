// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  isoDateTime,
  report,
  resendEmailMessage,
  retryWhatsAppJob,
  str,
  updateWhatsAppJob,
} from "./shared";

/* Outbox tools. */

export const outbox: readonly AssistantTool[] = [
  {
    name: "retry_outbox_message",
    label: "Retrying a queued message",
    description: "Re-arm a WhatsApp job that failed or is still queued so the scheduler tries it again.",
    args: { id: "string — outbox job id from list_outbox" },
    run: async (args) => report(await retryWhatsAppJob(str(args, "id"))),
  },
  {
    name: "edit_outbox_message",
    label: "Rewriting a queued message",
    description:
      "Change the text or the send time of a WhatsApp message that has not gone out yet. A sent message is history and cannot be edited.",
    args: {
      id: "string — outbox job id",
      text: "string — the new body",
      scheduled_for: "string — ISO date-time",
    },
    run: async (args) =>
      report(
        await updateWhatsAppJob(str(args, "id"), {
          text: str(args, "text"),
          scheduledFor: isoDateTime(args, "scheduled_for"),
        })
      ),
  },
  {
    name: "resend_email",
    label: "Resending a failed email",
    description:
      "Re-send one email that failed, using the copy already stored on the log row. A delivered message is refused — it would mail the candidate twice.",
    args: { id: "string — communication log id from list_email_outbox" },
    run: async (args) => report(await resendEmailMessage(str(args, "id"))),
  },

];
