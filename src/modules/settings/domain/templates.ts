/**
 * Notification template registry and rendering.
 *
 * Deliberately pure — no database, no "server-only" — so the exact same
 * function runs inside the dispatch path and inside the Settings preview.
 * What a recruiter reads while editing a template is what the candidate
 * receives.
 */

/** Values a template may interpolate. Empty string means "known, no value". */
export type TemplateVars = Record<string, string>;

/**
 * What a template write reports back.
 *
 * The row's channel and key travel out of the action because they are the only
 * things that say where the change can be seen: the console files a row under its
 * channel's tab, so a link that opens WhatsApp beside the email a recruiter just
 * rewrote reads as though the save went somewhere else. A refusal carries neither
 * — nothing was written, so there is no row to point at.
 */
export interface TemplateWriteResult {
  ok: boolean;
  error?: string;
  channel?: string;
  key?: string;
}

/** Older seeded copy used these names; both spellings render. */
const PLACEHOLDER_ALIASES: Record<string, string> = {
  scheduled_at: "interview_when",
  meeting_link: "interview_link",
};

/**
 * Replaces `{{token}}` groups.
 *
 * A token whose value is supplied is replaced even when it is empty — that is
 * how `{{interview_link}}` disappears from a message about a cancelled
 * interview. A token we do not know is left visible instead of being silently
 * dropped, so a typo surfaces in the preview rather than in a candidate's
 * phone.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, raw: string) => {
    const key = PLACEHOLDER_ALIASES[raw] ?? raw;
    return key in vars ? vars[key] : match;
  });
}

/** Placeholders the platform can fill, shown as a hint beside each editor. */
export const TEMPLATE_TOKENS: { token: string; renders: string }[] = [
  { token: "{{candidate_name}}", renders: "candidate full name" },
  { token: "{{job_title}}", renders: "opening title" },
  { token: "{{stage}}", renders: "pipeline stage, human-readable" },
  { token: "{{company_name}}", renders: "Settings → Organisation name" },
  { token: "{{assessment_link}}", renders: "start-test link, empty if none" },
  { token: "{{interview_when}}", renders: "slot time in the organisation timezone, e.g. '21 Oct 2026, 21:00 EEST'" },
  { token: "{{interview_duration}}", renders: "slot length in minutes" },
  { token: "{{interview_link}}", renders: "' Join here: <url>', empty when no link" },
];

/** Sample values the Settings preview renders a template against. */
export const TEMPLATE_PREVIEW_VARS: TemplateVars = {
  candidate_name: "Mariam Hassan",
  job_title: "Financial Planning & Analysis Manager",
  stage: "interview",
  company_name: "Sharm Dreams Group",
  assessment_link: "Start it here: https://example.com/test/ab12cd34",
  interview_when: "21 Oct 2026, 21:00 EEST",
  interview_duration: "45",
  interview_link: " Join here: https://meet.example.com/panel",
};

/** Template key for each pipeline-stage alert. */
export const WHATSAPP_STAGE_TEMPLATES: Record<string, string> = {
  NEW: "stage_new",
  AI_SCREENING: "stage_ai_screening",
  ASSESSMENT: "stage_assessment",
  INTERVIEW: "stage_interview",
  OFFER: "stage_offer",
  HIRED: "stage_hired",
  REJECTED: "stage_rejected",
};

/** Generic row used when a stage has no template of its own. */
export const STAGE_FALLBACK_TEMPLATE = "status_update";

/** Template key for each interview scheduling notice. */
export const WHATSAPP_INTERVIEW_TEMPLATES: Record<"SCHEDULED" | "CHANGED" | "CANCELLED", string> = {
  SCHEDULED: "interview_scheduled",
  CHANGED: "interview_changed",
  CANCELLED: "interview_cancelled",
};

/**
 * The one notice that is not a pipeline move: a recruiter issuing a test.
 *
 * A stage alert fires when the candidate *reaches* Assessment, which is usually
 * before anybody has issued a suite, so `{{assessment_link}}` renders empty in
 * that message. This row is what carries a working start link.
 */
export const ASSESSMENT_INVITE_TEMPLATE = "assessment_invite";

/**
 * Template key for each pipeline-stage email.
 *
 * Deliberately not a copy of the WhatsApp map: three rows the email channel
 * reads already exist in `notification_templates` with letter-style copy and a
 * subject line (`application_received`, `interview_scheduled`, `offer_letter`),
 * so the email channel reads the copy the platform ships rather than a shortened
 * chat message. Keys with no row fall back to `EMAIL_TEMPLATE_DEFAULTS`.
 */
