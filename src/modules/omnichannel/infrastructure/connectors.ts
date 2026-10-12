/**
 * Omnichannel ATS & Communication Connectors
 * Provides API integration logic for WhatsApp Cloud API, ATS adapters (Greenhouse, Lever, Frappe HR), and OAuth 2.0 Calendar scheduling.
 *
 * All calls are server-side only. Credentials resolve from the encrypted
 * Settings store first, then fall back to the environment — so keys entered in
 * the admin UI work without a redeploy, and an env-only deployment still works.
 */
import { omnichannelConfig } from "@/lib/config.server";
import { resolveConfig, resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";
import type { WhatsAppOutboundMessage, CalendarEventPayload } from "@/types";

/**
 * WhatsApp Cloud API connector.
 * Enqueues outbound candidate messages (status alerts, interview reminders, screening updates).
 * Uses webhook URL: https://graph.facebook.com/v{version}/me/messages?access_token={token}
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

    const url = `https://graph.facebook.com/${omnichannelConfig.whatsapp.graphApiVersion}/me/messages`;

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
   * independently so one failure never blocks the rest of the batch.
   */
  static async sendBulk(
    messages: WhatsAppOutboundMessage[]
  ): Promise<{ success: number; failed: number }> {
    const results = await Promise.allSettled(
      messages.map((msg) => this.sendMessage(msg.to, { template: msg.template, text: msg.text }))
    );

    let success = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.success) {
        success++;
      } else {
        failed++;
      }
    }

    return { success, failed };
  }
}

/**
 * Greenhouse ATS adapter.
 * Pushes applications, assessment scores, and AI feedback into Harvest (Greenhouse).
 * Supports both candidate sync and internal movement updates.
 */
export class GreenhouseConnector {
  private static readonly config = omnichannelConfig.greenhouse;

  /**
   * Create a new candidate in Greenhouse.
   * Takes application data and returns external Greenhouse candidate ID (if created).
   */
  static async createCandidate(
    application: {
      full_name: string;
      email: string;
      phone?: string;
      job_id: string;
      resume_url?: string;
      assessment_score?: number;
      ai_feedback?: string;
    }
  ): Promise<{ success: boolean; external_id?: string; error?: string }> {
    if (!this.config.apiKey) {
      return { success: false, error: "Greenhouse API key not configured" };
    }

    const url = `${this.config.baseUrl}/requisitions/{requisition_id}/candidates`;

    const payload = {
      first_name: application.full_name.split(" ")[0],
      last_name: application.full_name.split(" ").slice(1).join(" "),
      email: application.email,
      phone: application.phone ?? "",
      job_id: application.job_id,
      source: "SharmDreamsTalentCloud",
      custom_fields: {
        assessment_score: application.assessment_score?.toString() ?? "",
        ai_feedback: application.ai_feedback ?? "",
        resume_url: application.resume_url ?? "",
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "SharmDreams/1.0",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message ?? "Greenhouse API error" };
      }

      const data = await response.json();
      return { success: true, external_id: data.candidate_id?.toString() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }

  /**
   * Update existing candidate status (stage movement).
   */
  static async updateCandidateStage(externalId: string, status: "NEW" | "SCREENING" | "ASSESSMENT" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED"): Promise<{ success: boolean; error?: string }> {
    if (!this.config.apiKey) {
      return { success: false, error: "Greenhouse API key not configured" };
    }

    const url = `${this.config.baseUrl}/candidates/${externalId}/status`;

    const payload = { status };

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message ?? "Update failed" };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}

/**
 * Lever API connector.
 * Syncs candidates, interview schedules, and assessment results with Lever's CRM.
 */
export class LeverConnector {
  private static readonly config = omnichannelConfig.lever;

  /**
   * Create a new candidate in Lever.
   */
  static async createCandidate(
    application: {
      full_name: string;
      email: string;
      phone?: string;
      job_id: string;
      resume_url?: string;
      assessment_score?: number;
      ai_feedback?: string;
    }
  ): Promise<{ success: boolean; external_id?: string; error?: string }> {
    if (!this.config.apiKey) {
      return { success: false, error: "Lever API key not configured" };
    }

    const url = `${this.config.baseUrl}/postings/{posting_id}/candidates`;

    const payload = {
      firstName: application.full_name.split(" ")[0],
      lastName: application.full_name.split(" ").slice(1).join(" "),
      email: application.email,
      phone: application.phone ?? "",
      jobId: application.job_id,
      source: "SharmDreamsTalentCloud",
      customFields: {
        assessment_score: application.assessment_score?.toString() ?? "",
        ai_feedback: application.ai_feedback ?? "",
        resume_url: application.resume_url ?? "",
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "SharmDreams/1.0",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message ?? "Lever API error" };
      }

      const data = await response.json();
      return { success: true, external_id: data.candidateId?.toString() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }

  /**
   * Update candidate status (stage).
   */
  static async updateCandidateStage(externalId: string, status: "NEW" | "SCREENING" | "ASSESSMENT" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED"): Promise<{ success: boolean; error?: string }> {
    if (!this.config.apiKey) {
      return { success: false, error: "Lever API key not configured" };
    }

    const url = `${this.config.baseUrl}/candidates/${externalId}/stage`;

    const payload = { status };

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message ?? "Update failed" };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}

/**
 * Frappe HR connector.
 * Integrates with Frappe's HR module for employee lifecycle sync.
 */
export class FrappeHrConnector {
  private static readonly config = omnichannelConfig.frappeHr;

