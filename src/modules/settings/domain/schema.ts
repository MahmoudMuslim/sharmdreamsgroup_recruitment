import type { SettingControl, SettingsSection } from "@/modules/settings/domain/types";

/**
 * Declarative definition of every platform setting the admin can control.
 * The UI renders straight from this, and the server action validates incoming
 * keys against it so a rogue client cannot write arbitrary rows.
 */
export const SETTINGS_SCHEMA: readonly SettingsSection[] = [
  {
    // `id` doubles as the setting-key prefix (`organisation.*`), so it stays put;
    // the title is "General" because "Organisation" now names the master-data area.
    id: "organisation",
    title: "General",
    description: "Identity and defaults for the group.",
    icon: "building",
    controls: [
      {
        kind: "text",
        key: "organisation.name",
        label: "Organisation name",
        help: "Fills {{company_name}} in notification templates and labels the portals.",
      },
      {
        kind: "email",
        key: "organisation.support_email",
        label: "Support email",
        help: "The address candidates are pointed to when they need help in the portal.",
      },
      {
        kind: "select",
        key: "organisation.locale",
        label: "Default language",
        options: [
          { value: "en", label: "English" },
          { value: "ar", label: "Arabic (العربية)" },
          { value: "ru", label: "Russian (Русский)" },
          { value: "de", label: "German (Deutsch)" },
        ],
      },
      {
        kind: "multiselect",
        key: "organisation.enabled_locales",
        label: "Enabled languages",
        help: "Candidates can switch between these in the portal.",
        options: [
          { value: "en", label: "English" },
          { value: "ar", label: "Arabic" },
          { value: "ru", label: "Russian" },
          { value: "de", label: "German" },
        ],
      },
      {
        kind: "select",
        key: "organisation.timezone",
        label: "Timezone",
        options: [
          { value: "Africa/Cairo", label: "Cairo (EET)" },
          { value: "Europe/Moscow", label: "Moscow" },
          { value: "Europe/Berlin", label: "Berlin (CET)" },
          { value: "UTC", label: "UTC" },
        ],
      },
      {
        kind: "text",
        key: "branding.logo_url",
        label: "Logo path",
        help: "Asset the wordmark is served from in every header. Clear it to use the shipped logo.",
        placeholder: "/sdg-icon.png",
      },
    ],
  },

  {
    id: "ai",
    title: "AI & screening",
    description: "Model behaviour, bias reduction and automation thresholds.",
    icon: "sparkles",
    controls: [
      {
        kind: "toggle",
        key: "ai.enabled",
        label: "Enable AI features",
        help: "Master switch for screening, scoring and feedback.",
      },
      {
        kind: "toggle",
        key: "ai.auto_screen_applications",
        label: "Screen applications automatically",
        help: "Runs CV screening the moment an application is received.",
      },
      {
        kind: "toggle",
        key: "ai.bias_reduction",
        label: "Bias reduction",
        help: "Strips gender, age, nationality, marital status, religion, ethnicity, photo, address and contact markers before the CV reaches a model — candidate names are not removed by this filter. The mode used is recorded on each screened candidate, and switching it off sends the CV as submitted.",
      },
      {
        kind: "number",
        key: "ai.match_threshold_advance",
        label: "Auto-advance threshold",
        help: "A screened score at or above this moves the application to Assessment and queues the candidate notification. Only applications nobody has touched yet move, 0 switches it off, and issuing the actual test stays with the recruiter.",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        kind: "number",
        key: "ai.match_threshold_reject",
        label: "Auto-reject threshold",
        help: "A screened score below this closes the application and stores the score and summary as the rejection reason the candidate sees. Queues the notification for applications nobody has touched yet; 0 switches it off.",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        kind: "toggle",
        key: "ai.generate_feedback",
        label: "Personalised feedback",
        help: "Drafts feedback automatically when a recruiter records a hire or rejection. Screening never sends feedback, and the Draft feedback button works whatever this is set to.",
      },
      {
        kind: "toggle",
        key: "ai.interview_questions",
        label: "Generate interview questions",
        help: "Create targeted questions from detected resume gaps.",
      },
    ],
  },

  {
    id: "assessment",
    title: "Assessments",
    description: "Timing, link validity, autosave and integrity values.",
    icon: "clipboard",
    controls: [
      {
        kind: "number",
        key: "assessment.default_duration_minutes",
        label: "Default duration",
        help: "Pre-fills the time limit when a recruiter opens the new test suite form. Each suite keeps its own value afterwards, and existing suites are never rewritten.",
        min: 5,
        max: 300,
        unit: "min",
      },
      {
        kind: "number",
        key: "assessment.link_validity_hours",
        label: "Link validity",
        help: "Hours an invitation link stays openable before it is marked expired.",
        min: 1,
        max: 168,
        unit: "h",
      },
      {
        kind: "number",
        key: "assessment.autosave_interval_seconds",
        label: "Autosave interval",
        help: "Drafts are written to the database at this cadence.",
        min: 5,
        max: 120,
        unit: "s",
      },
      {
        kind: "toggle",
        key: "assessment.lock_on_expiry",
        label: "Auto-submit at zero",
        help: "Lock the test and submit answers when the countdown ends.",
      },
      {
        kind: "toggle",
        key: "assessment.track_focus_changes",
        label: "Record focus changes",
        help: "Records, and shows the candidate, when the test window loses focus, hides, or leaves full screen. Copy and paste signals are always kept.",
      },
    ],
  },

  {
    id: "notifications",
    title: "Notifications",
    description: "Channels used to keep candidates informed.",
    icon: "bell",
    controls: [
      {
        kind: "toggle",
        key: "notifications.email_enabled",
        label: "Email notifications",
        help: "Sends the letter-style copy under Settings → Access & comms → Email. Needs an SMTP relay under Settings → API keys.",
      },
      {
        kind: "toggle",
        key: "notifications.in_app_enabled",
        label: "In-portal notifications",
        help: "Records every alert in the candidate portal so it stays visible even when email or WhatsApp fails.",
      },
      {
        kind: "toggle",
        key: "notifications.whatsapp_enabled",
        label: "WhatsApp notifications",
        help: "Requires Meta Cloud API credentials.",
      },
      {
        kind: "toggle",
        key: "notifications.notify_on_stage_change",
        label: "Notify on stage change",
        help: "Send an update every time a candidate moves through the pipeline.",
      },
    ],
  },

  {
    id: "integrations",
    title: "Integrations",
    description: "Toggles for ATS and calendar connections. No flow acts on them yet.",
    icon: "plug",
    controls: [
      { kind: "toggle", key: "integrations.greenhouse.enabled", label: "Greenhouse" },
      { kind: "toggle", key: "integrations.lever.enabled", label: "Lever" },
      { kind: "toggle", key: "integrations.frappe_hr.enabled", label: "Frappe HR" },
      { kind: "toggle", key: "integrations.google_calendar.enabled", label: "Google Calendar" },
      { kind: "toggle", key: "integrations.microsoft_calendar.enabled", label: "Microsoft 365 Calendar" },
    ],
  },

  {
    id: "security",
    title: "Security",
    description: "Session, password and data-masking values.",
    icon: "shield",
    controls: [
      {
        kind: "number",
        key: "security.session_timeout_minutes",
        label: "Session timeout",
        help: "Returns a staff session to the sign-in screen after this much inactivity in the recruiter portal.",
        min: 15,
        max: 1440,
        unit: "min",
      },
      {
        kind: "number",
        key: "security.password_min_length",
        label: "Minimum password length",
        help: "Checked when a staff password is created under Settings → Team.",
        min: 8,
        max: 64,
      },
      {
        kind: "toggle",
        key: "security.mask_scores_for_reviewers",
        label: "Mask scores for interviewers",
        help: "Keep AI scores hidden from interviewers until shortlisting.",
      },
    ],
  },
];