export const EMAIL_STAGE_TEMPLATES: Record<string, string> = {
  NEW: "application_received",
  AI_SCREENING: "stage_ai_screening",
  ASSESSMENT: "stage_assessment",
  INTERVIEW: "stage_interview",
  OFFER: "offer_letter",
  HIRED: "stage_hired",
  REJECTED: "stage_rejected",
};

/** Same interview events, as email. */
export const EMAIL_INTERVIEW_TEMPLATES: Record<"SCHEDULED" | "CHANGED" | "CANCELLED", string> = {
  SCHEDULED: "interview_scheduled",
  CHANGED: "interview_changed",
  CANCELLED: "interview_cancelled",
};

/**
 * Subjects shipped in code, used when the stored EMAIL row has no subject.
 * An email without one is rejected by some relays, so this is never left blank.
 */
export const EMAIL_SUBJECT_DEFAULTS: Record<string, string> = {
  application_received: "We received your application — {{job_title}}",
  stage_ai_screening: "Your application is under review — {{job_title}}",
  stage_assessment: "Next step: your assessment for {{job_title}}",
  stage_interview: "Interview stage — {{job_title}}",
  offer_letter: "Offer from {{company_name}}",
  stage_hired: "Welcome to {{company_name}}",
  stage_rejected: "Your application for {{job_title}}",
  status_update: "Application update — {{job_title}}",
  interview_scheduled: "Interview confirmed — {{job_title}}",
  interview_changed: "Your interview time has moved — {{job_title}}",
  interview_cancelled: "Interview cancelled — {{job_title}}",
  assessment_invite: "Your assessment for {{job_title}}",
};

/**
 * The line an email gets when neither the row nor the table above names one.
 *
 * `resolveEmailCopy` has always filled this in, but the shipped-copy lookup used
 * to answer with an empty string, so a reset could store a blank subject on a
 * letter that would arrive with a line on it. One constant, both paths.
 */
export const EMAIL_SUBJECT_FALLBACK = "An update on your application";

/** Letter-style bodies used when no EMAIL row exists for the key. */
export const EMAIL_TEMPLATE_DEFAULTS: Record<string, string> = {
  stage_ai_screening:
    "Dear {{candidate_name}},\n\nThank you for applying for {{job_title}}. Our team is reviewing your application now, and we will write to you as soon as we have a decision.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  stage_assessment:
    "Dear {{candidate_name}},\n\nGood news — we would like you to move to the assessment stage for {{job_title}}.\n\n{{assessment_link}}\n\nThe assessment is timed, so please choose a moment when you can focus without interruption.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  stage_interview:
    "Dear {{candidate_name}},\n\nYou have reached the interview stage for {{job_title}}. A member of the team will be in touch shortly to propose a time.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  stage_hired:
    "Dear {{candidate_name}},\n\nWelcome aboard. The {{job_title}} team is looking forward to working with you, and your onboarding details will follow by email.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  stage_rejected:
    "Dear {{candidate_name}},\n\nThank you for taking the time to apply for {{job_title}}. After careful review we will not be progressing your application on this occasion.\n\nWe appreciate the interest you have shown in {{company_name}} and wish you every success in your search.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  /**
   * The offer had no shipped body, so the letter a candidate got was whatever the
   * one database row said: blank or delete that row and the offer arrived as the
   * generic status-update line. It closes with `OFFER_ATTACHMENT_CLAIM` exactly,
   * which is what tells the dispatch path to build and attach the PDF.
   */
  offer_letter:
    "Dear {{candidate_name}},\n\nCongratulations! We are pleased to offer you the position of {{job_title}}. The formal documents are attached.\n\nYour start date and the terms of the offer are confirmed with you directly.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  interview_changed:
    "Dear {{candidate_name}},\n\nWe have moved your interview for {{job_title}} to {{interview_when}} (approximately {{interview_duration}} minutes).{{interview_link}}\n\nPlease let us know if the new time does not suit you.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  interview_cancelled:
    "Dear {{candidate_name}},\n\nWe have had to cancel your interview for {{job_title}} that was set for {{interview_when}}. We will write again to arrange another time.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
  assessment_invite:
    "Dear {{candidate_name}},\n\nYour assessment for {{job_title}} is ready.\n\n{{assessment_link}}\n\nIt is timed, so please choose a moment when you can work without interruption, and start it as soon as you can — the link stops working once the window closes.\n\nKind regards,\nTalent Acquisition, {{company_name}}",
};

/**
 * Copy shipped in code, used when a template row is missing or inactive.
 * `{{interview_link}}` carries its own lead text here because the token is
 * replaced by a whole phrase, not just a URL.
 */
