/**
 * WhatsApp Cloud API connector.
 *
 * All calls are server-side only. Credentials resolve from the encrypted
 * Settings store first, then fall back to the environment — so keys entered in
 * the admin UI work without a redeploy, and an env-only deployment still works.
 */
import { omnichannelConfig } from "@/lib/config.server";
import { resolveConfig, resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";
import type { WhatsAppOutboundMessage } from "@/types";

/**
 * Enqueues outbound candidate messages (status alerts, interview reminders, screening updates).
 * Send endpoint: https://graph.facebook.com/v{version}/{phone-number-id}/messages
 */
export class WhatsAppConnector {
  /**
   * Resolves credentials through the encrypted store first, falling back to the
   * environment. This is what makes a key entered in Settings → API keys take
   * effect without a redeploy.
   */
  private static async credentials(): Promise<{ token: string; phoneNumberId: string } | null> {
    const [token, config] = await Promise.all([
      resolveSecret("whatsapp"),
      resolveConfig("whatsapp"),
    ]);

    const phoneNumberId =
      config.phone_number_id?.trim() || omnichannelConfig.whatsapp.phoneNumberId;

    if (!token || !phoneNumberId) return null;
    return { token, phoneNumberId };
  }

  /**
   * Send a single message to a candidate via WhatsApp.
   * Returns true on success; logs error on failure.
   */
  static async sendMessage(
    to: string,
    options: { template?: string; text?: string } = {}
  ): Promise<{ success: boolean; error?: string }> {
    const creds = await this.credentials();
    if (!creds) {
      return { success: false, error: "WhatsApp credentials not configured" };
    }

    // Messages must be posted to the sending phone number's id — `/me/messages`
    // is the Messenger Platform endpoint and Graph answers it with
    // "Object with ID 'me' does not exist" for a WhatsApp token.
    const url = `https://graph.facebook.com/${omnichannelConfig.whatsapp.graphApiVersion}/${creds.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      ...(options.template
        ? { type: "template", template: { name: options.template, language: { code: "en_US" } } }
        : { type: "text", text: { body: options.text } }),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message ?? "Unknown WhatsApp error" };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }

  /**
   * Send a batch of messages to candidates. Each recipient is attempted
   * independently so one failure never blocks the rest of the batch — and each
   * recipient is reported on its own, because a campaign has to be written to
   * the send record the outbox and the candidate's inbox both read.
   */
  static async sendBulk(
    messages: WhatsAppOutboundMessage[]
  ): Promise<{
    success: number;
    failed: number;
    results: { to: string; success: boolean; error?: string }[];
  }> {
    const settled = await Promise.allSettled(
      messages.map((msg) => this.sendMessage(msg.to, { template: msg.template, text: msg.text }))
    );

    const results = settled.map((result, index) => {
      const outcome =
        result.status === "fulfilled"
          ? result.value
          : { success: false, error: "The WhatsApp request did not settle" };
      return { to: messages[index].to, success: outcome.success, error: outcome.error };
    });

    return {
      success: results.filter((each) => each.success).length,
      failed: results.filter((each) => !each.success).length,
      results,
    };
  }
}
