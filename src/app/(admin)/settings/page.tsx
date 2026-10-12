import { SettingsConsole } from "./SettingsConsole";
import { SettingsShell } from "./SettingsShell";
import { MasterDataConsole } from "./MasterDataConsole";
import { PermissionMatrixCard } from "./PermissionMatrixCard";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { TemplatesConsole } from "./TemplatesConsole";
import { loadSettings } from "./actions";
import { getMasterData } from "@/modules/settings/application/master-data-actions";
import { requireStaff } from "@/lib/auth/session";
import { connection } from "next/server";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { TeamSection } from "./TeamSection";

export const metadata = {
  title: "Settings",
  description: "Platform configuration, organisation structure, roles, permissions and notification templates",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

export default async function SettingsPage() {
  // Admin content is per-session; stop the static shell before any rendering so
  // time-dependent code (and the session check) only runs per request.
  await connection();
  const user = await requireStaff("/settings");
  const [bundle, master] = await Promise.all([loadSettings(), getMasterData()]);

  const editable = await hasPermissionForUser("settings.manage_platform");

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Control every aspect of the platform — AI behaviour, assessment rules, integrations, security, organisation structure and team access."
      />

      <SettingsShell
        platform={
          <SettingsConsole initialValues={bundle.values} editable={editable} />
        }
        organisation={<MasterDataConsole data={master} editable={editable} />}
        access={
          <div className="space-y-6">
            <PermissionMatrixCard
              roles={bundle.roles}
              permissions={bundle.permissions}
              grants={bundle.grants}
              editable={editable}
            />

            <TeamSection
              staff={bundle.staff}
              companies={bundle.companies}
              editable={editable}
            />

            <TemplatesConsole templates={bundle.templates} editable={editable} />
          </div>
        }
        integrations={<IntegrationsPanel editable={editable} />}
      />
    </AdminShell>
  );
}