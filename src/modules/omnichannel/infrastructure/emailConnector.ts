import "server-only";

import { createTransport, type Transporter } from "nodemailer";
import { omnichannelConfig } from "@/lib/config.server";
import { resolveConfig, resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";

/**
 * SMTP email connector — the transport behind the EMAIL channel.
 *
 * Credentials follow the same precedence as every other integration: the
 * encrypted Settings store first, then the environment, so a relay entered in
 * Settings → API keys works without a redeploy and an env-only deployment keeps
 * working unchanged.
 *
 * Kept out of `connectors.ts` on purpose: that module is imported by flows that
 * only ever send WhatsApp, and it should not drag a mail client along.
 */

/**
 * A document that travels with a message.
 *
 * Field names follow nodemailer's own so nothing is lost in translation — the
 * portal has exactly one place that talks to a relay, and an offer letter that
 * arrives named wrongly is as confusing as one that arrives missing.
 */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface EmailOutboundMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

/** Long enough for a cold relay handshake, short enough to not hang an action. */
const CONNECT_TIMEOUT_MS = 20_000;
const SOCKET_TIMEOUT_MS = 30_000;

/**
 * What is missing, in the order the settings screen asks for it. Returns null
 * when the relay is complete, so callers can distinguish "not configured" from
 * "configured and failing".
 */
export async function missingSmtpFields(): Promise<string[] | null> {
  return (await resolveRelay()).missing;
}

/** One credential read per send: the relay settings, or the reason they are incomplete. */
async function resolveRelay(): Promise<{ config: SmtpSettings | null; missing: string[] | null }> {
  const [password, config] = await Promise.all([
    resolveSecret("smtp"),
    resolveConfig("smtp"),
  ]);

  const host = config.host?.trim() || omnichannelConfig.email.host;
  const username = config.username?.trim() || omnichannelConfig.email.username;
  const secret = (password ?? "").trim() || omnichannelConfig.email.password;
  const from = config.from?.trim() || omnichannelConfig.email.from;

  const missing: string[] = [];
  if (!host) missing.push("host");
  if (!username) missing.push("sign-in account");
  if (!secret) missing.push("password");
  if (!from) missing.push("from address");
  if (missing.length > 0) return { config: null, missing };

  const storedPort = Number(config.port?.trim() ?? "");
  return {
    missing: null,
    config: {
      host,
      port: Number.isFinite(storedPort) && storedPort > 0 ? storedPort : omnichannelConfig.email.port,
      username,
      password: secret,
      from,
    },
  };
}

/**
 * 465 is TLS from the first byte; everything else (587, 2525) starts plain and
 * upgrades with STARTTLS, which is what nodemailer does when `secure` is false.
 */
function transporterFor(config: SmtpSettings): Transporter {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string
  );
}

/**
 * Mail clients strip <style> blocks, so the readable version of a candidate
 * email is inline-styled HTML built from the same text the template renders.
 * The text is escaped first, then links are turned into anchors — an author
 * cannot inject markup through a template or a candidate name.
 */
function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => {
      const safe = escapeHtml(block.trim());
      const linked = safe.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) =>
          `<a href="${url}" style="color:#b08d3f;text-decoration:underline">${url}</a>`
      );
      return `<p style="margin:0 0 16px;white-space:pre-wrap">${linked}</p>`;
    })
    .join("");

  return `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2430">${paragraphs}</div>`;
}

/**
 * nodemailer is told to base64 the bytes itself, and wants a Buffer for that —
 * a `Uint8Array` reaches the relay as an empty attachment.
 */
function attachmentsOf(message: EmailOutboundMessage) {
  return message.attachments?.map((file) => ({
    filename: file.filename,
    contentType: file.contentType,
    content: Buffer.from(file.content),
  }));
}

/**
 * Translates the failures an admin can actually fix. SMTP answers auth problems
 * with a code and a sentence that varies by relay, so the code is what we key on
 * and the provider text stays in the detail.
 */