export const TEMPLATE_DEFAULTS: Record<string, string> = {
  stage_new:
    "Hi {{candidate_name}}, your application for {{job_title}} is active in our pipeline again. We will keep you updated here.",
  stage_ai_screening:
    "Hi {{candidate_name}}, your application for {{job_title}} is now being reviewed by our screening team.",
  stage_assessment:
    "Hi {{candidate_name}}, good news — you have moved to the assessment stage for {{job_title}}. {{assessment_link}}",
  stage_interview:
    "Hi {{candidate_name}}, you have reached the interview stage for {{job_title}}. We will be in touch shortly to arrange a time.",
  stage_offer:
    "Hi {{candidate_name}}, we are excited to move forward with an offer for {{job_title}}. The details are on their way.",
  stage_hired:
    "Welcome aboard, {{candidate_name}}! The {{job_title}} team is looking forward to having you.",
  stage_rejected:
    "Hi {{candidate_name}}, thank you for your interest in {{job_title}}. After careful review we will not be progressing your application this time. We appreciate the time you invested and wish you every success.",
  status_update:
    "Hi {{candidate_name}}, an update on your application for {{job_title}}: your status is now {{stage}}.",
  interview_scheduled:
    "Hi {{candidate_name}}, your interview for {{job_title}} is confirmed for {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}",
  interview_changed:
    "Hi {{candidate_name}}, we have moved your interview for {{job_title}} to {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}",
  interview_cancelled:
    "Hi {{candidate_name}}, we have cancelled your interview for {{job_title}} that was set for {{interview_when}}. We will be in touch to arrange another time.",
  assessment_invite:
    "Hi {{candidate_name}}, your assessment for {{job_title}} is ready. {{assessment_link}}",
};

/**
 * First-touch copy for a LinkedIn-sourced prospect.
 *
 * Not a pipeline notification: nobody applied, so the letter introduces the
 * role rather than acknowledging an application. Both keys are editable in
 * Settings → Access & comms → Templates like any other row.
 */
export const PROSPECT_OUTREACH_TEMPLATES: Record<"EMAIL" | "WHATSAPP", string> = {
  EMAIL: "prospect_outreach_email",
  WHATSAPP: "prospect_outreach_whatsapp",
};

export const PROSPECT_OUTREACH_DEFAULTS: Record<
  "EMAIL" | "WHATSAPP",
  { subject: string; body: string }
> = {
  EMAIL: {
    subject: "A role at {{company_name}} — {{job_title}}",
    body:
      "Hello {{candidate_name}},\n\nI came across your profile and your background looks like a strong match for {{job_title}} at {{company_name}}.\n\nWe are hiring for this role now. If you would like to hear more, reply to this email and I will send the details.\n\nBest regards,\n{{company_name}} Talent Team",
  },
  WHATSAPP: {
    subject: "",
    body:
      "Hi {{candidate_name}}, this is {{company_name}}. Your profile looked like a strong match for {{job_title}} — are you open to hearing more?",
  },
};

/**
 * The subject line the personalized feedback letter goes out under.
 *
 * Deliberately not a template row. Its body is `applications.ai_feedback` — a
 * letter the screening engine wrote for one candidate and a recruiter rewrites
 * by drafting again — so a copy editor in Settings could not change what the
 * candidate receives without changing what the profile shows. The draft is sent
 * as written, and only the subject line is shipped here.
 */
export const CANDIDATE_FEEDBACK_SUBJECT = "Feedback on your application — {{job_title}}";

/**
 * The promise an offer letter makes, and the honest version of it.
 *
 * `offer_letter` has always closed with the first line while the mailer carried
 * no attachments at all, so the dispatch path now sends the second whenever the
 * document could not be written. The match is exact, not fuzzy: a recruiter who
 * rewrote that sentence owns the wording, and there is nothing here to correct.
 */
export const OFFER_ATTACHMENT_CLAIM = "The formal documents are attached.";
export const OFFER_ATTACHMENT_FALLBACK =
  "Your formal offer documents will follow in a separate email.";

/** True when this copy promises a document the sender then has to attach. */
export function promisesAttachment(body: string): boolean {
  return body.includes(OFFER_ATTACHMENT_CLAIM);
}

/** The same letter with its attachment promise told honestly. */
export function withoutAttachmentClaim(body: string): string {
  return body.split(OFFER_ATTACHMENT_CLAIM).join(OFFER_ATTACHMENT_FALLBACK);
}

/** INTERVIEW -> "interview", AI_SCREENING -> "AI screening". */
export function humanizeStage(stage: string): string {
  const words = stage.toLowerCase().split("_").join(" ");
  return words.replace(/^\w/, (letter) => letter.toUpperCase()).replace(/^Ai /, "AI ");
}

