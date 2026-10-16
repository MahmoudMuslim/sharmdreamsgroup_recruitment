import { SETTINGS_SCHEMA } from "./schema";

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
export type SettingsAreaId = "platform" | "organisation" | "access" | "providers";

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

export const SETTINGS_NAV: readonly SettingsNavArea[] = [
  {
    id: "platform",
    label: "Platform",
    icon: "sliders",
    blurb: "How the product behaves: AI, assessments, notifications and security.",
    sections: SETTINGS_SCHEMA.map((section) => ({
      id: section.id,
      label: section.title,
      hint: section.description,
      icon: section.icon,
    })),
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
];

export const DEFAULT_AREA: SettingsAreaId = "platform";
export const DEFAULT_SECTION: Record<SettingsAreaId, string> = {
  platform: SETTINGS_SCHEMA[0]?.id ?? "organisation",
  organisation: "departments",
  access: "permissions",
  providers: "credentials",
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
