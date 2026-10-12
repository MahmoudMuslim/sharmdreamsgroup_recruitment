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
    description: "Identity and defaults shown across portals, emails and reports.",
    icon: "building",
    controls: [
      { kind: "text", key: "organisation.name", label: "Organisation name" },
      {
        kind: "email",
        key: "organisation.support_email",
        label: "Support email",
        help: "Reply-to address for candidate communications.",
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
        help: "Public asset path for the group wordmark.",
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
        help: "Strips names, ages, gender and nationality before the CV reaches a model.",
      },
      {
        kind: "number",
        key: "ai.match_threshold_advance",
        label: "Auto-advance threshold",
        help: "Candidates scoring at or above this move forward automatically.",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        kind: "number",
        key: "ai.match_threshold_reject",
        label: "Auto-reject threshold",
        help: "Candidates scoring below this are filtered out automatically.",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        kind: "toggle",
        key: "ai.generate_feedback",
        label: "Personalised feedback",
        help: "Send every applicant constructive feedback after a decision.",
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
    description: "Timing, link validity, autosave and integrity rules.",
    icon: "clipboard",
    controls: [
      {
        kind: "number",
        key: "assessment.default_duration_minutes",
        label: "Default duration",
        help: "Applied to new test suites.",
        min: 5,
        max: 300,
        unit: "min",
      },
      {
        kind: "number",
        key: "assessment.link_validity_hours",
        label: "Link validity",
        help: "How long an invitation link can be opened.",
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
        help: "Candidates are told whenever the test window loses focus.",
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
    description: "ATS and calendar connections. Credentials live in environment variables.",
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
    description: "Session, password and data-masking policy.",
    icon: "shield",
    controls: [
      {
        kind: "number",
        key: "security.session_timeout_minutes",
        label: "Session timeout",
        help: "Staff are signed out after this much inactivity.",
        min: 15,
        max: 1440,
        unit: "min",
      },
      {
        kind: "number",
        key: "security.password_min_length",
        label: "Minimum password length",
        min: 8,
        max: 64,
      },
      {
        kind: "toggle",
        key: "security.require_oauth",
        label: "Require single sign-on",
        help: "Force Google OAuth for every staff account.",
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

/** Flat list of every controllable setting key — used to validate writes. */
export const ALLOWED_SETTING_KEYS: ReadonlySet<string> = new Set(
  SETTINGS_SCHEMA.flatMap((section) => section.controls.map((control) => control.key))
);

/** Re-exported for consumers that only need the control union. */
export type { SettingControl };