function explainFailure(error: unknown): string {
  const err = error as { responseCode?: number; response?: string; message?: string };
  if (err?.responseCode === 535) {
    return "The relay rejected those credentials. Gmail needs an app password (Account → Security → App passwords), not the account password.";
  }
  if (err?.responseCode === 534 || err?.responseCode === 530) {
    return "The relay refused the login method. Check the sign-in account and that the port matches its TLS mode (587 = STARTTLS, 465 = TLS).";
  }
  if (err?.responseCode === 550 || err?.responseCode === 553) {
    return "The relay refused the sender address. The From address usually has to be a mailbox this account may send as.";
  }
  const message = err?.message ?? "Unknown SMTP error";
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

export class EmailConnector {
  /** True when every piece of the relay is present, not when it is reachable. */
  static async isConfigured(): Promise<boolean> {
    return (await resolveRelay()).config !== null;
  }

  /**
   * Send one message. Returns a structured failure rather than throwing, so a
   * notification never breaks the recruiter action that triggered it.
   */
  static async send(
    message: EmailOutboundMessage
  ): Promise<{ success: boolean; error?: string }> {
    const { config, missing } = await resolveRelay();
    if (!config) {
      return {
        success: false,
        error: `SMTP is not configured — missing ${missing?.join(", ")}. Add them in Settings → API keys.`,
      };
    }

    if (!message.to?.trim()) return { success: false, error: "No recipient address" };

    try {
      await transporterFor(config).sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: toHtml(message.text),
        attachments: attachmentsOf(message),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: explainFailure(error) };
    }
  }

  /**
   * Send to many recipients over one connection. Each is attempted
   * independently, because one rejected address must not abandon a campaign,
   * and the per-recipient results are returned so the caller can log exactly
   * who was reached.
   */
  static async sendBulk(
    messages: EmailOutboundMessage[]
  ): Promise<{
    success: number;
    failed: number;
    firstError?: string;
    results: { to: string; success: boolean; error?: string }[];
  }> {
    if (messages.length === 0) return { success: 0, failed: 0, results: [] };

    const { config, missing } = await resolveRelay();
    if (!config) {
      return {
        success: 0,
        failed: messages.length,
        firstError: `SMTP is not configured — missing ${missing?.join(", ")}.`,
        results: messages.map((message) => ({
          to: message.to,
          success: false,
          error: `SMTP is not configured — missing ${missing?.join(", ")}.`,
        })),
      };
    }

    const transport = transporterFor(config);
    const results: { to: string; success: boolean; error?: string }[] = [];

    for (const message of messages) {
      try {
        await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: toHtml(message.text),
          attachments: attachmentsOf(message),
        });
        results.push({ to: message.to, success: true });
      } catch (error) {
        results.push({ to: message.to, success: false, error: explainFailure(error) });
      }
    }

    transport.close();
    return {
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      firstError: results.find((r) => r.error)?.error,
      results,
    };
  }

  /**
   * Logs in without sending anything — the honest version of the Test button.
   * A relay has no "is this key valid" endpoint, so this proves host, port,
   * TLS mode and credentials together.
   */
  static async verify(): Promise<{ ok: boolean; message: string }> {
    const { config, missing } = await resolveRelay();
    if (!config) {
      return { ok: false, message: `Missing ${missing?.join(", ")}.` };
    }

    try {
      // verify() resolves a bare `true`, so the sentence names the TLS mode the
      // handshake actually used — the one thing this probe proves that a caller
      // can still check against the port it typed.
      await transporterFor(config).verify();
      const mode = config.port === 465 ? "TLS from the first byte" : "STARTTLS";
      return { ok: true, message: `Signed in to ${config.host}:${config.port} over ${mode}.` };
    } catch (error) {
      return { ok: false, message: explainFailure(error) };
    }
  }
}
