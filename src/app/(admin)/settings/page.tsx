import { SettingsConsole } from "./SettingsConsole";
import { SettingsShell, type SettingsNavCounts } from "./SettingsShell";
import { SettingsTrailConsole } from "./SettingsTrailConsole";
import { MasterDataConsole } from "./MasterDataConsole";
import { FilingDriftPanel } from "./FilingDriftPanel";
import { PermissionMatrixCard } from "./PermissionMatrixCard";
import { ProvidersPanel } from "./ProvidersPanel";
import { TemplatesConsole } from "./TemplatesConsole";
import { LanguagesConsole } from "./LanguagesConsole";
import { loadStoredTranslations } from "@/modules/i18n/application/translationOverrides";
import { translationRows } from "@/modules/i18n/domain/translations";
import { loadSettings } from "./actions";
import { listSettingsTrail } from "@/modules/settings/application/settings-trail-actions";
import { getMasterData } from "@/modules/settings/application/master-data-actions";
import { loadStaffConsole } from "@/modules/settings/application/user-actions";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { connection } from "next/server";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import {
  canCreateStaffUsers,
  canManageStaffUsers,
  hasPermissionForUser,
} from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { DEFAULT_PASSWORD_MIN_LENGTH, SETTINGS_SCHEMA } from "@/modules/settings/domain/schema";
import { TeamSection } from "./TeamSection";
import { areaById, sectionFor } from "@/modules/settings/domain/settingsNav";
import { isFiledEntity } from "@/modules/settings/domain/masterDataFiling";
import { trailScope } from "@/modules/settings/domain/credentialTrail";
import { trailFind, trailGroup, trailPage } from "@/modules/settings/domain/settingsTrail";
import type { MasterData } from "@/modules/settings/domain/types";

