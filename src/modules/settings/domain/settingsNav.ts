import { PROVIDER_GROUPS, type ProviderGroup } from "./providers";
import { SETTINGS_SCHEMA } from "./schema";
import type { NotificationChannel } from "./types";

/**
 * The settings page's navigation tree.
 *
 * Lives in the domain layer because three things have to agree on it: the left
 * dock, the page that renders the selected panel, and the panels themselves.
 * Declaring it once means a new section cannot appear in the nav without also
 * being routable, or vice versa.
 *
 * Selection is carried in the URL (`?area=&section=`) rather than in client
 * state, so the panels stay server-rendered and a deep link to
 * `/settings?area=providers&section=models` opens exactly what it says.
 */
export type SettingsAreaId = "platform" | "organisation" | "access" | "providers" | "assistant";

export interface SettingsNavSection {
  id: string;
  label: string;
  hint: string;
  icon: string;
}

export interface SettingsNavArea {
  id: SettingsAreaId;
  label: string;
  icon: string;
  blurb: string;
  sections: SettingsNavSection[];
}

/** Mirrors `MasterDataConsole`'s entities — keep the ids in step with `MasterEntity`. */
const ORGANISATION_SECTIONS: SettingsNavSection[] = [
  {
    id: "companies",
    label: "Companies",
    hint: "Legal entities in the group. Jobs, hires and onboarding plans are all scoped to one.",
    icon: "building",
  },
  {
    id: "departments",
    label: "Departments",
    hint: "Organisational units. Replaces free-text department names on job openings.",
    icon: "network",
  },
  {
    id: "locations",
    label: "Locations",
    hint: "Resorts, hubs and offices. Used by job locations and onboarding addresses.",
    icon: "pin",
  },
  {
    id: "role_families",
    label: "Role families",
    hint: "Career tracks. Links roles to their expected skill profile for gap analysis.",
    icon: "briefcase",
  },
  {
    id: "positions",
    label: "Positions",
    hint: "The posts the group hires for, and the vacancy copy a new opening starts from.",
    icon: "clipboard",
  },
  {
    id: "skills",
    label: "Skills",
    hint: "Shared skill vocabulary. Feeds AI screening, skill-gap analysis and reporting.",
    icon: "cap",
  },
  {
    id: "currencies",
    label: "Currencies",
    hint: "What salaries can be advertised in, so a range is never ambiguous.",
    icon: "coins",
  },
];

const ACCESS_SECTIONS: SettingsNavSection[] = [
  {
    id: "permissions",
    label: "Roles & permissions",
    hint: "What each role is allowed to do, and which accounts hold it.",
    icon: "shield",
  },
  {
    id: "team",
    label: "Team",
    hint: "Staff accounts, their company scope and their role.",
    icon: "users",
  },
  {
    id: "templates",
    label: "Message templates",
    hint: "The wording candidates receive at each pipeline stage.",
    icon: "bell",
  },
  {
    id: "languages",
    label: "Languages",
    hint: "The interface wording in each language, and the overrides that replace what the build ships.",
    icon: "languages",
  },
];

const PROVIDER_SECTIONS: SettingsNavSection[] = [
  {
    id: "credentials",
    label: "API keys",
    hint: "Credentials for the providers this platform calls — encrypted at rest.",
    icon: "key",
  },
  {
    id: "models",
    label: "AI models",
    hint: "Which model answers each AI task, with a fallback per task.",
    icon: "cpu",
  },
];

/** Personal orb preferences and commands have their own access rules, outside app_settings. */
const ASSISTANT_SECTIONS: SettingsNavSection[] = [
  {
    id: "presence",
    label: "JARVIS presence",
    hint: "What the orb may hear on any admin screen, when it may speak first, and the hours it stays quiet.",
    icon: "sparkles",
  },
  {
    id: "appearance",
    label: "JARVIS appearance",
    hint: "The orb's five colours, eight motions, quality and breath, previewed before they are saved.",
    icon: "palette",
  },
  {
    id: "commands",
    label: "Voice commands",
    hint: "Phrases you save to open a page, ask a question, run a tool or say a line.",
    icon: "mic",
  },
];

