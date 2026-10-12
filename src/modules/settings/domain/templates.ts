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
  { token: "{{interview_when}}", renders: "slot time in UTC, e.g. '12 Oct 2026, 10:30 UTC'" },
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
  interview_when: "12 Oct 2026, 10:30 UTC",
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
};

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
  assessment_invite: "Superseded by the assessment stage template",
});

/**
 * True when a row actually shapes something the platform sends. Email rows are
 * stored but unread until an email provider is configured, and a WHATSAPP key
 * outside the registry is copy no flow asks for.
 */
export function templateIsWired(template: { key: string; channel: string }): boolean {
  if (template.channel !== "WHATSAPP") return false;
  const wired = new Set<string>([
    ...Object.values(WHATSAPP_STAGE_TEMPLATES),
    ...Object.values(WHATSAPP_INTERVIEW_TEMPLATES),
    STAGE_FALLBACK_TEMPLATE,
  ]);
  return wired.has(template.key) && template.key !== "assessment_invite";
}