/** What each wired template is used for, keyed by template key. */
export const TEMPLATE_PURPOSE: Record<string, string> = Object.fromEntries(
  Object.entries(WHATSAPP_STAGE_TEMPLATES).map(([stage, key]) => [
    key,
    `Sent when a candidate moves to ${humanizeStage(stage)}`,
  ])
);
Object.assign(TEMPLATE_PURPOSE, {
  [STAGE_FALLBACK_TEMPLATE]: "Fallback for a stage that has no template of its own",
  interview_scheduled: "Sent when a recruiter books a panel",
  interview_changed: "Sent when a booked panel moves",
  interview_cancelled: "Sent when a booked panel is cancelled",
  assessment_invite: "Sent when a recruiter issues a test — carries the start link",
  application_received: "Sent when a candidate submits an application",
  offer_letter:
    "Sent when a candidate moves to the offer stage — the emailed body is also attached as a PDF letter",
  prospect_outreach_email:
    "First-touch email to a LinkedIn-sourced prospect, from the Sourcing board",
  prospect_outreach_whatsapp:
    "First-touch WhatsApp message to a LinkedIn-sourced prospect, from the Sourcing board",
});

/**
 * The keys each channel's dispatch asks for, by the channel it filters on.
 *
 * `resolveTemplate` reads WhatsApp's list with `.eq("channel", "WHATSAPP")` and
 * `resolveEmailCopy` reads email's with `.eq("channel", "EMAIL")`, so a key is
 * only live copy on the channel whose reader names it. An `application_received`
 * row filed under WhatsApp would sit in a tab and never be looked up.
 */
const CHANNEL_TEMPLATE_KEYS: Record<"WHATSAPP" | "EMAIL", readonly string[]> = {
  WHATSAPP: [
    ...Object.values(WHATSAPP_STAGE_TEMPLATES),
    ...Object.values(WHATSAPP_INTERVIEW_TEMPLATES),
    ASSESSMENT_INVITE_TEMPLATE,
    STAGE_FALLBACK_TEMPLATE,
  ],
  EMAIL: [
    ...Object.values(EMAIL_STAGE_TEMPLATES),
    ...Object.values(EMAIL_INTERVIEW_TEMPLATES),
    ASSESSMENT_INVITE_TEMPLATE,
    STAGE_FALLBACK_TEMPLATE,
  ],
};

/**
 * True when a row actually shapes something the platform sends.
 *
 * A key is only live copy on the channel whose dispatch consults it, so this is
 * a question about the pair, not about the key. The Sourcing board is the one
 * reader that ignores the channel column — it looks its two prospect rows up by
 * key alone, so those are read whichever tab they sit on. An `IN_APP` row is read
 * by nobody: a portal notice is rendered from the email copy, never from a row of
 * its own, which is what the templates tab's own comment says.
 */
export function templateIsWired(template: { key: string; channel: string }): boolean {
  if (Object.values(PROSPECT_OUTREACH_TEMPLATES).includes(template.key)) return true;
  const keys = CHANNEL_TEMPLATE_KEYS[template.channel as "WHATSAPP" | "EMAIL"];
  return Boolean(keys?.includes(template.key));
}

/**
 * The copy shipped in code for one key on one channel.
 *
 * Written as a lookup rather than inlined into the console because the answer
 * has to match what the dispatch paths really do: `resolveTemplate` reads
 * `TEMPLATE_DEFAULTS`, `resolveEmailCopy` reads `EMAIL_TEMPLATE_DEFAULTS` and
 * then `TEMPLATE_DEFAULTS`, and the Sourcing board reads
 * `PROSPECT_OUTREACH_DEFAULTS`. It returns null where those chains have no
 * entry for this exact key, which is the console's signal that deleting the
 * row sends the generic status-update line instead — not nothing, but not this
 * letter either.
 */
export function shippedTemplate(
  key: string,
  channel: string
): { subject: string; body: string } | null {
  if (key === PROSPECT_OUTREACH_TEMPLATES.EMAIL) {
    return PROSPECT_OUTREACH_DEFAULTS.EMAIL;
  }
  if (key === PROSPECT_OUTREACH_TEMPLATES.WHATSAPP) {
    return { subject: "", body: PROSPECT_OUTREACH_DEFAULTS.WHATSAPP.body };
  }

  if (channel === "WHATSAPP") {
    const body = TEMPLATE_DEFAULTS[key];
    return body ? { subject: "", body } : null;
  }

  // Email and the portal notice share a body; only email has a subject line.
  const body = EMAIL_TEMPLATE_DEFAULTS[key] ?? TEMPLATE_DEFAULTS[key];
  if (!body) return null;
  return { subject: EMAIL_SUBJECT_DEFAULTS[key] ?? EMAIL_SUBJECT_FALLBACK, body };
}