/**
 * The Platform area's last dock entry: the trail of what this console wrote.
 *
 * Not a control, so not in `SETTINGS_SCHEMA` and it carries no count pill. It is
 * declared here because the dock, the panel the page renders and the links the
 * assistant writes all have to agree that the section exists — the same reason the
 * model and template consoles' tabs are declared beside it. A row of
 * `settings_audit_log` is listed by this section, by nothing else in the portal.
 */
const TRAIL_SECTION: SettingsNavSection = {
  id: "trail",
  label: "Change trail",
  hint: "Every setting, template, team account and stored file this portal changed: the key, the value before, the value after, and when.",
  icon: "history",
};

export const SETTINGS_NAV: readonly SettingsNavArea[] = [
  {
    id: "platform",
    label: "Platform",
    icon: "sliders",
    blurb: "How the product behaves: AI, assessments, notifications and security.",
    sections: [
      ...SETTINGS_SCHEMA.map((section) => ({
        id: section.id,
        label: section.title,
        hint: section.description,
        icon: section.icon,
      })),
      TRAIL_SECTION,
    ],
  },
  {
    id: "organisation",
    label: "Organisation",
    icon: "network",
    blurb: "The vocabularies everything else selects from — added once, used everywhere.",
    sections: ORGANISATION_SECTIONS,
  },
  {
    id: "access",
    label: "Access & comms",
    icon: "users",
    blurb: "Who can do what, and what candidates are told when they move through the pipeline.",
    sections: ACCESS_SECTIONS,
  },
  {
    id: "providers",
    label: "Providers",
    icon: "key",
    blurb: "Credentials and per-task model routing for the AI providers and channels in use.",
    sections: PROVIDER_SECTIONS,
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: "sparkles",
    blurb: "Your own orb: when it may listen or speak, and what it looks like while it does.",
    sections: ASSISTANT_SECTIONS,
  },
];

export const DEFAULT_AREA: SettingsAreaId = "platform";
export const DEFAULT_SECTION: Record<SettingsAreaId, string> = {
  platform: SETTINGS_SCHEMA[0]?.id ?? "organisation",
  organisation: "departments",
  access: "permissions",
  providers: "credentials",
  assistant: "presence",
};

export function areaById(id: string | undefined | null): SettingsNavArea {
  return (
    SETTINGS_NAV.find((area) => area.id === id) ??
    SETTINGS_NAV.find((area) => area.id === DEFAULT_AREA) ??
    SETTINGS_NAV[0]
  );
}

/** The section inside `area`, falling back to that area's default. */
export function sectionFor(area: SettingsNavArea, id: string | undefined | null): SettingsNavSection {
  return (
    area.sections.find((section) => section.id === id) ??
    area.sections.find((section) => section.id === DEFAULT_SECTION[area.id]) ??
    area.sections[0]
  );
}

export function settingsHref(areaId: SettingsAreaId, sectionId: string): string {
  return `/settings?area=${encodeURIComponent(areaId)}&section=${encodeURIComponent(sectionId)}`;
}

/**
 * The AI models console's own tabs — one level below `section=models`.
 *
 * Declared beside the areas for the same reason: the tab strip, the panels it
 * shows or hides, and the links the assistant writes must agree on which views
 * exist. A tab only the console knows about cannot be linked to; a tab only the
 * links know about lands on a hidden panel.
 *
 * The tab the console opens on comes from the URL, and switching it writes the
 * new one back with `history.replaceState`, so the address bar always names the
 * view on screen. A router push is avoided on purpose: all three views are already
 * loaded, so a push would refetch the whole settings page to change a `hidden`
 * class.
 */
export type ModelConsoleTabId = "routing" | "catalogue" | "providers";

/** Key order is the order the tabs appear in the console's strip. */
export const MODEL_CONSOLE_TABS: Record<ModelConsoleTabId, string> = {
  routing: "Task routing",
  catalogue: "Model catalogue",
  providers: "Provider health",
};