/**
 * Shipped fallback for `security.password_min_length`.
 *
 * The create-user form shows this number and `createUser` enforces it, so both
 * sides of that form must fall back to the same value when no row exists yet.
 */
export const DEFAULT_PASSWORD_MIN_LENGTH = 12;

/** Flat list of every controllable setting key — used to validate writes. */
export const ALLOWED_SETTING_KEYS: ReadonlySet<string> = new Set(
  SETTINGS_SCHEMA.flatMap((section) => section.controls.map((control) => control.key))
);

/**
 * Keys the platform saves but no flow reads yet.
 *
 * The settings screen badges these instead of hiding them, so an admin is never
 * told that a switch changes behaviour when it only changes a row. Drop a key
 * from here the moment something starts reading it.
 */
export const UNENFORCED_SETTING_KEYS: ReadonlySet<string> = new Set([
  "organisation.locale",
  "organisation.enabled_locales",
  "organisation.timezone",
  "ai.interview_questions",
  "assessment.lock_on_expiry",
  "integrations.greenhouse.enabled",
  "integrations.lever.enabled",
  "integrations.frappe_hr.enabled",
  "integrations.google_calendar.enabled",
  "integrations.microsoft_calendar.enabled",
  "security.mask_scores_for_reviewers",
]);

/** Re-exported for consumers that only need the control union. */
export type { SettingControl };