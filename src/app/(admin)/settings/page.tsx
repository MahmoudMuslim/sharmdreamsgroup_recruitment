import { SettingsConsole } from "./SettingsConsole";
import { SettingsShell, type SettingsNavCounts } from "./SettingsShell";
import { MasterDataConsole } from "./MasterDataConsole";
import { PermissionMatrixCard } from "./PermissionMatrixCard";
import { ProvidersPanel } from "./ProvidersPanel";
import { TemplatesConsole } from "./TemplatesConsole";
import { loadSettings } from "./actions";
import { getMasterData } from "@/modules/settings/application/master-data-actions";
import { loadStaffConsole } from "@/modules/settings/application/user-actions";
import { requireStaff } from "@/lib/auth/session";
import { connection } from "next/server";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { canManageStaffUsers, hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getOrganisationTimeZone } from "@/modules/settings/infrastructure/settingsReader";
import { DEFAULT_PASSWORD_MIN_LENGTH, SETTINGS_SCHEMA } from "@/modules/settings/domain/schema";
import { TeamSection } from "./TeamSection";
import { areaById, sectionFor } from "@/modules/settings/domain/settingsNav";
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
  "skills",
  "currencies",
] as const;

function masterCounts(master: MasterData): Record<string, number> {
  const source = master as unknown as Record<string, unknown[] | undefined>;
  const out: Record<string, number> = {};
  for (const key of MASTER_KEYS) out[`organisation:${key}`] = source[key]?.length ?? 0;
  return out;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string | string[]; section?: string | string[] }>;
}) {
  // Admin content is per-session; stop the static shell before any rendering so
  // time-dependent code (and the session check) only runs per request.
  await connection();
  const params = await searchParams;
  const user = await requireStaff("/settings");
  const [bundle, master, staffConsole, editable, canManageStaff, organisationTimezone] =
    await Promise.all([
      loadSettings(),
      getMasterData(),
      loadStaffConsole(),
      hasPermissionForUser("settings.manage_platform"),
      canManageStaffUsers(),
      getOrganisationTimeZone(),
    ]);

  // The dock and the panel must agree, so both read the same resolved pair.
  // An unknown or missing `?area=&section=` falls back to the defaults rather
  // than erroring — a stale bookmark should open settings, not a 500.
  const area = areaById(typeof params.area === "string" ? params.area : undefined);
  const section = sectionFor(
    area,
    typeof params.section === "string" ? params.section : undefined
  );

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
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Control every aspect of the platform — AI behaviour, assessment rules, notifications, security, organisation structure and team access."
      />

      <SettingsShell area={area.id} section={section.id} counts={counts}>
        {area.id === "platform" && (
          <SettingsConsole
            initialValues={bundle.values}
            editable={editable}
            section={section.id}
          />
        )}

        {area.id === "organisation" && (
          <MasterDataConsole data={master} editable={editable} section={section.id} />
        )}

        {area.id === "access" && (
          <div className="space-y-6">
            {section.id === "permissions" && (
              <PermissionMatrixCard
                roles={bundle.roles}
                permissions={bundle.permissions}
                grants={bundle.grants}
                editable={editable}
              />
            )}

            {section.id === "team" && (
              <TeamSection
                staff={bundle.staff}
                invites={staffConsole.invites}
                access={staffConsole.access}
                companies={bundle.companies}
                passwordMinLength={passwordMinLength}
                canManage={canManageStaff}
                viewerAuthUserId={user.authUserId}
                timeZone={organisationTimezone}
              />
            )}

            {section.id === "templates" && (
              <TemplatesConsole templates={bundle.templates} editable={editable} />
            )}
          </div>
        )}

        {area.id === "providers" && (
          <ProvidersPanel editable={editable} section={section.id} />
        )}
      </SettingsShell>
    </AdminShell>
  );
}
