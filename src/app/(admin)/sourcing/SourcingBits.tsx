"use client";

import { renderTemplate } from "@/modules/settings/domain/templates";
import {
  type OutreachChannel,
  type ProspectRow
} from "./actions";

export function stageTone(stage: string) {
  if (stage === "CONVERTED" || stage === "REPLIED") return "success" as const;
  if (stage === "CONTACTED" || stage === "INTERVIEW") return "gold" as const;
  if (stage === "PASSED") return "danger" as const;
  return "info" as const;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * Where a record came from, in words a recruiter reads rather than the column
 * value. `CHATBOT` is written by the careers assistant when a visitor leaves
 * their details after a conversation, with the transcript in the notes.
 */
export function originLabel(origin: string) {
  if (origin === "CHATBOT") return "Careers assistant (public site)";
  if (origin === "LINKEDIN") return "LinkedIn links";
  if (origin === "CSV") return "CSV import";
  if (origin === "MANUAL") return "Added by hand";
  return origin;
}

/** What a message can still be edited with before it goes out. */
function varsFor(prospect: ProspectRow, companyName = "Sharm Dreams Group") {
  return {
    candidate_name: prospect.full_name,
    job_title: prospect.job_title ?? "one of our roles",
    company_name: companyName,
  };
}

function mailtoLink(prospect: ProspectRow, subject: string, body: string) {
  if (!prospect.email) return null;
  const vars = varsFor(prospect);
  return `mailto:${prospect.email}?subject=${encodeURIComponent(
    renderTemplate(subject, vars)
  )}&body=${encodeURIComponent(renderTemplate(body, vars))}`;
}

function waLink(prospect: ProspectRow, body: string) {
  const digits = prospect.phone?.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(renderTemplate(body, varsFor(prospect)))}`;
}

/** The two fields a reach door needs, and the form inputs that hold them. */
export type ContactField = "email" | "phone";

/**
 * What a reach door can actually do now: open the composed first-touch letter,
 * or name the field that is missing. A pasted LinkedIn profile rarely arrives
 * with an address, so "nothing to send to" is the common case — the door should
 * lead to the fix instead of quietly disappearing from the page.
 */
export function reachDoor(
  prospect: ProspectRow,
  channel: OutreachChannel,
  copy: Record<OutreachChannel, { subject: string; body: string }>
): { field: ContactField; address: string; href: string } | { field: ContactField; address: null; href: null } {
  if (channel === "EMAIL") {
    const href = prospect.email
      ? mailtoLink(prospect, copy.EMAIL.subject, copy.EMAIL.body)
      : null;
    return prospect.email && href
      ? { field: "email", address: prospect.email, href }
      : { field: "email", address: null, href: null };
  }

  const href = prospect.phone ? waLink(prospect, copy.WHATSAPP.body) : null;
  return prospect.phone && href
    ? { field: "phone", address: prospect.phone, href }
    : { field: "phone", address: null, href: null };
}
