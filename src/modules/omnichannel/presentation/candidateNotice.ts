/**
 * What a candidate was actually told, in the recruiter's words.
 *
 * Both places that move an interview — the panel on a candidate's profile and
 * the agenda — answer this after a booking changes, so it is written once: two
 * copies of a sentence about a failed send is how one console starts claiming
 * the candidate was notified when the other says they were not.
 */

import type { MessagingReport } from "@/modules/omnichannel/application/candidate-notifications";

/**
 * Says refused rather than sent when the relay rejected the email: the row is in
 * the outbox with the relay's answer, and the portal notice still reached them.
 */
export function channelSummary(
  channels: MessagingReport | undefined,
  notified: boolean | undefined
): string {
  if (!channels) {
    return notified
      ? "The candidate was notified on the channels that are switched on."
      : "(no channel delivered a note — WhatsApp is off or the candidate has no number.)";
  }

  const parts: string[] = [];
  if (channels.whatsapp === "queued") parts.push("a queued WhatsApp note");
  if (channels.email === "sent") parts.push("an email");
  if (channels.email === "failed") parts.push("an email the relay refused (see Outbox)");
  if (channels.inApp === "sent") parts.push("a portal notice");

  if (parts.length === 0) {
    return "(nothing reached the candidate — every channel is off, or the email and number are missing.)";
  }
  const last = parts.pop() as string;
  return `The candidate was sent ${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
}