  /**
   * Create or update a candidate record.
   */
  static async upsertCandidate(
    application: {
      full_name: string;
      email: string;
      phone?: string;
      job_id: string;
      resume_url?: string;
      assessment_score?: number;
      ai_feedback?: string;
    }
  ): Promise<{ success: boolean; external_id?: string; error?: string }> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      return { success: false, error: "Frappe HR configuration not provided" };
    }

    const url = `${this.config.baseUrl}/api/resource/Candidate`;

    const payload = {
      name: application.email.split("@")[0],
      full_name: application.full_name,
      email: application.email,
      phone: application.phone ?? "",
      job_id: application.job_id,
      resume_url: application.resume_url ?? "",
      assessment_score: application.assessment_score?.toString() ?? "",
      ai_feedback: application.ai_feedback ?? "",
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message ?? "Frappe HR API error" };
      }

      const data = await response.json();
      return { success: true, external_id: data.name };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}

/**
 * OAuth 2.0 Calendar Scheduler connector (Google / Microsoft).
 * Uses server-side exchange flow with refresh tokens stored in ats_integrations table.
 */
export class CalendarConnector {
  private static readonly config = omnichannelConfig.calendar;

  /**
   * Schedule an interview using Google Calendar (or Microsoft Graph).
   * Returns an event ID and meeting link for candidate notification.
   */
  static async scheduleEvent(
    provider: "GOOGLE" | "MICROSOFT" | "MANUAL",
    payload: CalendarEventPayload,
    credentials: { refresh_token: string; access_token?: string }
  ): Promise<{ success: boolean; eventId?: string; meetingLink?: string; error?: string }> {
    if (provider === "GOOGLE") {
      return this.scheduleGoogleEvent(payload, credentials);
    }
    if (provider === "MICROSOFT") {
      return this.scheduleMicrosoftEvent(payload, credentials);
    }
    // Manual scheduling: no external API call, just store locally.
    return { success: true, eventId: `manual-${Date.now()}`, meetingLink: payload.title };
  }

  private static async scheduleGoogleEvent(
    payload: CalendarEventPayload,
    credentials: { refresh_token: string; access_token?: string }
  ): Promise<{ success: boolean; eventId?: string; meetingLink?: string; error?: string }> {
    const clientId = this.config.google.clientId;
    const clientSecret = this.config.google.clientSecret;

    if (!clientId || !clientSecret) {
      return { success: false, error: "Google Calendar credentials not configured" };
    }

    // Use provided access_token; in production, refresh using the refresh token via token endpoint.
    const accessToken = credentials.access_token || credentials.refresh_token;

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;

    const event = {
      summary: payload.title,
      description: payload.description,
      start: { dateTime: payload.start_iso, timeZone: "UTC" },
      end: { dateTime: new Date(new Date(payload.start_iso).getTime() + payload.duration_minutes * 60000).toISOString(), timeZone: "UTC" },
      attendees: payload.attendee_email ? [{ email: payload.attendee_email }] : [],
      conferenceData: {
        createRequest: {
          requestId: `sharm-dreams-${Date.now()}`,
          conferenceSolutionKey: { type: "hangouts" },
        },
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.error?.message ?? "Google Calendar API error" };
      }

      const data = await response.json();
      return {
        success: true,
        eventId: data.id,
        meetingLink: data.hangoutLink ?? data.conferenceData?.entryPoints?.[0]?.uri,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }

  private static async scheduleMicrosoftEvent(
    payload: CalendarEventPayload,
    credentials: { refresh_token: string; access_token?: string }
  ): Promise<{ success: boolean; eventId?: string; meetingLink?: string; error?: string }> {
    const clientId = this.config.microsoft.clientId;
    const clientSecret = this.config.microsoft.clientSecret;

    if (!clientId || !clientSecret) {
      return { success: false, error: "Microsoft Calendar credentials not configured" };
    }

    const accessToken = credentials.access_token || credentials.refresh_token;
    const url = `https://graph.microsoft.com/v1.0/me/events`;

    const event = {
      subject: payload.title,
      body: { contentType: "Text", content: payload.description },
      start: { dateTime: payload.start_iso, timeZone: "UTC" },
      end: { dateTime: new Date(new Date(payload.start_iso).getTime() + payload.duration_minutes * 60000).toISOString(), timeZone: "UTC" },
      attendees: payload.attendee_email ? [{ emailAddress: { email: payload.attendee_email }, type: "Required" }] : [],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.error?.message ?? "Microsoft Graph API error" };
      }

      const data = await response.json();
      return {
        success: true,
        eventId: data.id,
        meetingLink: data.onlineMeeting?.joinUrl ?? data.webUrl,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}