export const DEFAULT_MODEL_TAB: ModelConsoleTabId = "routing";

export const MODEL_CONSOLE_TAB_IDS = Object.keys(MODEL_CONSOLE_TABS) as ModelConsoleTabId[];

/**
 * The tab named in a URL.
 *
 * An unknown name falls back to the default instead of dropping the parameter: a
 * stale bookmark should open the console, and a panel that ignores a tab it never
 * had is indistinguishable from one that lost the reader's.
 */
export function modelConsoleTab(id: string | undefined | null): ModelConsoleTabId {
  return MODEL_CONSOLE_TAB_IDS.includes(id as ModelConsoleTabId)
    ? (id as ModelConsoleTabId)
    : DEFAULT_MODEL_TAB;
}

/**
 * The Notification templates console's channel tabs, one level below
 * `section=templates`.
 *
 * Each tab names the channel whose rows it lists, so an answer that rewrote an
 * email template can link straight to the Email tab instead of the WhatsApp one
 * it would otherwise land on. The `portal` tab is the odd one: it is the console's
 * name for `IN_APP` rows, which are edited as copy even though no flow reads one
 * today, so the tab appears only when such a row exists — or when the address bar
 * asks for it, which is how a link about a portal notice stays truthful.
 */
export type TemplatesTabId = "whatsapp" | "email" | "portal";

export const TEMPLATES_CONSOLE_TABS: Record<
  TemplatesTabId,
  { label: string; channel: NotificationChannel }
> = {
  whatsapp: { label: "WhatsApp", channel: "WHATSAPP" },
  email: { label: "Email", channel: "EMAIL" },
  portal: { label: "Portal notices", channel: "IN_APP" },
};

export const DEFAULT_TEMPLATES_TAB: TemplatesTabId = "whatsapp";

export const TEMPLATES_TAB_IDS = Object.keys(TEMPLATES_CONSOLE_TABS) as TemplatesTabId[];

/** The tab that lists a channel's rows, or `null` for a channel with no tab. */
export function templatesTabForChannel(channel: unknown): TemplatesTabId | null {
  const found = TEMPLATES_TAB_IDS.find((id) => TEMPLATES_CONSOLE_TABS[id].channel === channel);
  return found ?? null;
}

/** A tab named in a URL, falling back to the console's first view. */
export function templatesTab(id: string | undefined | null): TemplatesTabId {
  return TEMPLATES_TAB_IDS.includes(id as TemplatesTabId)
    ? (id as TemplatesTabId)
    : DEFAULT_TEMPLATES_TAB;
}

/**
 * The API keys console's provider-group tabs, one level below `section=credentials`.
 *
 * The groups themselves are `providers`'s table, so a provider added to a group
 * lands in a tab without a second list being kept here. This is only the reader
 * for the `?tab=` parameter — the console shows a tab for a group when that group
 * holds credentials, and a parameter naming an empty group falls back to the first
 * one it has rather than opening a panel with nothing in it.
 */
export function credentialsTab(id: string | undefined | null): ProviderGroup | null {
  return PROVIDER_GROUPS.find((group) => group.id === id)?.id ?? null;
}

/**
 * The Assistant area's two sections, and the address the old JARVIS page means.
 *
 * `/assistant/jarvis?tab=appearance` was one page with two tabs; the same two
 * halves are now sections of this dock, so the tab name has to be translated to a
 * section rather than appended as a parameter nobody reads. The `state` a deep link
 * carried travels only with Appearance — Presence has no colours to open on — and
 * is passed through unvalidated, because the settings page is where the six states
 * are checked and a second copy of that rule here could disagree with it.
 */
export function jarvisSettingsHref(tab: string | undefined | null, state?: string | undefined | null): string {
  const section = tab === "appearance" ? "appearance" : "presence";
  const colour = section === "appearance" && typeof state === "string" && state !== "" ? state : null;
  return settingsHref("assistant", section) + (colour === null ? "" : `&state=${encodeURIComponent(colour)}`);
}