export const metadata = {
  title: "Settings",
  description: "Platform configuration, organisation structure, roles, permissions and notification templates",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

const MASTER_KEYS = [
  "companies",
  "departments",
  "locations",
  "role_families",
  "positions",
  "skills",
  "currencies",
] as const;

function masterCounts(master: MasterData): Record<string, number> {
  const source = master as unknown as Record<string, unknown[] | undefined>;
  const out: Record<string, number> = {};
  for (const key of MASTER_KEYS) {
    // A table that was never created is not a list of zero: the dock would print a
    // count beside a section that says it cannot be read at all.
    if (key === "positions" && !master.positionsAvailable) continue;
    out[`organisation:${key}`] = source[key]?.length ?? 0;
  }
  return out;
}

/**
 * The Change trail section, with its own read.
 *
 * A section that renders on one of the seventeen addresses the dock offers should
 * not cost the other sixteen three queries, and a prop that would be `null` on
 * those sixteen is a state the panel would have to draw for a section that never
 * shows it. So the read belongs to the section: it runs only when the dock is on
 * `section=trail`, and the scope, page and search words the address bar named are
 * all applied before it, so a chat link lands on the rows it counted rather than
 * on the newest 15 rows of the trail.
 */
async function TrailPanel({
  scope,
  page,
  find,
}: {
  scope: string | null;
  page: number;
  find: string | null;
}) {
  return (
    <SettingsTrailConsole
      read={await listSettingsTrail({ group: scope, page, find })}
      scope={scope}
      page={page}
      find={find}
    />
  );
}

/**
 * The Languages section, with its own read.
 *
 * The console lists every dictionary key, so the rows are built here — on the
 * server, where the dictionaries live — and handed to the panel as plain data. The
 * read runs only on this section, the way the change trail reads only on its own:
 * the other sixteen addresses the dock offers should not pay for a translation
 * round trip they never show.
 */
async function LanguagesPanel({ editable }: { editable: boolean }) {
  const rows = translationRows(await loadStoredTranslations());
  return <LanguagesConsole rows={rows} editable={editable} />;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    area?: string | string[];
    section?: string | string[];
    provider?: string | string[];
    trail?: string | string[];
    page?: string | string[];
    find?: string | string[];
  }>;
}) {
  // Admin content is per-session; stop the static shell before any rendering so
  // time-dependent code (and the session check) only runs per request.
  await connection();
  const params = await searchParams;
  const user = await requireStaff("/settings");

  // The dock and the panel must agree, so both read the same resolved pair.
  // An unknown or missing `?area=&section=` falls back to the defaults rather
  // than erroring — a stale bookmark should open settings, not a 500.
  const area = areaById(typeof params.area === "string" ? params.area : undefined);
  const section = sectionFor(
    area,
    typeof params.section === "string" ? params.section : undefined
  );

  // `?provider=` scopes the keys console's change trail, so a chat answer about one
  // provider's history lands on that history rather than on the newest rows of every
  // provider. Applied before the read so the first paint already holds the filtered
  // set — an unknown id scopes nothing, same as every other parameter on this route.
  const credentialScope = trailScope(
    typeof params.provider === "string" ? params.provider : undefined
  );

  // `?trail=` scopes the settings change trail. `?page=` and `?find=` then walk or
  // search whichever trail is on screen — this route has two, the change trail and
  // the keys console's credential history, and both read a page and a search exactly
  // the same way — all applied here rather than in the browser so the address bar a
  // chat link wrote shows the rows that link counted on the very first paint. The
  // words are their own parameter because `?q=` already means the settings editor's
  // box on this route, and one address must not mean two different searches.
  const changeScope = trailGroup(
    typeof params.trail === "string" ? params.trail : undefined
  );
  const pageNumber = trailPage(typeof params.page === "string" ? params.page : undefined);
  const searchWords = trailFind(typeof params.find === "string" ? params.find : undefined);

  // The permission matrix gates on `settings.manage_roles`, the key the
  // `role_permissions_write` policy checks — not the `manage_platform` that drives
  // every other console here, so a role granted `manage_platform` alone sees locked
  // toggles rather than clicks the database will refuse. Reads the same cached grants
  // as `editable`, so it costs no extra query.
  const [
    bundle,
    master,
    staffConsole,
    editable,
    canManageRoles,
    canManageStaff,
    canCreateStaff,
    organisationTimezone,
  ] = await Promise.all([
      loadSettings(),
      getMasterData(),
      loadStaffConsole(),
      hasPermissionForUser("settings.manage_platform"),
      hasPermissionForUser("settings.manage_roles"),
      canManageStaffUsers(),
      canCreateStaffUsers(),
      getOrganisationTimeZone(),
    ]);

  // Shown by the create-user form, enforced again inside `createUser` — read from
  // the same loaded row so the hint can never drift from the rule.
  const passwordMinLength =
    Number(bundle.values["security.password_min_length"]) || DEFAULT_PASSWORD_MIN_LENGTH;

  const counts: SettingsNavCounts = {
    areas: {
      platform: SETTINGS_SCHEMA.reduce((sum, s) => sum + s.controls.length, 0),
      organisation: Object.values(masterCounts(master)).reduce((sum, n) => sum + n, 0),
      access: bundle.staff.length,
    },
    sections: {
      ...masterCounts(master),
      "access:permissions": bundle.roles.length,
      "access:team": bundle.staff.length + staffConsole.invites.length,
      "access:templates": bundle.templates.length,
      ...Object.fromEntries(
        SETTINGS_SCHEMA.map((s) => [`platform:${s.id}`, s.controls.length])
      ),
    },
  };

  return (
    <PageTransition>
    <PageHeader
      eyebrow="Administration"
      title="Settings"
      description="Control every aspect of the platform — AI behaviour, assessment rules, notifications, security, organisation structure and team access."
    />

    <SettingsShell area={area.id} section={section.id} counts={counts}>
      {area.id === "platform" &&
        (section.id === "trail" ? (
          <TrailPanel scope={changeScope} page={pageNumber} find={searchWords} />
        ) : (
          <SettingsConsole
            initialValues={bundle.values}
            editable={editable}
            section={section.id}
          />
        ))}

      {area.id === "organisation" && (
        <div className="space-y-6">
          {/* Read only on the four sections an opening files itself under, the
              way the change trail reads only on its own section. */}
          {isFiledEntity(section.id) && <FilingDriftPanel entity={section.id} />}
          <MasterDataConsole data={master} editable={editable} section={section.id} />
        </div>
      )}

      {area.id === "access" && (
        <div className="space-y-6">
          {section.id === "permissions" && (
            <PermissionMatrixCard
              roles={bundle.roles}
              permissions={bundle.permissions}
              grants={bundle.grants}
              editable={canManageRoles}
            />
          )}

          {section.id === "team" && (
            <TeamSection
              staff={bundle.staff}
              invites={staffConsole.invites}
              access={staffConsole.access}
              accessError={staffConsole.accessError}
              invitesError={staffConsole.invitesError}
              companies={bundle.companies}
              passwordMinLength={passwordMinLength}
              canManage={canManageStaff}
              canCreate={canCreateStaff}
              viewerAuthUserId={user.authUserId}
              timeZone={organisationTimezone}
            />
          )}

          {section.id === "templates" && (
            <TemplatesConsole templates={bundle.templates} editable={editable} />
          )}

          {section.id === "languages" && <LanguagesPanel editable={editable} />}
        </div>
      )}

      {area.id === "providers" && (
        <ProvidersPanel
          editable={editable}
          section={section.id}
          scope={credentialScope}
          page={pageNumber}
          find={searchWords}
        />
      )}
    </SettingsShell>
    </PageTransition>
  );
}
